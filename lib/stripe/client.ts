import "server-only";
import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeSingleton) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY is not configured. Billing (Module 9) is disabled until it is set — see README.",
      );
    }
    stripeSingleton = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
  }
  return stripeSingleton;
}
