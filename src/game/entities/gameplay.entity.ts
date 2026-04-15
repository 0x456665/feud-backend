import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TeamSide } from '../../common/enums/game.enums';
import { Game } from './game.entity';
import { Question } from '../../question/entities/question.entity';

/**
 * Gameplay — records the result of a single played question (round).
 *
 * Created when the admin completes a round (via POST end-game or implicitly
 * when advancing to the next question with a winning team assignment).
 * Provides a per-round audit trail used to compute final scores.
 */
@Entity('gameplays')
@Index(['game_id'])
export class Gameplay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  game_id!: string;

  @Column({ type: 'uuid' })
  question_id!: string;

  /**
   * Which team won this round. NONE if the question was stolen or buzzer-only.
   */
  @Column({
    type: 'enum',
    enum: TeamSide,
    nullable: true,
    default: null,
  })
  team_win?: TeamSide | null;

  /** Total points awarded for this round (sum of revealed option points). */
  @Column({ type: 'int', default: 0 })
  point_won!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Game, (game) => game.gameplays, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @ManyToOne(() => Question, (q) => q.gameplays, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question!: Question;
}
