import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { Question } from './entities/question.entity';
import { Option } from './entities/option.entity';
import { Game } from '../game/entities/game.entity';
import { PlayState } from '../common/enums/game.enums';
import {
  CreateQuestionDto,
  CreateOptionDto,
  BulkImportQuestionsDto,
  UpdateOptionDto,
  UpdateQuestionDto,
} from './dto/question.dto';

@Injectable()
export class QuestionService {
  private readonly logger = new Logger(QuestionService.name);

  constructor(
    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,

    @InjectRepository(Option)
    private readonly optionRepo: Repository<Option>,

    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,

    private readonly dataSource: DataSource,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Fetches the game by code and asserts it hasn't started yet.
   * Questions and options should only be created/modified before gameplay begins.
   */
  private async getEditableGame(gameCode: string): Promise<Game> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);
    if (
      game.play_state === PlayState.IN_PROGRESS ||
      game.play_state === PlayState.FINISHED
    ) {
      throw new BadRequestException(
        'Questions cannot be modified once the game has started',
      );
    }
    return game;
  }

  // ── Add Single Question ───────────────────────────────────────────────────

  /**
   * Adds a single question + its options to an existing game.
   * Transaction-wrapped to keep the question and options in sync.
   */
  async addQuestion(
    gameCode: string,
    dto: CreateQuestionDto,
  ): Promise<Question> {
    const game = await this.getEditableGame(gameCode);

    return this.dataSource.transaction(async (manager) => {
      const question = manager.create(Question, {
        game_id: game.id,
        question: dto.question,
        number_of_options: dto.number_of_options ?? 6,
      });
      const savedQuestion = await manager.save(Question, question);

      const options = dto.options.map((text) =>
        manager.create(Option, {
          question_id: savedQuestion.id,
          option_text: text,
          votes: 0,
        }),
      );
      await manager.save(Option, options);

      // Return with options populated
      return manager.findOne(Question, {
        where: { id: savedQuestion.id },
        relations: ['options'],
      }) as Promise<Question>;
    });
  }

  // ── Bulk Import ───────────────────────────────────────────────────────────

  /**
   * Bulk-imports questions and options from a JSON payload.
   * All questions are inserted in a single transaction — if any fail, all roll back.
   * The admin can provide a larger question pool than num_rounds; the best
   * questions by std_dev are selected at game start automatically.
   */
  async bulkImport(
    gameCode: string,
    dto: BulkImportQuestionsDto,
  ): Promise<{ imported: number }> {
    const game = await this.getEditableGame(gameCode);

    await this.dataSource.transaction(async (manager) => {
      for (const qDto of dto.questions) {
        const question = manager.create(Question, {
          game_id: game.id,
          question: qDto.question,
          number_of_options: qDto.number_of_options ?? 6,
        });
        const savedQuestion = await manager.save(Question, question);

        const options = qDto.options.map((text) =>
          manager.create(Option, {
            question_id: savedQuestion.id,
            option_text: text,
            votes: 0,
          }),
        );
        await manager.save(Option, options);
      }
    });

    this.logger.log(
      `Imported ${dto.questions.length} question(s) to game ${gameCode}`,
    );
    return { imported: dto.questions.length };
  }

  // ── Add Option ────────────────────────────────────────────────────────────

  /**
   * Adds a single option to an existing question.
   * The question must belong to the game identified by gameCode (enforced
   * via the JOIN to prevent cross-game option injection).
   */
  async addOption(
    gameCode: string,
    questionId: string,
    dto: CreateOptionDto,
  ): Promise<Option> {
    const game = await this.getEditableGame(gameCode);

    const question = await this.questionRepo.findOne({
      where: { id: questionId, game_id: game.id },
    });
    if (!question) {
      throw new NotFoundException(
        `Question "${questionId}" not found in game "${gameCode}"`,
      );
    }

    const option = this.optionRepo.create({
      question_id: question.id,
      option_text: dto.option_text,
      votes: 0,
    });
    return this.optionRepo.save(option);
  }

  async updateQuestion(
    gameCode: string,
    questionId: string,
    dto: UpdateQuestionDto,
  ): Promise<Question> {
    const game = await this.getEditableGame(gameCode);

    const question = await this.questionRepo.findOne({
      where: { id: questionId, game_id: game.id },
    });
    if (!question) {
      throw new NotFoundException(
        `Question "${questionId}" not found in game "${gameCode}"`,
      );
    }

    if (dto.question !== undefined) {
      question.question = dto.question;
    }
    if (dto.number_of_options !== undefined) {
      question.number_of_options = dto.number_of_options;
    }

    return this.questionRepo.save(question);
  }

  async updateOption(
    gameCode: string,
    questionId: string,
    optionId: string,
    dto: UpdateOptionDto,
  ): Promise<Option> {
    const game = await this.getEditableGame(gameCode);

    const question = await this.questionRepo.findOne({
      where: { id: questionId, game_id: game.id },
    });
    if (!question) {
      throw new NotFoundException(
        `Question "${questionId}" not found in game "${gameCode}"`,
      );
    }

    const option = await this.optionRepo.findOne({
      where: { id: optionId, question_id: question.id },
    });
    if (!option) {
      throw new NotFoundException(
        `Option "${optionId}" not found for question "${questionId}"`,
      );
    }

    option.option_text = dto.option_text;
    return this.optionRepo.save(option);
  }

  // ── List Questions ────────────────────────────────────────────────────────────────

  /**
   * Lists all questions for a game with their options and vote/rank stats.
   * Sorted by std_dev ascending (null std_devs — unprocessed questions — last).
   */
  async listQuestions(gameCode: string): Promise<Question[]> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      select: ['id'],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    return this.questionRepo.find({
      where: { game_id: game.id },
      relations: ['options'],
      order: { std_dev: 'ASC', created_at: 'ASC' },
    });
  }
}
