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

import type { UserRole } from "@/lib/types/domain";

export const TOUS_LES_ROLES: readonly UserRole[] = ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"];
export const ENCADREMENT: readonly UserRole[] = ["manager", "manager_chauffeur", "direction"];
export const TERRAIN: readonly UserRole[] = ["chauffeur", "manager_chauffeur"];

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
  /** Rôles qui voient l'entrée dans le menu (par défaut : `roles`). */
  rolesMenu?: readonly UserRole[];
  /** Modules tous requis (ET). */
  modules?: readonly CleModule[];
  /** Au moins un de ces modules (OU). */
  modulesAuMoinsUn?: readonly CleModule[];
  /** Entrée masquée quand ce module est actif (une autre la remplace). */
  saufModule?: CleModule;
  /** Formule à partir de laquelle le module est inclus (indicatif). */
  formuleMin?: FormuleMin;
  /** "cache" : page accessible mais sans entrée de menu (fiche, formulaire…). */
  menu?: "section" | "cache";
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
  /** Restriction supplémentaire faite par la page (texte pour la matrice). */
  note?: string;
}

const E = (e: Ecran) => e;

export const ECRANS: readonly Ecran[] = [
  // ── Tableau de bord ──────────────────────────────────────────────
  E({ id: "dashboard.accueil", section: "dashboard", libelle: "Tableau de bord", href: "/dashboard", roles: TOUS_LES_ROLES, icone: "grid" }),
  E({ id: "dashboard.reporting", section: "dashboard", libelle: "Reporting BI", href: "/reporting", roles: ["direction"], modules: ["bi_reporting"], icone: "chart" }),

  // ── Mon espace ───────────────────────────────────────────────────
  E({
    id: "moi.tournee_depart",
    section: "moi",
    libelle: "Démarrer une tournée",
    href: "/tours/start",
    roles: TERRAIN,
    modules: ["planning"],
    icone: "clock",
    mobile: "barre",
  }),
  E({ id: "moi.tournee_retour", section: "moi", libelle: "Terminer une tournée", href: "/tours/end", roles: TERRAIN, modules: ["planning"], icone: "flag", mobile: "barre" }),
  E({
    id: "moi.tournee_collegue",
    section: "moi",
    libelle: "J'entre pour un collègue",
    href: "/tours/help",
    roles: ["chauffeur", "manager_chauffeur", "manager", "direction"],
    rolesMenu: ["chauffeur", "manager_chauffeur", "manager"],
    modules: ["planning"],
    icone: "users",
    mobile: "plus",
  }),
  E({ id: "moi.planning", section: "moi", libelle: "Mon planning", href: "/planning/mine", roles: TERRAIN, modules: ["planning"], icone: "calendar", mobile: "plus" }),
  E({ id: "moi.vehicule", section: "moi", libelle: "Mon véhicule", href: "/my-vehicle", roles: TERRAIN, icone: "truck", mobile: "plus" }),
  E({
    id: "moi.signaler",
    section: "moi",
    libelle: "Signaler un problème",
    href: "/maintenance",
    roles: ["chauffeur"],
    modules: ["maintenance_requests"],
    icone: "wrench",
    mobile: "plus",
  }),
  E({ id: "moi.amendes", section: "moi", libelle: "Mes amendes", href: "/mes-amendes", roles: TERRAIN, modules: ["fines"], icone: "file", mobile: "plus" }),
  E({
    id: "moi.fiches_paie",
    section: "moi",
    libelle: "Mes fiches de paie",
    href: "/payslips",
    // La direction ouvre la même page (onglet Fiches de paie de la Paie).
    roles: TOUS_LES_ROLES,
    rolesMenu: ["chauffeur", "manager", "manager_chauffeur", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    mobile: "plus",
    note: "salarié : ses bulletins validés seulement",
  }),
  E({
    id: "moi.pointage",
    section: "moi",
    libelle: "Mon pointage",
    href: "/time-clock",
    roles: TOUS_LES_ROLES,
    rolesMenu: ["chauffeur", "comptable"],
    modules: ["time_clock"],
    icone: "clock",
    mobile: "plus",
    note: "encadrement : vue d'équipe (service) ; autres : soi",
  }),
  E({
    id: "moi.conges",
    section: "moi",
    libelle: "Mes congés",
    href: "/leaves",
    roles: TOUS_LES_ROLES,
    rolesMenu: ["chauffeur", "comptable"],
    modules: ["leave_management"],
    icone: "calendar",
    mobile: "plus",
    note: "encadrement : décisions (service)",
  }),

  // ── Exploitation ─────────────────────────────────────────────────
  E({
    id: "exploitation.planning",
    section: "exploitation",
    libelle: "Planning",
    href: "/planning",
    roles: ENCADREMENT,
    modules: ["planning"],
    icone: "calendar",
    alternative: { chauffeur: "/planning/mine" },
  }),
  E({
    id: "exploitation.tournees",
    section: "exploitation",
    libelle: "Tournées & villages",
    href: "/tours/routes",
    roles: ["direction", "manager", "manager_chauffeur", "chauffeur"],
    modulesAuMoinsUn: ["planning", "route_optimizer"],
    icone: "map",
    note: "chauffeur : lecture",
  }),
  E({
    id: "exploitation.colis",
    section: "exploitation",
    libelle: "Tournées colis",
    href: "/colis",
    roles: ["direction", "manager", "manager_chauffeur", "chauffeur"],
    modules: ["route_optimizer"],
    icone: "qr",
    aussiActif: ["/suivi"],
    note: "chauffeur : sa tournée",
  }),
  E({ id: "exploitation.suivi", section: "exploitation", libelle: "Suivi en direct", href: "/suivi", roles: ENCADREMENT, modules: ["route_optimizer"], icone: "map", menu: "cache" }),
  E({
    id: "exploitation.historique",
    section: "exploitation",
    libelle: "Historique des tournées",
    href: "/tours/history",
    roles: TOUS_LES_ROLES,
    modules: ["planning"],
    icone: "file",
    note: "chauffeur : soi ; comptable : lecture",
  }),
  E({
    id: "exploitation.rapports",
    section: "exploitation",
    libelle: "Rapports de tournée",
    href: "/reports",
    roles: ["direction", "manager", "manager_chauffeur", "comptable"],
    modules: ["planning"],
    icone: "file",
    alternative: { chauffeur: "/tours/history" },
    note: "comptable : lecture",
  }),
  E({
    id: "exploitation.contestations",
    section: "exploitation",
    libelle: "Contestations clients",
    href: "/contestations",
    roles: ["direction", "manager", "manager_chauffeur", "chauffeur"],
    modules: ["customer_disputes"],
    icone: "file",
    note: "chauffeur : les siennes",
  }),

  // ── Flotte ───────────────────────────────────────────────────────
  E({
    id: "flotte.vehicules",
    section: "flotte",
    libelle: "Véhicules",
    href: "/vehicles",
    roles: ["direction", "manager", "manager_chauffeur", "comptable"],
    modules: ["fleet"],
    icone: "truck",
    aussiActif: ["/vehicles/"],
    alternative: { chauffeur: "/my-vehicle" },
    note: "comptable : lecture",
  }),
  E({
    id: "flotte.vehicule_fiche",
    section: "flotte",
    libelle: "Fiche véhicule",
    href: "/vehicles/[id]",
    roles: ["direction", "manager", "manager_chauffeur", "comptable"],
    modules: ["fleet"],
    icone: "truck",
    menu: "cache",
    alternative: { chauffeur: "/my-vehicle" },
  }),
  E({ id: "flotte.vehicule_nouveau", section: "flotte", libelle: "Nouveau véhicule", href: "/vehicles/new", roles: ENCADREMENT, modules: ["fleet"], icone: "truck", menu: "cache" }),
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
    href: "/maintenance",
    roles: ["direction", "manager", "manager_chauffeur", "chauffeur"],
    rolesMenu: ENCADREMENT,
    modules: ["maintenance_requests"],
    icone: "wrench",
    note: "chauffeur : signale (Mon espace)",
  }),
  E({
    id: "flotte.loueurs_demandes",
    section: "flotte",
    libelle: "Demandes aux loueurs",
    href: "/loueurs/demandes",
    roles: ENCADREMENT,
    modules: ["rental_providers"],
    formuleMin: "pro",
    icone: "wrench",
  }),
  E({ id: "flotte.loueurs", section: "flotte", libelle: "Loueurs & prestataires", href: "/loueurs", roles: ENCADREMENT, modules: ["rental_providers"], formuleMin: "pro", icone: "building" }),
  E({
    id: "flotte.amendes",
    section: "flotte",
    libelle: "Amendes",
    href: "/fines",
    roles: ["direction", "manager", "manager_chauffeur", "comptable"],
    modules: ["fines"],
    icone: "file",
    alternative: { chauffeur: "/mes-amendes" },
    note: "manager : son service ; comptable : lecture",
  }),
  E({ id: "flotte.badges", section: "flotte", libelle: "Badges QR", href: "/qr-codes", roles: ENCADREMENT, icone: "qr" }),

  // ── Carburant ────────────────────────────────────────────────────
  E({ id: "carburant.pleins", section: "carburant", libelle: "Pleins", href: "/fuel", roles: TOUS_LES_ROLES, icone: "droplet", note: "chauffeur : ses pleins" }),
  E({ id: "carburant.revue_ocr", section: "carburant", libelle: "Revue OCR", href: "/ocr-review", roles: ENCADREMENT, modules: ["ocr"], icone: "camera" }),
  E({
    id: "carburant.cuves",
    section: "carburant",
    libelle: "Cuves & approvisionnements",
    href: "/tanks",
    roles: ["direction", "manager", "manager_chauffeur", "comptable"],
    icone: "cylinder",
  }),
  E({
    id: "carburant.ticpe",
    section: "carburant",
    libelle: "Export TICPE",
    href: "/ticpe",
    roles: ["direction", "comptable"],
    modules: ["ticpe_export"],
    icone: "file",
    aussiActif: ["/ticpe/"],
  }),
  E({ id: "carburant.ticpe_detail", section: "carburant", libelle: "Détail export TICPE", href: "/ticpe/[id]", roles: ["direction", "comptable"], modules: ["ticpe_export"], icone: "file", menu: "cache" }),

  // ── Équipe & RH ──────────────────────────────────────────────────
  E({
    id: "equipe.utilisateurs",
    section: "equipe",
    libelle: "Utilisateurs",
    href: "/admin/users",
    roles: ENCADREMENT,
    icone: "users",
    aussiActif: ["/admin/users/"],
    note: "manager : lecture de son service",
  }),
  E({
    id: "equipe.utilisateur_fiche",
    section: "equipe",
    libelle: "Fiche salarié",
    href: "/admin/users/[id]",
    roles: ["direction", "manager", "manager_chauffeur", "comptable"],
    icone: "users",
    menu: "cache",
  }),
  E({ id: "equipe.inscriptions", section: "equipe", libelle: "Chauffeurs à valider", href: "/driver-signups", roles: ENCADREMENT, icone: "users" }),
  E({
    id: "equipe.pointage",
    section: "equipe",
    libelle: "Pointage",
    href: "/time-clock",
    roles: ENCADREMENT,
    modules: ["time_clock"],
    icone: "clock",
    note: "manager : son service",
  }),
  E({ id: "equipe.conges", section: "equipe", libelle: "Congés & absences", href: "/leaves", roles: ENCADREMENT, modules: ["leave_management"], icone: "calendar" }),
  E({
    id: "equipe.conges_calendrier",
    section: "equipe",
    libelle: "Calendrier des congés",
    href: "/leaves/planning",
    roles: ENCADREMENT,
    modules: ["leave_management"],
    icone: "calendar",
    note: "manager : son service",
  }),
  E({
    id: "equipe.paie",
    section: "equipe",
    libelle: "Paie & salaires",
    href: "/paie",
    roles: ["direction", "comptable"],
    modules: ["payslips"],
    icone: "coins",
    aussiActif: ["/paie/", "/payroll"],
    note: "comptable : prépare, la direction valide",
  }),
  E({ id: "equipe.paie_salarie", section: "equipe", libelle: "Bulletin d'un salarié", href: "/paie/[userId]", roles: ["direction", "comptable"], modules: ["payslips"], icone: "coins", menu: "cache" }),
  E({ id: "equipe.paie_reglages", section: "equipe", libelle: "Réglages de paie", href: "/paie/parametres", roles: ["direction"], modules: ["payslips"], icone: "coins", menu: "cache" }),
  E({
    id: "equipe.heures",
    section: "equipe",
    libelle: "Salaires",
    href: "/payroll",
    roles: ["direction", "comptable"],
    modulesAuMoinsUn: ["planning", "time_clock"],
    saufModule: "payslips",
    icone: "coins",
  }),

  // ── Communication ────────────────────────────────────────────────
  E({ id: "communication.messenger", section: "communication", libelle: "Messenger", href: "/messenger", roles: TOUS_LES_ROLES, modules: ["messenger"], icone: "chat", mobile: "barre" }),
  E({
    id: "communication.intranet",
    section: "communication",
    libelle: "Intranet & convocations",
    href: "/intranet",
    roles: TOUS_LES_ROLES,
    modules: ["intranet"],
    icone: "megaphone",
    mobile: "plus",
  }),
  E({ id: "communication.alertes", section: "communication", libelle: "Alertes", href: "/alerts", roles: TOUS_LES_ROLES, icone: "bell", mobile: "plus" }),
  E({ id: "communication.assistance", section: "communication", libelle: "Demandes d'assistance", href: "/support", roles: ENCADREMENT, modules: ["assistant"], icone: "lifebuoy" }),

  // ── Administration ───────────────────────────────────────────────
  E({ id: "admin.organisation", section: "admin", libelle: "Organisation", href: "/admin/organizations", roles: ["direction"], icone: "building" }),
  E({ id: "admin.abonnement", section: "admin", libelle: "Abonnement & modules", href: "/admin/billing", roles: ["direction"], icone: "card" }),
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
  E({ id: "aide.guide", section: "aide", libelle: "Guide d'utilisation", href: "/guide", roles: TOUS_LES_ROLES, icone: "file", mobile: "plus" }),
  E({ id: "aide.faq", section: "aide", libelle: "Questions fréquentes", href: "/faq", roles: TOUS_LES_ROLES, icone: "lifebuoy" }),
  E({ id: "aide.compte", section: "aide", libelle: "Mon compte", href: "/account", roles: TOUS_LES_ROLES, icone: "user", mobile: "plus" }),
];

