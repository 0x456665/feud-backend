/** Voting/survey phase state for a game. */
export enum VotingState {
  OPEN = 'OPEN',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

/** Live gameplay phase state for a game. */
export enum PlayState {
  LOBBY = 'LOBBY',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  FINISHED = 'FINISHED',
}

/** Which team won a round or the overall game. */
export enum TeamSide {
  TEAM_A = 'TEAM_A',
  TEAM_B = 'TEAM_B',
  NONE = 'NONE',
}
