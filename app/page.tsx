import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import { ImageCarousel } from "@/components/marketing/ImageCarousel";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { HeroScene3D } from "@/components/marketing/HeroScene3D";
import { AnimationGodac } from "@/components/marketing/AnimationGodac";
import { BandeauReassurance, CommentCaMarche, CorpsDeMetier, FaqAccueil } from "@/components/marketing/SectionsAccueil";
import { ModulesProfondeur } from "@/components/marketing/ModulesProfondeur";
import { MaquetteGoNavigation } from "@/components/marketing/MaquetteGoNavigation";
import {
  IconArrowRight,
  IconAlertTriangle,
  IconBell,
  IconCalendar,
  IconCamera,
  IconChartBar,
  IconCheck,
  IconClock,
  IconCoins,
  IconCylinder,
  IconDroplet,
  IconFileText,
  IconFingerprint,
  IconFlag,
  IconMapPin,
  IconMessage,
  IconPaperclip,
  IconPlay,
  IconQrCode,
  IconShieldCheck,
  IconSparkles,
  IconTruck,
  IconUsers,
  IconWrench,
} from "@/components/layout/icons";

/**
 * TICPE — argument n° 1 de l'accueil. Chaque étape correspond à une
 * fonction livrée (lib/ticpe, Carburant › TICPE). Aucun montant n'est
 * promis : l'exemple chiffré est présenté comme tel.
 */
const ETAPES_TICPE = [
  {
    title: "Vos camions éligibles, repérés",
    description: "GODAC lit la carte grise (PTAC, genre, énergie) et marque chaque véhicule éligible, exclu ou à vérifier, avec ses dates : poids lourds de 7,5 t et plus, au gazole.",
    icon: IconTruck,
  },
  {
    title: "Le montant, plein par plein",
    description: "Chaque plein éligible est chiffré au barème daté de sa période (2026 : 15,56 €/hl en métropole, 14,21 €/hl en Corse ; taux à vérifier sur impots.gouv.fr). Pas de tableur à tenir à jour.",
    icon: IconCoins,
  },
  {
    title: "Contrôlé avant de déclarer",
    description: "Plein sans justificatif, doublon probable, taux manquant, consommation anormale, PTAC inconnu : vous corrigez avant, pas pendant un contrôle.",
    icon: IconShieldCheck,
  },
  {
    title: "Les documents prêts",
    description: "Récapitulatif pour l'annexe 3310-TIC de votre déclaration de TVA, état récapitulatif annuel par véhicule et dossier de contrôle complet en ZIP.",
    icon: IconFileText,
  },
  {
    title: "Rappelé à temps",
    description: "Prochaine échéance de dépôt affichée et rappel automatique : plus de trimestre oublié.",
    icon: IconBell,
  },
];

/** Ce que montre le tableau de bord TICPE (Carburant › TICPE). */
const TABLEAU_TICPE = [
  "Le montant récupérable de la période en cours",
  "La prochaine échéance de dépôt, avec rappel",
  "L'argent non réclamé sur les années encore réclamables (jusqu'au 31 décembre de la deuxième année suivante)",
];

/** Le carburant au quotidien : contrôler et réduire le poste gazole. */
const LEVIERS_CARBURANT = [
  {
    title: "Chaque plein rattaché",
    description: "Véhicule, chauffeur, kilométrage, litres et ticket : le chauffeur photographie son ticket et son compteur, GODAC lit les chiffres.",
    icon: IconDroplet,
  },
  {
    title: "Écarts détectés et traités",
    description: "Écart de totaliseur, prix ou consommation anormale : alerte au bon responsable, qui justifie l'écart ou demande une explication au chauffeur.",
    icon: IconAlertTriangle,
  },
  {
    title: "Cuves et prix maîtrisés",
    description: "Niveau des cuves, prix moyen pondéré recalculé à chaque livraison, prix payé à chaque plein : vous suivez ce que coûte chaque litre.",
    icon: IconCylinder,
  },
  {
    title: "Consommation par véhicule",
    description: "L/100 km sur 30 et 90 jours, alerte sur une consommation anormale : vous savez quel camion consomme trop.",
    icon: IconChartBar,
  },
  {
    title: "Justificatifs rangés",
    description: "Photo du ticket, référence du relevé de carte ou de la facture, facture de livraison de cuve : chaque plein garde sa preuve, prête pour la TICPE et pour un contrôle.",
    icon: IconPaperclip,
  },
  {
    title: "Kilomètres justifiés",
    description: "Départs et retours de tournée avec photo du compteur : les litres sont confrontés aux kilomètres réellement parcourus.",
    icon: IconMapPin,
  },
];

