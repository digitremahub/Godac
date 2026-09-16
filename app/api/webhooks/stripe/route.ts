import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe/client";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const STATUS_MAP: Record<Stripe.Subscription.Status, string> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  unpaid: "past_due",
  paused: "canceled",
};

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.metadata?.godac_organization_id;
      if (!organizationId) break;

      const { error } = await supabase
        .from("organizations")
        .update({
          stripe_customer_id: String(session.customer),
          stripe_subscription_id: String(session.subscription),
          plan: session.metadata?.plan ?? "starter",
        })
        .eq("id", organizationId);
      if (error) console.error("organization update (checkout completed) failed", error);
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata?.godac_organization_id;
      if (!organizationId) break;

      const { error } = await supabase
        .from("organizations")
        .update({ subscription_status: STATUS_MAP[subscription.status] ?? "incomplete" })
        .eq("id", organizationId);
      if (error) console.error("organization update (subscription event) failed", error);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
