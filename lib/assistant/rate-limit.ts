/**
 * Lot B — pure rate-limit check (20 messages/user/hour), kept
 * framework-agnostic so the API route just supplies "when did this
 * user's recent messages happen" and gets a yes/no back.
 */
export function isWithinMessageRateLimit(
  recentMessageTimestamps: Date[],
  { now = new Date(), max = 20, windowMs = 60 * 60 * 1000 }: { now?: Date; max?: number; windowMs?: number } = {},
): boolean {
  const cutoff = now.getTime() - windowMs;
  const recentCount = recentMessageTimestamps.filter((t) => t.getTime() >= cutoff).length;
  return recentCount < max;
}

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_MESSAGES = 10;
