import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { QuestionService } from './question.service';
import { Question } from './entities/question.entity';
import { Option } from './entities/option.entity';
import { Game } from '../game/entities/game.entity';
import { PlayState } from '../common/enums/game.enums';

const mockRepo = <T>() => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest
    .fn<T, [unknown, T]>()
    .mockImplementation((_entity: unknown, data: T) => data),
});

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
        findOne: jest.Mock<Promise<unknown>, [unknown, unknown]>;
      }) => Promise<unknown>,
    ) =>
      cb({
        create: (_entity: unknown, data: Record<string, unknown>) => ({
          ...data,
        }),
        save: jest.fn((_: unknown, data: Record<string, unknown>) =>
          Promise.resolve({
            id: 'new-id',
            ...data,
          }),
        ),
        findOne: jest.fn(() =>
          Promise.resolve({
            id: 'new-id',
            options: [],
          }),
        ),
      }),
  ),
});

describe('QuestionService', () => {
  let service: QuestionService;
  let gameRepo: ReturnType<typeof mockRepo>;
  let questionRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionService,
        { provide: getRepositoryToken(Question), useFactory: mockRepo },
        { provide: getRepositoryToken(Option), useFactory: mockRepo },
        { provide: getRepositoryToken(Game), useFactory: mockRepo },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get<QuestionService>(QuestionService);
    gameRepo = module.get(getRepositoryToken(Game));
    questionRepo = module.get(getRepositoryToken(Question));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addQuestion()', () => {
    it('throws NotFoundException for unknown game', async () => {
      gameRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addQuestion('NOCODE', { question: 'Q?', options: ['A'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if game is IN_PROGRESS', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g1',
        play_state: PlayState.IN_PROGRESS,
      });
      await expect(
        service.addQuestion('FEUD4X', { question: 'Q?', options: ['A'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('adds a question and returns it with options', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g1',
        play_state: PlayState.LOBBY,
      });
      const result = await service.addQuestion('FEUD4X', {
        question: 'Name a fruit',
        options: ['Apple', 'Banana'],
      });
      expect(result).toBeDefined();
    });
  });

  describe('addOption()', () => {
    it('throws if question does not belong to game', async () => {
      gameRepo.findOne.mockResolvedValue({
        id: 'g1',
        play_state: PlayState.LOBBY,
      });
      questionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addOption('FEUD4X', 'q-uuid', { option_text: 'Mango' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
