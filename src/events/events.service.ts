import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject, Observable, interval } from 'rxjs';
import { filter, share, takeUntil, map } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';
import { GameEventType, GameEventPayload } from './dto/game-event.dto';

/**
 * Internal representation of a game event on the bus.
 */
interface BusEvent {
  gameCode: string;
  type: GameEventType;
  payload: GameEventPayload;
}

/**
 * EventsService — the Server-Sent Events (SSE) backbone of the game.
 *
 * Architecture:
 *   - A single RxJS Subject<BusEvent> acts as the global event bus.
 *   - Each SSE client subscribes to a filtered observable scoped to one gameCode.
 *   - Admin actions call `emit()` to push events onto the bus.
 *   - A 30-second heartbeat prevents proxy/load-balancer connection timeouts.
 *
 * Why SSE over WebSockets?
 *   - All real-time communication is server → client (admin triggers via REST).
 *   - SSE is simpler, HTTP/2 native, and reconnects automatically on the client.
 *   - No need for a full duplex channel from the player clients.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);

  /** Global event bus shared across all game rooms. */
  private readonly bus$ = new Subject<BusEvent>();

  /** Emits every 30 seconds to keep SSE connections alive through proxies. */
  private readonly heartbeat$ = interval(30_000);

  /** Completes all streams on module shutdown — prevents memory leaks. */
  private readonly destroy$ = new Subject<void>();

  /**
   * Emits a typed event to all SSE clients subscribed to the given game.
   *
   * @param gameCode  The 6-char game join code (used to scope the event)
   * @param type      The event type constant from GameEventType
   * @param payload   Strongly-typed payload object
   */
  emit(gameCode: string, type: GameEventType, payload: GameEventPayload): void {
    this.logger.debug(`Emitting [${type}] to game ${gameCode}`);
    this.bus$.next({ gameCode: gameCode.toUpperCase(), type, payload });
  }

  /**
   * Returns an Observable<MessageEvent> scoped to a single game code.
   * Pass this directly to an @Sse() controller method.
   *
   * The observable:
   *   1. Filters bus events by gameCode.
   *   2. Maps them to the SSE MessageEvent shape { data, type, id }.
   *   3. Merges in a 30s heartbeat comment to prevent connection drops.
   *   4. Completes when the module is destroyed.
   */
  getGameStream(gameCode: string): Observable<MessageEvent> {
    const upperCode = gameCode.toUpperCase();

    // Game-scoped event stream
    const events$: Observable<MessageEvent> = this.bus$.pipe(
      filter((e) => e.gameCode === upperCode),
      map(
        (e): MessageEvent => ({
          data: { type: e.type, payload: e.payload },
          type: e.type,
          id: String(Date.now()),
        }),
      ),
    );

    // Heartbeat to prevent nginx/ALB/Cloudflare proxy timeouts (60s default)
    const heartbeat$: Observable<MessageEvent> = this.heartbeat$.pipe(
      takeUntil(this.destroy$),
      map(
        (): MessageEvent => ({
          data: { type: GameEventType.HEARTBEAT },
          type: GameEventType.HEARTBEAT,
          id: String(Date.now()),
        }),
      ),
    );

    // Merge game events with heartbeats; share() avoids duplicate subscriptions
    return new Observable<MessageEvent>((subscriber) => {
      const eventSub = events$.subscribe(subscriber);
      const heartbeatSub = heartbeat$.subscribe((hb) => subscriber.next(hb));

      return () => {
        eventSub.unsubscribe();
        heartbeatSub.unsubscribe();
        this.logger.debug(`SSE client disconnected from game ${upperCode}`);
      };
    }).pipe(share(), takeUntil(this.destroy$));
  }

  onModuleDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.bus$.complete();
  }
}
