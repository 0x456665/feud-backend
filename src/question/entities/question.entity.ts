import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Game } from '../../game/entities/game.entity';
import { Option } from './option.entity';
import { Gameplay } from '../../game/entities/gameplay.entity';

/**
 * Question — a single survey question belonging to a game.
 *
 * Questions are created by the admin either inline at game creation or
 * individually afterwards.  During the voting/survey phase, players cast votes
 * on the options.  When voting closes, `std_dev` is computed from the vote
 * distribution and `display_order` is assigned at game start (ascending
 * std_dev = most balanced question first).
 */
@Entity('questions')
@Index(['game_id'])
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  game_id!: string;

  /** The question text shown on the survey and game board. */
  @Column({ type: 'text' })
  question!: string;

  /**
   * Maximum number of options that will be revealed during gameplay.
   * Defaults to 6 (standard Family Feud board).
   */
  @Column({ type: 'int', default: 6 })
  number_of_options!: number;

  /**
   * Population standard deviation of vote counts across the top options.
   * Computed when voting closes; null until then.
   * Lower value = more evenly distributed votes = better Family Feud question.
   */
  @Column({ type: 'float', nullable: true, default: null })
  std_dev?: number | null;

  /**
   * 1-based order in which this question will be played.
   * Assigned at game start based on std_dev ranking; null until game starts.
   */
  @Column({ type: 'int', nullable: true, default: null })
  display_order?: number | null;

  @CreateDateColumn()
  created_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Game, (game) => game.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @OneToMany(() => Option, (opt) => opt.question, { cascade: true })
  options!: Option[];

  @OneToMany(() => Gameplay, (gp) => gp.question)
  gameplays!: Gameplay[];
}
