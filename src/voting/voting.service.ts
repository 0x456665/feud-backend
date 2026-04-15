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
import { CastVoteDto } from './dto/cast-vote.dto';

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
   * Generates and sets a voter_token cookie for a player joining a game.
   * This token is the primary dedup key used by VoterGuard.
   *
   * If the player already has a valid voter_token cookie for this game we
   *  reuse it — this handles page refreshes gracefully without creating
   *  duplicate sessions.
   *
   * @returns The voter token UUID (already set as cookie by the controller)
   */
  getOrCreateVoterToken(req: Request): string {
    const existing: string | undefined = req.cookies?.voter_token as string;
    if (existing && this.isValidUuid(existing)) {
      return existing;
    }
    return randomUUID();
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
    dto: CastVoteDto,
    cookieToken: string,
    req: Request,
  ): Promise<{ message: string }> {
    const game = await this.gameRepo.findOne({
      where: { id: dto.gameId },
      select: ['id', 'game_code', 'voting_state'],
    });
    if (!game) throw new NotFoundException('Game not found');

    if (game.voting_state !== VotingState.OPEN) {
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
    this.eventsService.emit(game.game_code, GameEventType.VOTE_UPDATE, {
      questionId: dto.questionId,
      totalVotes,
    });

    this.logger.debug(`Vote recorded for question ${dto.questionId}`);
    return { message: 'Vote cast successfully' };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Masks the last octet of an IPv4 address for GDPR compliance. */
  private maskIp(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
    // IPv6 — return as-is (masking IPv6 is more complex; log for audit)
    return ip;
  }

  /** Validates that a string is a UUID v4 pattern. */
  private isValidUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
