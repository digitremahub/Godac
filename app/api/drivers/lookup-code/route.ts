import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Fallback driver identification for a shared fuel-entry kiosk: a
 * short, memorable per-organisation code instead of scanning the
 * physical badge (see components/fuel/QrScanner.tsx's manual-entry
 * path, which previously only accepted a raw UUID — unusable without
 * the badge in hand). RLS ("users: read within org") already scopes
 * this to the caller's own organisation; no admin client needed.
 */
export async function GET(req: Request) {
  await requireAppUser();
  // Deux formats cohabitent : l'ancien (6 chiffres aléatoires, pour
  // les comptes sans date de naissance renseignée) et le nouveau
  // (initiales + mois/année, ex: FT11/88, voir lib/business/driver-code.ts)
  // — normalisé en majuscules ici pour tolérer une saisie en bas de casse
  // des initiales à la pompe.
  const codeInput = new URL(req.url).searchParams.get("code")?.trim();
  const code = codeInput?.toLocaleUpperCase("fr-FR");
  if (!code || !/^[A-ZÀ-ÖØ-Þ0-9/-]{2,20}$/.test(code)) {
    return NextResponse.json({ error: "Code invalide." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("driver_code", code)
    .eq("active", true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Aucun chauffeur ne correspond à ce code." }, { status: 404 });
  return NextResponse.json({ id: data.id, full_name: data.full_name });
}
