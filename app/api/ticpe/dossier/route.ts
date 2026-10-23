import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { creerZip, type FichierZip } from "@/lib/paie/zip";
import { calculerTicpe } from "@/lib/ticpe/calcul-serveur";
import { garderBloquants } from "@/lib/ticpe/garde-bloquants";
import { mentionPointsNonResolus } from "@/lib/ticpe/bloquants";
import { genererRecapPeriode } from "@/lib/ticpe/generation-serveur";
import { lignesDeLaPeriode } from "@/lib/ticpe/montant";
import { nomFichierSur } from "@/lib/ticpe/documents";
import { DOC_CARTE_GRISE } from "@/lib/ticpe/vehicules-serveur";
import { AVERTISSEMENT_TICPE } from "@/lib/ticpe/reglages";
import { bornesPeriode } from "@/lib/ticpe/export";

export const maxDuration = 300;

const BUCKET_TICKETS = process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets";
/** Taille maximale des justificatifs ajoutés à l'archive (limite de stockage). */
const TAILLE_MAX = 45 * 1024 * 1024;

const schema = z
  .object({ periode_debut: z.string().date(), periode_fin: z.string().date(), forcer_malgre_bloquants: z.number().int().min(1).optional() })
  .refine((b) => b.periode_debut <= b.periode_fin, { message: "Période invalide." });

function extension(chemin: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(chemin);
  return m ? `.${m[1]!.toLowerCase()}` : "";
}

