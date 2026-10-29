import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_ETAPES, ID_TOURNEE_LIBRE, ajouterEtape, arretsVirtuels, deplacerEtape, estDerniere, estIdLibre, optimiserEtapes, pointsDeLaMission, retirerEtape, traceGpsAutorisee, tourneeVirtuelle, type Destination } from "@/lib/go-lieux/mission";

const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const d = (n: number, lat = 45 + n / 100, lng = 4): Destination => ({ libelle: `P${n}`, adresse: `${n} rue`, lat, lng });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("étapes (1 à 3, ordre choisi)", () => {
  it("au plus 3 étapes, sans doublon ni la destination", () => {
    let e: Destination[] = [];
    for (let i = 1; i <= MAX_ETAPES; i++) {
      const r = ajouterEtape(e, d(i), d(9));
      expect(r.ok).toBe(true);
      if (r.ok) e = r.etapes;
    }
    expect(ajouterEtape(e, d(5), d(9))).toEqual({ ok: false, motif: "plafond" });
    expect(ajouterEtape([d(1)], d(1), d(9))).toEqual({ ok: false, motif: "doublon" });
    expect(ajouterEtape([], d(9), d(9))).toEqual({ ok: false, motif: "doublon" });
  });
  it("déplace et retire dans l'ordre choisi", () => {
    const e = [d(1), d(2), d(3)];
    expect(deplacerEtape(e, 0, 1).map((x) => x.libelle)).toEqual(["P2", "P1", "P3"]);
    expect(deplacerEtape(e, 0, -1)).toEqual(e);
    expect(deplacerEtape(e, 2, 1)).toEqual(e);
    expect(retirerEtape(e, 1).map((x) => x.libelle)).toEqual(["P1", "P3"]);
  });
  it("« Optimiser l'ordre » est calculé sur place (optimiseur existant, aucun appel serveur, donc aucun quota) et finit à la destination", () => {
    const dest = d(0, 45, 4);
    const ordre = optimiserEtapes({ lat: 45.5, lng: 4 }, [d(1, 45.05), d(2, 45.4), d(3, 45.1)], dest);
    expect(ordre.map((x) => x.libelle)).toEqual(["P2", "P3", "P1"]);
    const src = sansCommentaires(readFileSync("lib/go-lieux/mission.ts", "utf8"));
    expect(src).not.toMatch(/fetch\(|\/api\/|supabase/);
  });
});

describe("mission libre : arrêts virtuels, rien en base", () => {
  const m = { etapes: [d(1)], destination: d(2) };
  it("étapes puis destination, statut selon les arrêts atteints", () => {
    expect(pointsDeLaMission(m).map((x) => x.libelle)).toEqual(["P1", "P2"]);
    const a = arretsVirtuels(m, new Set([0]));
    expect(a.map((s) => s.status)).toEqual(["delivered", "pending"]);
    expect(estDerniere(m, 1)).toBe(true);
    expect(estDerniere(m, 0)).toBe(false);
  });
  it("identifiants virtuels : jamais un UUID, donc refusés par toutes les routes de tournée", () => {
    const run = tourneeVirtuelle();
    expect(run.id).toBe(ID_TOURNEE_LIBRE);
    expect(UUID.test(run.id)).toBe(false);
    for (const s of arretsVirtuels(m, new Set())) {
      expect(UUID.test(s.id)).toBe(false);
      expect(estIdLibre(s.id)).toBe(true);
    }
  });
  it("aucune écriture de tournée : le code « Aller à… » n'appelle aucune route ni table de tournée", () => {
    const fichiers = ["components/go-aller-a/AllerA.tsx", "components/go-aller-a/NavigationLibre.tsx", "components/go-aller-a/EcranDestination.tsx", "components/go-aller-a/EcranArrivee.tsx", "components/go-aller-a/useLieux.ts", "components/go-aller-a/usePosition.ts", "components/go-aller-a/EnregistrerFavori.tsx", "lib/go-lieux/serveur.ts", "lib/go-lieux/mission.ts", "app/api/go/lieux/route.ts", "app/api/go/lieux/[id]/route.ts"];
    for (const f of fichiers) {
      const src = sansCommentaires(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/delivery_run|delivery_stop|delivery_address|time_clock|route_optimization|usage_events|stock_|planning/i);
      expect(src, f).not.toMatch(/\/api\/colis\/(trace|position|arrets|optimiser|tournees\/[^"'`]+|bordereau|etiquette|affectations)/);
      if (f.endsWith("AllerA.tsx")) expect(src.match(/\/api\/colis\/tournees/g)).toHaveLength(1); // lecture seule : « Retour à ma tournée »
    }
    // La seule lecture de tournée est un GET (aucune méthode d'écriture dans ce fichier pour cette URL).
    expect(readFileSync("components/go-aller-a/AllerA.tsx", "utf8")).not.toMatch(/method:\s*"(POST|PATCH|PUT|DELETE)"/);
  });
});

describe("RGPD : aucune trace GPS ni position enregistrée pour une navigation libre", () => {
  it("la trace d'historique est refusée pour la tournée virtuelle et ses arrêts, acceptée pour une vraie tournée", () => {
    expect(traceGpsAutorisee(ID_TOURNEE_LIBRE)).toBe(false);
    expect(traceGpsAutorisee("libre-0")).toBe(false);
    expect(traceGpsAutorisee(null)).toBe(false);
    expect(traceGpsAutorisee("3f2c8c3e-9b0a-4a4e-8d57-0d6f4f0a1b2c")).toBe(true);
  });
  it("useTraceGps vérifie cette règle avant toute écoute de position", () => {
    const src = readFileSync("components/colis/useTraceGps.ts", "utf8");
    expect(src).toContain("traceGpsAutorisee(runId)");
    expect(src.indexOf("traceGpsAutorisee(runId)")).toBeLessThan(src.indexOf("watchPosition"));
  });
  it("les écrans « Aller à… » ne montent ni useTraceGps ni aucun envoi de position", () => {
    for (const f of ["AllerA.tsx", "NavigationLibre.tsx", "EcranDestination.tsx", "EcranArrivee.tsx", "usePosition.ts", "useLieux.ts"]) {
      const src = readFileSync(`components/go-aller-a/${f}`, "utf8");
      expect(src, f).not.toMatch(/useTraceGps|trace-gps|\/api\/colis\/(trace|position)|localStorage\.setItem\([^)]*(lat|position|trace)/);
    }
    expect(readFileSync("components/go-aller-a/NavigationLibre.tsx", "utf8")).toContain("traceActive={false}");
    expect(readFileSync("components/go-aller-a/usePosition.ts", "utf8")).not.toMatch(/fetch\(/);
  });
  it("GoNavigation ne remonte pas la position et n'appelle pas l'itinéraire de tournée en mission libre", () => {
    const src = readFileSync("components/colis/GoNavigation.tsx", "utf8");
    expect(src).toContain("if (!p.libre) onPosition(pos, g.coords.accuracy)");
    expect(src).toMatch(/if \(!prete \|\| p\.libre\) return;/);
    // Voie rapide sans run_id : la requête de mission libre ne contient pas de run_id.
    expect(src).toMatch(/p\.libre && depuis && virtuel[^?]*\? \{ depuis, cible: "retour", point:/);
  });
  it("l'API d'itinéraire sans run_id ne sert que la voie rapide (aucune lecture de tournée)", () => {
    const src = readFileSync("app/api/colis/itineraire/route.ts", "utf8");
    expect(src).toContain("run_id: z.string().uuid().optional()");
    expect(src.indexOf("if (!parsed.data.run_id)")).toBeGreaterThan(src.indexOf("Voie rapide"));
    expect(src.indexOf("if (!parsed.data.run_id)")).toBeLessThan(src.indexOf("await tourneeParId"));
  });
});
