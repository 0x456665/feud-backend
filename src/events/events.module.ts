import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { Game } from '../game/entities/game.entity';

/**
 * EventsModule — wires up the SSE event bus and its HTTP controller.
 *
 * EventsService is exported so that other modules (GameModule, VotingModule)
 * can inject it and call emit() to push events to connected clients.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Game])],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
