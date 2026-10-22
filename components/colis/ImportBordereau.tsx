"use client";

import { useMemo, useRef, useState } from "react";
import { IconCamera, IconFileText, IconImage, IconX } from "@/components/layout/icons";
import { photoDocumentEnBase64 } from "@/components/colis/commun";
import { EtapeCreneau } from "@/components/colis/EtapeCreneau";
import { choixDepuisCreneau, colonnesCreneau, libelleChoix, validerChoix, type ChoixCreneau } from "@/lib/colis/creneau";
import { networkErrorMessage } from "@/lib/utils/network-error";
import {
  LIBELLE_DOUTE,
  ajouterPage,
  compter,
  fusionnerPages,
  libelleCompteur,
  pointDepuisArret,
  type ArretBordereau,
  type Doute,
  type PageBordereau,
  type TypeBloc,
} from "@/lib/colis/bordereau";

/** Points envoyés par appel (limite de /api/colis/arrets/bulk : 200). */
const LOT = 150;
/** Photo brute acceptée avant compression (ramenée ensuite à ~2400 px et moins de 3 Mo de base64). */
const PHOTO_MAX = 40_000_000;

const LIBELLE_TYPE: Record<TypeBloc, string> = { livraison: "Livraison", ramasse: "Ramasse", rdv: "RDV", relais: "Relais" };
const COULEUR_TYPE: Record<TypeBloc, string> = {
  livraison: "bg-navy/10 text-navy",
  ramasse: "bg-orange/15 text-orange-ink",
  rdv: "bg-teal/15 text-teal-ink",
  relais: "bg-relais/20 text-navy",
};

type Champ = "nom" | "rue" | "codePostal" | "ville" | "telephone";
const DOUTE_CHAMP: Partial<Record<Doute, Champ>> = { nom: "nom", adresse: "rue", code_postal: "codePostal", ville_tronquee: "ville", telephone: "telephone" };

interface Lecture {
  nom: string;
  etat: "attente" | "lecture" | "ok" | "erreur";
  message?: string;
  page?: number | null;
  /** Photo gardée en mémoire pour « Réessayer » sans la reprendre. */
  fichier?: File;
}

/**
 * Message d'une réponse en erreur, même quand elle n'est pas du JSON :
 * page HTML de l'hébergeur quand la lecture est coupée (délai dépassé,
 * 504) ou que la photo est refusée (413).
 */
function messageErreur(status: number, json: { error?: string }): string {
  if (json.error) return json.error;
  if (status === 413) return "Photo trop lourde pour l'envoi : reprenez la page.";
  if (status === 401 || status === 403) return "Session expirée : rechargez l'écran puis réessayez.";
  if (status === 504 || status === 502 || status === 503 || status === 500)
    return "La lecture a été coupée (délai dépassé). Réessayez, ou photographiez la page en deux moitiés (haut, puis bas).";
  return `Lecture impossible (erreur ${status}). Réessayez.`;
}

type Resultat = "ok" | "erreur" | "quota";

/**
 * Import du bordereau de tournée (feuille de route de DPD, GLS,
 * Chronopost, Colissimo, Colis Privé, UPS…) par photos : le chauffeur
 * photographie les pages une à une (ou les choisit dans la galerie),
 * chaque page est lue par l'IA (/api/colis/bordereau, une lecture par
 * page), les pages re-photographiées remplacent les précédentes, puis
 * l'aperçu modifiable est ajouté à la tournée dans l'ordre des positions
 * (/api/colis/arrets/bulk : géocodage, rangement par village, sans
 * doublon de colis ni d'adresse).
 */
