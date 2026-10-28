"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { appeler, Champ, Choix, Message } from "@/components/stock/commun";
import { ChampsAttributs } from "@/components/stock/ChampsAttributs";
import { choixRangement, type EmplacementLu } from "@/lib/stock/emplacements";
import type { ArticleLu, SiteLu } from "@/lib/stock/chargement-serveur";
import { phraseFefo, profilDeLArticle, suggestionFefo } from "@/lib/stock/fefo";
import { corpsDepuisValeurs, valeursInitiales, type ValeursForm } from "@/lib/stock/formulaire";
import { schemaMouvement, nouvelleCle, profilDeLEntree, validerMouvement } from "@/lib/stock/mouvements";
import {
  DEFINITION_PROFILS,
  LIBELLES_TYPES_UNITE,
  LIBELLES_UNITES_ARTICLE,
  avecArticles,
  avecUnites,
  motUnite,
  profilsArticles,
  profilsUnites,
  resoudreProfil,
  typesUniteAutorises,
  type CleProfil,
  type ProfilsConfig,
  type TypeUnite,
} from "@/lib/stock/profils";
import type { Solde } from "@/lib/stock/soldes";
import { LIBELLES_MOUVEMENT, TYPES_AVEC_MOTIF, TYPES_MOUVEMENT, type TypeMouvement } from "@/lib/stock/transitions";

const ParcelScanner = dynamic(() => import("@/components/colis/ParcelScanner").then((m) => m.ParcelScanner), { ssr: false });

interface Props {
  profils: CleProfil[];
  config: ProfilsConfig;
  /** Les codes internes, attributs et étiquettes sont installés sur la base. */
  codesInstalles: boolean;
  /** Soldes des articles (suggestion FEFO à la sortie). */
  soldes: Pick<Solde, "article_id" | "site_id" | "lot" | "dlc" | "quantite">[];
  aujourdhui: string;
  sites: SiteLu[];
  emplacements: EmplacementLu[];
  articles: ArticleLu[];
  role: string;
  codeInitial?: string;
}

interface Ligne {
  id: number;
  ok: boolean;
  texte: string;
  /** Étiquette de l'unité qui vient d'entrer (bouton « Imprimer l'étiquette »). */
  uniteId?: string;
}

const lireMemoire = (cle: string): string | null => {
  try {
    return window.localStorage.getItem(cle);
  } catch {
    return null;
  }
};
const ecrireMemoire = (cle: string, valeur: string) => {
  try {
    window.localStorage.setItem(cle, valeur);
  } catch {
    /* mémoire facultative */
  }
};

const AIDE_TYPE: Record<TypeMouvement, string> = {
  entree: "Une unité arrive au dépôt : indiquez où vous la rangez.",
  sortie: "L'unité quitte le stock (remise au destinataire ou à un transporteur).",
  transfert: "Changer une unité ou une quantité d'emplacement.",
  retour: "Une unité revient d'une tournée ou d'un client.",
  casse: "Unité ou quantité abîmée : le motif est obligatoire.",
  perte: "Unité ou quantité introuvable : le motif est obligatoire.",
  ajustement: "Correction du stock par l'encadrement : le motif est obligatoire.",
};

const nombre = (v: string): number | null => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Entrée, sortie, transfert, retour, casse, perte, ajustement : on choisit le
 * mouvement et la destination UNE fois, puis on scanne (ou on saisit) autant de
 * codes que nécessaire. Chaque envoi porte sa propre clé d'idempotence : un
 * double appui ou un nouvel essai après une coupure ne crée jamais deux mouvements.
 */
