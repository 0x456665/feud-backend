import { IsUUID, IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';

/**
 * DTO for casting a vote during the survey/voting phase.
 *
 * A voter may select between 1 and 6 options for a given question.
 * The server deduplicates submitted IDs, validates ownership, and
 * atomically increments each selected option's vote count.
 *
 * The voter's identity is established by:
 *   1. The voter_token cookie (set when joining via GET /games/:gameCode)
 *   2. Device fingerprint (IP + User-Agent, derived server-side)
 *
 * Security: VoterGuard checks this cookie before the handler runs and
 * rejects duplicate submissions for the same (game, question, cookie_token).
 */
export class CastVoteDto {
  @IsUUID()
  gameId!: string;

  @IsUUID()
  questionId!: string;

  /** Four to six option IDs the voter has chosen for this question. */
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(6)
  @IsUUID('4', { each: true })
  optionIds!: string[];
}
