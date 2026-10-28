"use client";

import { useEffect, useMemo, useState } from "react";
import { IconX } from "@/components/layout/icons";
import { networkErrorMessage } from "@/lib/utils/network-error";
import {
  JOURS,
  MAX_CRENEAUX,
  PRESETS,
  afficherHeure,
  dateParis,
  fenetresArret,
  heureDepart,
  jourIso,
  libelleFenetres,
  lireHeure,
  normaliserSemaine,
  passagesTournee,
  resumeSemaine,
  aCreneauPonctuel,
  type Creneau,
  type Fenetres,
  type Jour,
  type Passage,
  type Semaine,
} from "@/lib/colis/horaires";
import { api, type Run, type Stop } from "@/components/colis/commun";
import { LIBELLE_SOURCE } from "@/lib/colis/opening-hours";
import { creneauConseille, dureeServicePrevue, echecFrequent, lireDonnees, serviceConnu } from "@/lib/colis/fiche-client";
import { libelleMotif } from "@/lib/colis/cloture";
import { confirmer } from "@/lib/ui/confirmation";

/** Heure saisie / stockée (« 10:00:00 ») → valeur d'un champ <input type="time"> (« 10:00 »). */
const versChamp = (v: string | null | undefined) => {
  const m = lireHeure(v);
  return m === null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Fenêtres d'ouverture d'un arrêt le jour donné (créneau ponctuel, sinon annuaire). */
export function fenetresDuStop(s: Stop, jour: string): Fenetres {
  return fenetresArret({ semaine: s.horaire?.weekly_schedule, debut: s.window_start, fin: s.window_end }, jour);
}

/**
 * Horaires de la tournée affichée : fenêtres de chaque arrêt pour le jour
 * de livraison et heures de passage estimées des arrêts restants (à
 * partir de maintenant en livraison, sinon de l'heure de départ prévue).
 * Recalculé chaque minute.
 */
export function useHoraires(run: Run | null, stops: Stop[], position: { lat: number; lng: number } | null = null) {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    if (!run) return { jour: dateParis(maintenant), depart: 0, fenetres: new Map<string, Fenetres>(), passages: new Map<string, Passage>() };
    const { jour, minute } = heureDepart(run, maintenant);
    const fenetres = new Map(stops.map((s) => [s.id, fenetresDuStop(s, jour)]));
    const depot = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
    const dernierFait = [...stops].reverse().find((s) => s.status !== "pending" && s.lat !== null && s.lng !== null);
    const point = run.status === "in_progress" ? (position ?? (dernierFait ? { lat: Number(dernierFait.lat), lng: Number(dernierFait.lng) } : depot)) : depot;
    const passages = passagesTournee(
      stops.map((s) => ({ id: s.id, status: s.status, lat: s.lat, lng: s.lng, fenetres: fenetres.get(s.id) ?? null, ...(serviceConnu(s.horaire) !== null ? { service: serviceConnu(s.horaire)! } : {}) })),
      { point, minute },
    );
    return { jour, depart: minute, fenetres, passages };
  }, [run, stops, position, maintenant]);
}

/**
 * Badge d'un arrêt : horaires du jour (« Ouvert 8:00–12:00 · 14:00–18:00 »,
 * « Fermé aujourd'hui », « Avant 10:00 ») et, si demandé, heure d'arrivée
 * estimée — en orange quand elle tombe hors des horaires.
 */
