import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { VotingState, PlayState } from '../../common/enums/game.enums';
import { Question } from '../../question/entities/question.entity';
import { Gameplay } from './gameplay.entity';
import { GameplayLog } from './gameplay-log.entity';
import { GameWin } from './game-win.entity';

/**
 * Game — the root aggregate for a single Family Feud session.
 *
 * A game is created by an admin who receives a unique `game_code` (for players
 * to join) and an `admin_code` (to authenticate admin API calls).  The raw
 * admin code is NEVER stored here — only its bcrypt hash.
 *
 * Lifecycle:
 *   1. Admin creates game (LOBBY + OPEN voting).
 *   2. Players vote during the survey phase.
 *   3. Admin closes voting → std_dev computed, options ranked.
 *   4. Admin starts game → IN_PROGRESS, questions ordered by std_dev.
 *   5. Admin runs rounds, triggering SSE events.
 *   6. Admin ends game → FINISHED, GameWin created.
 */
@Entity('games')
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable name shown on the game board (e.g. "Family Night 2026"). */
  @Column({ type: 'varchar', length: 100 })
  game_name!: string;

  /**
   * 6-character uppercase join code shared with players (e.g. "FEUD4X").
   * Uniqueness is enforced at DB level.  Generated via generateGameCode().
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 6 })
  game_code!: string;

  /**
   * bcrypt hash of the 16-char admin access code.
   * The raw code is returned ONCE on game creation and must be saved by the admin.
   * NOT selected by default to avoid accidental exposure in API responses.
   */
  @Column({ type: 'varchar', select: false })
  admin_code!: string;

  /** Customisable name for Team A (defaults to "Team A"). */
  @Column({ type: 'varchar', length: 50, default: 'Team A' })
  team_a_name!: string;

  /** Customisable name for Team B (defaults to "Team B"). */
  @Column({ type: 'varchar', length: 50, default: 'Team B' })
  team_b_name!: string;

  /**
   * How many questions (rounds) will be played.
   * At game start the top `num_rounds` questions sorted by std_dev asc are selected.
   */
  @Column({ type: 'int' })
  num_rounds!: number;

  /** Controls whether players can currently cast survey votes. */
  @Column({
    type: 'enum',
    enum: VotingState,
    default: VotingState.OPEN,
  })
  voting_state!: VotingState;

  /** Controls the live gameplay phase. */
  @Column({
    type: 'enum',
    enum: PlayState,
    default: PlayState.LOBBY,
  })
  play_state!: PlayState;

  @CreateDateColumn()
  created_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToMany(() => Question, (q) => q.game, { cascade: true })
  questions!: Question[];

  @OneToMany(() => Gameplay, (gp) => gp.game, { cascade: true })
  gameplays!: Gameplay[];

  @OneToMany(() => GameplayLog, (log) => log.game, { cascade: true })
  gameplay_logs!: GameplayLog[];

  @OneToMany(() => GameWin, (gw) => gw.game, { cascade: true })
  game_wins!: GameWin[];
}
