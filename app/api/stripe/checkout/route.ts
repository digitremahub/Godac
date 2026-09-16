import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { getStripeClient } from "@/lib/stripe/client";
import { PLANS, getPlanPriceId } from "@/lib/stripe/plans";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({ planId: z.enum(["starter", "pro"]) });

/** Onboarding step 4 / Module 9: creates a Stripe Checkout session for the org's subscription. */
export async function POST(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const plan = PLANS.find((p) => p.id === parsed.data.planId)!;
  const priceId = getPlanPriceId(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: `Aucun price Stripe configuré pour le plan "${plan.id}" (voir ${plan.priceEnvVar} dans .env)` },
      { status: 501 },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("id, stripe_customer_id")
    .eq("clerk_org_id", orgId)
    .single();

  if (!organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }

  const stripe = getStripeClient();
  const user = await currentUser();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: organization.stripe_customer_id ?? undefined,
    customer_email: organization.stripe_customer_id
      ? undefined
      : user?.primaryEmailAddress?.emailAddress,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { godac_organization_id: organization.id, clerk_org_id: orgId },
    },
    metadata: { godac_organization_id: organization.id, clerk_org_id: orgId, plan: plan.id },
    success_url: `${appUrl}/onboarding?stripe=success`,
    cancel_url: `${appUrl}/onboarding?stripe=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
