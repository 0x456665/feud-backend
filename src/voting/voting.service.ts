import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { Voter } from './entities/voter.entity';
import { Game } from '../game/entities/game.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
import { EventsService } from '../events/events.service';
import { GameEventType } from '../events/dto/game-event.dto';
import { VotingState } from '../common/enums/game.enums';
import { buildDeviceFingerprint } from '../common/guards/voter.guard';
import { CastVoteDto, VoteSubmissionDto } from './dto/cast-vote.dto';

@Injectable()
export class VotingService {
  private readonly logger = new Logger(VotingService.name);

  constructor(
    @InjectRepository(Voter)
    private readonly voterRepo: Repository<Voter>,

    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,

    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,

    @InjectRepository(Option)
    private readonly optionRepo: Repository<Option>,

    private readonly eventsService: EventsService,
  ) {}

  /**
   * Returns all questions and their options for the voting/survey phase.
   * Omits vote counts so voters cannot see live tally during voting.
   * Only available while voting_state is OPEN.
   */
  async getQuestionsForVoting(gameCode: string): Promise<object> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      select: ['id', 'game_name', 'voting_state'],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    if (game.voting_state !== VotingState.OPEN) {
      throw new BadRequestException(
        'Voting is not currently open for this game',
      );
    }

    const questions = await this.questionRepo.find({
      where: { game_id: game.id },
      relations: ['options'],
      order: { created_at: 'ASC' },
    });

    return {
      gameId: game.id,
      gameName: game.game_name,
      questions: questions.map((q) => ({
        questionId: q.id,
        question: q.question,
        options: q.options.map((o) => ({
          optionId: o.id,
          text: o.option_text,
        })),
      })),
    };
  }

  /**
   * Generates or reuses a voter_token UUID cookie if present on the request.
   */
  getOrCreateVoterToken(req: Request): string {
    const existing: string | undefined = req.cookies?.voter_token as string;
    if (
      existing &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        existing,
      )
    ) {
      return existing;
    }
    return randomUUID();
  }

  /**
   * Casts one or more votes in a single request.
   * The vote endpoint remains throttled to 1 request / 10s per IP,
   * so batching reduces client friction.
   */
  async castVotes(
    gameCode: string,
    dto: CastVoteDto,
    cookieToken: string,
    req: Request,
  ): Promise<{ message: string }> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      select: ['id', 'game_code', 'voting_state'],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    if (game.voting_state !== VotingState.OPEN) {
      throw new BadRequestException(
        'Voting is not currently open for this game',
      );
    }

    const questionIds = new Set<string>();
    for (const vote of dto.votes) {
      if (vote.gameId !== game.id) {
        throw new BadRequestException(
          'All votes in the batch must belong to the requested game',
        );
      }
      if (questionIds.has(vote.questionId)) {
        throw new BadRequestException(
          'Duplicate question submissions are not allowed in the same batch',
        );
      }
      questionIds.add(vote.questionId);
      await this.castVote(vote, cookieToken, req, game);
    }

    return { message: 'Votes cast successfully' };
  }

  /**
   * Casts a vote for an option on a question.
   * Pre-conditions (enforced before this is called):
   *   - VoterGuard has already confirmed no duplicate vote.
   *   - ThrottlerGuard has enforced the per-IP rate limit.
   *
   * Steps:
   *   1. Validates the game, question, and option all exist and are coherent.
   *   2. Asserts voting is OPEN.
   *   3. Atomically increments option.votes.
   *   4. Records the Voter row for dedup.
   *   5. Emits a vote_update SSE so the admin survey stats update live.
   */
  async castVote(
    dto: VoteSubmissionDto,
    cookieToken: string,
    req: Request,
    game?: Game,
  ): Promise<{ message: string }> {
    const resolvedGame =
      game ??
      (await this.gameRepo.findOne({
        where: { id: dto.gameId },
        select: ['id', 'game_code', 'voting_state'],
      }));
    if (!resolvedGame) throw new NotFoundException('Game not found');

    if (resolvedGame.voting_state !== VotingState.OPEN) {
      throw new BadRequestException(
        'Voting is not currently open for this game',
      );
    }

    const question = await this.questionRepo.findOne({
      where: { id: dto.questionId, game_id: dto.gameId },
      select: ['id'],
    });
    if (!question) {
      throw new NotFoundException('Question not found in this game');
    }

    // Deduplicate submitted option IDs in case the caller sends the same id twice
    const uniqueOptionIds = [...new Set(dto.optionIds)];

    if (uniqueOptionIds.length > 0) {
      // Validate all submitted options exist and belong to this question.
      // TypeORM treats an array of `where` objects as OR conditions.
      const matchedOptions = await this.optionRepo.find({
        where: uniqueOptionIds.map((id) => ({ id, question_id: dto.questionId })),
        select: ['id'],
      });
      if (matchedOptions.length !== uniqueOptionIds.length) {
        throw new NotFoundException(
          'One or more options not found for this question',
        );
      }

      // Atomically increment vote count for each selected option
      await Promise.all(
        uniqueOptionIds.map((id) =>
          this.optionRepo.increment(
            { id, question_id: dto.questionId },
            'votes',
            1,
          ),
        ),
      );
    }

    // Record the voter for dedup tracking
    const fingerprint = buildDeviceFingerprint(
      req.ip,
      req.headers['user-agent'],
    );
    const voter = this.voterRepo.create({
      game_id: dto.gameId,
      question_id: dto.questionId,
      cookie_token: cookieToken,
      device_fingerprint: fingerprint,
      // Truncate user-agent to 500 chars to prevent storage abuse
      user_agent: (req.headers['user-agent'] ?? '').substring(0, 500),
      // Mask last octet of IPv4 for GDPR compliance
      ip_address: this.maskIp(req.ip ?? ''),
    });
    await this.voterRepo.save(voter);

    // Tally total votes for this question to emit as update
    const allOptions = await this.optionRepo.find({
      where: { question_id: dto.questionId },
      select: ['votes'],
    });
    const totalVotes = allOptions.reduce((sum, o) => sum + o.votes, 0);

    // Broadcast vote total update to admin survey view (and any connected clients)
    this.eventsService.emit(resolvedGame.game_code, GameEventType.VOTE_UPDATE, {
      questionId: dto.questionId,
      totalVotes,
    });

    this.logger.debug(`Vote recorded for question ${dto.questionId}`);
    return { message: 'Vote cast successfully' };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Masks the last IPv4 octet for GDPR compliance before storing. */
  private maskIp(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
    // IPv6 — return as-is (masking IPv6 is more complex; log for audit)
    return ip;
  }
}
