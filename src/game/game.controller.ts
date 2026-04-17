import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { GameService, BoardSnapshot } from './game.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateVotingStateDto } from './dto/update-voting-state.dto';
import {
  AddScoreDto,
  RevealOptionDto,
  WrongAnswerDto,
} from './dto/gameplay.dto';

/**
 * GameController — handles all game lifecycle endpoints.
 *
 * Two route groups:
 *   /admin/games/...  — admin-only, protected by AdminGuard
 *   /games/...        — public (players), cookie-based identity only
 */
@Controller()
export class GameController {
  constructor(private readonly gameService: GameService) {}

  // ── Admin: Game Management ────────────────────────────────────────────────

  /**
   * Creates a new game with questions + options inline.
   * Returns the raw admin_code ONCE — it is never retrievable again.
   *
   * No AdminGuard here — the game doesn't exist yet so there's no code to verify.
   */
  @Post('admin/games')
  @HttpCode(HttpStatus.CREATED)
  async createGame(@Body() dto: CreateGameDto) {
    const { game, rawAdminCode } = await this.gameService.createGame(dto);
    return {
      message:
        'Game created. Save the admin_code — it will not be shown again.',
      game_code: game.game_code,
      admin_code: rawAdminCode,
      game_id: game.id,
      team_a_name: game.team_a_name,
      team_b_name: game.team_b_name,
      num_rounds: game.num_rounds,
    };
  }

  /**
   * Retrieves full game details including questions and their options.
   * Protected by AdminGuard (X-Admin-Code header required).
   */
  @Get('admin/games/:gameCode')
  @UseGuards(AdminGuard)
  async getGame(@Param('gameCode') gameCode: string) {
    return this.gameService.getGame(gameCode);
  }

  /**
   * Returns survey/voting statistics for all questions:
   * vote counts per option, std_dev, and ranked order.
   */
  @Get('admin/games/:gameCode/survey-stats')
  @UseGuards(AdminGuard)
  async getSurveyStats(@Param('gameCode') gameCode: string) {
    return this.gameService.getSurveyStats(gameCode);
  }

  /**
   * Returns the number of unique voters that submitted at least one answer.
   */
  @Get('admin/games/:gameCode/survey-voters')
  @UseGuards(AdminGuard)
  async getSurveyVoterCount(@Param('gameCode') gameCode: string) {
    return this.gameService.getSurveyVoterCount(gameCode);
  }

  /**
   * Opens, pauses, or closes the voting/survey phase.
   * Closing automatically computes std_dev and option points.
   */
  @Patch('admin/games/:gameCode/voting')
  @UseGuards(AdminGuard)
  async updateVotingState(
    @Param('gameCode') gameCode: string,
    @Body() dto: UpdateVotingStateDto,
  ) {
    return this.gameService.updateVotingState(gameCode, dto);
  }

  /**
   * Starts the live game: transitions LOBBY → IN_PROGRESS and assigns
   * display_order to the top num_rounds questions by std_dev.
   */
  @Post('admin/games/:gameCode/start')
  @UseGuards(AdminGuard)
  async startGame(@Param('gameCode') gameCode: string) {
    return this.gameService.startGame(gameCode);
  }

  // ── Admin: Live Gameplay ──────────────────────────────────────────────────

  /**
   * Advances to the next question on the board.
   * Emits `next_question` SSE event to all connected clients.
   */
  @Post('admin/games/:gameCode/next-question')
  @UseGuards(AdminGuard)
  async nextQuestion(@Param('gameCode') gameCode: string) {
    return this.gameService.nextQuestion(gameCode);
  }

  /**
   * Reveals a specific answer option on the board.
   * Emits `reveal_option` SSE event.
   */
  @Post('admin/games/:gameCode/reveal-option')
  @UseGuards(AdminGuard)
  async revealOption(
    @Param('gameCode') gameCode: string,
    @Body() dto: RevealOptionDto,
  ) {
    return this.gameService.revealOption(gameCode, dto);
  }

  /**
   * Triggers the wrong-answer buzzer for a team.
   * Emits `wrong_option` SSE event with the incremented strike count.
   */
  @Post('admin/games/:gameCode/wrong-answer')
  @UseGuards(AdminGuard)
  async wrongAnswer(
    @Param('gameCode') gameCode: string,
    @Body() dto: WrongAnswerDto,
  ) {
    return this.gameService.wrongAnswer(gameCode, dto);
  }

  /**
   * Manually adds points to a team (completed round or steal).
   * Emits `add_score` SSE event.
   */
  @Post('admin/games/:gameCode/add-score')
  @UseGuards(AdminGuard)
  async addScore(
    @Param('gameCode') gameCode: string,
    @Body() dto: AddScoreDto,
  ) {
    return this.gameService.addScore(gameCode, dto);
  }

  /**
   * Ends the game, declares a winner, and emits:
   *   1. `play_winner_sound` — clients play the win fanfare
   *   2. `end_game`          — clients show the final scoreboard
   */
  @Post('admin/games/:gameCode/end-game')
  @UseGuards(AdminGuard)
  async endGame(@Param('gameCode') gameCode: string) {
    return this.gameService.endGame(gameCode);
  }

  /**
   * Returns the current gameplay log snapshot for admin panel reconnect.
   * Protected: only the admin should need to view the unfiltered log.
   */
  @Get('admin/games/:gameCode/log')
  @UseGuards(AdminGuard)
  async getLog(@Param('gameCode') gameCode: string): Promise<BoardSnapshot> {
    return this.gameService.getBoardSnapshot(gameCode);
  }

  // ── Public (Player): Board Snapshot ──────────────────────────────────────

  /**
   * Returns the current board snapshot for a player client.
   * Used after a reconnection to rebuild the current game state
   * without replaying the full SSE event history.
   */
  @Get('games/:gameCode/board')
  async getBoardSnapshot(@Param('gameCode') gameCode: string): Promise<BoardSnapshot> {
    return this.gameService.getBoardSnapshot(gameCode);
  }
}
