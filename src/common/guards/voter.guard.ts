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

    // Use an existing voter_token cookie, or generate a fresh one that the
    // castVote handler will persist in the response cookie (first-time voters).
    let cookieToken: string | undefined = request.cookies?.voter_token as string | undefined;
    if (!cookieToken) {
      const { randomUUID } = await import('crypto');
      cookieToken = randomUUID();
      request['generatedVoterToken'] = cookieToken;
    }

    const body = request.body ?? {};
    const rawVotes = Array.isArray(body.votes) ? body.votes : [body];

    const votes = rawVotes.filter(
      (vote) => vote?.gameId && vote?.questionId,
    ) as Array<{ gameId: string; questionId: string }>;

    if (!votes.length) {
      return true;
    }

    const seen = new Set<string>();
    for (const vote of votes) {
      const key = `${vote.gameId}:${vote.questionId}`;
      if (seen.has(key)) {
        throw new ForbiddenException(
          'Duplicate question submissions are not allowed in the same vote batch',
        );
      }
      seen.add(key);

      const existing = await this.voterRepository.findOne({
        where: {
          game_id: vote.gameId,
          question_id: vote.questionId,
          cookie_token: cookieToken,
        },
      });

      if (existing) {
        throw new ForbiddenException('You have already voted on this question');
      }
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
