import { generateGameCode, generateAdminCode } from './code-generator.util';

describe('generateGameCode', () => {
  it('produces a 6-character string', () => {
    expect(generateGameCode()).toHaveLength(6);
  });

  it('contains only allowed characters (no 0, O, I, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateGameCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('generates unique codes across multiple calls', () => {
    const codes = new Set(Array.from({ length: 100 }, generateGameCode));
    // With 32^6 ≈ 1 billion combinations, collisions in 100 calls are negligible
    expect(codes.size).toBe(100);
  });
});

describe('generateAdminCode', () => {
  it('produces a 16-character string', () => {
    expect(generateAdminCode()).toHaveLength(16);
  });

  it('contains only alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateAdminCode()).toMatch(/^[A-Za-z0-9]{16}$/);
    }
  });
});
