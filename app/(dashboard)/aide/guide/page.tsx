import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { GUIDES, guideDe, guideFiltre } from "@/lib/guides/roles";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { MARQUEUR_GO_NAVIGATION } from "@/lib/acces/catalogue";

export const metadata = { title: "Guide d'utilisation — GODAC" };

/**
 * Guide d'utilisation par rôle, réservé aux entreprises clientes (pas à
 * l'espace de démonstration). Le guide du rôle de l'utilisateur s'affiche
 * par défaut ; les autres restent consultables. Les étapes des modules
 * non souscrits sont masquées.
 */
export default async function GuidePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const g = await garderPage("aide.guide");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const { data: organization } = await supabase.from("organizations").select("is_demo").eq("id", appUser.organization_id).single();
  const modules = [...g.modules];
  // Compte d'essai GO Navigation : son guide en 5 étapes, sans les autres rôles.
  const goNavigation = g.modules.has(MARQUEUR_GO_NAVIGATION);
  if ((organization as { is_demo?: boolean } | null)?.is_demo) {
    return <EmptyState title="Guide réservé aux entreprises clientes" description="Le guide d'utilisation complet est disponible dès la signature de votre abonnement GODAC." />;
  }

  const { role } = await searchParams;
  const guide = guideFiltre(guideDe(role ?? appUser.role, (role ?? appUser.role) === appUser.role && appUser.conduit, { goNavigation }), modules);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={guide.titre} description={guide.intro} />

      {!goNavigation && (
      <nav aria-label="Guides par rôle" className="flex flex-wrap gap-2">
        {GUIDES.map((g) => (
          <Link
            key={g.role}
            href={`/aide/guide?role=${g.role}`}
            aria-current={g.role === guide.role ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm ${g.role === guide.role ? "border-teal bg-teal/10 font-semibold" : "border-navy/10 hover:border-navy/25"}`}
          >
            {ROLE_LABELS[g.role]}
            {g.role === appUser.role && <span className="ml-1 text-xs text-navy/55">(vous)</span>}
          </Link>
        ))}
      </nav>
      )}

      {guide.sections.map((section) => (
        <Card key={section.titre} className="flex flex-col gap-4">
          <h2 className="text-lg">{section.titre}</h2>
          <ol className="flex flex-col gap-4">
            {section.etapes.map((e, i) => (
              <li key={e.titre} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold text-teal">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold">{e.titre}</p>
                  <p className="text-sm leading-relaxed text-navy/70">{e.texte}</p>
                  {e.lien && (
                    <Link href={e.lien.href} className="mt-1 inline-block text-sm font-semibold text-teal-ink hover:underline">
                      Ouvrir « {e.lien.label} » →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
