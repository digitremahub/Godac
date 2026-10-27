import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));
vi.mock("@/lib/go-navigation/etat", () => ({ lireEtatOffre: async () => ({}) }));

import { refusPour, regleEffective } from "@/lib/acces/garde-api";
import { MODULES_AVEC_CODE } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { ECRANS_PAR_TYPE, LIBELLES_TYPE, TYPES_A_TRAITER, TYPES_MANAGER, typeVisiblePour } from "@/lib/a-traiter/logique";
import { TYPES_ALERTE_PLANNING, alerteAffichable, alerteVisiblePour, choisirDestinataires, peutChangerStatutAlerte, rolesCibles } from "@/lib/alerts/destinataires";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";
import { ROLES_DESTINATAIRES_PLANNING } from "@/lib/planning/semaines-auto";
import { ACTIONS_AUDIT } from "@/lib/audit/journal";
import type { UserRole } from "@/lib/types/domain";

/**
 * Planning de la semaine suivante généré le jeudi : contrats des routes (rôles
 * × route), des crons (vercel.json Hobby), des migrations (additives, enum
 * séparé, aucune policy amputée) et des destinataires. Comme les audits de
 * lots, ces tests relisent le source des fichiers.
 */
const lire = (f: string) => readFileSync(f, "utf8");
const ROLES: UserRole[] = ["chauffeur", "manager", "exploitation", "comptable", "direction"];
const MODULES = new Set<string>(MODULES_AVEC_CODE);