const FLOTTE = [
  {
    title: "Flotte & entretien",
    description: "Fiches véhicules, carte grise lue automatiquement, interventions par niveau d'urgence, demandes du chauffeur directement au gestionnaire.",
    icon: IconWrench,
  },
  {
    title: "Véhicules loués",
    description: "Contrats suivis : forfait kilométrique, fin de contrat signalée à l'avance, demandes d'entretien transmises au loueur.",
    icon: IconFileText,
  },
  {
    title: "Départs et retours de tournée",
    description: "Kilométrage et état du véhicule au départ comme au retour, pour chaque affectation du planning.",
    icon: IconClock,
  },
  {
    title: "Amendes et contestations",
    description: "Amendes rattachées au bon chauffeur, contestations clients suivies avec leurs preuves : photos, horaires, historique de livraison.",
    icon: IconFlag,
  },
];

const PLANNING_PAIE = [
  {
    kicker: "Planning",
    title: "La semaine construite une fois, publiée aux chauffeurs.",
    icon: IconCalendar,
    points: [
      "Vue jour, semaine ou mois : on affecte et on déplace par glisser-déposer, ou en touchant sur téléphone.",
      "Heures modifiables tournée par tournée ; deux tournées à la même heure pour un chauffeur en combiné.",
      "Recopie de la semaine en un clic : les absents ne sont pas replacés, les trous sautent aux yeux.",
      "Publication aux chauffeurs : chacun reçoit son planning, puis seulement ce qui change.",
      "Affectations récurrentes pour générer la semaine type.",
    ],
  },
  {
    kicker: "Absences",
    title: "Un arrêt de travail déclaré en une photo.",
    icon: IconCamera,
    points: [
      "Le salarié photographie le volet employeur de son arrêt depuis son téléphone.",
      "Le planning est alerté aussitôt : vous savez quelle tournée remplacer.",
      "L'arrêt est repris automatiquement dans la paie et dans les heures.",
      "Congés sans chevauchement, soldes visibles au moment de la demande.",
    ],
  },
  {
    kicker: "Paie transport",
    title: "Des bulletins conventionnels, validés par la direction.",
    icon: IconFileText,
    points: [
      "Convention transport (IDCC 16) : paniers, primes, heures supplémentaires, prélèvement à la source, net social.",
      "Heures reprises du badge, du planning ou du retour de tournée.",
      "Bulletins PDF, registre du personnel et export comptable.",
      "Acomptes demandés depuis le téléphone, déduits automatiquement.",
    ],
  },
];

const ET_AUSSI = [
  {
    title: "Rôles et validation en chaîne",
    description: "Direction, exploitation, manager, comptable, chauffeur : chacun voit ce qui le concerne. Personne ne règle sa propre demande : elle remonte au niveau supérieur.",
    icon: IconUsers,
  },
  {
    title: "Messenger & groupes d'équipe",
    description: "Les consignes restent dans GODAC, pas dans les conversations personnelles.",
    icon: IconMessage,
  },
  {
    title: "Accès simples et sûrs",
    description: "Connexion par Face ID ou empreinte, sans e-mail. Rôle « manager qui conduit » pour l'encadrant qui prend le volant.",
    icon: IconFingerprint,
  },
  {
    title: "À vos couleurs",
    description: "L'interface prend les couleurs de votre entreprise, pour vos équipes comme pour vos chauffeurs.",
    icon: IconSparkles,
  },
];

const HOME_SLIDES = [
  { src: "/home/scene-ravitaillement.png", alt: "Un chauffeur scanne son ticket de ravitaillement, le PMP est recalculé automatiquement" },
  { src: "/home/scene-carburant.png", alt: "Tableau de bord carburant avec suivi des dépenses et du prix moyen pondéré" },
  { src: "/home/scene-flotte.png", alt: "Tableau de bord de suivi de la flotte et des entretiens à prévoir" },
  { src: "/home/scene-pilotage.png", alt: "Tableau de bord GODAC avec véhicules, chauffeurs et alertes en un coup d'œil" },
  { src: "/home/scene-gestion.png", alt: "Gestion centralisée des demandes, entretiens et documents de la flotte" },
];

const REPLACES = ["Le tableur TICPE", "Les tickets papier", "Les groupes WhatsApp", "Les relances par téléphone"];

