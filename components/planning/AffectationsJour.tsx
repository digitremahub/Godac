"use client";

import { useMemo, useState } from "react";
import { cleCaseTournee, cleLigne, estJourPrevu, etatCase, nomCourt, type LigneTournee } from "@/lib/planning/affectation";
import { heureDe, jourDe, statutAffectation } from "@/lib/planning/semaine";
import { Avatar, Depot, Glissable, useAffectations, Vehicule, type EntreeAffectation } from "@/components/planning/AffectationElements";

type Tri = "heure" | "numero" | "trous";

/**
 * Vue Jour : une carte par tournée (numéro, heure, villages, colis,
 * chauffeur + véhicule ou « Glissez un chauffeur ici »). Toute la carte
 * reçoit un chauffeur ; le chauffeur d'une carte se glisse vers une autre
 * carte (déplacer, échanger) ou vers la colonne Chauffeurs (retirer).
 * Toucher / cliquer une carte : feuille « Affecter à… » (même actions).
 */
export function AffectationsJour({ date: dateDonnee }: { date?: string } = {}) {
  const ctx = useAffectations();
  const date = dateDonnee ?? ctx.jours[0]!;
  const [tri, setTri] = useState<Tri>("heure");
  const [toutes, setToutes] = useState(false);

  const cartes = useMemo(() => {
    const avec = ctx.lignes.map((l) => {
      const entrees = ctx.parCase.get(cleCaseTournee(l.cle, date)) ?? [];
      return { ligne: l, entrees, etat: etatCase(entrees, estJourPrevu(l, date)) };
    });
    const tries = [...avec].sort((a, b) => {
      if (tri === "numero") return a.ligne.tourNumber.localeCompare(b.ligne.tourNumber, "fr", { numeric: true });
      if (tri === "trous") {
        const poids = (e: string) => (e === "a_remplacer" || e === "vide_prevue" ? 0 : 1);
        return poids(a.etat) - poids(b.etat) || heureCarte(a) - heureCarte(b);
      }
      return heureCarte(a) - heureCarte(b) || a.ligne.tourNumber.localeCompare(b.ligne.tourNumber, "fr", { numeric: true });
    });
    return { roulent: tries.filter((c) => c.etat !== "vide"), autres: tries.filter((c) => c.etat === "vide") };
  }, [ctx.lignes, ctx.parCase, date, tri]);

  return (
    <section aria-labelledby="titre-tournees" className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="titre-tournees" className="text-xs font-semibold uppercase tracking-[0.12em] text-navy/60">
          Tournées
        </h2>
        <label className="flex items-center gap-1.5 text-sm text-navy/70">
          Trier :
          <select className="input min-h-[44px] !w-auto !py-1 text-sm" value={tri} onChange={(e) => setTri(e.target.value as Tri)}>
            <option value="heure">heure de départ</option>
            <option value="numero">numéro</option>
            <option value="trous">sans chauffeur d&apos;abord</option>
          </select>
        </label>
      </div>

      {cartes.roulent.length === 0 && (
        <p className="rounded-xl border border-dashed border-navy/20 bg-surface p-4 text-sm text-navy/70">
          Aucune tournée prévue ce jour-là.{cartes.autres.length ? " Affichez les autres tournées ci-dessous pour en ajouter une." : " Créez vos tournées-modèles dans Tournée colis › Tournées."}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Tournées du jour">
        {cartes.roulent.map((c) => (
          <CarteTournee key={c.ligne.cle} ligne={c.ligne} date={date} entrees={c.entrees} />
        ))}
        {toutes && cartes.autres.map((c) => <CarteTournee key={c.ligne.cle} ligne={c.ligne} date={date} entrees={c.entrees} horsJour />)}
      </ul>

      {cartes.autres.length > 0 && (
        <button type="button" className="mt-3 min-h-[48px] text-[15px] text-navy/70 underline-offset-2 hover:text-teal-ink hover:underline" onClick={() => setToutes((v) => !v)} aria-expanded={toutes}>
          {toutes ? "Masquer" : "Afficher"} les {cartes.autres.length} tournée{cartes.autres.length > 1 ? "s" : ""} qui ne roulent pas d&apos;habitude ce jour-là
        </button>
      )}
    </section>
  );
}

function heureCarte(c: { ligne: LigneTournee; entrees: EntreeAffectation[] }): number {
  const h = c.entrees[0] ? heureDe(c.entrees[0].start_at) : c.ligne.heure;
  const [hh, mm] = h.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

export function CarteTournee({ ligne, date, entrees, horsJour = false }: { ligne: LigneTournee; date: string; entrees: EntreeAffectation[]; horsJour?: boolean }) {
  const ctx = useAffectations();
  const etat = etatCase(entrees, !horsJour);
  const trou = etat === "a_remplacer" || etat === "vide_prevue";
  const heure = entrees[0] ? heureDe(entrees[0].start_at) : ligne.heure;
  const colis = entrees.reduce((n, e) => n + (ctx.donnees.colis[e.id] ?? 0), 0);
  const secteur = ligne.villages.slice(0, 2).join(", ");
  const idDepot = `case:${cleCaseTournee(ligne.cle, date)}`;
  const libelleEtat = etat === "remplie" ? "Affectée" : etat === "a_remplacer" ? "À remplacer" : "Sans chauffeur";
  const arme = ctx.arme;

  return (
    <li>
      <Depot id={idDepot} actif={ctx.glisser}>
        {(survol, ref) => (
          <div
            ref={ref}
            data-case=""
            className={`flex h-full flex-col rounded-2xl border-2 bg-surface p-3.5 shadow-card transition-shadow ${
              survol ? "border-orange shadow-[0_0_0_6px_rgb(var(--c-orange)/0.18)]" : trou ? "border-orange/40" : "border-transparent"
            } ${horsJour ? "opacity-80" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-xl font-extrabold leading-none">{ligne.tourNumber}</h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold max-md:text-sm ${trou ? "bg-orange/15 text-orange-ink" : "bg-success/15 text-success-ink"}`}>{libelleEtat}</span>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-navy/65 max-md:text-sm">
              <span className="tabular-nums">{heure}</span>
              {secteur && <span>· {secteur}</span>}
              {ligne.villages.length > 0 && (
                <span>
                  · {ligne.villages.length} village{ligne.villages.length > 1 ? "s" : ""}
                </span>
              )}
              {ligne.renfort && <span>· renfort</span>}
              {colis > 0 && <span className="rounded-full bg-navy/[0.06] px-2 py-0.5 text-xs font-bold text-navy/80 max-md:text-sm">{colis} colis</span>}
              {ctx.donnees.serviceIds.length > 1 && <span className="text-navy/50">· {ctx.donnees.services.find((s) => s.id === ligne.serviceId)?.name}</span>}
            </p>

            <div className="mt-2.5 flex flex-col gap-2">
              {entrees.map((e) => (e.driver_id ? <ChauffeurPlace key={e.id} entree={e} date={date} /> : null))}
              {(entrees.length === 0 || entrees.some((e) => !e.driver_id)) && (
                <button
                  type="button"
                  disabled={!ctx.donnees.peutModifier || ctx.occupe}
                  onClick={() => ctx.ouvrirCase(ligne.cle, date)}
                  className={`flex min-h-[52px] items-center justify-center rounded-xl border-2 border-dashed px-3 text-sm font-semibold max-md:text-base transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                    survol || arme ? "border-orange bg-orange/15 text-orange-ink" : "border-orange/60 bg-orange/[0.06] text-orange-ink hover:bg-orange/10"
                  }`}
                >
                  {survol ? "Relâchez pour affecter ✓" : arme ? `Placer ${nomCourt(arme.full_name)} ici` : ctx.petitEcran || !ctx.glisser ? "Sans chauffeur — choisir ▾" : "＋ Glissez un chauffeur ici"}
                </button>
              )}
            </div>
            {ctx.petitEcran && ctx.donnees.vue === "semaine" && ctx.donnees.peutModifier && (
              <button
                type="button"
                disabled={ctx.occupe}
                onClick={() => ctx.ouvrirLigne(ligne.cle)}
                className="mt-2.5 min-h-[48px] self-start rounded-xl bg-navy/[0.06] px-4 text-[15px] font-semibold text-navy/80 hover:bg-teal/20 hover:text-teal-ink"
              >
                ⇥ Toute la semaine
              </button>
            )}
          </div>
        )}
      </Depot>
    </li>
  );
}

function ChauffeurPlace({ entree, date }: { entree: EntreeAffectation; date: string }) {
  const ctx = useAffectations();
  const nom = ctx.nomChauffeur(entree.driver_id);
  const modifiable = entree.status === "planned";
  const statut = statutAffectation(entree.status);
  // 2ᵉ tournée du jour du même chauffeur : « liée » si la même fiche colis les porte.
  const memeJour = ctx.affectations
    .filter((a) => a.driver_id === entree.driver_id && a.status !== "cancelled" && jourDe(a.start_at) === date)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const rang = memeJour.findIndex((a) => a.id === entree.id);
  const fiche = ctx.donnees.fiches[entree.id];
  const liee = Boolean(fiche) && memeJour.some((a) => a.id !== entree.id && ctx.donnees.fiches[a.id] === fiche);
  const fin = entree.end_at ? heureDe(entree.end_at) : null;
  const libelle = `${nom}, tournée ${entree.tour_number} à ${heureDe(entree.start_at)}${entree.vehicles ? `, ${entree.vehicles.registration}` : ""}${modifiable ? "" : `, ${statut.libelle.toLowerCase()}`}`;

  return (
    <Glissable id={`af:${entree.id}`} actif={ctx.glisser && modifiable} className="rounded-xl">
      <button
        type="button"
        onClick={() => ctx.ouvrirCase(cleLigne(entree.service_id, entree.tour_number), date)}
        aria-label={`${libelle}. Modifier ou remplacer`}
        className="flex min-h-[52px] w-full items-center gap-2.5 rounded-xl bg-marine px-3 py-2 text-left text-white ring-1 ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
      >
        <Avatar id={entree.driver_id!} nom={nom} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-bold">{nomCourt(nom)}</span>
            {rang > 0 && <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-bold text-on-teal max-md:text-sm">2ᵉ tournée{liee ? " · liée" : ""}</span>}
            {!modifiable && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] max-md:text-sm">{statut.libelle}</span>}
          </span>
          <span className="block text-xs tabular-nums text-white/70 max-md:text-sm">
            {heureDe(entree.start_at)}
            {fin ? ` → ${fin}` : ""}
          </span>
        </span>
        <Vehicule immat={entree.vehicles?.registration} />
      </button>
    </Glissable>
  );
}
