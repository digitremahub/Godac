"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Fenetre } from "@/components/planning/Fenetre";
import { useAffectations, type EntreeAffectation } from "@/components/planning/AffectationElements";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
import { jourDe, JOURS_LONGS, rangJour } from "@/lib/planning/semaine";
import {
  LIBELLE_NATURE,
  indexerRepartition,
  resumeRepartition,
  texteAAttribuer,
  type ElementFusion,
  type EtatElement,
  type LigneRepartition,
  type NatureEcart,
  type Reconciliation,
} from "@/lib/planning/fusion";

/** Affectation déjà posée sur une tournée d'origine de cette fusion (lib/planning/fusion-verrou-serveur.ts › DoublonSignale). */
interface DoublonFeuille {
  entry_id: string;
  tour_number: string;
  chauffeur: string | null;
  status: string;
  message: string;
}

interface EtatFusion {
  fusionnee: boolean;
  doublons?: DoublonFeuille[];
  routes: { id: string; tour_number: string }[];
  routes_disponibles: { id: string; tour_number: string; villages: number }[];
  elements: { villages: ElementFusion[]; ramasses: ElementFusion[] };
  lignes: LigneRepartition[];
  chauffeurs: { id: string; full_name: string; sur_la_tournee: boolean }[];
}

type ReponseReconciliation = Reconciliation & { texte: string };

/** Valeur d'un choix : "" = À attribuer, "d:<chauffeur>", "r:<tournée réelle>". */
const valeurDe = (l: Pick<LigneRepartition, "driver_id" | "route_id"> | undefined): string => (l?.driver_id ? `d:${l.driver_id}` : l?.route_id ? `r:${l.route_id}` : "");
const cleChoix = (e: Pick<ElementFusion, "kind" | "cle">) => `${e.kind}:${e.cle}`;

/**
 * « Répartir » une tournée fusionnée (le lundi, plusieurs tournées regroupées
 * en une seule) : quelles sont les tournées d'origine, puis à qui va chaque
 * village et chaque ramasse. Tout ce qui n'est pas attribué reste « À
 * attribuer » (visible dans « À traiter aujourd'hui »). L'attribution est
 * PROVISOIRE : « Comparer avec le réel » montre ce que les chauffeurs ont
 * vraiment sur leurs fiches Tournée colis et aligne la répartition dessus.
 */
