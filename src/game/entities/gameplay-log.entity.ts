import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Game } from './game.entity';
import { Question } from '../../question/entities/question.entity';

/**
 * GameplayLog — a single mutable snapshot of the current game state.
 *
 * There is exactly ONE row per game.  It is upserted on every admin action
 * (advance question, reveal option, add score, etc.), providing a lightweight
 * reconnect snapshot for both the admin panel and player clients.
 *
 * The `state_snapshot` JSONB column stores any extra ad-hoc data the frontend
 * may need to fully reconstruct the board without replaying event history.
 */
@Entity('gameplay_logs')
@Index(['game_id'], { unique: true })
export class GameplayLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  game_id!: string;

  /** Current score for Team A. */
  @Column({ type: 'int', default: 0 })
  team_a_score!: number;

  /** Current score for Team B. */
  @Column({ type: 'int', default: 0 })
  team_b_score!: number;

  /** The question currently on the board (null between rounds or before start). */
  @Column({ type: 'uuid', nullable: true })
  current_question_id?: string | null;

  /**
   * Array of option IDs that have been revealed on the board so far
   * in the current round.  Reset when a new question starts.
   */
  @Column({ type: 'jsonb', default: [] })
  options_revealed!: string[];

  /**
   * Array of question IDs that have been fully completed (all rounds done
   * or buzzer-ended).  Used by the frontend to know which questions were played.
   */
  @Column({ type: 'jsonb', default: [] })
  questions_completed!: string[];

  /**
   * Number of wrong answers (strikes) for the current question.
   * Resets to 0 when advancing to a new question.
   */
  @Column({ type: 'int', default: 0 })
  current_strikes!: number;

  /**
   * Free-form JSONB for any additional state the frontend needs to fully
   * rebuild the board (e.g. which team is currently playing).
   */
  @Column({ type: 'jsonb', nullable: true })
  state_snapshot?: Record<string, unknown> | null;

  @UpdateDateColumn()
  updated_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Game, (game) => game.gameplay_logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @ManyToOne(() => Question, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_question_id' })
  current_question?: Question | null;
}
