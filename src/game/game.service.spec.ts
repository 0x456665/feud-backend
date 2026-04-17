import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { GameService } from './game.service';
import { Game } from './entities/game.entity';
import { GameWin } from './entities/game-win.entity';
import { Gameplay } from './entities/gameplay.entity';
import { GameplayLog } from './entities/gameplay-log.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
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
});

/** Minimal mock DataSource that provides a transactional manager. */
const mockDataSource = () => ({
  transaction: jest.fn((cb: (manager: any) => Promise<any>) =>
    cb({
      create: (_entity: any, data: any) => ({ ...data }),
      save: jest.fn((_, data) => Promise.resolve({ id: 'saved-id', ...data })),
    }),
  ),
});

describe('GameService', () => {
  let service: GameService;
  let gameRepo: ReturnType<typeof mockRepo>;
  let questionRepo: ReturnType<typeof mockRepo>;
  let optionRepo: ReturnType<typeof mockRepo>;
  let gameplayLogRepo: ReturnType<typeof mockRepo>;
  let gameWinRepo: ReturnType<typeof mockRepo>;
  let gameplayRepo: ReturnType<typeof mockRepo>;
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
        { provide: DataSource, useValue: dataSource },
        { provide: EventsService, useValue: eventsService },
      ],
    }).compile();

    service = module.get<GameService>(GameService);
    gameRepo = module.get(getRepositoryToken(Game));
    questionRepo = module.get(getRepositoryToken(Question));
    optionRepo = module.get(getRepositoryToken(Option));
    gameplayLogRepo = module.get(getRepositoryToken(GameplayLog));
    gameWinRepo = module.get(getRepositoryToken(GameWin));
    gameplayRepo = module.get(getRepositoryToken(Gameplay));
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

  // ── updateVotingState ─────────────────────────────────────────────────────

  describe('updateVotingState()', () => {
    it('throws NotFoundException when game does not exist', async () => {
      gameRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateVotingState('NOCODE', { voting_state: VotingState.CLOSED }),
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
