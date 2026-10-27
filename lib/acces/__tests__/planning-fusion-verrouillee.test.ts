import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));
vi.mock("@/lib/go-navigation/etat", () => ({ lireEtatOffre: async () => ({}) }));

import { refusPour, regleEffective } from "@/lib/acces/garde-api";
import { ACTIONS_AUDIT } from "@/lib/audit/journal";
import type { UserRole } from "@/lib/types/domain";

/**
 * Tournées d'origine d'une fusion = cases verrouillées du planning : contrats
 * des routes (rôle × route), des crons (vercel.json Hobby), des migrations
 * (additives, enum séparé, aucune policy amputée) et de l'interface (marque,
 * mobile 360 px). Comme les audits de lots, ces tests relisent le source.
 */
const lire = (f: string) => readFileSync(f, "utf8");
const ROLES: UserRole[] = ["chauffeur", "manager", "exploitation", "comptable", "direction"];
const ENCADREMENT = ["direction", "exploitation", "manager"];

/** Options passées à garderApi dans le source d'une route (littéral d'objet sur une ligne). */
function optionsGarde(src: string): { roles?: UserRole[]; modules?: string[] } {
  const m = src.match(/garderApi\((\{[^)]*\})\)/);
  expect(m, "garderApi absent").not.toBeNull();
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m![1]})`)();
}

/** Rôles de l'encadrement écrits en ligne (« ["direction", "manager", "exploitation"].includes(appUser.role) » ou constante). */
function rolesEnLigne(src: string): string[] {
  const m = src.match(/(?:const (?:allowedRoles|roles) = |if \(!)(\[[^\]]*\])/);
  expect(m, "liste de rôles absente").not.toBeNull();
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m![1]})`)();
}

/** Position d'une première écriture dans le source d'un handler. */
const premiereEcriture = (src: string) => Math.min(...[".insert(", ".upsert(", ".update(", ".delete(", "inscrireCopies("].map((w) => src.indexOf(w)).filter((i) => i >= 0));

interface RouteVerrou {
  fichier: string;
  /** Module exigé par la garde. */
  module: string;
  /** Protection : garde par rôles (garderApi) ou test de rôle en ligne. */
  roles: "garde" | "en-ligne";
  /** Fonction qui refuse (ou ignore et compte) l'affectation sur une case fusionnée. */
  verrou: string;
}

const ROUTES_AFFECTANT: RouteVerrou[] = [
  { fichier: "app/api/planning/affecter/route.ts", module: "planning", roles: "en-ligne", verrou: "partagerJours(" },
  { fichier: "app/api/planning/entries/route.ts", module: "planning", roles: "en-ligne", verrou: "verrouDe(" },
  { fichier: "app/api/planning/entries/[id]/duplicate/route.ts", module: "planning", roles: "en-ligne", verrou: "ecarterFusionnees(" },
  { fichier: "app/api/planning/duplicate-week/route.ts", module: "planning", roles: "en-ligne", verrou: "ecarterFusionnees(" },
  { fichier: "app/api/planning/templates/generate/route.ts", module: "planning", roles: "en-ligne", verrou: "verrouDe(" },
  { fichier: "app/api/colis/affectations/route.ts", module: "route_optimizer", roles: "en-ligne", verrou: "verrouDe(" },
];

