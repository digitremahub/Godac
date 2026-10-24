"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { AffecterTournee } from "@/components/colis/AffecterTournee";
import { IconPointRelais, IconCamera, IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconQrCode, IconRamasse, IconX } from "@/components/layout/icons";
import { ParcelScanner } from "@/components/colis/ParcelScanner";
import { prechargerDetecteur } from "@/lib/colis/detecteur";
import { analyserCode } from "@/lib/colis/etiquette";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { OFFLINE_QUEUE_EVENT, enqueueOfflineMutation, isNetworkFailure, listOfflineMutations } from "@/lib/offline/outbox";
import { ALERTE_SANS_TELEPHONE, arretsSansTelephone, lienSms, lienTel, normaliserTelephone } from "@/lib/colis/telephone";
import { formatPoids, lirePoids, sommePoids } from "@/lib/colis/poids";
import { AlerteSansTelephone, BadgeSansTelephone } from "@/components/colis/AlertesArret";
import { estMarque, estRamasse, estPointRelais, libelleFait, libellePreuve, libelleStatut, typeArret, type TypeArret } from "@/lib/colis/livraison";
import { RESEAUX_RELAIS } from "@/lib/colis/relais";
import { BadgeArret, ChoixTypeArret, EncocheArret, bordureArret } from "@/components/colis/Ramasse";
import { estimerAvancement, heureFin } from "@/lib/colis/estimation";
import { scannerNatif, scannerNatifDisponible } from "@/lib/colis/natif";
import { LivraisonSheet } from "@/components/colis/LivraisonSheet";
import { ClotureSheet } from "@/components/colis/ClotureSheet";
import { arretsRestants, libelleMotif, prochainArret, type MotifEchec } from "@/lib/colis/cloture";
import { api, gmaps, imageEnBase64, waze, SMS_ARRIVEE, type Liste, type Run, type RunResume, type Stop } from "@/components/colis/commun";
import { ArretTriable, BoutonPoignee, ZoneFinListe, ZoneTri, type Poignee } from "@/components/colis/Triable";
import { appliquerChangements, reordonner, type CibleDepot } from "@/lib/colis/reordonner";
import { AdresseInput } from "@/components/colis/AdresseInput";
import { compteurs, grouperParListe, nomGroupe } from "@/lib/colis/listes";
import { ImportTournee } from "@/components/colis/ImportTournee";
import { ImportBordereau } from "@/components/colis/ImportBordereau";
import { LIBELLE_SOURCE } from "@/lib/colis/opening-hours";
import { HistoriqueArret } from "@/components/colis/HistoriqueArret";
import { ExportTournee } from "@/components/colis/ExportTournee";
import { EtapeCreneau, useHorairesOuverture } from "@/components/colis/EtapeCreneau";
import { CRENEAU_AUCUN, choixDepuisCreneau, validerChoix, type ChoixCreneau, type CreneauSaisi } from "@/lib/colis/creneau";
import { dateParis } from "@/lib/colis/heure-paris";
import { BadgeHoraires, HeureDepartChamp, HorairesSheet, ResumeOptimisationCarte, useHoraires, type ResumeOptimisation } from "@/components/colis/HorairesSheet";
import { confirmer } from "@/lib/ui/confirmation";
import { BadgeEpingle, LigneExtremite, OptimiserSheet, choixDeRun, libellesExtremites, lirePositionGps, memoriserChoix } from "@/components/colis/OptimiserSheet";
import { epingler, epingleDe, pointFinTournee, type Arrivee, type Depart } from "@/lib/colis/extremites";

interface Draft {
  adresse: string;
  destinataire: string;
  telephone: string;
  code: string | null;
  /** Livraison (par défaut, y compris scan et lecture d'étiquette) ou ramasse. */
  type: TypeArret;
  /** Poids en kg tel que saisi (« 2,5 ») ; pré-rempli par la lecture de l'étiquette. */
  poids: string;
  /**
   * Créneau du jour choisi avant l'ajout (étape « Créneau ») ; absent :
   * « Aucun ». Pré-sélectionné quand l'étiquette en porte un.
   */
  creneau?: ChoixCreneau;
  /** Le créneau pré-sélectionné vient de la lecture de l'étiquette. */
  creneauLu?: boolean;
  /** Établissement choisi dans la recherche : nom et coordonnées. */
  etablissement?: { nom: string; lat: number | null; lng: number | null } | null;
  /** Ne pas mémoriser cette ramasse dans les tournées futures. */
  exceptionnelle?: boolean;
  /** Point relais : nom du relais et nombre de colis à déposer. */
  relais?: string;
  colis?: number;
}

/** Nom du relais, avec les réseaux courants en suggestion. */
function NomRelaisInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list="reseaux-relais-arret"
        maxLength={200}
        placeholder="Nom du relais (ex. Relais Colis — Tabac de la Gare)"
        aria-label="Nom du point relais"
        autoComplete="off"
      />
      <datalist id="reseaux-relais-arret">
        {RESEAUX_RELAIS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}

/** Poids saisi → texte du champ (« 2,5 »). */
/** « Ajouter dans » : rangement automatique dans la liste du village (ou « Hors tournée »). */
const AUTO = "__auto__";

const champPoids = (kg: number | string | null | undefined) => (kg === null || kg === undefined || kg === "" ? "" : String(Number(kg)).replace(".", ","));

/** Réponse de /api/colis/etiquette (lib/colis/lecture-ia.ts). */
interface EtiquetteLueEcran {
  adresse: string | null;
  destinataire: string | null;
  telephone: string | null;
  code: string | null;
  poids?: number | null;
  creneau?: CreneauSaisi;
}

/** Créneau lu sur l'étiquette → choix pré-sélectionné du brouillon (« Aucun » sinon). */
function creneauLu(c: CreneauSaisi | undefined): Pick<Draft, "creneau" | "creneauLu"> {
  const choix = choixDepuisCreneau(c?.debut, c?.fin);
  return { creneau: choix, creneauLu: choix.cle !== "aucun" };
}

/** « 10:00–13:00 », « avant 10:00 », « à partir de 14:00 » (message après l'ajout). */
function libelleCourt(c: CreneauSaisi): string {
  if (!c.debut) return `avant ${c.fin}`;
  if (!c.fin) return `à partir de ${c.debut}`;
  return `${c.debut}–${c.fin}`;
}

/**
 * `encadrement` : manager / direction. `conduit` : il fait aussi des
 * tournées (chauffeur, ou manager qui conduit) : « Nouvelle tournée » crée
 * alors sa propre fiche au lieu d'ouvrir l'affectation à un chauffeur.
 */
