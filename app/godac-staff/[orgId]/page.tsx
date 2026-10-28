import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card } from "@/components/ui";
import { apporteurStaff, nomsApporteurs } from "@/lib/partage-go/staff";
import { statutCompte } from "@/lib/partage-go/apporteur";
import { StaffUsersPanel } from "@/components/godac-staff/StaffUsersPanel";
import { FinContratStaff, type EtatFinContrat } from "@/components/godac-staff/FinContratStaff";
import { COLONNES_FIN_CONTRAT, dateFinContrat, dateSuppressionPrevue, preavisEnvoye, type OrganisationFinContrat } from "@/lib/fin-contrat/regles";

export default async function GodacStaffOrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!isGodacStaffEmail(user?.email)) {
    redirect("/dashboard");
  }

  const admin = createAdminSupabaseClient();
  const [{ data: organization }, { data: users }] = await Promise.all([
    admin.from("organizations").select("id, name").eq("id", orgId).single(),
    admin.from("users").select("id, full_name, email, role, active").eq("organization_id", orgId).order("full_name"),
  ]);

  if (!organization) redirect("/godac-staff");

  // Apporteur du compte d'essai (colonnes absentes avant la migration 20261103000003 : rien à afficher).
  const { data: attribution } = await admin
    .from("organizations")
    .select("referred_by_user_id, referred_by_org_id, subscription_status, trial_ends_at")
    .eq("id", orgId)
    .maybeSingle();
  const attrib = attribution as { referred_by_user_id: string | null; referred_by_org_id: string | null; subscription_status: string | null; trial_ends_at: string | null } | null;
  const apporteur = attrib?.referred_by_user_id
    ? apporteurStaff(attrib.referred_by_user_id, attrib.referred_by_org_id, await nomsApporteurs(admin, [attrib.referred_by_user_id], attrib.referred_by_org_id ? [attrib.referred_by_org_id] : []))
    : null;
  const etatCompte = attrib ? statutCompte(attrib) : null;

  // Fin de contrat (colonnes absentes avant la migration 20261112000001 : bloc masqué).
  const { data: brut, error: erreurFinContrat } = await admin.from("organizations").select(COLONNES_FIN_CONTRAT).eq("id", orgId).maybeSingle();
  let finContrat: EtatFinContrat | null = null;
  if (brut && !erreurFinContrat) {
    const o = brut as unknown as OrganisationFinContrat & { suppression_bloquee_le?: string | null; suppression_bloquee_par?: string | null };
    const { data: meta } = await admin.from("organizations").select("suppression_bloquee_le, suppression_bloquee_par").eq("id", orgId).maybeSingle();
    const fin = dateFinContrat(o);
    const preavis = fin ? preavisEnvoye(o, fin) : null;
    const jour = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null);
    finContrat = {
      finContrat: jour(fin),
      contratTermineLe: o.contrat_termine_le ? o.contrat_termine_le.slice(0, 10) : null,
      preavisEnvoyeLe: jour(preavis),
      suppressionPrevue: fin ? jour(dateSuppressionPrevue(fin, preavis, new Date())) : null,
      bloquee: Boolean(o.suppression_bloquee),
      motif: o.suppression_bloquee_motif ?? null,
      bloqueeLe: jour((meta as { suppression_bloquee_le?: string | null } | null)?.suppression_bloquee_le),
      bloqueePar: (meta as { suppression_bloquee_par?: string | null } | null)?.suppression_bloquee_par ?? null,
    };
  }

  return (
    <main className="min-h-screen p-6">
      <Link href="/godac-staff" className="text-sm text-teal-ink hover:underline">
        ← Toutes les organisations
      </Link>
      <PageHeader
        title={organization.name}
        description="Rôles et accès — hors RLS, sans la protection anti-verrouillage de l'admin client (voir app/api/godac-staff/users/[id])."
      />
      {apporteur && (
        <Card className="mb-4">
          <p className="text-sm font-semibold text-navy">Apporteur</p>
          <p className="text-sm text-navy/70">
            {apporteur.nom}
            {apporteur.organisation ? ` — ${apporteur.organisation}` : ""}
            {etatCompte === "abonnee" ? " · client payant (abonnement actif)" : etatCompte === "essai_en_cours" ? " · essai en cours" : " · essai terminé"}
          </p>
        </Card>
      )}
      {finContrat && <FinContratStaff organisationId={orgId} etat={finContrat} />}
      <StaffUsersPanel users={(users ?? []) as any} />
    </main>
  );
}
