import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { lireCarteGrise } from "@/lib/ocr/carte-grise";
import { differencesFiche, propositionDepuisCarteGrise } from "@/lib/ticpe/carte-grise";
import { DOC_CARTE_GRISE } from "@/lib/ticpe/vehicules-serveur";

export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lire") }),
  z.object({
    action: z.literal("confirmer"),
    type: z.enum(["VL", "PL", "SPL"]).nullable(),
    ptac_kg: z.number().int().positive().max(100000).nullable(),
    fuel_type: z.string().trim().max(40).nullable(),
    cg_genre: z.string().trim().toUpperCase().max(12).nullable(),
    cg_energie: z.string().trim().toUpperCase().max(4).nullable(),
    cg_premiere_immat: z.string().date().nullable(),
  }),
]);

/**
 * Carte grise du véhicule :
 *  - « lire » : lit la dernière carte grise jointe (documents du
 *    véhicule) et renvoie une PROPOSITION, sans rien enregistrer ;
 *  - « confirmer » : enregistre les champs vérifiés par la personne
 *    (PTAC, genre, énergie, 1re immatriculation, type) et les marque
 *    « saisis et confirmés » (spec_sources), avec la date de confirmation.
 * Encadrement (droits d'écriture de la fiche véhicule) ; RLS en base.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Saisie invalide." }, { status: 400 });

  const { data: vehicule } = await supabase.from("vehicles").select("id, registration, type, ptac_kg, fuel_type, spec_sources").eq("id", id).maybeSingle();
  if (!vehicule) return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });

  if (parsed.data.action === "lire") {
    const { data: doc } = await supabase
      .from("vehicle_documents")
      .select("id, file_path")
      .eq("vehicle_id", id)
      .eq("doc_type", DOC_CARTE_GRISE)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: "Aucune carte grise jointe : ajoutez-la d'abord dans les documents du véhicule." }, { status: 404 });
    const { data: fichier, error: dlError } = await createAdminSupabaseClient().storage.from("vehicle-documents").download(doc.file_path);
    if (dlError || !fichier) return NextResponse.json({ error: "Fichier de la carte grise illisible." }, { status: 500 });
    const octets = Buffer.from(await fichier.arrayBuffer());
    if (octets.length > 15 * 1024 * 1024) return NextResponse.json({ error: "Fichier trop lourd pour la lecture automatique (15 Mo maximum)." }, { status: 413 });
    const r = await lireCarteGrise(octets, doc.file_path);
    if (!r.ok) {
      console.error("OCR carte grise", r.reason);
      return NextResponse.json({ error: "Lecture automatique impossible : saisissez les cases à la main." }, { status: 502 });
    }
    const proposition = propositionDepuisCarteGrise(r.lecture);
    return NextResponse.json({ lecture: r.lecture, proposition, differences: differencesFiche(vehicule, proposition) });
  }

  const c = parsed.data;
  const maintenant = new Date().toISOString();
  const sources = { ...((vehicule.spec_sources as Record<string, unknown> | null) ?? {}) };
  const maj: Record<string, unknown> = {
    cg_genre: c.cg_genre,
    cg_energie: c.cg_energie,
    cg_premiere_immat: c.cg_premiere_immat,
    cg_confirmee_le: maintenant,
    cg_confirmee_par: appUser.id,
  };
  if (c.type) {
    maj.type = c.type;
    sources.type = { origin: "saisie", confirmed: true };
  }
  if (c.ptac_kg !== null) {
    maj.ptac_kg = c.ptac_kg;
    sources.ptac_kg = { origin: "saisie", confirmed: true };
  }
  if (c.fuel_type) {
    maj.fuel_type = c.fuel_type;
    sources.fuel_type = { origin: "saisie", confirmed: true };
  }
  maj.spec_sources = sources;

  const { data, error } = await supabase.from("vehicles").update(maj).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261031000002 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Véhicule hors de votre périmètre." }, { status: 403 });
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "ticpe_carte_grise_confirmee",
    targetTable: "vehicles",
    targetId: id,
    details: { type: c.type, ptac_kg: c.ptac_kg, fuel_type: c.fuel_type, cg_genre: c.cg_genre, cg_energie: c.cg_energie, cg_premiere_immat: c.cg_premiere_immat },
  });
  return NextResponse.json({ ok: true });
}
