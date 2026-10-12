import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import Image from "next/image";
import { ImageCarousel } from "@/components/marketing/ImageCarousel";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import {
  IconArrowRight,
  IconCalendar,
  IconChartBar,
  IconCheck,
  IconClock,
  IconDroplet,
  IconFileText,
  IconPlay,
  IconQrCode,
  IconShieldCheck,
  IconTruck,
} from "@/components/layout/icons";

const TRUST_STATS = [
  { icon: IconClock, label: "Plus de temps pour l'essentiel" },
  { icon: IconShieldCheck, label: "Moins d'imprévus" },
  { icon: IconChartBar, label: "Une meilleure rentabilité" },
];

const HOME_SLIDES = [
  { src: "/home/scene-ravitaillement.png", alt: "Un chauffeur scanne son ticket de ravitaillement, le PMP est recalculé automatiquement" },
  { src: "/home/scene-flotte.png", alt: "Tableau de bord de suivi de la flotte et des entretiens à prévoir" },
  { src: "/home/scene-carburant.png", alt: "Tableau de bord carburant avec suivi des dépenses et du prix moyen pondéré" },
  { src: "/home/scene-pilotage.png", alt: "Tableau de bord GODAC avec véhicules, chauffeurs et alertes en un coup d'œil" },
  { src: "/home/scene-gestion.png", alt: "Gestion centralisée des demandes, entretiens et documents de la flotte" },
];

const REPLACES = ["Les tableurs Excel", "Les groupes WhatsApp", "Les tickets papier", "Les relances par téléphone"];

const FEATURES = [
  {
    title: "Carburant & PMP",
    description: "Saisie manuelle ou OCR du ticket, prix moyen pondéré recalculé tout seul, écart de totaliseur détecté.",
    icon: IconDroplet,
  },
  {
    title: "Flotte & entretien",
    description: "Fiches véhicules, interventions par niveau d'urgence, demandes du chauffeur directement au gestionnaire.",
    icon: IconTruck,
  },
  {
    title: "Planning & tournées",
    description: "Planning par service, départs et retours de tournée, rapports et kilométrages au même endroit.",
    icon: IconClock,
  },
  {
    title: "App chauffeur",
    description: "Badge QR et code PIN, plein, photo du compteur et signalement depuis le téléphone, sans formation.",
    icon: IconQrCode,
  },
  {
    title: "RH, congés & paie",
    description: "Congés sans chevauchement, dossiers employés, convocations, fiches de paie générées chaque mois.",
    icon: IconCalendar,
  },
  {
    title: "Conformité TICPE",
    description: "Export Excel filtré PL/SPL pour le comptable, jamais les véhicules légers. Prêt à déposer.",
    icon: IconFileText,
  },
];

