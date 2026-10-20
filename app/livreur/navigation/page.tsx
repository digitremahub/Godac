import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { AppLivreur } from "@/components/colis/AppLivreur";
import { paysOrganisation } from "@/lib/pays/serveur";

export const metadata: Metadata = { title: "GO Navigation — GODAC" };

/**
 * GO Navigation : l'app chauffeur ouverte directement sur la vue
 * navigation (carte plein écran, trajet vers l'arrêt en cours, tournée dans
 * une feuille glissable). Tournée pas encore démarrée : écran de départ de
 * l'app chauffeur, qui bascule sur la navigation une fois la tournée lancée.
 */
export default async function NavigationLivreurPage() {
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
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  return <AppLivreur prenom={appUser.full_name.split(" ")[0] || null} pays={pays.code} vueInitiale="navigation" />;
}
