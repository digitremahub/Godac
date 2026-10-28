import { NATURES, TEMPERATURES, type AttributsLus, type AttributsUnite, type Nature, type Temperature } from "@/lib/stock/attributs";
import { champsVisibles, type ChampStock, type Profil } from "@/lib/stock/profils";

/**
 * Formulaire d'entrée d'une unité (fichier pur, testé dans lib/stock/__tests__/formulaire.test.ts) :
 * valeurs saisies à l'écran → corps de la requête, uniquement pour les champs que le profil affiche.
 */

export interface ValeursForm {
  poids: string;
  volume: string;
  sscc: string;
  nature: Nature | "";
  nature_libelle: string;
  temperature: Temperature | "";
  temperature_libelle: string;
  temperature_releve: string;
  fragile: boolean;
  urgent: boolean;
  consigne: string;
  reference_client: string;
  lot: string;
  dlc: string;
}

/** Valeurs proposées d'office par le profil (nature, température, urgent). */
export function valeursInitiales(profil: Profil | null): ValeursForm {
  return {
    poids: "",
    volume: "",
    sscc: "",
    nature: profil?.defauts.nature && profil.champs.nature !== "masque" ? profil.defauts.nature : "",
    nature_libelle: "",
    temperature: profil?.defauts.temperature && profil.champs.temperature !== "masque" ? profil.defauts.temperature : "",
    temperature_libelle: "",
    temperature_releve: "",
    fragile: false,
    urgent: profil?.defauts.urgent && profil.champs.urgent !== "masque" ? true : false,
    consigne: "",
    reference_client: "",
    lot: "",
    dlc: "",
  };
}

const nombre = (v: string): number | null => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

export interface CorpsUnite {
  poids_kg?: number;
  volume_m3?: number;
  sscc?: string;
  attributs?: AttributsUnite;
}

/** Corps de la requête pour les champs visibles du profil ; un champ vide n'est pas envoyé. */
export function corpsDepuisValeurs(v: ValeursForm, profil: Profil | null): CorpsUnite {
  const visibles = new Set<ChampStock>(profil ? champsVisibles(profil) : []);
  const corps: CorpsUnite = {};
  if (visibles.has("poids")) {
    const p = nombre(v.poids);
    if (p !== null) corps.poids_kg = p;
  }
  if (visibles.has("volume")) {
    const m = nombre(v.volume);
    if (m !== null) corps.volume_m3 = m;
  }
  if (visibles.has("sscc") && v.sscc.trim()) corps.sscc = v.sscc.trim();
  const a: AttributsUnite = {};
  if (visibles.has("nature") && v.nature) {
    a.nature = v.nature;
    if (v.nature === "autre" && v.nature_libelle.trim()) a.nature_libelle = v.nature_libelle.trim();
  }
  if (visibles.has("temperature") && v.temperature) {
    a.temperature = v.temperature;
    if (v.temperature === "autre" && v.temperature_libelle.trim()) a.temperature_libelle = v.temperature_libelle.trim();
  }
  if (visibles.has("temperature_releve")) {
    const t = nombre(v.temperature_releve);
    if (t !== null) a.temperature_releve = t;
  }
  if (visibles.has("fragile") && v.fragile) a.fragile = true;
  if (visibles.has("urgent") && v.urgent) a.urgent = true;
  if (visibles.has("consigne") && v.consigne.trim()) a.consigne = v.consigne.trim();
  if (visibles.has("reference_client") && v.reference_client.trim()) a.reference_client = v.reference_client.trim();
  if (visibles.has("lot") && v.lot.trim()) a.lot = v.lot.trim();
  if (visibles.has("dlc") && v.dlc) a.dlc = v.dlc;
  if (Object.keys(a).length) corps.attributs = a;
  return corps;
}

/** Valeurs d'un formulaire à partir d'une unité existante (fiche d'unité). */
export function valeursDepuisUnite(u: Partial<AttributsLus> & { poids_kg?: number | null; volume_m3?: number | null; sscc?: string | null }): ValeursForm {
  return {
    poids: u.poids_kg == null ? "" : String(u.poids_kg).replace(".", ","),
    volume: u.volume_m3 == null ? "" : String(u.volume_m3).replace(".", ","),
    sscc: u.sscc ?? "",
    nature: u.nature && (NATURES as readonly string[]).includes(u.nature) ? u.nature : "",
    nature_libelle: u.nature_libelle ?? "",
    temperature: u.temperature && (TEMPERATURES as readonly string[]).includes(u.temperature) ? u.temperature : "",
    temperature_libelle: u.temperature_libelle ?? "",
    temperature_releve: u.temperature_releve == null ? "" : String(u.temperature_releve).replace(".", ","),
    fragile: Boolean(u.fragile),
    urgent: Boolean(u.urgent),
    consigne: u.consigne ?? "",
    reference_client: u.reference_client ?? "",
    lot: u.lot ?? "",
    dlc: u.dlc ?? "",
  };
}

/** Attributs à envoyer pour MODIFIER une unité : les champs vidés sont envoyés à null (effacés). */
export function attributsDeModification(v: ValeursForm, profil: Profil | null): AttributsUnite {
  const visibles = new Set<ChampStock>(profil ? champsVisibles(profil) : ["nature", "temperature", "temperature_releve", "fragile", "urgent", "consigne", "reference_client", "lot", "dlc"]);
  const a: AttributsUnite = {};
  if (visibles.has("nature")) {
    a.nature = v.nature || null;
    a.nature_libelle = v.nature === "autre" ? v.nature_libelle.trim() || null : null;
  }
  if (visibles.has("temperature")) {
    a.temperature = v.temperature || null;
    a.temperature_libelle = v.temperature === "autre" ? v.temperature_libelle.trim() || null : null;
  }
  if (visibles.has("temperature_releve")) a.temperature_releve = nombre(v.temperature_releve);
  if (visibles.has("fragile")) a.fragile = v.fragile;
  if (visibles.has("urgent")) a.urgent = v.urgent;
  if (visibles.has("consigne")) a.consigne = v.consigne.trim() || null;
  if (visibles.has("reference_client")) a.reference_client = v.reference_client.trim() || null;
  if (visibles.has("lot")) a.lot = v.lot.trim() || null;
  if (visibles.has("dlc")) a.dlc = v.dlc || null;
  return a;
}
