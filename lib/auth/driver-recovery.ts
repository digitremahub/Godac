import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
function secret(): string {
  const value = process.env.PIN_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("PIN_PEPPER is not configured");
  return value;
}
export function normalizeRecoveryCode(code: string): string { return code.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
export function createRecoveryCode(): string {
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12)}`;
}
export function hashRecoveryCode(userId: string, code: string): string {
  return createHmac("sha256", secret()).update(`${userId}:${normalizeRecoveryCode(code)}`).digest("hex");
}
export function recoveryCodeMatches(userId: string, code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashRecoveryCode(userId, code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}