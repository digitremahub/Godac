import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { chargerPassages } from "@/lib/colis/fiche-du-jour";
import { cleCommune } from "@/lib/colis/villages";
import { jourDe } from "@/lib/planning/semaine";
import { cleRamasse, elementDuVillage, visiblesPour } from "@/lib/planning/fusion";
import type { FusionChargee } from "@/lib/planning/fusion-serveur";

/**
 * Tournée fusionnée : remet les fiches Tournée colis DÉJÀ créées des
 * chauffeurs en phase avec la répartition (villages et ramasses d'un
 * chauffeur seulement ; voir lib/planning/fusion.ts › visiblesPour).
 *
 * - ce qui ne revient plus au chauffeur est retiré de sa fiche, mais
 *   seulement s'il n'a rien de commencé : une liste qui porte des colis,
 *   un arrêt livré ou en échec ne sont JAMAIS supprimés (ils sont comptés
 *   et signalés à l'encadrement) ;
 * - ce qui lui revient et manque sur sa fiche y est ajouté (même chargement
 *   que la création de la fiche, sans doublon).
 * Les fiches pas encore créées prennent la répartition à leur création.
 */

export interface BilanSynchro {
  fiches: number;
  retires: number;
  conserves: number;
  avertissement: string | null;
}

export async function resynchroniserFiches(organizationId: string, fusion: FusionChargee, entree: { service_id: string; tour_number: string; start_at: string }): Promise<BilanSynchro> {
  const bilan: BilanSynchro = { fiches: 0, retires: 0, conserves: 0, avertissement: null };
  try {
    const admin = createAdminSupabaseClient();
    const jour = jourDe(entree.start_at);
    const veille = new Date(Date.parse(`${jour}T12:00:00Z`) - 86_400_000).toISOString();
    const lendemain = new Date(Date.parse(`${jour}T12:00:00Z`) + 86_400_000).toISOString();
    const { data: sorties } = await admin
      .from("planning_entries")
      .select("id, driver_id, service_id, tour_number, start_at, status")
      .eq("organization_id", organizationId)
      .eq("service_id", entree.service_id)
      .eq("tour_number", entree.tour_number)
      .in("status", ["planned", "in_progress"])
      .not("driver_id", "is", null)
      .gte("start_at", veille)
      .lt("start_at", lendemain);
    const entrees = ((sorties ?? []) as { id: string; driver_id: string; service_id: string; tour_number: string; start_at: string; status: string }[]).filter((e) => jourDe(e.start_at) === jour);

    // Chauffeurs auxquels la répartition attribue quelque chose, même sans affectation sœur.
    for (const e of entrees) {
      const conducteur = { id: e.driver_id, organization_id: organizationId };
      const { data: fiches } = await admin.from("delivery_runs").select("id, planning_entry_id, status").eq("organization_id", organizationId).eq("driver_id", e.driver_id).eq("run_date", jour).neq("status", "done");
      const portees = ((fiches ?? []) as { id: string; planning_entry_id: string | null }[]).filter((f) => f.planning_entry_id === e.id);
      let liees: { id: string }[] = portees;
      if (!liees.length) {
        const { data: reliees } = await admin.from("planning_entries").select("delivery_run_id").eq("id", e.id).maybeSingle();
        const idFiche = (reliees as { delivery_run_id?: string | null } | null)?.delivery_run_id;
        liees = idFiche ? ((fiches ?? []) as { id: string }[]).filter((f) => f.id === idFiche) : [];
      }
      const visibles = visiblesPour(e.driver_id, fusion.elements, fusion.lignes);
      for (const fiche of liees) {
        bilan.fiches++;
        await retirerCeQuiNeRevientPlus(admin, organizationId, fiche.id, fusion, visibles, bilan);
        try {
          const portes = entrees.filter((x) => x.driver_id === e.driver_id);
          await chargerPassages(admin, conducteur, fiche.id, [e], portes);
        } catch (err) {
          console.warn("[colis/fusion-fiches] Ajout à la fiche incomplet", { runId: fiche.id, error: err instanceof Error ? err.message : err });
          bilan.avertissement = "Certaines fiches n'ont pas pu être complétées : le chauffeur les retrouvera en rouvrant sa tournée.";
        }
      }
    }
    if (bilan.conserves) {
      bilan.avertissement = [bilan.avertissement, `${bilan.conserves} élément${bilan.conserves > 1 ? "s" : ""} déjà commencé${bilan.conserves > 1 ? "s" : ""} sur une fiche, laissé${bilan.conserves > 1 ? "s" : ""} en place.`].filter(Boolean).join(" ");
    }
  } catch (err) {
    console.warn("[colis/fusion-fiches] Fiches non synchronisées", err instanceof Error ? err.message : err);
    bilan.avertissement = "Répartition enregistrée, mais les fiches déjà créées n'ont pas pu être mises à jour.";
  }
  return bilan;
}

async function retirerCeQuiNeRevientPlus(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  organizationId: string,
  runId: string,
  fusion: FusionChargee,
  visibles: ReturnType<typeof visiblesPour>,
  bilan: BilanSynchro,
): Promise<void> {
  const listesRes = await admin.from("delivery_lists").select("id, name, village_id").eq("run_id", runId);
  const listes = (listesRes.error ? ((await admin.from("delivery_lists").select("id, name").eq("run_id", runId)).data ?? []) : (listesRes.data ?? [])) as { id: string; name: string; village_id?: string | null }[];
  const { data: arrets } = await admin.from("delivery_stops").select("id, list_id, kind, address, status, parcel_count").eq("run_id", runId);
  const stops = (arrets ?? []) as { id: string; list_id: string | null; kind: string; address: string; status: string; parcel_count: number | null }[];
  // Un arrêt « sans rien de commencé » : ramasse encore à faire, sans colis.
  const sansRien = (s: { kind: string; status: string; parcel_count: number | null }) => s.kind === "ramasse" && s.status === "pending" && !(s.parcel_count ?? 0);

  // 1. Ramasses attribuées à un autre chauffeur.
  for (const s of stops) {
    if (s.kind !== "ramasse") continue;
    const cle = cleRamasse(s.address);
    if (!fusion.elements.ramasses.some((r) => r.cle === cle) || visibles.ramasseCles.has(cle)) continue;
    if (!sansRien(s)) {
      bilan.conserves++;
      continue;
    }
    const { error } = await admin.from("delivery_stops").delete().eq("id", s.id).eq("organization_id", organizationId);
    if (!error) {
      bilan.retires++;
      s.status = "retiree";
    }
  }

  // 2. Villages attribués à un autre chauffeur : la liste part si elle est vide.
  for (const l of listes) {
    const element = elementDuVillage({ id: l.village_id ?? "", name: l.name }, fusion.elements.villages) ?? fusion.elements.villages.find((v) => cleCommune(v.label) === cleCommune(l.name)) ?? null;
    if (!element || visibles.villageIds.has(element.cle)) continue;
    const restants = stops.filter((s) => s.list_id === l.id && s.status !== "retiree");
    if (restants.some((s) => !sansRien(s))) {
      bilan.conserves++;
      continue;
    }
    for (const s of restants) await admin.from("delivery_stops").delete().eq("id", s.id).eq("organization_id", organizationId);
    const { error } = await admin.from("delivery_lists").delete().eq("id", l.id).eq("organization_id", organizationId);
    if (!error) bilan.retires++;
  }
}
