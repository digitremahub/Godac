import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { articlesSousSeuil, type ArticleSeuil, type Solde } from "@/lib/stock/soldes";
import {
  ROLES_DESTINATAIRES_STOCK,
  cleAlerteEcart,
  cleAlerteNonRentre,
  cleAlerteSeuil,
  decisionsNonRentre,
  decisionsSeuil,
  grouperNonRentrees,
  messageEcart,
  messageNonRentre,
  messageSeuil,
  type AlerteStockOuverte,
} from "@/lib/stock/alertes";
import { fetchAllRows } from "@/lib/utils/fetch-all";

/**
 * Écriture des alertes du stock (client administrateur : les alertes se créent
 * côté serveur). Jamais bloquant : une erreur est consignée et le bilan le dit ;
 * tant que les types d'alerte (migration 20261114000003) ne sont pas appliqués,
 * rien n'est créé (`typeAbsent`).
 */
type Db = SupabaseClient;

export interface BilanAlertesStock {
  creees: number;
  closes: number;
  typeAbsent: boolean;
  erreur: string | null;
}

const vide = (): BilanAlertesStock => ({ creees: 0, closes: 0, typeAbsent: false, erreur: null });

async function alertesOuvertes(admin: Db, organizationId: string, type: string): Promise<{ lignes: AlerteStockOuverte[]; typeAbsent: boolean }> {
  const { data, error } = await admin
    .from("alerts")
    .select("id, type, related_id, cle_dedoublonnage")
    .eq("organization_id", organizationId)
    .eq("type", type)
    .in("status", ["open", "acknowledged"])
    .limit(1000);
  if (error) {
    if (estValeurEnumInconnue(error)) return { lignes: [], typeAbsent: true };
    if (!estSchemaManquant(error)) console.warn("[stock] alertes non lues", error.message);
    return { lignes: [], typeAbsent: false };
  }
  return { lignes: (data ?? []) as AlerteStockOuverte[], typeAbsent: false };
}

