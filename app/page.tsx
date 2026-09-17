import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

const FEATURES = [
  {
    title: "Carburant & PMP",
    description: "Saisie manuelle ou OCR, prix moyen pondéré recalculé automatiquement, détection d'écart de totaliseur.",
  },
  {
    title: "Flotte & entretien",
    description: "Fiches véhicules, interventions avec niveaux d'urgence, demandes chauffeur → gestionnaire.",
  },
  {
    title: "RH & planning",
    description: "Congés avec détection de chevauchement, dossiers employés, intranet et convocations.",
  },
  {
    title: "Conformité TICPE",
    description: "Export Excel filtré PL/SPL en self-service pour le rôle comptable, jamais les véhicules légers.",
  },
];

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const appUser = await getCurrentAppUser();
    redirect(appUser ? "/dashboard" : "/onboarding");
  }

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-teal shadow-[0_2px_12px_-2px_rgba(27,228,193,0.6)]" />
          <span className="font-display text-xl font-extrabold">GODAC</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/modules" className="hidden text-sm text-navy/60 hover:text-navy sm:inline">
            Modules & tarifs
          </Link>
          <Link href="/sign-in" className="btn-secondary !px-4 !py-2 text-sm">
            Connexion
          </Link>
        </nav>
      </header>

      <section className="mx-auto flex max-w-3xl flex-col items-center gap-7 px-6 pb-20 pt-16 text-center sm:pt-24">
        <span className="badge-teal">SaaS pour le transport routier de marchandises</span>
        <h1 className="text-4xl leading-[1.1] sm:text-5xl md:text-6xl">
          L&apos;OS de backoffice pour les <span className="text-teal-ink">PME de transport</span>
        </h1>
        <p className="max-w-xl text-lg text-navy/60">
          Carburant, flotte, RH, planning et conformité TICPE — dans une seule
          plateforme pensée pour les PME de transport françaises.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/sign-up" className="btn-primary !px-6 !py-3">
            Essayer GODAC
          </Link>
          <Link href="/modules" className="btn-secondary !px-6 !py-3">
            Voir les modules et les tarifs
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card-hover flex flex-col gap-2">
              <h3 className="text-base">{feature.title}</h3>
              <p className="text-sm text-navy/55">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-navy/10 px-6 py-8 text-center text-sm text-navy/35">
        © {new Date().getFullYear()} GODAC — Plateforme de gestion pour le transport routier.
      </footer>
    </main>
  );
}