/** Options passées à garderApi dans le source d'une route. */
function optionsGarde(fichier: string): { roles?: UserRole[]; modules?: string[] } {
  const m = lire(fichier).match(/garderApi\((\{[^)]*\})\)/);
  expect(m, `${fichier} : garderApi absent`).not.toBeNull();
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m![1]})`)();
}

const ROUTES_ENCADREMENT = ["app/api/planning/semaine-suivante/confirmer/route.ts", "app/api/planning/semaine-suivante/regenerer/route.ts", "app/api/planning/semaine-suivante/generer/route.ts"];

describe("matrice rôle × route : confirmer, régénérer et générer à la demande", () => {
  it.each(ROUTES_ENCADREMENT)("%s : direction, exploitation et manager ; jamais chauffeur ni comptable", (fichier) => {
    const opts = optionsGarde(fichier);
    expect(opts.modules).toEqual(["planning"]);
    const regle = regleEffective(opts as any);
    const ouverts = ROLES.filter((r) => refusPour(regle, r, new Set(["planning"]), r === "chauffeur") === null);
    expect(ouverts.sort()).toEqual(["direction", "exploitation", "manager"]);
    const chauffeur = refusPour(regle, "chauffeur", new Set(["planning"]), true);
    expect(chauffeur?.status).toBe(403);
    expect(refusPour(regle, "comptable", new Set(["planning"]), false)?.status).toBe(403);
    // Module planning désactivé : refus pour tout le monde.
    expect(refusPour(regle, "direction", new Set(), false)?.status).toBe(403);
  });

  it.each(ROUTES_ENCADREMENT)("%s : le manager est borné à son service, garde serveur avant tout accès", (fichier) => {
    const src = lire(fichier);
    expect(src).toContain("dansLePerimetre(appUser.role");
    expect(src).toContain("if (!g.ok) return g.reponse;");
    // Le périmètre est vérifié avant toute lecture du suivi ou génération.
    expect(src.indexOf("dansLePerimetre(")).toBeLessThan(src.indexOf("createAdminSupabaseClient()"));
  });

  it("confirmer : même fonction de publication que « Publier aux chauffeurs », refus s'il reste des cases à remplacer", () => {
    expect(lire("app/api/planning/publier/route.ts")).toContain("publierSemaines(");
    expect(lire("lib/planning/semaines-auto-serveur.ts")).toContain("publierSemaines(");
    const route = lire("app/api/planning/semaine-suivante/confirmer/route.ts");
    expect(route).toContain("confirmerSemaine(");
    expect(route).toContain("envoyer_quand_meme");
    // Une seule fonction publie : l'envoi automatique et la confirmation l'appellent.
    expect((lire("lib/planning/semaines-auto-serveur.ts").match(/publierSemaines\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("générer à la demande : fenêtre de semaines validée avant tout accès, génération « manuel » sans notification d'office", () => {
    const route = lire("app/api/planning/semaine-suivante/generer/route.ts");
    expect(route).toContain("estSemainePreparable(semaine_debut");
    expect(route).toContain("manuel: true");
    expect(route).toContain("z.string().uuid()");
    expect(route).toContain("rangJour(d) === 0");
    // Fenêtre et périmètre contrôlés avant le client service role.
    expect(route.indexOf("estSemainePreparable(")).toBeLessThan(route.indexOf("createAdminSupabaseClient()"));
    // Sans le consentement du chauffeur ni notification : la route n'appelle ni publication ni alerte.
    expect(route).not.toContain("publierSemaines");
    const serveur = lire("lib/planning/semaines-auto-serveur.ts");
    expect(serveur).toContain("envoiAutomatiquePrevu(lundi");
    expect(serveur).toContain('p.manuel ? "manuel" : "auto"');
  });

  it("migration 20261111000004 : genere_par accepte 'manuel', additive et rejouable, code tolérant sans elle", () => {
    const sql = lire("supabase/migrations/20261111000004_planning_semaines_auto_genere_manuel.sql");
    expect(sql).toContain("drop constraint if exists planning_semaines_auto_genere_par_check");
    expect(sql).toContain("check (genere_par in ('auto', 'manuel'))");
    expect(sql).toContain("to_regclass('public.planning_semaines_auto') is not null");
    expect(sql).not.toMatch(/drop (table|column|policy)/i);
    expect(lire("lib/planning/semaines-auto-serveur.ts")).toContain('erreurCreation?.code === "23514"');
  });

  it("la publication est tracée au journal d'audit", () => {
    for (const a of ["planning_semaine_generee", "planning_semaine_regeneree", "planning_semaine_confirmee", "planning_semaine_envoyee_auto", "planning_semaine_rappel"] as const) {
      expect(ACTIONS_AUDIT[a], a).toBeTruthy();
      expect(lire("lib/planning/semaines-auto-serveur.ts"), a).toContain(`"${a}"`);
    }
  });
});

describe("crons : CRON_SECRET, sans session", () => {
  it.each(["app/api/cron/planning-semaine-suivante/route.ts", "app/api/cron/planning-envoi-auto/route.ts"])("%s", (fichier) => {
    const src = lire(fichier);
    expect(src).toContain('process.env.CRON_SECRET');
    expect(src).toContain("Bearer ${secret}");
    expect(src).toContain("unauthorized");
    // Secret contrôlé avant toute lecture en base.
    expect(src.indexOf("Bearer ${secret}")).toBeLessThan(src.indexOf("createAdminSupabaseClient()"));
    expect(src).not.toContain("garderApi(");
    // Chaque organisation est traitée à part : une en erreur n'empêche pas les autres.
    expect(src).toContain("catch (err)");
  });

  it("le middleware laisse /api/cron hors de la session", () => {
    expect(lire("middleware.ts")).toContain("/api/cron");
  });

  it("le cron du vendredi mentionne la limite « dans l'heure » du plan Hobby et l'option pg_cron / Pro", () => {
    const src = lire("app/api/cron/planning-envoi-auto/route.ts");
    expect(src).toMatch(/dans l'heure/);
    expect(src).toMatch(/pg_cron/);
    expect(src).toMatch(/Pro/);
    expect(lire("lib/planning/semaines-auto.ts")).toMatch(/dans l'heure/);
  });
});

describe("vercel.json : plan Hobby, au plus une exécution par jour", () => {
  const crons = JSON.parse(lire("vercel.json")).crons as { path: string; schedule: string }[];

  it("tous les crons : minute, heure et jour de la semaine fixes (jamais plus d'une fois par jour)", () => {
    for (const c of crons) {
      const [minute, heure, jourDuMois, mois, jourSemaine] = c.schedule.split(" ");
      expect(c.schedule.split(" ")).toHaveLength(5);
      expect(minute, c.path).toMatch(/^\d+$/);
      expect(heure, c.path).toMatch(/^\d+$/);
      expect(jourDuMois, c.path).toMatch(/^(\*|\d+)$/);
      expect(mois, c.path).toBe("*");
      // Pas de liste, de plage ni de pas : « 0 4 * * 4 » oui, « */5 » ou « 1,2 » non.
      expect(jourSemaine, c.path).toMatch(/^(\*|\d)$/);
    }
  });

  it("génération : une seule fois par semaine, le jeudi tôt (4 h UTC = 5 ou 6 h à Paris)", () => {
    const g = crons.filter((c) => c.path.startsWith("/api/cron/planning-semaine-suivante"));
    expect(g).toHaveLength(1);
    expect(g[0]!.schedule).toBe("0 4 * * 4");
  });

  it("envoi automatique : deux entrées le vendredi, 15 h et 16 h UTC (17 h Paris été et hiver)", () => {
    const e = crons.filter((c) => c.path.startsWith("/api/cron/planning-envoi-auto"));
    expect(e.map((c) => c.schedule).sort()).toEqual(["0 15 * * 5", "0 16 * * 5"]);
    // Entrées distinctes (le paramètre est ignoré par le handler).
    expect(new Set(e.map((c) => c.path)).size).toBe(2);
  });

  it("le résumé du vendredi reste planifié une fois", () => {
    expect(crons.filter((c) => c.path === "/api/cron/weekly-planning-digest")).toHaveLength(1);
  });
});

describe("chauffeurs : une semaine non publiée reste invisible et sans notification", () => {
  const m1 = lire("supabase/migrations/20261111000001_planning_semaines_auto.sql");

  it("la lecture du planning exclut, pour la branche « ses lignes », les semaines non publiées", () => {
    expect(m1).toContain('alter policy "planning: read within org" on public.planning_entries');
    expect(m1).toContain("driver_id = public.current_app_user_id() and not public.planning_semaine_masquee(organization_id, service_id, start_at)");
    // Les autres branches sont celles de 20261027000002.
    for (const b of ["public.current_role() in ('comptable', 'direction')", "public.est_encadrement_org()", "public.is_manager_like() and service_id = any (public.current_user_service_ids())"]) expect(m1).toContain(b);
    expect(m1).toContain("s.publie_at is null");
    expect(m1).toContain("security definer");
    expect(m1).toContain("'Europe/Paris'");
  });

  it("la table : RLS, lecture encadrement du service, aucune policy d'écriture, unicité par service et semaine", () => {
    expect(m1).toContain("enable row level security");
    expect(m1).toContain("unique (organization_id, service_id, semaine_debut)");
    expect(m1).toContain("for select using");
    expect(m1).toMatch(/est_encadrement_org\(\) or \(public\.is_manager_like\(\) and service_id = any \(public\.current_user_service_ids\(\)\)\)/);
    expect(m1).not.toMatch(/for (insert|update|delete|all)/i);
    for (const c of ["genere_at", "genere_par", "modifie_at", "confirme_at", "confirme_par", "publie_at", "publie_mode", "resume jsonb"]) expect(m1).toContain(c);
    expect(m1).toContain("isodow from semaine_debut) = 1");
  });

  it("le résumé du vendredi et le rappel du soir ne contactent jamais un chauffeur pour une semaine non publiée", () => {
    const digest = lire("app/api/cron/weekly-planning-digest/route.ts");
    expect(digest).toContain('from("planning_validations")');
    expect(digest).toContain(".in(\"service_id\", [...publies])");
    expect(digest).toContain("estMasquee(masquees, e)");
    expect(digest).toContain("servicesPublieesRecemment");
    const rappel = lire("app/api/cron/daily-planning-reminder/route.ts");
    expect(rappel).toContain("estMasquee(masquees, row)");
  });

  it("la génération ne notifie aucun chauffeur : alertes d'encadrement seulement", () => {
    const src = lire("lib/planning/semaines-auto-serveur.ts");
    const generation = src.slice(src.indexOf("export async function genererSemaine"), src.indexOf("export type ResultatConfirmation"));
    expect(generation).not.toContain("recipient_user_id");
    expect(generation).not.toContain("planning_validated");
    expect(generation).not.toContain('from("planning_validations").upsert');
    expect(src).toContain("ROLES_DESTINATAIRES_PLANNING");
    expect([...ROLES_DESTINATAIRES_PLANNING]).toEqual(["manager", "exploitation", "direction"]);
  });
});

describe("modifications manuelles : un seul point d'entrée, appelé par chaque route de modification", () => {
  it.each([
    ["app/api/planning/affecter/route.ts", "noterModificationPlanning"],
    ["app/api/planning/entries/route.ts", "noterModificationPlanning"],
    ["app/api/planning/entries/[id]/route.ts", "noterModificationPlanning"],
    ["app/api/planning/entries/[id]/duplicate/route.ts", "noterModificationPlanning"],
    ["app/api/planning/entries/[id]/remove-duplicate/route.ts", "noterModificationPlanning"],
    ["app/api/planning/entries/[id]/ouverture/route.ts", "noterModificationEntree"],
    ["app/api/planning/entries/[id]/fusion/route.ts", "noterModificationEntree"],
    ["app/api/planning/entries/[id]/repartition/route.ts", "noterModificationEntree"],
    ["app/api/planning/fermetures/route.ts", "noterModificationPlanning"],
    ["app/api/planning/duplicate-week/route.ts", "noterModificationPlanning"],
    ["app/api/planning/templates/generate/route.ts", "noterModificationPlanning"],
    ["app/api/planning/heure/route.ts", "noterModificationPlanning"],
  ])("%s appelle %s", (fichier, fonction) => {
    const src = lire(fichier);
    expect(src).toContain(`import { ${fonction} } from "@/lib/planning/suivi-auto-serveur"`);
    expect(src).toMatch(new RegExp(`await ${fonction}\\(`));
  });

  it("une seule trace par route : pas d'écriture directe de modifie_at ailleurs que dans le point d'entrée et la régénération", () => {
    const fichiers = ["affecter", "entries", "fermetures", "duplicate-week", "heure"].map((d) => `app/api/planning/${d}/route.ts`);
    for (const f of fichiers) expect(lire(f), f).not.toContain("modifie_at");
    expect(lire("lib/planning/suivi-auto-serveur.ts")).toContain(".is(\"modifie_at\", null)");
  });
});

describe("tolérance sans migration", () => {
  it("le suivi, la génération, l'envoi et les alertes ignorent une table ou un type absent", () => {
    const suivi = lire("lib/planning/suivi-auto-serveur.ts");
    expect(suivi).toContain("estSchemaManquant");
    expect(suivi).toContain("tableAbsente");
    const serveur = lire("lib/planning/semaines-auto-serveur.ts");
    expect(serveur).toContain("migrationManquante");
    expect(serveur).toContain("estValeurEnumInconnue");
    expect(serveur).toContain("MESSAGE_MIGRATION_MANQUANTE");
    expect(lire("lib/a-traiter/serveur.ts")).toContain("Table absente (migration 20261111000001 pas appliquée)");
  });
});

describe("migrations additives, rejouables, enum séparé", () => {
  const enumSql = lire("supabase/migrations/20261111000002_alerte_planning_a_confirmer_type.sql");
  const suite = lire("supabase/migrations/20261111000003_alerte_planning_a_confirmer_unique.sql");
  const table = lire("supabase/migrations/20261111000001_planning_semaines_auto.sql");

  it("la valeur d'enum est seule dans son fichier ; aucun autre fichier ne l'ajoute", () => {
    expect(enumSql).toContain("alter type public.alert_type add value if not exists 'planning_a_confirmer';");
    expect(enumSql.replace(/--.*$/gm, "").trim()).toBe("alter type public.alert_type add value if not exists 'planning_a_confirmer';");
    expect(suite).not.toMatch(/add value/);
    expect(table).not.toMatch(/add value/);
    // Les fichiers qui suivent n'utilisent la valeur que sous forme de texte (type::text).
    expect(suite).not.toMatch(/type = 'planning_a_confirmer'/);
  });

  it("les policies d'alertes reprennent TOUS les types existants, plus le nouveau", () => {
    const existants = ["tournee_retard", "tournee_non_demarree", "tournee_sans_chauffeur", "echeance_vehicule", "echeance_rh", "pointage_a_regulariser", "paiement_echoue"];
    const listes = [...suite.matchAll(/type::text not in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    // Comptable + manager sans service, pour la lecture ; manager sans service, pour la prise en compte.
    expect(listes).toHaveLength(3);
    for (const l of listes) {
      for (const t of [...existants, "planning_a_confirmer"]) expect(l, t).toContain(t);
      expect(l).toHaveLength(existants.length + 1);
    }
    expect(suite).toContain('alter policy "alerts: read within org for manager-like and comptable" on public.alerts');
    expect(suite).toContain('alter policy "alerts: manager-like can acknowledge" on public.alerts');
    // Même structure que 20261110000002 (direction, manager par service, exploitation).
    const precedente = lire("supabase/migrations/20261110000002_planning_rh_paie_lot3.sql");
    const sansNouveau = (s: string) => s.replace(/, 'planning_a_confirmer'/g, "").replace(/\s+/g, " ");
    for (const bloc of ["public.current_role() = 'direction'", "service_id = any (public.current_user_service_ids())", "public.is_exploitation()", "recipient_roles::text[] && array['manager', 'manager_chauffeur', 'exploitation']::text[]"]) {
      expect(sansNouveau(suite)).toContain(bloc);
      expect(sansNouveau(precedente)).toContain(bloc);
    }
  });

  it("index unique de dédoublonnage par organisation et clé (une alerte par semaine et par service)", () => {
    expect(suite).toContain("create unique index if not exists alerts_cle_dedoublonnage_unique");
    expect(suite).toContain("(organization_id, cle_dedoublonnage)");
    expect(lire("lib/planning/semaines-auto.ts")).toContain("planning:a_confirmer:${serviceId}:${lundi}");
  });

  it("additives : ni suppression de donnée, de table, de colonne ni de policy", () => {
    for (const f of [enumSql, suite, table]) {
      const code = f.replace(/--.*$/gm, "");
      expect(/drop (table|column|policy|trigger)|delete from|truncate|alter table .* drop/i.test(code), "pas destructif").toBe(false);
    }
    expect(table).toContain("create table if not exists public.planning_semaines_auto");
    expect(table).toContain("create or replace function public.planning_semaine_masquee");
  });
});

describe("destinataires : direction, exploitation et managers du service", () => {
  const gens = [
    { id: "m1", role: "manager" },
    { id: "m2", role: "manager" },
    { id: "e1", role: "exploitation" },
    { id: "d1", role: "direction" },
    { id: "c1", role: "comptable" },
    { id: "ch1", role: "chauffeur" },
  ];
  const services = new Map([
    ["m1", ["A"]],
    ["m2", ["B"]],
  ]);
  const alerte = { type: "planning_a_confirmer", service_id: "A" };

  it("manager de CE service, exploitation et direction : jamais le comptable ni un chauffeur", () => {
    expect(choisirDestinataires(gens, alerte, services).map((g) => g.id)).toEqual(["m1", "e1", "d1"]);
    expect(choisirDestinataires(gens, { ...alerte, service_id: "B" }, services).map((g) => g.id)).toEqual(["m2", "e1", "d1"]);
  });

  it("par rôle : visibilité et statut", () => {
    expect(TYPES_ALERTE_PLANNING).toEqual(["planning_a_confirmer"]);
    expect(alerteVisiblePour("direction", "planning_a_confirmer", "A")).toBe(true);
    expect(alerteVisiblePour("exploitation", "planning_a_confirmer", "A")).toBe(true);
    expect(alerteVisiblePour("manager", "planning_a_confirmer", "A", ["A"])).toBe(true);
    expect(alerteVisiblePour("manager", "planning_a_confirmer", "A", ["B"])).toBe(false);
    expect(alerteVisiblePour("manager", "planning_a_confirmer", null, ["A"])).toBe(false);
    expect(alerteVisiblePour("comptable", "planning_a_confirmer", "A")).toBe(false);
    expect(alerteVisiblePour("chauffeur", "planning_a_confirmer", "A")).toBe(false);
    expect(alerteAffichable("comptable", { type: "planning_a_confirmer", service_id: "A" })).toBe(false);
    // Traiter l'alerte : jamais le chauffeur ni le comptable, le manager seulement pour son service.
    const base = { type: "planning_a_confirmer", service_id: "A" };
    expect(peutChangerStatutAlerte({ role: "manager", userId: "m1", statut: "resolved", alerte: base, mesServices: ["A"] }).ok).toBe(true);
    expect(peutChangerStatutAlerte({ role: "manager", userId: "m2", statut: "resolved", alerte: base, mesServices: ["B"] }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ role: "comptable", userId: "c1", statut: "resolved", alerte: base, mesServices: [] }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ role: "chauffeur", userId: "ch1", statut: "acknowledged", alerte: base, mesServices: [] }).ok).toBe(false);
  });

  it("rôles ciblés par le webhook : l'exploitation suit les managers, la direction est toujours là", () => {
    expect(rolesCibles([...ROLES_DESTINATAIRES_PLANNING]).sort()).toEqual(["direction", "exploitation", "manager"]);
  });

  it("le lien de l'alerte ouvre la vue Semaine de la semaine (la page lit la ligne de suivi)", () => {
    const url = resolveAlertUrl("planning_semaines_auto", "planning_a_confirmer", "0b1e4c52-0000-4000-8000-000000000001", { role: "manager" });
    expect(url).toBe("/exploitation/planning?semaine_auto=0b1e4c52-0000-4000-8000-000000000001");
    expect(resolveAlertUrl("planning_semaines_auto", "planning_a_confirmer", "x", { role: "direction" })).toContain("/exploitation/planning");
    // Le chauffeur n'a pas cet écran : renvoyé ailleurs (jamais vers le planning de l'encadrement).
    expect(resolveAlertUrl("planning_semaines_auto", "planning_a_confirmer", "x", { role: "chauffeur" })).not.toContain("/exploitation/planning");
    const page = lire("app/(dashboard)/exploitation/planning/page.tsx");
    expect(page).toContain("params.semaine_auto");
    expect(page).toContain('params.view = "week"');
  });
});

describe("« À traiter » : planning à confirmer", () => {
  const ctx = (role: UserRole) => ({ role, modules: MODULES, conduit: role === "chauffeur" });

  it("visible par la direction, l'exploitation et le manager (son service, par la RLS) ; jamais le comptable ni le chauffeur", () => {
    expect(TYPES_A_TRAITER).toContain("planning_a_confirmer");
    expect(LIBELLES_TYPE.planning_a_confirmer.singulier).toBe("Planning à confirmer");
    expect(ECRANS_PAR_TYPE.planning_a_confirmer).toEqual(["exploitation.planning"]);
    expect(TYPES_MANAGER).toContain("planning_a_confirmer");
    for (const role of ["direction", "exploitation", "manager"] as const) {
      expect(typeVisiblePour("planning_a_confirmer", role), role).toBe(true);
      expect(ecranOuvrable("exploitation.planning", ctx(role)), role).toBe(true);
    }
    for (const role of ["comptable", "chauffeur"] as const) expect(typeVisiblePour("planning_a_confirmer", role), role).toBe(false);
  });

  it("lu dans planning_semaines_auto (sous la RLS), urgent à partir du vendredi, jamais une semaine terminée", () => {
    const src = lire("lib/a-traiter/serveur.ts");
    const bloc = src.slice(src.indexOf('type: "planning_a_confirmer"'), src.indexOf('type: "contestation"'));
    expect(bloc).toContain('from("planning_semaines_auto")');
    expect(bloc).toContain('.is("publie_at", null)');
    expect(bloc).toContain("estUrgentLeVendredi");
    expect(bloc).toContain("?view=week&week=");
  });
});

describe("bandeau de la page Planning", () => {
  it("mobile 360 px : boutons pleine largeur, liste qui passe à la ligne, aucune couleur de palette en dur", () => {
    const src = lire("components/planning/BandeauSemaineAuto.tsx");
    expect(src).toContain("w-full");
    expect(src).toContain("btn-dark");
    expect(src).not.toMatch(/\bbg-(yellow|amber|gold)\b|text-(yellow|amber)-/);
    expect(src).toContain("Confirmer et envoyer aux chauffeurs");
    expect(src).toContain("Régénérer les cases vides");
    expect(src).toContain("Envoyer quand même");
  });

  it("n'apparaît qu'en vue Semaine, pour les services filtrés", () => {
    const page = lire("app/(dashboard)/exploitation/planning/page.tsx");
    expect(page).toContain('view === "week" && <BandeauSemaineAuto');
  });
});
