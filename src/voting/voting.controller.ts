import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { VotingService } from './voting.service';
import { VoterGuard } from '../common/guards/voter.guard';
import { CastVoteDto } from './dto/cast-vote.dto';

/** How long the voter_token cookie lasts in seconds (24 hours). */
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * VotingController — handles player join and vote submission.
 *
 * GET  /games/:gameCode         → Sets voter_token cookie, returns game info
 * POST /games/:gameCode/vote    → Casts a vote (deduplicated by VoterGuard)
 */
@Controller('games')
export class VotingController {
  constructor(private readonly votingService: VotingService) {}

  /**
   * Player entry point: returns basic game info and sets the voter_token cookie.
   *
   * The cookie is:
   *   - httpOnly: not accessible via JS (XSS protection)
   *   - sameSite: 'lax' — allowed on same-origin navigations
   *   - secure: true in production (HTTPS-only transport)
   *
   * This endpoint is intentionally lightweight — it does not expose
   * any game secrets (admin code, answer rankings, etc.).
   */
  @Get(':gameCode/join')
  async joinGame(
    @Param('gameCode') gameCode: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.votingService.getOrCreateVoterToken(req);

    res.cookie('voter_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_SECONDS * 1000, // Express expects milliseconds
    });

    return {
      message: 'Joined game',
      game_code: gameCode.toUpperCase(),
    };
  }

  /**
   * Casts a vote for an option during the survey/voting phase.
   *
   * Guards applied (in order):
   *   1. VoterGuard   — verifies voter_token cookie is present and not already used
   *   2. Throttle     — max 1 request per 10 seconds per IP (via ThrottlerGuard)
   *
   * The voter_token cookie deduplicates votes per (game, question) pair.
   */
  @Post(':gameCode/vote')
  @UseGuards(VoterGuard)
  @Throttle({ default: { limit: 1, ttl: 10000 } })
  @HttpCode(HttpStatus.OK)
  async castVote(
    @Body() dto: CastVoteDto,
    @Req() req: Request,
  ) {
    const cookieToken: string = req.cookies?.voter_token;
    return this.votingService.castVote(dto, cookieToken, req);
  }
}
