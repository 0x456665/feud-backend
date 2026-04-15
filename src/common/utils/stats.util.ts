/**
 * Computes the standard deviation of an array of vote counts.
 * A lower std_dev means votes are spread more evenly across options —
 * indicating a well-balanced survey question ideal for Family Feud gameplay.
 * Questions are sorted ascending by this value at game start.
 *
 * @param votes Array of vote counts for each option on a question
 * @returns Population standard deviation, rounded to 4 decimal places
 */
export function computeStdDev(votes: number[]): number {
  if (votes.length === 0) return 0;

  const n = votes.length;
  const mean = votes.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    votes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;

  return Math.round(Math.sqrt(variance) * 10000) / 10000;
}

/**
 * Calculates the points for each option based on its share of total votes.
 * Points = round((option_votes / total_votes) * 100).
 * Only operates on options that have at least 1 vote.
 *
 * @param votes Array of vote counts (ordered, matching your options array)
 * @param totalVotes Sum of all votes for the question
 * @returns Array of integer point values corresponding to each input vote count
 */
export function computeOptionPoints(
  votes: number[],
  totalVotes: number,
): number[] {
  if (totalVotes === 0) return votes.map(() => 0);
  return votes.map((v) => Math.round((v / totalVotes) * 100));
}