export function BadgeHoraires({ stop, fenetres, passage, inverse = false }: { stop: Stop; fenetres: Fenetres; passage?: Passage | null; inverse?: boolean }) {
  const libelle = libelleFenetres(fenetres, aCreneauPonctuel({ debut: stop.window_start, fin: stop.window_end }));
  const alerte = passage && (passage.statut === "hors" || passage.statut === "ferme");
  // Fiche client : alerte « échec fréquent ici » et créneau où la livraison réussit le plus souvent (arrêt à faire seulement).
  const aFaire = stop.status === "pending";
  const echec = aFaire ? echecFrequent(stop.horaire) : null;
  const conseil = aFaire
    ? creneauConseille(stop.horaire, fenetres && fenetres.length ? (m) => fenetres.some(([o, c]) => m >= o && m < c) : undefined)
    : null;
  if (!libelle && !passage && !echec && !conseil) return null;
  const pastille = inverse ? "bg-white/10 text-white" : "bg-navy/[0.06] text-navy/75";
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] font-semibold">
      {libelle && (
        <span className={`rounded-full px-2 py-0.5 ${fenetres && !fenetres.length ? "bg-orange/15 text-orange-ink" : pastille}`}>
          🕘 {stop.horaire?.label ? `${stop.horaire.label} · ` : ""}
          {libelle}
        </span>
      )}
      {stop.horaire?.source && stop.horaire.source !== "manuel" && (
        <span className={`rounded-full px-2 py-0.5 ${inverse ? "bg-white/10 text-white" : "bg-teal/10 text-teal-ink"}`} title="Horaires trouvés automatiquement : à vérifier">
          Horaires trouvés ({LIBELLE_SOURCE[stop.horaire.source] ?? stop.horaire.source})
        </span>
      )}
      {echec && (
        <span className="rounded-full bg-orange/15 px-2 py-0.5 text-orange-ink" title="D'après les passages précédents de votre équipe à cette adresse">
          ⚠ {echec.libelle}
        </span>
      )}
      {conseil && (
        <span className={`rounded-full px-2 py-0.5 ${inverse ? "bg-white/10 text-white" : "bg-teal/10 text-teal-ink"}`} title={`${Math.round(conseil.taux * 100)} % de livraisons réussies à cette heure (${conseil.passages} passages)`}>
          💡 Livraison réussie surtout vers {conseil.debut.replace(":00", " h")}–{conseil.fin.replace(":00", " h")}
        </span>
      )}
      {passage && (
        <span className={`rounded-full px-2 py-0.5 ${alerte ? "bg-orange text-on-orange" : fenetres ? "bg-teal/20 text-teal-ink" : pastille}`}>
          Arrivée ≈ {afficherHeure(passage.arrivee)}
          {passage.attente >= 5 && ` · attente ${Math.round(passage.attente)} min`}
          {passage.statut === "hors" && " · hors horaires"}
          {passage.statut === "ferme" && " · fermé"}
        </span>
      )}
    </span>
  );
}

/** Résumé d'optimisation renvoyé par /api/colis/optimiser. */
export interface ResumeOptimisation {
  kmAvant: number;
  kmApres: number;
  sansGps: number;
  depart: string;
  finEstimee: string | null;
  avecHoraires: number;
  horsHoraires: string[];
  fermes: string[];
  impossibles: string[];
  /** false quand le moteur de routage est indisponible et que GODAC utilise une estimation. */
  distanceRoutiere?: boolean;
  /** Durée estimée de la tournée (trajets, remises, attentes), retour compris. */
  dureeMin?: number | null;
  /** Départ et arrivée retenus (« Dépôt », « Ma position actuelle », adresse…). */
  extremites?: { depart: string; arrivee: string };
  /** Adresses dont la durée d'arrêt est celle observée (fiche client) et non la valeur fixe. */
  dureesApprises?: number;
  /** Sens de la tournée : choix, habitude (« Soulac → Vendays »), suivie ou écartée pour tenir les horaires. */
  sens?: { mode: "habituel" | "inverse" | "libre"; habitude: string | null; applique: boolean; suivi: boolean; ecarte: "horaires" | null };
}

const dureeTexte = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);

const heureIso = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ") : "—");

