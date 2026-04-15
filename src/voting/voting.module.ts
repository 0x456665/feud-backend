import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VotingService } from './voting.service';
import { VotingController } from './voting.controller';
import { Voter } from './entities/voter.entity';
import { Game } from '../game/entities/game.entity';
import { Question } from '../question/entities/question.entity';
import { Option } from '../question/entities/option.entity';
import { VoterGuard } from '../common/guards/voter.guard';
import { EventsModule } from '../events/events.module';

/**
 * VotingModule — player vote submission with cookie-based deduplication.
 *
 * Depends on EventsModule to emit vote_update SSE events to the admin
 * survey stats view in real-time.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Voter, Game, Question, Option]),
    EventsModule,
  ],
  providers: [VotingService, VoterGuard],
  controllers: [VotingController],
  exports: [VotingService],
})
export class VotingModule {}
