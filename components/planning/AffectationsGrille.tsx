"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cleCaseTournee,
  estJourPrevu,
  etatCase,
  indisponibilite,
  initiales,
  nomCourt,
  couleurChauffeur,
  trousParJour,
  type LigneTournee,
} from "@/lib/planning/affectation";
import { estModifiable, heureDe, jourDe, JOURS_LONGS, rangJour, statutAffectation } from "@/lib/planning/semaine";
import { estOuverte } from "@/lib/planning/ouverture";
import { PastilleFermee } from "@/components/planning/OuvertureFusion";
import { addDays } from "@/lib/planning/dates";
import { Avatar, BoutonHeure, Depot, Glissable, useAffectations, type EntreeAffectation } from "@/components/planning/AffectationElements";

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const LETTRES = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * Vues Semaine et Mois : une ligne par tournée, une colonne par jour.
 * - glisser un chauffeur sur une case : ce jour-là ;
 * - sur le nom de la tournée (⇥) : tous les jours où elle roule ;
 * - poignée d'une case remplie, étirée vers la droite : jours suivants ;
 * - case remplie glissée sur une autre case : copie (Maj : déplacer) ;
 * - vers la colonne Chauffeurs : retirer.
 * Chaque geste a son équivalent au clic (feuille « Affecter à… »).
 * Mois : cases compactes (initiales), ligne « trous par jour », en-têtes de
 * semaine cliquables (→ vue Semaine), bascule « par chauffeur ».
 */
