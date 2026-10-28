"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { appeler, Champ, Choix, Message } from "@/components/stock/commun";
import { choixRangement, type EmplacementLu } from "@/lib/stock/emplacements";
import type { ArticleLu, SiteLu } from "@/lib/stock/chargement-serveur";
import { schemaMouvement, nouvelleCle, validerMouvement } from "@/lib/stock/mouvements";
import { LIBELLES_TYPES_UNITE, LIBELLES_UNITES_ARTICLE, avecArticles, avecUnites, motUnite, typesUniteAutorises, type CleProfil, type TypeUnite } from "@/lib/stock/profils";
import { LIBELLES_MOUVEMENT, TYPES_AVEC_MOTIF, TYPES_MOUVEMENT, type TypeMouvement } from "@/lib/stock/transitions";

const ParcelScanner = dynamic(() => import("@/components/colis/ParcelScanner").then((m) => m.ParcelScanner), { ssr: false });

interface Props {
  profils: CleProfil[];
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
}

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
export function MouvementRapide({ profils, sites, emplacements, articles, role, codeInitial = "" }: Props) {
  const unites = avecUnites(profils);
  const vrac = avecArticles(profils);
  const sitesActifs = useMemo(() => sites.filter((s) => s.actif), [sites]);
  const [cible, setCible] = useState<"unites" | "articles">(unites ? "unites" : "articles");
  const [type, setType] = useState<TypeMouvement>("entree");
  const [siteId, setSiteId] = useState<string>(sitesActifs[0]?.id ?? "");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const typesAutorises = useMemo<TypeUnite[]>(() => typesUniteAutorises(profils), [profils]);
  const [typeUnite, setTypeUnite] = useState<TypeUnite>(typesAutorises[0] ?? "colis");
  const [poids, setPoids] = useState("");
  const [volume, setVolume] = useState("");
  const [sscc, setSscc] = useState("");
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
  // Une clé par action tant qu'elle n'a pas abouti : un nouvel essai après coupure la réutilise.
  const cles = useRef(new Map<string, string>());

  const vocabulaire = motUnite(profils);
  const peutAjuster = role !== "chauffeur";
  const types = TYPES_MOUVEMENT.filter((t) => t !== "ajustement" || peutAjuster);
  const choix = useMemo(() => choixRangement(siteId, emplacements), [siteId, emplacements]);
  const article = articles.find((a) => a.id === articleId) ?? null;
  const veutDest = type === "entree" || type === "transfert" || type === "ajustement" || (type === "retour" && retourVers === "dans_depot");
  const veutSrc = cible === "articles" && (type === "sortie" || type === "transfert" || type === "casse" || type === "perte" || (type === "ajustement" && sens === "-1"));
  const veutMotif = (TYPES_AVEC_MOTIF as readonly string[]).includes(type);

  useEffect(() => {
    try {
      const m = window.localStorage.getItem("stock:depot");
      if (m && sitesActifs.some((s) => s.id === m)) setSiteId(m);
    } catch {
      /* mémoire du dépôt facultative */
    }
  }, [sitesActifs]);

  const ajouter = (ok: boolean, texte: string) => {
    compteur.current += 1;
    setJournal((j) => [{ id: compteur.current, ok, texte }, ...j].slice(0, 30));
  };

  function corps(codeSaisi: string | null) {
    const c: Record<string, unknown> = { type, site_id: siteId };
    if (codeSaisi !== null) {
      c.code = codeSaisi;
      if (type === "entree" || (type === "ajustement" && sens === "1")) c.type_unite = typeUnite;
      const p = nombre(poids);
      const v = nombre(volume);
      if (p !== null) c.poids_kg = p;
      if (v !== null) c.volume_m3 = v;
      if (sscc.trim()) c.sscc = sscc.trim();
      if (type === "retour") c.statut_apres = retourVers;
    } else {
      c.article_id = articleId;
      const q = nombre(quantite);
      if (q !== null) c.quantite = q;
      if (lot.trim()) c.lot = lot.trim();
      if (dlc) c.dlc = dlc;
    }
    if (veutDest && dest) c.emplacement_dest_id = dest;
    if (veutSrc && src) c.emplacement_source_id = src;
    if (veutMotif) c.motif = motif;
    if (type === "ajustement") c.sens = Number(sens);
    return c;
  }

  async function envoyer(codeSaisi: string | null): Promise<boolean> {
    setErreur(null);
    if (!siteId) {
      setErreur("Choisissez un dépôt.");
      return false;
    }
    const empreinte = JSON.stringify(corps(codeSaisi));
    const cle = cles.current.get(empreinte) ?? nouvelleCle("mvt");
    cles.current.set(empreinte, cle);
    const brut = { ...corps(codeSaisi), cle };
    const lu = schemaMouvement.safeParse(brut);
    const verdict = lu.success ? validerMouvement(lu.data, { profils, role }) : { ok: false as const, erreur: "Vérifiez les champs saisis." };
    const nom = codeSaisi ?? (article ? `${article.nom} (${article.code})` : "article");
    if (!verdict.ok) {
      setErreur(verdict.erreur);
      return false;
    }
    setEnCours(true);
    const r = await appeler<{ doublon?: boolean; statut?: string | null; quantite_apres?: number | null }>("/api/stock/mouvements", { corps: brut });
    setEnCours(false);
    if (!r.ok) {
      // Coupure réseau : la clé est conservée pour qu'un nouvel essai ne crée pas de doublon.
      if (!r.reseau) cles.current.delete(empreinte);
      ajouter(false, `${LIBELLES_MOUVEMENT[type]} ${nom} : ${r.erreur}`);
      setErreur(r.erreur);
      return false;
    }
    cles.current.delete(empreinte);
    ajouter(true, `${LIBELLES_MOUVEMENT[type]} ${nom}${r.data.doublon ? " : déjà enregistré" : " : enregistré"}${r.data.quantite_apres != null ? ` (reste ${r.data.quantite_apres})` : ""}`);
    try {
      window.localStorage.setItem("stock:depot", siteId);
    } catch {
      /* mémoire du dépôt facultative */
    }
    return true;
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
          {(type === "entree" || (type === "ajustement" && sens === "1")) && (
            <>
              {typesAutorises.length > 1 && <Choix legende="Type d'unité" valeur={typeUnite} onChange={setTypeUnite} options={typesAutorises.map((t) => ({ valeur: t, libelle: LIBELLES_TYPES_UNITE[t] }))} />}
              <details className="rounded-xl border border-navy/[0.1] px-3.5 py-2.5">
                <summary className="cursor-pointer text-sm font-semibold text-navy/80">Poids, volume{typesAutorises.some((t) => t !== "colis") ? ", SSCC" : ""} (facultatif)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Champ libelle="Poids (kg)">{(id) => <input id={id} className="input" inputMode="decimal" value={poids} onChange={(e) => setPoids(e.target.value)} />}</Champ>
                  {profils.includes("messagerie") && <Champ libelle="Volume (m³)">{(id) => <input id={id} className="input" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} />}</Champ>}
                  {typesAutorises.some((t) => t !== "colis") && (
                    <Champ libelle="SSCC (18 chiffres)">{(id) => <input id={id} className="input" inputMode="numeric" maxLength={30} value={sscc} onChange={(e) => setSscc(e.target.value)} />}</Champ>
                  )}
                </div>
              </details>
            </>
          )}

          <form onSubmit={soumettreCode} className="flex flex-col gap-3">
            <Champ libelle={vocabulaire.code} aide={vocabulaire.codeAide}>
              {(id, aide) => <input id={id} aria-describedby={aide} className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} />}
            </Champ>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary min-h-11 flex-1 sm:flex-none" disabled={!pretPourScan || code.trim() === ""}>
                {enCours ? "Envoi…" : `Enregistrer ${LIBELLES_MOUVEMENT[type].toLowerCase()}`}
              </button>
              <button type="button" className="btn-secondary min-h-11 flex-1 sm:flex-none" onClick={() => setScanner(true)} disabled={!pretPourScan}>
                Scanner en rafale
              </button>
            </div>
            {!pretPourScan && (veutMotif || type === "transfert") && <p className="text-xs text-navy/65">{type === "transfert" && !dest ? "Choisissez d'abord l'emplacement de destination." : "Indiquez d'abord le motif."}</p>}
          </form>
        </div>
      ) : (
        <form onSubmit={soumettreArticle} className="flex flex-col gap-4">
          <Champ libelle="Article">
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
            {(article?.suivi_lots || lot) && <Champ libelle="Lot">{(id) => <input id={id} className="input" maxLength={60} value={lot} onChange={(e) => setLot(e.target.value)} required={article?.suivi_lots} />}</Champ>}
            {(article?.suivi_dlc || dlc) && type !== "sortie" && <Champ libelle="Date limite (DLC)">{(id) => <input id={id} type="date" className="input" value={dlc} onChange={(e) => setDlc(e.target.value)} required={article?.suivi_dlc && ["entree", "retour"].includes(type)} />}</Champ>}
          </div>
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

