import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { GameService } from './game.service';
import { Game } from './entities/game.entity';
import { GameWin } from './entities/game-win.entity';
import { Gameplay } from './entities/gameplay.entity';
import { GameplayLog } from './entities/gameplay-log.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
import { Voter } from '../voting/entities/voter.entity';
import { EventsService } from '../events/events.service';
import { VotingState, PlayState, TeamSide } from '../common/enums/game.enums';
import { GameEventType } from '../events/dto/game-event.dto';

/** Factory for a minimal mock TypeORM repository. */
const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
});

/** Minimal mock DataSource that provides a transactional manager. */
const mockDataSource = () => ({
  transaction: jest.fn(
    (
      cb: (manager: {
        create: (
          entity: unknown,
          data: Record<string, unknown>,
        ) => Record<string, unknown>;
        save: jest.Mock<
          Promise<Record<string, unknown>>,
          [unknown, Record<string, unknown>]
        >;
      }) => Promise<unknown>,
    ) =>
      cb({
        create: (_entity: unknown, data: Record<string, unknown>) => ({
          ...data,
        }),
        save: jest.fn((_: unknown, data: Record<string, unknown>) =>
          Promise.resolve({
            id: 'saved-id',
            ...data,
          }),
        ),
      }),
  ),
});

describe('GameService', () => {
  let service: GameService;
  let gameRepo: ReturnType<typeof mockRepo>;
  let questionRepo: ReturnType<typeof mockRepo>;
  let voterRepo: ReturnType<typeof mockRepo>;
  let gameplayLogRepo: ReturnType<typeof mockRepo>;
  let eventsService: { emit: jest.Mock };
  let dataSource: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    eventsService = { emit: jest.fn() };
    dataSource = mockDataSource();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameService,
        { provide: getRepositoryToken(Game), useFactory: mockRepo },
        { provide: getRepositoryToken(GameWin), useFactory: mockRepo },
        { provide: getRepositoryToken(Gameplay), useFactory: mockRepo },
        { provide: getRepositoryToken(GameplayLog), useFactory: mockRepo },
        { provide: getRepositoryToken(Question), useFactory: mockRepo },
        { provide: getRepositoryToken(Option), useFactory: mockRepo },
        { provide: getRepositoryToken(Voter), useFactory: mockRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: EventsService, useValue: eventsService },
      ],
    }).compile();

    service = module.get<GameService>(GameService);
    gameRepo = module.get(getRepositoryToken(Game));
    questionRepo = module.get(getRepositoryToken(Question));
    voterRepo = module.get(getRepositoryToken(Voter));
    gameplayLogRepo = module.get(getRepositoryToken(GameplayLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── createGame ────────────────────────────────────────────────────────────

  describe('createGame()', () => {
    it('throws if num_rounds > questions.length', async () => {
      await expect(
        service.createGame({
          game_name: 'Test',
          num_rounds: 5,
          questions: [{ question: 'Q1', options: ['A', 'B'] }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks for game_code uniqueness and creates game on success', async () => {
      gameRepo.findOne.mockResolvedValue(null); // no collision
      const result = await service.createGame({
        game_name: 'Night Feud',
        num_rounds: 1,
        questions: [{ question: 'Name a colour', options: ['Red', 'Blue'] }],
      });
      expect(result).toHaveProperty('rawAdminCode');
      expect(result).toHaveProperty('game');
    });
  });

  describe('duplicateGame()', () => {
    it('clones a game into a fresh lobby copy', async () => {
      gameRepo.findOne
        .mockResolvedValueOnce({
          id: 'source-id',
          game_code: 'FEUD4X',
          game_name: 'Office Feud',
          team_a_name: 'Alpha',
          team_b_name: 'Beta',
          num_rounds: 2,
          questions: [
            {
              question: 'Name an office snack',
              number_of_options: 4,
              created_at: new Date('2026-01-01T00:00:00Z'),
              options: [{ option_text: 'Chips' }, { option_text: 'Cookies' }],
            },
            {
              question: 'Name a meeting excuse',
              number_of_options: 3,
              created_at: new Date('2026-01-02T00:00:00Z'),
              options: [
                { option_text: 'Traffic' },
                { option_text: 'Wi-Fi issues' },
              ],
            },
          ],
        })
        .mockResolvedValueOnce(null);

      const result = await service.duplicateGame('FEUD4X', {
        game_name: 'Office Feud Remix',
        team_a_name: 'Gamma',
        team_b_name: 'Delta',
      });

      expect(result).toHaveProperty('rawAdminCode');
      expect(result.game.game_name).toBe('Office Feud Remix');
      expect(result.game.team_a_name).toBe('Gamma');
      expect(result.game.team_b_name).toBe('Delta');
      expect(result.game.num_rounds).toBe(2);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('throws when the source game does not exist', async () => {
      gameRepo.findOne.mockResolvedValue(null);

      await expect(service.duplicateGame('NOPE12')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateVotingState ─────────────────────────────────────────────────────

  describe('updateVotingState()', () => {
    it('throws NotFoundException when game does not exist', async () => {
      gameRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateVotingState('NOCODE', {
          voting_state: VotingState.CLOSED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('emits GAME_STATE event on state change', async () => {
      const mockGame = {
        id: 'g1',
        game_code: 'FEUD4X',
        play_state: PlayState.LOBBY,
        voting_state: VotingState.OPEN,
      };
      gameRepo.findOne.mockResolvedValue(mockGame);
      gameRepo.save.mockResolvedValue(mockGame);
      questionRepo.find.mockResolvedValue([]);

      await service.updateVotingState('FEUD4X', {
        voting_state: VotingState.PAUSED,
      });

      expect(eventsService.emit).toHaveBeenCalledWith(
        'FEUD4X',
        GameEventType.GAME_STATE,
        expect.objectContaining({ votingState: VotingState.PAUSED }),
      );
    });
  });

  // ── startGame ─────────────────────────────────────────────────────────────

  describe('getSurveyVoterCount()', () => {
    it('returns zero when no voters exist yet', async () => {
      gameRepo.findOne.mockResolvedValue({ id: 'g1' });
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
      };
      voterRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.getSurveyVoterCount('FEUD4X');

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'voter.game_id = :gameId',
        {
          gameId: 'g1',
        },
      );
      expect(result).toEqual({ totalVoters: 0 });
    });
  });

  describe('startGame()', () => {
    it('throws if voting is not CLOSED', async () => {
      gameRepo.findOne.mockResolvedValue({
        game_code: 'FEUD4X',
        voting_state: VotingState.OPEN,
        play_state: PlayState.LOBBY,
      });
      await expect(service.startGame('FEUD4X')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws if not enough questions for num_rounds', async () => {
      gameRepo.findOne.mockResolvedValue({
        game_code: 'FEUD4X',
        voting_state: VotingState.CLOSED,
        play_state: PlayState.LOBBY,
        num_rounds: 3,
        id: 'g1',
      });
      questionRepo.find.mockResolvedValue([
        { id: 'q1', display_order: null, std_dev: 0.5 },
      ]); // only 1 question, need 3
      await expect(service.startGame('FEUD4X')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── addScore ──────────────────────────────────────────────────────────────

  describe('addScore()', () => {
    it('increments the correct team score and emits ADD_SCORE', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g1',
        game_code: 'FEUD4X',
        play_state: PlayState.IN_PROGRESS,
        team_a_name: 'Smiths',
        team_b_name: 'Johnsons',
      });
      const log = {
        game_id: 'g1',
        team_a_score: 10,
        team_b_score: 5,
        state_snapshot: {},
        current_question_id: 'q1',
        options_revealed: [],
        current_strikes: 0,
      };
      gameplayLogRepo.findOne.mockResolvedValue(log);
      gameplayLogRepo.save.mockResolvedValue(log);

      await service.addScore('FEUD4X', {
        team: TeamSide.TEAM_A,
        points: 20,
      });

      expect(log.team_a_score).toBe(30);
      expect(eventsService.emit).toHaveBeenCalledWith(
        'FEUD4X',
        GameEventType.ADD_SCORE,
        expect.objectContaining({ teamATotal: 30, teamBTotal: 5 }),
      );
    });

    it('throws when attempting to score a question more than once', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g1',
        game_code: 'FEUD4X',
        play_state: PlayState.IN_PROGRESS,
        team_a_name: 'Smiths',
        team_b_name: 'Johnsons',
      });
      const log = {
        game_id: 'g1',
        team_a_score: 10,
        team_b_score: 5,
        state_snapshot: {
          lastScoringTeam: TeamSide.TEAM_A,
          scoredQuestionId: 'q1',
        },
        current_question_id: 'q1',
        options_revealed: [],
        current_strikes: 0,
      };
      gameplayLogRepo.findOne.mockResolvedValue(log);

      await expect(
        service.addScore('FEUD4X', {
          team: TeamSide.TEAM_B,
          points: 10,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(gameplayLogRepo.save).not.toHaveBeenCalled();
    });

    it('allows scoring a new question after the previous one was scored', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g1',
        game_code: 'FEUD4X',
        play_state: PlayState.IN_PROGRESS,
        team_a_name: 'Smiths',
        team_b_name: 'Johnsons',
      });
      const log = {
        game_id: 'g1',
        team_a_score: 10,
        team_b_score: 5,
        state_snapshot: {
          lastScoringTeam: TeamSide.TEAM_A,
          scoredQuestionId: 'q1',
        },
        current_question_id: 'q2',
        options_revealed: [],
        current_strikes: 0,
      };
      gameplayLogRepo.findOne.mockResolvedValue(log);
      gameplayLogRepo.save.mockResolvedValue(log);

      await service.addScore('FEUD4X', {
        team: TeamSide.TEAM_B,
        points: 15,
      });

      expect(log.team_b_score).toBe(20);
      expect(log.state_snapshot.scoredQuestionId).toBe('q2');
    });
  });
});