async function clore(admin: Db, organizationId: string, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const { error } = await admin.from("alerts").update({ status: "resolved", acknowledged_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", [...ids]);
  if (error) {
    console.warn("[stock] alertes non closes", error.message);
    return 0;
  }
  return ids.length;
}

interface NouvelleAlerte {
  type: "stock_seuil" | "stock_ecart" | "stock_non_rentre";
  severity: "info" | "warning";
  message: string;
  related_table: string;
  related_id: string;
  service_id: string | null;
  cle: string;
}

/** Crée l'alerte ; clé déjà connue : l'alerte close est rouverte (sans nouveau message). */
async function creer(admin: Db, organizationId: string, a: NouvelleAlerte): Promise<{ creee: boolean; typeAbsent: boolean }> {
  const ligne = {
    organization_id: organizationId,
    type: a.type,
    severity: a.severity,
    message: a.message,
    related_table: a.related_table,
    related_id: a.related_id,
    recipient_roles: [...ROLES_DESTINATAIRES_STOCK],
    service_id: a.service_id,
  };
  let { error } = await admin.from("alerts").insert({ ...ligne, cle_dedoublonnage: a.cle });
  if (error && estSchemaManquant(error)) ({ error } = await admin.from("alerts").insert(ligne));
  if (!error) return { creee: true, typeAbsent: false };
  if (error.code === "23505") {
    const { data } = await admin.from("alerts").update({ status: "open", acknowledged_at: null, message: a.message }).eq("organization_id", organizationId).eq("cle_dedoublonnage", a.cle).eq("status", "resolved").select("id");
    return { creee: (data ?? []).length > 0, typeAbsent: false };
  }
  if (estValeurEnumInconnue(error)) return { creee: false, typeAbsent: true };
  console.warn("[stock] alerte non créée", error.message);
  return { creee: false, typeAbsent: false };
}

/** Articles sous leur seuil mini : une alerte par article, close quand le stock remonte. */
export async function synchroniserAlertesSeuil(admin: Db, organizationId: string): Promise<BilanAlertesStock> {
  const bilan = vide();
  try {
    const { data: articles, error } = await admin.from("stock_articles").select("id, code, nom, unite, seuil_mini, actif").eq("organization_id", organizationId).gt("seuil_mini", 0).limit(5000);
    if (error) {
      if (!estSchemaManquant(error)) bilan.erreur = error.message;
      return bilan;
    }
    const liste = ((articles ?? []) as (Omit<ArticleSeuil, "seuil_mini"> & { seuil_mini: number | string })[]).map((a) => ({ ...a, seuil_mini: Number(a.seuil_mini) }));
    const lus = await fetchAllRows<{ article_id: string; site_id: string; emplacement_id: string | null; lot: string; quantite: number | string }>(
      (a, b) => admin.from("stock_soldes").select("article_id, site_id, emplacement_id, lot, quantite").eq("organization_id", organizationId).order("id").range(a, b) as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>,
    );
    if (lus.error) {
      bilan.erreur = lus.error;
      return bilan;
    }
    const soldes: Solde[] = lus.rows.map((s) => ({ ...s, quantite: Number(s.quantite) }));
    const sous = articlesSousSeuil(liste, soldes);
    const { lignes, typeAbsent } = await alertesOuvertes(admin, organizationId, "stock_seuil");
    if (typeAbsent) return { ...bilan, typeAbsent };
    const { aSignaler, aClore } = decisionsSeuil(sous, lignes);
    bilan.closes = await clore(admin, organizationId, aClore);
    for (const x of aSignaler) {
      const r = await creer(admin, organizationId, { type: "stock_seuil", severity: "warning", message: messageSeuil(x), related_table: "stock_articles", related_id: x.article.id, service_id: null, cle: cleAlerteSeuil(x.article.id) });
      if (r.typeAbsent) return { ...bilan, typeAbsent: true };
      if (r.creee) bilan.creees++;
    }
  } catch (e) {
    bilan.erreur = e instanceof Error ? e.message : String(e);
    console.warn("[stock] alertes de seuil", bilan.erreur);
  }
  return bilan;
}

/** Unités encore en tournée (ou en retour non rangé) alors que leur tournée est clôturée. */
export async function synchroniserAlertesNonRentre(admin: Db, organizationId: string): Promise<BilanAlertesStock> {
  const bilan = vide();
  try {
    const { data: unites, error } = await admin
      .from("stock_unites")
      .select("run_id, statut, emplacement_id")
      .eq("organization_id", organizationId)
      .not("run_id", "is", null)
      .in("statut", ["en_tournee", "retour"])
      .limit(5000);
    if (error) {
      if (!estSchemaManquant(error)) bilan.erreur = error.message;
      return bilan;
    }
    // Un retour déjà rangé dans un emplacement est rentré.
    const nonRentrees = ((unites ?? []) as { run_id: string | null; statut: string; emplacement_id: string | null }[]).filter((u) => u.statut === "en_tournee" || u.emplacement_id === null);
    const runIds = [...new Set(nonRentrees.map((u) => u.run_id).filter((x): x is string => Boolean(x)))];
    const tournees = new Map<string, { libelle: string; service_id: string | null; cloturee: boolean }>();
    for (let i = 0; i < runIds.length; i += 200) {
      const { data: runs } = await admin.from("delivery_runs").select("id, name, run_date, status, service_id").eq("organization_id", organizationId).in("id", runIds.slice(i, i + 200));
      for (const r of (runs ?? []) as { id: string; name: string | null; run_date: string; status: string; service_id: string | null }[]) {
        tournees.set(r.id, { libelle: `${r.name ?? "sans nom"} du ${r.run_date.split("-").reverse().join("/")}`, service_id: r.service_id, cloturee: r.status === "done" });
      }
    }
    const groupes = grouperNonRentrees(nonRentrees, tournees);
    const { lignes, typeAbsent } = await alertesOuvertes(admin, organizationId, "stock_non_rentre");
    if (typeAbsent) return { ...bilan, typeAbsent };
    const { aSignaler, aClore } = decisionsNonRentre(groupes, lignes);
    bilan.closes = await clore(admin, organizationId, aClore);
    for (const t of aSignaler) {
      const r = await creer(admin, organizationId, {
        type: "stock_non_rentre",
        severity: "warning",
        message: messageNonRentre(t.nombre, t.libelle),
        related_table: "delivery_runs",
        related_id: t.run_id,
        service_id: t.service_id,
        cle: cleAlerteNonRentre(t.run_id),
      });
      if (r.typeAbsent) return { ...bilan, typeAbsent: true };
      if (r.creee) bilan.creees++;
    }
  } catch (e) {
    bilan.erreur = e instanceof Error ? e.message : String(e);
    console.warn("[stock] alertes d'unités non rentrées", bilan.erreur);
  }
  return bilan;
}

/** Inventaire validé avec des écarts : une alerte par inventaire. */
export async function alerterEcartInventaire(admin: Db, p: { organizationId: string; inventaireId: string; site: string; serviceId: string | null; phrase: string }): Promise<{ creee: boolean; typeAbsent: boolean }> {
  try {
    return await creer(admin, p.organizationId, {
      type: "stock_ecart",
      severity: "warning",
      message: messageEcart(p.site, p.phrase),
      related_table: "stock_inventaires",
      related_id: p.inventaireId,
      service_id: p.serviceId,
      cle: cleAlerteEcart(p.inventaireId),
    });
  } catch (e) {
    console.warn("[stock] alerte d'écart", e instanceof Error ? e.message : e);
    return { creee: false, typeAbsent: false };
  }
}

/** Après un retrait d'article ou un changement de seuil : réévalue les seuils (alerte créée ou close), sans jamais échouer. */
export async function reevaluerSeuils(organizationId: string): Promise<void> {
  try {
    await synchroniserAlertesSeuil(createAdminSupabaseClient(), organizationId);
  } catch (e) {
    console.warn("[stock] seuils non réévalués", e instanceof Error ? e.message : e);
  }
}
