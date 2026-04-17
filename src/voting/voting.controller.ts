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

/** How long the voter_token cookie lasts in milliseconds (24 hours). */
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * VotingController — player voting endpoints.
 *
 * GET  /games/:gameCode/questions  → Lists questions and options available to vote on
 * POST /games/:gameCode/vote       → Casts a vote; sets voter_token cookie if not present
 */
@Controller('games')
export class VotingController {
  constructor(private readonly votingService: VotingService) {}

  /**
   * Returns questions and their options available to vote on.
   * Only succeeds while voting_state is OPEN.
   * Response includes the gameId, questionId, and optionIds needed by POST /vote.
   */
  @Get(':gameCode/questions')
  async getQuestionsForVoting(@Param('gameCode') gameCode: string) {
    return this.votingService.getQuestionsForVoting(gameCode);
  }

  /**
   * Casts one or more question votes during the survey/voting phase.
   * Sets (or refreshes) the voter_token cookie so first-time voters
   * do not need to call /join beforehand.
   *
   * Guards applied (in order):
   *   1. VoterGuard   — auto-generates voter_token if absent; blocks duplicates
   *   2. Throttle     — max 1 request per 10 seconds per IP (via ThrottlerGuard)
   */
  @Post(':gameCode/vote')
  @UseGuards(VoterGuard)
  @Throttle({ default: { limit: 1, ttl: 10000 } })
  @HttpCode(HttpStatus.OK)
  async castVote(
    @Param('gameCode') gameCode: string,
    @Body() dto: CastVoteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken: string =
      (req.cookies?.voter_token as string | undefined) ??
      (req['generatedVoterToken'] as string);

    res.cookie('voter_token', cookieToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });

    return this.votingService.castVotes(gameCode, dto, cookieToken, req);
  }
}
