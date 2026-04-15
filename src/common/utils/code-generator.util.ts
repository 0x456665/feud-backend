import { randomBytes } from 'crypto';

/**
 * Generates a human-readable 6-character uppercase game join code.
 * Uses only uppercase letters and digits excluding visually ambiguous
 * characters (0, O, I, 1) to reduce player entry errors.
 * Example output: "FEUD4X"
 */
export function generateGameCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  // Use crypto.randomBytes for cryptographically secure randomness
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/**
 * Generates a 16-character alphanumeric admin access code.
 * This is shown to the admin ONCE on game creation and never stored in plaintext.
 * The caller must hash this value with bcrypt before persisting it.
 * Example output: "aB3xZ9kQ2mP7wR4n"
 */
export function generateAdminCode(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}
