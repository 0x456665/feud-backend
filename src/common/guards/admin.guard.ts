import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { Game } from '../../game/entities/game.entity';

/**
 * AdminGuard — protects admin-only routes.
 *
 * Reads the raw admin code from the `X-Admin-Code` request header, fetches
 * the corresponding game by its URL param `gameCode`, and bcrypt-compares the
 * provided value against the stored hash.
 *
 * SECURITY NOTE: The raw admin code is NEVER stored in the database — only its
 * bcrypt hash.  Timing-safe comparison is handled by bcrypt.compare.
 *
 * Usage: Apply @UseGuards(AdminGuard) to any admin controller route.
 * Routes that create a game are excluded (no game exists yet at that point).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract the admin code from the custom header
    const rawCode = request.headers['x-admin-code'];
    if (!rawCode || typeof rawCode !== 'string' || rawCode.trim() === '') {
      throw new UnauthorizedException('Missing X-Admin-Code header');
    }

    // Resolve the game code from the route param
    const gameCode = (request.params as Record<string, string>)['gameCode'];
    if (!gameCode) {
      throw new UnauthorizedException('Game code not found in route params');
    }

    const game = await this.gameRepository.findOne({
      where: { game_code: gameCode.toUpperCase() },
      // Only fetch the admin_code hash — nothing else needed here
      select: ['id', 'admin_code'],
    });

    if (!game) {
      throw new UnauthorizedException('Game not found');
    }

    // bcrypt.compare is timing-safe and handles all edge cases
    const isValid = await bcrypt.compare(rawCode.trim(), game.admin_code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid admin code');
    }

    return true;
  }
}
