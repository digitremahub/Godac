import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import { ImageCarousel } from "@/components/marketing/ImageCarousel";
import { HeroIllustration } from "@/components/marketing/HeroIllustration";
import { IconDroplet, IconTruck, IconCalendar, IconFileText } from "@/components/layout/icons";

const HOME_SLIDES = [
  { src: "/home/scene-ravitaillement.png", alt: "Un chauffeur scanne son ticket de ravitaillement, le PMP est recalculé automatiquement" },
  { src: "/home/scene-flotte.png", alt: "Tableau de bord de suivi de la flotte et des entretiens à prévoir" },
  { src: "/home/scene-carburant.png", alt: "Tableau de bord carburant avec suivi des dépenses et du prix moyen pondéré" },
  { src: "/home/scene-pilotage.png", alt: "Tableau de bord GODAC avec véhicules, chauffeurs et alertes en un coup d'œil" },
  { src: "/home/scene-gestion.png", alt: "Gestion centralisée des demandes, entretiens et documents de la flotte" },
];

const FEATURES = [
  {
    title: "Carburant & PMP",
    description: "Saisie manuelle ou OCR, prix moyen pondéré recalculé automatiquement, détection d'écart de totaliseur.",
    icon: IconDroplet,
  },
  {
    title: "Flotte & entretien",
    description: "Fiches véhicules, interventions avec niveaux d'urgence, demandes chauffeur → gestionnaire.",
    icon: IconTruck,
  },
  {
    title: "RH & planning",
    description: "Congés avec détection de chevauchement, dossiers employés, intranet et convocations.",
    icon: IconCalendar,
  },
  {
    title: "Conformité TICPE",
    description: "Export Excel filtré PL/SPL en self-service pour le rôle comptable, jamais les véhicules légers.",
    icon: IconFileText,
  },
];

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in visitors can still browse the marketing homepage (e.g.
  // coming back to "/" from a bookmark) — they just get a link to
  // their own space instead of every sign-up prompt.
  const appUser = user ? await getCurrentAppUser() : null;
  const spaceHref = user ? (appUser ? "/dashboard" : "/onboarding") : null;

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
          {spaceHref ? (
            <Link href={spaceHref} className="btn-secondary !px-4 !py-2 text-sm">
              Accéder à mon espace
            </Link>
          ) : (
            <Link href="/sign-in" className="btn-secondary !px-4 !py-2 text-sm">
              Connexion
            </Link>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <div className="flex flex-col items-center gap-7 text-center lg:items-start lg:text-left">
          <span className="badge-teal">SaaS pour le transport routier de marchandises</span>
          <h1 className="text-4xl leading-[1.1] sm:text-5xl md:text-6xl">
            L&apos;OS de backoffice pour les <span className="text-teal-ink">PME de transport</span>
          </h1>
          <p className="max-w-xl text-lg text-navy/60">
            Carburant, flotte, RH, planning et conformité TICPE — dans une seule
            plateforme pensée pour les PME de transport françaises.
          </p>
          <div className="flex flex-wrap justify-center gap-4 lg:justify-start">
            {spaceHref ? (
              <Link href={spaceHref} className="btn-primary !px-6 !py-3">
                Accéder à mon espace
              </Link>
            ) : (
              <Link href="/sign-up" className="btn-primary !px-6 !py-3">
                Essayer GODAC
              </Link>
            )}
            <Link href="/modules" className="btn-secondary !px-6 !py-3">
              Voir les modules et les tarifs
            </Link>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <HeroIllustration />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mb-14 text-center">
          <span className="badge-teal mb-4 inline-block">Comment ça marche</span>
          <h2 className="text-2xl sm:text-3xl">GODAC, en un coup d&apos;œil</h2>
          <p className="mx-auto mt-3 max-w-xl text-navy/60">
            De la pompe à la comptabilité, tout ce qu&apos;une PME de transport gère au
            quotidien, réuni dans un seul outil.
          </p>
        </div>
        <ImageCarousel slides={HOME_SLIDES} />
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card-hover flex flex-col gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal/10 ring-1 ring-teal/25">
                <feature.icon className="h-5 w-5 text-teal-ink" />
              </span>
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
