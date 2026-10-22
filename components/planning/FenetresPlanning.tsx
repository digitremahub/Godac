"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  rangJour,
  rangsJusquaFinDeSemaine,
  statutAffectation,
  texteApercu,
  texteResultat,
  JOURS_LONGS,
  type AffectationPlanning,
  type CongePlanning,
  type ModelePlanning,
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

type ReponseCopie = { created?: number; skipped?: number; conflicts?: number; a_remplacer?: number; warning?: string | null };

/**
 * Duplique des affectations une par une (POST /api/planning/entries/[id]/duplicate),
 * dans l'ordre, pour que deux copies vers le même créneau se voient, et
 * cumule « créées / ignorées / en conflit ».
 */
export async function dupliquerAffectations(
  demandes: { id: string; target_dates: string[]; driver_id?: string; vehicle_id?: string }[],
): Promise<{ creees: number; ignorees: number; conflits: number; aRemplacer: number; erreurs: string[]; avertissements: string[] }> {
  const resultats: { creees: number; ignorees: number; conflits: number; aRemplacer: number }[] = [];
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  for (const { id, ...corps } of demandes) {
    const r = await fetchGodac<ReponseCopie>(`/api/planning/entries/${id}/duplicate`, json(corps));
    if (!r.ok) {
      erreurs.push(r.refus.message);
      continue;
    }
    resultats.push({ creees: r.data.created ?? 0, ignorees: r.data.skipped ?? 0, conflits: r.data.conflicts ?? 0, aRemplacer: r.data.a_remplacer ?? 0 });
    if (r.data.warning) avertissements.push(r.data.warning);
  }
  return { ...cumulerResultats(resultats), erreurs: [...new Set(erreurs)], avertissements: [...new Set(avertissements)] };
}

/** Message de fin d'une duplication : « X créées, Y ignorées (déjà occupées), Z en conflit ». */
export function annoncerCopie(r: Awaited<ReturnType<typeof dupliquerAffectations>>, onResultat: OnResultat) {
  const texte = [texteResultat(r), ...r.erreurs, ...r.avertissements].join(" · ");
  onResultat(texte, r.erreurs.length ? "erreur" : r.conflits || r.aRemplacer || r.avertissements.length ? "attention" : "ok");
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
  const [choix, setChoix] = useState<ChoixRegroupementData | null>(null);

  const avertissements = modifiable ? conflitsAffectation({ driverId: chauffeurId || null, vehicleId: vehiculeId, date, heure, ignorerId: entree.id }, donnees.affectations, donnees.conges) : [];
  const tourneesDuService = donnees.tournees.filter((t) => t.serviceId === entree.service_id);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (!choix) await envoyer();
  }

  /** PATCH ; nouveau chauffeur qui a déjà une tournée ce jour-là : « séparées ou reliées ? » d'abord. */
  async function envoyer(regroupement?: Regroupement) {
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
    let res: Response;
    try {
      res = await fetch(`/api/planning/entries/${entree.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...corps, regroupement }) });
    } catch {
      setBusy(false);
      return setErreur("Connexion impossible. Vérifiez le réseau puis réessayez.");
    }
    const reponse: any = await res.json().catch(() => null);
    setBusy(false);
    const question = lireChoixRequis(res.status, reponse);
    if (question) return setChoix(question);
    if (!res.ok) return setErreur(lireRefus(res.status, reponse).message);
    onResultat(`Tournée n°${corps.tour_number ?? entree.tour_number} modifiée.${reponse?.warning ? ` ${reponse.warning}` : ""}`, reponse?.warning ? "attention" : "ok");
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
          {choix && <ChoixRegroupement choix={choix} busy={busy} onChoisir={(r) => void envoyer(r)} onAnnuler={() => setChoix(null)} />}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary min-h-[44px] flex-1" disabled={busy || Boolean(choix)}>
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
// Dupliquer la semaine (1 à 8 semaines), avec aperçu.
// ---------------------------------------------------------------------------

type ReponseSemaine = { created: number; skipped: number; conflicts: number; a_remplacer?: number; source_count: number; warning?: string | null };

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
    const texte = texteResultat({ creees: r.data.created, ignorees: r.data.skipped, conflits: r.data.conflicts, aRemplacer: r.data.a_remplacer });
    onResultat(`Semaine dupliquée sur ${semaines} semaine${semaines > 1 ? "s" : ""} : ${texte}.${r.data.warning ? ` ${r.data.warning}` : ""}`, r.data.conflicts || r.data.a_remplacer ? "attention" : "ok");
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
        {chargement ? "Calcul de l'aperçu…" : apercu ? (apercu.source_count === 0 ? "Aucune affectation à dupliquer cette semaine." : `${texteApercu({ creees: apercu.created, ignorees: apercu.skipped, conflits: apercu.conflicts, aRemplacer: apercu.a_remplacer })}.`) : null}
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
