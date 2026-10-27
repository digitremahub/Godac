// Catalogue unique des écrans de l'espace connecté : section, libellé,
// URL, rôles, modules. Le menu (Sidebar, barre mobile), les gardes de
// page (lib/acces/garde-page.tsx), les gardes d'API (lib/acces/garde-api.ts)
// et les tests s'en servent tous : plus aucune liste de rôles dupliquée.
//
// Fichier pur (aucune dépendance serveur) : importable côté client.
//
// Lot 1-2 du plan de réorganisation : les URL sont encore les URL
// ACTUELLES. Les déplacements (/flotte/…, /moi/…) et les redirections
// arrivent au lot 3.
//
// Règle d'or : le catalogue ne doit jamais être plus permissif que la
// RLS. Il sert l'expérience (pas d'écran trompeur) et le revenu (module
// payant) ; la RLS reste l'autorité sur les données.

import { ECRANS_GO_NAVIGATION } from "@/lib/go-navigation/offre";
import type { UserRole } from "@/lib/types/domain";

export const TOUS_LES_ROLES: readonly UserRole[] = ["chauffeur", "manager", "exploitation", "comptable", "direction"];
/**
 * Encadrement : manager (ses services), exploitation (toute l'organisation,
 * sans paie, facturation, réglages ni audit), direction (tout).
 * Voir lib/roles/perimetre.ts.
 */
export const ENCADREMENT: readonly UserRole[] = ["manager", "exploitation", "direction"];
/**
 * Rôles « terrain » : chauffeur, et manager ou exploitation qui conduit
 * aussi (users.can_drive). Les écrans marqués `conducteur` exigent en plus
 * que la personne conduise : un manager sans can_drive en est exclu.
 */
export const TERRAIN: readonly UserRole[] = ["chauffeur", "manager", "exploitation"];

/** Clés réelles de la table `modules` qui correspondent à du code. */
export const MODULES_AVEC_CODE = [
  "fuel_tracking",
  "ocr",
  "fleet",
  "planning",
  "intranet",
  "leave_management",
  "push_notifications",
  "alerts",
  "admin",
  "auth_onboarding",
  "employee_files",
  "payslips",
  "hr_status",
  "maintenance_requests",
  "messenger",
  "time_clock",
  "bi_reporting",
  "ticpe_export",
  "washes",
  "assistant",
  "fines",
  "route_optimizer",
  "customer_disputes",
  "rental_providers",
] as const;
export type CleModule = (typeof MODULES_AVEC_CODE)[number];

/**
 * Modules présents dans la table `modules` mais sans aucune
 * fonctionnalité dans le code (décision client Q7) : retirés de la vente
 * et de l'onglet Modules. Les lignes en base ne sont pas supprimées.
 */
export const MODULES_SANS_CODE = [
  "planning_v2",
  "hr_status_v2",
  "fuel_station_prices",
  "freight_return_trips",
  "subcontract_requests",
  "tachograph",
  "gdpr_advanced",
  "fleet_full",
  "route_optimization",
  "mobile_app",
] as const;

/** Modules socle, toujours actifs, jamais proposés à l'activation. */
export const MODULES_SOCLE: readonly string[] = ["fuel_tracking", "alerts", "admin", "auth_onboarding"];

export function estModuleSansCode(cle: string): boolean {
  return (MODULES_SANS_CODE as readonly string[]).includes(cle);
}

/** Vendable = a du code, n'est pas de la vague v3 et n'est pas un module socle. */
export function estModuleVendable(m: { key: string; wave?: string | null }): boolean {
  return m.wave !== "v3" && !estModuleSansCode(m.key);
}

export const LIBELLES_MODULES: Record<CleModule, string> = {
  fuel_tracking: "Suivi carburant",
  ocr: "OCR tickets carburant",
  fleet: "Gestion de flotte",
  planning: "Planning par service",
  intranet: "Intranet & convocations",
  leave_management: "Congés & absences",
  push_notifications: "Notifications push",
  alerts: "Alertes & notifications",
  admin: "Administration",
  auth_onboarding: "Authentification",
  employee_files: "Dossiers employés",
  payslips: "Fiches de paie",
  hr_status: "Statuts RH automatiques",
  maintenance_requests: "Demandes d'entretien",
  messenger: "Messenger",
  time_clock: "Pointeuse",
  bi_reporting: "Reporting BI",
  ticpe_export: "Export TICPE",
  washes: "Lavage",
  assistant: "Assistant & relais humain",
  fines: "Suivi des amendes",
  route_optimizer: "Tournée colis",
  customer_disputes: "Contestations clients",
  rental_providers: "Véhicules loués",
};

export function libelleModule(cle: string): string {
  return (LIBELLES_MODULES as Record<string, string>)[cle] ?? cle;
}

export type FormuleMin = "essentiel" | "starter" | "pro" | "business";

export type SectionId = "dashboard" | "moi" | "exploitation" | "flotte" | "carburant" | "equipe" | "communication" | "admin" | "aide";

export const SECTIONS: readonly { id: SectionId; libelle: string }[] = [
  { id: "dashboard", libelle: "Tableau de bord" },
  { id: "moi", libelle: "Mon espace" },
  { id: "exploitation", libelle: "Exploitation" },
  { id: "flotte", libelle: "Flotte" },
  { id: "carburant", libelle: "Carburant" },
  { id: "equipe", libelle: "Équipe & RH" },
  { id: "communication", libelle: "Communication" },
  { id: "admin", libelle: "Administration" },
  { id: "aide", libelle: "Aide" },
];

export type IconeId =
  | "grid"
  | "chart"
  | "clock"
  | "flag"
  | "users"
  | "calendar"
  | "truck"
  | "file"
  | "coins"
  | "wrench"
  | "map"
  | "qr"
  | "building"
  | "droplet"
  | "camera"
  | "cylinder"
  | "megaphone"
  | "chat"
  | "bell"
  | "lifebuoy"
  | "card"
  | "shield"
  | "navigation"
  | "user";