export function ImportBordereau({
  runId,
  runDate,
  onImporte,
}: {
  runId: string;
  runDate: string;
  onImporte: (message: string, ok: boolean) => Promise<void> | void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [pages, setPages] = useState<PageBordereau[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [lecturesIa, setLecturesIa] = useState(0);
  const [decoches, setDecoches] = useState<Set<string>>(new Set());
  const [modifs, setModifs] = useState<Record<string, Partial<Pick<ArretBordereau, Champ>>>>({});
  /** Créneau modifié dans l'aperçu, par arrêt ; absent : celui lu sur le bordereau. */
  const [creneaux, setCreneaux] = useState<Record<string, ChoixCreneau>>({});
  /** Arrêt dont le choix du créneau est déplié. */
  const [creneauOuvert, setCreneauOuvert] = useState<string | null>(null);
  const [busy, setBusy] = useState<"lecture" | "import" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galerieRef = useRef<HTMLInputElement>(null);

  const arrets = useMemo(() => fusionnerPages(pages), [pages]);
  const compteur = useMemo(() => compter(pages, arrets), [pages, arrets]);
  const retenus = arrets.filter((a) => !decoches.has(a.cle));
  const dateBordereau = pages.find((p) => p.entete.date)?.entete.date ?? null;
  const transporteur = pages.find((p) => p.entete.transporteur)?.entete.transporteur ?? null;

  function fermer() {
    setOuvert(false);
    setPages([]);
    setLectures([]);
    setDecoches(new Set());
    setModifs({});
    setCreneaux({});
    setCreneauOuvert(null);
    setErreur(null);
  }

  const majLecture = (i: number, l: Partial<Lecture>) => setLectures((ls) => ls.map((x, k) => (k === i ? { ...x, ...l } : x)));

  /** Lit une photo (entrée `i` de la liste des lectures). */
  async function lirePage(i: number, f: File): Promise<Resultat> {
    if (f.size > PHOTO_MAX) {
      majLecture(i, { etat: "erreur", message: "Photo trop lourde." });
      return "erreur";
    }
    majLecture(i, { etat: "lecture", message: undefined });
    try {
      const image = await photoDocumentEnBase64(f);
      const res = await fetch("/api/colis/bordereau", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runId, image, mediaType: "image/jpeg" }) });
      const brut = await res.text();
      let json: { page?: PageBordereau; error?: string; code?: string } = {};
      try {
        json = JSON.parse(brut);
      } catch {
        // Page HTML de l'hébergeur (délai dépassé, photo refusée) : message selon le statut.
      }
      // Lecture comptée si l'IA a lu la page (même illisible) ; un échec du service ou une réponse
      // coupée est remboursé par le serveur. Coupure de l'hébergeur (504) : comptée, faute de remboursement.
      if (res.ok || json.code === "ILLISIBLE" || res.status === 504) setLecturesIa((n) => n + 1);
      if (!res.ok || !json.page) {
        majLecture(i, { etat: "erreur", message: res.ok ? "Réponse inattendue. Réessayez." : messageErreur(res.status, json) });
        if (json.code === "QUOTA_ATTEINT") {
          setErreur(json.error ?? "Quota de lectures atteint.");
          return "quota";
        }
        return "erreur";
      }
      const page = json.page;
      setPages((ps) => ajouterPage(ps, page));
      majLecture(i, { etat: "ok", page: page.entete.page, message: `${page.arrets.length} arrêt(s)`, fichier: undefined });
      return "ok";
    } catch (e) {
      majLecture(i, { etat: "erreur", message: networkErrorMessage(e) });
      return "erreur";
    }
  }

  async function lireFichiers(fichiers: File[]) {
    if (!fichiers.length) return;
    setErreur(null);
    setBusy("lecture");
    const depart = lectures.length;
    setLectures((l) => [...l, ...fichiers.map((f) => ({ nom: f.name || "Photo", etat: "attente" as const, fichier: f }))]);
    // Une page à la fois : la lecture est longue, et l'ordre d'arrivée reste celui des photos.
    for (const [i, f] of fichiers.entries()) {
      if ((await lirePage(depart + i, f)) === "quota") {
        for (let k = i + 1; k < fichiers.length; k++) majLecture(depart + k, { etat: "erreur", message: "Non lue (quota)." });
        break;
      }
    }
    setBusy(null);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galerieRef.current) galerieRef.current.value = "";
  }

  /** Relit une photo en erreur, sans avoir à la reprendre. */
  async function relire(i: number) {
    const f = lectures[i]?.fichier;
    if (!f || busy) return;
    setErreur(null);
    setBusy("lecture");
    await lirePage(i, f);
    setBusy(null);
  }

  function arretModifie(a: ArretBordereau): ArretBordereau {
    const m = modifs[a.cle];
    return m ? { ...a, ...m } : a;
  }

  /** Créneau lu sur le bordereau (fenêtre ou plage unique), pré-sélectionné. */
  function creneauLu(a: ArretBordereau): ChoixCreneau {
    const p = pointDepuisArret(a);
    return choixDepuisCreneau(p.window_start, p.window_end);
  }

  function creneauDe(a: ArretBordereau): ChoixCreneau {
    return creneaux[a.cle] ?? creneauLu(a);
  }

  function modifier(cle: string, champ: Champ, valeur: string) {
    setModifs((m) => ({ ...m, [cle]: { ...m[cle], [champ]: valeur.trim() ? valeur : null } }));
  }

  async function importer() {
    if (!retenus.length) return;
    // Créneau incohérent dans l'aperçu : on le signale avant tout envoi.
    const incoherent = retenus.find((a) => !validerChoix(creneauDe(a)).ok);
    if (incoherent) {
      setCreneauOuvert(incoherent.cle);
      return setErreur(`${incoherent.position !== null ? `Position ${incoherent.position}` : incoherent.nom ?? "Un arrêt"} : créneau à corriger.`);
    }
    setBusy("import");
    setErreur(null);
    const points = retenus
      .map((a) => {
        const choix = validerChoix(creneauDe(a));
        return { ...pointDepuisArret(arretModifie(a), transporteur), ...colonnesCreneau(choix.ok ? choix.creneau : null) };
      })
      .filter((p) => p.adresse.length >= 5);
    const total = { ajoutes: 0, regroupes: 0, ignores: retenus.length - points.length, doublons: 0, sansGps: 0, horairesPro: 0 };
    try {
      for (let i = 0; i < points.length; i += LOT) {
        const dernier = i + LOT >= points.length;
        const r = await fetch("/api/colis/arrets/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            run_id: runId,
            points: points.slice(i, i + LOT),
            list_id: null,
            ...(dernier && compteur.numero
              ? {
                  bordereau: {
                    numero: compteur.numero,
                    tournee: pages.find((p) => p.entete.tournee)?.entete.tournee ?? null,
                    date: dateBordereau,
                    pages: pages.map((p) => p.entete.page).filter((n): n is number => n !== null),
                    colis: compteur.colis,
                    poids_kg: compteur.poidsKg,
                    total_colis: compteur.totalColis,
                    total_poids_kg: compteur.totalPoidsKg,
                  },
                }
              : {}),
          }),
        });
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur réseau");
        for (const k of ["ajoutes", "regroupes", "ignores", "doublons", "sansGps", "horairesPro"] as const) total[k] += Number(json[k] ?? 0);
      }
      fermer();
      await onImporte(
        [
          `Bordereau : ${total.ajoutes} arrêt(s) ajouté(s) dans l'ordre du bordereau`,
          total.regroupes && `${total.regroupes} regroupé(s) avec une même adresse`,
          total.doublons && `${total.doublons} colis déjà dans la fiche`,
          total.ignores && `${total.ignores} sans adresse ignoré(s)`,
          total.horairesPro && `${total.horairesPro} fiche(s) horaires pro créée(s)`,
          total.sansGps && `${total.sansGps} adresse(s) à vérifier`,
        ]
          .filter(Boolean)
          .join(" · ") + ". Vous pouvez ensuite « Optimiser l'ordre ».",
        !total.sansGps && !total.ignores,
      );
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!ouvert) {
    return (
      <button type="button" className="btn-ghost w-fit !px-2 !py-1.5 text-sm" onClick={() => setOuvert(true)}>
        <IconFileText className="h-4 w-4" /> Importer le bordereau
      </button>
    );
  }

  const enCours = lectures.filter((l) => l.etat === "attente" || l.etat === "lecture").length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-navy/10 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Bordereau de tournée</h3>
        <button type="button" className="btn-ghost !px-2 !py-1" onClick={fermer} disabled={busy === "import"} aria-label="Fermer">
          <IconX className="h-5 w-5" />
        </button>
      </div>
      <p className="text-xs text-navy/60">
        Tous transporteurs (DPD, GLS, Chronopost, Colissimo, Colis Privé, UPS…). Photographiez chaque page bien à plat, en entier et nette ; une page très
        chargée peut se prendre en deux photos (haut, puis bas). Une page reprise en photo remplace la précédente. Chaque photo lue compte pour une lecture IA
        (comme une étiquette) : un bordereau de 20 pages = 20 lectures.
      </p>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void lireFichiers([...(e.target.files ?? [])])} />
      <input ref={galerieRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void lireFichiers([...(e.target.files ?? [])])} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => cameraRef.current?.click()}>
          <IconCamera className="h-4 w-4" /> {pages.length ? "Photographier la page suivante" : "Photographier la page 1"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => galerieRef.current?.click()}>
          <IconImage className="h-4 w-4" /> Choisir des photos
        </button>
      </div>

      {(pages.length > 0 || lectures.length > 0) && (
        <div className="flex flex-col gap-1 rounded-lg bg-navy/[0.03] px-3 py-2 text-sm">
          <p className="font-semibold">
            {transporteur ? `${transporteur} · ` : ""}
            {compteur.numero ? `Bordereau n° ${compteur.numero} · ` : ""}
            {libelleCompteur(compteur)}
          </p>
          <p className="text-xs text-navy/60">
            {lecturesIa} lecture(s) IA utilisée(s){enCours ? ` · ${enCours} page(s) en cours de lecture…` : ""}
          </p>
          {compteur.pagesManquantes.length > 0 && <p className="text-xs text-orange-ink">Page(s) manquante(s) : {compteur.pagesManquantes.join(", ")}.</p>}
          {compteur.totalColis !== null && compteur.colis < compteur.totalColis && !compteur.pagesManquantes.length && !enCours && (
            <p className="text-xs text-orange-ink">Il manque {compteur.totalColis - compteur.colis} colis : photographiez la page suivante.</p>
          )}
          {compteur.autresBordereaux.length > 0 && <p className="text-xs text-orange-ink">Pages d&apos;un autre bordereau (n° {compteur.autresBordereaux.join(", ")}) : vérifiez vos photos.</p>}
          {dateBordereau && dateBordereau !== runDate && <p className="text-xs text-orange-ink">Bordereau daté du {dateBordereau.split("-").reverse().join("/")}, différent de la date de la fiche.</p>}
          {lectures.some((l) => l.etat !== "ok") && (
            <ul className="flex flex-col gap-0.5 text-xs">
              {lectures.map((l, i) =>
                l.etat === "ok" ? null : (
                  <li key={i} className={`flex flex-wrap items-center gap-x-2 ${l.etat === "erreur" ? "text-orange-ink" : "text-navy/60"}`}>
                    <span>
                      Photo {i + 1} : {l.etat === "erreur" ? l.message : l.etat === "lecture" ? "lecture…" : "en attente"}
                    </span>
                    {l.etat === "erreur" && l.fichier && (
                      <button type="button" className="btn-ghost !min-h-[44px] !px-3 !py-1 text-xs" disabled={busy !== null} onClick={() => void relire(i)}>
                        Réessayer
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}

      {arrets.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              <strong>{retenus.length}</strong> / {arrets.length} arrêt(s) retenu(s)
            </span>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-xs"
              onClick={() => setDecoches(decoches.size ? new Set() : new Set(arrets.map((a) => a.cle)))}
            >
              {decoches.size ? "Tout cocher" : "Tout décocher"}
            </button>
          </div>
          <ol className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
            {arrets.map((brut) => {
              const a = arretModifie(brut);
              const coche = !decoches.has(a.cle);
              const douteux = new Set(brut.doutes.map((d) => DOUTE_CHAMP[d]).filter((c): c is Champ => Boolean(c) && modifs[a.cle]?.[c!] === undefined));
              const champ = (c: Champ, label: string, cls = "") => (
                <input
                  className={`input !py-1 text-sm ${cls} ${douteux.has(c) ? "!border-orange bg-orange/10" : ""}`}
                  value={a[c] ?? ""}
                  placeholder={label}
                  aria-label={label}
                  onChange={(e) => modifier(a.cle, c, e.target.value)}
                />
              );
              return (
                <li key={a.cle} className={`flex gap-2 rounded-lg border p-2 ${coche ? "border-navy/10" : "border-transparent opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="mt-1.5 h-4 w-4 shrink-0"
                    checked={coche}
                    aria-label={a.position !== null ? `Retenir la position ${a.position}` : `Retenir ${a.nom ?? "cet arrêt"}`}
                    onChange={() =>
                      setDecoches((d) => {
                        const n = new Set(d);
                        if (n.has(a.cle)) n.delete(a.cle);
                        else n.add(a.cle);
                        return n;
                      })
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {a.position !== null && <span className="font-semibold">Pos {a.position}</span>}
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${COULEUR_TYPE[a.type]}`}>{LIBELLE_TYPE[a.type]}</span>
                      {a.codes.length > 0 && <span className="text-navy/50">{a.codes.join(" ")}</span>}
                      <span className="text-navy/60">
                        {a.type === "ramasse" ? `${a.nombreColis} colis à enlever` : `${a.nombreColis} colis`}
                        {a.poidsKg ? ` · ${String(a.poidsKg).replace(".", ",")} kg` : ""}
                      </span>
                      {a.page !== null && <span className="text-navy/40">p. {a.page}</span>}
                    </div>
                    {champ("nom", "Destinataire")}
                    {champ("rue", "Rue")}
                    <div className="flex gap-1">
                      {champ("codePostal", "CP", "!w-20")}
                      {champ("ville", "Ville", "min-w-0 flex-1")}
                    </div>
                    {champ("telephone", "Téléphone")}
                    <p className="text-xs text-navy/60">
                      {[
                        a.contact && `Contact : ${a.contact}`,
                        a.plages && `Horaires : ${a.plages.map((p) => `${p.debut}–${p.fin}`).join(" / ")}`,
                        a.nature,
                        a.expediteur && `Exp. : ${a.expediteur}`,
                        a.mentions,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {(() => {
                      const choix = creneauDe(a);
                      const lu = creneauLu(a);
                      const ouvert = creneauOuvert === a.cle;
                      const invalide = !validerChoix(choix).ok;
                      const estLu = lu.cle !== "aucun" && choix.cle === lu.cle && choix.debut === lu.debut && choix.fin === lu.fin;
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className={invalide ? "font-semibold text-orange-ink" : choix.cle === "aucun" ? "text-navy/60" : "font-semibold text-teal-ink"}>
                              Créneau : {invalide ? "à corriger" : (libelleChoix(choix) ?? "aucun")}
                              {estLu ? " (lu sur le bordereau)" : ""}
                            </span>
                            <button
                              type="button"
                              className="btn-ghost !min-h-[44px] !px-3 !py-1 text-xs"
                              aria-expanded={ouvert}
                              onClick={() => setCreneauOuvert(ouvert ? null : a.cle)}
                            >
                              {ouvert ? "Fermer" : "Modifier"}
                            </button>
                          </div>
                          {ouvert && (
                            <EtapeCreneau
                              idBase={`bordereau-creneau-${a.cle.replace(/[^\w-]/g, "_")}`}
                              titre={null}
                              value={choix}
                              onChange={(c) => setCreneaux((m) => ({ ...m, [a.cle]: c }))}
                              ymd={runDate}
                              indication={estLu ? "Lu sur le bordereau" : null}
                            />
                          )}
                        </div>
                      );
                    })()}
                    {brut.doutes.length > 0 && <p className="text-xs text-orange-ink">À vérifier : {brut.doutes.map((d) => LIBELLE_DOUTE[d]).join(", ")}.</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn-primary" disabled={busy !== null || !retenus.length} onClick={importer}>
            {busy === "import" ? "Ajout et géolocalisation…" : `Ajouter ${retenus.length} arrêt(s) à la tournée`}
          </button>
        </div>
      )}
      {erreur && <p className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">{erreur}</p>}
    </div>
  );
}
