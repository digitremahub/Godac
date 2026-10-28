"use client";

import { Champ } from "@/components/stock/commun";
import { AVERTISSEMENT_DONNEES_SANTE, CONSIGNE_MAX, LIBELLES_NATURE, LIBELLES_TEMPERATURE, LIBELLE_LIBRE_MAX, NATURES, TEMPERATURES } from "@/lib/stock/attributs";
import type { ValeursForm } from "@/lib/stock/formulaire";
import { champsObligatoires, champsVisibles, type ChampStock, type Profil } from "@/lib/stock/profils";

/**
 * Champs d'une unité (poids, volume, SSCC, nature, température, fragile, urgent, consigne, référence
 * client, lot, DLC) : seuls ceux que le profil affiche sont montrés ; ceux qu'il rend obligatoires
 * sont marqués et exigés. Textes libres : ne jamais saisir de donnée de santé nominative.
 */
export function ChampsAttributs({ profil, valeurs, onChange, dansDetails = false, sansMesures = false }: { profil: Profil; valeurs: ValeursForm; onChange: (v: ValeursForm) => void; dansDetails?: boolean; sansMesures?: boolean }) {
  const visibles = new Set<ChampStock>(champsVisibles(profil).filter((c) => !(sansMesures && (c === "poids" || c === "volume" || c === "sscc"))));
  const requis = new Set<ChampStock>(champsObligatoires(profil));
  const maj = <K extends keyof ValeursForm>(k: K, v: ValeursForm[K]) => onChange({ ...valeurs, [k]: v });
  const lib = (c: ChampStock, texte: string) => (requis.has(c) ? `${texte} (obligatoire)` : texte);
  const libres = visibles.has("consigne") || visibles.has("reference_client") || visibles.has("nature") || visibles.has("lot");

  const contenu = (
    <div className="mt-3 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {visibles.has("poids") && <Champ libelle={lib("poids", "Poids (kg)")}>{(id) => <input id={id} className="input" inputMode="decimal" required={requis.has("poids")} value={valeurs.poids} onChange={(e) => maj("poids", e.target.value)} />}</Champ>}
        {visibles.has("volume") && <Champ libelle={lib("volume", "Volume (m³)")}>{(id) => <input id={id} className="input" inputMode="decimal" required={requis.has("volume")} value={valeurs.volume} onChange={(e) => maj("volume", e.target.value)} />}</Champ>}
        {visibles.has("sscc") && (
          <Champ libelle={lib("sscc", "SSCC (18 chiffres)")}>{(id) => <input id={id} className="input" inputMode="numeric" maxLength={30} required={requis.has("sscc")} value={valeurs.sscc} onChange={(e) => maj("sscc", e.target.value)} />}</Champ>
        )}
        {visibles.has("lot") && (
          <Champ libelle={lib("lot", "Lot")}>{(id) => <input id={id} className="input" maxLength={60} required={requis.has("lot")} value={valeurs.lot} onChange={(e) => maj("lot", e.target.value)} />}</Champ>
        )}
        {visibles.has("dlc") && (
          <Champ libelle={lib("dlc", "Date limite (DLC)")}>{(id) => <input id={id} type="date" className="input" required={requis.has("dlc")} value={valeurs.dlc} onChange={(e) => maj("dlc", e.target.value)} />}</Champ>
        )}
        {visibles.has("reference_client") && (
          <Champ libelle={lib("reference_client", "Référence client / bordereau")}>
            {(id) => <input id={id} className="input" maxLength={60} required={requis.has("reference_client")} value={valeurs.reference_client} onChange={(e) => maj("reference_client", e.target.value)} />}
          </Champ>
        )}
      </div>

      {(visibles.has("nature") || visibles.has("temperature") || visibles.has("temperature_releve")) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {visibles.has("nature") && (
            <div className="flex flex-col gap-2">
              <Champ libelle={lib("nature", "Nature")}>
                {(id) => (
                  <select id={id} className="input" required={requis.has("nature")} value={valeurs.nature} onChange={(e) => maj("nature", e.target.value as ValeursForm["nature"])}>
                    <option value="">Non précisée</option>
                    {NATURES.map((n) => (
                      <option key={n} value={n}>
                        {LIBELLES_NATURE[n]}
                      </option>
                    ))}
                  </select>
                )}
              </Champ>
              {valeurs.nature === "autre" && <Champ libelle="Précisez la nature">{(id) => <input id={id} className="input" maxLength={LIBELLE_LIBRE_MAX} value={valeurs.nature_libelle} onChange={(e) => maj("nature_libelle", e.target.value)} />}</Champ>}
            </div>
          )}
          {visibles.has("temperature") && (
            <div className="flex flex-col gap-2">
              <Champ libelle={lib("temperature", "Température")}>
                {(id) => (
                  <select id={id} className="input" required={requis.has("temperature")} value={valeurs.temperature} onChange={(e) => maj("temperature", e.target.value as ValeursForm["temperature"])}>
                    <option value="">Non précisée</option>
                    {TEMPERATURES.map((t) => (
                      <option key={t} value={t}>
                        {LIBELLES_TEMPERATURE[t]}
                      </option>
                    ))}
                  </select>
                )}
              </Champ>
              {valeurs.temperature === "autre" && <Champ libelle="Précisez la température">{(id) => <input id={id} className="input" maxLength={LIBELLE_LIBRE_MAX} value={valeurs.temperature_libelle} onChange={(e) => maj("temperature_libelle", e.target.value)} />}</Champ>}
            </div>
          )}
          {visibles.has("temperature_releve") && (
            <Champ libelle={lib("temperature_releve", "Température relevée (°C)")} aide="Valeur lue à l'arrivée, à titre d'information.">
              {(id, aide) => <input id={id} aria-describedby={aide} className="input" inputMode="decimal" required={requis.has("temperature_releve")} value={valeurs.temperature_releve} onChange={(e) => maj("temperature_releve", e.target.value)} />}
            </Champ>
          )}
        </div>
      )}

      {(visibles.has("fragile") || visibles.has("urgent")) && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {visibles.has("fragile") && (
            <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={valeurs.fragile} onChange={(e) => maj("fragile", e.target.checked)} />
              Fragile
            </label>
          )}
          {visibles.has("urgent") && (
            <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={valeurs.urgent} onChange={(e) => maj("urgent", e.target.checked)} />
              Urgent
            </label>
          )}
        </div>
      )}

      {visibles.has("consigne") && (
        <Champ libelle={lib("consigne", "Consigne (imprimée sur l'étiquette)")} aide={`${valeurs.consigne.length}/${CONSIGNE_MAX} caractères.`}>
          {(id, aide) => <input id={id} aria-describedby={aide} className="input" maxLength={CONSIGNE_MAX} required={requis.has("consigne")} value={valeurs.consigne} onChange={(e) => maj("consigne", e.target.value)} placeholder="Ex. à garder au frais, livrer avant 10 h" />}
        </Champ>
      )}
      {libres && <p className="text-xs text-navy/65">{AVERTISSEMENT_DONNEES_SANTE}</p>}
    </div>
  );

  if (visibles.size === 0) return null;
  if (!dansDetails) return contenu;
  return (
    <details open={requis.size > 0} className="rounded-xl border border-navy/[0.1] px-3.5 py-2.5">
      <summary className="cursor-pointer text-sm font-semibold text-navy/80">Détails de l&apos;unité {requis.size > 0 ? "(champs obligatoires)" : "(facultatif)"}</summary>
      {contenu}
    </details>
  );
}
