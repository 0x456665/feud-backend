/**
 * Catalogue of all SSE event type names emitted by the server.
 * Keeping them as a const enum prevents typos across the codebase.
 */
export const GameEventType = {
  /** Admin advances to the next question. */
  NEXT_QUESTION: 'next_question',

  /** Admin reveals one answer option on the board. */
  REVEAL_OPTION: 'reveal_option',

  /** Admin triggers a wrong-answer buzzer (strike). */
  WRONG_OPTION: 'wrong_option',

  /** Admin manually adds points to a team. */
  ADD_SCORE: 'add_score',

  /** Play the winner fanfare sound on client boards. */
  PLAY_WINNER_SOUND: 'play_winner_sound',

  /** Game is over — show final scores. */
  END_GAME: 'end_game',

  /** Generic state sync (voting or play state changed). */
  GAME_STATE: 'game_state',

  /** Broadcast updated vote count during the survey/voting phase. */
  VOTE_UPDATE: 'vote_update',

  /** SSE keep-alive heartbeat (not dispatched to UI, prevents proxy timeout). */
  HEARTBEAT: 'heartbeat',
} as const;

export type GameEventType = (typeof GameEventType)[keyof typeof GameEventType];

// ── Typed payload interfaces ────────────────────────────────────────────────

export interface NextQuestionPayload {
  questionId: string;
  questionText: string;
  totalOptions: number;
  roundNumber: number;
}

export interface RevealOptionPayload {
  optionId: string;
  optionText: string;
  votes: number;
  rank: number;
  points: number;
}

export interface WrongOptionPayload {
  team: string;
  strikeCount: number;
}

export interface AddScorePayload {
  team: string;
  teamName: string;
  points: number;
  teamATotal: number;
  teamBTotal: number;
  teamAName: string;
  teamBName: string;
}

export interface PlayWinnerSoundPayload {
  winningTeam: string;
  teamName: string;
}

export interface EndGamePayload {
  winningTeam: string;
  teamName: string;
  teamATotal: number;
  teamBTotal: number;
  teamAName: string;
  teamBName: string;
}

export interface GameStatePayload {
  playState: string;
  votingState: string;
}

export interface VoteUpdatePayload {
  questionId: string;
  totalVotes: number;
}

export type GameEventPayload =
  | NextQuestionPayload
  | RevealOptionPayload
  | WrongOptionPayload
  | AddScorePayload
  | PlayWinnerSoundPayload
  | EndGamePayload
  | GameStatePayload
  | VoteUpdatePayload
  | Record<string, never>;
