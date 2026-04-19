import { computeStdDev, computeOptionPoints } from './stats.util';

describe('computeStdDev', () => {
  it('returns 0 for an empty array', () => {
    expect(computeStdDev([])).toBe(0);
  });

  it('returns 0 when all votes are equal', () => {
    expect(computeStdDev([5, 5, 5, 5])).toBe(0);
  });

  it('computes correct population std_dev', () => {
    // mean = 3, deviations = [4,1,1,4], variance = 10/4 = 2.5, sqrt = 1.5811
    const result = computeStdDev([1, 2, 4, 5]);
    expect(result).toBeCloseTo(1.5811, 3);
  });

  it('handles a single vote count', () => {
    expect(computeStdDev([10])).toBe(0);
  });
});

describe('computeOptionPoints', () => {
  it('distributes points when totalVotes is 0 while preserving descending order', () => {
    const points = computeOptionPoints([0, 0, 0], 0);

    expect(points).toEqual([35, 33, 32]);
    expect(points.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(points[0]).toBeGreaterThan(points[1]);
    expect(points[1]).toBeGreaterThan(points[2]);
  });

  it('computes proportional points summing to ~100', () => {
    const points = computeOptionPoints([70, 20, 10], 100);
    expect(points).toEqual([70, 20, 10]);
    expect(points.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    // 1/3 = 33.33 → 33, 1/3 = 33.33 → 33, 1/3 = 33.33 → 33
    const points = computeOptionPoints([1, 1, 1], 3);
    expect(points.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(points[0]).toBeGreaterThan(points[1]);
    expect(points[1]).toBeGreaterThan(points[2]);
  });

  it('pads zero-vote slots and recalculates remaining points proportionally', () => {
    const points = computeOptionPoints([12, 5, 2, 0, 0, 0], 19);

    expect(points).toEqual([54, 22, 9, 5, 5, 5]);
    expect(points.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(points[0]).toBeGreaterThan(points[1]);
    expect(points[1]).toBeGreaterThan(points[2]);
  });

  it('ensures the lowest non-zero option stays above zero-vote minimum', () => {
    const points = computeOptionPoints([99, 1, 0, 0, 0, 0], 100);

    expect(points).toEqual([74, 6, 5, 5, 5, 5]);
    expect(points.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(points[1]).toBeGreaterThan(points[2]);
  });
});
