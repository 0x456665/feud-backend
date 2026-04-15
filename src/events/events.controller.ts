import {
  Controller,
  Param,
  Sse,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventsService } from './events.service';
import { Game } from '../game/entities/game.entity';
import { PlayState } from '../common/enums/game.enums';

/**
 * EventsController — provides the SSE endpoint that player (and admin) clients
 * subscribe to for real-time game events.
 *
 * Clients connect via:
 *   GET /api/v1/events/:gameCode
 *
 * The response is a text/event-stream (SSE) that pushes events whenever
 * an admin triggers an action (next question, reveal option, etc.).
 *
 * NOTE: SSE connections are long-lived.  A reverse proxy (nginx, Cloudflare)
 * must have buffering disabled (`proxy_buffering off`) for events to stream.
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
  ) {}

  /**
   * SSE stream for a specific game.
   *
   * Before opening the stream we verify the game exists and is not finished —
   * this prevents wasted connections to stale/invalid game codes.
   *
   * @param gameCode 6-character game join code
   */
  @Sse(':gameCode')
  async streamGameEvents(
    @Param('gameCode') gameCode: string,
  ): Promise<Observable<MessageEvent>> {
    const upperCode = gameCode.toUpperCase();

    const game = await this.gameRepository.findOne({
      where: { game_code: upperCode },
      select: ['id', 'play_state'],
    });

    if (!game) {
      throw new NotFoundException(`Game with code "${upperCode}" not found`);
    }

    if (game.play_state === PlayState.FINISHED) {
      throw new NotFoundException(`Game "${upperCode}" has already finished`);
    }

    return this.eventsService.getGameStream(upperCode);
  }
}
