import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { facturerDepassements } from "@/lib/usage/facturation";
import { depotFacturationSupabase } from "@/lib/usage/facturation-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Facturation à la dépense (vercel.json crons, le 1er du mois) : ajoute
 * à la prochaine facture Stripe de chaque entreprise les unités du mois
 * écoulé au-delà du volume inclus (lib/usage/facturation.ts). Idempotent
 * (usage_billing_runs) : relancer la route ne facture jamais deux fois.
 * Même contrôle CRON_SECRET que les autres crons.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not configured" }, { status: 503 });
  }

  const stripe = getStripeClient();
  const resultat = await facturerDepassements(depotFacturationSupabase(createAdminSupabaseClient()), (params, idempotencyKey) =>
    stripe.invoiceItems.create(params, { idempotencyKey }),
  );
  if (resultat.erreurs.length) console.error("usage-billing: lignes non facturées", resultat.erreurs);
  return NextResponse.json({ ok: resultat.erreurs.length === 0, ...resultat });
}
