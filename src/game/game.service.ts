import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { Game } from './entities/game.entity';
import { GameWin } from './entities/game-win.entity';
import { Gameplay } from './entities/gameplay.entity';
import { GameplayLog } from './entities/gameplay-log.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
import { Voter } from '../voting/entities/voter.entity';
import { EventsService } from '../events/events.service';

import { VotingState, PlayState, TeamSide } from '../common/enums/game.enums';
import {
  generateGameCode,
  generateAdminCode,
} from '../common/utils/code-generator.util';
import { computeStdDev, computeOptionPoints } from '../common/utils/stats.util';
import { GameEventType } from '../events/dto/game-event.dto';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { UpdateVotingStateDto } from './dto/update-voting-state.dto';
import {
  AddScoreDto,
  RevealOptionDto,
  WrongAnswerDto,
} from './dto/gameplay.dto';

/** Number of bcrypt salt rounds — balances security and performance. */
const BCRYPT_ROUNDS = 12;

/** Maximum game_code generation retries before giving up. */
const CODE_GEN_RETRIES = 5;

type GameSeedQuestion = {
  question: string;
  number_of_options: number;
  options: string[];
};

type GameSeed = {
  game_name: string;
  team_a_name?: string;
  team_b_name?: string;
  num_rounds: number;
  questions: GameSeedQuestion[];
};

type GameCreationResult = {
  game: Game;
  rawAdminCode: string;
};

export interface BoardSnapshot {
  id: string;
  game_id: string;
  team_a_score: number;
  team_b_score: number;
  current_question_id?: string | null;
  options_revealed: string[];
  questions_completed: string[];
  current_strikes: number;
  state_snapshot?: Record<string, unknown> | null;
  updated_at: Date;
  game_code: string;
  game_name: string;
  team_a_name: string;
  team_b_name: string;
  play_state: PlayState;
  voting_state: VotingState;
  current_question: {
    id: string;
    question_text: string;
    round_number: number;
    total_options: number;
  } | null;
  revealed_options: Array<{
    option_id: string;
    option_text: string;
    votes: number;
    rank: number;
    points: number;
  }>;
  winner: {
    winning_team: TeamSide;
    team_name: string;
    team_a_total: number;
    team_b_total: number;
    team_a_name: string;
    team_b_name: string;
  } | null;
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,

    @InjectRepository(GameWin)
    private readonly gameWinRepo: Repository<GameWin>,

    @InjectRepository(Gameplay)
    private readonly gameplayRepo: Repository<Gameplay>,

    @InjectRepository(GameplayLog)
    private readonly gameplayLogRepo: Repository<GameplayLog>,

    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,

    @InjectRepository(Option)
    private readonly optionRepo: Repository<Option>,

    @InjectRepository(Voter)
    private readonly voterRepo: Repository<Voter>,

