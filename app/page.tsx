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
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconCoins,
  IconCylinder,
  IconMapPin,
  IconDroplet,
  IconFileText,
  IconPlay,
  IconQrCode,
  IconTruck,
} from "@/components/layout/icons";

const TRUST_STATS = [
  { icon: IconDroplet, label: "Chaque litre tracé" },
  { icon: IconAlertTriangle, label: "Anomalies signalées" },
  { icon: IconCoins, label: "TICPE récupérée" },
];

/** Le cœur de l'offre : contrôler et réduire le poste carburant. */
const LEVIERS_CARBURANT = [
  {
    title: "Chaque plein rattaché",
    description: "Véhicule, chauffeur, kilométrage, litres et ticket (photo lue automatiquement) : plus aucun plein sans justificatif.",
    icon: IconDroplet,
  },
  {
    title: "Anomalies détectées",
    description: "Écart de totaliseur sur la cuve, consommation d'un véhicule qui dépasse le seuil que vous fixez : alerte immédiate au bon responsable.",
    icon: IconAlertTriangle,
  },
  {
    title: "Cuves et prix maîtrisés",
    description: "Niveau des cuves, prix moyen pondéré recalculé à chaque livraison, carte des prix stations pour faire le plein au bon endroit.",
    icon: IconCylinder,
  },
  {
    title: "Consommation par véhicule",
    description: "L/100 km sur 30 et 90 jours, comparés à la référence constructeur : vous savez quel camion ou quel chauffeur consomme trop.",
    icon: IconChartBar,
  },
  {
    title: "TICPE remboursée",
    description: "Export PL/SPL prêt pour le comptable chaque trimestre : le remboursement partiel de taxe n'est plus oublié.",
    icon: IconCoins,
  },
  {
    title: "Kilomètres justifiés",
    description: "Départs et retours de tournée avec photo du compteur : les litres sont confrontés aux kilomètres réellement parcourus.",
    icon: IconMapPin,
  },
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
    title: "Flotte & entretien",
    description: "Fiches véhicules, interventions par niveau d'urgence, demandes du chauffeur directement au gestionnaire.",
    icon: IconTruck,
  },
  {
    title: "Planning & tournées",
    description: "Planning par service, navigation vers la date souhaitée, affectations de chauffeurs et véhicules, départs et retours de tournée.",
    icon: IconClock,
  },
  {
    title: "Application chauffeur incluse dans l’écosystème",
    description: "Un outil mobile complémentaire pour simplifier les tournées, les ramasses, les points relais, le scan QR et les preuves de livraison. Accessible au grand public, avec des tarifs préférentiels pour les entreprises clientes de GODAC.",
    icon: IconQrCode,
  },
  {
    title: "RH, congés & paie",
    description: "Congés sans chevauchement, dossiers employés, convocations, fiches de paie générées chaque mois.",
    icon: IconCalendar,
  },
  {
    title: "Tournées colis & livraisons",
    description: "Préparez les tournées depuis GODAC : ramasses, points relais, adresses recherchées, créneaux professionnels et suivi des livraisons. L’application GO prolonge cette gestion sur le terrain.",
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
                Carburant cher&nbsp;? Contrôlez-le.
              </p>
              <h1 className="text-[34px] leading-[1.1] tracking-tight sm:text-5xl lg:text-[52px]">
                Votre carburant, <span className="text-teal">enfin sous contrôle</span>.
              </h1>
              <p className="max-w-xl text-pretty text-lg font-light leading-relaxed text-white/75">
                GODAC centralise la gestion de flotte, du carburant, du planning et des tournées colis. Pour prolonger cette gestion sur le terrain, l’application GO facilite le suivi des tournées, des ramasses, des points relais et des livraisons. GO est accessible au grand public, avec des tarifs préférentiels pour les entreprises clientes de GODAC.
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

      {/* ── Carburant : le cœur de l'offre ── */}
      <section id="carburant" className="scroll-mt-6 bg-paper py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="kicker !text-teal-ink">Carburant</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Savoir où part chaque litre, et arrêter les fuites.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              Le gazole est l&apos;un des plus gros postes d&apos;une entreprise de transport. GODAC le contrôle au plein près,
              sans ressaisie&nbsp;: le chauffeur photographie son ticket, GODAC fait le reste.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LEVIERS_CARBURANT.map((l) => (
              <li key={l.title} className="card flex flex-col gap-3">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal text-marine">
                  <l.icon className="h-5 w-5" />
                </span>
                <h3 className="text-lg">{l.title}</h3>
                <p className="text-pretty text-sm leading-relaxed text-navy/65">{l.description}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-center text-sm text-navy/60">
            Inclus dès le plan Essentiel, avec la lecture automatique des tickets.
          </p>
        </div>
      </section>

      {/* ── Demo ── */}
      <section id="demo" className="scroll-mt-6 bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="kicker !text-teal-ink">Démo en accès libre</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Essayez GODAC tout de suite, sans compte.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              Explorez la gestion GODAC côté direction et son complément mobile pour les opérations terrain : planning, flotte, carburant, tournées colis, ramasses, points relais et suivi des livraisons dans une entreprise fictive.
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
              { href: "/demo?as=chauffeur", title: "Application mobile terrain", text: "Un complément à la gestion GODAC pour consulter la tournée, gérer les adresses, scanner les colis et suivre les livraisons.", icon: IconTruck },
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
              <p className="kicker !text-teal-ink">Tout-en-un</p>
              <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Et le reste, sans un outil de plus.</h2>
              <p className="mt-3 text-pretty text-navy/65">
                Activez les modules dont vous avez besoin, quand vous en avez besoin&nbsp;: ils remplacent les logiciels de
                flotte, de planning, de tournée et de paie que vous payez à part.
              </p>
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
      <section className="mx-auto max-w-6xl px-5 py-12 sm:px-6 lg:py-16">
        <figure className="mx-auto max-w-3xl text-center">
          <figcaption className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-navy/65">
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
            <h2 className="text-[28px] leading-tight sm:text-4xl">Reprenez la main sur le carburant.</h2>
            <p className="mt-3 text-white/70">Puis ajoutez flotte, planning, tournées et paie dans le même outil.</p>
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
