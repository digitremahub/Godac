"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchGodac, lireRefus } from "@/lib/http/fetch-godac";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import {
  conflitsAffectation,
  cumulerResultats,
  estCopiable,
  estModifiable,
  heureDe,
  joursDeLaSemaine,
  jourDe,
  libelleJour,
  LIBELLE_ORIGINE,
  preRemplir,
  rangJour,
  rangsJusquaFinDeSemaine,
  statutAffectation,
  texteApercu,
  texteResultat,
  JOURS_LONGS,
  type AffectationPlanning,
  type CongePlanning,
  type ModelePlanning,
  type OriginePreRemplissage,
  type VehiculePlanning,
} from "@/lib/planning/semaine";
import { ChoixRegroupement, lireChoixRequis, type ChoixRegroupementData } from "@/components/colis/ChoixRegroupement";
import type { Regroupement } from "@/lib/colis/fiches-affectation";
import { ChoixJours, Fenetre } from "@/components/planning/Fenetre";
import { IconAlertTriangle, IconCopy, IconTrash } from "@/components/layout/icons";
import { confirmer } from "@/lib/ui/confirmation";

// ---------------------------------------------------------------------------
// Données partagées par les fenêtres du planning.
// ---------------------------------------------------------------------------

export interface EntreeAffichee extends AffectationPlanning {
  vehicles: { registration: string } | null;
  users: { full_name: string; phone: string | null; email: string | null } | null;
}

export interface DonneesPlanning {
  services: { id: string; name: string }[];
  chauffeurs: { id: string; full_name: string }[];
  vehicules: (VehiculePlanning & { registration: string })[];
  tournees: { id: string; tourNumber: string; serviceId: string | null }[];
  affectations: EntreeAffichee[];
  historique: AffectationPlanning[];
  modeles: ModelePlanning[];
  conges: CongePlanning[];
}

export type Ton = "ok" | "attention" | "erreur";
export type OnResultat = (texte: string, ton: Ton) => void;

const json = (corps: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });

type ReponseCopie = { created?: number; skipped?: number; conflicts?: number; warning?: string | null };

/**
 * Duplique des affectations une par une (POST /api/planning/entries/[id]/duplicate),
 * dans l'ordre, pour que deux copies vers le même créneau se voient, et
 * cumule « créées / ignorées / en conflit ».
 */
export async function dupliquerAffectations(
  demandes: { id: string; target_dates: string[]; driver_id?: string; vehicle_id?: string }[],
): Promise<{ creees: number; ignorees: number; conflits: number; erreurs: string[]; avertissements: string[] }> {
  const resultats: { creees: number; ignorees: number; conflits: number }[] = [];
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  for (const { id, ...corps } of demandes) {
    const r = await fetchGodac<ReponseCopie>(`/api/planning/entries/${id}/duplicate`, json(corps));
    if (!r.ok) {
      erreurs.push(r.refus.message);
      continue;
    }
    resultats.push({ creees: r.data.created ?? 0, ignorees: r.data.skipped ?? 0, conflits: r.data.conflicts ?? 0 });
    if (r.data.warning) avertissements.push(r.data.warning);
  }
  return { ...cumulerResultats(resultats), erreurs: [...new Set(erreurs)], avertissements: [...new Set(avertissements)] };
}

/** Message de fin d'une duplication : « X créées, Y ignorées (déjà occupées), Z en conflit ». */
export function annoncerCopie(r: Awaited<ReturnType<typeof dupliquerAffectations>>, onResultat: OnResultat) {
  const texte = [texteResultat(r), ...r.erreurs, ...r.avertissements].join(" · ");
  onResultat(texte, r.erreurs.length ? "erreur" : r.conflits || r.avertissements.length ? "attention" : "ok");
}

function Avertissements({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-lg border border-gold/50 bg-gold/15 p-2.5 text-sm text-gold-ink" aria-live="polite">
      {messages.map((m) => (
        <li key={m} className="flex gap-1.5">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{m}</span>
        </li>
      ))}
    </ul>
  );
}

