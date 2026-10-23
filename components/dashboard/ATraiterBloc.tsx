import { Card } from "@/components/ui";
import { ATraiter } from "@/components/dashboard/ATraiter";
import { chargerATraiter } from "@/lib/a-traiter/serveur";
import type { AppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Aperçu « À traiter aujourd'hui » du tableau de bord (exploitation,
 * direction). À monter dans un <Suspense> : la liste se charge sans
 * retarder le reste de l'accueil, et une erreur ne le casse jamais
 * (message discret à la place).
 */
export async function ATraiterBloc({ appUser, enabledModules, ecartsIds }: { appUser: AppUser; enabledModules: string[]; ecartsIds?: readonly string[] }) {
  try {
    const supabase = await createServerSupabaseClient();
    const r = await chargerATraiter(supabase, appUser, new Set(enabledModules), { ecartsIds, delaiMs: 5000 });
    return <ATraiter presentation="apercu" elements={r.elements} erreurs={r.erreurs} plafonnes={r.plafonnes} maintenantIso={new Date().toISOString()} />;
  } catch (e) {
    console.error("à traiter : aperçu", e instanceof Error ? e.message : e);
    return (
      <Card className="mb-6">
        <p className="text-sm text-navy/60">La liste « À traiter aujourd&apos;hui » n&apos;a pas pu être chargée pour le moment. Le reste de l&apos;accueil est à jour.</p>
      </Card>
    );
  }
}

/** Emplacement affiché pendant le chargement de l'aperçu. */
export function ATraiterAttente() {
  return (
    <Card className="mb-6">
      <p className="text-sm text-navy/60">Chargement de ce qui est à traiter aujourd&apos;hui…</p>
    </Card>
  );
}
