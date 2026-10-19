import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe/client";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { blockInDemo } from "@/lib/demo/guard";

/** Module 9: opens the Stripe-hosted billing portal for the org's subscription. */
export async function POST() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "La facturation Stripe n'est pas configurée sur cet environnement. Contactez un administrateur GODAC." },
      { status: 503 },
    );
  }

  const g = await garderApi({ roles: ["direction"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const demoBlocked = await blockInDemo(appUser.organization_id);
  if (demoBlocked) return demoBlocked;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut gérer l'abonnement" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", appUser.organization_id)
    .single();

  if (!organization?.stripe_customer_id) {
    return NextResponse.json(
      { error: "Aucun abonnement Stripe actif pour cette organisation. Choisissez un plan depuis l'onboarding." },
      { status: 409 },
    );
  }

  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await stripe.billingPortal.sessions.create({
    customer: organization.stripe_customer_id,
    return_url: `${appUrl}/admin/billing`,
  });

  return NextResponse.json({ url: session.url });
}
