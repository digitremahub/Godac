import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parisDay } from "@/lib/utils/paris-time";
import { estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { calculerTicpe } from "@/lib/ticpe/calcul-serveur";
import { chargerDeclarations } from "@/lib/ticpe/declarations-serveur";
import { controlesDeLaPeriode } from "@/lib/ticpe/periode-serveur";
import { compterParGravite } from "@/lib/ticpe/controles";
import { argentNonReclame, estDeclaree, prochaineEcheance, rappelEra } from "@/lib/ticpe/echeances";
import { lignesDeLaPeriode, totaliser } from "@/lib/ticpe/montant";
import { formatJour } from "@/lib/ticpe/bareme";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Rappel déjà envoyé (journal ticpe_rappels) ? Table absente : on considère « oui » pour ne pas répéter chaque jour. */
async function dejaEnvoye(admin: SupabaseClient, organizationId: string, kind: string, ref: string): Promise<boolean> {
  const { data, error } = await admin.from("ticpe_rappels").select("id").eq("organization_id", organizationId).eq("kind", kind).eq("ref", ref).limit(1);
  if (error) {
    console.error("ticpe_rappels", error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Cron quotidien TICPE (vercel.json), même contrôle CRON_SECRET que les
 * autres crons. Pour chaque organisation avec le module Export TICPE :
 *  - échéance de dépôt dans `rappel_jours` jours ou moins, période non
 *    déclarée, montant positif → rappel (une fois par période) ;
 *  - en janvier : rappel de l'état récapitulatif annuel (ERA) de l'année
 *    précédente, à établir au plus tard le 31 janvier (une fois par an) ;
 *  - d'octobre à décembre : montants de l'année N-2 non réclamés, perdus
 *    au 31 décembre (une fois par an).
 * Le rappel d'échéance dit aussi combien de points bloquants restent à régler
 * sur la période (écran « TICPE : à régler »). Destinataires : direction et
 * comptable, plus l'exploitation qui corrige ces points.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const aujourdhui = parisDay();
  const annee = Number(aujourdhui.slice(0, 4));
  const { data: orgs } = await admin.from("organization_modules").select("organization_id").eq("module_key", "ticpe_export").eq("enabled", true);

  let alertes = 0;
  const erreurs: string[] = [];
  for (const { organization_id: orgId } of (orgs ?? []) as { organization_id: string }[]) {
    try {
      const calcul = await calculerTicpe(admin, orgId, { anneeDebut: Math.max(2025, annee - 2), anneeFin: annee });
      const { reglages } = calcul.parametres;
      const { declarations } = await chargerDeclarations(admin, orgId);
      const montantDe = (p: { debut: string; fin: string }) => totaliser(lignesDeLaPeriode(calcul.lignes, p.debut, p.fin)).montant;
      const base = { organization_id: orgId, type: "ticpe_rappel", related_table: null, related_id: null, recipient_roles: ["direction", "comptable", "exploitation"] };
      const envoyer = async (kind: string, ref: string, severity: "warning" | "critical" | "info", message: string) => {
        if (await dejaEnvoye(admin, orgId, kind, ref)) return;
        const { error } = await admin.from("alerts").insert({ ...base, severity, message });
        if (error) {
          if (estValeurEnumInconnue(error)) erreurs.push("type d'alerte ticpe_rappel absent (migration 20261031000004)");
          else erreurs.push(error.message);
          return;
        }
        await admin.from("ticpe_rappels").upsert({ organization_id: orgId, kind, ref }, { onConflict: "organization_id,kind,ref", ignoreDuplicates: true });
        alertes++;
      };

      const e = prochaineEcheance(aujourdhui, reglages);
      const montant = montantDe(e.periode);
      if (e.joursRestants >= 0 && e.joursRestants <= reglages.rappel_jours && montant > 0 && !estDeclaree(e.periode, declarations)) {
        // Points bloquants restants : jamais bloquant pour le rappel lui-même.
        let bloquants = 0;
        try {
          bloquants = compterParGravite((await controlesDeLaPeriode(admin, orgId, e.periode, calcul)).points).bloquants;
        } catch (err) {
          console.error("cron TICPE : contrôles de la période", err instanceof Error ? err.message : err);
        }
        const restants = bloquants > 0 ? ` ${bloquants} point${bloquants > 1 ? "s" : ""} bloquant${bloquants > 1 ? "s" : ""} à régler avant de déclarer (Carburant › TICPE › À régler : correction groupée possible).` : "";
        await envoyer(
          "echeance",
          e.periode.cle,
          e.joursRestants <= 2 ? "critical" : "warning",
          `TICPE ${e.periode.libelle} : ${euros(montant)} préparés, à déclarer avec la TVA avant le ${formatJour(e.dateLimite)}.${restants} GODAC prépare les montants ; la déclaration reste faite par l'entreprise ou son expert-comptable.`,
        );
      }

      const era = rappelEra(aujourdhui);
      if (era && era.annee >= 2025) {
        await envoyer("era", String(era.annee), "warning", `État récapitulatif annuel (ERA) TICPE ${era.annee} à établir au plus tard le ${formatJour(era.dateLimite)} et à conserver : générez-le depuis Carburant › TICPE › Documents.`);
      }

      if (Number(aujourdhui.slice(5, 7)) >= 10) {
        const perdu = argentNonReclame(montantDe, declarations, aujourdhui, reglages.regime_tva).periodes.filter((p) => Number(p.periode.debut.slice(0, 4)) === annee - 2);
        const total = Math.round(perdu.reduce((n, p) => n + p.montant, 0) * 100) / 100;
        if (total > 0) {
          await envoyer("prescription", String(annee - 2), "critical", `TICPE ${annee - 2} : ${euros(total)} non réclamés, plus réclamables après le 31/12/${annee}.`);
        }
      }
    } catch (err) {
      erreurs.push(`${orgId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (erreurs.length) console.error("cron TICPE", erreurs);
  return NextResponse.json({ ok: true, organisations: orgs?.length ?? 0, alertes, erreurs: erreurs.length });
}