describe("matrice rôle × route : les routes qui affectent", () => {
  it.each(ROUTES_AFFECTANT)("$fichier : direction, exploitation et manager ; jamais chauffeur ni comptable", (r) => {
    const src = lire(r.fichier);
    const opts = optionsGarde(src);
    expect(opts.modules).toEqual([r.module]);
    // Module désactivé : refus pour tout le monde, y compris la direction.
    const regle = regleEffective(opts as any);
    expect(refusPour(regle, "direction", new Set(), false)?.status).toBe(403);
    // Le rôle est vérifié côté serveur, dans la route, avant toute lecture ou écriture.
    expect(rolesEnLigne(src).sort()).toEqual([...ENCADREMENT].sort());
    expect(src).toContain("if (!g.ok) return g.reponse;");
    const refus = src.search(/\.includes\(appUser\.role\)|\.includes\(user\.role\)/);
    expect(refus, "test de rôle absent").toBeGreaterThan(-1);
    expect(src).toMatch(/status: 403/);
    // Résultat pour chaque rôle.
    const permis = ROLES.filter((role) => rolesEnLigne(src).includes(role));
    expect(permis.sort()).toEqual([...ENCADREMENT].sort());
    expect(permis).not.toContain("chauffeur");
    expect(permis).not.toContain("comptable");
  });

  it.each(ROUTES_AFFECTANT)("$fichier : refuse (409) ou ignore et compte une case fusionnée, AVANT toute écriture", (r) => {
    const src = lire(r.fichier);
    expect(src).toContain("fusion-verrou");
    expect(src).toContain("verrousDeLaPeriode(");
    const i = src.indexOf(r.verrou);
    expect(i, `${r.verrou} absent`).toBeGreaterThan(-1);
    expect(i).toBeLessThan(premiereEcriture(src));
    // Les lectures de verrou passent par le client de la personne connectée (RLS : un manager reste borné à son service).
    expect(src).not.toMatch(/verrousDeLaPeriode\(createAdminSupabaseClient/);
  });

  it("refus explicite : 409 « tournee_fusionnee » pour une affectation seule, compteur « fusionnees » pour un lot", () => {
    for (const f of ["app/api/planning/affecter/route.ts", "app/api/planning/entries/route.ts", "app/api/planning/entries/[id]/route.ts", "app/api/planning/entries/[id]/duplicate/route.ts", "app/api/colis/affectations/route.ts"]) {
      const src = lire(f);
      expect(src, f).toContain('code: "tournee_fusionnee"');
      expect(src, f).toMatch(/status: 409/);
    }
    for (const f of ["app/api/planning/affecter/route.ts", "app/api/planning/entries/[id]/duplicate/route.ts", "app/api/planning/duplicate-week/route.ts", "app/api/planning/templates/generate/route.ts"]) {
      expect(lire(f), f).toMatch(/fusionnees/);
    }
  });

  it("PATCH d'une affectation : on retire toujours un chauffeur (doublon), on n'en place pas sur une case fusionnée", () => {
    const src = lire("app/api/planning/entries/[id]/route.ts");
    expect(src).toContain("if (champs.driver_id || (deplacee && chauffeurFinal))");
    // driver_id: null (retrait) ne déclenche pas le contrôle.
    expect(src.indexOf("messageRefusAffectation(")).toBeLessThan(src.indexOf('.from("planning_entries")\n    .update(champs)'));
    // Suppression de la ligne hôte : ses alertes « fusionnée avec… » sont closes.
    expect(src).toContain("cloreAlertesFusion(");
  });
});

describe("matrice rôle × route : fusion, doublon, génération", () => {
  const rolesDe = (src: string) => {
    const regle = regleEffective(optionsGarde(src) as any);
    return ROLES.filter((r) => refusPour(regle, r, new Set(["planning"]), r === "chauffeur") === null).sort();
  };

  it("garde de la fusion (GET/PUT) : direction, exploitation, manager (son service par la RLS) ; jamais chauffeur ni comptable", () => {
    const src = lire("lib/planning/fusion-acces.ts");
    expect(rolesDe(src)).toEqual([...ENCADREMENT].sort());
    expect(refusPour(regleEffective(optionsGarde(src) as any), "chauffeur", new Set(["planning"]), true)?.status).toBe(403);
    expect(refusPour(regleEffective(optionsGarde(src) as any), "comptable", new Set(["planning"]), false)?.status).toBe(403);
    // La ligne est lue sous la RLS de la personne : un manager ne voit que son service.
    expect(src).toContain('.eq("organization_id", g.appUser.organization_id)');
    const route = lire("app/api/planning/entries/[id]/fusion/route.ts");
    expect(route).toContain("garderFusion(");
    expect((route.match(/garderFusion\(/g) ?? []).length).toBe(2);
  });

  it("« Retirer l'affectation » (doublon) : encadrement seulement, ligne de l'organisation, case réellement fusionnée, trace d'audit", () => {
    const f = "app/api/planning/entries/[id]/doublon-fusion/route.ts";
    const src = lire(f);
    expect(rolesDe(src)).toEqual([...ENCADREMENT].sort());
    expect(src).toContain("if (!g.ok) return g.reponse;");
    expect(src.indexOf("if (!g.ok)")).toBeLessThan(src.indexOf('.from("planning_entries")'));
    expect(src).toContain('.eq("organization_id", appUser.organization_id)');
    // Jamais une affectation ordinaire : refus tant que la case n'est pas fusionnée ce jour-là.
    expect(src.indexOf("if (!verrou)")).toBeLessThan(src.indexOf(".delete()"));
    expect(src).toContain('.eq("status", "planned")');
    expect(src).toContain('action: "planning_doublon_fusion_retire"');
    expect(src).toContain("noterModificationPlanning(");
    expect(Object.keys(ACTIONS_AUDIT)).toContain("planning_doublon_fusion_retire");
    // Un seul handler : DELETE.
    expect([...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1])).toEqual(["DELETE"]);
  });

  it("la fusion est tracée et signale ses doublons ; la génération de la semaine suivante est inchangée côté rôles", () => {
    const route = lire("app/api/planning/entries/[id]/fusion/route.ts");
    expect(route).toContain('action: "tournee_fusion_modifiee"');
    expect(route).toContain("doublonsDeLaFusion(");
    expect(route).toContain("synchroniserAlertesFusion(");
    for (const f of ["app/api/planning/semaine-suivante/generer/route.ts", "app/api/planning/semaine-suivante/regenerer/route.ts", "app/api/planning/semaine-suivante/confirmer/route.ts"]) {
      expect(rolesDe(lire(f)), f).toEqual([...ENCADREMENT].sort());
    }
  });

  it("génération (jeudi, à la demande, régénération) et envoi du vendredi : cases fusionnées ignorées, doublon = rappel", () => {
    const serveur = lire("lib/planning/semaines-auto-serveur.ts");
    expect(serveur).toContain("clesTourneeJour(verrous, s.id)");
    expect(serveur).toContain("doublonsDeLaSemaine(");
    expect(serveur).toContain("doublonsFusion: doublons");
    expect(serveur).toContain("messageRappelDoublonFusion(");
    expect(serveur.indexOf("verrousDeLaPeriode(admin")).toBeLessThan(serveur.indexOf("planifierSemaineSuivante({"));
    // Les trois chemins de génération passent par genererSemaine.
    for (const f of ["app/api/planning/semaine-suivante/generer/route.ts", "app/api/planning/semaine-suivante/regenerer/route.ts", "app/api/cron/planning-semaine-suivante/route.ts"]) expect(lire(f), f).toContain("genererSemaine(");
    expect(lire("lib/planning/semaines-auto.ts")).toContain("PUBLICATION_AUTO_SI_MODIFIE = false");
  });
});

describe("publication, rappels aux chauffeurs, surveillance, « À traiter »", () => {
  it("la publication n'annonce pas les cases fusionnées (tournées et changements)", () => {
    const src = lire("lib/planning/publication-serveur.ts");
    expect(src.match(/sansFusionnees\(/g)?.length).toBeGreaterThanOrEqual(2);
    // Les changements d'une case fusionnée sont tout de même effacés (jamais annoncés, jamais accumulés).
    expect(src).toContain("changementsTous.map((c) => c.id)");
  });

  it("rappel de la veille et récapitulatif du vendredi : cases fusionnées ignorées, tournée hôte annoncée « fusionnée avec … »", () => {
    for (const f of ["app/api/cron/daily-planning-reminder/route.ts", "app/api/cron/weekly-planning-digest/route.ts"]) {
      const src = lire(f);
      expect(src, f).toContain("sansFusionnees(");
      expect(src, f).toContain("fusionneeAvec(");
      expect(src, f).toContain("CRON_SECRET");
    }
  });

  it("le chauffeur de la tournée hôte voit « fusionnée avec 105 » seulement (jamais le détail des autres tournées)", () => {
    const page = lire("app/(dashboard)/moi/planning/page.tsx");
    expect(page).toContain("fusionneeAvec(");
    expect(page).toContain("lireOriginesFusion(");
    // Pas la répartition : ni villages ni chauffeurs des tournées d'origine.
    expect(page).not.toContain("lireFusions(");
    expect(page).not.toContain("planning_entry_repartition");
  });

  it("surveillance, clôture de la journée et « À traiter » : tournée fusionnée ni « sans chauffeur » ni « non démarrée »", () => {
    expect(lire("lib/exploitation/surveillance-serveur.ts")).toContain("marquerFusionneesAujourdhuiDemain(");
    expect(lire("lib/exploitation/surveillance.ts")).toContain("e.fusionnee");
    expect(lire("lib/exploitation/cloture-serveur.ts")).toContain("marquerFusionneesAujourdhuiDemain(");
    expect(lire("lib/exploitation/cloture.ts")).toContain("!e.fusionnee");
    const serveur = lire("lib/a-traiter/serveur.ts");
    expect(serveur).toContain("marquerFusionneesAujourdhuiDemain(");
    expect(serveur.match(/!t\.fusionnee/g)?.length).toBe(2);
  });

  it("« À traiter » : badge doublon lu sous la RLS, manager borné à son service, jamais lu hors de l'écran du planning", () => {
    const src = lire("lib/a-traiter/serveur.ts");
    const bloc = src.slice(src.indexOf('type: "planning_doublon_fusion"'), src.indexOf('type: "tournee_non_demarree"'));
    expect(bloc).toContain('ecran: "exploitation.planning"');
    expect(bloc).toContain("verrousDeLaPeriode(supabase, org");
    expect(bloc).toContain("doublonsFusion(");
    expect(bloc).toContain("dansLePerimetre(appUser.role");
    expect(bloc).toContain("lienPlanning(");
  });
});

describe("migrations : additives, rejouables, enum séparé, aucune policy amputée", () => {
  const enumSql = lire("supabase/migrations/20261111000005_alerte_planning_fusion_type.sql");
  const lecture = lire("supabase/migrations/20261111000006_alerte_planning_fusion_lecture.sql");
  const precedente = lire("supabase/migrations/20261111000003_alerte_planning_a_confirmer_unique.sql");
  const sansCommentaires = (s: string) => s.replace(/--.*$/gm, "");

  it("la valeur d'enum est seule dans son fichier ; l'autre fichier ne l'ajoute pas et ne l'utilise que comme texte", () => {
    expect(sansCommentaires(enumSql).trim()).toBe("alter type public.alert_type add value if not exists 'planning_fusion';");
    expect(lecture).not.toMatch(/add value/);
    expect(sansCommentaires(lecture)).not.toMatch(/type = 'planning_fusion'/);
    expect(sansCommentaires(lecture)).toContain("type::text not in");
  });

  it("numérotation : à la suite de la dernière migration, enum avant la lecture", () => {
    expect("20261111000005_alerte_planning_fusion_type.sql" < "20261111000006_alerte_planning_fusion_lecture.sql").toBe(true);
    expect("20261111000004_planning_semaines_auto_genere_manuel.sql" < "20261111000005_alerte_planning_fusion_type.sql").toBe(true);
  });

  it("les deux policies reprennent EXACTEMENT celles de 20261111000003, plus le nouveau type dans chaque liste", () => {
    const listes = (s: string) => [...s.matchAll(/type::text not in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    const avant = listes(precedente);
    const apres = listes(lecture);
    expect(avant).toHaveLength(3);
    expect(apres).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      // Aucun type retiré, un seul ajouté, à la fin.
      expect(apres[i]).toEqual([...avant[i]!, "planning_fusion"]);
      expect(avant[i]).toContain("planning_a_confirmer");
    }
    // Même texte, au nouveau type près : les deux policies, rien d'autre.
    const normaliser = (s: string) => sansCommentaires(s).replace(/, 'planning_fusion'/g, "").replace(/\s+/g, " ");
    const corps = (s: string) => normaliser(s).slice(normaliser(s).indexOf('alter policy "alerts: read within org'));
    expect(corps(lecture)).toBe(corps(precedente));
    expect(lecture).toContain('alter policy "alerts: read within org for manager-like and comptable" on public.alerts');
    expect(lecture).toContain('alter policy "alerts: manager-like can acknowledge" on public.alerts');
  });

  it("additives : ni suppression de donnée, de table, de colonne ni de policy", () => {
    for (const f of [enumSql, lecture]) {
      expect(/drop (table|column|policy|trigger)|delete from|truncate|alter table .* drop/i.test(sansCommentaires(f)), "pas destructif").toBe(false);
    }
  });

  it("le code tolère l'absence des migrations (type d'alerte, tables de fusion)", () => {
    const src = lire("lib/planning/fusion-verrou-serveur.ts");
    expect(src).toContain("estValeurEnumInconnue");
    expect(src).toContain("estSchemaManquant");
    expect(src).toContain("typeAbsent");
    expect(lire("lib/a-traiter/serveur.ts")).toContain("planning_doublon_fusion");
  });
});

describe("vercel.json : plan Hobby, aucun cron plus fréquent qu'une fois par jour", () => {
  const crons = JSON.parse(lire("vercel.json")).crons as { path: string; schedule: string }[];

  it("tous les crons sont quotidiens ou plus rares (minute et heure fixes), et rien n'a été ajouté pour la fusion", () => {
    for (const c of crons) {
      const [minute, heure] = c.schedule.split(" ");
      expect(/^\d+$/.test(minute!), `${c.path} : minute fixe`).toBe(true);
      expect(/^\d+$/.test(heure!), `${c.path} : heure fixe`).toBe(true);
    }
    expect(crons.filter((c) => /fusion/.test(c.path))).toEqual([]);
    expect(crons).toHaveLength(14);
  });

  it("les crons du planning gardent leur rythme (jeudi 4 h, vendredi 15 h et 16 h UTC)", () => {
    expect(crons.find((c) => c.path === "/api/cron/planning-semaine-suivante")?.schedule).toBe("0 4 * * 4");
    expect(crons.filter((c) => c.path.startsWith("/api/cron/planning-envoi-auto")).map((c) => c.schedule)).toEqual(["0 15 * * 5", "0 16 * * 5"]);
  });
});

describe("interface : marque GODAC, pas de jaune, pas de palette en dur, mobile 360 px", () => {
  const composants = lire("components/planning/OuvertureFusion.tsx");
  const bloc = composants.slice(composants.indexOf("// Tournée d'origine d'une fusion"));
  const PALETTE = /\b(?:bg|text|border|ring|from|via|to)-(?:red|green|emerald|amber|yellow|lime|blue|sky|indigo|violet|purple|pink|rose|gray|slate|zinc|neutral|stone|orange|teal|cyan)-\d{2,3}\b/;

  it("aucune couleur de palette en dur ; pastille marine, rouge GODAC #d62718 en style inline, jamais de jaune", () => {
    for (const f of ["components/planning/OuvertureFusion.tsx", "components/planning/AffectationsJour.tsx", "components/planning/AffectationsGrille.tsx", "components/planning/AffectationsMobile.tsx", "components/planning/FeuilleRepartir.tsx"]) {
      expect(PALETTE.test(lire(f)), f).toBe(false);
    }
    expect(bloc).toContain("bg-marine");
    expect(bloc).toContain("#d62718");
    expect(bloc).toContain("btn-dark");
    expect(/gold|yellow|jaune|amber/i.test(bloc)).toBe(false);
  });

  it("téléphone : boutons pleine largeur de 48 px, lignes qui passent à la ligne, aucun défilement horizontal ajouté", () => {
    expect(bloc).toContain("max-md:min-h-[48px]");
    expect(bloc).toContain("max-md:w-full");
    expect(bloc).toContain("flex-wrap");
    expect(bloc).toContain("min-w-0");
    expect(bloc).not.toContain("overflow-x-auto");
    expect(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/.test(bloc)).toBe(false);
    // La carte verrouillée de la vue Jour (téléphone compris) n'a ni zone de dépôt ni bouton « + ».
    const jour = lire("components/planning/AffectationsJour.tsx");
    const carte = jour.slice(jour.indexOf("if (verrou) {"), jour.indexOf("return (\n    <li>\n      <Depot"));
    expect(carte).toContain("EncartFusionnee");
    expect(carte).not.toContain("<Depot");
    expect(carte).not.toContain("ctx.ouvrirCase");
  });

  it("vues Jour, Semaine et Mois : case verrouillée sans zone de dépôt, message clair à la place du choix de chauffeur", () => {
    const grille = lire("components/planning/AffectationsGrille.tsx");
    expect(grille).toContain("actif={ctx.glisser && !verrou}");
    expect(grille).toContain("<CaseFusionnee");
    const affectations = lire("components/planning/Affectations.tsx");
    // Clic, dépôt et « toute la semaine » : le message « Cette tournée est fusionnée avec la n°… ».
    expect(affectations.match(/messageVerrou\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(affectations).toContain("compteurs.fusionnees");
    expect(affectations).toContain("<BandeauDoublons />");
  });
});
