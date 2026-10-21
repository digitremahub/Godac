"use client";

import { useMemo, useRef, useState } from "react";
import { IconCamera, IconFileText, IconImage, IconX } from "@/components/layout/icons";
import { imageEnBase64 } from "@/components/colis/commun";
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
/** Photo brute acceptée avant compression (la compression ramène à ~1600 px). */
const PHOTO_MAX = 25_000_000;

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
}

/**
 * Import du « BORDEREAU DE TOURNEE » DPD par photos : le chauffeur
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
  const [busy, setBusy] = useState<"lecture" | "import" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galerieRef = useRef<HTMLInputElement>(null);

  const arrets = useMemo(() => fusionnerPages(pages), [pages]);
  const compteur = useMemo(() => compter(pages, arrets), [pages, arrets]);
  const retenus = arrets.filter((a) => !decoches.has(a.cle));
  const dateBordereau = pages.find((p) => p.entete.date)?.entete.date ?? null;

  function fermer() {
    setOuvert(false);
    setPages([]);
    setLectures([]);
    setDecoches(new Set());
    setModifs({});
    setErreur(null);
  }

  async function lireFichiers(fichiers: File[]) {
    if (!fichiers.length) return;
    setErreur(null);
    setBusy("lecture");
    const depart = lectures.length;
    setLectures((l) => [...l, ...fichiers.map((f) => ({ nom: f.name || "Photo", etat: "attente" as const }))]);
    const maj = (i: number, l: Partial<Lecture>) => setLectures((ls) => ls.map((x, k) => (k === depart + i ? { ...x, ...l } : x)));
    // Une page à la fois : la lecture est longue, et l'ordre d'arrivée reste celui des photos.
    for (const [i, f] of fichiers.entries()) {
      if (f.size > PHOTO_MAX) {
        maj(i, { etat: "erreur", message: "Photo trop lourde." });
        continue;
      }
      maj(i, { etat: "lecture" });
      try {
        const image = await imageEnBase64(f);
        const res = await fetch("/api/colis/bordereau", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runId, image, mediaType: "image/jpeg" }) });
        const json = (await res.json().catch(() => ({}))) as { page?: PageBordereau; error?: string; code?: string };
        // Le quota est compté dès que la lecture est lancée, même si la page est illisible.
        if (res.ok || json.code === "ILLISIBLE" || json.code === "LECTURE") setLecturesIa((n) => n + 1);
        if (!res.ok || !json.page) {
          maj(i, { etat: "erreur", message: json.error ?? "Lecture impossible." });
          if (json.code === "QUOTA_ATTEINT") {
            setErreur(json.error ?? "Quota de lectures atteint.");
            for (let k = i + 1; k < fichiers.length; k++) maj(k, { etat: "erreur", message: "Non lue (quota)." });
            break;
          }
          continue;
        }
        const page = json.page;
        setPages((ps) => ajouterPage(ps, page));
        maj(i, { etat: "ok", page: page.entete.page, message: `${page.arrets.length} arrêt(s)` });
      } catch (e) {
        maj(i, { etat: "erreur", message: networkErrorMessage(e) });
      }
    }
    setBusy(null);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galerieRef.current) galerieRef.current.value = "";
  }

  function arretModifie(a: ArretBordereau): ArretBordereau {
    const m = modifs[a.cle];
    return m ? { ...a, ...m } : a;
  }

  function modifier(cle: string, champ: Champ, valeur: string) {
    setModifs((m) => ({ ...m, [cle]: { ...m[cle], [champ]: valeur.trim() ? valeur : null } }));
  }

  async function importer() {
    if (!retenus.length) return;
    setBusy("import");
    setErreur(null);
    const points = retenus.map((a) => pointDepuisArret(arretModifie(a))).filter((p) => p.adresse.length >= 5);
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
        <IconFileText className="h-4 w-4" /> Importer le bordereau DPD
      </button>
    );
  }

  const enCours = lectures.filter((l) => l.etat === "attente" || l.etat === "lecture").length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-navy/10 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Bordereau de tournée DPD</h3>
        <button type="button" className="btn-ghost !px-2 !py-1" onClick={fermer} disabled={busy === "import"} aria-label="Fermer">
          <IconX className="h-5 w-5" />
        </button>
      </div>
      <p className="text-xs text-navy/60">
        Photographiez chaque page bien à plat, en entier et nette. Une page reprise en photo remplace la précédente. Chaque page lue compte pour une lecture IA
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
                  <li key={i} className={l.etat === "erreur" ? "text-orange-ink" : "text-navy/60"}>
                    Photo {i + 1} : {l.etat === "erreur" ? l.message : l.etat === "lecture" ? "lecture…" : "en attente"}
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
                    aria-label={`Retenir la position ${a.position ?? "?"}`}
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
                      <span className="font-semibold">Pos {a.position ?? "?"}</span>
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
                        !a.plages && a.fenetre && `Créneau : ${a.fenetre.debut}–${a.fenetre.fin}`,
                        a.nature,
                        a.expediteur && `Exp. : ${a.expediteur}`,
                        a.mentions,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
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