export interface Ecran {
  /** Identifiant stable, utilisé par garderPage() et les tests. */
  id: string;
  section: SectionId;
  libelle: string;
  /** URL actuelle (lot 3 : URL françaises). Peut contenir une requête. */
  href: string;
  /** Rôles autorisés à ouvrir l'écran (garde de page). */
  roles: readonly UserRole[];
  /**
   * Réservé aux personnes qui conduisent : chauffeur, ou manager avec
   * can_drive (lib/roles/conducteurs.ts).
   */
  conducteur?: boolean;
  /** Rôles qui voient l'entrée dans le menu (par défaut : `roles`). */
  rolesMenu?: readonly UserRole[];
  /**
   * Entrée de menu réservée aux personnes qui conduisent (l'écran reste
   * ouvert par URL ou QR aux autres rôles de `roles`).
   */
  menuConducteur?: boolean;
  /** Modules tous requis (ET). */
  modules?: readonly CleModule[];
  /** Au moins un de ces modules (OU). */
  modulesAuMoinsUn?: readonly CleModule[];
  /** Entrée masquée quand ce module est actif (une autre la remplace). */
  saufModule?: CleModule;
  /** Formule à partir de laquelle le module est inclus (indicatif). */
  formuleMin?: FormuleMin;
  /**
   * "cache" : page accessible mais sans entrée de menu ni onglet (fiche,
   * formulaire…) ; "onglet" : onglet de sa section, sans entrée dans le
   * menu latéral.
   */
  menu?: "section" | "onglet" | "cache";
  /**
   * Écran parent (sous-onglet) : quand le parent est visible, cet écran
   * n'a ni entrée de menu ni onglet de section ; il apparaît dans la
   * barre de sous-onglets du parent. Sinon il remonte à sa place.
   */
  parent?: string;
  /** Libellé court de l'onglet de section et du menu (par défaut : `libelle`). */
  libelleOnglet?: string;
  /** Libellé dans la barre de sous-onglets (par défaut : `libelle`). */
  libelleSousOnglet?: string;
  /** Visible dans le tiroir « Plus » de la barre mobile chauffeur. */
  mobile?: "barre" | "plus";
  icone: IconeId;
  /** Préfixes d'URL qui allument aussi cette entrée. */
  aussiActif?: readonly string[];
  /**
   * Redirection plutôt qu'un refus pour un rôle donné (ex. un chauffeur
   * qui ouvre /fines depuis une alerte → ses propres amendes).
   */
  alternative?: Partial<Record<UserRole, string>>;
  /**
   * Droit par personne (et non par rôle) : pseudo-module à trouver parmi les
   * modules actifs, ajouté côté serveur (lib/acces/modules-requete.ts) aux
   * personnes autorisées. Ex. DROIT_PARTAGE_GO.
   */
  droit?: string;
  /** Restriction supplémentaire faite par la page (texte pour la matrice). */
  note?: string;
  /**
   * Section du menu latéral pour ces rôles, quand elle diffère de la
   * section de l'URL (ex. Registre du personnel rangé dans
   * Administration pour la direction). Les onglets de section et l'URL
   * ne changent pas.
   */
  sectionMenu?: Partial<Record<UserRole, SectionId>>;
}

const E = (e: Ecran) => e;

/**
 * Pseudo-module « Faire essayer GO » : ajouté aux modules actifs de la
 * direction (toujours), des personnes désignées par elle et, si elle l'a
 * activé, de toute l'équipe (lib/partage-go/serveur.ts). Jamais ajouté aux
 * comptes d'essai GO Navigation.
 */
export const DROIT_PARTAGE_GO = "droit:partage_go";

