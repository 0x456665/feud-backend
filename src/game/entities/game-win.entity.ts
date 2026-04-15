import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TeamSide } from '../../common/enums/game.enums';
import { Game } from './game.entity';

/**
 * GameWin — the final result record for a completed game.
 *
 * Created exactly once when the admin calls POST end-game.
 * There should be at most one GameWin per game (enforced by the unique index).
 */
@Entity('game_wins')
@Index(['game_id'], { unique: true })
export class GameWin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  game_id!: string;

  /** The team that won the overall game. */
  @Column({ type: 'enum', enum: TeamSide })
  winning_team!: TeamSide;

  /** Accumulated score for Team A across all rounds. */
  @Column({ type: 'int', default: 0 })
  team_a_total!: number;

  /** Accumulated score for Team B across all rounds. */
  @Column({ type: 'int', default: 0 })
  team_b_total!: number;

  @CreateDateColumn()
  created_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Game, (game) => game.game_wins, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;
}