export function TourneeColis({
  lectureEtiquette,
  pays = "FR",
  encadrement = false,
  conduit = false,
  integre = false,
  runInitial = null,
  onEtat,
  onDemarrer,
}: {
  lectureEtiquette: boolean;
  pays?: string;
  encadrement?: boolean;
  conduit?: boolean;
  /**
   * Intégrée au parcours « Ma tournée colis » (/livreur, lib/colis/parcours.ts) :
   * pas de second arrêt en cours ni de lien vers l'application chauffeur,
   * « Démarrer » passe la main au parcours.
   */
  integre?: boolean;
  /** Tournée colis à ouvrir d'abord (celle que le parcours affiche déjà). */
  runInitial?: string | null;
  /** Tournée colis affichée et ses arrêts, à chaque changement (parcours). */
  onEtat?: (run: Run | null, stops: Stop[]) => void;
  /** « Vérifier la tournée et démarrer » dans le parcours. */
  onDemarrer?: (runId: string) => void;
}) {
  const [runs, setRuns] = useState<RunResume[] | null>(null);
  const [affectationOuverte, setAffectationOuverte] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [lists, setLists] = useState<Liste[]>([]);
  /** Liste où vont les colis ajoutés (scan, saisie, import) ; null = liste implicite. */
  const [cible, setCible] = useState<string | null>(AUTO);
  const [renommage, setRenommage] = useState<{ id: string | null; nom: string } | null>(null);
  const [suppression, setSuppression] = useState<{ id: string; vers: string } | null>(null);
  const [scanner, setScanner] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scanStatus, setScanStatus] = useState("");
  const scanQueue = useRef<{ image: string; code: string | null; telephone: string | null }[]>([]);
  const scanProcessing = useRef(false);
  /** Étiquettes lues pendant que la caméra reste ouverte : à vérifier une par une à la fermeture du scanner. */
  const [brouillons, setBrouillons] = useState<Draft[]>([]);
  const codesScannes = useRef(new Set<string>());
  const [edition, setEdition] = useState<{ id: string; adresse: string; destinataire: string; telephone: string; colis: number; type: TypeArret; poids: string; relais: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [livraison, setLivraison] = useState<Stop | null>(null);
  /** Arrêt en cours de clôture (n'importe lequel des restants, pas seulement le prochain). */
  const [cloture, setCloture] = useState<{ stop: Stop; mode: "choix" | "echec" } | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  /** Arrêt dont on saisit les horaires (adresse pro / créneau du jour). */
  const [horairesStop, setHorairesStop] = useState<Stop | null>(null);
  /** Résumé de la dernière optimisation (km, fin estimée, hors horaires, fermés). */
  const [resume, setResume] = useState<ResumeOptimisation | null>(null);
  const [rechercheAdresse, setRechercheAdresse] = useState("");
  /** Feuille « Optimiser l'ordre » : départ et arrivée. */
  const [feuilleOptim, setFeuilleOptim] = useState(false);
  const horaires = useHoraires(run, stops);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Horaires d'ouverture connus de l'adresse saisie, affichés à l'étape « Créneau » avant l'ajout.
  const ouverture = useHorairesOuverture(draft?.adresse ?? "", draft !== null);
  const aujourdhui = dateParis(new Date());
  const jourTournee = run?.run_date ?? aujourdhui;
  const quandTournee = jourTournee === aujourdhui ? "aujourd'hui" : `le ${jourTournee.split("-").reverse().slice(0, 2).join("/")}`;

  const chargerTournee = useCallback(async (id: string) => {
    try {
      const data = await api<{ run: Run; stops: Stop[]; lists?: Liste[] }>(`/api/colis/tournees/${id}`);
      setRun(data.run);
      setStops(data.stops);
      setLists(data.lists ?? []);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }, []);

  const recharger = useCallback(
    async (prefere?: string | null) => {
      try {
        const { tournees } = await api<{ tournees: RunResume[] }>("/api/colis/tournees");
        setRuns(tournees);
        let memo: string | null = null;
        try {
          memo = localStorage.getItem("godac-tournee-colis");
        } catch {
          /* stockage indisponible */
        }
        const choix =
          [prefere, activeId, memo].find((id) => id && tournees.some((t) => t.id === id)) ??
          tournees.find((t) => t.status !== "done")?.id ??
          tournees[tournees.length - 1]?.id ??
          null;
        setActiveId(choix);
        if (choix) await chargerTournee(choix);
        else setRun(null);
      } catch (e) {
        setToast({ ok: false, text: networkErrorMessage(e) });
      }
    },
    [activeId, chargerTournee],
  );

  function choisir(id: string) {
    setActiveId(id);
    setCible(AUTO);
    setRenommage(null);
    setSuppression(null);
    try {
      localStorage.setItem("godac-tournee-colis", id);
    } catch {
      /* stockage indisponible */
    }
    chargerTournee(id);
  }

  async function nouvelleTournee() {
    if (encadrement && !conduit) { setAffectationOuverte(true); return; }
    setBusy("nouvelle");
    try {
      const { run: cree } = await api<{ run: Run }>("/api/colis/tournees", { method: "POST", body: JSON.stringify({}) });
      try {
        localStorage.setItem("godac-tournee-colis", cree.id);
      } catch {
        /* stockage indisponible */
      }
      await recharger(cree.id);
      setToast({ ok: true, text: `${cree.name ?? "Tournée"} créée : scannez vos colis.` });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function supprimerTournee() {
    if (!run) return;
    if (run.status === "done") { setToast({ ok: false, text: "Une tournée clôturée ne peut pas être supprimée." }); return; }
    if (!(await confirmer({ titre: "Supprimer la tournée colis ?", message: `« ${run.name ?? "Tournée colis"} » et ses ${stops.length} arrêt(s) seront supprimés. C'est définitif.`, action: "Supprimer", danger: true }))) return;
    setBusy("suppr");
    try {
      await api(`/api/colis/tournees/${run.id}`, { method: "DELETE" });
      setRun(null);
      setStops([]);
      await recharger(null);
      setToast({ ok: true, text: "Tournée supprimée." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function renommer() {
    if (!run) return;
    const nom = prompt("Nom de la tournée", run.name ?? "")?.trim();
    if (!nom || nom === run.name) return;
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ name: nom.slice(0, 60) }) }).catch((e) => setToast({ ok: false, text: networkErrorMessage(e) }));
    await recharger(run.id);
  }

  // Télécharge le lecteur de codes-barres (ZXing) en tâche de fond : le scanner s'ouvre ensuite sans attente.
  useEffect(() => {
    const t = setTimeout(prechargerDetecteur, 1500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    recharger(runInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Parcours « Ma tournée colis » : l'étape courante suit la tournée affichée ici.
  useEffect(() => {
    // Pas pendant le chargement d'une autre tournée (évite un « aucune tournée » transitoire).
    if (runs && (run || !activeId)) onEtat?.(run, stops);
  }, [runs, run, stops, activeId, onEtat]);
  // Adresses ajoutées sans réseau : dès que la file se vide (réseau revenu), la tournée se recharge.
  const fileAvant = useRef(0);
  useEffect(() => {
    async function surveiller() {
      const n = await listOfflineMutations().then((l) => l.length).catch(() => 0);
      if (fileAvant.current > 0 && n === 0) void recharger(activeId);
      fileAvant.current = n;
    }
    void surveiller();
    window.addEventListener(OFFLINE_QUEUE_EVENT, surveiller);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, surveiller);
  }, [recharger, activeId]);
  useEffect(() => {
    if (!scanner && !draft && brouillons.length) {
      setDraft(brouillons[0]!);
      setBrouillons(brouillons.slice(1));
    }
  }, [scanner, draft, brouillons]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function ajouter(d: Draft) {
    const creneau = validerChoix(d.creneau ?? CRENEAU_AUCUN);
    if (!creneau.ok) return setToast({ ok: false, text: creneau.erreur });
    setBusy("ajout");
    try {
      const corps = JSON.stringify({
          run_id: run?.id,
          list_id: listeCible === AUTO ? null : listeCible,
          code: d.code,
          adresse: d.adresse,
          destinataire: d.destinataire || null,
          telephone: d.telephone.trim() || null,
          type: d.type,
          poids: lirePoids(d.poids),
          exceptionnelle: d.exceptionnelle === true,
          creneau: creneau.creneau,
          etablissement: d.etablissement ?? null,
          ...(d.type === "point_relais" ? { relais: d.relais?.trim() || null, colis: Math.max(0, d.colis ?? 0) } : {}),
        });
      let r: { duplicate?: boolean; grouped?: boolean; geocoded?: boolean; message?: string; professionnel?: string | null; relais?: boolean; horaires?: boolean; stop?: Stop | null; village?: { nom: string; horsTournee: boolean } | null };
      try {
        r = await api<typeof r>("/api/colis/arrets", { method: "POST", body: corps });
      } catch (e) {
        if (!isNetworkFailure(e)) throw e;
        // Pas de réseau : l'adresse est gardée sur le téléphone et ajoutée dès le retour du réseau.
        await enqueueOfflineMutation("/api/colis/arrets", { method: "POST", body: corps });
        setDraft(null);
        return setToast({ ok: true, text: "Pas de réseau : l'adresse est conservée et sera ajoutée dès que le réseau revient." });
      }
      // Pas de numéro : l'ajout se fait quand même, mais le chauffeur est prévenu.
      const sansTel = !r.duplicate && !r.grouped && !normaliserTelephone(d.telephone, pays) ? ` ${ALERTE_SANS_TELEPHONE}` : "";
      setToast(
        r.duplicate
          ? { ok: false, text: "Colis déjà scanné." }
          : r.grouped
            ? { ok: true, text: r.relais ? "Ajouté à l'arrêt point relais de cette adresse." : "Ajouté à un arrêt existant (même adresse)." }
            : r.geocoded === false
              ? { ok: false, text: "Ajouté, mais adresse introuvable sur la carte : vérifiez-la." }
              : {
                  ok: !sansTel,
                  text:
                    (run?.status === "in_progress"
                      ? `${d.type === "ramasse" ? "Ramasse ajoutée" : d.type === "point_relais" ? "Point relais ajouté" : "Adresse ajoutée"} en fin de tournée : réoptimisez pour l'insérer au bon endroit.`
                      : d.type === "ramasse"
                        ? "Ramasse ajoutée."
                        : d.type === "point_relais"
                          ? "Point relais ajouté."
                          : "Colis ajouté.") +
                    (d.type === "point_relais" ? (r.horaires ? " Horaires du relais pris en compte (annuaire)." : " Ajoutez ses horaires (bouton « Horaires ») pour l'optimisation.") : "") + (r.village ? (r.village.horsTournee ? " · Rangé dans « Hors tournée »." : ` · Village : ${r.village.nom}.`) : "") +
                    (creneau.creneau ? ` · Créneau ${libelleCourt(creneau.creneau)}.` : "") +
                    (r.professionnel ? ` · Professionnel détecté : ${r.professionnel} (recherche de ses horaires…).` : "") +
                    sansTel,
                },
      );
      setDraft(null);
      await recharger(run?.id);
      // Adresse pro : horaires cherchés sur internet en arrière-plan, sans bloquer le chargement.
      if (r.stop?.id && !r.grouped && !r.duplicate) void chercherHoraires([r.stop.id]);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Détection des adresses pro et recherche de leurs horaires (OpenStreetMap,
   * Google en option), enregistrés dans l'annuaire. Sans `ids` : tous les
   * arrêts de la tournée jamais examinés (après un import).
   */
  async function chercherHoraires(ids?: string[]) {
    if (!run) return;
    try {
      const { resultats } = await api<{ resultats: { stopId: string; nom: string | null; horaires: { source: string; nom: string } | null }[] }>("/api/colis/horaires/recherche", {
        method: "POST",
        body: JSON.stringify({ run_id: run.id, ...(ids ? { stop_ids: ids } : {}) }),
      });
      const trouves = resultats.filter((x) => x.horaires);
      if (!trouves.length) return;
      const source = LIBELLE_SOURCE[trouves[0]!.horaires!.source] ?? trouves[0]!.horaires!.source;
      setToast({
        ok: true,
        text:
          trouves.length === 1
            ? `Horaires trouvés (${source}) pour ${trouves[0]!.horaires!.nom} : vérifiez-les avec le bouton « Horaires ».`
            : `Horaires trouvés pour ${trouves.length} adresses pro : vérifiez-les avec le bouton « Horaires ».`,
      });
      await chargerTournee(run.id);
    } catch {
      /* recherche facultative : rien à signaler au chauffeur */
    }
  }

  /** Lit les étiquettes en série, pendant que la caméra reste ouverte : le brouillon lu rejoint la file « à vérifier ». */
  async function lireImageScannee(image: string, code: string | null, telephone: string | null) {
    setBusy("photo");
    try {
      const lu = await api<EtiquetteLueEcran>("/api/colis/etiquette", { method: "POST", body: JSON.stringify({ image, mediaType: "image/jpeg" }) }, 30_000);
      // Une lecture OCR peut confondre des lignes d'étiquette : le brouillon est toujours validé par le chauffeur.
      const d: Draft = { adresse: lu.adresse ?? "", destinataire: lu.destinataire ?? "", telephone: lu.telephone ?? telephone ?? "", code: code ?? lu.code, type: "livraison", poids: champPoids(lu.poids), ...creneauLu(lu.creneau) };
      setBrouillons((b) => [...b, d]);
      return true;
    } catch (e) {
      // Échec : le colis n'est pas perdu, son numéro rejoint la file avec l'adresse à saisir.
      setBrouillons((b) => [...b, { adresse: "", destinataire: "", telephone: telephone ?? "", code, type: "livraison", poids: "" }]);
      setToast({ ok: false, text: "Lecture impossible pour " + (code ?? "ce colis") + " : " + networkErrorMessage(e) + ". Vous complétez l’adresse à la fin du scan." });
      return false;
    } finally { setBusy(null); }
  }

  async function traiterFileScans() {
    if (scanProcessing.current) return;
    scanProcessing.current = true;
    try {
      while (scanQueue.current.length) {
        const item = scanQueue.current.shift()!;
        setScanStatus("Colis " + (item.code ?? "détecté") + " — lecture des informations…");
        const ok = await lireImageScannee(item.image, item.code, item.telephone);
        setScanStatus(`${ok ? "Colis " + (item.code ?? "") + " lu" : "Lecture impossible pour " + (item.code ?? "un colis")}${scanQueue.current.length ? " · " + scanQueue.current.length + " en attente" : ""}`);
      }
    } finally { scanProcessing.current = false; }
  }

  /** `false` : le scanner natif s'arrête (QR complet ouvert dans le formulaire) ; `true` : on continue de scanner. */
  function onCode(text: string, image?: string): boolean {
    const lu = analyserCode(text, pays);
    // Un colis déjà lu pendant ce scan n'est pas relu (l'API sait aussi refuser les doublons à l'ajout).
    if (lu.code && codesScannes.current.has(lu.code)) {
      setScanStatus("Colis " + lu.code + " déjà scanné");
      return true;
    }
    if (lu.adresse) {
      const d: Draft = { adresse: lu.adresse, destinataire: lu.destinataire ?? "", telephone: lu.telephone ?? "", code: lu.code, type: "livraison", poids: champPoids(lu.poids) };
      if (lu.code) codesScannes.current.add(lu.code);
      // Toujours demander confirmation (champs d'un QR non normalisés), mais sans fermer la caméra.
      setBrouillons((b) => [...b, d]);
      setScanStatus("QR lu : " + (lu.code ?? "adresse") + " · à vérifier à la fin du scan");
      return true;
    }
    if (lectureEtiquette && image) {
      if (lu.code) codesScannes.current.add(lu.code);
      scanQueue.current.push({ image, code: lu.code, telephone: lu.telephone ?? null });
      setScanStatus("Code lu : " + (lu.code ?? text) + " · lecture automatique");
      void traiterFileScans();
    } else {
      setScanner(false);
      setDraft({ adresse: "", destinataire: "", telephone: lu.telephone ?? "", code: lu.code, type: "livraison", poids: champPoids(lu.poids) });
      setToast({ ok: true, text: "Numéro de colis lu : " + (lu.code ?? text) + ". Complétez l’adresse." });
    }
    return true;
  }

  /** Application des stores : scanner natif Google, rouvert après chaque colis ajouté. Sinon scanner web. */
  async function ouvrirScanner() {
    // La lecture automatique d'étiquette a besoin de l'image caméra complète.
    // Le scanner natif ne fournit que le texte du code, donc on utilise le scanner web.
    if (lectureEtiquette || !scannerNatifDisponible()) return setScanner(true);
    try {
      for (;;) {
        const code = await scannerNatif();
        if (!code || !onCode(code)) break;
      }
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  async function photo(file: File) {
    setBusy("photo");
    try {
      const image = await imageEnBase64(file);
      const lu = await api<EtiquetteLueEcran>("/api/colis/etiquette", {
        method: "POST",
        body: JSON.stringify({ image, mediaType: "image/jpeg" }),
      }, 30_000);
      setDraft((d) => ({
        adresse: lu.adresse ?? d?.adresse ?? "",
        destinataire: lu.destinataire ?? d?.destinataire ?? "",
        telephone: lu.telephone ?? d?.telephone ?? "",
        code: d?.code ?? lu.code,
        type: d?.type ?? "livraison",
        poids: lu.poids ? champPoids(lu.poids) : (d?.poids ?? ""),
        // Créneau lu sur l'étiquette pré-sélectionné ; sinon le choix en cours est gardé.
        ...(lu.creneau ? creneauLu(lu.creneau) : { creneau: d?.creneau, creneauLu: d?.creneauLu }),
      }));
      if (!lu.adresse) setToast({ ok: false, text: "Adresse illisible : saisissez-la." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * Calcule l'ordre. `depuisMaPosition` : recalcul en cours de route, prochaine
   * adresse la plus proche depuis le GPS. `choix` : départ et arrivée de la
   * feuille « Optimiser l'ordre » (mémorisés sur la tournée). Renvoie un
   * message d'erreur, ou null.
   */
  async function optimiser(depuisMaPosition = false, choix?: { depart: Depart | null; arrivee: Arrivee }): Promise<string | null> {
    setBusy("optim");
    try {
      const depuis = depuisMaPosition || choix?.depart?.mode === "position" ? await lirePositionGps() : null;
      if (run && choix) setRun(await memoriserChoix(run, choix.depart, choix.arrivee));
      const r = await api<ResumeOptimisation>("/api/colis/optimiser", {
        method: "POST",
        body: JSON.stringify({ run_id: run?.id, depuis, ...(choix ? { depart: choix.depart, arrivee: choix.arrivee } : {}), ...(depuisMaPosition ? { strategie: "proche" } : {}) }),
      });
      const gain = r.kmAvant - r.kmApres;
      await recharger(run?.id);
      setResume(r);
      const signales = r.horsHoraires.length + r.fermes.length + r.impossibles.length;
      setToast({
        ok: !signales,
        text: `Ordre optimisé : ≈ ${r.kmApres} km${gain > 0.5 ? ` (−${Math.round(gain)} km)` : ""}${r.extremites ? ` · départ ${r.extremites.depart}, arrivée ${r.extremites.arrivee}` : ""}${r.distanceRoutiere === false ? " · estimation, moteur routier indisponible" : " · distances routières"}${r.sansGps ? ` · ${r.sansGps} adresse(s) à vérifier en fin de liste` : ""}${signales ? ` · ${signales} adresse(s) hors horaires ou fermée(s)` : ""}.`,
      });
      return null;
    } catch (e) {
      const message = networkErrorMessage(e);
      setToast({ ok: false, text: message });
      return message;
    } finally {
      setBusy(null);
    }
  }

  /** 📌 Mettre un arrêt en premier / en dernier (ou retirer l'épingle) pour les prochaines optimisations. */
  async function epingleArret(s: Stop, role: "premier" | "dernier" | null) {
    if (!run) return;
    const { depart, arrivee } = choixDeRun(run);
    const depotConnu = run.start_lat !== null && run.start_lng !== null;
    const nouveau = epingler(depart, arrivee, s.id, role, depotConnu);
    // Même résultat que l'optimisation : le départ « arrêt » remplace le dépôt, l'arrivée « arrêt » le retour.
    const maj = await memoriserChoix(run, nouveau.depart, nouveau.arrivee);
    setRun(maj);
    if (!role) return void setToast({ ok: true, text: "Épingle retirée : réoptimisez pour recalculer l'ordre." });
    // Placé tout de suite en tête / en fin de sa liste ; l'optimisation le garde à cette place.
    const groupe = grouperParListe(stops, lists).find((g) => g.arrets.some((x) => x.id === s.id));
    const tete = groupe?.arrets.find((x) => x.id !== s.id && x.status === "pending");
    if (groupe && (role === "dernier" || tete)) await deposer(s.id, { list_id: s.list_id ?? null, avant_id: role === "premier" ? tete!.id : null });
    setToast({ ok: true, text: role === "premier" ? "📌 Cet arrêt sera toujours le premier : réoptimisez pour recalculer le reste." : "📌 Cet arrêt sera toujours le dernier : réoptimisez pour recalculer le reste." });
  }

  /** Clôture (livré / échec avec motif) ou annulation d'un arrêt, dans n'importe quel ordre. */
  async function statut(s: Stop, status: Stop["status"], echec?: { motif: MotifEchec; precision: string | null }) {
    setStops((all) =>
      all.map((x) =>
        x.id === s.id
          ? {
              ...x,
              status,
              done_at: status === "pending" ? null : new Date().toISOString(),
              failure_reason: status === "failed" ? (echec?.motif ?? "absent") : null,
              ...(status !== "delivered" ? { delivered_place: null, proof_code: null } : {}),
            }
          : x,
      ),
    );
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ status, run_id: run?.id, ...(echec ?? {}) }) });
    } catch (e) {
      if (isNetworkFailure(e)) {
        try {
          await enqueueOfflineMutation(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ status, run_id: run?.id, ...(echec ?? {}) }) });
          setToast({ ok: true, text: "Action enregistrée sur le téléphone. Elle sera synchronisée dès le retour du réseau." });
          return;
        } catch (queueError) {
          setToast({ ok: false, text: networkErrorMessage(queueError) });
        }
      } else setToast({ ok: false, text: networkErrorMessage(e) });
      await recharger(run?.id);
    }
  }

  async function supprimer(s: Stop) {
    if (!(await confirmer({ titre: "Retirer cet arrêt ?", message: `« ${s.address} » sera retiré de la tournée colis.`, action: "Retirer", danger: true }))) return;
    setStops((all) => all.filter((x) => x.id !== s.id));
    await api(`/api/colis/arrets/${s.id}`, { method: "DELETE" }).catch(() => recharger(run?.id));
  }

  async function enregistrerEdition() {
    if (!edition) return;
    const avant = stops.find((x) => x.id === edition.id);
    setBusy("edition");
    try {
      await api(`/api/colis/arrets/${edition.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(avant && edition.adresse.trim() !== avant.address ? { adresse: edition.adresse.trim() } : {}),
          destinataire: edition.destinataire.trim() || null,
          telephone: edition.telephone.trim() || null,
          parcel_count: Math.max(1, edition.colis),
          ...(avant && edition.type !== typeArret(avant.kind) ? { type: edition.type } : {}),
          ...(avant && edition.type === "point_relais" && edition.relais.trim() !== (avant.relay_name ?? "") ? { relais: edition.relais.trim() || null } : {}),
          ...(avant && lirePoids(edition.poids) !== lirePoids(avant.weight_kg ?? null) ? { poids: lirePoids(edition.poids) } : {}),
        }),
      });
      setEdition(null);
      await recharger(run?.id);
      setToast({ ok: true, text: avant && edition.adresse.trim() !== avant.address ? "Adresse modifiée : pensez à réoptimiser l'ordre." : "Arrêt mis à jour." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  /** « Livré » ouvre la feuille de livraison (mode de remise, preuve) ; une ramasse est simplement marquée faite. */
  function terminer(s: Stop) {
    if (estRamasse(s)) return statut(s, "delivered");
    setLivraison(s);
  }

  async function deplacer(st: Stop, sens: "haut" | "bas") {
    try {
      await api(`/api/colis/arrets/${st.id}`, { method: "PATCH", body: JSON.stringify({ deplacer: sens }) });
      await recharger(run?.id);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  /** Glisser-déposer : ordre local tout de suite, puis enregistrement (événement « reordered »). */
  async function deposer(id: string, cible: CibleDepot) {
    const changements = reordonner(stops, id, cible);
    if (changements.length === 0) return;
    setStops((all) => appliquerChangements(all, changements));
    try {
      await api(`/api/colis/arrets/${id}`, { method: "PATCH", body: JSON.stringify({ deposer: cible }) });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
    await recharger(run?.id);
  }

  async function phase(status: Run["status"]) {
    if (!run) return;
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await recharger(run.id);
  }

  // ── Listes de la tournée ────────────────────────────────────────
  async function nouvelleListe() {
    if (!run) return;
    setBusy("liste");
    try {
      const { list } = await api<{ list: Liste }>("/api/colis/listes", { method: "POST", body: JSON.stringify({ run_id: run.id }) });
      setCible(list.id);
      await recharger(run.id);
      setToast({ ok: true, text: `${list.name} créée : les prochains colis y seront ajoutés.` });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function enregistrerNomListe() {
    if (!run || !renommage) return;
    const nom = renommage.nom.trim().slice(0, 60);
    if (!nom) return;
    setBusy("liste");
    try {
      // La liste implicite devient une vraie liste au premier renommage.
      if (renommage.id) await api(`/api/colis/listes/${renommage.id}`, { method: "PATCH", body: JSON.stringify({ name: nom }) });
      else await api("/api/colis/listes", { method: "POST", body: JSON.stringify({ run_id: run.id, name: nom, principale: true }) });
      setRenommage(null);
      await recharger(run.id);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function deplacerListe(l: Liste, sens: "haut" | "bas") {
    try {
      await api(`/api/colis/listes/${l.id}`, { method: "PATCH", body: JSON.stringify({ deplacer: sens }) });
      await recharger(run?.id);
      setToast({ ok: true, text: "Ordre des listes modifié : réoptimisez pour recalculer le trajet." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  /** Une liste vide est supprimée ; une liste avec des arrêts les range d'abord dans `vers`. */
  async function supprimerListe(l: Liste, nbArrets: number, vers?: string) {
    if (nbArrets && !vers) return setSuppression({ id: l.id, vers: lists.find((x) => x.id !== l.id)?.id ?? "" });
    if (!nbArrets && !(await confirmer({ titre: `Supprimer la liste « ${l.name} » ?`, message: "", action: "Supprimer", danger: true }))) return;
    setBusy("liste");
    try {
      await api(`/api/colis/listes/${l.id}${vers ? `?vers=${encodeURIComponent(vers)}` : ""}`, { method: "DELETE" });
      setSuppression(null);
      if (cible === l.id) setCible(vers ?? null);
      await recharger(run?.id);
      setToast({ ok: true, text: nbArrets ? `Liste supprimée : ses ${nbArrets} arrêt(s) ont été déplacés.` : "Liste supprimée." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function changerListe(s: Stop, listId: string) {
    if (!listId || listId === s.list_id) return;
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ list_id: listId }) });
      await recharger(run?.id);
      setToast({ ok: true, text: `Arrêt déplacé dans « ${lists.find((l) => l.id === listId)?.name ?? "la liste"} ».` });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  // Arrêts par liste. Une seule liste implicite : affichage identique à une tournée sans liste.
  const groupesComplets = grouperParListe(stops, lists);
  const termeAdresse = rechercheAdresse.trim().toLocaleLowerCase("fr-FR");
  const groupes = termeAdresse
    ? groupesComplets.map((g) => ({ ...g, arrets: g.arrets.filter((s) => [s.address, s.recipient ?? "", s.phone ?? "", s.parcel_code ?? ""].some((v) => v.toLocaleLowerCase("fr-FR").includes(termeAdresse))) })).filter((g) => g.arrets.length > 0)
    : groupesComplets;
  // Recherche d'adresses et d'établissements biaisée autour du dépôt de la tournée.
  const depot = run && run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  // Glisser-déposer : arrêts à livrer, hors recherche et hors tournée terminée.
  const triActif = Boolean(run && run.status !== "done" && !termeAdresse && edition === null);
  const ordreTri = groupes.flatMap((g) => g.arrets).filter((s) => s.status === "pending").map((s) => ({ id: s.id, list_id: s.list_id ?? null }));
  const multi = groupesComplets.length > 1 || groupesComplets[0]?.liste != null;
  const listeCible = cible === AUTO || !groupesComplets.some((g) => (g.liste?.id ?? null) === cible) ? AUTO : cible;
  const cibles = [{ id: AUTO, nom: "Automatique (village / Hors tournée)" }, ...groupesComplets.filter((g) => g.liste).map((g) => ({ id: g.liste!.id, nom: nomGroupe(g) }))];
  const choixCible = multi && (
    <label className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-navy/65">Ajouter dans :</span>
      <select className="input !w-auto !py-1.5" value={listeCible ?? ""} onChange={(e) => setCible(e.target.value || null)} aria-label="Liste où ajouter les colis">
        {cibles.map((c) => (
          <option key={c.id ?? ""} value={c.id ?? ""}>
            {c.nom}
          </option>
        ))}
      </select>
    </label>
  );

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const selecteur = runs && (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Mes tournées colis">
      {runs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === activeId}
          onClick={() => choisir(t.id)}
          className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
            t.id === activeId ? "border-teal bg-teal/10 font-semibold" : "border-navy/10 bg-surface hover:border-navy/25"
          }`}
        >
          <span className="block leading-tight">
            {t.name ?? "Tournée"}
            {t.planned_start && <span className="ml-1 text-xs font-normal text-navy/55">{String(t.planned_start).slice(0, 5)}</span>}
            {t.run_date !== today && <span className="ml-1 text-xs font-normal text-navy/55">({new Date(`${t.run_date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })})</span>}
          </span>
          <span className="block text-xs font-normal text-navy/60">
            {t.status === "done" ? "Clôturée" : t.status === "in_progress" ? `En livraison · ${t.nbRestants} restant(s)` : `${t.nbColis} colis`}
          </span>
        </button>
      ))}
      <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy !== null} onClick={nouvelleTournee}>
        + Nouvelle tournée colis
      </button>
    </div>
  );

  const modalAffectation = affectationOuverte ? <AffecterTournee onClose={() => setAffectationOuverte(false)} onCreated={async (runId, message) => { setAffectationOuverte(false); await recharger(runId); setToast({ ok: true, text: message }); }} /> : null;

  if (!runs) return <>{modalAffectation}<p className="text-sm text-navy/60">Chargement des tournées…</p></>;
  if (!run) {
    return (
      <div className="flex flex-col gap-4">
        {modalAffectation}
        {toast && (
          <p role="status" className={`fixed inset-x-4 top-4 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-on-orange"}`}>
            {toast.text}
          </p>
        )}
        <Card className="flex flex-col items-start gap-3">
          <h2 className="text-lg">Aucune tournée colis en cours</h2>
          <p className="text-sm text-navy/65">Créez une tournée colis, scannez vos colis, puis laissez GODAC calculer l&apos;ordre de passage. Vous pouvez en faire plusieurs par jour.</p>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={nouvelleTournee}>
            Créer une tournée colis
          </button>
        </Card>
      </div>
    );
  }

  const pending = arretsRestants(stops);
  const colis = stops.reduce((n, s) => n + s.parcel_count, 0);
  // Premier arrêt non clôturé dans l'ordre, même si d'autres ont été clôturés avant leur tour.
  const prochain = prochainArret(stops) ?? undefined;
  const livres = stops.filter((s) => s.status === "delivered").length;
  const ramasses = stops.filter(estRamasse).length;
  const poidsTotal = formatPoids(sommePoids(stops));
  const sansTelephone = arretsSansTelephone(stops).length;
  const enLivraison = run.status === "in_progress";
  const choix = choixDeRun(run);
  const avancement = estimerAvancement(
    stops.map((s) => ({ status: s.status, parcel_count: s.parcel_count, lat: s.lat, lng: s.lng, done_at: s.done_at ?? null, fenetres: horaires.fenetres.get(s.id) ?? null })),
    {
      depot: run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null,
      retourDepot: run.return_to_start,
      // Retour au dépôt, à l'adresse choisie ou au départ : le trajet compte dans l'heure de fin.
      arrivee: choix.arrivee ? pointFinTournee(choix.arrivee, choix.depart, run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null, stops, run.return_to_start) : undefined,
    },
  );
  const extremites = libellesExtremites(run, stops, choix);

  const explicites = groupesComplets.filter((g) => g.liste);
  /** En-tête d'une liste : nom (renommable), compteurs, ordre, suppression. */
  const enteteListe = (g: (typeof groupes)[number], k: number) => {
    const c = compteurs(g.arrets);
    const l = g.liste;
    const rang = l ? explicites.findIndex((x) => x.liste?.id === l.id) : -1;
    const modifiable = run.status !== "done";
    return (
      <li className={`bg-navy/[0.03] px-4 py-2 sm:px-5 ${k > 0 ? "border-t-2 border-navy/10" : ""}`}>
        {renommage && renommage.id === (l?.id ?? null) ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enregistrerNomListe();
            }}
          >
            <input className="input !w-auto min-w-0 flex-1 !py-1.5 text-sm" value={renommage.nom} maxLength={60} autoFocus onChange={(e) => setRenommage({ ...renommage, nom: e.target.value })} aria-label="Nom de la liste" />
            <button type="submit" className="btn-primary !py-1.5 text-sm" disabled={busy !== null || !renommage.nom.trim()}>
              Enregistrer
            </button>
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setRenommage(null)}>
              Annuler
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{nomGroupe(g)}</p>
              <p className="text-xs text-navy/60">
                {c.arrets} arrêt{c.arrets > 1 ? "s" : ""} · {c.colis} colis{formatPoids(sommePoids(g.arrets)) && ` (${formatPoids(sommePoids(g.arrets))})`} · {c.restants} restant{c.restants > 1 ? "s" : ""}
              </p>
            </div>
            {modifiable && (
              <div className="flex flex-wrap gap-1 text-xs">
                {l && (
                  <>
                    <button type="button" className="btn-ghost !px-2 !py-1" disabled={rang <= 0} aria-label={`Monter la liste ${l.name}`} onClick={() => deplacerListe(l, "haut")}>
                      ↑
                    </button>
                    <button type="button" className="btn-ghost !px-2 !py-1" disabled={rang >= explicites.length - 1} aria-label={`Descendre la liste ${l.name}`} onClick={() => deplacerListe(l, "bas")}>
                      ↓
                    </button>
                  </>
                )}
                {(l || !lists.length) && (
                  <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setRenommage({ id: l?.id ?? null, nom: nomGroupe(g) })}>
                    Renommer
                  </button>
                )}
                {l && explicites.length > 1 && (
                  <button type="button" className="btn-ghost !px-2 !py-1 text-orange-ink" disabled={busy !== null} onClick={() => supprimerListe(l, c.arrets)}>
                    Supprimer
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {l && suppression?.id === l.id && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-orange/40 p-2 text-sm">
            <span>Déplacer ses {c.arrets} arrêt(s) vers</span>
            <select className="input !w-auto !py-1.5" value={suppression.vers} onChange={(e) => setSuppression({ ...suppression, vers: e.target.value })} aria-label="Liste de destination">
              {lists
                .filter((x) => x.id !== l.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            <button type="button" className="btn-primary !py-1.5 text-sm" disabled={busy !== null || !suppression.vers} onClick={() => supprimerListe(l, c.arrets, suppression.vers)}>
              Déplacer et supprimer la liste
            </button>
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setSuppression(null)}>
              Annuler
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      {toast && (
        <p role="status" className={`fixed inset-x-4 top-4 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-on-orange"}`}>
          {toast.text}
        </p>
      )}
      {cloture && (
        <ClotureSheet
          stop={cloture.stop}
          numero={stops.indexOf(cloture.stop) + 1}
          horsOrdre={cloture.stop.id !== prochain?.id}
          mode={cloture.mode}
          onClose={() => setCloture(null)}
          onLivrer={() => {
            const s = cloture.stop;
            setCloture(null);
            terminer(s);
          }}
          onEchec={async (motif, precision) => {
            const s = cloture.stop;
            setCloture(null);
            await statut(s, "failed", { motif, precision });
          }}
        />
      )}
      {livraison && (
        <LivraisonSheet
          stop={livraison}
          onClose={() => setLivraison(null)}
          onLivre={(maj) => {
            setStops((all) => all.map((x) => (x.id === maj.id ? maj : x)));
            setLivraison(null);
          }}
        />
      )}
      {feuilleOptim && (
        <OptimiserSheet
          run={run}
          stops={stops}
          enLivraison={enLivraison}
          initial={choix}
          onFermer={() => setFeuilleOptim(false)}
          onValider={(depart, arrivee) => optimiser(enLivraison, { depart: enLivraison && depart?.mode === "position" ? null : depart, arrivee })}
        />
      )}
      {horairesStop && (
        <HorairesSheet
          stop={horairesStop}
          jour={horaires.jour}
          onClose={() => setHorairesStop(null)}
          onSaved={async (texte) => {
            setHorairesStop(null);
            setToast({ ok: true, text: texte });
            await recharger(run.id);
          }}
        />
      )}
      {scanner && (
        <ParcelScanner
          onCode={onCode}
          capturerImage={lectureEtiquette}
          // Les étiquettes en cours de lecture se terminent en arrière-plan : on ne vide pas la file.
          onClose={() => { setScanner(false); setScanStatus(""); codesScannes.current.clear(); }}
          statut={scanStatus + (brouillons.length ? (scanStatus ? " · " : "") + brouillons.length + " à vérifier" : "")}
          bouton={brouillons.length || scanProcessing.current ? "Terminer et vérifier les colis" : "Terminer le scan"}
        />
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && photo(e.target.files[0])} />

      {selecteur}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">
          {run.name ?? "Tournée"}
          {run.status === "done" && <span className="ml-2 rounded-full bg-navy/[0.06] px-2 py-0.5 text-xs font-semibold text-navy/65">Clôturée</span>}
        </h2>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-sm" onClick={renommer}>
            Renommer
          </button>
          {run.status !== "done" && <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-sm text-orange-ink" disabled={busy !== null} onClick={supprimerTournee}>
            Supprimer la tournée colis
          </button>}
        </div>
      </div>
      <label className="relative block">
        <span className="sr-only">Rechercher une adresse dans la tournée</span>
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-navy/45">⌕</span>
        <input className="input !pl-9" type="search" value={rechercheAdresse} onChange={(e) => setRechercheAdresse(e.target.value)} placeholder="Rechercher une adresse, un destinataire ou un code colis…" aria-label="Rechercher dans les adresses de la tournée" />
        {rechercheAdresse && <button type="button" className="absolute inset-y-0 right-2 px-2 text-sm text-navy/60" onClick={() => setRechercheAdresse("")}>Effacer</button>}
      </label>
      {rechercheAdresse && <p className="-mt-2 text-xs text-navy/60">{groupes.reduce((n, g) => n + g.arrets.length, 0)} résultat(s) sur {stops.length} arrêt(s).</p>}
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Arrêts", stops.length, ramasses ? `dont ${ramasses} ramasse${ramasses > 1 ? "s" : ""}` : null],
          ["Colis", colis, poidsTotal && `≈ ${poidsTotal}`],
          ["Livrés", `${livres}/${stops.length}`],
        ].map(([l, v, detail]) => (
          <Card key={l as string} className="!px-3 !py-2.5 text-center">
            <p className="text-xs text-navy/60">{l}</p>
            <p className="font-display text-xl font-bold tabular-nums">{v}</p>
            {detail && <p className={`text-[11px] font-semibold ${l === "Arrêts" ? "text-gold-ink" : "text-navy/60"}`}>{detail}</p>}
          </Card>
        ))}
      </div>

      {enLivraison && avancement.adressesRestantes > 0 && (
        <p className="rounded-xl bg-marine px-4 py-2.5 text-sm text-white">
          Reste <strong>{avancement.adressesRestantes}</strong> adresse{avancement.adressesRestantes > 1 ? "s" : ""} et{" "}
          <strong>{avancement.colisRestants}</strong> colis
          {avancement.finEstimee && (
            <>
              {" "}
              · fin estimée vers <strong className="text-teal">{heureFin(avancement.finEstimee)}</strong>
              <span className="text-white/60">{avancement.methode === "rythme" ? " (au rythme actuel)" : " (estimation)"}</span>
            </>
          )}
        </p>
      )}

      {enLivraison && prochain && integre ? null : enLivraison && prochain ? (
        <Card className={`relative flex flex-col gap-3 overflow-hidden border-2 ${bordureArret(prochain, "border-teal/50")}`}>
          <EncocheArret stop={prochain} large />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wide text-teal-ink">
            <BadgeArret stop={prochain} />
            <span>
              Arrêt {stops.indexOf(prochain) + 1} / {stops.length}
              {prochain.parcel_count > 1 && ` · ${prochain.parcel_count} colis${estRamasse(prochain) ? " à ramasser" : estPointRelais(prochain) ? " à déposer" : ""}`}
              {multi && ` · ${nomGroupe(groupes.find((g) => g.arrets.includes(prochain)) ?? { liste: null })}`}
            </span>
          </p>
          <div>
            <p className="font-display text-xl font-bold leading-snug">{prochain.address}</p>
            {prochain.recipient && <p className="text-sm text-navy/70">{prochain.recipient}</p>}
            {prochain.notes && <p className="mt-1 text-sm text-navy/70">{prochain.notes}</p>}
            <BadgeHoraires stop={prochain} fenetres={horaires.fenetres.get(prochain.id) ?? null} passage={horaires.passages.get(prochain.id)} />
          </div>
          {prochain.phone && (
            <div className="grid grid-cols-2 gap-2">
              <a href={lienTel(prochain.phone)} className="btn-secondary justify-center border-teal/70 !py-3 text-teal-ink">
                <IconPhone className="h-4 w-4" /> Appeler
              </a>
              <a href={lienSms(prochain.phone, SMS_ARRIVEE)} className="btn-secondary justify-center !py-3">
                <IconMessage className="h-4 w-4" /> Prévenir (SMS)
              </a>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a href={waze(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
              <IconNavigation className="h-4 w-4" /> Waze
            </a>
            <a href={gmaps(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
              <IconMapPin className="h-4 w-4" /> Google Maps
            </a>
            <button type="button" className="btn-primary justify-center !py-3 text-base" onClick={() => terminer(prochain)}>
              {estRamasse(prochain) ? <IconRamasse className="h-5 w-5" /> : estPointRelais(prochain) ? <IconPointRelais className="h-5 w-5" /> : <IconCheck className="h-5 w-5" />} {libelleFait(prochain)}
            </button>
            <button type="button" className="btn-secondary justify-center !py-3 text-orange-ink" onClick={() => setCloture({ stop: prochain, mode: "echec" })}>
              <IconX className="h-5 w-5" /> Non livré
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/livreur" className="btn-secondary !py-1.5 text-sm">
              Ma tournée colis (plein écran)
            </Link>
            <button type="button" className="btn-ghost w-fit !py-1.5 text-sm" disabled={busy !== null} onClick={() => optimiser(true)}>
              Réoptimiser depuis ma position
            </button>
          </div>
        </Card>
      ) : enLivraison ? (
        <Card className="text-center">
          <p className="font-display text-lg font-bold">Tournée terminée 🎉</p>
          <p className="mt-1 text-sm text-navy/65">{livres} arrêt(s) livré(s) sur {stops.length}.</p>
          <button type="button" className="btn-primary mt-3" onClick={() => phase("done")}>
            Clôturer la tournée colis
          </button>
        </Card>
      ) : run.status === "done" ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-sm text-navy/70">
            Tournée colis clôturée et verrouillée : {livres} arrêt(s) livré(s) sur {stops.length}.
          </p>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={nouvelleTournee}>
            + Nouvelle tournée colis (supplémentaire)
          </button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Charger les colis</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button type="button" className="btn-primary justify-center !py-3" onClick={ouvrirScanner}>
              <IconQrCode className="h-5 w-5" /> Scanner les colis
            </button>
            {lectureEtiquette && (
              <button type="button" className="btn-secondary justify-center !py-3" disabled={busy === "photo"} onClick={() => fileRef.current?.click()}>
                <IconCamera className="h-5 w-5" /> {busy === "photo" ? "Lecture…" : "Photo d'étiquette"}
              </button>
            )}
            <button type="button" className="btn-secondary justify-center !py-3" onClick={() => setDraft({ adresse: "", destinataire: "", telephone: "", code: null, type: "livraison", poids: "" })}>
              + Saisir une adresse
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {choixCible}
            <button type="button" className="btn-ghost !px-2 !py-1.5 text-sm" disabled={busy !== null} onClick={nouvelleListe}>
              + Nouvelle liste
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-xs text-navy/70">
              <p className="font-semibold">🏁 Départ : {extremites.depart}</p>
              <p className="font-semibold">🏁 Arrivée : {extremites.arrivee}</p>
              {!run.start_label && <p className="text-navy/60">Pas d&apos;adresse de dépôt : renseignez-la dans Organisation → Services.</p>}
              {extremites.erreur && <p className="text-orange-ink">{extremites.erreur}</p>}
            </div>
            <HeureDepartChamp run={run} onChange={() => recharger(run.id)} />
          </div>
          <ImportTournee
            runId={run.id}
            cibles={cibles.map((c) => (c.id === AUTO ? { id: null, nom: c.nom } : c))}
            cibleParDefaut={listeCible === AUTO ? null : listeCible}
            onImporte={async (texte, ok, listId) => {
              setToast({ ok, text: texte });
              if (listId) setCible(listId);
              await recharger(run.id);
              void chercherHoraires();
            }}
          />
          {run.status === "loading" && (
            <ImportBordereau
              runId={run.id}
              runDate={run.run_date}
              onImporte={async (texte, ok) => {
                setToast({ ok, text: texte });
                await recharger(run.id);
                void chercherHoraires();
              }}
            />
          )}
        </Card>
      )}

      {enLivraison && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => setDraft({ adresse: "", destinataire: "", telephone: "", code: null, type: "livraison", poids: "" })}>
            + Ajouter une adresse
          </button>
          <button type="button" className="btn-secondary !py-2 text-sm" onClick={ouvrirScanner}>
            <IconQrCode className="h-4 w-4" /> Scanner un colis
          </button>
          {choixCible}
        </div>
      )}

      {draft && (
        // Fenêtre au-dessus de la page : le formulaire s'ouvre là où l'on est, sans descendre chercher la ligne ouverte.
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-label="Nouvelle adresse">
        <Card className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto overscroll-contain !rounded-b-none border-2 border-teal/40 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:!rounded-b-3xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg">{draft.type === "ramasse" ? "Nouvelle ramasse" : draft.type === "point_relais" ? "Dépôt en point relais" : "Nouveau colis"}</h2>
            <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setDraft(null)} aria-label="Annuler">
              <IconX className="h-5 w-5" />
            </button>
          </div>
          {draft.code && <p className="text-xs text-navy/60">Colis n° {draft.code}</p>}
          {brouillons.length > 0 && <p className="text-xs font-semibold text-teal-ink">Encore {brouillons.length} colis scanné{brouillons.length > 1 ? "s" : ""} à vérifier après celui-ci.</p>}
          <ChoixTypeArret value={draft.type} onChange={(type) => setDraft({ ...draft, type })} />
          {choixCible}
          {draft.type === "point_relais" && (
            <div className="flex flex-col gap-2 rounded-xl border border-relais/50 bg-relais/10 p-3">
              <NomRelaisInput value={draft.relais ?? ""} onChange={(relais) => setDraft({ ...draft, relais })} />
              <div className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-navy/70">Colis à déposer</span>
                <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => setDraft({ ...draft, colis: Math.max(0, (draft.colis ?? 0) - 1) })} aria-label="Un colis de moins">
                  −
                </button>
                <span className="w-8 text-center font-semibold tabular-nums">{draft.colis ?? 0}</span>
                <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => setDraft({ ...draft, colis: Math.min(500, (draft.colis ?? 0) + 1) })} aria-label="Un colis de plus">
                  +
                </button>
              </div>
              <p className="text-xs text-navy/60">Les colis scannés à l&apos;adresse du relais rejoignent cet arrêt.</p>
            </div>
          )}
          {draft.type === "ramasse" && (
            <label className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">
              <input type="checkbox" checked={draft.exceptionnelle === true} onChange={(e) => setDraft({ ...draft, exceptionnelle: e.target.checked })} className="mt-0.5" />
              <span><strong>Ramasse exceptionnelle</strong><span className="block text-xs text-navy/65">Ne pas ajouter cette adresse aux ramasses quotidiennes des prochaines tournées.</span></span>
            </label>
          )}
          <AdresseInput
            biais={depot}
            value={draft.adresse}
            onChange={(adresse) => setDraft((d) => (d ? { ...d, adresse, etablissement: null } : d))}
            onChoisir={(sug) =>
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      adresse: sug.adresse,
                      etablissement: sug.nom ? { nom: sug.nom, lat: sug.lat, lng: sug.lng } : null,
                      destinataire: d.destinataire.trim() ? d.destinataire : (sug.nom ?? ""),
                    }
                  : d,
              )
            }
            autoFocus={!lectureEtiquette}
          />
          {draft.etablissement && <p className="-mt-1 text-xs text-teal-ink">Établissement : {draft.etablissement.nom} — ses horaires seront cherchés après l&apos;ajout.</p>}
          <input className="input" value={draft.destinataire} onChange={(e) => setDraft({ ...draft, destinataire: e.target.value })} placeholder="Destinataire (facultatif)" aria-label="Destinataire" />
          <input
            className={`input ${normaliserTelephone(draft.telephone, pays) ? "" : "!border-orange ring-2 ring-orange/30"}`}
            type="tel"
            inputMode="tel"
            value={draft.telephone}
            onChange={(e) => setDraft({ ...draft, telephone: e.target.value })}
            placeholder="Téléphone du client"
            aria-label="Téléphone du client"
            aria-invalid={!normaliserTelephone(draft.telephone, pays)}
          />
          {!normaliserTelephone(draft.telephone, pays) && <AlerteSansTelephone />}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-navy/65">Poids</span>
            <input
              className="input !w-28"
              inputMode="decimal"
              value={draft.poids}
              onChange={(e) => setDraft({ ...draft, poids: e.target.value })}
              placeholder="ex. 2,5"
              aria-label="Poids du colis en kg"
            />
            <span className="text-navy/65">kg</span>
            {draft.poids.trim() && !lirePoids(draft.poids) && <span className="text-xs text-orange-ink">Poids non reconnu</span>}
          </label>
          <div className="rounded-xl border border-teal/25 bg-teal/5 p-3">
            <EtapeCreneau
              idBase="ajout-creneau"
              value={draft.creneau ?? CRENEAU_AUCUN}
              onChange={(creneau) => setDraft((d) => (d ? { ...d, creneau, creneauLu: false } : d))}
              fiche={ouverture.fiche}
              chargement={ouverture.chargement}
              ymd={jourTournee}
              quand={quandTournee}
              indication={draft.creneauLu ? "Lu sur l'étiquette" : null}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy !== null || draft.adresse.trim().length < 5 || !validerChoix(draft.creneau ?? CRENEAU_AUCUN).ok} onClick={() => ajouter(draft)}>
              {draft.type === "ramasse" ? "Ajouter la ramasse" : draft.type === "point_relais" ? "Ajouter au point relais" : "Ajouter à la tournée"}
            </button>
            {lectureEtiquette && (
              <button type="button" className="btn-secondary" disabled={busy === "photo"} onClick={() => fileRef.current?.click()}>
                <IconCamera className="h-4 w-4" /> {busy === "photo" ? "Lecture…" : "Lire l'étiquette"}
              </button>
            )}
          </div>
        </Card>
        </div>
      )}

      {(stops.length > 0 || multi) && (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg">{run.optimized_at ? "Ordre de passage" : "Colis chargés"}</h2>
              {sansTelephone > 0 && (
                <span className="rounded-full bg-orange/15 px-2 py-0.5 text-xs font-semibold text-orange-ink" title={ALERTE_SANS_TELEPHONE}>
                  {sansTelephone} arrêt{sansTelephone > 1 ? "s" : ""} sans téléphone
                </span>
              )}
            </div>
            {run.status !== "done" && pending.length > 1 && (
              <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={busy !== null} onClick={() => setFeuilleOptim(true)}>
                {busy === "optim" ? "Calcul…" : run.optimized_at ? "Réoptimiser" : "Optimiser l'ordre"}
              </button>
            )}
          </div>
          {resume && (
            <div className="px-4 pt-2 sm:px-5">
              <ResumeOptimisationCarte resume={resume} stops={stops} onFermer={() => setResume(null)} />
            </div>
          )}
          <ZoneTri ordre={ordreTri} onDeposer={deposer} actif={triActif}>
          <ol className="mt-2 divide-y divide-navy/[0.07]">
            {!rechercheAdresse && stops.length > 0 && <LigneExtremite type="depart" libelle={extremites.depart} onModifier={run.status !== "done" ? () => setFeuilleOptim(true) : undefined} />}
            {rechercheAdresse && groupes.length === 0 && <li className="px-4 py-6 text-center text-sm text-navy/60">Aucune adresse ne correspond à « {rechercheAdresse} ».</li>}
            {groupes.map((g, k) => (
              <Fragment key={g.liste?.id ?? "principale"}>
                {multi && enteteListe(g, k)}
                {multi && g.arrets.length === 0 && <li className="px-4 py-2.5 text-xs text-navy/55 sm:px-5">Liste vide : choisissez-la dans « Ajouter dans » pour y charger des colis.</li>}
                {g.arrets.map((s) => {
                  const i = stops.indexOf(s);
                  const rendu = (props: { ref?: (el: HTMLElement | null) => void; style?: CSSProperties } | null, poignee: Poignee | null) => (
                    <li key={s.id} ref={props?.ref} style={props?.style} className={`relative bg-surface py-2.5 pr-4 sm:pr-5 ${estMarque(s) ? "pl-5 sm:pl-6" : "pl-4 sm:pl-5"} ${s.status !== "pending" ? "opacity-55" : ""}`}>
                      <EncocheArret stop={s} />
                      <div className="flex items-start gap-3">
                        {triActif && <span className="-my-2.5 -ml-2 flex items-center">{poignee ? <BoutonPoignee poignee={poignee} libelle={s.address} /> : <span className="w-8" aria-hidden="true" />}</span>}
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                            s.status === "delivered" ? "bg-teal text-on-teal" : s.status === "failed" ? "bg-orange text-on-orange" : "bg-marine text-teal-sur-menu"
                          }`}
                        >
                          {s.status === "delivered" ? "✓" : s.status === "failed" ? "!" : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          {(estMarque(s) || (s.status === "pending" && !s.phone) || (s.status === "pending" && epingleDe(choix.depart, choix.arrivee, s.id))) && (
                            <div className="mb-1 flex flex-wrap gap-1">
                              {s.status === "pending" && epingleDe(choix.depart, choix.arrivee, s.id) && <BadgeEpingle role={epingleDe(choix.depart, choix.arrivee, s.id)!} />}
                              <BadgeArret stop={s} />
                              {s.status === "pending" && !s.phone && <BadgeSansTelephone />}
                            </div>
                          )}
                          <p className="text-sm font-semibold leading-snug">{s.address}</p>
                          <p className="text-xs text-navy/60">
                            {[
                              s.recipient,
                              s.phone,
                              s.parcel_count > 1 && `${s.parcel_count} colis`,
                              formatPoids(s.weight_kg),
                              estRamasse(s) && s.status !== "pending" && libelleStatut(s),
                              s.status === "delivered" && libellePreuve(s),
                              s.status === "failed" && libelleMotif(s.failure_reason),
                              s.lat === null && "⚠ adresse non localisée",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {s.status === "pending" && (
                            <BadgeHoraires
                              stop={s}
                              fenetres={horaires.fenetres.get(s.id) ?? null}
                              passage={run.optimized_at || enLivraison ? horaires.passages.get(s.id) : null}
                            />
                          )}
                        </div>
                        {s.phone && s.status === "pending" && (
                          <a href={lienTel(s.phone)} className="btn-ghost !px-2 !py-1 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address} (${s.phone})`}>
                            <IconPhone className="h-4 w-4" />
                          </a>
                        )}
                        {s.proof_photo_path && (
                          <a href={`/api/colis/arrets/${s.id}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs" aria-label={`Photo de livraison — ${s.address}`}>
                            📷 Photo
                          </a>
                        )}
                        {s.status !== "pending" && run.status !== "done" && (
                          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => statut(s, "pending")}>
                            Annuler
                          </button>
                        )}
                      </div>
                      {s.status === "pending" && run.status !== "done" && edition?.id !== s.id && (
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-9 text-xs">
                          {enLivraison && (
                            <button
                              type="button"
                              className="btn-secondary !px-3 !py-1 font-semibold"
                              onClick={() => setCloture({ stop: s, mode: "choix" })}
                              aria-label={`Clôturer ${s.address}`}
                            >
                              Clôturer
                            </button>
                          )}
                          {s.lat !== null && (
                            epingleDe(choix.depart, choix.arrivee, s.id) ? (
                              <button type="button" className="btn-ghost min-h-[44px] !px-3 sm:min-h-0 sm:!px-2 sm:!py-1" onClick={() => epingleArret(s, null)} aria-label={`Retirer l'épingle de ${s.address}`}>
                                Retirer 📌
                              </button>
                            ) : (
                              <>
                                <button type="button" className="btn-ghost min-h-[44px] !px-3 sm:min-h-0 sm:!px-2 sm:!py-1" onClick={() => epingleArret(s, "premier")} aria-label={`Mettre ${s.address} en premier`}>
                                  📌 En premier
                                </button>
                                <button type="button" className="btn-ghost min-h-[44px] !px-3 sm:min-h-0 sm:!px-2 sm:!py-1" onClick={() => epingleArret(s, "dernier")} aria-label={`Mettre ${s.address} en dernier`}>
                                  📌 En dernier
                                </button>
                              </>
                            )
                          )}
                          <button type="button" className="btn-ghost !px-2 !py-1" aria-label={`Monter ${s.address}`} onClick={() => deplacer(s, "haut")}>
                            ↑
                          </button>
                          <button type="button" className="btn-ghost !px-2 !py-1" aria-label={`Descendre ${s.address}`} onClick={() => deplacer(s, "bas")}>
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn-ghost !px-2 !py-1"
                            onClick={() =>
                              setEdition({
                                id: s.id,
                                adresse: s.address,
                                destinataire: s.recipient ?? "",
                                telephone: s.phone ?? "",
                                colis: s.parcel_count,
                                type: typeArret(s.kind),
                                poids: champPoids(s.weight_kg),
                                relais: s.relay_name ?? "",
                              })
                            }
                          >
                            Modifier
                          </button>
                          <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setHorairesStop(s)} aria-label={`Horaires — ${s.address}`}>
                            Horaires
                          </button>
                          <button type="button" className="btn-ghost !px-2 !py-1 text-orange-ink" onClick={() => supprimer(s)} aria-label={`Retirer ${s.address}`}>
                            Retirer
                          </button>
                          {multi && lists.length > 1 && (
                            <select
                              className="input !w-auto !px-2 !py-1 text-xs"
                              value=""
                              onChange={(e) => changerListe(s, e.target.value)}
                              aria-label={`Déplacer ${s.address} dans une autre liste`}
                            >
                              <option value="">Changer de liste…</option>
                              {lists
                                .filter((l) => l.id !== s.list_id)
                                .map((l) => (
                                  <option key={l.id} value={l.id}>
                                    → {l.name}
                                  </option>
                                ))}
                            </select>
                          )}
                        </div>
                      )}
                      {s.status === "pending" && run.status !== "done" && estRamasse(s) && (
                        <div className="mt-1 pl-9">
                          <button type="button" className="btn-secondary !px-3 !py-1 text-xs" onClick={async () => {
                            const valeur = prompt("Nombre de colis réellement ramassés", String(s.packages_picked_up ?? ""));
                            if (valeur === null || !valeur.trim()) return;
                            const nombre = Number(valeur);
                            if (!Number.isInteger(nombre) || nombre < 0 || nombre > 500) {
                              setToast({ ok: false, text: "Saisissez un nombre entier entre 0 et 500." });
                              return;
                            }
                            try {
                              await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ packages_picked_up: nombre }) });
                              await recharger(run.id);
                              setToast({ ok: true, text: `${nombre} colis ramassé(s) enregistré(s).` });
                            } catch (e) {
                              setToast({ ok: false, text: networkErrorMessage(e) });
                            }
                          }}>📦 Saisir les colis ramassés{s.packages_picked_up != null ? ` (${s.packages_picked_up})` : ""}</button>
                        </div>
                      )}
                      <HistoriqueArret stop={s} />
                      {edition?.id === s.id && (
                        // Fenêtre au-dessus de la page : plus besoin de chercher la ligne ouverte dans la liste.
                        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-label="Modifier l'adresse">
                        <div className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-2 overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
                          <ChoixTypeArret value={edition.type} onChange={(type) => setEdition({ ...edition, type })} />
                          {edition.type === "point_relais" && <NomRelaisInput value={edition.relais} onChange={(relais) => setEdition({ ...edition, relais })} />}
                          <AdresseInput biais={depot} value={edition.adresse} onChange={(adresse) => setEdition({ ...edition, adresse })} autoFocus />
                          <input
                            className="input"
                            value={edition.destinataire}
                            onChange={(e) => setEdition({ ...edition, destinataire: e.target.value })}
                            placeholder="Destinataire (facultatif)"
                            aria-label="Destinataire"
                          />
                          <input
                            className="input"
                            type="tel"
                            inputMode="tel"
                            value={edition.telephone}
                            onChange={(e) => setEdition({ ...edition, telephone: e.target.value })}
                            placeholder="Téléphone du client (facultatif)"
                            aria-label="Téléphone du client"
                          />
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-navy/65">Colis à cette adresse</span>
                            <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => setEdition({ ...edition, colis: Math.max(1, edition.colis - 1) })} aria-label="Un colis de moins">
                              −
                            </button>
                            <span className="w-6 text-center font-semibold tabular-nums">{edition.colis}</span>
                            <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => setEdition({ ...edition, colis: edition.colis + 1 })} aria-label="Un colis de plus">
                              +
                            </button>
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <span className="text-navy/65">Poids total</span>
                            <input
                              className="input !w-28"
                              inputMode="decimal"
                              value={edition.poids}
                              onChange={(e) => setEdition({ ...edition, poids: e.target.value })}
                              placeholder="—"
                              aria-label="Poids des colis en kg"
                            />
                            <span className="text-navy/65">kg</span>
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn-primary !py-2 text-sm" disabled={busy !== null || edition.adresse.trim().length < 5} onClick={enregistrerEdition}>
                              Enregistrer
                            </button>
                            <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => setEdition(null)}>
                              Annuler
                            </button>
                          </div>
                        </div>
                        </div>
                      )}
                    </li>
                  );
                  return triActif && s.status === "pending" ? <ArretTriable key={s.id} id={s.id} rendu={rendu} /> : rendu(null, null);
                })}
                {triActif && multi && <ZoneFinListe listId={g.liste?.id ?? null} className="h-2" />}
              </Fragment>
            ))}
            {!rechercheAdresse && stops.length > 0 && <LigneExtremite type="arrivee" libelle={extremites.arrivee} onModifier={run.status !== "done" ? () => setFeuilleOptim(true) : undefined} />}
          </ol>
          </ZoneTri>
        </Card>
      )}

      {pending.length > 0 && <ExportTournee run={run} stops={pending} listes={lists} />}

      {!enLivraison && run.status !== "done" && pending.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-paper via-paper to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:bg-none lg:p-0">
          <button type="button" className="btn-primary w-full !py-3.5 text-base" disabled={busy !== null} onClick={() => (integre && onDemarrer ? onDemarrer(run.id) : router.push("/livreur"))}>
            Vérifier la tournée et démarrer ({pending.length} arrêt{pending.length > 1 ? "s" : ""})
          </button>
        </div>
      )}
    </div>
  );
}