export const ECRANS: readonly Ecran[] = [
  // ── Tableau de bord ──────────────────────────────────────────────
  E({ id: "dashboard.accueil", section: "dashboard", libelle: "Tableau de bord", libelleOnglet: "Aujourd'hui", href: "/dashboard", roles: TOUS_LES_ROLES, icone: "grid" }),
  E({
    id: "partage.go",
    section: "dashboard",
    libelle: "Faire essayer GO",
    href: "/partage-go",
    roles: TOUS_LES_ROLES,
    droit: DROIT_PARTAGE_GO,
    icone: "megaphone",
    note: "direction par défaut ; ouvert par la direction à des personnes désignées ou à toute l'équipe",
  }),
  E({
    id: "dashboard.a_traiter",
    section: "dashboard",
    libelle: "À traiter aujourd'hui",
    libelleOnglet: "À traiter",
    href: "/dashboard/a-traiter",
    roles: ["manager", "exploitation", "direction"],
    icone: "flag",
    // Onglet du Tableau de bord (et aperçu sur l'accueil) : pas d'entrée de plus dans le menu latéral.
    menu: "onglet",
    note: "exploitation et direction : toute l'entreprise ; manager : ses services (carburant, entretien, congés, tournées) ; triée par urgence ; actions groupées ; jamais ses propres demandes (hiérarchie)",
  }),
  E({ id: "dashboard.reporting", section: "dashboard", libelle: "Reporting BI", href: "/dashboard/reporting", roles: ["direction", "exploitation", "comptable"], modules: ["bi_reporting"], icone: "chart", note: "exploitation et comptable : carburant et tournées, sans paie" }),

  // ── Mon espace ───────────────────────────────────────────────────
  E({
    id: "moi.tournee_depart",
    section: "moi",
    // Glossaire : « Départ / Retour » = prise et fin de poste avec le
    // véhicule ; « Tournée » = l'affectation du planning (n° T106).
    libelle: "Départ",
    libelleOnglet: "Départ / Retour",
    libelleSousOnglet: "Départ",
    href: "/moi/tournee/depart",
    roles: TERRAIN,
    conducteur: true,
    modules: ["planning"],
    icone: "flag",
    mobile: "barre",
  }),
  E({
    id: "moi.tournee_retour",
    section: "moi",
    libelle: "Retour",
    libelleSousOnglet: "Retour",
    href: "/moi/tournee/retour",
    roles: TERRAIN,
    conducteur: true,
    modules: ["planning"],
    icone: "flag",
    mobile: "barre",
    parent: "moi.tournee_depart",
  }),
  E({
    id: "moi.tournee_collegue",
    section: "moi",
    libelle: "Départ ou retour d'un collègue",
    libelleSousOnglet: "Pour un collègue",
    href: "/moi/tournee/collegue",
    roles: ["chauffeur", "manager", "exploitation", "direction"],
    rolesMenu: ["chauffeur", "manager", "exploitation"],
    // Sous-onglet de Départ / Retour pour qui conduit ; l'encadrement qui
    // ne conduit pas l'ouvre depuis le Suivi en direct (« Saisir un départ
    // ou un retour »), plus du Planning ni en tête de son Mon espace.
    menuConducteur: true,
    modules: ["planning"],
    icone: "users",
    mobile: "plus",
    parent: "moi.tournee_depart",
  }),
  E({
    id: "moi.tournee_colis",
    section: "moi",
    libelle: "Ma tournée colis",
    // Point d'entrée unique du conducteur (lot 3 de l'audit d'ergonomie) :
    // préparer (scan, bordereau, adresses), démarrer, livrer (GO
    // Navigation), clôturer. App plein écran, hors de l'espace à menu.
    href: "/livreur",
    roles: TERRAIN,
    conducteur: true,
    modules: ["route_optimizer"],
    icone: "qr",
    mobile: "barre",
    // L'encadrement qui ne conduit pas prépare et affecte dans Exploitation.
    alternative: { manager: "/exploitation/colis", exploitation: "/exploitation/colis", direction: "/exploitation/colis" },
    note: "sa tournée colis : préparer, démarrer, livrer, clôturer",
  }),
  E({ id: "moi.planning", section: "moi", libelle: "Mon planning", href: "/moi/planning", roles: TERRAIN, conducteur: true, modules: ["planning"], icone: "calendar", mobile: "plus" }),
  E({ id: "moi.vehicule", section: "moi", libelle: "Mon véhicule", href: "/moi/vehicule", roles: TERRAIN, conducteur: true, icone: "truck", mobile: "plus" }),
  E({
    id: "moi.signaler",
    section: "moi",
    libelle: "Signaler un problème",
    href: "/moi/signaler",
    // Tout rôle qui conduit ou reçoit un véhicule peut signaler (QR véhicule).
    roles: ["chauffeur", "manager", "exploitation", "direction"],
    // Au menu de toute personne qui conduit (chauffeur, manager ou
    // exploitation avec « conduit aussi ») ; l'encadrement qui ne conduit
    // pas traite les demandes dans Flotte › Entretien.
    rolesMenu: TERRAIN,
    menuConducteur: true,
    modules: ["maintenance_requests"],
    icone: "wrench",
    mobile: "plus",
  }),
  E({ id: "moi.amendes", section: "moi", libelle: "Mes amendes", href: "/moi/amendes", roles: TERRAIN, conducteur: true, modules: ["fines"], icone: "file", mobile: "plus" }),
  E({
    id: "moi.fiches_paie",
    section: "moi",
    libelle: "Mes fiches de paie",
    href: "/moi/fiches-de-paie",
    roles: ["chauffeur", "manager", "exploitation", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    mobile: "plus",
    alternative: { direction: "/equipe/paie/fiches" },
    note: "ses bulletins validés seulement",
  }),
  E({
    id: "moi.acomptes",
    section: "moi",
    libelle: "Demander un acompte",
    href: "/moi/acomptes",
    roles: ["chauffeur", "manager", "exploitation", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    mobile: "plus",
    alternative: { direction: "/equipe/paie/acomptes" },
    note: "déduit ensuite du bulletin du mois",
  }),
  E({
    id: "moi.pointage",
    section: "moi",
    libelle: "Mon pointage",
    href: "/moi/pointage",
    roles: ["chauffeur", "manager", "exploitation", "comptable"],
    modules: ["time_clock"],
    icone: "clock",
    mobile: "plus",
    alternative: { direction: "/equipe/pointage" },
  }),
  E({
    id: "moi.conges",
    section: "moi",
    libelle: "Mes congés",
    href: "/moi/conges",
    roles: ["chauffeur", "manager", "exploitation", "comptable"],
    modules: ["leave_management"],
    icone: "calendar",
    mobile: "plus",
    alternative: { direction: "/equipe/conges" },
  }),
  E({
    id: "moi.arrets",
    section: "moi",
    libelle: "Mes arrêts de travail",
    libelleOnglet: "Arrêts",
    href: "/moi/arrets",
    // Obligation du salarié (avis sous 48 h) : aucun module requis.
    roles: ["chauffeur", "manager", "exploitation", "comptable"],
    icone: "file",
    mobile: "plus",
    alternative: { direction: "/equipe/conges/arrets" },
    note: "déclarer un arrêt (photo des volets employeur), suivre son statut",
  }),

  // ── Exploitation ─────────────────────────────────────────────────
  E({
    id: "exploitation.planning",
    section: "exploitation",
    libelle: "Planning",
    href: "/exploitation/planning",
    roles: ENCADREMENT,
    modules: ["planning"],
    icone: "calendar",
    alternative: { chauffeur: "/moi/planning" },
  }),
  E({
    id: "exploitation.tournees",
    section: "exploitation",
    // Glossaire : « Modèle de tournée » = la tournée-modèle (numéro,
    // villages, ramasses, points relais), pas l'affectation du jour.
    libelle: "Modèles de tournées & villages",
    libelleOnglet: "Modèles de tournées",
    href: "/exploitation/tournees",
    roles: ["direction", "manager", "exploitation", "chauffeur"],
    modulesAuMoinsUn: ["planning", "route_optimizer"],
    icone: "map",
    note: "chauffeur : lecture",
  }),
  E({
    id: "exploitation.colis",
    section: "exploitation",
    libelle: "Préparation des tournées colis",
    libelleOnglet: "Tournées colis",
    href: "/exploitation/colis",
    // Écran de préparation et d'affectation de l'encadrement. Le
    // chauffeur passe par « Ma tournée colis » (/livreur), qui contient
    // la même préparation : l'ancienne adresse l'y renvoie.
    roles: ENCADREMENT,
    modules: ["route_optimizer"],
    icone: "qr",
    alternative: { chauffeur: "/livreur" },
    note: "manager ou exploitation qui conduit : aussi sa propre tournée colis",
  }),
  E({
    id: "exploitation.go_navigation",
    section: "exploitation",
    libelle: "GO Navigation",
    // App chauffeur plein écran (hors de l'espace à menu) : carte et trajet
    // vers l'arrêt en cours. Avant-première (décision client).
    href: "/livreur/navigation",
    roles: TERRAIN,
    conducteur: true,
    modules: ["route_optimizer"],
    icone: "navigation",
    note: "avant-première ; tournée colis démarrée",
  }),
  E({
    id: "exploitation.en_cours",
    section: "exploitation",
    libelle: "Tournées en cours",
    href: "/exploitation/en-cours",
    roles: ENCADREMENT,
    modulesAuMoinsUn: ["planning", "route_optimizer"],
    icone: "map",
    note: "toutes les tournées démarrées (colis et planning) ; manager : ses services ; exploitation, direction : toute l'organisation",
  }),
  E({
    id: "exploitation.cloture",
    section: "exploitation",
    libelle: "Clôture de la journée",
    href: "/exploitation/cloture",
    roles: ENCADREMENT,
    modulesAuMoinsUn: ["planning", "route_optimizer"],
    icone: "flag",
    note: "ce qui reste à boucler le soir ; manager : ses services ; exploitation, direction : toute l'organisation",
  }),
  E({ id: "exploitation.suivi", section: "exploitation", libelle: "Suivi en direct", href: "/exploitation/suivi", roles: ENCADREMENT, modules: ["route_optimizer"], icone: "map" }),
  E({
    id: "exploitation.historique",
    section: "exploitation",
    libelle: "Historique des tournées",
    libelleOnglet: "Historique",
    libelleSousOnglet: "Tournées",
    href: "/exploitation/historique",
    roles: TOUS_LES_ROLES,
    modules: ["planning"],
    icone: "file",
    note: "chauffeur : soi ; comptable : lecture",
  }),
  E({
    id: "exploitation.rapports",
    section: "exploitation",
    libelle: "Rapports de tournée",
    libelleSousOnglet: "Rapports",
    href: "/exploitation/historique/rapports",
    roles: ["direction", "manager", "exploitation", "comptable"],
    modules: ["planning"],
    icone: "file",
    parent: "exploitation.historique",
    alternative: { chauffeur: "/exploitation/historique" },
    note: "comptable : lecture",
  }),
  E({
    id: "exploitation.rapports_photos",
    section: "exploitation",
    libelle: "Photos de tournée",
    libelleSousOnglet: "Photos",
    href: "/exploitation/historique/photos",
    roles: ["direction", "manager", "exploitation", "comptable"],
    modules: ["planning"],
    icone: "camera",
    parent: "exploitation.historique",
    alternative: { chauffeur: "/exploitation/historique" },
  }),
  E({
    id: "exploitation.historique_colis",
    section: "exploitation",
    libelle: "Tournées colis passées",
    libelleSousOnglet: "Tournées colis",
    href: "/exploitation/historique/colis",
    roles: ["direction", "manager", "exploitation", "chauffeur"],
    modules: ["route_optimizer"],
    icone: "qr",
    parent: "exploitation.historique",
    note: "chauffeur : les siennes",
  }),
  E({
    id: "exploitation.contestations",
    section: "exploitation",
    libelle: "Contestations clients",
    libelleOnglet: "Contestations",
    href: "/exploitation/contestations",
    roles: ["direction", "manager", "exploitation", "chauffeur"],
    // Le chauffeur retrouve les siennes dans Mon espace › Mes documents.
    rolesMenu: ENCADREMENT,
    modules: ["customer_disputes"],
    icone: "file",
    note: "chauffeur : les siennes",
  }),

  // ── Flotte ───────────────────────────────────────────────────────
  E({
    id: "flotte.vehicules",
    section: "flotte",
    libelle: "Véhicules",
    href: "/flotte/vehicules",
    roles: ["direction", "manager", "exploitation", "comptable"],
    modules: ["fleet"],
    icone: "truck",
    alternative: { chauffeur: "/moi/vehicule" },
    note: "comptable : lecture",
  }),
  E({
    id: "flotte.vehicule_fiche",
    section: "flotte",
    libelle: "Fiche véhicule",
    href: "/flotte/vehicules/[id]",
    roles: ["direction", "manager", "exploitation", "comptable"],
    modules: ["fleet"],
    icone: "truck",
    menu: "cache",
    alternative: { chauffeur: "/moi/vehicule" },
  }),
  E({ id: "flotte.vehicule_nouveau", section: "flotte", libelle: "Nouveau véhicule", href: "/flotte/vehicules/nouveau", roles: ENCADREMENT, modules: ["fleet"], icone: "truck", menu: "cache" }),
  E({
    id: "flotte.actions_vehicule",
    section: "flotte",
    libelle: "Actions rapides véhicule (QR)",
    href: "/v/[id]",
    roles: TOUS_LES_ROLES,
    icone: "qr",
    menu: "cache",
  }),
  E({
    id: "flotte.entretien",
    section: "flotte",
    libelle: "Demandes d'entretien",
    libelleOnglet: "Entretien",
    href: "/flotte/entretien",
    roles: ENCADREMENT,
    modules: ["maintenance_requests"],
    icone: "wrench",
    alternative: { chauffeur: "/moi/signaler" },
  }),
  E({
    id: "flotte.loueurs_demandes",
    section: "flotte",
    libelle: "Demandes aux loueurs",
    libelleOnglet: "Loueurs",
    libelleSousOnglet: "Demandes",
    href: "/flotte/loueurs",
    roles: ENCADREMENT,
    modules: ["rental_providers"],
    formuleMin: "pro",
    icone: "building",
  }),
  E({
    id: "flotte.loueurs",
    section: "flotte",
    libelle: "Loueurs & prestataires",
    libelleSousOnglet: "Prestataires",
    href: "/flotte/loueurs/prestataires",
    roles: ENCADREMENT,
    modules: ["rental_providers"],
    formuleMin: "pro",
    icone: "building",
    parent: "flotte.loueurs_demandes",
  }),
  E({
    id: "flotte.amendes",
    section: "flotte",
    libelle: "Amendes",
    href: "/flotte/amendes",
    roles: ["direction", "manager", "exploitation", "comptable"],
    modules: ["fines"],
    icone: "file",
    alternative: { chauffeur: "/moi/amendes" },
    note: "manager : son service ; exploitation : toute l'organisation ; comptable : lecture",
  }),
  // Usage rare pour la direction (impression des badges) : rangé dans Administration.
  E({ id: "flotte.badges", section: "flotte", libelle: "Badges QR", href: "/flotte/badges", roles: ENCADREMENT, icone: "qr", sectionMenu: { direction: "admin" } }),

  // ── Carburant ────────────────────────────────────────────────────
  E({ id: "carburant.pleins", section: "carburant", libelle: "Pleins", href: "/carburant/pleins", roles: TOUS_LES_ROLES, icone: "droplet", note: "chauffeur : ses pleins" }),
  E({ id: "carburant.revue_ocr", section: "carburant", libelle: "Tickets à vérifier", href: "/carburant/revue-ocr", roles: ENCADREMENT, modules: ["ocr"], icone: "camera" }),
  E({
    id: "carburant.cuves",
    section: "carburant",
    libelle: "Cuves",
    href: "/carburant/cuves",
    roles: ["direction", "manager", "exploitation", "comptable"],
    icone: "cylinder",
    aussiActif: ["/carburant/approvisionnements"],
  }),
  E({
    id: "carburant.approvisionnements",
    section: "carburant",
    libelle: "Approvisionnements",
    href: "/carburant/approvisionnements",
    roles: ["direction", "manager", "exploitation", "comptable"],
    menu: "onglet",
    icone: "cylinder",
  }),
  E({
    id: "carburant.ticpe",
    section: "carburant",
    libelle: "TICPE",
    libelleSousOnglet: "Tableau de bord",
    href: "/carburant/ticpe",
    roles: ["direction", "exploitation", "comptable"],
    modules: ["ticpe_export"],
    icone: "file",
    note: "exploitation : lecture et export ; déclarations marquées par la direction ou le comptable",
  }),
  E({
    id: "carburant.ticpe_documents",
    section: "carburant",
    libelle: "Documents TICPE",
    libelleSousOnglet: "Documents",
    href: "/carburant/ticpe/documents",
    roles: ["direction", "exploitation", "comptable"],
    modules: ["ticpe_export"],
    icone: "file",
    parent: "carburant.ticpe",
    note: "récapitulatif 3310-TIC, état récapitulatif annuel (ERA), dossier de contrôle",
  }),
  E({ id: "carburant.ticpe_detail", section: "carburant", libelle: "Détail export TICPE", href: "/carburant/ticpe/[id]", roles: ["direction", "exploitation", "comptable"], modules: ["ticpe_export"], icone: "file", menu: "cache" }),
  E({
    id: "carburant.ticpe_controles",
    section: "carburant",
    libelle: "TICPE : à régler",
    libelleSousOnglet: "À régler",
    href: "/carburant/ticpe/controles",
    roles: ["direction", "exploitation", "comptable"],
    modules: ["ticpe_export"],
    icone: "flag",
    parent: "carburant.ticpe",
    note: "contrôles avant déclaration (bloquants, avertissements)",
  }),
  E({
    id: "carburant.ticpe_vehicules",
    section: "carburant",
    libelle: "Véhicules TICPE",
    libelleSousOnglet: "Véhicules",
    href: "/carburant/ticpe/vehicules",
    roles: ["direction", "exploitation", "comptable"],
    modules: ["ticpe_export"],
    icone: "truck",
    parent: "carburant.ticpe",
    note: "éligibilité datée et expliquée, véhicules à régulariser",
  }),
  E({
    id: "carburant.ticpe_reglages",
    section: "carburant",
    libelle: "Réglages TICPE",
    libelleSousOnglet: "Réglages",
    href: "/carburant/ticpe/reglages",
    roles: ["direction", "comptable"],
    modules: ["ticpe_export"],
    icone: "file",
    parent: "carburant.ticpe",
    note: "activités, régime de TVA, plafond, barème et taux particuliers",
  }),

  // ── Équipe & RH ──────────────────────────────────────────────────
  E({
    id: "equipe.utilisateurs",
    section: "equipe",
    libelle: "Utilisateurs",
    href: "/equipe/utilisateurs",
    roles: ENCADREMENT,
    icone: "users",
    note: "manager : lecture de son service ; exploitation : comptes chauffeur et manager",
  }),
  E({
    id: "equipe.utilisateur_fiche",
    section: "equipe",
    libelle: "Fiche salarié",
    href: "/equipe/utilisateurs/[id]",
    roles: ["direction", "manager", "exploitation", "comptable"],
    icone: "users",
    menu: "cache",
  }),
  E({ id: "equipe.inscriptions", section: "equipe", libelle: "Chauffeurs à valider", libelleOnglet: "Inscriptions", href: "/equipe/inscriptions", roles: ENCADREMENT, icone: "users" }),
  E({
    id: "equipe.pointage",
    section: "equipe",
    libelle: "Pointage",
    href: "/equipe/pointage",
    roles: ENCADREMENT,
    modules: ["time_clock"],
    icone: "clock",
    alternative: { chauffeur: "/moi/pointage", comptable: "/moi/pointage" },
    note: "manager : son service ; exploitation : toute l'organisation",
  }),
  E({
    id: "equipe.conges",
    section: "equipe",
    libelle: "Congés & absences",
    libelleOnglet: "Congés",
    libelleSousOnglet: "Demandes",
    href: "/equipe/conges",
    roles: ENCADREMENT,
    modules: ["leave_management"],
    icone: "calendar",
    alternative: { chauffeur: "/moi/conges", comptable: "/moi/conges" },
  }),
  E({
    id: "equipe.conges_calendrier",
    section: "equipe",
    libelle: "Calendrier des congés",
    libelleSousOnglet: "Calendrier",
    href: "/equipe/conges/calendrier",
    roles: ENCADREMENT,
    modules: ["leave_management"],
    icone: "calendar",
    parent: "equipe.conges",
    note: "manager : son service ; exploitation : toute l'organisation",
  }),
  E({
    id: "equipe.arrets",
    section: "equipe",
    libelle: "Arrêts de travail",
    libelleOnglet: "Arrêts",
    libelleSousOnglet: "Arrêts de travail",
    href: "/equipe/conges/arrets",
    // Aucun module requis ; sous-onglet de Congés & absences quand le module est actif.
    roles: [...ENCADREMENT, "comptable"],
    icone: "file",
    parent: "equipe.conges",
    alternative: { chauffeur: "/moi/arrets" },
    note: "manager : son service ; exploitation, direction, comptable : toute l'organisation",
  }),
  E({
    id: "equipe.paie",
    section: "equipe",
    libelle: "Paie & salaires",
    libelleOnglet: "Paie",
    libelleSousOnglet: "Bulletins du mois",
    href: "/equipe/paie",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    note: "comptable : prépare, la direction valide",
  }),
  E({
    id: "equipe.paie_preparer",
    section: "equipe",
    libelle: "Préparer la paie du mois",
    libelleSousOnglet: "Préparer le mois",
    href: "/equipe/paie/preparer",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    parent: "equipe.paie",
    note: "tous les bulletins en un clic, comparaison au mois précédent, anomalies ; la direction valide",
  }),
  E({
    id: "equipe.heures",
    section: "equipe",
    libelle: "Heures & salaires",
    href: "/equipe/paie/heures",
    roles: ["direction", "comptable"],
    modulesAuMoinsUn: ["planning", "time_clock"],
    saufModule: "payslips",
    icone: "coins",
    parent: "equipe.paie",
  }),
  E({
    id: "equipe.paie_fiches",
    section: "equipe",
    libelle: "Fiches de paie",
    href: "/equipe/paie/fiches",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    parent: "equipe.paie",
  }),
  E({
    id: "equipe.paie_acomptes",
    section: "equipe",
    libelle: "Demandes d'acompte",
    libelleSousOnglet: "Acomptes",
    href: "/equipe/paie/acomptes",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    parent: "equipe.paie",
    // Alerte « décision » reçue par le salarié : ses demandes.
    alternative: { chauffeur: "/moi/acomptes", manager: "/moi/acomptes", exploitation: "/moi/acomptes" },
    note: "comptable : prépare, la direction accepte ou refuse",
  }),
  E({
    id: "equipe.paie_journal",
    section: "equipe",
    libelle: "Journal de paie",
    libelleSousOnglet: "Journal",
    href: "/equipe/paie/journal",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    parent: "equipe.paie",
  }),
  E({
    id: "equipe.paie_export",
    section: "equipe",
    libelle: "Export pour le comptable",
    libelleSousOnglet: "Export comptable",
    href: "/equipe/paie/export",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    parent: "equipe.paie",
    note: "CSV, éléments variables, journal PDF ; pas de DSN",
  }),
  E({ id: "equipe.paie_reglages", section: "equipe", libelle: "Réglages de paie", libelleSousOnglet: "Réglages", href: "/equipe/paie/reglages", roles: ["direction"], modules: ["payslips"], icone: "coins", parent: "equipe.paie" }),
  E({ id: "equipe.paie_salarie", section: "equipe", libelle: "Bulletin d'un salarié", href: "/equipe/paie/[userId]", roles: ["direction", "comptable"], modules: ["payslips"], icone: "coins", menu: "cache" }),
  E({
    id: "equipe.registre",
    section: "equipe",
    libelle: "Registre du personnel",
    libelleOnglet: "Registre",
    href: "/equipe/registre",
    // Obligation légale de tout employeur : aucun module requis.
    roles: ["direction"],
    icone: "file",
    // Consulté rarement (contrôle, embauche) : rangé dans Administration.
    sectionMenu: { direction: "admin" },
    note: "nationalité et titre de travail : direction seulement",
  }),

  // ── Communication ────────────────────────────────────────────────
  E({ id: "communication.messenger", section: "communication", libelle: "Messenger", href: "/communication/messenger", roles: TOUS_LES_ROLES, modules: ["messenger"], icone: "chat", mobile: "barre" }),
  E({
    id: "communication.intranet",
    section: "communication",
    libelle: "Intranet & convocations",
    href: "/communication/intranet",
    roles: TOUS_LES_ROLES,
    modules: ["intranet"],
    icone: "megaphone",
    mobile: "plus",
  }),
  E({ id: "communication.alertes", section: "communication", libelle: "Notifications", href: "/communication/alertes", roles: TOUS_LES_ROLES, icone: "bell", mobile: "plus" }),
  E({ id: "communication.assistance", section: "communication", libelle: "Demandes d'assistance", libelleOnglet: "Assistance", href: "/communication/assistance", roles: ENCADREMENT, modules: ["assistant"], icone: "lifebuoy" }),

  // ── Administration ───────────────────────────────────────────────
  E({ id: "admin.organisation", section: "admin", libelle: "Organisation", href: "/admin/organisation", roles: ["direction"], icone: "building" }),
  E({ id: "admin.abonnement", section: "admin", libelle: "Abonnement & modules", href: "/admin/abonnement", roles: ["direction"], icone: "card" }),
  E({ id: "admin.journal", section: "admin", libelle: "Journal d'audit", href: "/admin/journal", roles: ["direction"], icone: "shield" }),
  E({
    id: "admin.faq",
    section: "admin",
    libelle: "FAQ plateforme",
    href: "/admin/faq",
    // Contrôle réel : administrateur plateforme GODAC (isPlatformAdmin).
    roles: TOUS_LES_ROLES,
    icone: "lifebuoy",
    menu: "cache",
  }),

  // ── Aide ─────────────────────────────────────────────────────────
  E({ id: "aide.guide", section: "aide", libelle: "Guide d'utilisation", href: "/aide/guide", roles: TOUS_LES_ROLES, icone: "file", mobile: "plus" }),
  E({ id: "aide.faq", section: "aide", libelle: "Questions fréquentes", href: "/aide/faq", roles: TOUS_LES_ROLES, icone: "lifebuoy" }),
  E({ id: "aide.compte", section: "aide", libelle: "Mon compte", href: "/account", roles: TOUS_LES_ROLES, icone: "user", mobile: "plus" }),
];

/** Anciennes pages conservées jusqu'au lot 5, gardées par l'écran qui les remplace. */
export const PAGES_ALIAS: Readonly<Record<string, string>> = {};

const PAR_ID = new Map(ECRANS.map((e) => [e.id, e]));

export function ecran(id: string): Ecran {
  const e = PAR_ID.get(id);
  if (!e) throw new Error(`Écran inconnu : ${id}`);
  return e;
}

export function existeEcran(id: string): boolean {
  return PAR_ID.has(id);
}

/** Lien d'un écran (les segments dynamiques `[x]` sont remplacés par `params`). */
export function urlDe(id: string, params: Record<string, string> = {}): string {
  return ecran(id).href.replace(/\[(\w+)\]/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Paramètre « ${k} » manquant pour ${id}`);
    return encodeURIComponent(v);
  });
}

export type MotifRefus = "role" | "module";

export type DecisionAcces =
  | { ok: true }
  | { ok: false; motif: "role"; rolesAutorises: readonly UserRole[]; redirection?: string; conducteur?: boolean }
  | { ok: false; motif: "module"; modules: readonly CleModule[] };

/**
 * Décision pure : rôle d'abord, puis modules. Partagée par la garde de
 * page, la garde d'API et le menu.
 */
export function deciderAcces(e: Ecran, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): DecisionAcces {
  if (!e.roles.includes(role)) {
    return { ok: false, motif: "role", rolesAutorises: e.roles, redirection: e.alternative?.[role] };
  }
  if (e.conducteur && !conduit) {
    return { ok: false, motif: "role", rolesAutorises: e.roles, redirection: e.alternative?.[role], conducteur: true };
  }
  if (e.droit && !modulesActifs.has(e.droit)) {
    return { ok: false, motif: "role", rolesAutorises: ["direction"], redirection: e.alternative?.[role] };
  }
  const manquants = (e.modules ?? []).filter((m) => !modulesActifs.has(m));
  if (manquants.length > 0) return { ok: false, motif: "module", modules: manquants };
  if (e.modulesAuMoinsUn && e.modulesAuMoinsUn.length > 0 && !e.modulesAuMoinsUn.some((m) => modulesActifs.has(m))) {
    return { ok: false, motif: "module", modules: e.modulesAuMoinsUn };
  }
  return { ok: true };
}

/**
 * Pseudo-module ajouté à l'ensemble des modules actifs des comptes d'essai
 * GO Navigation (lib/acces/modules-requete.ts) : seuls les écrans
 * ECRANS_GO_NAVIGATION apparaissent au menu et s'ouvrent (garde de page).
 */
export const MARQUEUR_GO_NAVIGATION = "offre:go_navigation";

/** Écran hors du périmètre GO Navigation pour cet ensemble de modules. */
export function horsOffreGoNavigation(id: string, modulesActifs: ReadonlySet<string>): boolean {
  return modulesActifs.has(MARQUEUR_GO_NAVIGATION) && !ECRANS_GO_NAVIGATION.includes(id);
}

/** Onglet visible (barre de section ou sous-onglets), sans tenir compte du parent. */
function estOuvrableEnOnglet(e: Ecran, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): boolean {
  if (e.menu === "cache") return false;
  if (horsOffreGoNavigation(e.id, modulesActifs)) return false;
  if (!(e.rolesMenu ?? e.roles).includes(role)) return false;
  if (e.menuConducteur && !conduit) return false;
  return deciderAcces(e, role, modulesActifs, conduit).ok;
}

/** Le parent de cet écran est visible : l'écran n'est qu'un sous-onglet. */
function estSousOngletVisible(e: Ecran, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): boolean {
  if (!e.parent) return false;
  const p = PAR_ID.get(e.parent);
  return Boolean(p && estOuvrableEnOnglet(p, role, modulesActifs, conduit));
}

/** Entrée de menu visible pour ce rôle et ces modules. */
export function estVisibleAuMenu(e: Ecran, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): boolean {
  if (e.menu === "onglet") return false;
  if (e.saufModule && modulesActifs.has(e.saufModule)) return false;
  if (estSousOngletVisible(e, role, modulesActifs, conduit)) return false;
  return estOuvrableEnOnglet(e, role, modulesActifs, conduit);
}

/** Préfixe d'URL de chaque section (les onglets hors préfixe, comme /account, n'y figurent pas). */
export const PREFIXE_SECTION: Record<SectionId, string> = {
  dashboard: "/dashboard",
  moi: "/moi",
  exploitation: "/exploitation",
  flotte: "/flotte",
  carburant: "/carburant",
  equipe: "/equipe",
  communication: "/communication",
  admin: "/admin",
  aide: "/aide",
};

export interface OngletEcran {
  id: string;
  href: string;
  libelle: string;
  /** Chemins qui allument aussi l'onglet (sous-onglets, fiches). */
  prefixes: string[];
}

const chemin = (href: string) => href.split("?")[0]!;
const dansSection = (e: Ecran) => {
  const p = PREFIXE_SECTION[e.section];
  const h = chemin(e.href);
  return h === p || h.startsWith(`${p}/`);
};

function versOnglet(e: Ecran): OngletEcran {
  const enfants = ECRANS.filter((x) => x.parent === e.id).map((x) => chemin(x.href));
  return { id: e.id, href: e.href, libelle: e.libelleOnglet ?? e.libelle, prefixes: [...enfants, ...(e.aussiActif ?? []).map((a) => a.replace(/\/$/, ""))] };
}

/** Barre d'onglets d'une section, filtrée par rôle et modules. */
export function ongletsSection(section: SectionId, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): OngletEcran[] {
  const vus = new Set<string>();
  return ECRANS.filter(
    (e) => e.section === section && dansSection(e) && estOuvrableEnOnglet(e, role, modulesActifs, conduit) && !estSousOngletVisible(e, role, modulesActifs, conduit),
  )
    .filter((e) => (vus.has(chemin(e.href)) ? false : (vus.add(chemin(e.href)), true)))
    .map(versOnglet);
}

/** Sous-onglets d'un écran parent (le parent en premier), filtrés par rôle et modules. */
export function sousOnglets(parentId: string, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): OngletEcran[] {
  const p = ecran(parentId);
  if (!estOuvrableEnOnglet(p, role, modulesActifs, conduit)) return [];
  const enfants = ECRANS.filter((e) => e.parent === parentId && estOuvrableEnOnglet(e, role, modulesActifs, conduit));
  return [{ id: p.id, href: p.href, libelle: p.libelleSousOnglet ?? p.libelle, prefixes: [] }, ...enfants.map((e) => ({ ...versOnglet(e), libelle: e.libelleSousOnglet ?? e.libelle }))];
}

/** Premier onglet ouvrable d'une section (lien de section, URL nue /flotte…). */
export function premierOngletSection(section: SectionId, role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): string | null {
  const o = ongletsSection(section, role, modulesActifs, conduit)[0];
  if (o) return o.href;
  const ouvrable = ECRANS.find(
    (e) => e.section === section && dansSection(e) && !chemin(e.href).includes("[") && !horsOffreGoNavigation(e.id, modulesActifs) && deciderAcces(e, role, modulesActifs, conduit).ok,
  );
  return ouvrable?.href ?? null;
}

export interface SectionMenu {
  id: SectionId;
  libelle: string;
  ecrans: Ecran[];
}

/**
 * Menu généré : une section apparaît si au moins une entrée est visible.
 * Une même URL n'apparaît qu'une fois (première section gagnante), pour
 * qu'aucun rôle n'ait deux entrées vers la même page.
 */
export function menuPour(role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): SectionMenu[] {
  const vus = new Set<string>();
  return SECTIONS.map((s) => {
    const ecrans = ECRANS.filter((e) => (e.sectionMenu?.[role] ?? e.section) === s.id && estVisibleAuMenu(e, role, modulesActifs, conduit)).filter((e) => {
      if (vus.has(e.href)) return false;
      vus.add(e.href);
      return true;
    });
    return { id: s.id, libelle: s.libelle, ecrans };
  }).filter((s) => s.ecrans.length > 0);
}

// ── Mon espace en 3 onglets (lot 3 de l'audit d'ergonomie) ─────────
//
// Les écrans personnels gardent leurs URL (/moi/…, /livreur, /carburant/
// pleins?new=1, /exploitation/contestations) ; ils sont regroupés en trois
// onglets — Ma journée, Mes documents, Mes demandes — au lieu de neuf qui
// défilaient hors de l'écran sur téléphone. Le menu latéral n'affiche plus
// que ces trois entrées dans « Mon espace ».

export type GroupeMonEspaceId = "journee" | "documents" | "demandes";

interface ElementGroupe {
  id: string;
  /** Libellé dans le groupe (par défaut : libellé d'onglet de l'écran). */
  libelle?: string;
  /** Lien propre (ex. formulaire de plein ouvert). */
  href?: string;
  /** Réservé à ces rôles (ex. contestations : seulement celles du chauffeur). */
  roles?: readonly UserRole[];
  /** Réservé aux personnes qui conduisent. */
  conducteur?: boolean;
}

export const GROUPES_MON_ESPACE: readonly { id: GroupeMonEspaceId; libelle: string; icone: IconeId; elements: readonly ElementGroupe[] }[] = [
  {
    id: "journee",
    libelle: "Ma journée",
    icone: "flag",
    elements: [
      { id: "moi.tournee_depart" },
      { id: "moi.tournee_colis" },
      { id: "moi.planning" },
      { id: "moi.pointage" },
      { id: "carburant.pleins", libelle: "Faire un plein", href: "/carburant/pleins?new=1", conducteur: true },
      { id: "moi.vehicule" },
      { id: "moi.signaler", libelle: "Signaler" },
    ],
  },
  {
    id: "documents",
    libelle: "Mes documents",
    icone: "file",
    elements: [{ id: "moi.fiches_paie" }, { id: "moi.amendes" }, { id: "exploitation.contestations", libelle: "Mes contestations", roles: ["chauffeur"] }],
  },
  {
    id: "demandes",
    libelle: "Mes demandes",
    icone: "calendar",
    elements: [{ id: "moi.conges" }, { id: "moi.arrets", libelle: "Arrêts" }, { id: "moi.acomptes", libelle: "Acomptes" }],
  },
];

export interface GroupeMonEspace {
  id: GroupeMonEspaceId;
  libelle: string;
  icone: IconeId;
  /** Lien de l'onglet : premier écran du groupe sous /moi (sinon le premier). */
  href: string;
  /** Chemins qui allument l'onglet (écrans du groupe sous /moi, et leurs sous-onglets). */
  prefixes: string[];
  onglets: OngletEcran[];
}

/**
 * Les onglets de Mon espace pour ce rôle : un groupe n'apparaît que s'il
 * contient au moins un écran ouvrable. Mêmes règles que le menu (rôle,
 * conduite, modules, offre GO Navigation) ; aucun droit en plus.
 */
export function ongletsMonEspace(role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): GroupeMonEspace[] {
  const vus = new Set<string>();
  return GROUPES_MON_ESPACE.flatMap((g) => {
    const onglets = g.elements
      .filter((x) => {
        const e = PAR_ID.get(x.id);
        if (!e || vus.has(e.id)) return false;
        if (x.roles && !x.roles.includes(role)) return false;
        if (x.conducteur && !conduit) return false;
        if (horsOffreGoNavigation(e.id, modulesActifs)) return false;
        if (e.menuConducteur && !conduit) return false;
        // Entrées « Mon espace » : rôles du menu ; écrans d'autres sections : accès seul.
        if (e.section === "moi" && !(e.rolesMenu ?? e.roles).includes(role)) return false;
        return deciderAcces(e, role, modulesActifs, conduit).ok;
      })
      .map((x) => {
        const e = ecran(x.id);
        vus.add(e.id);
        return { ...versOnglet(e), href: x.href ?? e.href, libelle: x.libelle ?? e.libelleOnglet ?? e.libelle };
      });
    if (onglets.length === 0) return [];
    const href = (onglets.find((o) => chemin(o.href).startsWith("/moi/")) ?? onglets[0]!).href;
    const prefixes = onglets.flatMap((o) => [chemin(o.href), ...o.prefixes]).filter((p) => p.startsWith("/moi/"));
    return [{ id: g.id, libelle: g.libelle, icone: g.icone, href, prefixes, onglets }];
  });
}

/**
 * Sections du menu repliées par défaut (lot 3 de l'audit) : la direction a
 * le menu le plus long ; ses entrées rares (Administration, Aide) se
 * déplient d'un geste. Une section qui contient l'écran ouvert est
 * toujours dépliée. Aucune entrée retirée.
 */
export const SECTIONS_REPLIEES: Partial<Record<UserRole, readonly SectionId[]>> = {
  direction: ["admin", "aide"],
};

export function estSectionRepliee(section: SectionId, role: UserRole): boolean {
  return SECTIONS_REPLIEES[role]?.includes(section) ?? false;
}

/** Libellé d'une section pour ce rôle : « Mes tournées » pour qui n'encadre pas. */
export function libelleSection(section: SectionId, role: UserRole): string {
  if (section === "exploitation" && !ENCADREMENT.includes(role)) return "Mes tournées";
  return SECTIONS.find((s) => s.id === section)?.libelle ?? section;
}

/**
 * Menu affiché (Sidebar, tiroir « Plus » de la barre mobile) : le menu du
 * catalogue, avec « Mon espace » réduit à ses trois onglets et la section
 * Exploitation renommée « Mes tournées » pour le chauffeur.
 */
export function menuAffiche(role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): SectionMenu[] {
  const groupes = ongletsMonEspace(role, modulesActifs, conduit);
  const base = menuPour(role, modulesActifs, conduit);
  return SECTIONS.flatMap((sec): SectionMenu[] => {
    if (sec.id === "moi") {
      if (groupes.length === 0) return [];
      const ecrans: Ecran[] = groupes.map((g) => ({ id: `moi.groupe.${g.id}`, section: "moi", libelle: g.libelle, href: g.href, roles: [role], icone: g.icone, aussiActif: g.prefixes }));
      return [{ id: "moi", libelle: sec.libelle, ecrans }];
    }
    return base.filter((b) => b.id === sec.id).map((b) => ({ ...b, libelle: libelleSection(b.id, role) }));
  });
}

export function ecransVisibles(role: UserRole, modulesActifs: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): Ecran[] {
  return menuPour(role, modulesActifs, conduit).flatMap((s) => s.ecrans);
}

/** Entrée active : la plus longue URL qui correspond, sinon un préfixe `aussiActif`. */
export function entreeActive(ecrans: readonly Ecran[], pathname: string): Ecran | undefined {
  const chemin = (href: string) => href.split("?")[0]!;
  const correspond = (href: string) => {
    const h = chemin(href);
    return h === "/dashboard" ? pathname === h : pathname === h || pathname.startsWith(`${h}/`);
  };
  const directes = ecrans.filter((e) => correspond(e.href)).sort((a, b) => chemin(b.href).length - chemin(a.href).length);
  if (directes[0]) return directes[0];
  const parPrefixe = ecrans.find((e) => e.aussiActif?.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`))));
  if (parPrefixe) return parPrefixe;
  // Onglet sans entrée de menu (Suivi en direct, Approvisionnements…) :
  // première entrée de la même section.
  return ecrans.find((e) => {
    const p = PREFIXE_SECTION[e.section];
    return p !== "/dashboard" && (pathname === p || pathname.startsWith(`${p}/`));
  });
}

export function libelleRoles(roles: readonly UserRole[]): string {
  const L: Record<UserRole, string> = {
    direction: "Direction",
    exploitation: "Exploitation",
    manager: "Manager",
    chauffeur: "Chauffeur",
    comptable: "Comptable",
  };
  return roles.map((r) => L[r]).join(", ");
}

/** « Réservé à la direction », « Réservé à l'encadrement »… */
export function titreReserve(roles: readonly UserRole[]): string {
  const set = new Set(roles);
  if (set.size === 1 && set.has("direction")) return "Réservé à la direction";
  if (set.size === ENCADREMENT.length && ENCADREMENT.every((r) => set.has(r))) return "Réservé à l'encadrement";
  if (set.size === 2 && set.has("direction") && set.has("comptable")) return "Réservé à la direction et à la comptabilité";
  return `Réservé à : ${libelleRoles(roles)}`;
}
