import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { getStripeClient } from "@/lib/stripe/client";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, type PlanId } from "@/lib/organization/catalog";
import { blockInDemo } from "@/lib/demo/guard";

/**
 * Builds the subscription price from the org's chosen plan
 * (organizations.plan) plus whatever à-la-carte modules it has
 * actually enabled (organization_modules — see migration
 * 20260101000015_module_catalog.sql). Uses Stripe's inline
 * `price_data` rather than pre-created Price objects, since the
 * per-org total isn't one of a fixed set of Stripe Prices.
 */
export async function POST() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "La facturation Stripe n'est pas configurée sur cet environnement. Contactez un administrateur GODAC." },
      { status: 503 },
    );
  }

  const appUser = await requireAppUser();
  const demoBlocked = await blockInDemo(appUser.organization_id);
  if (demoBlocked) return demoBlocked;
  const supabase = await createServerSupabaseClient();

  const [{ data: organization }, { plans, modules }] = await Promise.all([
    supabase.from("organizations").select("id, name, plan, stripe_customer_id").eq("id", appUser.organization_id).single(),
    getFullCatalog(supabase),
  ]);

  if (!organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }

  const planId = organization.plan as PlanId;
  const plan = plans.find((p) => p.id === planId);
  if (!plan) {
    return NextResponse.json({ error: "Plan introuvable" }, { status: 500 });
  }

  const { data: addonRows } = await supabase
    .from("organization_modules")
    .select("module_key, effective_monthly_price, effective_setup_price")
    .eq("organization_id", organization.id)
    .eq("enabled", true)
    .eq("pricing_mode", "a_la_carte");

  const moduleByKey = new Map(modules.map((m) => [m.key, m]));
  const addons = addonRows ?? [];

  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const lineItems = [
    {
      price_data: {
        currency: "eur",
        unit_amount: Math.round(plan.monthly_base_price * 100),
        recurring: { interval: "month" as const },
        product_data: { name: `GODAC — Plan ${plan.name}` },
      },
      quantity: 1,
    },
    ...addons.map((addon) => ({
      price_data: {
        currency: "eur",
        unit_amount: Math.round(Number(addon.effective_monthly_price) * 100),
        recurring: { interval: "month" as const },
        product_data: { name: `GODAC — ${moduleByKey.get(addon.module_key)?.name ?? addon.module_key}` },
      },
      quantity: 1,
    })),
    ...(plan.setup_price > 0
      ? [
          {
            price_data: {
              currency: "eur",
              unit_amount: Math.round(plan.setup_price * 100),
              product_data: { name: `GODAC — Mise en service (${plan.name})` },
            },
            quantity: 1,
          },
        ]
      : []),
    ...addons
      .filter((addon) => Number(addon.effective_setup_price) > 0)
      .map((addon) => ({
        price_data: {
          currency: "eur",
          unit_amount: Math.round(Number(addon.effective_setup_price) * 100),
          product_data: { name: `GODAC — Mise en service (${moduleByKey.get(addon.module_key)?.name ?? addon.module_key})` },
        },
        quantity: 1,
      })),
  ];

  const total = plan.monthly_base_price + addons.reduce((sum, a) => sum + Number(a.effective_monthly_price), 0);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: organization.stripe_customer_id ?? undefined,
    customer_email: organization.stripe_customer_id ? undefined : appUser.email,
    line_items: lineItems,
    subscription_data: {
      metadata: {
        godac_organization_id: organization.id,
        plan: plan.id,
        modules: addons.map((a) => a.module_key).join(",") || "none",
      },
    },
    metadata: { godac_organization_id: organization.id },
    success_url: `${appUrl}/onboarding?stripe=success`,
    cancel_url: `${appUrl}/onboarding?stripe=cancelled`,
  });

  return NextResponse.json({ url: session.url, total });
}
