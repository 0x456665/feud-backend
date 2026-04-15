import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { PlayerSession } from './entities/player-session.entity';
import { Game } from '../game/entities/game.entity';

/**
 * PlayersModule — tracks player joins and session counts.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlayerSession, Game])],
  providers: [PlayersService],
  controllers: [PlayersController],
  exports: [PlayersService],
})
export class PlayersModule {}