export default async function HomePage({ searchParams }: { searchParams: { demo?: string } }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in visitors can still browse the marketing homepage (e.g.
  // coming back to "/" from a bookmark) — they just get a link to
  // their own space instead of every sign-up prompt.
  const appUser = user ? await getCurrentAppUser() : null;
  const spaceHref = user ? (appUser ? "/dashboard" : "/onboarding") : null;

  const primaryCta = spaceHref
    ? { href: spaceHref, label: "Accéder à mon espace" }
    : { href: "/sign-up", label: "Essayer GODAC" };

  return (
    <div className="min-h-screen">
      {/* ── Hero (marine, per the brand guide: white on deep navy) ── */}
      <div className="relative overflow-hidden bg-marine text-[#F0F4FF]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-20 h-[28rem] w-[28rem] rounded-full bg-teal/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-orange/10 blur-3xl" />

        <SiteHeader spaceHref={spaceHref} />

        <main>
          <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-28 lg:pt-16">
            <div className="flex flex-col gap-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">
                Le système d&apos;exploitation de la PME transport
              </p>
              <h1 className="text-[34px] leading-[1.1] tracking-tight sm:text-5xl lg:text-[52px]">
                Moins d&apos;imprévus, <span className="text-teal">plus de routes</span> à parcourir.
              </h1>
              <p className="max-w-xl text-pretty text-lg font-light leading-relaxed text-white/75">
                Carburant, flotte, entretiens, plannings, paie et documents&nbsp;: un seul outil pour tenir votre
                entreprise de transport, du dépôt jusqu&apos;à la comptabilité.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={primaryCta.href} className="btn-primary !px-6 !py-3.5 text-base">
                  {primaryCta.label}
                  <IconArrowRight className="h-5 w-5" />
                </Link>
                <a href="#demo" className="btn !px-5 !py-3.5 text-base text-white ring-1 ring-inset ring-white/20 hover:bg-white/10">
                  <IconPlay className="h-4 w-4 text-teal" />
                  Voir la démo
                </a>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-2">
                {TRUST_STATS.map((stat) => (
                  <li key={stat.label} className="flex items-center gap-2 text-sm text-white/70">
                    <stat.icon className="h-4 w-4 shrink-0 text-teal" />
                    {stat.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-pop ring-1 ring-white/10">
                <Image
                  src="/home/hero-crop.png"
                  alt="Camion sur une route de montagne, avec un aperçu du tableau de bord GODAC"
                  fill
                  priority
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="object-cover object-[88%_center]"
                />
              </div>
              <div aria-hidden="true" className="absolute -bottom-6 left-4 hidden items-center gap-3 rounded-2xl bg-surface p-4 pr-5 text-navy shadow-pop sm:flex lg:-left-8">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal text-marine">
                  <IconCheck className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold">Plein enregistré</span>
                  <span className="block text-xs text-navy/60">PMP recalculé automatiquement</span>
                </span>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* ── What GODAC replaces ── */}
      <section className="border-b border-navy/[0.08] bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-8 text-center sm:px-6 lg:flex-row lg:justify-between lg:text-left">
          <p className="font-display text-lg font-bold">Le transport mérite mieux qu&apos;Excel.</p>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {REPLACES.map((r) => (
              <li key={r} className="flex items-center gap-2 text-sm text-navy/65">
                <span aria-hidden="true" className="text-orange-ink">✕</span>
                <span className="line-through decoration-navy/30">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Demo ── */}
      <section id="demo" className="scroll-mt-6 bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="kicker !text-teal-ink">Démo en accès libre</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Essayez GODAC tout de suite, sans compte.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              Une entreprise de transport fictive, avec ses camions, ses chauffeurs, ses pleins et ses tournées. Cliquez, vous y êtes.
            </p>
            {searchParams.demo === "indisponible" && (
              <p role="alert" className="mt-4 text-sm font-semibold text-orange-ink">
                La démo est momentanément indisponible. Réessayez dans un instant.
              </p>
            )}
          </div>
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { href: "/demo?as=direction", title: "Côté direction", text: "Tableau de bord, flotte, carburant, planning, alertes et salaires.", icon: IconChartBar },
              { href: "/demo?as=chauffeur", title: "Côté chauffeur", text: "Tournée du jour, pleins, présences et papiers du camion, sur mobile.", icon: IconTruck },
            ].map((d) => (
              <a key={d.href} href={d.href} className="card-hover group flex flex-col gap-4">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-marine text-teal">
                  <d.icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-display text-lg font-bold">{d.title}</span>
                  <span className="mt-1 block text-sm text-navy/65">{d.text}</span>
                </span>
                <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-teal-ink">
                  Ouvrir la démo
                  <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="comment-ca-marche" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="kicker !text-teal-ink">Comment ça marche</p>
          <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">GODAC, en un coup d&apos;œil</h2>
          <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
            De la pompe à la comptabilité, tout ce qu&apos;une PME de transport gère au quotidien, réuni dans un seul outil.
          </p>
        </div>
        <ImageCarousel slides={HOME_SLIDES} />
      </section>

      {/* ── Modules ── */}
      <section className="bg-surface py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="kicker !text-teal-ink">Modules</p>
              <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Un seul réflexe. Toute la boîte.</h2>
            </div>
            <Link href="/modules" className="btn-secondary w-fit">
              Modules & tarifs
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="card flex flex-col gap-3 transition-[border-color,box-shadow] hover:border-navy/15 hover:shadow-raised">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-marine text-teal">
                  <feature.icon className="h-5 w-5" />
                </span>
                <h3 className="text-lg">{feature.title}</h3>
                <p className="text-pretty text-sm leading-relaxed text-navy/65">{feature.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Voice / proof ── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6 lg:py-24">
        <figure className="mx-auto max-w-3xl text-center">
          <blockquote className="font-display text-[22px] font-bold leading-snug sm:text-[30px]">
            «&nbsp;Un chauffeur malade lundi matin&nbsp;: remplaçant trouvé en 2&nbsp;clics.&nbsp;»
          </blockquote>
          <figcaption className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-navy/65">
            {["Planning partagé avec les chauffeurs", "Alertes en temps réel", "Données hébergées en France"].map((t) => (
              <span key={t} className="flex items-center gap-2">
                <IconCheck className="h-4 w-4 text-teal-ink" />
                {t}
              </span>
            ))}
          </figcaption>
        </figure>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-5 pb-20 sm:px-6">
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-3xl bg-marine px-6 py-14 text-center text-white sm:px-12 lg:flex-row lg:justify-between lg:text-left">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-teal/20 blur-3xl" />
          <div className="relative">
            <h2 className="text-[28px] leading-tight sm:text-4xl">Votre entreprise, organisée.</h2>
            <p className="mt-3 text-white/70">Carburant, flotte, équipes et comptabilité&nbsp;: tout au même endroit.</p>
          </div>
          <Link href={primaryCta.href} className="btn-primary relative shrink-0 !px-7 !py-3.5 text-base">
            {primaryCta.label}
            <IconArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
