"use client";

import { useMemo, useState, type ReactNode } from "react";
import { IconX } from "@/components/layout/icons";
import { AdresseInput } from "@/components/colis/AdresseInput";
import { api, type Run, type Stop } from "@/components/colis/commun";
import { lireArrivee, lireDepart, resoudreExtremites, type Arrivee, type Depart } from "@/lib/colis/extremites";
import { networkErrorMessage } from "@/lib/utils/network-error";

/**
 * Choix du départ et de l'arrivée de l'optimisation (« Optimiser l'ordre »),
 * mémorisés sur la tournée (delivery_runs.optim_depart / optim_arrivee) ou,
 * tant que la migration 20261102000001 n'est pas appliquée, sur l'appareil.
 * Logique pure : lib/colis/extremites.ts.
 */

const cleLocale = (runId: string) => `godac:optim:${runId}`;

function lireLocal(runId: string): { depart: Depart | null; arrivee: Arrivee | null } {
  try {
    const brut = JSON.parse(localStorage.getItem(cleLocale(runId)) ?? "null") as { depart?: unknown; arrivee?: unknown } | null;
    return { depart: lireDepart(brut?.depart), arrivee: lireArrivee(brut?.arrivee) };
  } catch {
    return { depart: null, arrivee: null };
  }
}

/** Choix en vigueur : celui de la tournée, ou celui de l'appareil si la base ne peut pas le garder. */
export function choixDeRun(run: Run | null): { depart: Depart | null; arrivee: Arrivee | null } {
  if (!run) return { depart: null, arrivee: null };
  if (run.optim_persiste === false) return lireLocal(run.id);
  return { depart: lireDepart(run.optim_depart), arrivee: lireArrivee(run.optim_arrivee) };
}

/** Enregistre le choix (tournée, sinon appareil) et renvoie la tournée mise à jour pour l'écran. */
export async function memoriserChoix(run: Run, depart: Depart | null, arrivee: Arrivee | null): Promise<Run> {
  let persiste = run.optim_persiste !== false;
  try {
    const r = await api<{ persiste?: boolean }>(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ optim_depart: depart, optim_arrivee: arrivee }) });
    persiste = r.persiste !== false;
  } catch {
    persiste = false;
  }
  if (!persiste) {
    try {
      localStorage.setItem(cleLocale(run.id), JSON.stringify({ depart, arrivee }));
    } catch {
      /* stockage indisponible : le choix vaut pour cette session */
    }
  }
  return { ...run, optim_depart: depart, optim_arrivee: arrivee, optim_persiste: persiste };
}

/**
 * Position GPS actuelle (lecture fraîche) ; à défaut la dernière position
 * connue de l'écran. Sans aucune position, erreur claire plutôt qu'un calcul
 * silencieux depuis le dépôt.
 */
export function lirePositionGps(secours: { lat: number; lng: number } | null = null): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    const echec = () => (secours ? resolve(secours) : reject(new Error("Position indisponible : autorisez la localisation de l'appareil, puis réessayez.")));
    if (typeof navigator === "undefined" || !navigator.geolocation) return echec();
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), echec, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
  });
}

/** Libellés « Dépôt », « Ma position actuelle », adresse de l'arrêt… affichés sur la carte et la liste. */
export function libellesExtremites(run: Run, stops: Stop[], choix = choixDeRun(run)): { depart: string; arrivee: string; erreur?: string } {
  const depot = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  const r = resoudreExtremites({
    depart: choix.depart,
    arrivee: choix.arrivee,
    depot,
    // « Ma position » : pas de GPS ici, on l'annonce telle que choisie.
    position: choix.depart?.mode === "position" || run.status === "in_progress" ? { lat: 0, lng: 0 } : null,
    arrets: stops,
    retourParDefaut: run.return_to_start,
  });
  if (r.erreur) return { depart: "à revoir", arrivee: "à revoir", erreur: r.erreur };
  return { depart: r.departLibelle, arrivee: r.arriveeLibelle };
}

