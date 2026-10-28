import { redirect } from "next/navigation";
import { etatModulesCourant, utilisateurCourant } from "@/lib/acces/modules-requete";
import { EssaiTermine } from "@/components/go-navigation/EssaiTermine";
import { tryAutoProvisionInvitedUser } from "@/lib/auth/provisioning";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { StyleCouleursEntreprise } from "@/components/layout/StyleCouleursEntreprise";
import { couleursOrganisation } from "@/lib/theme/couleurs-entreprise-serveur";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { CompteSuspendu } from "@/components/comptes-essai/CompteSuspendu";
import { compteSuspenduDeLUtilisateurCourant } from "@/lib/comptes-essai/garde";
import type { Metadata } from "next";

/** Espace privé : jamais indexé par les moteurs de recherche. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Partagé (cache de requête) avec garderPage() de la page affichée.
  let appUser = await utilisateurCourant();

  if (!appUser) {
    // Compte suspendu par GODAC : écran clair (l'accès est déjà refusé par
    // getCurrentAppUser), sans repasser par l'inscription ni la création du profil.
    if (await compteSuspenduDeLUtilisateurCourant()) {
      return (
        <main>
          <CompteSuspendu />
        </main>
      );
    }
    // An invited user's first visit after clicking their email link
    // finishes silently here; an organic sign-up gets sent to
    // onboarding to create their own organisation.
    appUser = await tryAutoProvisionInvitedUser();
  }

  if (!appUser) {
    redirect("/onboarding");
  }

  const supabase = await createServerSupabaseClient();
  // Lien « Back-office GODAC » : seulement pour les adresses de GODAC_STAFF_EMAILS (jamais pour un client).
  const { data: { user: utilisateurAuth } } = await supabase.auth.getUser();
  const estStaffGodac = isGodacStaffEmail(utilisateurAuth?.email);
  const isFieldRole = appUser.conduit;
  const [{ modules, offre }, { data: organization }, activeTour, couleurs] = await Promise.all([
    etatModulesCourant(appUser.organization_id),
    supabase.from("organizations").select("name, logo_url, accent_color, is_demo").eq("id", appUser.organization_id).single(),
    isFieldRole
      ? supabase.from("planning_entries").select("id").eq("driver_id", appUser.id).eq("status", "in_progress").maybeSingle()
      : Promise.resolve({ data: null }),
    couleursOrganisation(supabase, appUser.organization_id),
  ]);

  // Essai GO Navigation terminé : plus d'accès à l'espace, message clair.
  if (offre.essaiTermine) return <EssaiTermine />;
  const enabledModuleKeys = [...modules];

  // Lot B: absent (not just visually hidden) the moment either the
  // org hasn't enabled the module or the server has no Anthropic key
  // configured — never a client-side check, so there's no flash of a
  // button that would then fail on first use.
  const assistantAvailable = enabledModuleKeys.includes("assistant") && Boolean(process.env.ANTHROPIC_API_KEY);
  const messengerAvailable = enabledModuleKeys.includes("messenger");

  return (
    <>
    <StyleCouleursEntreprise couleurs={couleurs} />
    <DashboardShell
      isDemo={Boolean((organization as { is_demo?: boolean } | null)?.is_demo)}
      role={appUser.role}
      conduit={appUser.conduit}
      enabledModuleKeys={enabledModuleKeys}
      organizationName={organization?.name ?? "GODAC"}
      logoUrl={organization?.logo_url ?? null}
      // Couleurs de l'entreprise choisies : l'accent du menu suit la
      // couleur principale (variable --c-teal-sur-menu, lisible sur le menu).
      accentColor={couleurs ? null : (organization?.accent_color ?? null)}
      fullName={appUser.full_name}
      roleTitle={appUser.role_title}
      hasActiveTour={Boolean(activeTour.data)}
      assistantAvailable={assistantAvailable}
      messengerAvailable={messengerAvailable}
      currentUserId={appUser.id}
      organizationId={appUser.organization_id}
      estStaffGodac={estStaffGodac}
    >
      {children}
    </DashboardShell>
    </>
  );
}
