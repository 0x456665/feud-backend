import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Request } from 'express';
import { Voter } from '../../voting/entities/voter.entity';

/**
 * VoterGuard — prevents duplicate votes per player per question.
 *
 * A vote is considered a duplicate when the SAME cookie token has already
 * voted on the same question within the same game.  As a secondary check,
 * the device fingerprint (SHA-256 of IP + User-Agent) is also stored for
 * analytics and rate-limit correlation, but the cookie is the authoritative
 * dedup key.
 *
 * A voter_token cookie is set when the player joins via GET /games/:gameCode.
 * Without that cookie this guard blocks the vote.
 */
@Injectable()
export class VoterGuard implements CanActivate {
  constructor(
    @InjectRepository(Voter)
    private readonly voterRepository: Repository<Voter>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // The cookie is set server-side when the player joins the game
    const cookieToken: string | undefined = request.cookies?.voter_token;
    if (!cookieToken) {
      throw new ForbiddenException(
        'You must join the game before voting (missing voter_token cookie)',
      );
    }

    const { gameId, questionId } = request.body as {
      gameId?: string;
      questionId?: string;
    };

    if (!gameId || !questionId) {
      // Body validation will catch this — guard just needs the ids present
      return true;
    }

    // Check for an existing vote with this cookie for the same question
    const existing = await this.voterRepository.findOne({
      where: {
        game_id: gameId,
        question_id: questionId,
        cookie_token: cookieToken,
      },
    });

    if (existing) {
      throw new ForbiddenException(
        'You have already voted on this question',
      );
    }

    return true;
  }
}

/**
 * Utility: derives a device fingerprint from IP address and User-Agent.
 * Stored alongside the cookie token for analytics; NOT used as the sole
 * dedup key since IPs and UAs can be shared (NAT, proxies).
 */
export function buildDeviceFingerprint(
  ip: string | undefined,
  userAgent: string | undefined,
): string {
  return createHash('sha256')
    .update(`${ip ?? ''}:${userAgent ?? ''}`)
    .digest('hex');
}
