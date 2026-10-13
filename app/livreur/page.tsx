import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { AppLivreur } from "@/components/colis/AppLivreur";

export const metadata: Metadata = { title: "Livraison — GODAC" };

/**
 * Application chauffeur plein écran : seulement les adresses de la
 * tournée, dans l'ordre, avec appel du client et navigation. Hors du
 * tableau de bord (pas de menu) pour rester lisible au volant.
 */
export default async function LivreurPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/sign-in");
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "route_optimizer"))) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
        <p className="font-display text-lg font-bold">Module Tournée colis non activé</p>
        <p className="text-sm text-navy/65">La direction peut l&apos;activer depuis Modules &amp; tarifs.</p>
        <Link href="/dashboard" className="btn-secondary">
          Retour à GODAC
        </Link>
      </main>
    );
  }
  return <AppLivreur prenom={appUser.full_name.split(" ")[0] || null} />;
}
