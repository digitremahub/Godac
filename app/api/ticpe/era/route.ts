import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { calculerTicpe } from "@/lib/ticpe/calcul-serveur";
import { genererEra } from "@/lib/ticpe/generation-serveur";

export const maxDuration = 120;

const schema = z.object({ annee: z.number().int().min(2025).max(2100) });

/**
 * État récapitulatif annuel (ERA) TICPE d'une année : Excel + PDF, rangés
 * avec les exports (document_type « era »). À établir au plus tard le
 * 31 janvier N+1 et à tenir à disposition (décret n° 2025-255).
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "carburant.ticpe_documents" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Année invalide (2025 ou après)." }, { status: 400 });
  const { annee } = parsed.data;

  const { data: org } = await supabase.from("organizations").select("id, name, siren").eq("id", appUser.organization_id).single();
  if (!org) return NextResponse.json({ error: "Organisation introuvable." }, { status: 409 });
  const calcul = await calculerTicpe(supabase, org.id, { anneeDebut: annee, anneeFin: annee });
  if (calcul.tronque) return NextResponse.json({ error: "Trop de pleins sur l'année : ERA incomplet." }, { status: 413 });
  const era = await genererEra(calcul, org.name, (org as { siren?: string | null }).siren ?? null, annee);

  const id = randomUUID();
  const xlsxPath = `${org.id}/era-${annee}-${id}.xlsx`;
  const pdfPath = `${org.id}/era-${annee}-${id}.pdf`;
  const [u1, u2] = await Promise.all([
    supabase.storage.from("ticpe-exports").upload(xlsxPath, era.xlsx, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    supabase.storage.from("ticpe-exports").upload(pdfPath, era.pdf, { contentType: "application/pdf" }),
  ]);
  if (u1.error || u2.error) return NextResponse.json({ error: `Échec de l'enregistrement : ${(u1.error ?? u2.error)!.message}` }, { status: 500 });

  const { data: ligne, error } = await supabase
    .from("ticpe_exports")
    .insert({
      organization_id: org.id,
      period_start: `${annee}-01-01`,
      period_end: `${annee}-12-31`,
      generated_by: appUser.id,
      file_path: xlsxPath,
      pdf_file_path: pdfPath,
      vehicle_count: era.lignes.length,
      total_liters: era.litres,
      total_refund: era.total,
      document_type: "era",
    })
    .select("id")
    .single();
  if (error && !estSchemaManquant(error)) {
    await createAdminSupabaseClient().storage.from("ticpe-exports").remove([xlsxPath, pdfPath]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const [{ data: s1 }, { data: s2 }] = await Promise.all([
    supabase.storage.from("ticpe-exports").createSignedUrl(xlsxPath, 300),
    supabase.storage.from("ticpe-exports").createSignedUrl(pdfPath, 300),
  ]);
  await journaliser({ organizationId: org.id, userId: appUser.id, action: "ticpe_document_genere", targetTable: "ticpe_exports", targetId: ligne?.id ?? null, details: { document: "era", annee, vehicules: era.lignes.length, montant: era.total } });
  return NextResponse.json({ ok: true, exportId: ligne?.id ?? null, excelUrl: s1?.signedUrl, pdfUrl: s2?.signedUrl, enregistre: !error });
}