export function FeuilleRepartir({ entree, onFermer, onResultat }: { entree: EntreeAffectation; onFermer: () => void; onResultat: (texte: string, ton: "ok" | "attention" | "erreur") => void }) {
  const ctx = useAffectations();
  const [etat, setEtat] = useState<EtatFusion | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [origines, setOrigines] = useState<string[]>([]);
  const [reel, setReel] = useState<ReponseReconciliation | null>(null);
  const [doublons, setDoublons] = useState<DoublonFeuille[]>([]);

  const url = `/api/planning/entries/${entree.id}`;
  const jour = jourDe(entree.start_at);

  const charger = useCallback(async () => {
    const r = await fetchGodac<EtatFusion & { resume: unknown }>(`${url}/fusion`);
    if (!r.ok) return setErreur(r.refus.message);
    setErreur(null);
    setEtat(r.data);
    setDoublons(r.data.doublons ?? []);
    setOrigines(r.data.routes.map((x) => x.id));
    const index = indexerRepartition(r.data.lignes);
    const depart: Record<string, string> = {};
    for (const e of [...r.data.elements.villages, ...r.data.elements.ramasses]) depart[cleChoix(e)] = valeurDe(index.get(cleChoix(e)));
    setChoix(depart);
  }, [url]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const index = useMemo(() => indexerRepartition(etat?.lignes ?? []), [etat]);
  const elements = useMemo(() => (etat ? [...etat.elements.villages, ...etat.elements.ramasses] : []), [etat]);
  // Résumé « À attribuer » d'après les choix en cours (avant enregistrement).
  const resumeLocal = useMemo(() => {
    const lignes: LigneRepartition[] = elements.map((e) => {
      const v = choix[cleChoix(e)] ?? "";
      return { kind: e.kind, element_key: e.cle, element_label: e.label, driver_id: v.startsWith("d:") ? v.slice(2) : null, route_id: v.startsWith("r:") ? v.slice(2) : null, statut: "provisoire" as const };
    });
    return resumeRepartition(elements, lignes);
  }, [elements, choix]);
  const modifies = elements.filter((e) => (choix[cleChoix(e)] ?? "") !== valeurDe(index.get(cleChoix(e))));

  const nom = (id: string | null) => (id ? (etat?.chauffeurs.find((c) => c.id === id)?.full_name ?? ctx.nomChauffeur(id)) : "—");

  async function enregistrerFusion() {
    setOccupe(true);
    const r = await fetchGodac<{ doublons?: DoublonFeuille[] }>(`${url}/fusion`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_ids: origines }) });
    setOccupe(false);
    if (!r.ok) return setErreur(r.refus.message);
    await charger();
    // Une affectation existe déjà sur une tournée d'origine : la fusion est enregistrée, le doublon est signalé.
    const trouves = r.data.doublons ?? [];
    setDoublons(trouves);
    if (trouves.length) return onResultat(`Tournée fusionnée enregistrée. ${trouves.map((d) => d.message).join(" ")}`, "attention");
    onResultat(origines.length ? "Tournée fusionnée enregistrée : répartissez ses villages et ses ramasses. Les tournées regroupées ne s'affectent plus." : "Ce n'est plus une tournée fusionnée.", "ok");
  }

  /** « Retirer l'affectation » d'un doublon (confirmation ; trace d'audit côté serveur). */
  async function retirerDoublon(d: DoublonFeuille) {
    if (!(await confirmer({ titre: `Retirer ${d.chauffeur ?? "le chauffeur"} de la tournée ${d.tour_number} ?`, message: `La tournée ${d.tour_number} est regroupée dans la ${entree.tour_number} : son affectation est retirée (la fiche colis préparée aussi). L'opération est tracée dans le journal d'audit.`, action: "Retirer l'affectation", danger: true }))) return;
    setOccupe(true);
    const r = await fetchGodac(`/api/planning/entries/${d.entry_id}/doublon-fusion`, { method: "DELETE" });
    setOccupe(false);
    if (!r.ok) return setErreur(r.refus.message);
    setDoublons((l) => l.filter((x) => x.entry_id !== d.entry_id));
    onResultat(`${d.chauffeur ?? "Le chauffeur"} retiré de la tournée ${d.tour_number} : le doublon est résolu.`, "ok");
  }

  async function retirerFusion() {
    if (!(await confirmer({ titre: "Ce n'est plus une tournée fusionnée ?", message: "Les tournées regroupées redeviennent des cases normales, affectables ; la répartition provisoire de leurs villages et de leurs ramasses est effacée et l'alerte de fusion est close. Les fiches colis déjà créées ne sont pas modifiées.", action: "Ne plus fusionner", danger: true }))) return;
    setOccupe(true);
    const r = await fetchGodac(`${url}/fusion`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_ids: [] }) });
    setOccupe(false);
    if (!r.ok) return setErreur(r.refus.message);
    onResultat("Ce n'est plus une tournée fusionnée.", "ok");
    onFermer();
  }

  async function enregistrerRepartition() {
    setOccupe(true);
    setErreur(null);
    const attributions = modifies.map((e) => {
      const v = choix[cleChoix(e)] ?? "";
      return { kind: e.kind, cle: e.cle, driver_id: v.startsWith("d:") ? v.slice(2) : null, route_id: v.startsWith("r:") ? v.slice(2) : null };
    });
    const r = await fetchGodac<{ texte: string; warning: string | null }>(`${url}/repartition`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attributions }) });
    setOccupe(false);
    if (!r.ok) return setErreur(r.refus.message);
    onResultat(`Répartition enregistrée (provisoire) : ${r.data.texte.toLowerCase()}.${r.data.warning ? ` ${r.data.warning}` : ""}`, r.data.warning ? "attention" : "ok");
    onFermer();
  }

  async function comparer() {
    setOccupe(true);
    setErreur(null);
    const r = await fetchGodac<ReponseReconciliation>(`${url}/reconciliation`);
    setOccupe(false);
    if (!r.ok) return setErreur(r.refus.message);
    setReel(r.data);
  }

  async function aligner() {
    setOccupe(true);
    setErreur(null);
    const r = await fetchGodac<{ texte: string }>(`${url}/reconciliation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setOccupe(false);
    if (!r.ok) return setErreur(r.refus.message);
    setReel(null);
    await charger();
    onResultat(r.data.texte, "ok");
  }

  const titreJour = `${JOURS_LONGS[rangJour(jour)]} ${Number(jour.slice(8, 10))}/${jour.slice(5, 7)}`;
  const choisi = new Set(origines);

  return (
    <Fenetre titre={`Répartir ${entree.tour_number}`} sousTitre={`${titreJour} · tournée fusionnée`} onFermer={onFermer} large>
      {erreur && (
        <p role="alert" className="mb-3 rounded-xl bg-orange/10 p-3 text-sm text-orange-ink">
          {erreur}
        </p>
      )}
      {!etat && !erreur && <p className="text-sm text-navy/65">Chargement…</p>}

      {etat && doublons.length > 0 && (
        <section role="alert" aria-label="Doublons" className="mb-3 flex flex-col gap-2 rounded-xl border-2 p-3" style={{ borderColor: "#d62718" }}>
          <h3 className="text-sm font-bold">
            {doublons.length} doublon{doublons.length > 1 ? "s" : ""} : tournée{doublons.length > 1 ? "s" : ""} regroupée{doublons.length > 1 ? "s" : ""} déjà affectée{doublons.length > 1 ? "s" : ""}
          </h3>
          <ul className="flex flex-col gap-2">
            {doublons.map((d) => (
              <li key={d.entry_id} className="flex flex-col gap-2 text-sm">
                <span>{d.message}</span>
                {d.status === "planned" ? (
                  <button type="button" className="btn-dark min-h-[48px] self-start !px-4 text-sm max-md:w-full max-md:text-base" disabled={occupe} onClick={() => void retirerDoublon(d)}>
                    Retirer l&apos;affectation
                  </button>
                ) : (
                  <span className="text-xs text-navy/65">Tournée déjà démarrée : l&apos;affectation ne peut plus être retirée d&apos;ici.</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-navy/65">Ou gardez la tournée séparée : « Ne plus fusionner ». Tant que le doublon subsiste, l&apos;envoi automatique du vendredi est bloqué.</p>
        </section>
      )}

      {etat && (
        <>
          <details open={!etat.fusionnee} className="mb-3 rounded-xl border border-navy/10 p-3">
            <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">
              Tournées regroupées{etat.fusionnee ? ` : ${etat.routes.map((r) => r.tour_number).join(", ")}` : " : à choisir"}
            </summary>
            <p className="mb-2 text-sm text-navy/65">Cochez les tournées dont cette ligne reprend les villages et les ramasses.</p>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {etat.routes_disponibles.map((r) => (
                <li key={r.id}>
                  <label className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${choisi.has(r.id) ? "border-teal bg-teal/10 font-semibold" : "border-navy/15"}`}>
                    <input type="checkbox" className="h-5 w-5" checked={choisi.has(r.id)} onChange={() => setOrigines((v) => (v.includes(r.id) ? v.filter((x) => x !== r.id) : [...v, r.id]))} />
                    <span className="min-w-0 flex-1 truncate">{r.tour_number}</span>
                    <span className="text-xs text-navy/55">{r.villages} vill.</span>
                  </label>
                </li>
              ))}
              {etat.routes_disponibles.length === 0 && <li className="text-sm text-navy/65">Aucune tournée-modèle : créez-les dans Tournée colis › Tournées.</li>}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn-dark min-h-[48px] !px-4 text-sm disabled:opacity-60" disabled={occupe || origines.length === 0} onClick={() => void enregistrerFusion()}>
                {etat.fusionnee ? "Mettre à jour les tournées regroupées" : "Marquer comme tournée fusionnée"}
              </button>
              {etat.fusionnee && (
                <button type="button" className="btn-secondary min-h-[48px] !px-4 text-sm" disabled={occupe} onClick={() => void retirerFusion()}>
                  Ne plus fusionner
                </button>
              )}
            </div>
          </details>

          {etat.fusionnee && (
            <>
              <p className={`mb-2 rounded-xl px-3 py-2 text-sm font-semibold ${resumeLocal.aAttribuer ? "bg-orange/15 text-orange-ink" : "bg-success/10 text-success-ink"}`} aria-live="polite">
                {texteAAttribuer(resumeLocal)}
                {resumeLocal.aAttribuer ? " · ils restent visibles pour tous les chauffeurs de la tournée jusqu'à leur attribution." : "."}
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">Tout attribuer à</span>
                  <select
                    className="input min-h-[48px] !w-auto text-sm"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__rien__") setChoix(Object.fromEntries(elements.map((x) => [cleChoix(x), ""])));
                      else if (v) setChoix(Object.fromEntries(elements.map((x) => [cleChoix(x), v])));
                    }}
                  >
                    <option value="">Choisir…</option>
                    <Options etat={etat} />
                    <option value="__rien__">Tout remettre à attribuer</option>
                  </select>
                </label>
              </div>

              <ul className="flex flex-col gap-2">
                {etat.elements.villages.map((v) => {
                  const ramasses = etat.elements.ramasses.filter((r) => r.villageId === v.villageId);
                  return (
                    <li key={v.cle} className="rounded-xl border border-navy/10 p-2.5">
                      <Ligne element={v} etat={etatDe(index, v)} valeur={choix[cleChoix(v)] ?? ""} onChange={(x) => setChoix((c) => ({ ...c, [cleChoix(v)]: x }))} etatFusion={etat} />
                      {ramasses.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-2 border-l-2 border-navy/10 pl-3">
                          {ramasses.map((r) => (
                            <li key={r.cle}>
                              <Ligne element={r} etat={etatDe(index, r)} valeur={choix[cleChoix(r)] ?? ""} onChange={(x) => setChoix((c) => ({ ...c, [cleChoix(r)]: x }))} etatFusion={etat} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {etat.elements.villages.length === 0 && <li className="text-sm text-navy/65">Les tournées regroupées n&apos;ont aucun village. Ajoutez-les dans Tournée colis › Tournées.</li>}
              </ul>
              <p className="mt-2 text-sm text-navy/60">Une ramasse peut être attribuée à un autre chauffeur que celui de son village ; « À attribuer » la laisse suivre son village. L&apos;attribution est provisoire : elle se corrige avec les tournées réelles.</p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-dark min-h-[48px] !px-4 text-sm disabled:opacity-60" disabled={occupe || modifies.length === 0} onClick={() => void enregistrerRepartition()}>
                  Enregistrer la répartition{modifies.length ? ` (${modifies.length})` : ""}
                </button>
                <button type="button" className="btn-secondary min-h-[48px] !px-4 text-sm" disabled={occupe} onClick={() => void comparer()}>
                  Comparer avec les tournées réelles
                </button>
              </div>

              {reel && (
                <section className="mt-4 rounded-xl border border-navy/10 p-3" aria-label="Prévu et réel">
                  <h3 className="text-sm font-bold">Prévu / réel du {titreJour}</h3>
                  <p className="mt-1 text-sm text-navy/70">{reel.texte}</p>
                  <ul className="mt-2 flex max-h-[30vh] flex-col gap-1.5 overflow-y-auto">
                    {reel.ecarts
                      .filter((e) => e.nature !== "conforme")
                      .map((e) => (
                        <li key={`${e.kind}:${e.cle}`} className="rounded-lg bg-navy/[0.04] px-2.5 py-1.5 text-sm">
                          <span className="font-semibold">{e.kind === "ramasse" ? "Ramasse · " : ""}{e.label}</span>
                          <span className="block text-xs text-navy/65">
                            {LIBELLE_NATURE[e.nature as NatureEcart]} · prévu : {nom(e.prevu)}
                            {e.etatPrevu === "a_attribuer" ? " (à attribuer)" : ""} · réel : {e.reel.length ? e.reel.map(nom).join(", ") : "—"}
                            {e.faite ? " · faite" : ""}
                          </span>
                        </li>
                      ))}
                    {reel.ecarts.every((e) => e.nature === "conforme") && <li className="text-sm text-success-ink">Tout est conforme au prévu.</li>}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-dark min-h-[48px] !px-4 text-sm disabled:opacity-60" disabled={occupe || reel.propositions.length === 0} onClick={() => void aligner()}>
                      Aligner sur le réel ({reel.propositions.length})
                    </button>
                    <p className="self-center text-xs text-navy/60">Le reste se corrige à la main ci-dessus.</p>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </Fenetre>
  );
}

function etatDe(index: Map<string, LigneRepartition>, e: ElementFusion): EtatElement {
  const l = index.get(cleChoix(e));
  return l && (l.driver_id || l.route_id) ? l.statut : "a_attribuer";
}

function Options({ etat }: { etat: EtatFusion }) {
  const sur = etat.chauffeurs.filter((c) => c.sur_la_tournee);
  const autres = etat.chauffeurs.filter((c) => !c.sur_la_tournee);
  return (
    <>
      {sur.length > 0 && (
        <optgroup label="Chauffeurs de cette tournée">
          {sur.map((c) => (
            <option key={c.id} value={`d:${c.id}`}>
              {c.full_name}
            </option>
          ))}
        </optgroup>
      )}
      {autres.length > 0 && (
        <optgroup label="Autres chauffeurs du service (pas sur cette tournée ce jour-là)">
          {autres.map((c) => (
            <option key={c.id} value={`d:${c.id}`}>
              {c.full_name}
            </option>
          ))}
        </optgroup>
      )}
      {etat.routes.length > 0 && (
        <optgroup label="Tournée réelle (chauffeur pas encore connu)">
          {etat.routes.map((r) => (
            <option key={r.id} value={`r:${r.id}`}>
              Tournée {r.tour_number}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

const LIBELLE_ETAT: Record<EtatElement, string> = { a_attribuer: "À attribuer", provisoire: "provisoire", confirme: "confirmé" };

function Ligne({ element, etat, valeur, onChange, etatFusion }: { element: ElementFusion; etat: EtatElement; valeur: string; onChange: (v: string) => void; etatFusion: EtatFusion }) {
  const ramasse = element.kind === "ramasse";
  const id = `rep-${element.kind}-${element.cle}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="min-w-0 flex-1 basis-40">
        <span className={`block truncate text-sm ${ramasse ? "" : "font-bold"}`}>
          {ramasse ? "Ramasse · " : ""}
          {element.label}
        </span>
        <span className={`text-xs ${etat === "a_attribuer" ? "text-orange-ink" : "text-navy/60"}`}>{LIBELLE_ETAT[etat]}</span>
      </label>
      <select id={id} className="input min-h-[48px] !w-auto min-w-[11rem] flex-1 text-sm sm:flex-none" value={valeur} onChange={(e) => onChange(e.target.value)}>
        <option value="">À attribuer</option>
        <Options etat={etatFusion} />
      </select>
    </div>
  );
}
