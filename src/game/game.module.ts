import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GameService } from './game.service';
import { GameController } from './game.controller';
import { Game } from './entities/game.entity';
import { GameWin } from './entities/game-win.entity';
import { Gameplay } from './entities/gameplay.entity';
import { GameplayLog } from './entities/gameplay-log.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
import { Voter } from '../voting/entities/voter.entity';
import { AdminGuard } from '../common/guards/admin.guard';
import { EventsModule } from '../events/events.module';

/**
 * GameModule — manages the full game lifecycle:
 *   - Game creation (admin)
 *   - Voting state transitions
 *   - Live gameplay (next question, reveal, score, end)
 *   - Board snapshot (player reconnect)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GameWin,
      Gameplay,
      GameplayLog,
      Question,
      Option,
      Voter,
    ]),
    EventsModule,
  ],
  providers: [GameService, AdminGuard],
  controllers: [GameController],
  exports: [GameService],
})
export class GameModule {}