/** Tournée colis (avant GO Navigation, qui ferme la page). */
const TOURNEE_COLIS = [
  {
    title: "Préparer",
    icon: IconQrCode,
    points: [
      "Scan des codes-barres et Datamatrix, ou lecture de l’étiquette par photo : téléphone et poids repris automatiquement.",
      "Import d’un bordereau en photo, quel que soit le transporteur.",
      "Établissements pros retrouvés par leur nom, avec leurs horaires d’ouverture pris en compte dans l’optimisation.",
      "Optimisation sur les kilomètres routiers, listes par village créées automatiquement.",
    ],
  },
  {
    title: "Livrer",
    icon: IconTruck,
    points: [
      "Toute la tournée dans le même écran : arrêts, ramasses, points relais, ajout d’une adresse oubliée.",
      "Preuve de livraison : photo, QR code, heure de passage.",
      "Arrêts clôturés dans n’importe quel ordre, réordonnés par glisser-déposer.",
    ],
  },
  {
    title: "Suivre",
    icon: IconChartBar,
    points: [
      "Le chauffeur confirme sa tournée et coche ses villages avant de partir.",
      "La direction voit l’historique de livraison de chaque arrêt.",
      "Tournée verrouillée après clôture ; une tournée supplémentaire reste possible dans la journée.",
    ],
  },
];

