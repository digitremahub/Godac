"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/colis/commun";
import { networkErrorMessage } from "@/lib/utils/network-error";

interface DonneesLancement {
  run: { id: string; name: string | null; run_date: string; vehicle: string | null; service: string | null };
  planning: { tour_number: string; start_at: string; vehicle: string | null; service: string | null; renfort: boolean }[];
  villages: { id: string; name: string; postal_code: string | null; tour_number: string; renfort: boolean; liste_id: string | null; arrets: number; colis: number }[];
  autres: { id: string; name: string; hors_tournee: boolean; arrets: number; colis: number }[];
  modeles: { id: string; tour_number: string; service_name: string | null; villages: number }[];
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

/**
 * Lancement de la tournée par le chauffeur, en deux temps :
 * 1. il confirme que c'est bien sa tournée (celle du planning du jour :
 *    numéro, véhicule, service ; sans planning, il la choisit) ;
 * 2. il coche chacun de ses villages (ceux de la tournée, plus ceux d'un
 *    renfort du jour) pour confirmer qu'il les prend tous.
 * La confirmation crée les listes manquantes ; l'appelant optimise ensuite
 * l'ordre (tous villages enchaînés) et démarre la tournée.
 */
export function LancementTournee({ runId, busy, onAnnuler, onConfirme }: { runId: string; busy: boolean; onAnnuler: () => void; onConfirme: () => Promise<void> }) {
  const [donnees, setDonnees] = useState<DonneesLancement | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etape, setEtape] = useState<"tournee" | "villages" | "pas_la_mienne">("tournee");
  const [modele, setModele] = useState<string>("");
  const [coches, setCoches] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let actif = true;
    setDonnees(null);
    setErreur(null);
    api<DonneesLancement>(`/api/colis/lancement?run_id=${runId}${modele ? `&route_id=${modele}` : ""}`)
      .then((d) => actif && setDonnees(d))
      .catch((e) => actif && setErreur(networkErrorMessage(e)));
    return () => {
      actif = false;
    };
  }, [runId, modele]);

  const elements = donnees
    ? [
        ...donnees.villages.map((v) => ({ id: v.id, nom: v.name, detail: `${v.arrets} adresse(s) · ${v.colis} colis${v.renfort ? ` · renfort tournée ${v.tour_number}` : ""}`, renfort: v.renfort, village: true })),
        ...donnees.autres.map((l) => ({ id: `liste:${l.id}`, nom: l.name, detail: `${l.arrets} adresse(s) · ${l.colis} colis${l.hors_tournee ? " · adresses hors des villages de la tournée" : ""}`, renfort: false, village: false })),
      ]
    : [];
  const tousCoches = elements.length > 0 && elements.every((e) => coches.includes(e.id));
  const sansPlanning = donnees !== null && donnees.planning.length === 0;

  async function confirmer() {
    if (!donnees) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await api("/api/colis/lancement", {
        method: "POST",
        body: JSON.stringify({ run_id: runId, village_ids: donnees.villages.map((v) => v.id).filter((id) => coches.includes(id)), route_id: modele || null }),
      });
      await onConfirme();
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-navy/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="lancement-titre">
      <section className="flex max-h-[92dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-5 shadow-pop">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-ink">{etape === "villages" ? "Étape 2 / 2" : "Étape 1 / 2"}</p>
          <h2 id="lancement-titre" className="font-display text-xl font-bold">
            {etape === "villages" ? "Vos villages" : "Est-ce bien votre tournée ?"}
          </h2>
        </div>

        {erreur && <p role="alert" className="rounded-xl bg-orange/10 px-3 py-2 text-sm font-semibold text-orange-ink">{erreur}</p>}
        {!donnees && !erreur && <p className="text-sm text-navy/60">Chargement du planning…</p>}

        {donnees && etape === "tournee" && (
          <>
            {donnees.planning.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {donnees.planning.map((p, i) => (
                  <li key={i} className="rounded-xl border border-teal/40 bg-teal/5 p-3">
                    <p className="font-semibold">
                      Tournée n°{p.tour_number}
                      {p.renfort && <span className="ml-2 rounded-md bg-gold/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-gold-ink">Renfort</span>}
                    </p>
                    <p className="text-sm text-navy/70">
                      {[p.vehicle ? `Véhicule ${p.vehicle}` : "Véhicule non renseigné", p.service ? `Service ${p.service}` : null, `prise de poste ${heure(p.start_at)}`].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-navy/70">Aucune tournée ne vous est attribuée au planning aujourd&apos;hui. Choisissez la tournée que vous faites :</p>
                <select className="input" value={modele} onChange={(e) => setModele(e.target.value)} aria-label="Choisir ma tournée">
                  <option value="">Sans tournée-modèle (adresses libres)</option>
                  {donnees.modeles.map((m) => (
                    <option key={m.id} value={m.id}>
                      Tournée n°{m.tour_number}
                      {m.service_name ? ` · ${m.service_name}` : ""} · {m.villages} village(s)
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(donnees.run.vehicle || donnees.run.service) && (
              <p className="text-xs text-navy/60">Fiche colis : {[donnees.run.name, donnees.run.vehicle, donnees.run.service].filter(Boolean).join(" · ")}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-secondary flex-1" onClick={onAnnuler}>
                Annuler
              </button>
              {!sansPlanning && (
                <button type="button" className="btn-secondary flex-1" onClick={() => setEtape("pas_la_mienne")}>
                  Ce n&apos;est pas ma tournée
                </button>
              )}
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() => {
                  setCoches([]);
                  setEtape("villages");
                }}
              >
                {sansPlanning ? "Continuer" : "Oui, c'est ma tournée"}
              </button>
            </div>
          </>
        )}

        {donnees && etape === "pas_la_mienne" && (
          <>
            <p className="text-sm text-navy/70">
              Prévenez votre chef d&apos;équipe ou l&apos;exploitation pour corriger le planning du jour, puis rouvrez cet écran. Ne partez pas avec les colis d&apos;une autre tournée.
            </p>
            <button type="button" className="btn-secondary" onClick={onAnnuler}>
              Fermer
            </button>
          </>
        )}

        {donnees && etape === "villages" && (
          <>
            <p className="text-sm text-navy/65">Cochez chaque village pour confirmer que vous prenez bien tous ses colis. L&apos;ordre de passage sera calculé sur l&apos;ensemble de la tournée.</p>
            {elements.length === 0 ? (
              <p className="rounded-xl bg-navy/5 p-3 text-sm text-navy/70">Aucun village ni colis à confirmer.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 px-1 text-sm font-semibold">
                  <input type="checkbox" className="h-4 w-4 accent-teal" checked={tousCoches} onChange={(e) => setCoches(e.target.checked ? elements.map((x) => x.id) : [])} />
                  Tout cocher
                </label>
                {elements.map((x) => {
                  const ok = coches.includes(x.id);
                  return (
                    <label key={x.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${ok ? "border-teal bg-teal/5" : "border-navy/15"}`}>
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-teal" checked={ok} onChange={(e) => setCoches((c) => (e.target.checked ? [...c, x.id] : c.filter((id) => id !== x.id)))} />
                      <span className="flex-1">
                        <strong>{x.nom}</strong>
                        {x.renfort && <span className="ml-2 rounded-md bg-gold/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-gold-ink">Renfort</span>}
                        <span className="block text-xs text-navy/60">{x.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" disabled={busy || envoi} onClick={() => setEtape("tournee")}>
                Retour
              </button>
              <button type="button" className="btn-primary flex-1" disabled={busy || envoi || (elements.length > 0 && !tousCoches)} onClick={confirmer}>
                {busy || envoi ? "Optimisation…" : "Je confirme et je démarre"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
