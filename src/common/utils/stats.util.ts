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
  const variance = votes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;

  return Math.round(Math.sqrt(variance) * 10000) / 10000;
}

/**
 * Calculates the points for each option based on its share of total votes.
 * Points are normalized to 100 and zero-vote answers receive a minimum value.
 * Zero-vote slots are padded to 5 points, then all non-zero options are
 * recalculated proportionally from the remaining score pool.
 *
 * @param votes Array of vote counts (ordered, matching your options array)
 * @param totalVotes Sum of all votes for the question
 * @returns Array of integer point values corresponding to each input vote count
 */
export function computeOptionPoints(
  votes: number[],
  totalVotes: number,
): number[] {
  const MIN_ZERO_POINTS = 5;
  const optionCount = votes.length;

  if (optionCount === 0) return [];

  if (totalVotes === 0) {
    const base = votes.map(
      (_, index) => MIN_ZERO_POINTS + (optionCount - 1 - index),
    );
    const points = [...base];
    let extra = 100 - points.reduce((sum, value) => sum + value, 0);

    for (let index = 0; extra > 0; index = (index + 1) % optionCount) {
      points[index] += 1;
      extra -= 1;
    }

    return points;
  }

  const zeroCount = votes.filter((voteCount) => voteCount === 0).length;
  const targetPool = zeroCount > 0 ? 100 - zeroCount * MIN_ZERO_POINTS : 100;
  const positiveCount = optionCount - zeroCount;
  const points: number[] = [];

  for (let index = 0; index < positiveCount; index += 1) {
    points[index] = Math.max(
      1,
      Math.round((votes[index] / totalVotes) * targetPool),
    );
  }

  let currentTotal = points.reduce((sum, value) => sum + value, 0);

  const enforceMinimum = (index: number) => {
    if (index === points.length - 1 && zeroCount > 0) {
      return MIN_ZERO_POINTS + 1;
    }

    if (index === points.length - 1) {
      return 1;
    }

    return points[index + 1] + 1;
  };

  let changed = true;
  while (changed && currentTotal > targetPool) {
    changed = false;
    for (
      let index = points.length - 1;
      index >= 0 && currentTotal > targetPool;
      index -= 1
    ) {
      const minimumPoints = enforceMinimum(index);
      if (points[index] - 1 >= minimumPoints) {
        points[index] -= 1;
        currentTotal -= 1;
        changed = true;
      }
    }
  }

  changed = true;
  while (changed && currentTotal < targetPool) {
    changed = false;
    for (
      let index = 0;
      index < points.length && currentTotal < targetPool;
      index += 1
    ) {
      const maximumPoints = index === 0 ? Infinity : points[index - 1] - 1;
      if (points[index] + 1 <= maximumPoints) {
        points[index] += 1;
        currentTotal += 1;
        changed = true;
      }
    }
  }

  if (
    zeroCount > 0 &&
    points.length > 0 &&
    points[points.length - 1] <= MIN_ZERO_POINTS
  ) {
    const delta = MIN_ZERO_POINTS + 1 - points[points.length - 1];
    points[points.length - 1] += delta;
    currentTotal += delta;

    for (
      let index = 0;
      index < points.length - 1 && currentTotal > targetPool;
      index += 1
    ) {
      const minimumPoints = index === 0 ? 1 : points[index + 1] + 1;
      while (points[index] > minimumPoints && currentTotal > targetPool) {
        points[index] -= 1;
        currentTotal -= 1;
      }
    }
  }

  const finalPoints = [...points, ...Array(zeroCount).fill(MIN_ZERO_POINTS)];

  for (let index = 1; index < finalPoints.length; index += 1) {
    const minimumPoints = votes[index] === 0 ? MIN_ZERO_POINTS : 1;
    if (finalPoints[index] >= finalPoints[index - 1]) {
      finalPoints[index] = Math.max(minimumPoints, finalPoints[index - 1] - 1);
    }
  }

  let grandTotal = finalPoints.reduce(
    (sum: number, value: number) => sum + value,
    0,
  );
  while (grandTotal > 100) {
    let localChanged = false;
    for (
      let index = finalPoints.length - 1;
      index >= 0 && grandTotal > 100;
      index -= 1
    ) {
      const minimumPoints = votes[index] === 0 ? MIN_ZERO_POINTS : 1;
      const nextPoints =
        index === finalPoints.length - 1 ? -1 : finalPoints[index + 1];
      if (
        finalPoints[index] - 1 >= minimumPoints &&
        (index === finalPoints.length - 1 ||
          finalPoints[index] - 1 > nextPoints)
      ) {
        finalPoints[index] -= 1;
        grandTotal -= 1;
        localChanged = true;
      }
    }

    if (!localChanged) break;
  }

  while (grandTotal < 100) {
    let localChanged = false;
    for (
      let index = 0;
      index < finalPoints.length && grandTotal < 100;
      index += 1
    ) {
      if (votes[index] === 0) continue;
      if (index === 0 || finalPoints[index] + 1 < finalPoints[index - 1]) {
        finalPoints[index] += 1;
        grandTotal += 1;
        localChanged = true;
      }
    }

    if (!localChanged) break;
  }

  return finalPoints as number[];
}
