import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QuestionService } from './question.service';
import { AdminGuard } from '../common/guards/admin.guard';
import {
  CreateQuestionDto,
  CreateOptionDto,
  BulkImportQuestionsDto,
  UpdateQuestionDto,
  UpdateOptionDto,
} from './dto/question.dto';

/**
 * QuestionController — admin endpoints for managing questions and options
 * on a game after it has been created.
 *
 * All routes require the X-Admin-Code header (enforced by AdminGuard).
 */
@Controller('admin/games/:gameCode')
@UseGuards(AdminGuard)
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

  /**
   * Lists all questions for the game, with options and vote stats.
   * Ordered by std_dev ascending once voting has closed.
   */
  @Get('questions')
  async listQuestions(@Param('gameCode') gameCode: string) {
    return this.questionService.listQuestions(gameCode);
  }

  /**
   * Adds a single question with its options to an existing game.
   * Only allowed before gameplay starts.
   */
  @Post('questions')
  @HttpCode(HttpStatus.CREATED)
  async addQuestion(
    @Param('gameCode') gameCode: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questionService.addQuestion(gameCode, dto);
  }

  /**
   * Bulk-imports multiple questions from a JSON body.
   * Useful for loading a pre-defined question bank.
   * All questions are inserted atomically — partial imports are prevented.
   */
  @Post('questions/import')
  @HttpCode(HttpStatus.CREATED)
  async bulkImport(
    @Param('gameCode') gameCode: string,
    @Body() dto: BulkImportQuestionsDto,
  ) {
    return this.questionService.bulkImport(gameCode, dto);
  }

  /**
   * Adds a single option to an existing question.
   * Validates that the question belongs to the specified game.
   */
  @Post('questions/:questionId/options')
  @HttpCode(HttpStatus.CREATED)
  async addOption(
    @Param('gameCode') gameCode: string,
    @Param('questionId') questionId: string,
    @Body() dto: CreateOptionDto,
  ) {
    return this.questionService.addOption(gameCode, questionId, dto);
  }

  @Patch('questions/:questionId')
  async updateQuestion(
    @Param('gameCode') gameCode: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questionService.updateQuestion(gameCode, questionId, dto);
  }

  @Patch('questions/:questionId/options/:optionId')
  async updateOption(
    @Param('gameCode') gameCode: string,
    @Param('questionId') questionId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateOptionDto,
  ) {
    return this.questionService.updateOption(
      gameCode,
      questionId,
      optionId,
      dto,
    );
  }
}
