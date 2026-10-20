import type { Metadata } from "next";
import { headers } from "next/headers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/ui";
import { AuthLayout, LegalLinks } from "@/components/auth/AuthLayout";
import { FormulaireGoNavigation } from "@/components/go-navigation/FormulaireGoNavigation";
import { invitationValide, limiteAtteinte, MESSAGE_LIEN_INVALIDE, noterAcces } from "@/lib/go-navigation/serveur";

export const metadata: Metadata = { title: "Essai GO Navigation — GODAC", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Page publique d'inscription à l'essai GO Navigation, ouverte seulement
 * par un lien d'invitation unique (généré par le staff GODAC). Le jeton est
 * vérifié côté serveur ; tout lien inutilisable affiche le même message,
 * sans dire pourquoi.
 */
export default async function InscriptionGoNavigationPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  const admin = createAdminSupabaseClient();
  const limite = await limiteAtteinte(admin, await headers(), false);
  const invitation = limite.message ? null : await invitationValide(admin, jeton);
  if (!invitation) {
    if (!limite.message) await noterAcces(admin, limite.ipHash, "echec");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <EmptyState title="Lien invalide" description={limite.message ?? MESSAGE_LIEN_INVALIDE} />
      </main>
    );
  }

  return (
    <AuthLayout footer={<LegalLinks />}>
      <FormulaireGoNavigation jeton={jeton} />
    </AuthLayout>
  );
}
