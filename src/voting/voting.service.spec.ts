import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { VotingService } from './voting.service';
import { Voter } from './entities/voter.entity';
import { Game } from '../game/entities/game.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
import { EventsService } from '../events/events.service';
import { VotingState } from '../common/enums/game.enums';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn((data) => data),
  increment: jest.fn(),
});

describe('VotingService', () => {
  let service: VotingService;
  let gameRepo: ReturnType<typeof mockRepo>;
  let questionRepo: ReturnType<typeof mockRepo>;
  let optionRepo: ReturnType<typeof mockRepo>;
  let voterRepo: ReturnType<typeof mockRepo>;
  let eventsService: { emit: jest.Mock };

  const mockReq = {
    ip: '192.168.1.100',
    headers: { 'user-agent': 'TestBrowser/1.0' },
    cookies: { voter_token: '550e8400-e29b-41d4-a716-446655440000' },
  } as any;

  beforeEach(async () => {
    eventsService = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VotingService,
        { provide: getRepositoryToken(Voter), useFactory: mockRepo },
        { provide: getRepositoryToken(Game), useFactory: mockRepo },
        { provide: getRepositoryToken(Question), useFactory: mockRepo },
        { provide: getRepositoryToken(Option), useFactory: mockRepo },
        { provide: EventsService, useValue: eventsService },
      ],
    }).compile();

    service = module.get<VotingService>(VotingService);
    gameRepo = module.get(getRepositoryToken(Game));
    questionRepo = module.get(getRepositoryToken(Question));
    optionRepo = module.get(getRepositoryToken(Option));
    voterRepo = module.get(getRepositoryToken(Voter));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('castVote()', () => {
    const dto = {
      gameId: 'g-uuid',
      questionId: 'q-uuid',
      optionIds: ['o-uuid'],
    };

    it('throws NotFoundException when game does not exist', async () => {
      gameRepo.findOne.mockResolvedValue(null);
      await expect(
        service.castVote(dto, 'token-uuid', mockReq),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when voting is not OPEN', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g-uuid',
        game_code: 'FEUD4X',
        voting_state: VotingState.CLOSED,
      });
      await expect(
        service.castVote(dto, 'token-uuid', mockReq),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments option votes and saves voter on valid cast', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g-uuid',
        game_code: 'FEUD4X',
        voting_state: VotingState.OPEN,
      });
      questionRepo.findOne.mockResolvedValue({ id: 'q-uuid' });
      // First find() call: option validation; second: totalVotes tally
      optionRepo.find
        .mockResolvedValueOnce([{ id: 'o-uuid' }])
        .mockResolvedValueOnce([{ votes: 6 }, { votes: 3 }]);
      optionRepo.increment.mockResolvedValue(undefined);
      voterRepo.create.mockReturnValue({ id: 'v-uuid' });
      voterRepo.save.mockResolvedValue({ id: 'v-uuid' });

      const result = await service.castVote(dto, '550e8400-e29b-41d4-a716-446655440000', mockReq);

      expect(optionRepo.increment).toHaveBeenCalledWith(
        { id: 'o-uuid', question_id: 'q-uuid' },
        'votes',
        1,
      );
      expect(voterRepo.save).toHaveBeenCalled();
      expect(result.message).toBe('Vote cast successfully');
    });

    it('increments votes for each option when multiple are selected', async () => {
      const multiDto = {
        gameId: 'g-uuid',
        questionId: 'q-uuid',
        optionIds: ['o-uuid-1', 'o-uuid-2', 'o-uuid-3'],
      };
      gameRepo.findOne.mockResolvedValue({
        id: 'g-uuid',
        game_code: 'FEUD4X',
        voting_state: VotingState.OPEN,
      });
      questionRepo.findOne.mockResolvedValue({ id: 'q-uuid' });
      optionRepo.find
        .mockResolvedValueOnce([
          { id: 'o-uuid-1' },
          { id: 'o-uuid-2' },
          { id: 'o-uuid-3' },
        ])
        .mockResolvedValueOnce([{ votes: 3 }, { votes: 2 }, { votes: 1 }]);
      optionRepo.increment.mockResolvedValue(undefined);
      voterRepo.create.mockReturnValue({ id: 'v-uuid' });
      voterRepo.save.mockResolvedValue({ id: 'v-uuid' });

      const result = await service.castVote(multiDto, '550e8400-e29b-41d4-a716-446655440000', mockReq);

      expect(optionRepo.increment).toHaveBeenCalledTimes(3);
      expect(optionRepo.increment).toHaveBeenCalledWith(
        { id: 'o-uuid-1', question_id: 'q-uuid' }, 'votes', 1,
      );
      expect(optionRepo.increment).toHaveBeenCalledWith(
        { id: 'o-uuid-2', question_id: 'q-uuid' }, 'votes', 1,
      );
      expect(optionRepo.increment).toHaveBeenCalledWith(
        { id: 'o-uuid-3', question_id: 'q-uuid' }, 'votes', 1,
      );
      expect(result.message).toBe('Vote cast successfully');
    });

    it('allows submitting a question with no selected options', async () => {
      const emptyDto = {
        gameId: 'g-uuid',
        questionId: 'q-uuid',
        optionIds: [],
      };
      gameRepo.findOne.mockResolvedValue({
        id: 'g-uuid',
        game_code: 'FEUD4X',
        voting_state: VotingState.OPEN,
      });
      questionRepo.findOne.mockResolvedValue({ id: 'q-uuid' });
      optionRepo.find.mockResolvedValueOnce([{ votes: 3 }, { votes: 2 }, { votes: 1 }]);
      voterRepo.create.mockReturnValue({ id: 'v-uuid' });
      voterRepo.save.mockResolvedValue({ id: 'v-uuid' });

      const result = await service.castVote(emptyDto, '550e8400-e29b-41d4-a716-446655440000', mockReq);

      expect(optionRepo.increment).not.toHaveBeenCalled();
      expect(voterRepo.save).toHaveBeenCalled();
      expect(result.message).toBe('Vote cast successfully');
    });

    it('throws NotFoundException when one of the option IDs is invalid', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g-uuid',
        game_code: 'FEUD4X',
        voting_state: VotingState.OPEN,
      });
      questionRepo.findOne.mockResolvedValue({ id: 'q-uuid' });
      // Only 1 matched out of 2 submitted
      optionRepo.find.mockResolvedValue([{ id: 'o-uuid' }]);

      await expect(
        service.castVote(
          { gameId: 'g-uuid', questionId: 'q-uuid', optionIds: ['o-uuid', 'bad-uuid'] },
          'token-uuid',
          mockReq,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('masks the last IPv4 octet before storing', () => {
      // Access the private method via casting for test purposes
      const masked = (service as any).maskIp('192.168.1.123');
      expect(masked).toBe('192.168.1.0');
    });
  });

  describe('getOrCreateVoterToken()', () => {
    it('returns existing valid UUID cookie', () => {
      const req = {
        cookies: { voter_token: '550e8400-e29b-41d4-a716-446655440000' },
      } as any;
      expect(service.getOrCreateVoterToken(req)).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    });

    it('generates a new UUID when no cookie present', () => {
      const req = { cookies: {} } as any;
      const token = service.getOrCreateVoterToken(req);
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