/** GO Navigation : volontairement en dernier, en avant-première. */
const GO_NAVIGATION = [
  "L’heure d’arrivée bien visible, en permanence.",
  "Navigation au choix : GO, Waze ou Google Maps.",
  "Vue conduite qui suit la position, indications de direction, voix en option.",
  "Les arrêts de la tournée sous les yeux, sans changer d’application.",
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
    : { href: "/contact", label: "Demander un essai" };

  return (
    <div className="min-h-screen">
      <SiteHeader spaceHref={spaceHref} />

      {/* ── Hero (marine, per the brand guide: white on deep navy) ── */}
      <div className="relative overflow-hidden bg-marine text-[#F0F4FF]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-20 h-[28rem] w-[28rem] rounded-full bg-teal/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-orange/10 blur-3xl" />

        <main>
          <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-24 lg:pt-20">
            <div className="flex flex-col gap-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">
                Transport routier · Carburant &amp; TICPE
              </p>
              <h1 className="text-[36px] leading-[1.08] tracking-tight sm:text-5xl lg:text-[56px]">
                Votre carburant, <span className="text-teal">enfin sous contrôle.</span>
              </h1>
              <p className="max-w-xl text-pretty text-lg font-light leading-relaxed text-white/80">
                GODAC calcule à chaque plein la TICPE à récupérer sur vos poids lourds, contrôle les justificatifs et prépare les
                documents pour votre comptable. Flotte, planning, paie et tournées colis viennent ensuite, dans le même outil.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={primaryCta.href} className="btn-primary !px-6 !py-3.5 text-base">
                  {primaryCta.label}
                  <IconArrowRight className="h-5 w-5" />
                </Link>
                <a href="#demo" className="btn !px-5 !py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10">
                  <IconPlay className="h-4 w-4 text-teal" />
                  Voir la démo
                </a>
              </div>
              <a href="#comment-ca-marche" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-teal hover:underline">
                Comment ça marche
                <IconArrowRight className="h-4 w-4" />
              </a>
            </div>

            <HeroScene3D />
          </section>

          {/* ── Le nom, en animation : G·O·D·A·C ── */}
          <section aria-labelledby="titre-godac" className="relative border-t border-white/10">
            <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
              <div className="mx-auto mb-10 max-w-2xl text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Le nom GODAC</p>
                <h2 id="titre-godac" className="mt-3 text-[28px] leading-tight sm:text-4xl">
                  Ce que veut dire GODAC.
                </h2>
              </div>
              <AnimationGodac />
            </div>
          </section>
        </main>
      </div>

      <BandeauReassurance />

      {/* ── What GODAC replaces ── */}
      <section className="border-b border-navy/[0.08] bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-8 text-center sm:px-6 lg:flex-row lg:justify-between lg:text-left">
          <p className="font-display text-lg font-bold">Votre gestion mérite mieux que des outils dispersés.</p>
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

      {/* ── Les modules en un coup d'œil (3D décorative, ordre de la vitrine) ── */}
      <section id="modules" className="scroll-mt-20 bg-paper py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="kicker !text-teal-ink">Les modules</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Un module à la fois, dans l&apos;ordre qui vous convient.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              On commence par la TICPE et le gazole, puis on ajoute la flotte, le planning et la paie, la tournée colis quand vous le décidez.
            </p>
          </div>
          <ModulesProfondeur />
        </div>
      </section>

      <CommentCaMarche />
      <CorpsDeMetier />

      {/* ── TICPE : l'argument n° 1 ── */}
      <section id="ticpe" className="scroll-mt-20 bg-paper py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="kicker !text-teal-ink">TICPE</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Récupérez votre TICPE sans tableur.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              Sur le gazole de vos poids lourds de 7,5&nbsp;t et plus, une partie de la taxe vous est remboursée. Encore
              faut-il savoir quels camions comptent, quels litres, à quel taux, et ne pas laisser passer l&apos;échéance.
              GODAC s&apos;en charge à partir des pleins que vous saisissez déjà.
            </p>
          </div>

          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {ETAPES_TICPE.map((e, i) => (
              <li key={e.title} className="card flex flex-col gap-3">
                <span className="flex items-center justify-between">
                  <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal text-marine">
                    <e.icon className="h-5 w-5" />
                  </span>
                  <span className="font-display text-2xl font-extrabold text-navy/15">{i + 1}</span>
                </span>
                <h3 className="text-lg leading-snug">{e.title}</h3>
                <p className="text-pretty text-sm leading-relaxed text-navy/65">{e.description}</p>
              </li>
            ))}
          </ol>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="card flex flex-col gap-4">
              <h3 className="text-lg">Un tableau de bord qui répond à trois questions</h3>
              <ul className="flex flex-col gap-2.5">
                {TABLEAU_TICPE.map((point) => (
                  <li key={point} className="flex gap-2 text-pretty text-sm leading-relaxed text-navy/70">
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-ink" />
                    {point}
                  </li>
                ))}
              </ul>
              <p className="rounded-xl bg-paper p-3 text-sm leading-relaxed text-navy/70">
                GODAC prépare les montants et les justificatifs&nbsp;; la déclaration reste faite par l&apos;entreprise ou son
                expert-comptable.
              </p>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-marine p-6 text-white shadow-raised">
              <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal/20 blur-3xl" />
              <p className="relative text-xs font-semibold uppercase tracking-[0.18em] text-teal">Exemple</p>
              <p className="relative mt-3 text-pretty text-white/75">3 camions × 30 000 L de gazole par an × 0,1556 €/L</p>
              <p className="relative mt-2 font-display text-4xl font-extrabold">≈ 14 000 €<span className="text-xl font-bold text-white/70"> / an</span></p>
              <p className="relative mt-4 text-pretty text-xs leading-relaxed text-white/60">
                Illustration au taux 2026 en métropole (15,56 €/hl), pas une promesse&nbsp;: le montant réel dépend de vos
                litres éligibles, des véhicules retenus, de la zone et du barème de chaque période.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Carburant au quotidien ── */}
      <section id="carburant" className="scroll-mt-20 border-t border-navy/[0.08] bg-surface py-20 lg:py-24">
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
        </div>
      </section>

      {/* ── Flotte ── */}
      <section id="flotte" className="scroll-mt-20 border-t border-navy/[0.08] bg-paper py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="kicker !text-teal-ink">Flotte</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Vos véhicules suivis, de la carte grise à l&apos;amende.</h2>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FLOTTE.map((f) => (
              <li key={f.title} className="card flex flex-col gap-3">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-marine text-teal">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="text-lg">{f.title}</h3>
                <p className="text-pretty text-sm leading-relaxed text-navy/65">{f.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Planning, absences, paie ── */}
      <section id="planning-paie" className="scroll-mt-20 border-t border-navy/[0.08] bg-surface py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="kicker !text-teal-ink">Planning, RH &amp; paie</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Du planning au bulletin, sans ressaisie.</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {PLANNING_PAIE.map((bloc) => (
              <div key={bloc.kicker} className="card flex flex-col gap-4">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal text-marine">
                  <bloc.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="kicker !text-teal-ink">{bloc.kicker}</p>
                  <h3 className="mt-2 text-xl leading-tight">{bloc.title}</h3>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {bloc.points.map((point) => (
                    <li key={point} className="flex gap-2 text-pretty text-sm leading-relaxed text-navy/70">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-ink" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="kicker !text-teal-ink">Et aussi</p>
              <h2 className="mt-3 text-2xl leading-tight sm:text-[28px]">Le reste, sans un outil de plus.</h2>
            </div>
            <Link href="/modules" className="btn-secondary w-fit">
              Modules & tarifs
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ET_AUSSI.map((feature) => (
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

      {/* ── How it works ── */}
      <section id="en-images" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="kicker !text-teal-ink">En images</p>
          <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">GODAC, en un coup d&apos;œil</h2>
          <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
            Pleins, cuves, flotte et pilotage&nbsp;: quelques écrans de l&apos;application.
          </p>
        </div>
        <ImageCarousel slides={HOME_SLIDES} />
      </section>

      {/* ── Demo ── */}
      <section id="demo" className="scroll-mt-20 bg-paper">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="kicker !text-teal-ink">Démo en accès libre</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Essayez GODAC tout de suite, sans compte.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              Une entreprise de transport fictive, avec des données fictives&nbsp;: TICPE à déclarer et ses contrôles, pleins et
              cuve, planning de la semaine avec un chauffeur en arrêt, paie et tournées colis.
            </p>
            {searchParams.demo === "indisponible" && (
              <p role="alert" className="mt-4 text-sm font-semibold text-orange-ink">
                La démo est momentanément indisponible. Réessayez dans un instant.
              </p>
            )}
          </div>
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { href: "/demo?as=direction", title: "Côté direction", text: "Tableau de bord TICPE, contrôles avant déclaration, écarts carburant, planning de la semaine et bulletins.", icon: IconChartBar },
              { href: "/demo?as=chauffeur", title: "Côté chauffeur", text: "Pleins en photo, planning publié, tournée colis du jour, congés et acomptes, sur mobile.", icon: IconTruck },
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

      {/* ── Tournée colis ── */}
      <section id="tournee-colis" className="scroll-mt-20 bg-surface py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="kicker !text-teal-ink">Tournée colis</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Du scan du colis à la preuve de livraison.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              La tournée se prépare depuis le planning, quel que soit le transporteur donneur d&apos;ordre.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {TOURNEE_COLIS.map((bloc) => (
              <li key={bloc.title} className="card flex flex-col gap-4">
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-marine text-teal">
                    <bloc.icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-lg">{bloc.title}</h3>
                </span>
                <ul className="flex flex-col gap-2.5">
                  {bloc.points.map((point) => (
                    <li key={point} className="flex gap-2 text-pretty text-sm leading-relaxed text-navy/70">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-ink" />
                      {point}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── GO Navigation : en dernier, pour éveiller la curiosité ── */}
      <section id="go-navigation" className="scroll-mt-20 border-t border-navy/[0.08] bg-paper py-20 lg:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <p className="kicker !text-teal-ink">En avant-première · GO Navigation</p>
            <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Et pour vos chauffeurs, un GPS pensé pour la tournée.</h2>
            <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
              GO Navigation guide le chauffeur d&apos;arrêt en arrêt, aux couleurs GODAC. On vous le montre de vive voix.
            </p>
            <ul className="mt-6 flex flex-col gap-2.5">
              {GO_NAVIGATION.map((point) => (
                <li key={point} className="flex gap-2 text-pretty text-sm leading-relaxed text-navy/70">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-ink" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/contact?essai=go-navigation" className="btn-primary !px-6 !py-3.5 text-base">
                Demander un essai
                <IconArrowRight className="h-5 w-5" />
              </Link>
              <a href="/demo?as=chauffeur" className="btn-secondary !px-5 !py-3.5 text-base">
                <IconPlay className="h-4 w-4" />
                Démo côté chauffeur
              </a>
            </div>
            <p className="mt-3 text-sm text-navy/60">Essai GO Navigation de 30 jours, sur invitation, après un premier échange avec notre équipe.</p>
          </div>
          <MaquetteGoNavigation />
        </div>
      </section>

      <FaqAccueil />

      {/* ── Final CTA ── */}
      <section className="px-5 pb-20 sm:px-6">
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-3xl bg-marine px-6 py-14 text-center text-white sm:px-12 lg:flex-row lg:justify-between lg:text-left">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-teal/20 blur-3xl" />
          <div className="relative">
            <h2 className="text-[28px] leading-tight sm:text-4xl">Votre TICPE ne devrait pas dormir dans un tableur.</h2>
            <p className="mt-3 text-white/70">Commencez par le carburant, ajoutez la flotte, le planning et la paie quand vous voulez.</p>
          </div>
          <div className="relative flex shrink-0 flex-col items-center gap-3 sm:flex-row">
            <Link href={primaryCta.href} className="btn-primary !px-7 !py-3.5 text-base">
              {primaryCta.label}
              <IconArrowRight className="h-5 w-5" />
            </Link>
            <a href="#demo" className="btn !px-5 !py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10">
              <IconPlay className="h-4 w-4 text-teal" />
              Voir la démo
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
