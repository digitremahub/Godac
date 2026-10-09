import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { GeneratePayslipForm } from "@/components/payslips/GeneratePayslipForm";

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/**
 * Module Fiches de Paie — indicative PDF document generated from the
 * salary already on file (user_contracts), not a real payroll engine
 * (no cotisation detail, no DSN — see the disclaimer baked into every
 * generated PDF and the legality discussion that scoped this down).
 * Direction generates for anyone; everyone else sees only their own.
 */
export default async function PayslipsPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const payslipsEnabled = await isModuleEnabled(supabase, appUser.organization_id, "payslips");
  if (!payslipsEnabled) {
    return (
      <EmptyState
        title="Module Fiches de Paie non activé"
        description="Activez-le depuis les paramètres de votre organisation pour générer des bulletins indicatifs."
      />
    );
  }

  const isDirection = appUser.role === "direction";

  const [{ data: employees }, { data: payslipRows }] = await Promise.all([
    isDirection
      ? supabase.from("users").select("id, full_name").eq("organization_id", appUser.organization_id).eq("active", true).order("full_name")
      : Promise.resolve({ data: null }),
    (() => {
      let query = supabase
        .from("payslips")
        .select("id, period_start, period_end, gross_amount, net_amount, file_path, users(full_name)")
        .order("period_start", { ascending: false })
        .limit(100);
      if (!isDirection) query = query.eq("user_id", appUser.id);
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
      <PageHeader title="Fiches de paie" description="Bulletins indicatifs générés à partir du salaire brut/net enregistré." />

      {isDirection && (employees ?? []).length > 0 && (
        <Card className="mb-6">
          <GeneratePayslipForm employees={employees ?? []} />
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
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-navy/40">
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
