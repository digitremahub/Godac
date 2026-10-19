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
  if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    console.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET/STRIPE_SECRET_KEY is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
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

  // Toute erreur (base ou Stripe) renvoie 500 : Stripe renverra l'événement.
  // Le traitement est idempotent : on écrit l'état courant de l'abonnement
  // relu chez Stripe (et non celui de l'événement), donc rejouer un
  // événement, ou le recevoir dans le désordre, aboutit au même résultat.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId = session.metadata?.godac_organization_id;
        if (!organizationId) break;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
        await appliquerAbonnement(supabase, organizationId, {
          customerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
          subscription,
          planMetadata: subscription?.metadata?.plan ?? session.metadata?.plan,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const recu = event.data.object as Stripe.Subscription;
        const organizationId = recu.metadata?.godac_organization_id;
        if (!organizationId) break;
        const subscription = await stripe.subscriptions.retrieve(recu.id);
        await appliquerAbonnement(supabase, organizationId, {
          customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
          subscription,
          planMetadata: subscription.metadata?.plan,
        });
        break;
      }

      case "invoice.paid": {
        // Mise en service échelonnée : la ligne s'arrête après N factures payées.
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (!subscriptionId) break;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
        const echeance = subscription.items.data.find((item) => {
          const product = item.price.product;
          return typeof product === "object" && !("deleted" in product && product.deleted) && "metadata" in product && product.metadata?.godac_setup_installments;
        });
        if (!echeance) break;
        const product = echeance.price.product as Stripe.Product;
        const total = Number(product.metadata.godac_setup_installments);
        const payees = await stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 100 });
        if (payees.data.length >= total) {
          await stripe.subscriptionItems.del(echeance.id, { proration_behavior: "none" });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook ${event.type} (${event.id}) failed`, err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

const PLANS_VALIDES = ["essentiel", "starter", "pro", "business"] as const;

/**
 * Écrit l'état de l'abonnement sur l'organisation. Le plan vient des
 * métadonnées de l'abonnement (posées au checkout) ; un plan absent ou
 * inconnu laisse le plan actuel inchangé (jamais de retour silencieux à
 * « starter », audit E1). Lève une erreur si l'écriture échoue (audit E2).
 */
async function appliquerAbonnement(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  organizationId: string,
  params: { customerId: string | null; subscription: Stripe.Subscription | null; planMetadata: string | undefined },
) {
  const update: Record<string, string> = {};
  if (params.customerId) update.stripe_customer_id = params.customerId;
  if (params.subscription) {
    update.stripe_subscription_id = params.subscription.id;
    update.subscription_status = STATUS_MAP[params.subscription.status] ?? "incomplete";
  }
  const plan = params.planMetadata;
  if (plan && (PLANS_VALIDES as readonly string[]).includes(plan)) update.plan = plan;
  else if (plan) console.error("Stripe webhook : plan inconnu dans les métadonnées", plan);
  if (Object.keys(update).length === 0) return;

  const { data, error } = await supabase.from("organizations").update(update).eq("id", organizationId).select("id");
  if (error) throw new Error(`organization update failed: ${error.message}`);
  if (!data || data.length === 0) console.error("Stripe webhook : organisation introuvable", organizationId);
}
