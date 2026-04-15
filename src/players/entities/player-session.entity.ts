import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Game } from '../../game/entities/game.entity';

/**
 * PlayerSession — logs when a unique client device joined a game.
 *
 * This is an informational audit table — it does NOT authenticate players.
 * It is useful for the admin to see how many devices have connected and for
 * diagnosing issues with player reconnection.
 *
 * A new row is inserted each time a player hits GET /games/:gameCode
 * (or each unique cookie+game combination, to avoid duplicates on page reload).
 */
@Entity('player_sessions')
@Index(['game_id'])
export class PlayerSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  game_id!: string;

  /**
   * SHA-256 fingerprint of `${ip}:${userAgent}`.
   * Stored to correlate multiple sessions from the same device.
   */
  @Column({ type: 'varchar', length: 64 })
  device_fingerprint!: string;

  /** Client IP address at the time of joining. */
  @Column({ type: 'varchar', length: 45 })
  ip_address!: string;

  /** Raw User-Agent string (truncated to 500 chars). */
  @Column({ type: 'varchar', length: 500 })
  user_agent!: string;

  /** The `voter_token` cookie value for correlating with Voter records. */
  @Column({ type: 'uuid', nullable: true })
  cookie_token?: string | null;

  @CreateDateColumn()
  joined_at!: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;
}
