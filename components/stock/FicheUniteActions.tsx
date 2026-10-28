"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ChampsAttributs } from "@/components/stock/ChampsAttributs";
import { appeler, Message } from "@/components/stock/commun";
import { attributsDeModification, valeursDepuisUnite, type ValeursForm } from "@/lib/stock/formulaire";
import { nouvelleCle } from "@/lib/stock/mouvements";
import { DEFINITION_FORMATS, FORMATS_ETIQUETTE, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";
import type { Profil } from "@/lib/stock/profils";
import type { UniteLue } from "@/lib/stock/unites-serveur";

/**
 * Actions de la fiche d'unité : imprimer ou réimprimer l'étiquette (choix du format), ajouter un code
 * interne complémentaire, modifier les attributs (encadrement). Le code principal ne change jamais.
 */
export function FicheUniteActions({ unite, profil, peutModifier, formatParDefaut }: { unite: UniteLue; profil: Profil | null; peutModifier: boolean; formatParDefaut: CleFormatEtiquette }) {
  const router = useRouter();
  const [, demarrer] = useTransition();
  const [valeurs, setValeurs] = useState<ValeursForm>(() => valeursDepuisUnite(unite));
  const [format, setFormat] = useState<CleFormatEtiquette>(formatParDefaut);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const cleCode = useRef<string | null>(null);
  const aCodeInterne = Boolean(unite.code_interne);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    const r = await appeler(`/api/stock/unites/${unite.id}`, { method: "PATCH", corps: { attributs: attributsDeModification(valeurs, profil) } });
    setEnCours(false);
    if (!r.ok) return setMessage({ texte: r.erreur, erreur: true });
    setMessage({ texte: "Attributs enregistrés.", erreur: false });
    demarrer(() => router.refresh());
  }

  async function genererInterne() {
    setEnCours(true);
    cleCode.current ??= nouvelleCle("code");
    const g = await appeler<{ codes?: string[] }>("/api/stock/codes", { corps: { nombre: 1, cle: cleCode.current } });
    if (!g.ok) {
      setEnCours(false);
      return setMessage({ texte: g.erreur, erreur: true });
    }
    const code = g.data.codes?.[0];
    const r = code ? await appeler(`/api/stock/unites/${unite.id}`, { method: "PATCH", corps: { code_interne: code } }) : null;
    setEnCours(false);
    if (!r || !r.ok) return setMessage({ texte: r && !r.ok ? r.erreur : "Aucun code reçu.", erreur: true });
    cleCode.current = null;
    setMessage({ texte: `Code interne ${code} ajouté. Le code d'origine reste le code principal.`, erreur: false });
    demarrer(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-5">
      <Message message={message?.texte ?? null} erreur={message?.erreur} />
      <section aria-labelledby="f-etiquette" className="card flex flex-col gap-3 !p-4">
        <h2 id="f-etiquette" className="text-lg font-bold">
          Étiquette
        </h2>
        <p className="text-sm text-navy/65">Le QR code et le code-barres portent le code seul (aucune donnée personnelle). Imprimez à l&apos;échelle 100 %.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="label">Format</span>
            <select className="input !w-auto" value={format} onChange={(e) => setFormat(e.target.value as CleFormatEtiquette)}>
              {FORMATS_ETIQUETTE.map((f) => (
                <option key={f} value={f}>
                  {DEFINITION_FORMATS[f].libelle}
                </option>
              ))}
            </select>
          </label>
          <a href={`/api/stock/etiquettes?unites=${unite.id}&format=${format}`} target="_blank" rel="noreferrer" className="btn-primary min-h-11">
            Imprimer ou réimprimer l&apos;étiquette
          </a>
        </div>
      </section>

      {peutModifier && (
        <>
          <section aria-labelledby="f-interne" className="card flex flex-col gap-3 !p-4">
            <h2 id="f-interne" className="text-lg font-bold">
              Code interne
            </h2>
            {aCodeInterne ? (
              <p className="text-sm">
                Code interne complémentaire : <strong className="font-mono">{unite.code_interne}</strong>. Le scan reconnaît les deux codes.
              </p>
            ) : (
              <>
                <p className="text-sm text-navy/65">Cette unité n&apos;a pas de code interne. Son code d&apos;origine reste son code principal ; le code interne est un code complémentaire de votre entreprise.</p>
                <div>
                  <button type="button" className="btn-secondary min-h-11" disabled={enCours} onClick={() => void genererInterne()}>
                    {enCours ? "Génération…" : "Ajouter un code interne"}
                  </button>
                </div>
              </>
            )}
          </section>

          {profil && (
            <form onSubmit={enregistrer} className="card flex flex-col gap-3 !p-4" aria-labelledby="f-attributs">
              <h2 id="f-attributs" className="text-lg font-bold">
                Modifier les attributs
              </h2>
              <ChampsAttributs profil={profil} valeurs={valeurs} onChange={setValeurs} sansMesures />
              <div>
                <button type="submit" className="btn-primary min-h-11" disabled={enCours}>
                  {enCours ? "Enregistrement…" : "Enregistrer les attributs"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