/** Encart affiché après « Optimiser » : distances, fin estimée, arrêts hors horaires et fermés. */
export function ResumeOptimisationCarte({ resume, stops, onFermer }: { resume: ResumeOptimisation; stops: Stop[]; onFermer: () => void }) {
  const adresse = (id: string) => stops.find((s) => s.id === id)?.address ?? "Adresse";
  const gain = resume.kmAvant - resume.kmApres;
  const signales: [string, string[]][] = [
    ["Hors horaires", resume.horsHoraires],
    ["Fermés aujourd'hui (en fin de liste)", resume.fermes],
    ["Déjà fermés à l'arrivée (en fin de liste)", resume.impossibles],
  ];
  return (
    <div className="rounded-2xl border border-teal/40 bg-teal/5 p-3 text-sm" role="status">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">
          Ordre optimisé : ≈ {resume.kmApres} km{gain > 0.5 ? ` (−${Math.round(gain)} km, avant ${resume.kmAvant} km)` : ""}
        </p>
        <button type="button" className="btn-ghost !px-1.5 !py-0.5" onClick={onFermer} aria-label="Fermer le résumé">
          <IconX className="h-4 w-4" />
        </button>
      </div>
      {resume.extremites && (
        <p className="text-xs font-semibold text-navy/75">
          🏁 Départ : {resume.extremites.depart} · 🏁 Arrivée : {resume.extremites.arrivee}
        </p>
      )}
      <p className="text-xs text-navy/65">
        Départ {heureIso(resume.depart)} · fin estimée vers {heureIso(resume.finEstimee)}
        {resume.dureeMin ? ` (≈ ${dureeTexte(resume.dureeMin)} au total, trajets compris)` : ""} · {resume.dureesApprises ? `durée d'arrêt observée pour ${resume.dureesApprises} adresse${resume.dureesApprises > 1 ? "s" : ""}, 3 min sinon` : "3 min moyennes par livraison"}
        {resume.avecHoraires > 0 && ` · ${resume.avecHoraires} adresse${resume.avecHoraires > 1 ? "s" : ""} avec horaires`}
        {resume.sansGps > 0 && ` · ${resume.sansGps} adresse(s) à vérifier en fin de liste`}
      </p>
      {resume.sens?.habitude && resume.sens.mode !== "libre" && (
        <p className={`mt-1 text-xs font-semibold ${resume.sens.ecarte ? "text-orange-ink" : "text-teal-ink"}`}>
          {resume.sens.ecarte
            ? `Sens habituel (${resume.sens.habitude}) écarté : il aurait fait sortir une adresse de ses horaires.`
            : resume.sens.suivi
              ? `${resume.sens.mode === "inverse" ? "Sens habituel inversé" : "Sens habituel suivi"} : ${resume.sens.habitude}`
              : `Sens habituel privilégié (${resume.sens.habitude}), sauf là où il aurait rallongé nettement la tournée.`}
        </p>
      )}
      {signales.map(([titre, ids]) =>
        ids.length ? (
          <div key={titre} className="mt-2">
            <p className="text-xs font-semibold text-orange-ink">
              {titre} : {ids.length}
            </p>
            <ul className="ml-4 list-disc text-xs text-navy/70">
              {ids.slice(0, 5).map((id) => (
                <li key={id}>{adresse(id)}</li>
              ))}
              {ids.length > 5 && <li>et {ids.length - 5} autre(s)</li>}
            </ul>
          </div>
        ) : null,
      )}
      {resume.avecHoraires > 0 && !resume.horsHoraires.length && !resume.fermes.length && !resume.impossibles.length && (
        <p className="mt-1 text-xs font-semibold text-teal-ink">Toutes les adresses à horaires sont servies pendant leurs heures d&apos;ouverture.</p>
      )}
    </div>
  );
}

/** Heure de départ prévue d'une tournée pas encore démarrée (base des heures d'arrivée). */
export function HeureDepartChamp({ run, onChange }: { run: Run; onChange: () => void }) {
  const [valeur, setValeur] = useState(versChamp(run.planned_start) || "08:00");
  useEffect(() => setValeur(versChamp(run.planned_start) || "08:00"), [run.planned_start]);
  async function enregistrer(v: string) {
    if (!v || v === (versChamp(run.planned_start) || "08:00")) return;
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ heure_depart: v }) }).catch(() => undefined);
    onChange();
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-navy/65">
      Départ prévu
      <input type="time" className="input !w-auto !px-2 !py-1 text-xs" value={valeur} onChange={(e) => setValeur(e.target.value)} onBlur={(e) => enregistrer(e.target.value)} aria-label="Heure de départ prévue" />
    </label>
  );
}

const JOUR_PAR_DEFAUT: Creneau[] = [{ open: "08:00", close: "18:00" }];

/**
 * Horaires d'un arrêt : créneau ponctuel pour aujourd'hui (« avant 10 h »),
 * ou horaires d'ouverture de l'adresse pro, enregistrés dans l'annuaire de
 * l'entreprise et réutilisés automatiquement dès que l'adresse revient.
 */
