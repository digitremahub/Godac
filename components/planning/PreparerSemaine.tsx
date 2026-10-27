"use client";

import { useMemo, useState } from "react";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { SEMAINES_A_L_AVANCE, instantParis, libelleLundi, libelleSemaine, semainesPreparables } from "@/lib/planning/semaines-auto";
import { Fenetre } from "@/components/planning/Fenetre";

type Reponse = { cases_creees: number; a_remplacer: number; source: string | null };

const TOUS = "tous";
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * « Préparer une semaine… » : choisir une semaine à venir (la suivante et jusqu'à
 * 8 semaines plus loin) et la générer à partir de la plus proche semaine déjà
 * planifiée (POST /api/planning/semaine-suivante/generer), sans passer par le bandeau.
 * Rien n'est écrasé et les chauffeurs ne voient rien tant que la semaine n'est pas
 * confirmée. Une fois faite, la vue Semaine s'ouvre sur la semaine préparée.
 */
export function PreparerSemaine({
  services,
  serviceId,
  lundiAffiche,
  onAller,
  onFermer,
}: {
  /** Services d'exploitation proposés (ceux de la personne). */
  services: { id: string; name: string }[];
  /** Service choisi dans l'écran ; vide : tous. */
  serviceId: string;
  lundiAffiche: string;
  /** Ouvre la vue Semaine sur ce lundi. */
  onAller: (lundi: string) => void;
  onFermer: () => void;
}) {
  const semaines = useMemo(() => semainesPreparables(instantParis(new Date()).jour), []);
  const [lundi, setLundi] = useState(semaines.includes(lundiAffiche) ? lundiAffiche : semaines[0]!);
  const [cible, setCible] = useState(serviceId || (services.length === 1 ? services[0]!.id : TOUS));
  const [busy, setBusy] = useState(false);
  const [erreurs, setErreurs] = useState<string[]>([]);

  async function generer() {
    setBusy(true);
    setErreurs([]);
    const visees = cible === TOUS ? services : services.filter((s) => s.id === cible);
    const problemes: string[] = [];
    let avance = 0;
    for (const s of visees) {
      const r = await fetchGodac<Reponse>("/api/planning/semaine-suivante/generer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service_id: s.id, semaine_debut: lundi }) });
      if (r.ok) avance++;
      // « Déjà préparée » : rien à refaire, la semaine s'ouvre pour être complétée ou confirmée.
      else if (r.refus.code === "ERREUR" && r.refus.statut === 409 && /déjà préparée/.test(r.refus.message)) avance++;
      else problemes.push(visees.length > 1 ? `${s.name} : ${r.refus.message}` : r.refus.message);
    }
    setBusy(false);
    setErreurs(problemes);
    if (avance > 0 && !problemes.length) {
      onFermer();
      onAller(lundi);
    }
  }

  return (
    <Fenetre titre="Préparer une semaine" sousTitre={`Jusqu'à ${SEMAINES_A_L_AVANCE} semaines à l'avance`} onFermer={onFermer}>
      <label className="label" htmlFor="preparer-semaine">
        Semaine à préparer
      </label>
      <select id="preparer-semaine" className="input min-h-[44px] w-full" value={lundi} onChange={(e) => setLundi(e.target.value)} disabled={busy}>
        {semaines.map((l, i) => (
          <option key={l} value={l}>
            {libelleSemaine(l).replace(/^du /, "")}
            {i === 0 ? " (la prochaine)" : ""}
          </option>
        ))}
      </select>

      {services.length > 1 && !serviceId && (
        <>
          <label className="label mt-3" htmlFor="preparer-service">
            Service
          </label>
          <select id="preparer-service" className="input min-h-[44px] w-full" value={cible} onChange={(e) => setCible(e.target.value)} disabled={busy}>
            <option value={TOUS}>Tous mes services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      )}

      <p className="mt-3 text-sm text-navy/65">
        La semaine du {libelleLundi(lundi)} est préparée d&apos;après la semaine planifiée la plus proche (4 semaines en arrière au plus). Rien n&apos;est écrasé, seules les cases vides sont remplies ; les tournées fermées ne sont pas recopiées et les absents restent « à remplacer ». Les chauffeurs ne voient rien tant que vous n&apos;avez pas confirmé.
      </p>
      {erreurs.map((e) => (
        <p key={e} role="alert" className="mt-2 text-sm text-orange-ink">
          {e}
        </p>
      ))}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-dark min-h-[44px] flex-1 !px-4 text-sm" disabled={busy} onClick={() => void generer()}>
          {busy ? "Génération…" : `Générer le planning de la semaine du ${libelleLundi(lundi).replace(/^lundi /, "")}`}
        </button>
        <button type="button" className="btn-secondary min-h-[44px]" disabled={busy} onClick={onFermer}>
          Annuler
        </button>
      </div>
    </Fenetre>
  );
}