/** Anciennes pages conservées jusqu'au lot 5, gardées par l'écran qui les remplace. */
export const PAGES_ALIAS: Readonly<Record<string, string>> = {
  "/my-fines": "moi.amendes",
};

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
  | { ok: false; motif: "role"; rolesAutorises: readonly UserRole[]; redirection?: string }
  | { ok: false; motif: "module"; modules: readonly CleModule[] };

/**
 * Décision pure : rôle d'abord, puis modules. Partagée par la garde de
 * page, la garde d'API et le menu.
 */
export function deciderAcces(e: Ecran, role: UserRole, modulesActifs: ReadonlySet<string>): DecisionAcces {
  if (!e.roles.includes(role)) {
    return { ok: false, motif: "role", rolesAutorises: e.roles, redirection: e.alternative?.[role] };
  }
  const manquants = (e.modules ?? []).filter((m) => !modulesActifs.has(m));
  if (manquants.length > 0) return { ok: false, motif: "module", modules: manquants };
  if (e.modulesAuMoinsUn && e.modulesAuMoinsUn.length > 0 && !e.modulesAuMoinsUn.some((m) => modulesActifs.has(m))) {
    return { ok: false, motif: "module", modules: e.modulesAuMoinsUn };
  }
  return { ok: true };
}

/** Entrée de menu visible pour ce rôle et ces modules. */
export function estVisibleAuMenu(e: Ecran, role: UserRole, modulesActifs: ReadonlySet<string>): boolean {
  if (e.menu === "cache") return false;
  if (!(e.rolesMenu ?? e.roles).includes(role)) return false;
  if (e.saufModule && modulesActifs.has(e.saufModule)) return false;
  return deciderAcces(e, role, modulesActifs).ok;
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
export function menuPour(role: UserRole, modulesActifs: ReadonlySet<string>): SectionMenu[] {
  const vus = new Set<string>();
  return SECTIONS.map((s) => {
    const ecrans = ECRANS.filter((e) => e.section === s.id && estVisibleAuMenu(e, role, modulesActifs)).filter((e) => {
      if (vus.has(e.href)) return false;
      vus.add(e.href);
      return true;
    });
    return { id: s.id, libelle: s.libelle, ecrans };
  }).filter((s) => s.ecrans.length > 0);
}

export function ecransVisibles(role: UserRole, modulesActifs: ReadonlySet<string>): Ecran[] {
  return menuPour(role, modulesActifs).flatMap((s) => s.ecrans);
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
  return ecrans.find((e) => e.aussiActif?.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`))));
}

export function libelleRoles(roles: readonly UserRole[]): string {
  const L: Record<UserRole, string> = {
    direction: "Direction",
    manager: "Manager",
    manager_chauffeur: "Manager-chauffeur",
    chauffeur: "Chauffeur",
    comptable: "Comptable",
  };
  return roles.map((r) => L[r]).join(", ");
}

/** « Réservé à la direction », « Réservé à l'encadrement »… */
export function titreReserve(roles: readonly UserRole[]): string {
  const set = new Set(roles);
  if (set.size === 1 && set.has("direction")) return "Réservé à la direction";
  if (set.size === 3 && ENCADREMENT.every((r) => set.has(r))) return "Réservé à l'encadrement";
  if (set.size === 2 && set.has("direction") && set.has("comptable")) return "Réservé à la direction et à la comptabilité";
  return `Réservé à : ${libelleRoles(roles)}`;
}
