import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PlayersService } from './players.service';

/** How long the voter_token cookie lasts in milliseconds (24 hours). */
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * PlayersController — handles player join flow and session tracking.
 *
 * GET /games/:gameCode/join   → Log session, set/refresh voter_token cookie
 * GET /admin/games/:gameCode/players → Session count (admin only via AdminGuard in GameModule)
 */
@Controller()
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  /**
   * Player join endpoint.
   *
   * Sets the voter_token cookie (httpOnly, secure in prod) and logs the
   * player session.  If the player already has a valid cookie for this game
   * the session is not logged twice.
   *
   * The response returns only public game metadata — no secrets, no answers.
   */
  @Get('games/:gameCode/join')
  async joinGame(
    @Param('gameCode') gameCode: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Reuse existing voter_token if present; generate a new one via UUID otherwise
    let token: string | undefined;
    const cookieToken = (req.cookies as Record<string, unknown> | undefined)
      ?.voter_token;
    if (
      typeof cookieToken === 'string' &&
      /^[0-9a-f-]{36}$/i.test(cookieToken)
    ) {
      token = cookieToken;
    }
    if (!token) {
      const { randomUUID } = await import('crypto');
      token = randomUUID();
    }

    res.cookie('voter_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });

    await this.playersService.logSession(gameCode, token, req);

    return {
      message: 'Joined game successfully',
      game_code: gameCode.toUpperCase(),
    };
  }

  /**
   * Returns the count of distinct players that have joined this game.
   * Intended for the admin panel audience indicator.
   *
   * NOTE: does not require AdminGuard here because total viewer count is
   * considered public info.  Wrap with AdminGuard if you want it restricted.
   */
  @Get('games/:gameCode/players/count')
  async getPlayerCount(@Param('gameCode') gameCode: string) {
    return this.playersService.getSessionCount(gameCode);
  }
}
