import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, mondayOf, toISODate } from "@/lib/planning/dates";
import { DOC_CARTE_GRISE } from "@/lib/ticpe/vehicules-serveur";
import { facultatif, inserer, type ContexteDemo } from "@/lib/demo/seed-modules";
import { FICHES_TICPE_DEMO, declarationsDemo, pdfFictif, pleinsStationDemo, type CamionDemo } from "@/lib/demo/donnees-ticpe";

/**
 * Démo — TICPE, planning publié et arrêt de travail (appelé par
 * seedModulesRecents, après le socle). Même tolérance que le reste du
 * seed : une colonne absente est retirée, une partie qui échoue est
 * journalisée et sautée. Les couleurs de l'entreprise restent celles de
 * GODAC (organizations.brand_colors = null).
 */

/** Absence de la démo : Thomas Garcia (V103) en arrêt maladie, de J-2 à J+4. */
export const ARRET_DEMO = { driver: "thomas", du: -2, au: 4 } as const;

/** Mise à jour tolérante : une colonne inconnue du schéma est retirée, puis on réessaie. */
async function mettreAJour(admin: SupabaseClient, table: string, id: string, valeurs: Record<string, unknown>) {
  let v = { ...valeurs };
  for (let essai = 0; essai < 12 && Object.keys(v).length; essai++) {
    const { error } = await admin.from(table).update(v).eq("id", id);
    if (!error) return;
    const colonne = /'([a-z0-9_]+)' column/.exec(error.message)?.[1];
    if (!colonne || !(colonne in v)) throw new Error(`${table} : ${error.message}`);
    const { [colonne]: _retiree, ...reste } = v;
    v = reste;
  }
}

async function televerser(admin: SupabaseClient, bucket: string, chemin: string, lignes: string[]): Promise<boolean> {
  const { error } = await admin.storage.from(bucket).upload(chemin, pdfFictif(lignes), { contentType: "application/pdf", upsert: true });
  if (error) console.warn(`Démo — fichier ${bucket}/${chemin} ignoré :`, error.message);
  return !error;
}

async function seedTicpe(c: ContexteDemo) {
  const { admin, orgId, userIds, today, at } = c;
  const { data: vehicules } = await admin.from("vehicles").select("id, registration, type, tank_capacity_liters").eq("organization_id", orgId);
  const parImmat = new Map((vehicules ?? []).map((v) => [v.registration as string, v as { id: string; registration: string; type: string; tank_capacity_liters: number | null }]));

  await inserer(admin, "ticpe_settings", { organization_id: orgId, regime_tva: "mensuel", updated_by: userIds.direction });

  // Fiches véhicules : PTAC et carte grise lue, confirmée par la direction.
  for (const [immat, fiche] of Object.entries(FICHES_TICPE_DEMO)) {
    const v = parImmat.get(immat);
    if (!v) continue;
    await mettreAJour(admin, "vehicles", v.id, {
      ptac_kg: fiche.ptac_kg,
      pays_immatriculation: "FR",
      cg_genre: fiche.cg_genre,
      cg_energie: fiche.cg_energie,
      cg_premiere_immat: fiche.cg_premiere_immat,
      cg_confirmee_le: fiche.carteGrise ? at(addDays(today, -40), "10:00") : null,
      cg_confirmee_par: fiche.carteGrise ? userIds.direction : null,
    });
    if (fiche.carteGrise) {
      const chemin = `${orgId}/demo/carte-grise-${immat}.pdf`;
      if (await televerser(admin, "vehicle-documents", chemin, ["Transports Demo - document fictif", `Carte grise ${immat} (exemple, sans valeur)`])) {
        await inserer(admin, "vehicle_documents", { organization_id: orgId, vehicle_id: v.id, doc_type: DOC_CARTE_GRISE, file_path: chemin, driver_visible: true, uploaded_by: userIds.direction });
      }
    }
  }

  // Factures de livraison de la cuve : justificatif des pleins à la cuve.
  await facultatif("factures de la cuve", async () => {
    const { data: livraisons } = await admin.from("tank_deliveries").select("id").eq("organization_id", orgId);
    for (const [i, l] of (livraisons ?? []).entries()) {
      const chemin = `${orgId}/demo/facture-livraison-${i + 1}.pdf`;
      if (await televerser(admin, "tank-invoices", chemin, ["Transports Demo - document fictif", `Facture de livraison de gazole n. ${i + 1} (exemple, sans valeur)`])) {
        await mettreAJour(admin, "tank_deliveries", l.id as string, { invoice_path: chemin });
      }
    }
  });

  // Pleins en station, janvier 2025 → mois dernier, avec justificatifs.
  const conducteur: Record<string, string> = {};
  for (const [driver, v] of Object.entries(c.vehicleByDriver)) conducteur[v.registration] = userIds[driver]!;
  const camions: CamionDemo[] = [...parImmat.values()]
    .filter((v) => (v.type === "PL" || v.type === "SPL") && conducteur[v.registration])
    .sort((a, b) => a.registration.localeCompare(b.registration))
    .map((v) => ({ registration: v.registration, reservoir: Number(v.tank_capacity_liters ?? 300) }));
  const pleins = pleinsStationDemo(today, camions);
  const lignes = pleins.map((p) => {
    const occurred = at(p.jour, p.heure);
    return {
      organization_id: orgId,
      vehicle_id: parImmat.get(p.registration)!.id,
      driver_id: conducteur[p.registration],
      created_by: conducteur[p.registration],
      tank_id: null,
      occurred_at: occurred,
      liters: p.liters,
      unit_price: p.unit_price,
      station_name: p.station_name,
      product: "gazole",
      status: "validated",
      validated_by: userIds.direction,
      validated_at: at(addDays(p.jour, 1), "09:00"),
      ticpe_justificatif: p.ticpe_justificatif,
      ticpe_justificatif_ref: p.ticpe_justificatif_ref,
    };
  });
  for (let i = 0; i < lignes.length; i += 200) await inserer(admin, "fuel_entries", lignes.slice(i, i + 200));

  // Déclarations passées : tout est déclaré jusqu'à l'avant-dernier mois, sauf deux mois de 2025.
  await facultatif("déclarations TICPE passées", async () => {
    const eligibles = new Set(Object.entries(FICHES_TICPE_DEMO).filter(([, f]) => f.ptac_kg !== null && f.ptac_kg >= 7500 && f.carteGrise).map(([r]) => r));
    const declarations = declarationsDemo(today, pleins, eligibles).map((d) => ({
      ...d,
      organization_id: orgId,
      regime_tva: "mensuel",
      montant_calcule: d.montant,
      note: "Déclaré par le cabinet comptable (démo).",
      created_by: userIds.direction,
    }));
    if (declarations.length) await inserer(admin, "ticpe_declarations", declarations);
  });
}