export function AffectationsGrille() {
  const ctx = useAffectations();
  const mois = ctx.donnees.vue === "mois";
  const [parChauffeur, setParChauffeur] = useState(false);
  const trous = useMemo(() => trousParJour(ctx.lignes, ctx.jours, ctx.parCase), [ctx.lignes, ctx.jours, ctx.parCase]);
  const totalTrous = Object.values(trous).reduce((n, t) => n + t, 0);

  const boutonDimanche = !ctx.dimancheUtilise && !(mois && parChauffeur) && (
    <button
      type="button"
      aria-pressed={ctx.dimancheAffiche}
      onClick={ctx.basculerDimanche}
      title={ctx.dimancheAffiche ? "Cacher la colonne du dimanche" : "Afficher le dimanche pour y placer quelqu'un"}
      className="min-h-[40px] rounded-lg border border-dashed border-navy/25 px-3 text-sm font-semibold text-navy/75 hover:border-orange/50 hover:text-orange-ink"
    >
      {ctx.dimancheAffiche ? "− dimanche" : "+ dimanche"}
    </button>
  );

  return (
    <section aria-label={mois ? "Planning du mois" : "Planning de la semaine"} className="min-w-0">
      {!mois && boutonDimanche && <div className="mb-2 flex justify-end">{boutonDimanche}</div>}
      {mois && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-navy/[0.05] p-1" role="group" aria-label="Lignes du tableau">
            {[
              { v: false, l: "Par tournée" },
              { v: true, l: "Par chauffeur" },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                aria-pressed={parChauffeur === o.v}
                onClick={() => setParChauffeur(o.v)}
                className={`min-h-[40px] rounded-md px-3 text-sm ${parChauffeur === o.v ? "bg-surface font-semibold shadow-sm" : "text-navy/65 hover:text-navy"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
          <p className="text-sm text-navy/65" aria-live="polite">
            {totalTrous === 0 ? "Aucun trou ce mois-ci." : `${totalTrous} case${totalTrous > 1 ? "s" : ""} à pourvoir ce mois-ci.`}
          </p>
          {boutonDimanche}
        </div>
      )}
      {mois && parChauffeur ? <GrilleChauffeurs /> : <GrilleTournees trous={trous} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lignes = tournées.
// ---------------------------------------------------------------------------

function GrilleTournees({ trous }: { trous: Record<string, number> }) {
  const ctx = useAffectations();
  const router = useRouter();
  const mois = ctx.donnees.vue === "mois";
  const semaines = useMemo(() => {
    const groupes: { lundi: string; jours: string[] }[] = [];
    for (const d of ctx.jours) {
      const lundi = addDays(d, -rangJour(d));
      const g = groupes.at(-1);
      if (g && g.lundi === lundi) g.jours.push(d);
      else groupes.push({ lundi, jours: [d] });
    }
    return groupes;
  }, [ctx.jours]);

  function allerSemaine(lundi: string) {
    const qs = new URLSearchParams({ view: "week", week: lundi });
    if (ctx.donnees.selectedService) qs.set("service", ctx.donnees.selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }

  if (ctx.lignes.length === 0) {
    return <p className="rounded-xl border border-dashed border-navy/20 bg-surface p-4 text-sm text-navy/70">Aucune tournée pour ce service. Créez vos tournées-modèles dans Tournée colis › Tournées, ou générez la semaine depuis les modèles.</p>;
  }

  if (ctx.lignesVisibles.length === 0) {
    return <p className="rounded-xl border border-dashed border-navy/20 bg-surface p-4 text-sm text-navy/70">{ctx.filtreOuverture === "fermees" ? "Aucune tournée fermée sur cette période." : "Aucune tournée ouverte sur cette période."}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-navy/10 bg-surface shadow-card">
      <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: mois ? 160 + ctx.jours.length * 40 : 850, width: mois ? undefined : "100%" }}>
        <caption className="sr-only">
          Une ligne par tournée, une colonne par jour. Glissez un chauffeur sur une case, ou touchez une case pour choisir.
        </caption>
        <thead>
          {mois && (
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-surface" />
              {semaines.map((s) => (
                <th key={s.lundi} scope="colgroup" colSpan={s.jours.length} className="border-l border-navy/10 px-1 pt-2 text-left first:border-l-0">
                  <button type="button" className="min-h-[32px] rounded px-1.5 text-xs font-semibold text-navy/60 underline-offset-2 hover:text-teal-ink hover:underline" onClick={() => allerSemaine(s.lundi)} title="Ouvrir cette semaine">
                    Sem. du {Number(s.lundi.slice(8, 10))}/{s.lundi.slice(5, 7)} →
                  </button>
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th scope="col" className={`sticky left-0 z-20 border-b border-r border-navy/10 bg-surface px-3 py-2 text-left text-xs font-semibold text-navy/60 ${mois ? "w-36 min-w-[9rem]" : "w-44 min-w-[11rem]"}`}>
              Tournée
            </th>
            {!mois && (
              <th scope="col" className="border-b border-r border-navy/10 bg-surface px-2 py-2 text-left text-xs font-semibold text-navy/60">
                Ouverture
              </th>
            )}
            {ctx.jours.map((d) => {
              const r = rangJour(d);
              const auj = d === ctx.aujourdhui;
              return (
                <th
                  key={d}
                  scope="col"
                  aria-label={`${JOURS_LONGS[r]} ${Number(d.slice(8, 10))}`}
                  className={`border-b border-navy/10 py-2 text-center text-xs font-semibold ${mois ? `px-0 ${r === 0 ? "border-l border-navy/10" : ""}` : "px-2"} ${auj ? "text-teal-ink" : "text-navy/60"} ${r >= 5 ? "bg-navy/[0.02]" : ""}`}
                >
                  {mois ? (
                    <span className="flex flex-col items-center leading-tight">
                      <span className="text-[10px] font-normal">{LETTRES[r]}</span>
                      <span className={auj ? "rounded-full bg-orange px-1.5 text-on-orange" : ""}>{Number(d.slice(8, 10))}</span>
                    </span>
                  ) : (
                    <span className={auj ? "rounded-full bg-orange/15 px-2 py-0.5" : ""}>
                      {JOURS_COURTS[r]} {Number(d.slice(8, 10))}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ctx.lignesVisibles.map((l) => (
            <tr key={l.cle}>
              <EnteteLigne ligne={l} />
              {!mois && <ColonneOuverture ligne={l} />}
              {ctx.jours.map((d) => (
                <Case key={d} ligne={l} date={d} />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 z-10 border-r border-t border-navy/10 bg-surface px-3 py-2 text-left text-xs font-semibold text-navy/60">
              Trous par jour
            </th>
            {ctx.jours.map((d) => (
              <td key={d} className={`border-t border-navy/10 py-2 text-center text-xs font-bold tabular-nums ${rangJour(d) === 0 && mois ? "border-l" : ""} ${trous[d] ? "text-orange-ink" : "text-success-ink"}`}>
                {trous[d] ? trous[d] : "✓"}
                <span className="sr-only">{trous[d] ? ` case${trous[d]! > 1 ? "s" : ""} à pourvoir` : " complet"}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Colonne « Ouverture » (vue Semaine) : Ouverte, Fermée, ou « 2/5 fermées » si seuls certains jours sont fermés. */
function ColonneOuverture({ ligne }: { ligne: LigneTournee }) {
  const ctx = useAffectations();
  const entrees = ctx.jours.flatMap((d) => ctx.parCase.get(cleCaseTournee(ligne.cle, d)) ?? []).filter((e) => e.status !== "cancelled" && !e.id.startsWith("tmp:"));
  const fermees = entrees.filter((e) => !estOuverte(e)).length;
  const peut = ctx.donnees.peutModifier && entrees.some((e) => e.status === "planned" || e.status === "in_progress");
  return (
    <td className="border-b border-r border-navy/10 px-2 py-1 align-middle text-xs">
      {entrees.length === 0 ? (
        <span className="text-navy/40" aria-label="Aucune affectation">
          –
        </span>
      ) : (
        <div className="flex flex-col items-start gap-1">
          {fermees === 0 ? (
            <span className="text-navy/65">Ouverte</span>
          ) : (
            <span className="inline-flex rounded-full px-2 py-0.5 font-bold" style={{ backgroundColor: "#d62718", color: "#FFFFFF" }}>
              {fermees === entrees.length ? "Fermée" : `${fermees}/${entrees.length} fermées`}
            </span>
          )}
          {peut && (
            <button
              type="button"
              disabled={ctx.occupe}
              onClick={() => ctx.basculerOuvertureLigne(entrees, fermees < entrees.length)}
              className="btn-secondary min-h-[36px] !px-2.5 !py-0 text-xs"
              aria-label={`${fermees < entrees.length ? "Fermer" : "Rouvrir"} ${ligne.tourNumber} sur la période affichée`}
            >
              {fermees < entrees.length ? "Fermer" : "Rouvrir"}
            </button>
          )}
          {peut && (
            <button type="button" disabled={ctx.occupe} onClick={() => ctx.ouvrirRepartition(entrees[0]!)} className="min-h-[36px] rounded-lg px-2 text-xs font-semibold text-teal-ink underline-offset-2 hover:underline">
              Répartir villages et ramasses
            </button>
          )}
        </div>
      )}
    </td>
  );
}

function EnteteLigne({ ligne }: { ligne: LigneTournee }) {
  const ctx = useAffectations();
  const mois = ctx.donnees.vue === "mois";
  const secteur = ligne.villages[0];
  return (
    <Depot id={`ligne:${ligne.cle}`} actif={ctx.glisser}>
      {(survol, ref) => (
        <th ref={ref as any} scope="row" className={`sticky left-0 z-10 border-b border-r border-navy/10 px-3 py-1.5 text-left align-middle ${survol ? "bg-orange/15" : "bg-surface"}`}>
          <span className="block font-display text-base font-extrabold leading-tight">{ligne.tourNumber}</span>
          <span className="flex items-center text-xs text-navy/60" style={{ maxWidth: mois ? "8rem" : "10rem" }}>
            <BoutonHeure ligne={ligne} />
            {secteur ? <span className="truncate">&nbsp;· {secteur}</span> : null}
          </span>
          {ctx.donnees.peutModifier && (
            <button
              type="button"
              onClick={() => ctx.ouvrirLigne(ligne.cle)}
              title={`Affecter un chauffeur à ${ligne.tourNumber} ${mois ? "tout le mois" : "toute la semaine"}`}
              className={`mt-0.5 inline-flex min-h-[28px] items-center rounded-full px-2 text-xs font-semibold ${survol ? "bg-orange text-on-orange" : "bg-navy/[0.06] text-navy/75 hover:bg-teal/20 hover:text-teal-ink"}`}
            >
              ⇥ {survol ? "relâchez" : mois ? "mois" : "semaine"}
            </button>
          )}
        </th>
      )}
    </Depot>
  );
}

function Case({ ligne, date }: { ligne: LigneTournee; date: string }) {
  const ctx = useAffectations();
  const mois = ctx.donnees.vue === "mois";
  const entrees = ctx.parCase.get(cleCaseTournee(ligne.cle, date)) ?? [];
  const prevue = estJourPrevu(ligne, date);
  const etat = etatCase(entrees, prevue);
  const r = rangJour(date);
  const et = ctx.etirement;
  const etiree = et && et.cle === ligne.cle && date > et.source && date <= et.jusqua;
  const libelleCase = `${ligne.tourNumber}, ${JOURS_LONGS[r]} ${Number(date.slice(8, 10))}`;
  const premiere = entrees.find((e) => e.driver_id) ?? entrees[0];

  return (
    <Depot id={`case:${cleCaseTournee(ligne.cle, date)}`} actif={ctx.glisser}>
      {(survol, ref) => (
        <td
          ref={ref as any}
          data-case=""
          data-cle={ligne.cle}
          data-date={date}
          className={`border-b border-navy/10 align-middle ${mois ? `p-0.5 ${r === 0 ? "border-l" : ""}` : "p-1"} ${r >= 5 ? "bg-navy/[0.025]" : ""} ${date === ctx.aujourdhui ? "bg-teal/[0.06]" : ""}`}
          style={{ minWidth: mois ? 38 : 112 }}
        >
          {etiree ? (
            <div className={`flex items-center justify-center rounded-lg border-2 border-orange bg-orange/15 font-semibold text-orange-ink ${mois ? "h-9 text-xs" : "min-h-[52px] text-sm"}`}>
              {mois ? "✓" : `${nomCourt(ctx.nomChauffeur(premiere?.driver_id ?? null))} ✓`}
            </div>
          ) : etat === "remplie" && premiere ? (
            <CaseRemplie entree={premiere} autres={entrees.length - 1} ligne={ligne} date={date} survol={survol} libelleCase={libelleCase} />
          ) : (
            <button
              type="button"
              disabled={!ctx.donnees.peutModifier || ctx.occupe}
              onClick={() => ctx.ouvrirCase(ligne.cle, date)}
              aria-label={`${libelleCase} : ${etat === "a_remplacer" ? "à remplacer" : etat === "vide_prevue" ? "sans chauffeur" : "vide"}${ctx.arme ? `, placer ${ctx.arme.full_name}` : ""}`}
              className={`flex w-full items-center justify-center rounded-lg border-2 border-dashed text-orange-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${mois ? "h-9 text-sm" : "min-h-[52px] flex-col text-base"} ${
                survol
                  ? "border-orange bg-orange/20"
                  : etat === "a_remplacer"
                    ? "border-solid border-orange bg-orange/10 font-semibold"
                    : etat === "vide_prevue"
                      ? "border-orange/50 bg-orange/[0.05] hover:bg-orange/10"
                      : // Jour où la tournée ne roule pas d'habitude (samedi…) : même case « disponible », un peu plus discrète.
                        // Le « + » ne disparaît jamais ; il s'estompe seulement avec une souris précise.
                        "border-orange/30 bg-orange/[0.02] font-semibold text-orange-ink/80 hover:border-orange/60 hover:bg-orange/10 hover:text-orange-ink [@media(hover:hover)_and_(pointer:fine)]:text-orange-ink/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-orange-ink"
              }`}
            >
              {etat === "a_remplacer" ? (mois ? "!" : <><span>À remplacer</span><span className="text-[11px] font-normal">absent ou retiré</span></>) : "+"}
            </button>
          )}
        </td>
      )}
    </Depot>
  );
}

function CaseRemplie({ entree, autres, ligne, date, survol, libelleCase }: { entree: EntreeAffectation; autres: number; ligne: LigneTournee; date: string; survol: boolean; libelleCase: string }) {
  const ctx = useAffectations();
  const mois = ctx.donnees.vue === "mois";
  const nom = ctx.nomChauffeur(entree.driver_id);
  const modifiable = estModifiable(entree);
  const fermee = !estOuverte(entree);
  const statut = statutAffectation(entree.status);
  const memeJour = ctx.affectations.filter((a) => a.driver_id === entree.driver_id && a.status !== "cancelled" && jourDe(a.start_at) === date).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const deuxieme = memeJour.findIndex((a) => a.id === entree.id) > 0;
  const fiche = ctx.donnees.fiches[entree.id];
  const liee = Boolean(fiche) && memeJour.some((a) => a.id !== entree.id && ctx.donnees.fiches[a.id] === fiche);
  const etirable = ctx.glisser && modifiable && Boolean(entree.driver_id);
  const libelle = `${libelleCase} : ${nom}${heureDe(entree.start_at) !== ligne.heure ? ` à ${heureDe(entree.start_at)}` : ""}${modifiable ? "" : fermee ? ", tournée fermée" : `, ${statut.libelle.toLowerCase()}`}${autres > 0 ? `, et ${autres} autre${autres > 1 ? "s" : ""}` : ""}`;
  const couleur = couleurChauffeur(entree.driver_id ?? "");

  return (
    <div className={`group relative ${survol ? "rounded-lg ring-2 ring-orange ring-offset-1" : ""}`}>
      <Glissable id={`af:${entree.id}`} actif={ctx.glisser && modifiable}>
        <button
          type="button"
          onClick={() => ctx.ouvrirCase(ligne.cle, date)}
          aria-label={`${libelle}. Modifier ou remplacer`}
          title={libelle}
          className={
            mois
              ? "flex h-9 w-full items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
              : "flex min-h-[52px] w-full items-center gap-2 rounded-lg bg-marine px-2 pr-4 text-left text-white ring-1 ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          }
        >
          {mois ? (
            <span
              className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${modifiable || fermee ? "" : "ring-2 ring-navy/40"}`}
              style={{ backgroundColor: couleur.fond, color: couleur.texte }}
              aria-hidden="true"
            >
              {initiales(nom)}
              {fermee && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ backgroundColor: "#d62718" }} aria-hidden="true" />}
            </span>
          ) : (
            <>
              <Avatar id={entree.driver_id!} nom={nom} taille="sm" />
              <span className="min-w-0 flex-1 truncate font-semibold">{nomCourt(nom)}</span>
              {deuxieme && <span className="rounded-full bg-teal px-1.5 text-[10px] font-bold text-on-teal">{liee ? "liée" : "2ᵉ"}</span>}
              {fermee && <PastilleFermee entree={entree} court />}
              {!modifiable && !fermee && <span className={`h-2 w-2 shrink-0 rounded-full ${statut.point}`} aria-hidden="true" />}
              {ctx.donnees.fusions[entree.id] && (
                <span className="rounded-full bg-white/15 px-1.5 text-[10px] font-bold" title="Tournée fusionnée">
                  Fus.
                </span>
              )}
              {autres > 0 && <span className="text-[10px] text-white/70">+{autres}</span>}
            </>
          )}
        </button>
      </Glissable>
      {!mois && ctx.donnees.peutModifier && !entree.id.startsWith("tmp:") && (entree.status === "planned" || entree.status === "in_progress") && (
        <button
          type="button"
          disabled={ctx.occupe}
          onClick={() => ctx.basculerOuverture(entree)}
          className="absolute -right-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface text-xs shadow-pop ring-1 ring-navy/15 hover:bg-orange/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
          aria-label={`${fermee ? "Rouvrir" : "Fermer"} la tournée de ${nomCourt(nom)}`}
          title={fermee ? "Rouvrir la tournée" : "Fermer la tournée"}
        >
          <span aria-hidden="true">{fermee ? "🔒" : "🔓"}</span>
        </button>
      )}
      {etirable && (
        <span
          role="presentation"
          title="Étirer vers la droite : mêmes chauffeur et tournée les jours suivants"
          onPointerDown={(e) => ctx.commencerEtirement(ligne.cle, date, entree.driver_id!, e)}
          className={`absolute inset-y-1 right-0 flex w-3 cursor-ew-resize touch-none items-center justify-center rounded-r-lg ${mois ? "bg-navy/10" : "bg-white/15"} opacity-0 transition-opacity group-hover:opacity-100`}
        >
          <span className={`h-4 w-0.5 rounded ${mois ? "bg-navy/50" : "bg-white/70"}`} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mois, lignes = chauffeurs (lecture : clic → vue Jour).
// ---------------------------------------------------------------------------

function GrilleChauffeurs() {
  const ctx = useAffectations();
  const router = useRouter();
  const parChauffeurJour = useMemo(() => {
    const m = new Map<string, EntreeAffectation[]>();
    for (const a of ctx.affectations) {
      if (!a.driver_id || a.status === "cancelled") continue;
      const k = `${a.driver_id}@${jourDe(a.start_at)}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [ctx.affectations]);
  const chauffeurs = useMemo(() => {
    const places = new Set(ctx.affectations.map((a) => a.driver_id).filter(Boolean));
    const services = new Set(ctx.donnees.serviceIds);
    const rattaches = new Set(ctx.donnees.rattachements.filter((r) => services.has(r.service_id)).map((r) => r.user_id));
    return ctx.donnees.chauffeurs.filter((c) => places.has(c.id) || rattaches.has(c.id) || ctx.donnees.rattachements.length === 0);
  }, [ctx.affectations, ctx.donnees]);

  function allerJour(d: string) {
    const qs = new URLSearchParams({ view: "day", day: d });
    if (ctx.donnees.selectedService) qs.set("service", ctx.donnees.selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-navy/10 bg-surface shadow-card">
      <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: 180 + ctx.jours.length * 40 }}>
        <caption className="sr-only">Une ligne par chauffeur : ses tournées jour par jour. Cliquez une case pour ouvrir la journée.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-20 w-44 min-w-[11rem] border-b border-r border-navy/10 bg-surface px-3 py-2 text-left text-xs font-semibold text-navy/60">
              Chauffeur
            </th>
            {ctx.jours.map((d) => {
              const r = rangJour(d);
              return (
                <th key={d} scope="col" aria-label={`${JOURS_LONGS[r]} ${Number(d.slice(8, 10))}`} className={`border-b border-navy/10 py-2 text-center text-xs font-semibold ${r === 0 ? "border-l" : ""} ${d === ctx.aujourdhui ? "text-teal-ink" : "text-navy/60"} ${r >= 5 ? "bg-navy/[0.02]" : ""}`}>
                  <span className="flex flex-col items-center leading-tight">
                    <span className="text-[10px] font-normal">{LETTRES[r]}</span>
                    {Number(d.slice(8, 10))}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {chauffeurs.map((c) => (
            <tr key={c.id}>
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-navy/10 bg-surface px-3 py-1.5 text-left font-medium">
                <span className="flex items-center gap-2">
                  <Avatar id={c.id} nom={c.full_name} taille="sm" />
                  <span className="truncate">{nomCourt(c.full_name)}</span>
                </span>
              </th>
              {ctx.jours.map((d) => {
                const liste = parChauffeurJour.get(`${c.id}@${d}`) ?? [];
                const indispo = indisponibilite(c.id, d, ctx.donnees.conges, ctx.donnees.arrets);
                const r = rangJour(d);
                return (
                  <td key={d} className={`border-b border-navy/10 p-0.5 text-center ${r === 0 ? "border-l" : ""} ${r >= 5 ? "bg-navy/[0.025]" : ""}`} style={{ minWidth: 38 }}>
                    <button
                      type="button"
                      onClick={() => allerJour(d)}
                      aria-label={`${c.full_name}, ${JOURS_LONGS[r]} ${Number(d.slice(8, 10))} : ${liste.length ? liste.map((a) => a.tour_number).join(", ") : indispo ? (indispo.type === "arret" ? "en arrêt" : indispo.type === "conge" ? "en congé" : "congé demandé") : "libre"}`}
                      className="flex h-9 w-full items-center justify-center rounded-md text-[10px] font-bold leading-none hover:bg-navy/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                    >
                      {liste.length ? (
                        <span className="rounded bg-marine px-1 py-1 text-white">
                          {liste[0]!.tour_number}
                          {liste.length > 1 ? "+" : ""}
                        </span>
                      ) : indispo && indispo.type !== "conge_demande" ? (
                        <span className="text-navy/40">{indispo.type === "arret" ? "arr." : "cg"}</span>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-navy/55">« cg » : congé · « arr. » : arrêt de travail. Pour placer, revenez à « Par tournée ».</p>
    </div>
  );
}

