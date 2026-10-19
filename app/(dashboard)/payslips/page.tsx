import { garderPage } from "@/lib/acces/garde-page";
import { BadgeValidation } from "@/components/paie/ValidationBulletins";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import Link from "next/link";
import { OngletsPaie } from "@/components/paie/OngletsPaie";

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/**
 * Module Fiches de Paie — indicative PDF document generated from the
 * salary already on file (user_contracts), not a real payroll engine
 * (no cotisation detail, no DSN — see the disclaimer baked into every
 * generated PDF and the legality discussion that scoped this down).
 * Direction generates for anyone; everyone else sees only their own.
 */
export default async function PayslipsPage() {
  const g = await garderPage("moi.fiches_paie");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;

  // Direction : tous les bulletins, avec leur statut de validation.
  // Les autres (comptable compris, pour ses propres fiches) : leurs
  // bulletins VALIDÉS uniquement — la RLS l'impose aussi au salarié.
  const isDirection = appUser.role === "direction";

  const [{ data: payslipRows }] = await Promise.all([
    (() => {
      let query = supabase
        .from("payslips")
        .select("id, period_start, period_end, gross_amount, net_amount, meal_vouchers_amount, bonus_amount, file_path, validation_status, users!payslips_user_id_fkey(full_name)")
        .order("period_start", { ascending: false })
        .limit(100);
      if (!isDirection) query = query.eq("user_id", appUser.id).eq("validation_status", "valide");
      return query;
    })(),
  ]);

  const withUrls = await Promise.all(
    (payslipRows ?? []).map(async (p: any) => {
      const { data: signed } = await supabase.storage.from("payslips").createSignedUrl(p.file_path, 300);
      return { ...p, downloadUrl: signed?.signedUrl ?? null };
    }),
  );

  return (
    <div>
      <PageHeader
        title={isDirection ? "Paie & salaires" : "Fiches de paie"}
        description="Bulletins indicatifs générés à partir du salaire brut/net enregistré."
      />
      {isDirection && <OngletsPaie actif="fiches" paie planning={g.modules.has("planning")} />}

      {isDirection && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Les bulletins se préparent salarié par salarié dans le moteur de paie (heures, primes, cotisations).</span>
          <Link href="/paie" className="btn-primary !py-2 text-sm">
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
