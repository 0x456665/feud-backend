import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { Question } from './entities/question.entity';
import { Option } from './entities/option.entity';
import { Game } from '../game/entities/game.entity';
import { AdminGuard } from '../common/guards/admin.guard';

/**
 * QuestionModule — manages question and option CRUD for a game.
 *
 * Game entity is imported here because AdminGuard needs it to verify
 * the admin code, and QuestionService needs it to validate the game state.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Question, Option, Game])],
  providers: [QuestionService, AdminGuard],
  controllers: [QuestionController],
  exports: [QuestionService],
})
export class QuestionModule {}
