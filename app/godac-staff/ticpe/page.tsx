import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card } from "@/components/ui";
import { BaremeTicpeStaff } from "@/components/godac-staff/BaremeTicpeStaff";
import { chevauchements, normaliserLigne, type LigneBareme } from "@/lib/ticpe/bareme";

/**
 * Backoffice GODAC › Barème TICPE : taux de remboursement datés, par
 * activité et zone, avec leur source. S'applique à toutes les
 * organisations (qui peuvent le surcharger pour un cas particulier).
 * Même contrôle d'accès que app/godac-staff/page.tsx (GODAC_STAFF_EMAILS).
 */
export default async function BaremeTicpeStaffPage() {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();
  const [{ data, error }, { count: surcharges }] = await Promise.all([
    admin.from("ticpe_rates").select("id, categorie, zone, date_debut, date_fin, taux_eur_hl, source, source_url, verifie_le, a_confirmer, note, updated_by_email").order("date_debut", { ascending: false }),
    admin.from("ticpe_rate_overrides").select("id", { count: "exact", head: true }).is("revoked_at", null),
  ]);
  const lignes = ((data ?? []) as any[]).map((l) => normaliserLigne(l) as LigneBareme & { id: string; updated_by_email: string | null });
  const conflits = chevauchements(lignes);
  const aCompleter = lignes.filter((l) => l.taux_eur_hl === null).length;

  return (
    <main className="min-h-screen p-6">
      <PageHeader
        title="Barème TICPE"
        description="Taux de remboursement partiel d'accise sur le gazole (€/hl), datés, par activité et zone. Toute modification s'applique immédiatement à toutes les organisations."
      />
      {error ? (
        <Card>
          <p className="text-sm text-navy/70">Barème indisponible : appliquez la migration 20261031000001_ticpe_bareme_reglages.sql.</p>
        </Card>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-navy/70">
            {aCompleter} ligne(s) sans taux (affichées « taux manquant » chez les clients) · {surcharges ?? 0} taux particulier(s) actif(s) chez les clients.
          </p>
          {conflits.length > 0 && (
            <p className="mb-3 text-sm text-orange-ink">
              {conflits.length} chevauchement(s) de périodes : la ligne commencée le plus tard l&apos;emporte. Vérifiez les dates de fin.
            </p>
          )}
          <BaremeTicpeStaff lignes={lignes} />
        </Card>
      )}
    </main>
  );
}
