"use client";

import { useMemo, useState } from "react";
import { calendrierMois, cleCaseTournee, estJourPrevu, etatCase, jourParDefaut, type CelluleMois } from "@/lib/planning/affectation";
import { JOURS_COURTS, JOURS_LONGS, jourDe, rangJour } from "@/lib/planning/semaine";
import { estOuverte } from "@/lib/planning/ouverture";
import { AffectationsJour } from "@/components/planning/AffectationsJour";
import { useAffectations } from "@/components/planning/AffectationElements";

/** « lundi 5 octobre » */
const texteJour = (date: string) =>
  `${JOURS_LONGS[rangJour(date)]} ${Number(date.slice(8, 10))} ${new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" })}`;

/** Indicateur de couverture d'un jour : pastille orange (à pourvoir), ✓ vert (tout pourvu), tiret (aucune tournée). */
function Indicateur({ cellule }: { cellule: Pick<CelluleMois, "couverture" | "trous"> }) {
  if (cellule.couverture === "hors_mois") return <span className="h-6" aria-hidden="true" />;
  if (cellule.couverture === "trous") {
    return (
      <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-orange px-1.5 text-sm font-bold leading-none text-on-orange tabular-nums" aria-hidden="true">
        {cellule.trous}
      </span>
    );
  }
  if (cellule.couverture === "complet") {
    return (
      <span className="inline-flex h-6 items-center justify-center text-base font-bold leading-none text-success-ink" aria-hidden="true">
        ✓
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 items-center justify-center text-base leading-none text-navy/40" aria-hidden="true">
      –
    </span>
  );
}

/** Texte lu pour un jour (lecteur d'écran, infobulle). */
function etatJour(c: Pick<CelluleMois, "couverture" | "trous" | "tournees">): string {
  if (c.couverture === "trous") return `${c.trous} tournée${c.trous > 1 ? "s" : ""} sans chauffeur`;
  if (c.couverture === "complet") return "tout est pourvu";
  if (c.couverture === "aucune") return "aucune tournée";
  return "hors du mois";
}

/**
 * Mois sur téléphone : un vrai calendrier (lignes = semaines, 7 colonnes
 * lundi → dimanche, pas de défilement horizontal). Chaque jour : son numéro
 * et sa couverture. Toucher un jour ouvre la vue Jour (service gardé).
 */
export function CalendrierMois() {
  const ctx = useAffectations();
  const semaines = useMemo(() => calendrierMois(ctx.donnees.mois, ctx.lignes, ctx.parCase), [ctx.donnees.mois, ctx.lignes, ctx.parCase]);
  // Tournées fermées par jour : point rouge sur le jour.
  const fermeesParJour = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of ctx.affectations) if (!estOuverte(a) && a.status !== "cancelled") m.set(jourDe(a.start_at), (m.get(jourDe(a.start_at)) ?? 0) + 1);
    return m;
  }, [ctx.affectations]);

  if (ctx.lignes.length === 0) {
    return <p className="rounded-xl border border-dashed border-navy/20 bg-surface p-4 text-[15px] text-navy/70">Aucune tournée pour ce service. Créez vos tournées-modèles dans Tournée colis › Tournées.</p>;
  }

  return (
    <section aria-label="Calendrier du mois" className="min-w-0">
      <div className="rounded-2xl border border-navy/10 bg-surface p-2 shadow-card">
        <div className="grid grid-cols-7 gap-1 pb-1 text-center" aria-hidden="true">
          {JOURS_COURTS.map((l, i) => (
            <span key={i} className="py-1 text-sm font-semibold text-navy/60">
              {l}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {semaines.map((s) => (
            <ul key={s.lundi} className="grid grid-cols-7 gap-1">
              {s.jours.map((c) => {
                const auj = c.date === ctx.aujourdhui;
                return (
                  <li key={c.date} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => ctx.allerJour(c.date)}
                      aria-label={`${texteJour(c.date)}${auj ? ", aujourd'hui" : ""} : ${etatJour(c)}${fermeesParJour.get(c.date) ? `, ${fermeesParJour.get(c.date)} fermée${fermeesParJour.get(c.date)! > 1 ? "s" : ""}` : ""}. Ouvrir la journée`}
                      aria-current={auj ? "date" : undefined}
                      className={`flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-0 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                        auj ? "border-teal bg-teal/10" : c.couverture === "trous" ? "border-orange/30 bg-orange/[0.04]" : "border-navy/10 bg-surface"
                      } ${c.dansMois ? "" : "opacity-45"}`}
                    >
                      <span className={`text-base leading-none tabular-nums ${auj ? "font-extrabold text-teal-ink" : "font-semibold"}`}>{Number(c.date.slice(8, 10))}</span>
                      <Indicateur cellule={c} />
                      {fermeesParJour.get(c.date) ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#d62718" }} aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm text-navy/70">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange px-1 text-sm font-bold text-on-orange">2</span>à pourvoir
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="font-bold text-success-ink">✓</span>tout pourvu
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-navy/40">–</span>aucune tournée
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#d62718" }} aria-hidden="true" />tournée fermée
        </span>
      </p>
    </section>
  );
}

/**
 * Semaine sur téléphone : sept pastilles (L M M J V S D, avec ce qui reste à
 * pourvoir), un jour choisi à la fois ; dessous, les tournées de ce jour en
 * cartes (mêmes que la vue Jour). « ⇥ Toute la semaine » sur chaque carte.
 */
export function SemaineMobile({ trous }: { trous: Record<string, number> }) {
  const ctx = useAffectations();
  const [choisi, setChoisi] = useState(() => jourParDefaut(ctx.jours, ctx.aujourdhui, trous));
  const date = ctx.jours.includes(choisi) ? choisi : ctx.jours[0]!;

  return (
    <section aria-label="Planning de la semaine" className="min-w-0">
      <ul className="mb-3 grid grid-cols-7 gap-1" aria-label="Jours de la semaine">
        {ctx.jours.map((d) => {
          const r = rangJour(d);
          const n = trous[d] ?? 0;
          const roule = ctx.lignes.some((l) => etatCase(ctx.parCase.get(cleCaseTournee(l.cle, d)) ?? [], estJourPrevu(l, d)) !== "vide");
          const actif = d === date;
          const auj = d === ctx.aujourdhui;
          return (
            <li key={d} className="min-w-0">
              <button
                type="button"
                aria-pressed={actif}
                aria-label={`${texteJour(d)}${auj ? ", aujourd'hui" : ""}${n ? `, ${n} à pourvoir` : ""}`}
                onClick={() => setChoisi(d)}
                className={`flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-0 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                  actif ? "border-teal bg-teal/15" : auj ? "border-teal/50 bg-surface" : "border-navy/10 bg-surface"
                }`}
              >
                <span className="text-sm font-semibold text-navy/65">{JOURS_COURTS[r]}</span>
                <span className={`text-base font-extrabold leading-none tabular-nums ${auj ? "text-teal-ink" : ""}`}>{Number(d.slice(8, 10))}</span>
                {n > 0 ? (
                  <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-orange px-1.5 text-sm font-bold leading-none text-on-orange tabular-nums" aria-hidden="true">
                    {n}
                  </span>
                ) : roule ? (
                  <span className="inline-flex h-6 items-center text-base font-bold leading-none text-success-ink" aria-hidden="true">
                    ✓
                  </span>
                ) : (
                  <span className="inline-flex h-6 items-center text-base leading-none text-navy/40" aria-hidden="true">
                    –
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <h3 className="mb-2 text-base font-bold first-letter:uppercase">{texteJour(date)}</h3>
      <AffectationsJour date={date} />
    </section>
  );
}
