import { LIBELLES_CHAMP, type ChampStock } from "@/lib/stock/profils";

/**
 * Codes d'erreur des fonctions SQL du stock (message d'exception « stock_xxx »)
 * traduits en français, avec le statut HTTP à renvoyer. Fichier pur.
 */
export interface ErreurStock {
  code: string;
  message: string;
  status: number;
}

const TABLE: Record<string, { message: string; status: number }> = {
  stock_non_authentifie: { message: "Session expirée, reconnectez-vous.", status: 401 },
  stock_module_inactif: { message: "Le module Stock n'est pas activé.", status: 403 },
  stock_role_refuse: { message: "Votre rôle ne permet pas cette action.", status: 403 },
  stock_site_invalide: { message: "Dépôt introuvable ou hors de votre périmètre.", status: 404 },
  stock_emplacement_invalide: { message: "Emplacement introuvable dans ce dépôt, ou désactivé.", status: 400 },
  stock_emplacement_parent_invalide: { message: "Un emplacement se range dans une zone du même dépôt.", status: 400 },
  stock_article_invalide: { message: "Article introuvable ou désactivé.", status: 404 },
  stock_unite_inconnue: { message: "Code inconnu : aucune unité enregistrée sous ce code. Faites d'abord une entrée.", status: 404 },
  stock_type_unite_requis: { message: "Choisissez le type d'unité (colis ou palette) pour une première entrée.", status: 400 },
  stock_type_invalide: { message: "Type de mouvement inconnu.", status: 400 },
  stock_sens_invalide: { message: "Un ajustement doit indiquer s'il ajoute ou retire du stock.", status: 400 },
  stock_cible_invalide: { message: "Indiquez soit un code d'unité, soit un article.", status: 400 },
  stock_quantite_invalide: { message: "Quantité invalide.", status: 400 },
  stock_motif_requis: { message: "Indiquez le motif.", status: 400 },
  stock_motif_trop_long: { message: "Motif trop long.", status: 400 },
  stock_transition_interdite: { message: "Ce mouvement n'est pas possible dans l'état actuel de l'unité (déjà en dépôt, déjà livrée…).", status: 409 },
  stock_insuffisant: { message: "Stock insuffisant à cet emplacement (la quantité ne peut pas devenir négative).", status: 409 },
  stock_lot_requis: { message: "Cet article est suivi par lot : indiquez le numéro de lot.", status: 400 },
  stock_dlc_requise: { message: "Cet article est suivi par date limite : indiquez la DLC.", status: 400 },
  stock_transfert_identique: { message: "L'origine et la destination sont identiques.", status: 400 },
  stock_tournee_invalide: { message: "Tournée ou arrêt introuvable.", status: 404 },
  stock_cle_invalide: { message: "Clé d'idempotence invalide.", status: 400 },
  stock_source_invalide: { message: "Source de mouvement invalide.", status: 400 },
  stock_inventaire_en_cours: { message: "Un inventaire est déjà en cours pour ce dépôt et cette zone.", status: 409 },
  stock_inventaire_introuvable: { message: "Inventaire introuvable.", status: 404 },
  stock_inventaire_clos: { message: "Cet inventaire est clos : il ne peut plus être modifié.", status: 409 },
  stock_nombre_invalide: { message: "Indiquez un nombre de codes entre 1 et 500.", status: 400 },
  stock_limite_depassee: { message: "500 codes au plus par demande : faites plusieurs demandes.", status: 400 },
  stock_compteur_epuise: { message: "Le compteur de codes de l'année est épuisé (999 999 codes). Contactez GODAC.", status: 409 },
  stock_prefixe_invalide: { message: "Préfixe invalide : 2 à 6 caractères, lettres A-Z et chiffres seulement (ex. TRA).", status: 400 },
  stock_code_ambigu: { message: "Ce code désigne déjà une autre unité (code principal ou code interne) : un code ne peut identifier qu'une seule unité.", status: 409 },
  stock_code_interne_invalide: { message: "Ce n'est pas un code interne valide (format PREFIXE-AAAA-NNNNNN).", status: 400 },
  stock_code_interne_inconnu: { message: "Ce code interne n'a pas été généré pour votre entreprise : utilisez « Générer un code ».", status: 400 },
  stock_code_interne_deja: { message: "Cette unité a déjà un autre code interne.", status: 409 },
  stock_code_interne_entree_seulement: { message: "Un code interne se rattache à l'entrée d'une unité (ou depuis sa fiche).", status: 400 },
  stock_attribut_invalide: { message: "Un attribut (nature, température, consigne…) est invalide ou trop long.", status: 400 },
  stock_profil_invalide: { message: "Profil d'activité inconnu.", status: 400 },
  stock_registre_immuable: { message: "Le registre des mouvements ne peut pas être modifié.", status: 409 },
};

const SCHEMA_ABSENT = ["42883", "42P01", "PGRST202", "PGRST205", "PGRST200"];

/** Erreur renvoyée par supabase-js (rpc ou requête) → message français et statut. */
export function traduireErreurStock(erreur: { code?: string | null; message?: string | null } | null | undefined): ErreurStock {
  const message = erreur?.message ?? "";
  const trouve = /stock_[a-z_]+/.exec(message)?.[0];
  if (trouve && TABLE[trouve]) return { code: trouve, ...TABLE[trouve]! };
  const requis = /^stock_champ_requis_([a-z_]+)$/.exec(trouve ?? "");
  if (requis) {
    const champ = requis[1] as ChampStock;
    const libelle = LIBELLES_CHAMP[champ] ?? requis[1];
    return { code: "stock_champ_requis", message: `Le champ « ${libelle} » est obligatoire pour ce profil d'activité.`, status: 400 };
  }
  if (erreur?.code && SCHEMA_ABSENT.includes(erreur.code)) {
    return { code: "stock_schema_absent", message: "Le module Stock n'est pas encore installé sur la base (mise à jour en attente).", status: 503 };
  }
  if (erreur?.code === "23505" && /code_interne|stock_unites_organization_id_code_key/.test(message)) return { code: "stock_code_ambigu", ...TABLE.stock_code_ambigu! };
  if (erreur?.code === "23505") return { code: "stock_doublon", message: "Cette valeur existe déjà.", status: 409 };
  if (erreur?.code === "23514") return { code: "stock_valeur_invalide", message: "Valeur refusée par les contrôles de la base.", status: 400 };
  return { code: "stock_erreur", message: "Enregistrement impossible, réessayez.", status: 500 };
}

/** La table ou la fonction du stock n'existe pas encore (migrations non appliquées). */
export function schemaStockAbsent(erreur: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return Boolean(erreur?.code && SCHEMA_ABSENT.includes(erreur.code)) || /could not find the (function|table)|relation .*stock_.* does not exist/i.test(erreur?.message ?? "");
}
