import 'dotenv/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { GameModule } from './game/game.module';
import { QuestionModule } from './question/question.module';
import { VotingModule } from './voting/voting.module';
import { PlayersModule } from './players/players.module';
import { EventsModule } from './events/events.module';
import { AppController } from './app.controller';

/**
 * AppModule — root module that wires together all feature modules.
 *
 * Database: TypeORM with PostgreSQL — auto-loads all *.entity files.
 *           synchronize is ONLY enabled via env var (dev only).
 *           migrationsRun ensures pending migrations run at startup.
 *
 * Rate limiting: ThrottlerModule applied globally (300 req / 60s default).
 *                Individual routes can override with @Throttle().
 *
 * Events: EventEmitterModule for in-process domain events between modules.
 */
@Module({
  imports: [
    // ── Database (PostgreSQL + TypeORM) ──────────────────────────────────────
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      ssl: process.env.DB_SSL === 'true',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // Auto-discovers all entity files — no manual entity list needed
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      autoLoadEntities: true,
      // Only synchronize schema in development (TYPEORM_SYNC=true in .env)
      // In production use migrations exclusively
      synchronize: process.env.TYPEORM_SYNC === 'true',
      migrationsRun: process.env.NODE_ENV === 'production',
      migrations: [__dirname + '/../migrations/**/*{.ts,.js}'],
    }),

    // ── Global Rate Limiting (OWASP A05) ─────────────────────────────────────
    // Default: 300 requests per 60 seconds per IP across all routes.
    // Voting endpoint overrides this to 1 per 10s via @Throttle() decorator.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
      },
    ]),

    // ── In-Process Event Bus ──────────────────────────────────────────────────
    // Used to decouple service-to-service communication within the app.
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: process.env.NODE_ENV !== 'production',
    }),

    // ── Feature Modules ───────────────────────────────────────────────────────
    EventsModule,
    GameModule,
    QuestionModule,
    VotingModule,
    PlayersModule,
  ],
  providers: [
    // Apply ThrottlerGuard globally so ALL routes are rate-limited by default
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  controllers: [AppController],
})
export class AppModule {}
