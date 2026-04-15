import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Game } from '../../game/entities/game.entity';
import { Question } from '../../question/entities/question.entity';

/**
 * Voter — records a single cast vote and prevents duplicate voting.
 *
 * Deduplication strategy (layered):
 *   1. PRIMARY: `cookie_token` + `game_id` + `question_id` unique constraint.
 *      The cookie is set server-side when the player joins via GET /games/:gameCode.
 *   2. SECONDARY: `device_fingerprint` (SHA-256 of IP + User-Agent) is stored
 *      for analytics and abuse detection.  It is NOT the primary dedup key
 *      because IPs and UAs can be shared (NAT, corporate proxies).
 *
 * GDPR note: IP addresses are personal data.  Consider masking the last octet
 * before storage in production (/24 prefix only).
 */
@Entity('voters')
@Unique(['game_id', 'question_id', 'cookie_token'])
@Index(['game_id', 'question_id'])
export class Voter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  game_id!: string;

  @Column({ type: 'uuid' })
  question_id!: string;

  /**
   * UUID set as a cookie (`voter_token`) when player joins the game.
   * This is the authoritative dedup key.
   */
  @Column({ type: 'uuid' })
  cookie_token!: string;

  /**
   * SHA-256 hash of `${ip}:${userAgent}`.
   * Used for analytics and secondary abuse detection.
   */
  @Column({ type: 'varchar', length: 64 })
  device_fingerprint!: string;

  /** Raw User-Agent string (truncated to 500 chars to prevent storage abuse). */
  @Column({ type: 'varchar', length: 500 })
  user_agent!: string;

  /**
   * Client IP address.  In production behind a reverse proxy, ensure
   * `trust proxy` is configured so req.ip reflects the real client IP.
   */
  @Column({ type: 'varchar', length: 45 })
  ip_address!: string;

  @CreateDateColumn()
  created_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @ManyToOne(() => Question, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question!: Question;
}
