import Link from "next/link";
import type { ReactNode } from "react";
import { IconArrowRight, IconCoins, IconMapPin, IconShieldCheck, IconTruck, IconUsers, IconWrench } from "@/components/layout/icons";

/* ── Bandeau de réassurance ─────────────────────────────────────────────
   Uniquement ce que disent les pages légales : hébergement à Paris
   (confidentialité, DPA), RGPD, barème TICPE daté, cloisonnement et HTTPS. */
const REASSURANCES = [
  { icon: IconMapPin, titre: "Hébergé en France", texte: "Base de données et application exécutées à Paris", href: "/confidentialite" },
  { icon: IconShieldCheck, titre: "RGPD", texte: "Accord de sous-traitance (DPA) publié", href: "/dpa" },
  { icon: IconCoins, titre: "TICPE au barème daté", texte: "Taux de chaque période, documents pour le comptable", href: "#ticpe" },
  { icon: IconUsers, titre: "Accès cloisonnés", texte: "Par entreprise et par rôle, en HTTPS", href: "/confidentialite" },
];

export function BandeauReassurance() {
  return (
    <section aria-label="Garanties" className="border-b border-navy/[0.08] bg-surface">
      <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-x-8 gap-y-5 px-5 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {REASSURANCES.map((r) => (
          <li key={r.titre}>
            <Link href={r.href} className="group flex items-start gap-3 rounded-xl">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-marine text-[#1BE4C1]">
                <r.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-display text-[15px] font-bold group-hover:underline">{r.titre}</span>
                <span className="mt-0.5 block text-sm leading-snug text-navy/65">{r.texte}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Comment ça marche : 3 étapes illustrées ───────────────────────────
   Chaque étape décrit une fonction livrée (photo du ticket, lecture et
   contrôle, documents pour le comptable). Illustrations aux couleurs de
   marque, identiques dans tous les thèmes. */
const MARINE = "#0A0F1E";
const TEAL = "#1BE4C1";
const ORANGE = "#FF6B35";
const BLANC = "#F0F4FF";

function Illustration({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 200 130" fill="none" role="presentation" aria-hidden="true" className="h-auto w-full">
      <rect width="200" height="130" rx="14" fill={MARINE} />
      <circle cx="168" cy="22" r="40" fill={TEAL} opacity="0.1" />
      {children}
    </svg>
  );
}

const ETAPES = [
  {
    titre: "Le chauffeur photographie son ticket",
    texte: "Au plein, une photo du ticket et du compteur depuis son téléphone. Rien à ressaisir.",
    illustration: (
      <Illustration>
        <rect x="64" y="14" width="72" height="102" rx="12" fill="#16203B" stroke={BLANC} strokeOpacity="0.35" strokeWidth="2" />
        <rect x="72" y="26" width="56" height="64" rx="5" fill={BLANC} />
        <path d="M80 38h40M80 48h40M80 58h26" stroke={MARINE} strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
        <path d="M80 70h18" stroke={ORANGE} strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="103" r="7" fill={TEAL} />
        <path d="M70 26v-7h7M130 26v-7h-7M70 90v7h7M130 90v7h-7" stroke={TEAL} strokeWidth="2.5" strokeLinecap="round" />
      </Illustration>
    ),
  },
  {
    titre: "GODAC lit, rattache et contrôle",
    texte: "Véhicule, chauffeur, litres et kilomètres sont rapprochés ; la TICPE du plein est chiffrée, les écarts sont signalés.",
    illustration: (
      <Illustration>
        <rect x="24" y="30" width="62" height="70" rx="8" fill="#16203B" stroke={BLANC} strokeOpacity="0.3" strokeWidth="1.5" />
        <path d="M34 48h42M34 60h42M34 72h26" stroke={BLANC} strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" />
        <path d="M92 65h26" stroke={TEAL} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />
        <path d="M112 58l8 7-8 7" stroke={TEAL} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="126" y="30" width="52" height="70" rx="8" fill={TEAL} />
        <path d="M138 66l9 9 16-20" stroke={MARINE} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="166" cy="40" r="6" fill={ORANGE} />
      </Illustration>
    ),
  },
  {
    titre: "Vous validez, le comptable déclare",
    texte: "Récapitulatif pour l’annexe 3310-TIC, état annuel par véhicule et dossier de contrôle en ZIP, prêts à transmettre.",
    illustration: (
      <Illustration>
        <rect x="52" y="24" width="64" height="84" rx="8" fill={BLANC} />
        <path d="M64 42h40M64 54h40M64 66h26" stroke={MARINE} strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" />
        <rect x="64" y="80" width="40" height="16" rx="4" fill={TEAL} />
        <path d="M72 88h24" stroke={MARINE} strokeWidth="3" strokeLinecap="round" />
        <rect x="100" y="34" width="64" height="84" rx="8" fill="#16203B" stroke={BLANC} strokeOpacity="0.35" strokeWidth="1.5" />
        <path d="M112 52h40M112 64h40M112 76h20" stroke={BLANC} strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
        <path d="M150 100l-8-8h5v-8h6v8h5z" fill={ORANGE} />
      </Illustration>
    ),
  },
];

export function CommentCaMarche() {
  return (
    <section id="comment-ca-marche" className="scroll-mt-20 border-y border-orange-fonce/15 bg-orange-clair py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="kicker !text-orange-texte">Comment ça marche</p>
          <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Du plein au dossier, en trois étapes.</h2>
          <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
            Le chauffeur fait le plein comme d&apos;habitude. Le reste se fait tout seul, sous votre contrôle.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {ETAPES.map((e, i) => (
            <li key={e.titre} className="card flex flex-col gap-4 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-navy/15 hover:shadow-raised">
              <div className="overflow-hidden rounded-xl">{e.illustration}</div>
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-fonce font-body text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg leading-snug">{e.titre}</h3>
                  <p className="mt-1.5 text-pretty text-sm leading-relaxed text-navy/65">{e.texte}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Pour tous les corps de métier ─────────────────────────────────────
   Sobre : le suivi des pleins, des véhicules et du planning vaut pour tout
   parc de véhicules ; la TICPE ne concerne que les poids lourds de 7,5 t
   et plus (dit explicitement sous les cartes). */
function IconVoiture({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d="M5 16V11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11v5" />
      <path d="M3 16h18v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M5 11h14" />
      <circle cx="7.5" cy="14" r=".6" fill="currentColor" />
      <circle cx="16.5" cy="14" r=".6" fill="currentColor" />
    </svg>
  );
}

function IconChantier({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d="M3 20h18" />
      <path d="M6 20V8l6-4 6 4v12" />
      <path d="M10 20v-5h4v5" />
      <path d="M9 10h6" />
    </svg>
  );
}

const METIERS = [
  { icon: IconTruck, titre: "Transport et livraison", texte: "Pleins, TICPE des poids lourds, planning des chauffeurs, tournées colis et preuves de livraison." },
  { icon: IconVoiture, titre: "Taxi et VTC", texte: "Pleins et entretiens de chaque véhicule, disponibilité des chauffeurs au planning." },
  { icon: IconChantier, titre: "BTP et chantiers", texte: "Camions et véhicules de chantier suivis, cuves de gazole, affectation aux équipes." },
  { icon: IconWrench, titre: "Artisans avec véhicules", texte: "Quelques véhicules, un suivi simple : pleins, entretiens, échéances et justificatifs rangés." },
  { icon: IconUsers, titre: "Services et maintenance", texte: "Véhicules de techniciens, kilomètres relevés, demandes d’entretien et amendes rattachées au bon conducteur." },
];

export function CorpsDeMetier() {
  return (
    <section id="metiers" className="scroll-mt-20 border-t border-navy/[0.08] bg-surface py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="kicker !text-teal-ink">Pour tous les métiers</p>
          <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Dès qu&apos;il y a des véhicules et des chauffeurs.</h2>
          <p className="mt-4 text-pretty text-navy/65 sm:text-lg">
            Vous choisissez les modules utiles à votre activité, et vous en ajoutez quand elle grandit.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {METIERS.map((m) => (
            <li key={m.titre} className="card flex flex-col gap-3 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-navy/15 hover:shadow-raised">
              <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-marine text-[#1BE4C1]">
                <m.icon className="h-5 w-5" />
              </span>
              <h3 className="text-lg">{m.titre}</h3>
              <p className="text-pretty text-sm leading-relaxed text-navy/65">{m.texte}</p>
            </li>
          ))}
          <li className="flex flex-col justify-center gap-3 rounded-2xl border border-dashed border-navy/20 p-5 sm:p-6">
            <p className="text-pretty text-sm leading-relaxed text-navy/70">
              La TICPE ne concerne que les poids lourds de 7,5&nbsp;t et plus roulant au gazole&nbsp;; le suivi des pleins, de la flotte et du
              planning s&apos;applique à tout véhicule.
            </p>
            <Link href="/contact" className="inline-flex items-center gap-2 text-sm font-semibold text-teal-ink hover:underline">
              Parlez-nous de votre activité
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

/* ── FAQ courte, repliable (éléments <details>, sans JavaScript) ─────── */
const QUESTIONS = [
  {
    q: "Qui peut récupérer la TICPE ?",
    r: "Le remboursement partiel concerne le gazole des poids lourds de 7,5 t et plus. GODAC repère les véhicules éligibles à partir de la carte grise, chiffre chaque plein et prépare les documents ; la déclaration reste faite par l’entreprise ou son expert-comptable.",
  },
  {
    q: "Où sont hébergées mes données ?",
    r: "La base de données et l’application sont exécutées à Paris. La lecture automatique des photos par intelligence artificielle est une option désactivée par défaut ; la liste complète des sous-traitants figure dans la politique de confidentialité et l’accord de sous-traitance.",
  },
  {
    q: "Mes chauffeurs doivent-ils être formés ?",
    r: "Ils utilisent GODAC sur leur téléphone : une photo du ticket et du compteur suffit pour un plein. À la mise en service, nous importons vos véhicules et vos chauffeurs et nous formons votre équipe.",
  },
  {
    q: "Puis-je essayer sans compte ?",
    r: "Oui. La démo est en accès libre, avec une entreprise de transport et des données fictives, côté direction ou côté chauffeur.",
  },
  {
    q: "Faut-il tout prendre ?",
    r: "Non. On commence par la TICPE et le carburant, puis on ajoute la flotte, le planning et la paie, ou la tournée colis, quand vous le décidez. Les modules et leurs tarifs sont détaillés sur la page dédiée.",
  },
];

export function FaqAccueil() {
  return (
    <section id="faq" className="scroll-mt-20 border-t border-navy/[0.08] bg-surface py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-5 sm:px-6">
        <div className="mb-10 text-center">
          <p className="kicker !text-teal-ink">Questions fréquentes</p>
          <h2 className="mt-3 text-[28px] leading-tight sm:text-4xl">Avant de nous écrire.</h2>
        </div>
        <div className="flex flex-col gap-3">
          {QUESTIONS.map((x) => (
            <details key={x.q} className="faq-item group rounded-2xl border border-navy/[0.08] bg-paper shadow-card transition-shadow open:shadow-raised">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-3 font-display text-base font-bold [&::-webkit-details-marker]:hidden">
                {x.q}
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy/[0.06] text-lg leading-none transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="text-pretty px-5 pb-5 text-sm leading-relaxed text-navy/70 sm:text-base">{x.r}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-navy/65">
          Une autre question&nbsp;?{" "}
          <Link href="/contact" className="font-semibold text-teal-ink hover:underline">
            Écrivez-nous
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
