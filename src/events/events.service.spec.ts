import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { GameEventType } from './dto/game-event.dto';

type GameStatePayload = {
  playState: 'IN_PROGRESS' | 'CLOSED';
  votingState: 'CLOSED';
};

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EventsService],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('delivers an emitted event to a subscribed game stream', (done) => {
    const gameCode = 'TEST01';
    const stream$ = service.getGameStream(gameCode);

    // Subscribe and expect the first non-heartbeat event
    const sub = stream$.subscribe((event) => {
      if (event.type === GameEventType.HEARTBEAT) return;

      expect(event.type).toBe(GameEventType.GAME_STATE);
      const data = event.data as { payload: GameStatePayload };
      expect(data.payload).toEqual({
        playState: 'IN_PROGRESS',
        votingState: 'CLOSED',
      });
      sub.unsubscribe();
      done();
    });

    service.emit(gameCode, GameEventType.GAME_STATE, {
      playState: 'IN_PROGRESS',
      votingState: 'CLOSED',
    });
  });

  it('does not deliver events from a different game code', (done) => {
    const stream$ = service.getGameStream('GAME01');
    let receivedCount = 0;

    const sub = stream$.subscribe((event) => {
      if (event.type !== GameEventType.HEARTBEAT) receivedCount++;
    });

    // Emit to a DIFFERENT game
    service.emit('GAME02', GameEventType.GAME_STATE, {
      playState: 'IN_PROGRESS',
      votingState: 'CLOSED',
    });

    // After a brief delay: no events should have been received for GAME01
    setTimeout(() => {
      expect(receivedCount).toBe(0);
      sub.unsubscribe();
      done();
    }, 50);
  });

  it('is case-insensitive for gameCode matching', (done) => {
    const stream$ = service.getGameStream('feud4x');

    const sub = stream$.subscribe((event) => {
      if (event.type === GameEventType.HEARTBEAT) return;
      expect(event.type).toBe(GameEventType.NEXT_QUESTION);
      sub.unsubscribe();
      done();
    });

    // Emit with uppercase — should still reach lowercase subscriber
    service.emit('FEUD4X', GameEventType.NEXT_QUESTION, {
      questionId: 'abc',
      questionText: 'Test?',
      totalOptions: 6,
      roundNumber: 1,
    });
  });
});