function SelectVehicule({ id, valeur, onChange, vehicules, serviceId }: { id: string; valeur: string; onChange: (v: string) => void; vehicules: DonneesPlanning["vehicules"]; serviceId: string }) {
  const duService = vehicules.filter((v) => !v.service_id || v.service_id === serviceId);
  const autres = vehicules.filter((v) => v.service_id && v.service_id !== serviceId);
  return (
    <select id={id} className="input min-h-[44px]" value={valeur} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Choisir un véhicule…</option>
      <optgroup label="Véhicules du service">
        {duService.map((v) => (
          <option key={v.id} value={v.id}>
            {v.registration}
          </option>
        ))}
      </optgroup>
      {autres.length > 0 && (
        <optgroup label="Autres véhicules">
          {autres.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

const dateLongue = (date: string) => `${JOURS_LONGS[rangJour(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

// ---------------------------------------------------------------------------
// Ajouter en un clic.
// ---------------------------------------------------------------------------

/**
 * Formulaire contextuel d'une case vide : chauffeur et jour déjà remplis,
 * il reste à choisir la tournée. Heure et véhicule pré-remplis
 * (lib/planning/semaine.ts › preRemplir). Entrée valide. Les conflits
 * s'affichent sans bloquer. Tournée colis active : question « séparées ou
 * reliées » si le chauffeur a déjà une tournée ce jour-là.
 */
export function AjoutAffectation({
  chauffeur,
  date,
  serviceIds,
  serviceParDefaut,
  donnees,
  onFermer,
  onResultat,
}: {
  chauffeur: { id: string; full_name: string };
  date: string;
  serviceIds: string[];
  serviceParDefaut: string;
  donnees: DonneesPlanning;
  onFermer: () => void;
  onResultat: OnResultat;
}) {
  const services = donnees.services.filter((s) => serviceIds.includes(s.id));
  const [serviceId, setServiceId] = useState(serviceParDefaut || services[0]?.id || "");
  const [recherche, setRecherche] = useState("");
  const [tourNumber, setTourNumber] = useState("");
  const [heure, setHeure] = useState("07:00");
  const [vehiculeId, setVehiculeId] = useState("");
  const [origine, setOrigine] = useState<OriginePreRemplissage>("defaut");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [choix, setChoix] = useState<ChoixRegroupementData | null>(null);

  const tournees = useMemo(() => {
    const vus = new Set<string>();
    return donnees.tournees
      .filter((t) => t.serviceId === serviceId || !t.serviceId)
      .filter((t) => (vus.has(t.tourNumber) ? false : (vus.add(t.tourNumber), true)));
  }, [donnees.tournees, serviceId]);
  const q = recherche.trim().toLowerCase();
  const trouvees = q ? tournees.filter((t) => t.tourNumber.toLowerCase().includes(q)) : tournees;
  const libre = q && !tournees.some((t) => t.tourNumber.toLowerCase() === q) ? recherche.trim() : null;

  function remplir(tour: string, service = serviceId) {
    const p = preRemplir({ driverId: chauffeur.id, serviceId: service, tourNumber: tour, date }, donnees);
    setHeure(p.heure);
    setVehiculeId(p.vehiculeId);
    setOrigine(p.origine);
  }

  // Véhicule attribué au chauffeur dès l'ouverture.
  useEffect(() => {
    remplir("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choisir(tour: string) {
    setTourNumber(tour);
    remplir(tour);
  }

  const avertissements = conflitsAffectation({ driverId: chauffeur.id, vehicleId: vehiculeId, date, heure }, donnees.affectations, donnees.conges);

  async function envoyer(regroupement?: Regroupement) {
    let tour = tourNumber;
    let vehicule = vehiculeId;
    if (!tour) {
      const premier = trouvees[0]?.tourNumber ?? libre;
      if (!premier) return setErreur("Choisissez une tournée.");
      tour = premier;
      const p = preRemplir({ driverId: chauffeur.id, serviceId, tourNumber: tour, date }, donnees);
      vehicule = vehicule || p.vehiculeId;
      setTourNumber(tour);
      setHeure(p.heure);
      setVehiculeId(vehicule);
      setOrigine(p.origine);
      if (!vehicule) return setErreur("Choisissez le véhicule.");
    }
    if (!vehicule) return setErreur("Choisissez le véhicule.");
    if (!/^\d{2}:\d{2}$/.test(heure)) return setErreur("Indiquez l'heure de départ.");
    if (date < aujourdhui() && !regroupement && !(await confirmer({ titre: "Ajouter une affectation dans le passé ?", message: `Le ${dateLongue(date)} est passé.`, action: "Ajouter quand même" }))) return;

    setBusy(true);
    setErreur(null);
    let res: Response;
    try {
      res = await fetch("/api/planning/entries", json({ service_id: serviceId, driver_id: chauffeur.id, vehicle_id: vehicule, tour_number: tour, start_at: parisWallTimeToUtcISOString(date, heure), regroupement }));
    } catch {
      setBusy(false);
      return setErreur("Connexion impossible. Vérifiez le réseau puis réessayez.");
    }
    const corps: any = await res.json().catch(() => null);
    setBusy(false);
    const question = lireChoixRequis(res.status, corps);
    if (question) return setChoix(question);
    if (!res.ok) return setErreur(lireRefus(res.status, corps).message);
    const fiche = corps?.fiche ? " Fiche Tournée colis du chauffeur préparée." : "";
    onResultat(`Tournée n°${tour} ajoutée pour ${chauffeur.full_name}, ${dateLongue(date)} à ${heure}.${fiche}${corps?.warning ? ` ${corps.warning}` : ""}`, corps?.warning ? "attention" : "ok");
    onFermer();
  }

  function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!busy && !choix) void envoyer();
  }

  return (
    <Fenetre titre={`Ajouter une tournée`} sousTitre={`${chauffeur.full_name} · ${dateLongue(date)}`} onFermer={onFermer}>
      <form className="flex flex-col gap-3" onSubmit={soumettre}>
        {services.length > 1 && (
          <label className="block">
            <span className="label">Service</span>
            <select
              className="input min-h-[44px]"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setTourNumber("");
                remplir("", e.target.value);
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <label className="label" htmlFor="ajout-recherche">
            Tournée
          </label>
          <input
            id="ajout-recherche"
            data-autofocus
            className="input min-h-[44px]"
            placeholder="Rechercher un numéro de tournée…"
            value={recherche}
            autoComplete="off"
            onChange={(e) => {
              setRecherche(e.target.value);
              setTourNumber("");
            }}
          />
          <div role="radiogroup" aria-label="Tournées du service" className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {trouvees.slice(0, 40).map((t) => (
              <button
                key={t.tourNumber}
                type="button"
                role="radio"
                aria-checked={tourNumber === t.tourNumber}
                onClick={() => choisir(t.tourNumber)}
                className={`min-h-[44px] min-w-[56px] rounded-lg border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                  tourNumber === t.tourNumber ? "border-teal bg-teal/20 text-teal-ink" : "border-navy/15 hover:border-teal/50"
                }`}
              >
                n°{t.tourNumber}
              </button>
            ))}
            {libre && (
              <button
                type="button"
                role="radio"
                aria-checked={tourNumber === libre}
                onClick={() => choisir(libre)}
                className={`min-h-[44px] rounded-lg border border-dashed px-3 text-sm ${tourNumber === libre ? "border-teal bg-teal/20 text-teal-ink" : "border-navy/25"}`}
              >
                Utiliser « {libre} »
              </button>
            )}
            {trouvees.length === 0 && !libre && <p className="text-sm text-navy/60">Aucune tournée enregistrée pour ce service : tapez son numéro.</p>}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-3">
          <label className="block">
            <span className="label">Heure</span>
            <input className="input min-h-[44px]" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} required />
          </label>
          <label className="block" htmlFor="ajout-vehicule">
            <span className="label">Véhicule</span>
            <SelectVehicule id="ajout-vehicule" valeur={vehiculeId} onChange={setVehiculeId} vehicules={donnees.vehicules} serviceId={serviceId} />
          </label>
        </div>
        {origine !== "defaut" && <p className="-mt-1 text-xs text-navy/60">Heure et véhicule {LIBELLE_ORIGINE[origine]}.</p>}

        <Avertissements messages={avertissements} />
        {erreur && (
          <p role="alert" className="text-sm text-orange-ink">
            {erreur}
          </p>
        )}
        {choix ? (
          <ChoixRegroupement choix={choix} busy={busy} onChoisir={(r) => void envoyer(r)} onAnnuler={() => setChoix(null)} />
        ) : (
          <div className="flex gap-2">
            <button type="submit" className="btn-primary min-h-[44px] flex-1" disabled={busy || (!tourNumber && !trouvees.length && !libre)}>
              {busy ? "Ajout…" : tourNumber ? `Ajouter n°${tourNumber}` : "Ajouter"}
            </button>
            <button type="button" className="btn-secondary min-h-[44px]" onClick={onFermer}>
              Annuler
            </button>
          </div>
        )}
        <p className="text-xs text-navy/55">Entrée pour valider · Échap pour fermer</p>
      </form>
    </Fenetre>
  );
}

// ---------------------------------------------------------------------------
// Modifier / supprimer / dupliquer une affectation.
// ---------------------------------------------------------------------------

/** Numéro au format international pour wa.me (06… → 336…). */
function numeroWhatsApp(tel: string): string {
  const chiffres = tel.replace(/[^0-9]/g, "");
  return chiffres.startsWith("0") && chiffres.length === 10 ? `33${chiffres.slice(1)}` : chiffres;
}

export function EditionAffectation({
  entree,
  peutModifier,
  donnees,
  onFermer,
  onResultat,
}: {
  entree: EntreeAffichee;
  /** Rôle direction / manager. */
  peutModifier: boolean;
  donnees: DonneesPlanning;
  onFermer: () => void;
  onResultat: OnResultat;
}) {
  const jour = jourDe(entree.start_at);
  const lundi = addDays(jour, -rangJour(jour));
  const modifiable = peutModifier && estModifiable(entree);
  const statut = statutAffectation(entree.status);
  const service = donnees.services.find((s) => s.id === entree.service_id);

  const [tour, setTour] = useState(entree.tour_number);
  const [date, setDate] = useState(jour);
  const [heure, setHeure] = useState(heureDe(entree.start_at));
  const [chauffeurId, setChauffeurId] = useState(entree.driver_id ?? "");
  const [vehiculeId, setVehiculeId] = useState(entree.vehicle_id ?? "");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [cibles, setCibles] = useState<Set<string>>(new Set());

  const avertissements = modifiable ? conflitsAffectation({ driverId: chauffeurId || null, vehicleId: vehiculeId, date, heure, ignorerId: entree.id }, donnees.affectations, donnees.conges) : [];
  const tourneesDuService = donnees.tournees.filter((t) => t.serviceId === entree.service_id);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (!modifiable) return;
    const corps: Record<string, string> = {};
    if (tour.trim() && tour.trim() !== entree.tour_number) corps.tour_number = tour.trim();
    if (chauffeurId && chauffeurId !== entree.driver_id) corps.driver_id = chauffeurId;
    if (vehiculeId && vehiculeId !== entree.vehicle_id) corps.vehicle_id = vehiculeId;
    const startAt = parisWallTimeToUtcISOString(date, heure);
    if (Date.parse(startAt) !== Date.parse(entree.start_at)) corps.start_at = startAt;
    if (!Object.keys(corps).length) return onFermer();
    setBusy(true);
    setErreur(null);
    const r = await fetchGodac<{ warning?: string | null }>(`/api/planning/entries/${entree.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    setBusy(false);
    if (!r.ok) return setErreur(r.refus.message);
    onResultat(`Tournée n°${corps.tour_number ?? entree.tour_number} modifiée.${r.data.warning ? ` ${r.data.warning}` : ""}`, r.data.warning ? "attention" : "ok");
    onFermer();
  }

  async function supprimer() {
    if (!(await confirmer({ titre: `Supprimer la tournée n°${entree.tour_number} du ${dateLongue(jour)} ?`, message: `Le chauffeur ne la verra plus dans son planning.`, action: "Supprimer", danger: true }))) return;
    setBusy(true);
    setErreur(null);
    const r = await fetchGodac(`/api/planning/entries/${entree.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setErreur(r.refus.message);
    onResultat(`Tournée n°${entree.tour_number} supprimée du ${dateLongue(jour)}.`, "ok");
    onFermer();
  }

  async function dupliquer() {
    if (!cibles.size) return;
    setBusy(true);
    setErreur(null);
    const r = await dupliquerAffectations([{ id: entree.id, target_dates: [...cibles].sort() }]);
    setBusy(false);
    annoncerCopie(r, onResultat);
    onFermer();
  }

  function basculer(d: string) {
    setCibles((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  }

  const partage = [`Tournée n°${entree.tour_number}`, entree.vehicles ? `Véhicule : ${entree.vehicles.registration}` : null, `Départ prévu : ${dateLongue(jour)} à ${heureDe(entree.start_at)}`]
    .filter(Boolean)
    .join("\n");

  return (
    <Fenetre titre={`Tournée n°${entree.tour_number}`} sousTitre={`${entree.users?.full_name ?? "Sans chauffeur"} · ${dateLongue(jour)} à ${heureDe(entree.start_at)}${service ? ` · ${service.name}` : ""}`} onFermer={onFermer} large>
      <p className="mb-3 flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${statut.point}`} aria-hidden="true" />
        {statut.libelle}
        {entree.vehicles && <span className="text-navy/60">· {entree.vehicles.registration}</span>}
      </p>

      {peutModifier && !modifiable && (
        <p className="mb-3 rounded-lg bg-navy/[0.04] p-2.5 text-sm text-navy/70">
          Cette tournée est {statut.libelle.toLowerCase()} : le chauffeur l&apos;a démarrée, elle ne se déplace et ne se modifie plus depuis le planning. Vous pouvez encore la dupliquer.
        </p>
      )}

      {modifiable && (
        <form className="flex flex-col gap-3" onSubmit={enregistrer}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Tournée</span>
              <input className="input min-h-[44px]" list={`tournees-${entree.id}`} value={tour} onChange={(e) => setTour(e.target.value)} required />
              <datalist id={`tournees-${entree.id}`}>
                {tourneesDuService.map((t) => (
                  <option key={t.id} value={t.tourNumber} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="label">Heure</span>
              <input className="input min-h-[44px]" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} required />
            </label>
            <label className="block">
              <span className="label">Jour</span>
              <input className="input min-h-[44px]" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="block">
              <span className="label">Chauffeur</span>
              <select className="input min-h-[44px]" value={chauffeurId} onChange={(e) => setChauffeurId(e.target.value)} required>
                <option value="">Choisir…</option>
                {donnees.chauffeurs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 block" htmlFor={`vehicule-${entree.id}`}>
              <span className="label">Véhicule</span>
              <SelectVehicule id={`vehicule-${entree.id}`} valeur={vehiculeId} onChange={setVehiculeId} vehicules={donnees.vehicules} serviceId={entree.service_id} />
            </label>
          </div>
          <Avertissements messages={avertissements} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary min-h-[44px] flex-1" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="btn-secondary min-h-[44px] text-orange-ink" disabled={busy} onClick={supprimer}>
              <IconTrash className="inline-block h-4 w-4 align-[-0.2em]" aria-hidden="true" /> Supprimer
            </button>
          </div>
        </form>
      )}

      {peutModifier && estCopiable(entree) && (
        <section className="mt-4 border-t border-navy/10 pt-4" aria-labelledby={`dup-${entree.id}`}>
          <h3 id={`dup-${entree.id}`} className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <IconCopy className="h-4 w-4" aria-hidden="true" /> Dupliquer vers d&apos;autres jours
          </h3>
          <ChoixJours
            semaines={[
              { titre: "Cette semaine", jours: joursDeLaSemaine(lundi) },
              { titre: "Semaine suivante", jours: joursDeLaSemaine(addDays(lundi, 7)) },
            ]}
            coches={cibles}
            onBasculer={basculer}
            desactive={jour}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary min-h-[44px] text-sm"
              disabled={rangJour(jour) === 6}
              onClick={() => setCibles(new Set(rangsJusquaFinDeSemaine(rangJour(jour)).map((r) => addDays(lundi, r))))}
            >
              Jusqu&apos;à la fin de la semaine
            </button>
            <button type="button" className="btn-primary min-h-[44px] text-sm" disabled={busy || !cibles.size} onClick={dupliquer}>
              {busy ? "Duplication…" : `Dupliquer${cibles.size ? ` (${cibles.size} jour${cibles.size > 1 ? "s" : ""})` : ""}`}
            </button>
          </div>
        </section>
      )}

      {entree.users && (entree.users.phone || entree.users.email) && (
        <p className="mt-4 flex gap-4 border-t border-navy/10 pt-3 text-sm">
          {entree.users.phone && (
            <a className="inline-flex min-h-[44px] items-center text-teal-ink hover:underline" href={`https://wa.me/${numeroWhatsApp(entree.users.phone)}?text=${encodeURIComponent(partage)}`} target="_blank" rel="noreferrer">
              Envoyer sur WhatsApp
            </a>
          )}
          {entree.users.email && (
            <a className="inline-flex min-h-[44px] items-center text-teal-ink hover:underline" href={`mailto:${entree.users.email}?subject=${encodeURIComponent(`Tournée n°${entree.tour_number}`)}&body=${encodeURIComponent(partage)}`}>
              Envoyer par e-mail
            </a>
          )}
        </p>
      )}

      {erreur && (
        <p role="alert" className="mt-3 text-sm text-orange-ink">
          {erreur}
        </p>
      )}
    </Fenetre>
  );
}

// ---------------------------------------------------------------------------
// Dupliquer une journée (toute l'équipe, ou un chauffeur).
// ---------------------------------------------------------------------------

export function DupliquerJournee({
  date,
  chauffeur,
  entrees,
  onFermer,
  onResultat,
}: {
  date: string;
  /** null : toutes les affectations affichées ce jour-là. */
  chauffeur: { id: string; full_name: string } | null;
  entrees: AffectationPlanning[];
  onFermer: () => void;
  onResultat: OnResultat;
}) {
  const lundi = addDays(date, -rangJour(date));
  const copiables = entrees.filter(estCopiable);
  const [cibles, setCibles] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function valider() {
    setBusy(true);
    const r = await dupliquerAffectations(copiables.map((e) => ({ id: e.id, target_dates: [...cibles].sort() })));
    setBusy(false);
    annoncerCopie(r, onResultat);
    onFermer();
  }

  return (
    <Fenetre titre={chauffeur ? `Dupliquer la journée de ${chauffeur.full_name}` : `Dupliquer la journée du ${libelleJour(date)}`} sousTitre={`${copiables.length} affectation${copiables.length > 1 ? "s" : ""} du ${dateLongue(date)}, mêmes heures, chauffeurs et véhicules.`} onFermer={onFermer}>
      {copiables.length === 0 ? (
        <p className="text-sm text-navy/70">Rien à dupliquer ce jour-là.</p>
      ) : (
        <>
          <ChoixJours
            semaines={[
              { titre: "Cette semaine", jours: joursDeLaSemaine(lundi) },
              { titre: "Semaine suivante", jours: joursDeLaSemaine(addDays(lundi, 7)) },
            ]}
            coches={cibles}
            onBasculer={(d) =>
              setCibles((p) => {
                const n = new Set(p);
                if (n.has(d)) n.delete(d);
                else n.add(d);
                return n;
              })
            }
            desactive={date}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary min-h-[44px] text-sm" disabled={rangJour(date) === 6} onClick={() => setCibles(new Set(rangsJusquaFinDeSemaine(rangJour(date)).map((r) => addDays(lundi, r))))}>
              Jusqu&apos;à la fin de la semaine
            </button>
            <button type="button" className="btn-primary min-h-[44px] flex-1 text-sm" disabled={busy || !cibles.size} onClick={valider}>
              {busy ? "Duplication…" : `Dupliquer vers ${cibles.size || "…"} jour${cibles.size > 1 ? "s" : ""}`}
            </button>
          </div>
          <p className="mt-2 text-xs text-navy/55">Les créneaux déjà occupés sont ignorés, rien n&apos;est écrasé.</p>
        </>
      )}
    </Fenetre>
  );
}

// ---------------------------------------------------------------------------
// Dupliquer la semaine (1 à 8 semaines), avec aperçu.
// ---------------------------------------------------------------------------

type ReponseSemaine = { created: number; skipped: number; conflicts: number; source_count: number; warning?: string | null };

export function DupliquerSemaine({
  lundi,
  serviceId,
  nomService,
  onFermer,
  onResultat,
}: {
  lundi: string;
  serviceId: string;
  nomService: string | null;
  onFermer: () => void;
  onResultat: OnResultat;
}) {
  const [semaines, setSemaines] = useState(1);
  const [apercu, setApercu] = useState<ReponseSemaine | null>(null);
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const corps = { source_week_start: lundi, weeks: semaines, service_id: serviceId || undefined };

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    void fetchGodac<ReponseSemaine>("/api/planning/duplicate-week", json({ ...corps, dry_run: true })).then((r) => {
      if (annule) return;
      setChargement(false);
      if (r.ok) setApercu(r.data);
      else setErreur(r.refus.message);
    });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lundi, semaines, serviceId]);

  async function valider() {
    setBusy(true);
    setErreur(null);
    const r = await fetchGodac<ReponseSemaine>("/api/planning/duplicate-week", json(corps));
    setBusy(false);
    if (!r.ok) return setErreur(r.refus.message);
    const texte = texteResultat({ creees: r.data.created, ignorees: r.data.skipped, conflits: r.data.conflicts });
    onResultat(`Semaine dupliquée sur ${semaines} semaine${semaines > 1 ? "s" : ""} : ${texte}.${r.data.warning ? ` ${r.data.warning}` : ""}`, r.data.conflicts ? "attention" : "ok");
    onFermer();
  }

  const fin = addDays(lundi, 7 * semaines + 6);
  return (
    <Fenetre titre="Dupliquer la semaine" sousTitre={`Semaine du ${libelleJour(lundi)}${nomService ? ` · ${nomService}` : " · tous les services"}`} onFermer={onFermer}>
      <fieldset>
        <legend className="label">Vers</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={semaines === n}
              onClick={() => setSemaines(n)}
              className={`min-h-[44px] rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${semaines === n ? "border-teal bg-teal/20 font-semibold text-teal-ink" : "border-navy/15 hover:border-teal/50"}`}
            >
              {n === 1 ? "La semaine suivante" : `${n} semaines`}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-navy/60">
          Du {libelleJour(addDays(lundi, 7))} au {libelleJour(fin)} · mêmes jours, heures, chauffeurs et véhicules.
        </p>
      </fieldset>

      <div className="mt-4 rounded-lg bg-navy/[0.04] p-3 text-sm" aria-live="polite">
        {chargement ? "Calcul de l'aperçu…" : apercu ? (apercu.source_count === 0 ? "Aucune affectation à dupliquer cette semaine." : `${texteApercu({ creees: apercu.created, ignorees: apercu.skipped, conflits: apercu.conflicts })}.`) : null}
      </div>
      {erreur && (
        <p role="alert" className="mt-2 text-sm text-orange-ink">
          {erreur}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary min-h-[44px] flex-1" disabled={busy || chargement || !apercu?.created} onClick={valider}>
          {busy ? "Duplication…" : apercu?.created ? `Créer ${apercu.created} affectation${apercu.created > 1 ? "s" : ""}` : "Dupliquer"}
        </button>
        <button type="button" className="btn-secondary min-h-[44px]" onClick={onFermer}>
          Annuler
        </button>
      </div>
    </Fenetre>
  );
}