export function HorairesSheet({ stop, jour, onClose, onSaved }: { stop: Stop; jour: string; onClose: () => void; onSaved: (texte: string) => void }) {
  const [debut, setDebut] = useState(versChamp(stop.window_start));
  const [fin, setFin] = useState(versChamp(stop.window_end));
  // Un point relais est une adresse pro : ses horaires vont dans l'annuaire et comptent dans l'optimisation.
  const [pro, setPro] = useState(Boolean(stop.horaire) || stop.kind === "point_relais");
  const [nom, setNom] = useState(stop.horaire?.label ?? (stop.kind === "point_relais" ? stop.relay_name : null) ?? stop.recipient ?? "");
  const [notes, setNotes] = useState(stop.horaire?.notes ?? "");
  const [semaine, setSemaine] = useState<Semaine>(() => normaliserSemaine(stop.horaire?.weekly_schedule));
  // Fiche client : coordonnées et consignes retenues des tournées précédentes (modifiables, effaçables).
  const [telephone, setTelephone] = useState(stop.horaire?.phone ?? "");
  const [contact, setContact] = useState(stop.horaire?.recipient ?? "");
  const [consignes, setConsignes] = useState(stop.horaire?.access_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const jourTournee = jourIso(jour);
  const fiche = useMemo(() => lireDonnees((stop.horaire ?? null) as Record<string, unknown> | null), [stop.horaire]);
  const echec = echecFrequent(fiche);
  const conseil = creneauConseille(fiche);
  const passages = fiche.delivered_count + fiche.failed_count;
  const motifPrincipal = Object.entries(fiche.failure_reasons).sort((a, b) => b[1] - a[1])[0];

  async function envoyer(action: () => Promise<unknown>, texte: string) {
    setBusy(true);
    setErreur(null);
    try {
      await action();
      onSaved(texte);
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const creneauValide = (debut || fin) && (!debut || !fin || debut < fin);
  const enregistrerCreneau = () =>
    envoyer(
      () => api(`/api/colis/arrets/${stop.id}`, { method: "PATCH", body: JSON.stringify({ creneau: { debut: debut || null, fin: fin || null } }) }),
      "Créneau enregistré pour aujourd'hui : réoptimisez pour en tenir compte.",
    );
  const retirerCreneau = () =>
    envoyer(() => api(`/api/colis/arrets/${stop.id}`, { method: "PATCH", body: JSON.stringify({ creneau: null }) }), "Créneau retiré.");
  const enregistrerSemaine = () =>
    envoyer(
      () =>
        api("/api/colis/horaires", {
          method: "PUT",
          body: JSON.stringify({ adresse: stop.address, nom: nom.trim() || null, semaine, notes: notes.trim() || null }),
        }),
      "Horaires enregistrés : ils s'appliqueront à cette adresse dans toutes les tournées.",
    );
  const retirerPro = () =>
    envoyer(() => api(`/api/colis/horaires?adresse=${encodeURIComponent(stop.address)}`, { method: "DELETE" }), "Adresse retirée de l'annuaire (fiche client comprise).");
  const enregistrerFiche = () =>
    envoyer(
      () =>
        api("/api/colis/horaires", {
          method: "PUT",
          body: JSON.stringify({ adresse: stop.address, telephone: telephone.trim() || null, contact: contact.trim() || null, consignes: consignes.trim() || null }),
        }),
      "Fiche client enregistrée : elle sera reprise à chaque passage à cette adresse.",
    );
  // Droit à l'effacement : supprime la fiche (coordonnées, consignes, statistiques de passage) de l'annuaire de l'entreprise.
  const effacerFiche = async () => {
    const ok = await confirmer({ titre: "Effacer la fiche client ?", message: "Téléphone, contact, consignes et statistiques de passage seront supprimés pour toute l'équipe, horaires d'ouverture compris. C'est définitif.", action: "Effacer", danger: true });
    if (!ok) return;
    await envoyer(() => api(`/api/colis/horaires?adresse=${encodeURIComponent(stop.address)}`, { method: "DELETE" }), "Fiche client effacée.");
  };

  const majJour = (j: Jour, creneaux: Creneau[] | undefined) =>
    setSemaine((s) => {
      const n = { ...s };
      if (creneaux === undefined) delete n[`${j}`];
      else n[`${j}`] = creneaux;
      return n;
    });
  const majCreneau = (j: Jour, k: number, champ: keyof Creneau, v: string) => majJour(j, (semaine[`${j}`] ?? []).map((c, i) => (i === k ? { ...c, [champ]: v } : c)));
  const semaineValide = Object.keys(semaine).length > 0 && Object.values(semaine).every((cs) => (cs ?? []).every((c) => c.open && c.close && c.open < c.close));

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="horaires-titre">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="horaires-titre" className="font-display text-lg font-bold">
              Horaires
            </h2>
            <p className="truncate text-sm text-navy/65">{stop.address}</p>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Fermer">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <section className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-3">
          <h3 className="text-sm font-semibold">Créneau pour aujourd&apos;hui seulement</h3>
          <p className="text-xs text-navy/60">Ex. « avant 10 h » demandé par le client. Prioritaire sur les horaires d&apos;ouverture.</p>
          <p className="text-xs font-medium text-navy/70">Créneaux DPD</p>
          <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
            {[
              ["8 h – 11 h", "08:00", "11:00"],
              ["10 h – 13 h", "10:00", "13:00"],
              ["12 h – 15 h", "12:00", "15:00"],
              ["14 h – 17 h", "14:00", "17:00"],
            ].map(([l, d, f]) => (
              <button key={l} type="button" className={debut === d && fin === f ? "btn-primary !px-2 !py-2 text-xs" : "btn-ghost !px-2 !py-2 text-xs"} onClick={() => (setDebut(d!), setFin(f!))}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[
              ["Avant 10 h", "", "10:00"],
              ["Avant 12 h", "", "12:00"],
              ["Après 14 h", "14:00", ""],
            ].map(([l, d, f]) => (
              <button key={l} type="button" className="btn-ghost !px-2 !py-1" onClick={() => (setDebut(d!), setFin(f!))}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              Pas avant
              <input type="time" className="input !w-auto !py-1.5" value={debut} onChange={(e) => setDebut(e.target.value)} aria-label="Pas avant" />
            </label>
            <label className="flex items-center gap-1.5">
              Avant
              <input type="time" className="input !w-auto !py-1.5" value={fin} onChange={(e) => setFin(e.target.value)} aria-label="Avant" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !py-2 text-sm" disabled={busy || !creneauValide} onClick={enregistrerCreneau}>
              Enregistrer le créneau
            </button>
            {(stop.window_start || stop.window_end) && (
              <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={retirerCreneau}>
                Retirer le créneau
              </button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-3">
          <h3 className="text-sm font-semibold">Fiche client</h3>
          <p className="text-xs text-navy/60">
            Retenue automatiquement après chaque passage et partagée avec votre équipe pour préremplir cette adresse. Conservée 12 mois sans mise à jour ; vous pouvez la corriger ou l&apos;effacer.
          </p>
          {stop.horaire && passages > 0 && (
            <ul className="flex flex-col gap-0.5 rounded-xl bg-navy/[0.04] px-3 py-2 text-xs text-navy/75">
              <li>
                {passages} passage{passages > 1 ? "s" : ""} : {fiche.delivered_count} livré{fiche.delivered_count > 1 ? "s" : ""}, {fiche.failed_count} non livré{fiche.failed_count > 1 ? "s" : ""}
              </li>
              {serviceConnu(fiche) !== null && <li>Durée d&apos;arrêt moyenne observée : ≈ {Math.round(dureeServicePrevue(fiche))} min</li>}
              {conseil && (
                <li>
                  Livraison réussie surtout vers {conseil.debut.replace(":00", " h")}–{conseil.fin.replace(":00", " h")} ({Math.round(conseil.taux * 100)} % sur {conseil.passages} passages)
                </li>
              )}
              {(fiche.contact_message_count > 0 || fiche.contact_phone_count > 0) && (
                <li>
                  Contacts déjà faits : {fiche.contact_message_count} message{fiche.contact_message_count > 1 ? "s" : ""}, {fiche.contact_phone_count} appel{fiche.contact_phone_count > 1 ? "s" : ""}
                </li>
              )}
              {motifPrincipal && fiche.failed_count > 0 && (
                <li>
                  Motif d&apos;échec le plus fréquent : {libelleMotif(motifPrincipal[0])?.toLowerCase()} ({motifPrincipal[1]})
                </li>
              )}
            </ul>
          )}
          {echec && <p className="rounded-xl bg-orange/15 px-3 py-2 text-xs font-semibold text-orange-ink">⚠ {echec.libelle}</p>}
          <input className="input" type="tel" inputMode="tel" value={telephone} maxLength={40} onChange={(e) => setTelephone(e.target.value)} placeholder="Téléphone de l'établissement" aria-label="Téléphone de la fiche client" />
          <input className="input" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} placeholder="Contact habituel (facultatif)" aria-label="Contact habituel" />
          <textarea className="input min-h-[72px]" value={consignes} maxLength={500} onChange={(e) => setConsignes(e.target.value)} placeholder="Consignes d'accès : code, stationnement, quai…" aria-label="Consignes d'accès" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={enregistrerFiche}>
              Enregistrer la fiche
            </button>
            {stop.horaire && (
              <button type="button" className="btn-secondary !py-2 text-sm text-orange-ink" disabled={busy} onClick={effacerFiche}>
                Effacer la fiche client
              </button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-3">
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-1" checked={pro} onChange={(e) => setPro(e.target.checked)} />
            <span>
              Adresse pro : horaires d&apos;ouverture
              <span className="block text-xs font-normal text-navy/60">
                Enregistrés pour toute l&apos;entreprise et appliqués automatiquement dès que cette adresse revient dans une tournée.
              </span>
            </span>
          </label>
          {pro && (
            <>
              {stop.horaire?.source && stop.horaire.source !== "manuel" && (
                <p className="rounded-xl bg-teal/10 px-3 py-2 text-xs font-semibold text-teal-ink">
                  Horaires trouvés ({LIBELLE_SOURCE[stop.horaire.source] ?? stop.horaire.source}) : vérifiez-les et corrigez-les si besoin ; une fois enregistrés, ils deviennent une saisie manuelle.
                </p>
              )}
              <input className="input" value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)} placeholder="Nom de l'entreprise (facultatif)" aria-label="Nom de l'entreprise" />
              <div className="flex flex-wrap gap-1.5 text-xs">
                {PRESETS.map((p) => (
                  <button key={p.cle} type="button" className="btn-ghost !px-2 !py-1" onClick={() => setSemaine((s) => p.appliquer(s))}>
                    {p.libelle}
                  </button>
                ))}
              </div>
              <ul className="flex flex-col gap-1.5">
                {JOURS.map((j) => {
                  const cs = semaine[`${j.n}`];
                  const etat = cs === undefined ? "inconnu" : cs.length ? "ouvert" : "ferme";
                  return (
                    <li key={j.n} className={`flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1 text-sm ${jourTournee === j.n ? "bg-teal/10" : ""}`}>
                      <span className="w-10 font-semibold">{j.court}</span>
                      <select
                        className="input !w-auto !px-2 !py-1 text-xs"
                        value={etat}
                        onChange={(e) => majJour(j.n, e.target.value === "inconnu" ? undefined : e.target.value === "ferme" ? [] : JOUR_PAR_DEFAUT)}
                        aria-label={`${j.long} : ouvert ou fermé`}
                      >
                        <option value="inconnu">Non renseigné</option>
                        <option value="ouvert">Ouvert</option>
                        <option value="ferme">Fermé</option>
                      </select>
                      {(cs ?? []).map((c, k) => (
                        <span key={k} className="flex items-center gap-1">
                          {k > 0 && <span className="text-navy/40">·</span>}
                          <input type="time" className="input !w-auto !px-1.5 !py-1 text-xs" value={c.open} onChange={(e) => majCreneau(j.n, k, "open", e.target.value)} aria-label={`${j.long} : ouverture ${k + 1}`} />
                          –
                          <input type="time" className="input !w-auto !px-1.5 !py-1 text-xs" value={c.close} onChange={(e) => majCreneau(j.n, k, "close", e.target.value)} aria-label={`${j.long} : fermeture ${k + 1}`} />
                          {k > 0 && (
                            <button type="button" className="btn-ghost !px-1 !py-0.5 text-xs" onClick={() => majJour(j.n, cs!.filter((_, i) => i !== k))} aria-label={`${j.long} : retirer le créneau ${k + 1}`}>
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {cs && cs.length > 0 && cs.length < MAX_CRENEAUX && (
                        <button
                          type="button"
                          className="btn-ghost !px-1.5 !py-0.5 text-xs"
                          onClick={() => majJour(j.n, [{ open: cs[0]!.open, close: "12:00" }, { open: "14:00", close: cs[0]!.close > "14:00" ? cs[0]!.close : "18:00" }])}
                        >
                          + Coupure
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {Object.keys(semaine).length > 0 && semaineValide && <p className="text-xs text-navy/60">{resumeSemaine(normaliserSemaine(semaine))}</p>}
              <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (quai de livraison, accueil…)" aria-label="Notes sur l'adresse" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary !py-2 text-sm" disabled={busy || !semaineValide} onClick={enregistrerSemaine}>
                  Enregistrer les horaires
                </button>
                {stop.horaire && (
                  <button type="button" className="btn-secondary !py-2 text-sm text-orange-ink" disabled={busy} onClick={retirerPro}>
                    Retirer l&apos;adresse de l&apos;annuaire
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {erreur && (
          <p role="alert" className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">
            {erreur}
          </p>
        )}
      </div>
    </div>
  );
}
