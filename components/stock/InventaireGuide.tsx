"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { appeler, Champ, Message } from "@/components/stock/commun";
import { choixRangement, libelleEmplacement, type EmplacementLu } from "@/lib/stock/emplacements";
import { nouvelleCle, normaliserCode } from "@/lib/stock/mouvements";
import { phraseBilan, type BilanInventaire } from "@/lib/stock/inventaire";
import { formaterQuantite } from "@/lib/stock/soldes";
import { confirmer } from "@/lib/ui/confirmation";

const ParcelScanner = dynamic(() => import("@/components/colis/ParcelScanner").then((m) => m.ParcelScanner), { ssr: false });

interface Ligne {
  id: string;
  genre: "unite" | "article";
  unite_code: string | null;
  article_id: string | null;
  emplacement_id: string | null;
  lot: string;
  quantite_comptee: number | null;
}

interface Props {
  inventaireId: string;
  enCours: boolean;
  peutValider: boolean;
  emplacements: EmplacementLu[];
  attendues: string[];
  lignes: Ligne[];
  articles: { id: string; code: string; nom: string; unite: string }[];
  bilan: BilanInventaire;
}

/**
 * Inventaire guidé : 1) scanner les unités trouvées (où que l'on soit, l'emplacement se règle une fois),
 * 2) saisir les quantités des articles, 3) lire les écarts et valider. Comptage en aveugle : le stock
 * attendu n'est montré qu'à la fin. Chaque comptage remplace le précédent : le rejouer ne change rien.
 */
