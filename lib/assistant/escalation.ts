/**
 * Lot B — the relay triggers on two signals besides the explicit
 * "Parler à quelqu'un" button: the model's own `needs_human` flag
 * (checked where the AI response is parsed, lib/assistant/client.ts),
 * and two consecutive 👎 on assistant replies in the same
 * conversation, checked here in isolation so it's trivially testable.
 */
export function shouldEscalateAfterFeedback(recentAssistantFeedback: (boolean | null)[]): boolean {
  const lastTwo = recentAssistantFeedback.slice(-2);
  return lastTwo.length === 2 && lastTwo.every((f) => f === false);
}
