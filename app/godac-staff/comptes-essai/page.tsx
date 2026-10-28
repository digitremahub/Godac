import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card, StatTile } from "@/components/ui";
import { chargerComptes } from "@/lib/comptes-essai/serveur";
import { compterParStatut, FENETRE_USAGE_JOURS, SOURCE_ACTIVITE } from "@/lib/comptes-essai/regles";
import { ComptesEssaiListe } from "@/components/godac-staff/ComptesEssaiListe";

/**
 * Backoffice GODAC › Comptes d'essai : toutes les organisations hors
 * démonstration, leur état d'abonnement / d'essai, leur usage récent, et les
 * actions de suspension, rétablissement et révocation. Même contrôle d'accès
 * que app/godac-staff/page.tsx (GODAC_STAFF_EMAILS, client service, hors RLS).
 */
export const dynamic = "force-dynamic";

export default async function ComptesEssaiPage() {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();
  const { data: profil } = await admin.from("users").select("organization_id").eq("id", user!.id).maybeSingle();
  const organisationDuStaffId = (profil as { organization_id?: string } | null)?.organization_id ?? null;
  const comptes = await chargerComptes(admin, organisationDuStaffId);

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <PageHeader title="Comptes d'essai" description="Toutes les organisations hors démonstration : abonnement ou essai, usage récent, suspension. Usage interne GODAC." />
      <p className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <Link href="/godac-staff" className="text-teal-ink hover:underline">
          ← Backoffice opérateur
        </Link>
        <Link href="/godac-staff/usage-essais" className="font-semibold text-teal-ink hover:underline">
          Usage des essais →
        </Link>
        <Link href="/godac-staff/go-navigation" className="font-semibold text-teal-ink hover:underline">
          Invitations GO Navigation →
        </Link>
      </p>

      {!comptes ? (
        <Card>
          <p className="text-sm text-navy/70">Les organisations n&apos;ont pas pu être lues. Réessayez dans un instant.</p>
        </Card>
      ) : (
        <>
          <Synthese lignes={comptes.lignes} />
          <ComptesEssaiListe lignes={comptes.lignes} suspensionDisponible={comptes.suspensionDisponible} />
          <p className="mt-4 max-w-3xl text-xs text-navy/60">
            {SOURCE_ACTIVITE} Usage : tournées et arrêts créés sur les {FENETRE_USAGE_JOURS} derniers jours, consommation (journal des usages). Une suspension coupe l&apos;accès de tous les utilisateurs au prochain appel, sans rien supprimer ; les routes publiques, webhooks et tâches
            planifiées ne sont pas concernés.
          </p>
        </>
      )}
    </main>
  );
}

function Synthese({ lignes }: { lignes: Parameters<typeof compterParStatut>[0] }) {
  const c = compterParStatut(lignes);
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatTile label="Comptes" value={String(c.tous)} />
      <StatTile label="Essais en cours" value={String(c.essai_en_cours)} />
      <StatTile label="Essais terminés" value={String(c.essai_termine)} accent="gold" />
      <StatTile label="Suspendus" value={String(c.suspendu)} accent="orange" />
      <StatTile label="Abonnés" value={String(c.abonne)} />
    </div>
  );
}