export function InventaireGuide({ inventaireId, enCours, peutValider, emplacements, attendues, lignes, articles, bilan }: Props) {
  const router = useRouter();
  const [, demarrer] = useTransition();
  const [emplacement, setEmplacement] = useState("");
  const [code, setCode] = useState("");
  const [scanner, setScanner] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const cleValidation = useRef(nouvelleCle("invval"));
  const site = emplacements[0]?.site_id ?? "";
  const choix = useMemo(() => choixRangement(site, emplacements), [site, emplacements]);

  const comptees = lignes.filter((l) => l.genre === "unite").map((l) => l.unite_code!);
  const compteesSet = new Set(comptees);
  const restantes = attendues.filter((c) => !compteesSet.has(c));
  const lignesArticles = lignes.filter((l) => l.genre === "article");

  async function compter(corps: Record<string, unknown>, nom: string): Promise<boolean> {
    const r = await appeler(`/api/stock/inventaires/${inventaireId}/comptage`, { corps });
    if (!r.ok) {
      setMessage({ texte: `${nom} : ${r.erreur}`, erreur: true });
      return false;
    }
    setMessage({ texte: `${nom} compté.`, erreur: false });
    demarrer(() => router.refresh());
    return true;
  }

  async function compterCode(brut: string) {
    const c = normaliserCode(brut);
    if (!c) {
      setMessage({ texte: "Code invalide.", erreur: true });
      return false;
    }
    return compter({ code: c, emplacement_id: emplacement || null }, c);
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setOccupe(true);
    if (await compterCode(code)) setCode("");
    setOccupe(false);
  }

  async function valider() {
    const phrase = phraseBilan(bilan);
    const ok = await confirmer({
      titre: "Valider l'inventaire ?",
      message: `${phrase} Les écarts seront corrigés par des ajustements, visibles dans l'historique, et ne pourront pas être annulés. Les unités attendues mais non comptées seront déclarées perdues.`,
      action: "Valider l'inventaire",
      danger: bilan.total > 0,
    });
    if (!ok) return;
    setOccupe(true);
    const r = await appeler(`/api/stock/inventaires/${inventaireId}/validation`, { corps: { cle: cleValidation.current, confirmer: true } });
    setOccupe(false);
    if (!r.ok) {
      setMessage({ texte: r.erreur, erreur: true });
      return;
    }
    setMessage({ texte: "Inventaire validé.", erreur: false });
    demarrer(() => router.refresh());
  }

  async function abandonner() {
    const ok = await confirmer({ titre: "Abandonner ce comptage ?", message: "Aucun mouvement n'est créé et le stock ne change pas. Vous pourrez ouvrir un nouvel inventaire pour cette zone.", action: "Abandonner", danger: true });
    if (!ok) return;
    setOccupe(true);
    const r = await appeler(`/api/stock/inventaires/${inventaireId}/annulation`, { method: "POST", corps: {} });
    setOccupe(false);
    if (!r.ok) {
      setMessage({ texte: r.erreur, erreur: true });
      return;
    }
    router.push("/exploitation/stock/inventaire");
    router.refresh();
  }

  const nomArticle = (id: string | null) => articles.find((a) => a.id === id);

  return (
    <div className="flex flex-col gap-5">
      {enCours && (
        <>
          <section aria-labelledby="inv-unites" className="card flex flex-col gap-4 !p-4 sm:!p-5">
            <div>
              <h2 id="inv-unites" className="text-lg font-bold">
                1. Colis et palettes
              </h2>
              <p className="mt-1 text-sm text-navy/65" role="status">
                {comptees.length} comptée{comptees.length > 1 ? "s" : ""}
                {attendues.length ? ` · ${restantes.length} attendue${restantes.length > 1 ? "s" : ""} à retrouver` : ""}
              </p>
            </div>
            <Champ libelle="Où êtes-vous ?" aide="Les unités scannées sont comptées à cet emplacement. Changez-le en changeant de rayon.">
              {(id, aide) => (
                <select id={id} aria-describedby={aide} className="input" value={emplacement} onChange={(e) => setEmplacement(e.target.value)}>
                  <option value="">Emplacement non précisé</option>
                  {choix.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.libelle}
                    </option>
                  ))}
                </select>
              )}
            </Champ>
            <form onSubmit={soumettre} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Champ libelle="Code scanné ou saisi">{(id) => <input id={id} className="input" autoComplete="off" spellCheck={false} maxLength={80} value={code} onChange={(e) => setCode(e.target.value)} />}</Champ>
              </div>
              <button type="submit" className="btn-primary min-h-11" disabled={occupe || !code.trim()}>
                Compter
              </button>
              <button type="button" className="btn-secondary min-h-11" onClick={() => setScanner(true)}>
                Scanner en rafale
              </button>
            </form>
            {restantes.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-teal-ink">Voir les {restantes.length} unité{restantes.length > 1 ? "s" : ""} restant à trouver</summary>
                <p className="mt-2 break-words text-navy/80">{restantes.slice(0, 200).join(", ")}{restantes.length > 200 ? "…" : ""}</p>
              </details>
            )}
          </section>

          <section aria-labelledby="inv-articles" className="card flex flex-col gap-3 !p-4 sm:!p-5">
            <h2 id="inv-articles" className="text-lg font-bold">
              2. Articles en quantité
            </h2>
            {lignesArticles.length === 0 ? (
              <p className="text-sm text-navy/65">Aucun article en stock dans ce périmètre.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {lignesArticles.map((l) => {
                  const a = nomArticle(l.article_id);
                  const emp = emplacements.find((e) => e.id === l.emplacement_id);
                  return (
                    <li key={l.id} className="flex flex-wrap items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold">{a ? `${a.nom} (${a.code})` : "Article"}</p>
                        <p className="text-xs text-navy/65">{[emp ? libelleEmplacement(emp, emplacements) : "Sans emplacement", l.lot ? `lot ${l.lot}` : null].filter(Boolean).join(" · ")}</p>
                      </div>
                      <QuantiteComptee valeur={l.quantite_comptee} unite={a?.unite ?? ""} onEnregistrer={(q) => compter({ article_id: l.article_id, emplacement_id: l.emplacement_id, lot: l.lot || null, quantite: q }, a?.nom ?? "Article")} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="inv-ecarts" className="card flex flex-col gap-3 !p-4 sm:!p-5">
        <h2 id="inv-ecarts" className="text-lg font-bold">
          {enCours ? "3. Écarts constatés" : "Écarts"}
        </h2>
        <p className="text-sm" role="status">
          {phraseBilan(bilan)}
        </p>
        {bilan.unites.filter((u) => u.genre !== "conforme").length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {bilan.unites
              .filter((u) => u.genre !== "conforme")
              .slice(0, 100)
              .map((u) => (
                <li key={u.code} className="break-words">
                  <span className="font-semibold">{u.code}</span> :{" "}
                  {u.genre === "manquante" ? "attendue, non retrouvée (sera déclarée perdue)" : u.genre === "trouvee" ? "trouvée alors qu'elle n'était pas en stock (sera remise en stock)" : "rangée à un autre emplacement (sera déplacée)"}
                </li>
              ))}
          </ul>
        )}
        {bilan.articles.filter((a) => a.ecart !== 0).length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {bilan.articles
              .filter((a) => a.ecart !== 0)
              .map((a, i) => {
                const art = nomArticle(a.article_id);
                return (
                  <li key={i}>
                    <span className="font-semibold">{art ? art.nom : "Article"}</span> : attendu {formaterQuantite(a.theorique)}, compté {formaterQuantite(a.compte)} ({a.ecart > 0 ? "+" : ""}
                    {formaterQuantite(a.ecart)})
                  </li>
                );
              })}
          </ul>
        )}
        {enCours && (
          <div>
            {peutValider ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className="btn-primary min-h-11 w-full sm:w-auto" onClick={valider} disabled={occupe}>
                  Valider l&apos;inventaire
                </button>
                <button type="button" className="btn-secondary min-h-11 w-full sm:w-auto" onClick={abandonner} disabled={occupe}>
                  Abandonner le comptage
                </button>
              </div>
            ) : (
              <p className="text-sm text-navy/65">La validation est réservée au manager, à l&apos;exploitation et à la direction.</p>
            )}
          </div>
        )}
      </section>

      <Message message={message?.texte ?? null} erreur={message?.erreur} />

      {scanner && (
        <ParcelScanner
          consigne="Inventaire : passez les colis et palettes devant la caméra"
          bouton="Terminer"
          statut={message ? `${message.erreur ? "✗" : "✓"} ${message.texte}` : ""}
          onCode={(texte) => {
            void compterCode(texte);
          }}
          onClose={() => setScanner(false)}
        />
      )}
    </div>
  );
}

function QuantiteComptee({ valeur, unite, onEnregistrer }: { valeur: number | null; unite: string; onEnregistrer: (q: number) => Promise<boolean> }) {
  const [texte, setTexte] = useState(valeur === null ? "" : String(valeur));
  const id = useMemo(() => `q-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div className="flex items-end gap-2">
      <label htmlFor={id} className="sr-only">
        Quantité comptée
      </label>
      <input id={id} className="input !w-28" inputMode="decimal" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Compté" />
      <span className="pb-2 text-sm text-navy/65">{unite}</span>
      <button
        type="button"
        className="btn-secondary min-h-11"
        disabled={texte.trim() === ""}
        onClick={() => {
          const n = Number(texte.replace(",", "."));
          if (Number.isFinite(n) && n >= 0) void onEnregistrer(n);
        }}
      >
        {valeur === null ? "Enregistrer" : "Mettre à jour"}
      </button>
    </div>
  );
}
