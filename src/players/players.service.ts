import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';

import { PlayerSession } from './entities/player-session.entity';
import { Game } from '../game/entities/game.entity';
import { buildDeviceFingerprint } from '../common/guards/voter.guard';

@Injectable()
export class PlayersService {
  private readonly logger = new Logger(PlayersService.name);

  constructor(
    @InjectRepository(PlayerSession)
    private readonly sessionRepo: Repository<PlayerSession>,

    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,
  ) {}

  /**
   * Logs a player session when they join a game.
   *
   * Deduplication: if a row already exists with the same game_id + cookie_token
   * we skip the insert — this prevents duplicate session rows on page refresh.
   *
   * @param gameCode   The game being joined
   * @param cookieToken The voter_token cookie UUID
   * @param req        Express request (for IP + User-Agent)
   * @returns The existing or newly created PlayerSession
   */
  async logSession(
    gameCode: string,
    cookieToken: string | undefined,
    req: Request,
  ): Promise<PlayerSession> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      select: [
        'id',
        'game_code',
        'game_name',
        'team_a_name',
        'team_b_name',
        'play_state',
        'voting_state',
      ],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    const ip = req.ip ?? '';
    const ua = (req.headers['user-agent'] ?? '').substring(0, 500);
    const fingerprint = buildDeviceFingerprint(ip, ua);

    // Skip if already logged (page refresh / reconnect)
    if (cookieToken) {
      const existing = await this.sessionRepo.findOne({
        where: { game_id: game.id, cookie_token: cookieToken },
      });
      if (existing) return existing;
    }

    const session = this.sessionRepo.create({
      game_id: game.id,
      device_fingerprint: fingerprint,
      ip_address: this.maskIp(ip),
      user_agent: ua,
      cookie_token: cookieToken ?? null,
    });

    await this.sessionRepo.save(session);
    this.logger.debug(`Player session logged for game ${gameCode}`);
    return session;
  }

  /**
   * Returns the number of unique players (by distinct cookie_token) that have
   * joined a given game.  Useful for the admin panel audience count.
   */
  async getSessionCount(gameCode: string): Promise<{ count: number }> {
    const game = await this.gameRepo.findOne({
      where: { game_code: gameCode.toUpperCase() },
      select: ['id'],
    });
    if (!game) throw new NotFoundException(`Game "${gameCode}" not found`);

    const count = await this.sessionRepo
      .createQueryBuilder('session')
      .where('session.game_id = :gameId', { gameId: game.id })
      .andWhere('session.cookie_token IS NOT NULL')
      .select('COUNT(DISTINCT session.cookie_token)', 'count')
      .getRawOne<{ count: string }>();

    return { count: parseInt(count?.count ?? '0', 10) };
  }

  /** Masks the last IPv4 octet for GDPR compliance before storing. */
  private maskIp(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
    return ip;
  }
}
