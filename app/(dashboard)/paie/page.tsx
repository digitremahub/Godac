import Link from "next/link";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { bornesMois, moisValide } from "@/lib/paie/donnees";
import { addMonths, currentMonth } from "@/lib/planning/dates";

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Vue du mois : un bulletin à préparer par salarié, avec son état. Direction uniquement. */
export default async function PaiePage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return <EmptyState title="Accès réservé" description="La paie est réservée à la direction." />;
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "payslips"))) {
    return <EmptyState title="Module Fiches de paie non activé" description="Activez-le depuis Modules & tarifs." />;
  }
  const params = await searchParams;
  const mois = moisValide(params.mois) ? params.mois : currentMonth();
  const { debut, fin } = bornesMois(mois);

  const [{ data: salaries }, { data: profils }, { data: bulletins }, { data: reglages }] = await Promise.all([
    supabase.from("users").select("id, full_name, role_title").eq("active", true).order("full_name"),
    supabase.from("payroll_profiles").select("user_id, hourly_rate, regime"),
    supabase.from("payslips").select("user_id, gross_amount, net_amount, employer_cost, details").eq("period_start", debut).eq("period_end", fin),
    supabase.from("payroll_settings").select("organization_id").maybeSingle(),
  ]);
  const profilDe = new Map((profils ?? []).map((p) => [p.user_id, p]));
  const bulletinDe = new Map((bulletins ?? []).map((b) => [b.user_id, b]));
  const calcules = (bulletins ?? []).filter((b) => b.details);
  const total = (k: "gross_amount" | "net_amount" | "employer_cost") => calcules.reduce((t, b) => t + Number(b[k] ?? 0), 0);
  const label = new Date(`${debut}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <PageHeader
        title="Paie"
        description="Préparez et générez les bulletins du mois : heures des tournées, congés et frais sont préremplis, les cotisations calculées automatiquement."
        actions={
          <Link href="/paie/parametres" className="btn-secondary !py-2 text-sm">
            Réglages de paie
          </Link>
        }
      />
      {!reglages && (
        <p className="mb-4 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
          Commencez par les <Link href="/paie/parametres" className="font-semibold underline">réglages de paie</Link> : effectif, taux accident du travail,
          prévoyance et mutuelle.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/paie?mois=${addMonths(mois, -1)}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          ← Préc.
        </Link>
        <span className="text-sm font-semibold capitalize">{label}</span>
        <Link href={`/paie?mois=${addMonths(mois, 1)}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          Suiv. →
        </Link>
      </div>

      {calcules.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Masse salariale brute", total("gross_amount")],
            ["Nets à payer", total("net_amount")],
            ["Coût employeur", total("employer_cost")],
          ].map(([l, v]) => (
            <Card key={l as string} className="!py-3">
              <p className="text-xs text-navy/60">{l}</p>
              <p className="font-display text-xl font-bold tabular-nums">{eur(v as number)}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="!p-0">
        <ul className="divide-y divide-navy/[0.07]">
          {(salaries ?? []).map((s) => {
            const p = profilDe.get(s.id);
            const b = bulletinDe.get(s.id);
            return (
              <li key={s.id}>
                <Link href={`/paie/${s.id}?mois=${mois}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-navy/[0.03] sm:px-5">
                  <span>
                    <span className="font-semibold">{s.full_name}</span>
                    <span className="ml-2 text-sm text-navy/55">{s.role_title ?? ""}</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    {!p?.hourly_rate && <span className="rounded-full bg-gold/25 px-2 py-0.5 text-xs font-semibold">Profil à compléter</span>}
                    {b ? (
                      <span className="rounded-full bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal-ink">
                        Généré · net {eur(Number(b.net_amount ?? 0))}
                      </span>
                    ) : (
                      <span className="text-navy/55">À préparer →</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