function Option({ actif, onChoisir, titre, detail, desactive, children }: { actif: boolean; onChoisir: () => void; titre: string; detail?: string; desactive?: boolean; children?: ReactNode }) {
  return (
    <div className={`rounded-2xl border ${actif ? "border-teal bg-teal/5" : "border-navy/10"} ${desactive ? "opacity-55" : ""}`}>
      <button type="button" role="radio" aria-checked={actif} disabled={desactive} onClick={onChoisir} className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${actif ? "border-teal" : "border-navy/30"}`} aria-hidden="true">
          {actif && <span className="h-2.5 w-2.5 rounded-full bg-teal" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{titre}</span>
          {detail && <span className="block text-xs text-navy/60">{detail}</span>}
        </span>
      </button>
      {actif && children && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

type KindDepart = "depot" | "position" | "arret" | "adresse" | "libre";
type KindArrivee = "depot" | "meme" | "arret" | "adresse" | "libre";
type Lieu = { label: string; lat: number; lng: number };

export function OptimiserSheet({
  run,
  stops,
  enLivraison,
  initial,
  onValider,
  onFermer,
}: {
  run: Run;
  /** Arrêts dans l'ordre de passage. */
  stops: Stop[];
  /** Tournée démarrée : le départ est la position du chauffeur. */
  enLivraison: boolean;
  initial: { depart: Depart | null; arrivee: Arrivee | null };
  /** Lance l'optimisation ; renvoie un message d'erreur, ou null si tout s'est bien passé. */
  onValider: (depart: Depart | null, arrivee: Arrivee) => Promise<string | null>;
  onFermer: () => void;
}) {
  const depotConnu = run.start_lat !== null && run.start_lng !== null;
  const choisissables = useMemo(() => stops.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.status === "pending" && s.lat !== null && s.lng !== null), [stops]);
  const idsValides = new Set(choisissables.map(({ s }) => s.id));

  const d0 = initial.depart;
  const a0 = initial.arrivee;
  const [dKind, setDKind] = useState<KindDepart>(() => {
    if (d0?.mode === "arret" && idsValides.has(d0.arret_id)) return "arret";
    if (d0?.mode === "adresse" && !enLivraison) return "adresse";
    if (d0?.mode === "position" || enLivraison) return "position";
    if (d0?.mode === "depot" && depotConnu) return "depot";
    return depotConnu ? "depot" : "libre";
  });
  const [dArret, setDArret] = useState(d0?.mode === "arret" && idsValides.has(d0.arret_id) ? d0.arret_id : "");
  const [dLieu, setDLieu] = useState<Lieu | null>(d0?.mode === "adresse" ? { label: d0.label, lat: d0.lat, lng: d0.lng } : null);
  const [dTexte, setDTexte] = useState(d0?.mode === "adresse" ? d0.label : "");
  const [aKind, setAKind] = useState<KindArrivee>(() => {
    if (a0?.mode === "arret" && idsValides.has(a0.arret_id)) return "arret";
    if (a0?.mode === "adresse") return "adresse";
    if (a0?.mode === "meme") return "meme";
    if (a0?.mode === "libre") return "libre";
    if (a0?.mode === "depot" && depotConnu) return "depot";
    return !a0 && depotConnu && run.return_to_start ? "depot" : "libre";
  });
  const [aArret, setAArret] = useState(a0?.mode === "arret" && idsValides.has(a0.arret_id) ? a0.arret_id : "");
  const [sansRetour, setSansRetour] = useState(a0?.mode === "arret" && a0.sans_retour === true);
  const [aLieu, setALieu] = useState<Lieu | null>(a0?.mode === "adresse" ? { label: a0.label, lat: a0.lat, lng: a0.lng } : null);
  const [aTexte, setATexte] = useState(a0?.mode === "adresse" ? a0.label : "");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const depart: Depart | null =
    dKind === "depot" ? { mode: "depot" } : dKind === "position" ? { mode: "position" } : dKind === "arret" && dArret ? { mode: "arret", arret_id: dArret } : dKind === "adresse" && dLieu ? { mode: "adresse", ...dLieu } : null;
  const arrivee: Arrivee | null =
    aKind === "depot" ? { mode: "depot" } : aKind === "meme" ? { mode: "meme" } : aKind === "libre" ? { mode: "libre" } : aKind === "arret" && aArret ? { mode: "arret", arret_id: aArret, ...(sansRetour ? { sans_retour: true } : {}) } : aKind === "adresse" && aLieu ? { mode: "adresse", ...aLieu } : null;
  const departIncomplet = (dKind === "arret" && !dArret) || (dKind === "adresse" && !dLieu);
  const arriveeIncomplete = !arrivee;
  const conflit = dKind === "arret" && aKind === "arret" && dArret !== "" && dArret === aArret && choisissables.length > 1;

  async function localiser(texte: string, maj: (l: Lieu | null) => void) {
    setErreur(null);
    try {
      const p = await api<{ lat: number; lng: number }>(`/api/colis/adresses/localiser?q=${encodeURIComponent(texte)}`);
      maj({ label: texte, lat: p.lat, lng: p.lng });
    } catch (e) {
      maj(null);
      setErreur(networkErrorMessage(e));
    }
  }

  async function valider() {
    if (!arrivee || departIncomplet || conflit) return;
    setBusy(true);
    setErreur(null);
    const msg = await onValider(depart, arrivee);
    setBusy(false);
    if (msg) setErreur(msg);
    else onFermer();
  }

  const selectArret = (valeur: string, maj: (v: string) => void, libelle: string, exclu?: string) => (
    <select className="input mt-1 !min-h-[44px]" value={valeur} onChange={(e) => maj(e.target.value)} aria-label={libelle}>
      <option value="">Choisir un arrêt…</option>
      {choisissables
        .filter(({ s }) => s.id !== exclu)
        .map(({ s, n }) => (
          <option key={s.id} value={s.id}>
            {n}. {s.address}
          </option>
        ))}
    </select>
  );

  const champAdresse = (texte: string, setTexte: (t: string) => void, lieu: Lieu | null, setLieu: (l: Lieu | null) => void) => (
    <div className="mt-1 flex flex-col gap-1">
      <AdresseInput
        biais={depotConnu ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null}
        value={texte}
        onChange={(t) => {
          setTexte(t);
          if (lieu && t !== lieu.label) setLieu(null);
        }}
        onChoisir={(sug) => {
          const label = sug.nom ? `${sug.nom} — ${sug.adresse}` : sug.adresse;
          setTexte(label);
          if (sug.lat !== null && sug.lng !== null) setLieu({ label, lat: sug.lat, lng: sug.lng });
          else void localiser(sug.adresse, (l) => setLieu(l ? { ...l, label } : null));
        }}
      />
      {lieu ? (
        <p className="text-xs font-semibold text-teal-ink">Adresse localisée.</p>
      ) : (
        <button type="button" className="btn-ghost min-h-[44px] w-fit !px-3 text-sm" disabled={texte.trim().length < 3} onClick={() => void localiser(texte.trim(), setLieu)}>
          Localiser cette adresse
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="optim-titre">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="optim-titre" className="font-display text-lg font-bold">
              Optimiser l&apos;ordre
            </h2>
            <p className="text-sm text-navy/65">Choisissez où vous partez et où vous finissez : l&apos;ordre est calculé entre les deux.</p>
          </div>
          <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] !px-2" onClick={onFermer} aria-label="Fermer">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <section className="flex flex-col gap-2" role="radiogroup" aria-label="Départ">
          <h3 className="text-sm font-semibold">🏁 Départ</h3>
          {enLivraison ? (
            <>
              <Option actif={dKind === "position"} onChoisir={() => setDKind("position")} titre="Ma position actuelle" detail="Tournée en cours : le calcul part d'où vous êtes." />
              <Option actif={dKind === "arret"} onChoisir={() => setDKind("arret")} titre="Une adresse de la tournée" detail="Cet arrêt devient le prochain." desactive={!choisissables.length}>
                {selectArret(dArret, setDArret, "Arrêt à faire en premier", aKind === "arret" ? aArret : undefined)}
              </Option>
            </>
          ) : (
            <>
              <Option actif={dKind === "depot"} onChoisir={() => setDKind("depot")} titre="Dépôt" detail={depotConnu ? (run.start_label ?? undefined) : "Aucune adresse de dépôt connue (Organisation → Services)."} desactive={!depotConnu} />
              <Option
                actif={dKind === "position"}
                onChoisir={() => setDKind("position")}
                titre="Ma position actuelle"
                detail={typeof navigator !== "undefined" && !navigator.geolocation ? "Localisation indisponible sur cet appareil." : "Le GPS est lu au moment du calcul."}
                desactive={typeof navigator !== "undefined" && !navigator.geolocation}
              />
              <Option actif={dKind === "arret"} onChoisir={() => setDKind("arret")} titre="Une adresse de la tournée" detail="Cet arrêt devient le 1er." desactive={!choisissables.length}>
                {selectArret(dArret, setDArret, "Arrêt à faire en premier", aKind === "arret" ? aArret : undefined)}
              </Option>
              <Option actif={dKind === "adresse"} onChoisir={() => setDKind("adresse")} titre="Une autre adresse">
                {champAdresse(dTexte, setDTexte, dLieu, setDLieu)}
              </Option>
              {!depotConnu && <Option actif={dKind === "libre"} onChoisir={() => setDKind("libre")} titre="Pas de départ imposé" detail="L'ordre part du premier arrêt." />}
            </>
          )}
        </section>

        <section className="flex flex-col gap-2" role="radiogroup" aria-label="Arrivée">
          <h3 className="text-sm font-semibold">🏁 Arrivée</h3>
          <Option actif={aKind === "depot"} onChoisir={() => setAKind("depot")} titre="Retour au dépôt" detail={depotConnu ? "Le trajet retour compte dans le calcul." : "Aucune adresse de dépôt connue."} desactive={!depotConnu} />
          <Option actif={aKind === "meme"} onChoisir={() => setAKind("meme")} titre="Même point que le départ" detail="Vous finissez là où vous avez commencé." />
          <Option actif={aKind === "arret"} onChoisir={() => setAKind("arret")} titre="Une adresse de la tournée" detail={sansRetour ? "Cet arrêt devient le dernier livré, sans retour." : "Cet arrêt devient le dernier livré, puis retour au dépôt."} desactive={!choisissables.length}>
            {selectArret(aArret, setAArret, "Arrêt à faire en dernier", dKind === "arret" ? dArret : undefined)}
            <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" checked={!sansRetour} onChange={(e) => setSansRetour(!e.target.checked)} className="h-5 w-5" />
              Inclure le retour au dépôt après cet arrêt
            </label>
          </Option>
          <Option actif={aKind === "adresse"} onChoisir={() => setAKind("adresse")} titre="Une autre adresse">
            {champAdresse(aTexte, setATexte, aLieu, setALieu)}
          </Option>
          <Option actif={aKind === "libre"} onChoisir={() => setAKind("libre")} titre="Pas de retour imposé" detail="Vous finissez au dernier arrêt, sans trajet en plus." />
        </section>

        {conflit && <p className="rounded-xl bg-orange/15 px-3 py-2 text-sm font-semibold text-orange-ink">Un même arrêt ne peut pas être le premier et le dernier : choisissez deux arrêts différents.</p>}
        {erreur && (
          <p className="rounded-xl bg-orange/15 px-3 py-2 text-sm font-semibold text-orange-ink" role="alert">
            {erreur}
          </p>
        )}
        <p className="text-xs text-navy/60">Les arrêts déjà livrés ou en échec ne bougent pas. Les horaires d&apos;ouverture et les créneaux sont toujours respectés.</p>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary min-h-[48px] justify-center" onClick={onFermer} disabled={busy}>
            Annuler
          </button>
          <button type="button" className="btn-primary min-h-[48px] justify-center" onClick={valider} disabled={busy || departIncomplet || arriveeIncomplete || conflit}>
            {busy ? "Calcul…" : "Optimiser"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ligne « 🏁 Départ : Dépôt » / « 🏁 Arrivée : Dépôt » en tête et en bas de la liste. */
export function LigneExtremite({ type, libelle, onModifier }: { type: "depart" | "arrivee"; libelle: string; onModifier?: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 bg-navy/[0.03] px-4 py-2 text-sm sm:px-5" aria-label={`${type === "depart" ? "Départ" : "Arrivée"} : ${libelle}`}>
      <span className="min-w-0 truncate font-semibold">
        🏁 {type === "depart" ? "Départ" : "Arrivée"} : <span className="font-normal">{libelle}</span>
      </span>
      {onModifier && (
        <button type="button" className="btn-ghost min-h-[44px] shrink-0 !px-3 text-xs" onClick={onModifier}>
          Modifier
        </button>
      )}
    </li>
  );
}

/** Pastille 📌 d'un arrêt fixé en premier ou en dernier. */
export function BadgeEpingle({ role }: { role: "premier" | "dernier" }) {
  return <span className="rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal-ink">📌 {role === "premier" ? "Premier" : "Dernier"}</span>;
}