    private readonly dataSource: DataSource,
    private readonly eventsService: EventsService,
  ) {}

  // ── Game Creation ─────────────────────────────────────────────────────────

  private assertRoundCount(numRounds: number, questionCount: number): void {
    if (numRounds > questionCount) {
      throw new BadRequestException(
        `num_rounds (${numRounds}) cannot exceed the number of questions provided (${questionCount})`,
      );
    }
  }

  private async generateUniqueGameCode(): Promise<string> {
    for (let attempt = 0; attempt < CODE_GEN_RETRIES; attempt += 1) {
      const candidate = generateGameCode();
      const existing = await this.gameRepo.findOne({
        where: { game_code: candidate },
        select: ['id'],
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new ConflictException(
      'Unable to generate a unique game code — please try again',
    );
  }

  private buildDuplicateGameName(gameName: string): string {
    const suffix = ' (Copy)';
    if (gameName.length + suffix.length <= 100) {
      return `${gameName}${suffix}`;
    }

    return `${gameName.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
  }

  private async createGameRecord(seed: GameSeed): Promise<GameCreationResult> {
    this.assertRoundCount(seed.num_rounds, seed.questions.length);

    const rawAdminCode = generateAdminCode();
    const hashedAdminCode = await bcrypt.hash(rawAdminCode, BCRYPT_ROUNDS);
    const gameCode = await this.generateUniqueGameCode();

    return this.dataSource.transaction(async (manager) => {
      const game = manager.create(Game, {
        game_name: seed.game_name,
        game_code: gameCode,
        admin_code: hashedAdminCode,
        team_a_name: seed.team_a_name ?? 'Team A',
        team_b_name: seed.team_b_name ?? 'Team B',
        num_rounds: seed.num_rounds,
        voting_state: VotingState.OPEN,
        play_state: PlayState.LOBBY,
      });
      const savedGame = await manager.save(Game, game);

      for (const questionSeed of seed.questions) {
        const question = manager.create(Question, {
          game_id: savedGame.id,
          question: questionSeed.question,
          number_of_options: questionSeed.number_of_options,
          std_dev: null,
          display_order: null,
        });
        const savedQuestion = await manager.save(Question, question);

        const options = questionSeed.options.map((optionText) =>
          manager.create(Option, {
            question_id: savedQuestion.id,
            option_text: optionText,
            votes: 0,
            rank: null,
            points: null,
          }),
        );
        await manager.save(Option, options);
      }

      const log = manager.create(GameplayLog, {
        game_id: savedGame.id,
        team_a_score: 0,
        team_b_score: 0,
        options_revealed: [],
        questions_completed: [],
        current_strikes: 0,
      });
      await manager.save(GameplayLog, log);

      return { game: savedGame, rawAdminCode };
    });
  }

  /**
   * Creates a new game with all its initial questions and options.
   * Wrapped in a DB transaction to guarantee atomicity.
   *
   * The raw admin code is returned ONCE in the response — it is never
   * retrievable again.  The caller must store it securely.
   *
   * @returns Game record + raw admin code (only time it's exposed)
   */
  async createGame(dto: CreateGameDto): Promise<GameCreationResult> {
    const result = await this.createGameRecord({
      game_name: dto.game_name,
      team_a_name: dto.team_a_name,
      team_b_name: dto.team_b_name,
      num_rounds: dto.num_rounds,
      questions: dto.questions.map((question) => ({
        question: question.question,
        number_of_options: 6,
        options: question.options,
      })),
    });

    this.logger.log(`Game created: ${result.game.game_code}`);
    return result;
  }

  async duplicateGame(
    gameCode: string,
    overrides: UpdateGameDto = {},
  ): Promise<GameCreationResult> {
    const sourceGame = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      relations: ['questions', 'questions.options'],
    });
    if (!sourceGame) {
      throw new NotFoundException(`Game "${gameCode}" not found`);
    }

    const questions = [...sourceGame.questions].sort(
      (left, right) => left.created_at.getTime() - right.created_at.getTime(),
    );
    const duplicateGameName =
      overrides.game_name ?? this.buildDuplicateGameName(sourceGame.game_name);

    const result = await this.createGameRecord({
      game_name: duplicateGameName,
      team_a_name: overrides.team_a_name ?? sourceGame.team_a_name,
      team_b_name: overrides.team_b_name ?? sourceGame.team_b_name,
      num_rounds: sourceGame.num_rounds,
      questions: questions.map((question) => ({
        question: question.question,
        number_of_options: question.number_of_options,
        options: question.options.map((option) => option.option_text),
      })),
    });

    this.logger.log(
      `Game duplicated: ${sourceGame.game_code} -> ${result.game.game_code}`,
    );

    return result;
  }

  // ── Admin: Game Info ──────────────────────────────────────────────────────

  /** Retrieves full game details (no admin_code hash — it is select:false). */
  async getGame(gameCode: string): Promise<Game> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      relations: ['questions', 'questions.options'],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);
    return game;
  }

  async updateGame(
    gameCode: string,
    dto: { game_name?: string; team_a_name?: string; team_b_name?: string },
  ): Promise<Game> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    if (game.play_state !== PlayState.LOBBY) {
      throw new BadRequestException(
        'Game details can only be changed before the live game starts',
      );
    }

    if (dto.game_name !== undefined) {
      game.game_name = dto.game_name.trim();
    }
    if (dto.team_a_name !== undefined) {
      game.team_a_name = dto.team_a_name.trim();
    }
    if (dto.team_b_name !== undefined) {
      game.team_b_name = dto.team_b_name.trim();
    }

    return this.gameRepo.save(game);
  }

  /**
   * Survey statistics: for each question, returns all options with their
   * vote counts and the computed std_dev (if voting has closed).
   * Questions are sorted by std_dev ascending (best questions first).
   */
  async getSurveyStats(gameCode: string): Promise<object> {
    const game = await this.getGame(gameCode);

    const questions = await this.questionRepo.find({
      where: { game_id: game.id },
      relations: ['options'],
      order: { std_dev: 'ASC' },
    });

    return questions.map((q) => {
      const totalVotes = q.options.reduce((sum, o) => sum + o.votes, 0);
      const sortedOptions = [...q.options].sort((a, b) => b.votes - a.votes);
      return {
        questionId: q.id,
        question: q.question,
        std_dev: q.std_dev,
        totalVotes,
        options: sortedOptions.map((o) => ({
          id: o.id,
          option_text: o.option_text,
          votes: o.votes,
          rank: o.rank,
          points: o.points,
        })),
      };
    });
  }

  async getSurveyVoterCount(
    gameCode: string,
  ): Promise<{ totalVoters: number }> {
    const game = await this.getGame(gameCode);

    const result = await this.voterRepo
      .createQueryBuilder('voter')
      .select('COUNT(DISTINCT voter.cookie_token)', 'count')
      .where('voter.game_id = :gameId', { gameId: game.id })
      .getRawOne<{ count: string }>();

    const countValue = result?.count;
    const totalVoters = typeof countValue === 'string' ? Number(countValue) : 0;

    return { totalVoters };
  }

  // ── Admin: Voting State ───────────────────────────────────────────────────

  /**
   * Updates the voting state.  When closing voting (→ CLOSED), automatically:
   *   1. Computes std_dev for each question based on vote distributions.
   *   2. Ranks options by votes and computes their points values.
   *   3. Broadcasts a GAME_STATE SSE event to connected clients.
   */
  async updateVotingState(
    gameCode: string,
    dto: UpdateVotingStateDto,
  ): Promise<Game> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    if (game.play_state === PlayState.FINISHED) {
      throw new BadRequestException(
        'Cannot change voting state on a finished game',
      );
    }

    game.voting_state = dto.voting_state;
    await this.gameRepo.save(game);

    // When voting closes, derive statistics from vote data
    if (dto.voting_state === VotingState.CLOSED) {
      await this.finaliseVotingStats(game.id);
    }

    // Notify all connected clients of the state change
    this.eventsService.emit(game.game_code, GameEventType.GAME_STATE, {
      playState: game.play_state,
      votingState: game.voting_state,
    });

    return game;
  }

  /**
   * On voting close: computes std_dev per question and ranks+scores options.
   * Only the top `number_of_options` (default 6) options are ranked.
   */
  private async finaliseVotingStats(gameId: string): Promise<void> {
    const questions = await this.questionRepo.find({
      where: { game_id: gameId },
      relations: ['options'],
    });

    for (const question of questions) {
      const sortedOptions = [...question.options].sort(
        (a, b) => b.votes - a.votes,
      );
      const topOptions = sortedOptions.slice(0, question.number_of_options);

      await this.optionRepo.update(
        { question_id: question.id },
        { rank: null, points: null },
      );

      const totalVotes = topOptions.reduce((sum, o) => sum + o.votes, 0);
      const voteCounts = topOptions.map((o) => o.votes);
      const points = computeOptionPoints(voteCounts, totalVotes);
      const stdDev = computeStdDev(voteCounts);

      // Update each top option with rank + points
      for (let i = 0; i < topOptions.length; i++) {
        await this.optionRepo.update(topOptions[i].id, {
          rank: i + 1,
          points: points[i],
        });
      }

      // Store std_dev on the question
      await this.questionRepo.update(question.id, { std_dev: stdDev });
    }
  }

  // ── Admin: Start Game ─────────────────────────────────────────────────────

  /**
   * Transitions the game from LOBBY → IN_PROGRESS.
   * Selects the top `num_rounds` questions sorted by std_dev asc (lowest
   * deviation = most balanced survey = best Family Feud question) and assigns
   * them a `display_order` (1-based).
   *
   * Prerequisites:
   *   - Voting must be CLOSED.
   *   - Game must be in LOBBY state.
   */
  async startGame(gameCode: string): Promise<Game> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    if (game.voting_state !== VotingState.CLOSED) {
      throw new BadRequestException(
        'Voting must be closed before starting the game',
      );
    }
    if (game.play_state !== PlayState.LOBBY) {
      throw new BadRequestException(
        `Game is already ${game.play_state} — cannot start again`,
      );
    }

    // Pick the best num_rounds questions by std_dev ascending
    const questions = await this.questionRepo.find({
      where: { game_id: game.id },
      order: { std_dev: 'ASC' },
    });

    if (questions.length < game.num_rounds) {
      throw new BadRequestException(
        `Game has ${questions.length} question(s) but num_rounds is ${game.num_rounds}`,
      );
    }

    const selectedQuestions = questions.slice(0, game.num_rounds);
    for (let i = 0; i < selectedQuestions.length; i++) {
      await this.questionRepo.update(selectedQuestions[i].id, {
        display_order: i + 1,
      });
    }

    game.play_state = PlayState.IN_PROGRESS;
    await this.gameRepo.save(game);

    this.eventsService.emit(game.game_code, GameEventType.GAME_STATE, {
      playState: game.play_state,
      votingState: game.voting_state,
    });

    this.logger.log(`Game started: ${game.game_code}`);
    return game;
  }

  // ── Admin: Gameplay Actions ───────────────────────────────────────────────

  /**
   * Advances to the next question in display_order sequence.
   * Closes out the previous round (saves Gameplay record if a team winner
   * was set in the log) and loads the next question onto the board.
   *
   * Emits: next_question SSE event.
   */
  async nextQuestion(gameCode: string): Promise<GameplayLog> {
    const { game, log } = await this.getActiveGame(gameCode);

    // Persist Gameplay record for the completed question if one was active
    // Capture the ID before closeCurrentRound nulls it out
    const previousQuestionId = log.current_question_id;
    if (log.current_question_id) {
      await this.closeCurrentRound(log, game.id);
    }

    // Find the next question in sequence
    const nextOrder = previousQuestionId
      ? await this.getNextDisplayOrder(game.id, previousQuestionId)
      : 1;

    const nextQuestion = await this.questionRepo.findOne({
      where: { game_id: game.id, display_order: nextOrder },
      relations: ['options'],
    });

    if (!nextQuestion) {
      throw new BadRequestException(
        'No more questions available — end the game',
      );
    }

    // Update log: reset per-round fields for the new question
    log.current_question_id = nextQuestion.id;
    log.options_revealed = [];
    log.current_strikes = 0;
    log.state_snapshot = {
      ...(log.state_snapshot ?? {}),
      activeTeam: null,
      lastScoringTeam: null,
      scoredQuestionId: null,
    };
    await this.gameplayLogRepo.save(log);

    // Count how many options have at least 1 vote (what will be on the board)
    const playableOptions = nextQuestion.options.filter(
      (o) => o.rank !== null,
    ).length;

    this.eventsService.emit(game.game_code, GameEventType.NEXT_QUESTION, {
      questionId: nextQuestion.id,
      questionText: nextQuestion.question,
      totalOptions: playableOptions,
      roundNumber: nextOrder,
    });

    return log;
  }

  /**
   * Reveals a specific option on the board.
   * The option must belong to the currently active question.
   *
   * Emits: reveal_option SSE event.
   */
  async revealOption(gameCode: string, dto: RevealOptionDto): Promise<void> {
    const { game, log } = await this.getActiveGame(gameCode);

    if (!log.current_question_id) {
      throw new BadRequestException(
        'No active question — advance to the next question first',
      );
    }

    const option = await this.optionRepo.findOne({
      where: { id: dto.optionId, question_id: log.current_question_id },
    });
    if (!option) {
      throw new NotFoundException(
        `Option "${dto.optionId}" not found on the current question`,
      );
    }

    if (log.options_revealed.includes(dto.optionId)) {
      throw new BadRequestException('This option has already been revealed');
    }

    if (option.rank === null) {
      throw new BadRequestException(
        'Only ranked top answers can be revealed on the board',
      );
    }

    // Add to revealed list and persist
    log.options_revealed = [...log.options_revealed, dto.optionId];
    await this.gameplayLogRepo.save(log);

    this.eventsService.emit(game.game_code, GameEventType.REVEAL_OPTION, {
      optionId: option.id,
      optionText: option.option_text,
      votes: option.votes,
      rank: option.rank ?? 0,
      points: option.points ?? 0,
    });
  }

  /**
   * Triggers the wrong-answer buzzer for a team.  Increments strike count.
   * Three strikes conventionally steal the question, but the rule is enforced
   * on the admin panel side — this just emits the event.
   *
   * Emits: wrong_option SSE event.
   */
  async wrongAnswer(gameCode: string, dto: WrongAnswerDto): Promise<void> {
    const { game, log } = await this.getActiveGame(gameCode);

    log.current_strikes = (log.current_strikes ?? 0) + 1;
    await this.gameplayLogRepo.save(log);

    const teamName =
      dto.team === TeamSide.TEAM_A ? game.team_a_name : game.team_b_name;

    this.eventsService.emit(game.game_code, GameEventType.WRONG_OPTION, {
      team: dto.team,
      teamName,
      strikeCount: log.current_strikes,
    });
  }

  /**
   * Adds points to a team's running score and updates the gameplay log.
   * Used by the admin to manually credit a team for a completed round or
   * for stolen points.
   *
   * Emits: add_score SSE event.
   */
  async addScore(gameCode: string, dto: AddScoreDto): Promise<GameplayLog> {
    const { game, log } = await this.getActiveGame(gameCode);

    if (!log.current_question_id) {
      throw new BadRequestException(
        'No active question to score — advance to the next question first',
      );
    }

    if (
      (log.state_snapshot?.scoredQuestionId as string | null) ===
      log.current_question_id
    ) {
      throw new BadRequestException(
        'This question has already been scored. Advance to the next question to continue.',
      );
    }

    if (dto.team === TeamSide.TEAM_A) {
      log.team_a_score += dto.points;
    } else {
      log.team_b_score += dto.points;
    }

    log.state_snapshot = {
      ...(log.state_snapshot ?? {}),
      lastScoringTeam: dto.team,
      scoredQuestionId: log.current_question_id,
    };
    await this.gameplayLogRepo.save(log);

    const teamName =
      dto.team === TeamSide.TEAM_A ? game.team_a_name : game.team_b_name;

    this.eventsService.emit(game.game_code, GameEventType.ADD_SCORE, {
      team: dto.team,
      teamName,
      points: dto.points,
      teamATotal: log.team_a_score,
      teamBTotal: log.team_b_score,
      teamAName: game.team_a_name,
      teamBName: game.team_b_name,
    });

    return log;
  }

  /**
   * Ends the game: determines the winner, creates a GameWin record, sets
   * play_state to FINISHED, and emits end_game + play_winner_sound SSE events.
   */
  async endGame(gameCode: string): Promise<GameWin> {
    const { game, log } = await this.getActiveGame(gameCode);

    // Close the current round if one is in progress
    if (log.current_question_id) {
      await this.closeCurrentRound(log, game.id);
    }

    const winningTeam =
      log.team_a_score >= log.team_b_score ? TeamSide.TEAM_A : TeamSide.TEAM_B;

    const gameWin = this.gameWinRepo.create({
      game_id: game.id,
      winning_team: winningTeam,
      team_a_total: log.team_a_score,
      team_b_total: log.team_b_score,
    });
    await this.gameWinRepo.save(gameWin);

    game.play_state = PlayState.FINISHED;
    await this.gameRepo.save(game);

    const teamName =
      winningTeam === TeamSide.TEAM_A ? game.team_a_name : game.team_b_name;

    const endPayload = {
      winningTeam,
      teamName,
      teamATotal: log.team_a_score,
      teamBTotal: log.team_b_score,
      teamAName: game.team_a_name,
      teamBName: game.team_b_name,
    };

    this.eventsService.emit(game.game_code, GameEventType.PLAY_WINNER_SOUND, {
      winningTeam,
      teamName,
    });
    this.eventsService.emit(game.game_code, GameEventType.END_GAME, endPayload);

    this.logger.log(`Game ended: ${game.game_code}, winner: ${teamName}`);
    return gameWin;
  }

  // ── Client: Board Snapshot ────────────────────────────────────────────────

  /**
   * Returns the current gameplay log — used by clients to resync after
   * a disconnection without replaying the full event history.
   */
  async getBoardSnapshot(gameCode: string): Promise<BoardSnapshot> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      select: [
        'id',
        'game_code',
        'game_name',
        'team_a_name',
        'team_b_name',
        'play_state',
        'voting_state',
      ],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    const log = await this.gameplayLogRepo.findOne({
      where: { game_id: game.id },
      relations: ['current_question', 'current_question.options'],
    });
    if (!log)
      throw new NotFoundException('Gameplay log not found for this game');

    const currentQuestion = log.current_question;
    const currentQuestionOptions = currentQuestion?.options ?? [];
    const revealedOptions = currentQuestionOptions
      .filter((option) => log.options_revealed.includes(option.id))
      .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999))
      .map((option) => ({
        option_id: option.id,
        option_text: option.option_text,
        votes: option.votes,
        rank: option.rank ?? 0,
        points: option.points ?? 0,
      }));

    const rankedOptionCount = currentQuestionOptions.filter(
      (option) => option.rank !== null,
    ).length;

    const gameWin = await this.gameWinRepo.findOne({
      where: { game_id: game.id },
      select: ['winning_team', 'team_a_total', 'team_b_total'],
    });

    return {
      id: log.id,
      game_id: log.game_id,
      team_a_score: log.team_a_score,
      team_b_score: log.team_b_score,
      current_question_id: log.current_question_id ?? null,
      options_revealed: log.options_revealed,
      questions_completed: log.questions_completed,
      current_strikes: log.current_strikes,
      state_snapshot: log.state_snapshot ?? null,
      updated_at: log.updated_at,
      game_code: game.game_code,
      game_name: game.game_name,
      team_a_name: game.team_a_name,
      team_b_name: game.team_b_name,
      play_state: game.play_state,
      voting_state: game.voting_state,
      current_question: currentQuestion
        ? {
            id: currentQuestion.id,
            question_text: currentQuestion.question,
            round_number: currentQuestion.display_order ?? 0,
            total_options:
              rankedOptionCount > 0
                ? rankedOptionCount
                : Math.min(
                    currentQuestion.number_of_options,
                    currentQuestionOptions.length,
                  ),
          }
        : null,
      revealed_options: revealedOptions,
      winner: gameWin
        ? {
            winning_team: gameWin.winning_team,
            team_name:
              gameWin.winning_team === TeamSide.TEAM_A
                ? game.team_a_name
                : game.team_b_name,
            team_a_total: gameWin.team_a_total,
            team_b_total: gameWin.team_b_total,
            team_a_name: game.team_a_name,
            team_b_name: game.team_b_name,
          }
        : null,
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Fetches a game and its log, asserting the game is currently active. */
  private async getActiveGame(
    gameCode: string,
  ): Promise<{ game: Game; log: GameplayLog }> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);
    if (game.play_state === PlayState.FINISHED) {
      throw new BadRequestException('Game has already finished');
    }
    if (game.play_state !== PlayState.IN_PROGRESS) {
      throw new BadRequestException(
        'Game must be IN_PROGRESS to perform this action',
      );
    }

    const log = await this.gameplayLogRepo.findOne({
      where: { game_id: game.id },
    });
    if (!log) throw new NotFoundException('Gameplay log not found');

    return { game, log };
  }

  /**
   * Closes the current active round: persists a Gameplay record.
   * The winning team is read from state_snapshot if set by add-score.
   */
  private async closeCurrentRound(
    log: GameplayLog,
    gameId: string,
  ): Promise<void> {
    if (!log.current_question_id) return;

    const snapshot = log.state_snapshot ?? {};
    const teamWin = (snapshot.lastScoringTeam as TeamSide) ?? TeamSide.NONE;

    await this.gameplayRepo.save(
      this.gameplayRepo.create({
        game_id: gameId,
        question_id: log.current_question_id,
        team_win: teamWin,
        point_won:
          teamWin === TeamSide.TEAM_A
            ? log.team_a_score // simplification — ideally track round delta
            : teamWin === TeamSide.TEAM_B
              ? log.team_b_score
              : 0,
      }),
    );

    // Move current question to completed list
    if (!log.questions_completed.includes(log.current_question_id)) {
      log.questions_completed = [
        ...log.questions_completed,
        log.current_question_id,
      ];
    }

    log.current_question_id = null;
    log.options_revealed = [];
    log.current_strikes = 0;
  }

  /** Finds the display_order that comes after the given question's order. */
  private async getNextDisplayOrder(
    gameId: string,
    currentQuestionId: string,
  ): Promise<number> {
    const current = await this.questionRepo.findOne({
      where: { id: currentQuestionId, game_id: gameId },
      select: ['display_order'],
    });
    return (current?.display_order ?? 0) + 1;
  }
}
