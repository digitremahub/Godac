import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";
import { PageHeader, EmptyState } from "@/components/ui";
import { contextePaie, moisValide } from "@/lib/paie/donnees";
import { currentMonth } from "@/lib/planning/dates";
import { PaieEditor } from "@/components/paie/PaieEditor";

export default async function PaieSalariePage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ mois?: string }> }) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return <EmptyState title="Accès réservé" description="La paie est réservée à la direction." />;
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "payslips"))) {
    return <EmptyState title="Module Fiches de paie non activé" />;
  }
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return <EmptyState title={`Paie : ${pays.drapeau} ${pays.nom}`} description={paieIndisponible(pays)} />;
  const { userId } = await params;
  const sp = await searchParams;
  const mois = moisValide(sp.mois) ? sp.mois : currentMonth();

  const { data: salarie } = await supabase.from("users").select("id, full_name, role_title").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!salarie) notFound();

  const ctx = await contextePaie(supabase, appUser.organization_id, userId, mois);
  const label = new Date(`${ctx.debut}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  const { joursTravailles, ...prefill } = ctx.prefill;
  // Un bulletin déjà généré ce mois-ci : on reprend ses variables.
  const variables = ctx.bulletinExistant?.variables ? { ...prefill, ...ctx.bulletinExistant.variables } : prefill;

  return (
    <div>
      <PageHeader
        title={`${salarie.full_name} — ${label}`}
        description={salarie.role_title ?? undefined}
        actions={
          <Link href={`/paie?mois=${mois}`} className="btn-secondary !py-2 text-sm">
            ← Tous les salariés
          </Link>
        }
      />
      <PaieEditor
        key={`${userId}-${mois}`}
        userId={userId}
        mois={mois}
        legal={ctx.legal}
        entreprise={ctx.entreprise}
        profil={ctx.salarie}
        coefficient={ctx.coefficient}
        profilComplet={ctx.profilComplet}
        prefill={variables}
        joursTravailles={joursTravailles}
        dejaGenere={Boolean(ctx.bulletinExistant)}
      />
    </div>
  );
}