export function MouvementRapide({ profils, config, codesInstalles, soldes, aujourdhui, sites, emplacements, articles, role, codeInitial = "" }: Props) {
  const unites = avecUnites(profils, config);
  const vrac = avecArticles(profils, config);
  const profilsDesUnites = profilsUnites(profils, config);
  const profilsDesArticles = profilsArticles(profils, config);
  const sitesActifs = useMemo(() => sites.filter((s) => s.actif), [sites]);
  const [cible, setCible] = useState<"unites" | "articles">(unites ? "unites" : "articles");
  const [type, setType] = useState<TypeMouvement>("entree");
  const [siteId, setSiteId] = useState<string>(sitesActifs[0]?.id ?? "");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const typesAutorises = useMemo<TypeUnite[]>(() => typesUniteAutorises(profils, config), [profils, config]);
  const [typeUnite, setTypeUnite] = useState<TypeUnite>(typesAutorises[0] ?? "colis");
  // Profil de l'entrée (mémorisé) quand plusieurs profils suivent des unités / des articles.
  const [profilUnite, setProfilUnite] = useState<CleProfil | "">(profilsDesUnites.length === 1 ? profilsDesUnites[0]! : "");
  const [profilArticle, setProfilArticle] = useState<CleProfil | "">(profilsDesArticles.length === 1 ? profilsDesArticles[0]! : "");
  const profilEffectifUnite = profilUnite ? resoudreProfil(profilUnite, config) : profilsDesUnites.length === 1 ? resoudreProfil(profilsDesUnites[0]!, config) : null;
  const [valeurs, setValeurs] = useState<ValeursForm>(() => valeursInitiales(profilEffectifUnite));
  const [ajouterInterne, setAjouterInterne] = useState(false);
  const [imprimerApres, setImprimerApres] = useState(false);
  const [aImprimer, setAImprimer] = useState<string[]>([]);
  const [generation, setGeneration] = useState(false);
  const [motif, setMotif] = useState("");
  const [sens, setSens] = useState<"1" | "-1">("1");
  const [retourVers, setRetourVers] = useState<"dans_depot" | "retour">("dans_depot");
  const [code, setCode] = useState(codeInitial);
  const [scanner, setScanner] = useState(false);
  const [articleId, setArticleId] = useState("");
  const [quantite, setQuantite] = useState("");
  const [lot, setLot] = useState("");
  const [dlc, setDlc] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [journal, setJournal] = useState<Ligne[]>([]);
  const compteur = useRef(0);
  // Codes internes déjà obtenus pour une action donnée : un nouvel essai après coupure ne consomme pas un autre numéro.
  const internes = useRef(new Map<string, string>());
  const clesGeneration = useRef(new Map<string, string>());
  // Une clé par action tant qu'elle n'a pas abouti : un nouvel essai après coupure la réutilise.
  const cles = useRef(new Map<string, string>());

  const vocabulaire = profilEffectifUnite ? profilEffectifUnite.vocabulaire : motUnite(profils, config);
  // Profil d'un article : le sien s'il est actif, sinon celui choisi à l'écran, sinon le premier profil d'articles actif.
  const profilArticleEffectif = (a: ArticleLu | null) => {
    if (a?.profil && (profilsDesArticles as string[]).includes(a.profil)) return resoudreProfil(a.profil as CleProfil, config);
    if (profilArticle) return resoudreProfil(profilArticle, config);
    return a ? (profilDeLArticle(a, profils, config) ?? null) : null;
  };
  const peutAjuster = role !== "chauffeur";
  const types = TYPES_MOUVEMENT.filter((t) => t !== "ajustement" || peutAjuster);
  const choix = useMemo(() => choixRangement(siteId, emplacements), [siteId, emplacements]);
  const article = articles.find((a) => a.id === articleId) ?? null;
  const veutDest = type === "entree" || type === "transfert" || type === "ajustement" || (type === "retour" && retourVers === "dans_depot");
  const veutSrc = cible === "articles" && (type === "sortie" || type === "transfert" || type === "casse" || type === "perte" || (type === "ajustement" && sens === "-1"));
  const veutMotif = (TYPES_AVEC_MOTIF as readonly string[]).includes(type);
  const profilDeLArticleChoisi = profilArticleEffectif(article);
  const exigeLot = Boolean(profilDeLArticleChoisi && profilDeLArticleChoisi.champs.lot === "requis");
  const exigeDlc = Boolean(profilDeLArticleChoisi && profilDeLArticleChoisi.champs.dlc === "requis");
  // FEFO : à la sortie, le lot dont la DLC est la plus proche est suggéré (aide, jamais une obligation).
  const fefo = cible === "articles" && articleId && ["sortie", "casse", "perte", "transfert"].includes(type) && profilDeLArticleChoisi?.fefo ? suggestionFefo(soldes, articleId, siteId) : null;

  useEffect(() => {
    try {
      const m = window.localStorage.getItem("stock:depot");
      if (m && sitesActifs.some((s) => s.id === m)) setSiteId(m);
    } catch {
      /* mémoire du dépôt facultative */
    }
  }, [sitesActifs]);

  useEffect(() => {
    const mu = lireMemoire("stock:profil:unites");
    if (mu && profilsDesUnites.length > 1 && (profilsDesUnites as string[]).includes(mu)) setProfilUnite(mu as CleProfil);
    const ma = lireMemoire("stock:profil:articles");
    if (ma && profilsDesArticles.length > 1 && (profilsDesArticles as string[]).includes(ma)) setProfilArticle(ma as CleProfil);
    setImprimerApres(lireMemoire("stock:imprimer-apres") === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choisirProfilUnite(p: CleProfil) {
    setProfilUnite(p);
    ecrireMemoire("stock:profil:unites", p);
    setValeurs(valeursInitiales(resoudreProfil(p, config)));
    setErreur(null);
  }

  const ajouter = (ok: boolean, texte: string, uniteId?: string) => {
    compteur.current += 1;
    setJournal((j) => [{ id: compteur.current, ok, texte, uniteId }, ...j].slice(0, 30));
  };

  const estEntree = type === "entree" || (type === "ajustement" && sens === "1");

  function corps(codeSaisi: string | null, interne: string | null) {
    const c: Record<string, unknown> = { type, site_id: siteId };
    if (codeSaisi !== null) {
      c.code = codeSaisi;
      if (estEntree) {
        c.type_unite = typeUnite;
        if (profilEffectifUnite) c.profil = profilEffectifUnite.cle;
        if (codesInstalles) Object.assign(c, corpsDepuisValeurs(valeurs, profilEffectifUnite));
        else {
          // Ancien schéma : seulement poids, volume et SSCC.
          const p = nombre(valeurs.poids);
          const v = nombre(valeurs.volume);
          if (p !== null) c.poids_kg = p;
          if (v !== null) c.volume_m3 = v;
          if (valeurs.sscc.trim()) c.sscc = valeurs.sscc.trim();
        }
        if (interne) c.code_interne = interne;
      }
      if (type === "retour") c.statut_apres = retourVers;
    } else {
      c.article_id = articleId;
      const q = nombre(quantite);
      if (q !== null) c.quantite = q;
      if (lot.trim()) c.lot = lot.trim();
      if (dlc) c.dlc = dlc;
      const pa = profilArticleEffectif(article);
      if (estEntree && pa) c.profil = pa.cle;
    }
    if (veutDest && dest) c.emplacement_dest_id = dest;
    if (veutSrc && src) c.emplacement_source_id = src;
    if (veutMotif) c.motif = motif;
    if (type === "ajustement") c.sens = Number(sens);
    return c;
  }

  /** Code interne à rattacher à l'unité scannée (case cochée) : un seul numéro par action, même après une coupure. */
  async function codeInternePour(codeSaisi: string, empreinte: string): Promise<{ code: string | null; erreur?: string }> {
    const deja = internes.current.get(empreinte);
    if (deja) return { code: deja };
    const connue = await appeler<{ unite?: { code_interne?: string | null } | null }>(`/api/stock/unites?code=${encodeURIComponent(codeSaisi)}`);
    if (connue.ok && connue.data.unite) return { code: null };
    const cle = clesGeneration.current.get(empreinte) ?? nouvelleCle("code");
    clesGeneration.current.set(empreinte, cle);
    const r = await appeler<{ codes?: string[] }>("/api/stock/codes", { corps: { nombre: 1, cle } });
    if (!r.ok) return { code: null, erreur: r.erreur };
    const code = r.data.codes?.[0] ?? null;
    if (code) internes.current.set(empreinte, code);
    return { code };
  }

  async function envoyer(codeSaisi: string | null): Promise<boolean> {
    setErreur(null);
    if (!siteId) {
      setErreur("Choisissez un dépôt.");
      return false;
    }
    const base = JSON.stringify(corps(codeSaisi, null));
    let interne: string | null = null;
    if (codeSaisi !== null && estEntree && ajouterInterne && codesInstalles) {
      const r = await codeInternePour(codeSaisi, base);
      if (r.erreur) {
        setErreur(r.erreur);
        return false;
      }
      interne = r.code;
    }
    const empreinte = JSON.stringify(corps(codeSaisi, interne));
    const cle = cles.current.get(empreinte) ?? nouvelleCle("mvt");
    cles.current.set(empreinte, cle);
    const brut = { ...corps(codeSaisi, interne), cle };
    const lu = schemaMouvement.safeParse(brut);
    const verdict = lu.success ? validerMouvement(lu.data, { profils, role, config }) : { ok: false as const, erreur: "Vérifiez les champs saisis." };
    const nom = codeSaisi ?? (article ? `${article.nom} (${article.code})` : "article");
    if (!verdict.ok) {
      setErreur(verdict.erreur);
      return false;
    }
    setEnCours(true);
    const r = await appeler<{ doublon?: boolean; statut?: string | null; quantite_apres?: number | null; unite_id?: string | null; code_interne?: string | null }>("/api/stock/mouvements", { corps: brut });
    setEnCours(false);
    if (!r.ok) {
      // Coupure réseau : la clé est conservée pour qu'un nouvel essai ne crée pas de doublon.
      if (!r.reseau) cles.current.delete(empreinte);
      ajouter(false, `${LIBELLES_MOUVEMENT[type]} ${nom} : ${r.erreur}`);
      setErreur(r.erreur);
      return false;
    }
    cles.current.delete(empreinte);
    internes.current.delete(base);
    clesGeneration.current.delete(base);
    const uniteId = codeSaisi !== null && estEntree && !r.data.doublon ? (r.data.unite_id ?? undefined) : undefined;
    if (uniteId && imprimerApres) setAImprimer((l) => [...l, uniteId].slice(-60));
    ajouter(true, `${LIBELLES_MOUVEMENT[type]} ${nom}${r.data.code_interne ? ` (code interne ${r.data.code_interne})` : ""}${r.data.doublon ? " : déjà enregistré" : " : enregistré"}${r.data.quantite_apres != null ? ` (reste ${r.data.quantite_apres})` : ""}`, uniteId);
    ecrireMemoire("stock:depot", siteId);
    return true;
  }

  async function genererCode() {
    setErreur(null);
    setGeneration(true);
    const cle = clesGeneration.current.get("principal") ?? nouvelleCle("code");
    clesGeneration.current.set("principal", cle);
    const r = await appeler<{ codes?: string[] }>("/api/stock/codes", { corps: { nombre: 1, cle } });
    setGeneration(false);
    if (!r.ok) {
      if (!r.reseau) clesGeneration.current.delete("principal");
      setErreur(r.erreur);
      return;
    }
    clesGeneration.current.delete("principal");
    const nouveau = r.data.codes?.[0];
    if (nouveau) {
      setCode(nouveau);
      ajouter(true, `Code interne généré : ${nouveau}. Collez l'étiquette sur l'unité (Imprimer l'étiquette).`);
    }
  }

  async function soumettreCode(e?: React.FormEvent) {
    e?.preventDefault();
    const c = code.trim();
    if (!c) {
      setErreur(`Saisissez ou scannez le code (${vocabulaire.code.toLowerCase()}).`);
      return;
    }
    if (await envoyer(c)) setCode("");
  }

  async function soumettreArticle(e: React.FormEvent) {
    e.preventDefault();
    if (await envoyer(null)) {
      setQuantite("");
      setLot("");
      setDlc("");
    }
  }

  if (sitesActifs.length === 0) {
    return <Message erreur message="Aucun dépôt n'est configuré. L'exploitation ou la direction doit en créer un dans les paramètres du stock." />;
  }

  const derniere = journal[0];
  const pretPourScan = !enCours && siteId !== "" && (!veutMotif || motif.trim() !== "") && (type !== "transfert" || dest !== "");

  return (
    <div className="flex flex-col gap-5">
      {unites && vrac && (
        <Choix
          legende="Que déplacez-vous ?"
          valeur={cible}
          onChange={(v) => {
            setCible(v);
            setErreur(null);
          }}
          options={[
            { valeur: "unites", libelle: "Colis et palettes" },
            { valeur: "articles", libelle: "Articles en quantité" },
          ]}
        />
      )}

      <Choix legende="Mouvement" valeur={type} onChange={(v) => { setType(v); setErreur(null); }} options={types.map((t) => ({ valeur: t, libelle: LIBELLES_MOUVEMENT[t] }))} aide={AIDE_TYPE[type]} />

      <div className="grid gap-4 sm:grid-cols-2">
        {sitesActifs.length > 1 && (
          <Champ libelle="Dépôt">
            {(id) => (
              <select id={id} className="input" value={siteId} onChange={(e) => { setSiteId(e.target.value); setSrc(""); setDest(""); }}>
                {sitesActifs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                  </option>
                ))}
              </select>
            )}
          </Champ>
        )}
        {veutSrc && (
          <Champ libelle="Retiré de l'emplacement" aide="Laissez vide si l'article n'a pas d'emplacement.">
            {(id, aide) => (
              <select id={id} aria-describedby={aide} className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="">Sans emplacement</option>
                {choix.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.libelle}
                  </option>
                ))}
              </select>
            )}
          </Champ>
        )}
        {veutDest && (
          <Champ libelle={type === "transfert" ? "Vers l'emplacement" : "Rangé à l'emplacement"} aide={choix.length === 0 ? "Aucun emplacement dans ce dépôt : ajoutez-en dans les paramètres, ou laissez vide." : undefined}>
            {(id, aide) => (
              <select id={id} aria-describedby={aide} className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">{type === "transfert" ? "Choisir un emplacement" : "Sans emplacement"}</option>
                {choix.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.libelle}
                  </option>
                ))}
              </select>
            )}
          </Champ>
        )}
      </div>

      {type === "retour" && cible === "unites" && (
        <Choix
          legende="Après le retour"
          valeur={retourVers}
          onChange={setRetourVers}
          options={[
            { valeur: "dans_depot", libelle: "Remis en stock" },
            { valeur: "retour", libelle: "À traiter (zone de retours)" },
          ]}
        />
      )}

      {type === "ajustement" && (
        <Choix
          legende="Effet sur le stock"
          valeur={sens}
          onChange={setSens}
          options={[
            { valeur: "1", libelle: "Ajoute au stock" },
            { valeur: "-1", libelle: "Retire du stock" },
          ]}
        />
      )}

      {veutMotif && (
        <Champ libelle="Motif" aide="Gardé dans l'historique, qui ne peut pas être modifié.">
          {(id, aide) => <input id={id} aria-describedby={aide} className="input" maxLength={300} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. colis écrasé au déchargement" />}
        </Champ>
      )}

      {cible === "unites" ? (
        <div className="flex flex-col gap-4">
          {profilsDesUnites.length > 1 && (
            <Choix
              legende="Profil de l'entrée"
              valeur={(profilUnite || "") as CleProfil}
              onChange={choisirProfilUnite}
              options={profilsDesUnites.map((p) => ({ valeur: p, libelle: DEFINITION_PROFILS[p].libelle }))}
              aide={profilUnite ? undefined : "Choisissez le profil : il fixe le vocabulaire et les champs à remplir."}
            />
          )}
          {profilEffectifUnite?.avertissement && <p className="rounded-xl bg-navy/[0.04] px-3.5 py-2.5 text-xs text-navy/75">{profilEffectifUnite.avertissement}</p>}
          {estEntree && (
            <>
              {typesAutorises.length > 1 && <Choix legende="Type d'unité" valeur={typeUnite} onChange={setTypeUnite} options={typesAutorises.map((t) => ({ valeur: t, libelle: LIBELLES_TYPES_UNITE[t] }))} />}
              {profilEffectifUnite ? (
                <ChampsAttributs profil={profilEffectifUnite} valeurs={valeurs} onChange={setValeurs} dansDetails />
              ) : (
                <details className="rounded-xl border border-navy/[0.1] px-3.5 py-2.5">
                  <summary className="cursor-pointer text-sm font-semibold text-navy/80">Poids, volume{typesAutorises.some((t) => t !== "colis") ? ", SSCC" : ""} (facultatif)</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Champ libelle="Poids (kg)">{(id) => <input id={id} className="input" inputMode="decimal" value={valeurs.poids} onChange={(e) => setValeurs({ ...valeurs, poids: e.target.value })} />}</Champ>
                    <Champ libelle="Volume (m³)">{(id) => <input id={id} className="input" inputMode="decimal" value={valeurs.volume} onChange={(e) => setValeurs({ ...valeurs, volume: e.target.value })} />}</Champ>
                    {typesAutorises.some((t) => t !== "colis") && (
                      <Champ libelle="SSCC (18 chiffres)">{(id) => <input id={id} className="input" inputMode="numeric" maxLength={30} value={valeurs.sscc} onChange={(e) => setValeurs({ ...valeurs, sscc: e.target.value })} />}</Champ>
                    )}
                  </div>
                </details>
              )}
            </>
          )}

          <form onSubmit={soumettreCode} className="flex flex-col gap-3">
            <Champ libelle={vocabulaire.code} aide={estEntree && codesInstalles ? `${vocabulaire.codeAide} Si l'unité arrive avec un code (transporteur, client, SSCC), gardez-le tel quel.` : vocabulaire.codeAide}>
              {(id, aide) => <input id={id} aria-describedby={aide} className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} />}
            </Champ>
            {estEntree && codesInstalles && (
              <div className="flex flex-col gap-1">
                {code.trim() === "" ? (
                  <div>
                    <button type="button" className="btn-secondary min-h-11" onClick={() => void genererCode()} disabled={generation}>
                      {generation ? "Génération…" : "Générer un code"}
                    </button>
                    <p className="mt-1.5 text-xs text-navy/65">Pas de code sur l&apos;unité ? GODAC en crée un propre à votre entreprise ; imprimez l&apos;étiquette pour le coller.</p>
                  </div>
                ) : (
                  <label className="flex min-h-11 items-center gap-2.5 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={ajouterInterne} onChange={(e) => setAjouterInterne(e.target.checked)} />
                    <span>
                      <span className="font-semibold">Ajouter aussi un code interne de l&apos;entreprise</span>
                      <span className="block text-xs text-navy/65">Le code d&apos;origine reste le code principal ; le code interne est complémentaire (scan des deux possible).</span>
                    </span>
                  </label>
                )}
                <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-teal-ink"
                    checked={imprimerApres}
                    onChange={(e) => {
                      setImprimerApres(e.target.checked);
                      ecrireMemoire("stock:imprimer-apres", e.target.checked ? "1" : "0");
                    }}
                  />
                  Imprimer l&apos;étiquette après l&apos;entrée
                </label>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary min-h-11 flex-1 sm:flex-none" disabled={!pretPourScan || code.trim() === ""}>
                {enCours ? "Envoi…" : `Enregistrer ${LIBELLES_MOUVEMENT[type].toLowerCase()}`}
              </button>
              <button type="button" className="btn-secondary min-h-11 flex-1 sm:flex-none" onClick={() => setScanner(true)} disabled={!pretPourScan}>
                Scanner en rafale
              </button>
            </div>
            {!pretPourScan && (veutMotif || type === "transfert") && <p className="text-xs text-navy/65">{type === "transfert" && !dest ? "Choisissez d'abord l'emplacement de destination." : "Indiquez d'abord le motif."}</p>}
            {!pretPourScan && profilsDesUnites.length > 1 && estEntree && !profilUnite && <p className="text-xs text-navy/65">Choisissez d&apos;abord le profil de l&apos;entrée si ses champs diffèrent.</p>}
          </form>
          {aImprimer.length > 0 && (
            <div className="rounded-xl border border-teal-ink/30 bg-teal/[0.06] p-3.5">
              <a href={`/api/stock/etiquettes?unites=${aImprimer.join(",")}`} target="_blank" rel="noreferrer" className="btn-primary min-h-11">
                Imprimer {aImprimer.length} étiquette{aImprimer.length > 1 ? "s" : ""} de cette séance
              </a>
              <button type="button" className="ml-3 text-sm font-semibold text-teal-ink hover:underline" onClick={() => setAImprimer([])}>
                Vider la liste
              </button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={soumettreArticle} className="flex flex-col gap-4">
          {profilsDesArticles.length > 1 && !article?.profil && (
            <Choix
              legende="Profil de l'entrée"
              valeur={(profilArticle || "") as CleProfil}
              onChange={(p) => {
                setProfilArticle(p);
                ecrireMemoire("stock:profil:articles", p);
              }}
              options={profilsDesArticles.map((p) => ({ valeur: p, libelle: DEFINITION_PROFILS[p].libelle }))}
            />
          )}
          {profilArticleEffectif(article)?.avertissement && <p className="rounded-xl bg-navy/[0.04] px-3.5 py-2.5 text-xs text-navy/75">{profilArticleEffectif(article)!.avertissement}</p>}
          <Champ libelle={profilArticleEffectif(article) ? `${profilArticleEffectif(article)!.vocabulaire.code}` : "Article"}>
            {(id) => (
              <select id={id} className="input" value={articleId} onChange={(e) => setArticleId(e.target.value)} required>
                <option value="">Choisir un article</option>
                {articles.filter((a) => a.actif).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.nom}
                  </option>
                ))}
              </select>
            )}
          </Champ>
          <div className="grid gap-3 sm:grid-cols-3">
            <Champ libelle={`Quantité${article ? ` (${LIBELLES_UNITES_ARTICLE[article.unite as keyof typeof LIBELLES_UNITES_ARTICLE] ?? article.unite})` : ""}`}>
              {(id) => <input id={id} className="input" inputMode="decimal" value={quantite} onChange={(e) => setQuantite(e.target.value)} required />}
            </Champ>
            {(article?.suivi_lots || lot || exigeLot) && <Champ libelle={exigeLot ? "Lot (obligatoire)" : "Lot"}>{(id) => <input id={id} className="input" maxLength={60} value={lot} onChange={(e) => setLot(e.target.value)} required={article?.suivi_lots || (exigeLot && estEntree)} />}</Champ>}
            {(article?.suivi_dlc || dlc || exigeDlc) && type !== "sortie" && (
              <Champ libelle={exigeDlc ? "Date limite (DLC, obligatoire)" : "Date limite (DLC)"}>
                {(id) => <input id={id} type="date" className="input" value={dlc} onChange={(e) => setDlc(e.target.value)} required={(article?.suivi_dlc && ["entree", "retour"].includes(type)) || (exigeDlc && estEntree)} />}
              </Champ>
            )}
          </div>
          {fefo && (
            <div className="rounded-xl border border-teal-ink/30 bg-teal/[0.06] p-3.5 text-sm" role="status">
              <p>{phraseFefo(fefo, aujourdhui)}</p>
              {lot !== fefo.lot && (
                <button type="button" className="mt-2 btn-secondary min-h-11" onClick={() => setLot(fefo.lot)}>
                  Choisir ce lot
                </button>
              )}
            </div>
          )}
          <div>
            <button type="submit" className="btn-primary min-h-11 w-full sm:w-auto" disabled={enCours || !articleId || !siteId}>
              {enCours ? "Envoi…" : `Enregistrer ${LIBELLES_MOUVEMENT[type].toLowerCase()}`}
            </button>
          </div>
        </form>
      )}

      <Message message={erreur} erreur />
      <div aria-live="polite" className="sr-only">
        {derniere?.texte}
      </div>

      {journal.length > 0 && (
        <section aria-label="Mouvements enregistrés pendant cette séance" className="card !p-4">
          <h2 className="mb-2 text-sm font-bold">Cette séance</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {journal.map((l) => (
              <li key={l.id} className={l.ok ? "text-navy" : "text-orange-ink"}>
                <span aria-hidden="true">{l.ok ? "✓ " : "✗ "}</span>
                <span className="sr-only">{l.ok ? "Réussi : " : "Échec : "}</span>
                {l.texte}
                {l.uniteId && (
                  <>
                    {" "}
                    <a href={`/api/stock/etiquettes?unites=${l.uniteId}`} target="_blank" rel="noreferrer" className="font-semibold text-teal-ink underline">
                      Imprimer l&apos;étiquette
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {scanner && (
        <ParcelScanner
          consigne={`${LIBELLES_MOUVEMENT[type]} : passez les ${vocabulaire.plusieurs} un par un devant la caméra`}
          bouton="Terminer"
          statut={derniere ? `${derniere.ok ? "✓" : "✗"} ${derniere.texte}` : ""}
          onCode={(texte) => {
            void envoyer(texte);
          }}
          onClose={() => setScanner(false)}
        />
      )}
    </div>
  );
}