/** Semaine en cours publiée aux chauffeurs, et l'arrêt de travail de Thomas (sa tournée V103 reste à pourvoir). */
async function seedPlanningEtArret(c: ContexteDemo) {
  const { admin, orgId, userIds, services, today, at } = c;
  const lundi = toISODate(mondayOf(new Date(`${today}T12:00:00Z`)));
  await facultatif("publication du planning", async () => {
    await inserer(admin, "planning_validations", services.map((s) => ({ organization_id: orgId, service_id: s.id, week_start: lundi, validated_by: userIds.direction, validated_at: at(addDays(lundi, -3), "17:30") })));
  });

  const du = addDays(today, ARRET_DEMO.du);
  const au = addDays(today, ARRET_DEMO.au);
  const service = services[1]!;
  const [arret] = await inserer(
    admin,
    "work_stoppages",
    {
      organization_id: orgId,
      user_id: userIds[ARRET_DEMO.driver],
      stoppage_type: "maladie",
      start_date: du,
      end_date: au,
      status: "valide",
      service_id: service.id,
      declared_by: userIds[ARRET_DEMO.driver],
      created_by: userIds[ARRET_DEMO.driver],
      validated_by: userIds.direction,
      validated_at: at(du, "11:20"),
      notes: "Arrêt initial, déclaré par le salarié depuis son téléphone.",
    },
    "id",
  );
  await facultatif("alerte de l'arrêt de travail", async () => {
    await inserer(admin, "alerts", {
      organization_id: orgId,
      type: "work_stoppage",
      severity: "warning",
      message: `Arrêt de travail de Thomas Garcia jusqu'au ${au.split("-").reverse().join("/")} : la tournée V103 est à remplacer au planning.`,
      related_table: "work_stoppages",
      related_id: arret?.id ?? null,
      recipient_roles: ["manager", "exploitation", "direction"],
      service_id: service.id,
    });
  });
}

export async function seedTicpeEtPlanning(c: ContexteDemo) {
  await facultatif("TICPE", () => seedTicpe(c));
  await facultatif("planning publié et arrêt de travail", () => seedPlanningEtArret(c));
}

/** Supprime les fichiers fictifs (cartes grises, factures de cuve) avant la suppression de l'organisation. */
export async function supprimerFichiersTicpeDemo(admin: SupabaseClient, orgId: string) {
  for (const bucket of ["vehicle-documents", "tank-invoices"]) {
    try {
      const { data } = await admin.storage.from(bucket).list(`${orgId}/demo`);
      const chemins = (data ?? []).map((f) => `${orgId}/demo/${f.name}`);
      if (chemins.length) await admin.storage.from(bucket).remove(chemins);
    } catch (e) {
      console.warn(`Démo — nettoyage ${bucket} ignoré :`, e instanceof Error ? e.message : e);
    }
  }
}
