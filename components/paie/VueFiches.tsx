import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { BadgeValidation } from "@/components/paie/ValidationBulletins";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import Link from "next/link";
import { RemiseElectronique } from "@/components/paie/RemiseElectronique";
import { etatRemise, LIBELLE_PAPIER, papierDemande, type PreferenceRemise } from "@/lib/paie/remise-electronique";

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/**
 * Bulletins de paie générés par le moteur (lib/paie). Direction et
 * comptable voient tous les bulletins et leur statut, avec la mention
 * « bulletin papier demandé » ; le salarié voit TOUS ses bulletins
 * validés, choisit la remise électronique ou papier (art. L3243-2) et
 * peut les télécharger en une archive ZIP.
 */
export async function VueFiches({ appUser, supabase, toutes }: { appUser: AppUser; supabase: SupabaseClient; toutes: boolean }) {
  // Équipe › Paie › Fiches (direction, comptable) : tous les bulletins avec
  // leur statut de validation. Mon espace › Mes fiches de paie : ses
  // bulletins VALIDÉS uniquement — la RLS l'impose aussi au salarié.
  const isDirection = toutes;

  const [{ data: payslipRows }, { data: preferences }] = await Promise.all([
    (() => {
      let query = supabase
        .from("payslips")
        .select("id, user_id, period_start, period_end, gross_amount, net_amount, meal_vouchers_amount, bonus_amount, file_path, validation_status, users!payslips_user_id_fkey(full_name)")
        .order("period_start", { ascending: false });
      // Le salarié voit tous ses bulletins validés ; la vue direction se limite aux 100 derniers.
      query = isDirection ? query.limit(100) : query.eq("user_id", appUser.id).eq("validation_status", "valide");
      return query;
    })(),
    // Choix de remise (migration 20261026000001) : table absente = électronique.
    (() => {
      const q = supabase.from("payslip_delivery_preferences").select("user_id, paper_requested, decided_at");
      return isDirection ? q : q.eq("user_id", appUser.id);
    })(),
  ]);
  const preferenceDe = new Map((preferences ?? []).map((p) => [p.user_id as string, p as PreferenceRemise]));

  // Liens signés en un seul appel : le salarié peut avoir des dizaines de bulletins.
  const lignes = (payslipRows ?? []) as any[];
  const chemins = lignes.map((p) => p.file_path).filter(Boolean) as string[];
  const { data: signes } = chemins.length ? await supabase.storage.from("payslips").createSignedUrls(chemins, 300) : { data: [] };
  const urlDe = new Map((signes ?? []).map((x) => [x.path, x.signedUrl]));
  const withUrls = lignes.map((p) => ({ ...p, downloadUrl: (p.file_path && urlDe.get(p.file_path)) || null }));

  return (
    <div>
      <PageHeader
        title={isDirection ? "Fiches de paie" : "Mes fiches de paie"}
        description={isDirection ? "Tous les bulletins générés et leur statut de validation." : "Vos bulletins de paie validés par la direction, depuis votre arrivée."}
        actions={
          // Archive de tous les bulletins : direction seulement (le comptable n'a que la liste).
          withUrls.length > 0 && (!isDirection || appUser.role === "direction") ? (
            <a href={isDirection ? "/api/paie/bulletins/archive?portee=tous" : "/api/paie/bulletins/archive"} className="btn-secondary !py-2 text-sm">
              {isDirection ? "Archiver tous les bulletins validés (ZIP)" : "Tous mes bulletins (ZIP)"}
            </a>
          ) : undefined
        }
      />

      {!isDirection && <RemiseElectronique etat={etatRemise(preferenceDe.get(appUser.id))} />}

      {isDirection && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Les bulletins se préparent salarié par salarié dans le moteur de paie (heures, primes, cotisations).</span>
          <Link href="/equipe/paie" className="btn-primary !py-2 text-sm">
            Préparer les bulletins
          </Link>
        </Card>
      )}

      {withUrls.length === 0 ? (
        <EmptyState title="Aucun bulletin généré." />
      ) : (
        <Card className="flex flex-col gap-1.5">
          {withUrls.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-t border-navy/5 py-2 text-sm first:border-t-0 first:pt-0">
              <span>
                {isDirection && <span className="font-medium">{p.users?.full_name ?? "—"} — </span>}
                {MONTH_LABEL.format(new Date(p.period_start))}
                {isDirection && p.validation_status !== "valide" && (
                  <span className="ml-2">
                    <BadgeValidation statut={p.validation_status} />
                  </span>
                )}
                {isDirection && papierDemande(preferenceDe.get(p.user_id)) && <span className="badge-gold ml-2">{LIBELLE_PAPIER}</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-navy/60">
                  {Number(p.gross_amount).toLocaleString("fr-FR")} € brut / {Number(p.net_amount).toLocaleString("fr-FR")} € net
                </span>
                {p.downloadUrl && (
                  <a href={p.downloadUrl} target="_blank" rel="noreferrer" className="text-teal-ink underline">
                    Télécharger
                  </a>
                )}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