/**
 * Dossier de contrôle TICPE d'une période (ZIP) : récapitulatif Excel +
 * PDF et justificatifs disponibles dans GODAC — photos de tickets des
 * pleins comptés, factures de livraison des cuves utilisées, cartes
 * grises des véhicules concernés. La liste des fichiers vient de la RLS
 * de la personne connectée ; les fichiers sont lus avec le service.
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "carburant.ticpe_documents" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Période invalide." }, { status: 400 });
  const { periode_debut: debut, periode_fin: fin, forcer_malgre_bloquants } = parsed.data;

  const { data: org } = await supabase.from("organizations").select("id, name").eq("id", appUser.organization_id).single();
  if (!org) return NextResponse.json({ error: "Organisation introuvable." }, { status: 409 });
  const calcul = await calculerTicpe(supabase, org.id, { anneeDebut: Number(debut.slice(0, 4)), anneeFin: Number(fin.slice(0, 4)) });
  if (calcul.tronque) return NextResponse.json({ error: "Trop de pleins sur la période : réduisez-la." }, { status: 413 });
  const garde = await garderBloquants(supabase, org.id, calcul, { debut, fin }, forcer_malgre_bloquants);
  if (garde.reponse) return garde.reponse;
  const recap = await genererRecapPeriode(calcul, org.name, debut, fin, garde.pointsNonResolus);
  const comptees = lignesDeLaPeriode(calcul.lignes, debut, fin).filter((l) => l.statut !== "exclu");

  // Justificatifs à joindre (chemins lus sous la RLS de la personne connectée).
  const immat = (vid: string) => calcul.evalues.get(vid)?.vehicule.registration ?? "vehicule";
  const aJoindre: { nom: string; bucket: string; chemin: string }[] = [];
  for (const l of comptees) {
    const p = calcul.pleins.get(l.id);
    if (p?.ticket_photo_path) {
      const jour = l.jour;
      aJoindre.push({ nom: `tickets/${jour}_${nomFichierSur(immat(l.vehicle_id))}_${l.id.slice(0, 8)}${extension(p.ticket_photo_path)}`, bucket: BUCKET_TICKETS, chemin: p.ticket_photo_path });
    }
  }
  const cuves = [...new Set(comptees.map((l) => calcul.pleins.get(l.id)?.tank_id).filter((x): x is string => Boolean(x)))];
  if (cuves.length > 0) {
    // Livraisons de l'année (et jusqu'à la fin de période) : le gazole distribué en vient.
    const { depuis, avant } = bornesPeriode(`${debut.slice(0, 4)}-01-01`, fin);
    const { rows } = await fetchAllRows<{ id: string; tank_id: string; delivered_at: string; invoice_path: string }>((from, to) =>
      supabase
        .from("tank_deliveries")
        .select("id, tank_id, delivered_at, invoice_path")
        .eq("organization_id", org.id)
        .in("tank_id", cuves)
        .not("invoice_path", "is", null)
        .gte("delivered_at", depuis)
        .lt("delivered_at", avant)
        .order("delivered_at")
        .range(from, to),
    );
    for (const d of rows) {
      const cuve = calcul.cuves.get(d.tank_id)?.name ?? "cuve";
      aJoindre.push({ nom: `livraisons-cuve/${d.delivered_at.slice(0, 10)}_${nomFichierSur(cuve)}_${d.id.slice(0, 8)}${extension(d.invoice_path)}`, bucket: "tank-invoices", chemin: d.invoice_path });
    }
  }
  const vehicules = [...new Set(comptees.map((l) => l.vehicle_id))];
  if (vehicules.length > 0) {
    const { data: cartes } = await supabase.from("vehicle_documents").select("vehicle_id, file_path").eq("doc_type", DOC_CARTE_GRISE).in("vehicle_id", vehicules);
    for (const c of (cartes ?? []) as { vehicle_id: string; file_path: string }[]) {
      aJoindre.push({ nom: `cartes-grises/${nomFichierSur(immat(c.vehicle_id))}${extension(c.file_path)}`, bucket: "vehicle-documents", chemin: c.file_path });
    }
  }

  const admin = createAdminSupabaseClient();
  const fichiers: FichierZip[] = [
    { nom: `recapitulatif-3310-TIC_${debut}_${fin}.xlsx`, contenu: new Uint8Array(recap.xlsx) },
    { nom: `recapitulatif-3310-TIC_${debut}_${fin}.pdf`, contenu: new Uint8Array(recap.pdf) },
  ];
  const absents: string[] = [];
  let taille = recap.xlsx.length + recap.pdf.length;
  for (const f of aJoindre) {
    if (taille >= TAILLE_MAX) {
      absents.push(`${f.nom} (archive trop lourde : à récupérer dans GODAC)`);
      continue;
    }
    const { data, error } = await admin.storage.from(f.bucket).download(f.chemin);
    if (error || !data) {
      absents.push(`${f.nom} (fichier introuvable)`);
      continue;
    }
    const octets = new Uint8Array(await data.arrayBuffer());
    taille += octets.length;
    fichiers.push({ nom: f.nom, contenu: octets });
  }
  const sansJustif = comptees.filter((l) => !l.justificatif.present).length;
  fichiers.push({
    nom: "LISEZMOI.txt",
    contenu: [
      `Dossier de contrôle TICPE — ${org.name}`,
      `Période du ${debut} au ${fin}. Généré le ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}.`,
      "",
      AVERTISSEMENT_TICPE,
      ...(garde.pointsNonResolus > 0 ? ["", mentionPointsNonResolus(garde.pointsNonResolus)] : []),
      "",
      `Pleins comptés : ${comptees.length}. Montant calculé : ${recap.doc.totalMontant.toLocaleString("fr-FR")} €. Volume retenu : ${recap.doc.totalHectolitres.toLocaleString("fr-FR")} hl.`,
      `Pleins sans justificatif enregistré dans GODAC : ${sansJustif} (relevés de cartes et factures papier à joindre par l'entreprise).`,
      "",
      "Contenu : récapitulatif (Excel, PDF), tickets/ (photos des tickets de station), livraisons-cuve/ (factures de livraison des cuves), cartes-grises/.",
      ...(absents.length ? ["", "Non inclus :", ...absents.map((a) => `- ${a}`)] : []),
    ].join("\r\n"),
  });
  const zip = creerZip(fichiers);

  const id = randomUUID();
  const zipPath = `${org.id}/dossier-${debut}-${fin}-${id}.zip`;
  const { error: upErr } = await supabase.storage.from("ticpe-exports").upload(zipPath, zip, { contentType: "application/zip" });
  if (upErr) return NextResponse.json({ error: `Échec de l'enregistrement de l'archive : ${upErr.message}` }, { status: 500 });
  const { data: ligne, error } = await supabase
    .from("ticpe_exports")
    .insert({
      organization_id: org.id,
      period_start: debut,
      period_end: fin,
      generated_by: appUser.id,
      file_path: zipPath,
      vehicle_count: vehicules.length,
      total_liters: recap.doc.totalLitresRetenus,
      total_refund: recap.doc.totalMontant,
      document_type: "dossier",
    })
    .select("id")
    .single();
  if (error && !estSchemaManquant(error)) console.error("dossier TICPE", error.message);
  const { data: signe } = await supabase.storage.from("ticpe-exports").createSignedUrl(zipPath, 600);
  await journaliser({ organizationId: org.id, userId: appUser.id, action: "ticpe_document_genere", targetTable: "ticpe_exports", targetId: ligne?.id ?? null, details: { document: "dossier", debut, fin, fichiers: fichiers.length, absents: absents.length } });
  if (garde.force) await journaliser({ organizationId: org.id, userId: appUser.id, action: "ticpe_document_force", targetTable: "ticpe_exports", targetId: ligne?.id ?? null, details: { document: "dossier", debut, fin, points_bloquants_non_resolus: garde.pointsNonResolus } });
  return NextResponse.json({ ok: true, url: signe?.signedUrl, fichiers: fichiers.length, absents: absents.length });
}
