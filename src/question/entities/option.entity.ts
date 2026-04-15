import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Question } from './question.entity';

/**
 * Option — a single answer choice for a survey question.
 *
 * Created at game creation time (or via the add-option endpoint) as plain
 * text strings.  `votes`, `rank`, and `points` are all null/0 until the
 * voting/survey phase produces data.
 *
 * After voting closes:
 *   - `votes`  reflects the total times this option was selected
 *   - `rank`   is the position by votes (1 = most-voted)
 *   - `points` = round((votes / total_votes_for_question) * 100)
 */
@Entity('options')
@Index(['question_id'])
export class Option {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  question_id!: string;

  /** The text of this answer option as displayed on the game board. */
  @Column({ type: 'varchar', length: 200 })
  option_text!: string;

  /** Number of survey votes cast for this option. */
  @Column({ type: 'int', default: 0 })
  votes!: number;

  /**
   * Rank amongst sibling options (1 = most votes).
   * Null until voting closes and rankings are computed.
   */
  @Column({ type: 'int', nullable: true, default: null })
  rank?: number | null;

  /**
   * Point value: round((votes / total_votes) * 100).
   * Null until voting closes.  This is the score shown on the board when
   * the admin reveals this option during gameplay.
   */
  @Column({ type: 'int', nullable: true, default: null })
  points?: number | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Question, (q) => q.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question!: Question;
}
