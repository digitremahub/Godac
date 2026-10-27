import { describe, expect, it } from "vitest";
import {
  VITRINE_PATHS,
  decideRoutageDomaine,
  estCheminTechnique,
  normaliserHote,
  typeHote,
  urlCanoniqueVitrine,
  urlSitePourHote,
} from "../routage";

const PASSER = { action: "passer" };
const d = (host: string, pathname: string, extra: { search?: string; connecte?: boolean | null; forwardedHost?: string } = {}) =>
  decideRoutageDomaine({ host, pathname, ...extra });

describe("normaliserHote / typeHote", () => {
  it("normalise port, casse, liste x-forwarded-host", () => {
    expect(normaliserHote("GODAC.FR:443")).toBe("godac.fr");
    expect(normaliserHote("godac-v2.vercel.app", "godac.app, proxy.interne")).toBe("godac.app");
    expect(normaliserHote(null)).toBe("");
  });
  it("classe les hôtes", () => {
    expect(typeHote("godac.fr")).toBe("vitrine");
    expect(typeHote("www.godac.fr")).toBe("vitrine");
    expect(typeHote("godac.app")).toBe("app");
    expect(typeHote("www.godac.app")).toBe("app");
    expect(typeHote("godac-v2.vercel.app")).toBe("autre");
    expect(typeHote("localhost")).toBe("autre");
    expect(typeHote("evil-godac.fr")).toBe("autre");
    expect(typeHote("godac.fr.evil.com")).toBe("autre");
  });
});

describe("godac.app", () => {
  it("« / » non connecté -> 307 /sign-in", () => {
    expect(d("godac.app", "/", { connecte: false })).toEqual({ action: "rediriger", status: 307, url: "https://godac.app/sign-in" });
  });
  it("« / » connecté -> 307 /dashboard (www inclus)", () => {
    expect(d("www.godac.app", "/", { connecte: true })).toEqual({ action: "rediriger", status: 307, url: "https://godac.app/dashboard" });
  });
  it("session inconnue : « / » laissé passer", () => {
    expect(d("godac.app", "/")).toEqual(PASSER);
    expect(d("godac.app", "/", { connecte: null })).toEqual(PASSER);
  });
  it("pages marketing publiques et routes applicatives restent accessibles", () => {
    for (const p of [...VITRINE_PATHS.filter((x) => x !== "/"), "/sign-in", "/dashboard", "/livreur", "/demo"]) {
      expect(d("godac.app", p, { connecte: false })).toEqual(PASSER);
    }
  });
  it("x-forwarded-host prioritaire", () => {
    expect(d("godac-v2.vercel.app", "/", { forwardedHost: "godac.app", connecte: false }).action).toBe("rediriger");
  });
});

describe("godac.fr", () => {
  it("sert chaque page de la vitrine sans redirection", () => {
    for (const p of VITRINE_PATHS) {
      expect(d("godac.fr", p, { connecte: true })).toEqual(PASSER);
      expect(d("www.godac.fr", p)).toEqual(PASSER);
    }
    expect(d("godac.fr", "/cgv/")).toEqual(PASSER);
  });
  it("routes applicatives -> 308 vers godac.app, chemin et query conservés", () => {
    expect(d("godac.fr", "/sign-in")).toEqual({ action: "rediriger", status: 308, url: "https://godac.app/sign-in" });
    expect(d("godac.fr", "/dashboard")).toEqual({ action: "rediriger", status: 308, url: "https://godac.app/dashboard" });
    expect(d("godac.fr", "/auth/callback", { search: "?code=abc&next=%2Fdashboard" })).toEqual({
      action: "rediriger",
      status: 308,
      url: "https://godac.app/auth/callback?code=abc&next=%2Fdashboard",
    });
    for (const p of ["/livreur/tournee", "/prestataire/xyz", "/join/tok", "/demo", "/scan/driver", "/godac-staff", "/onboarding"]) {
      const r = d("godac.fr", p);
      expect(r).toEqual({ action: "rediriger", status: 308, url: `https://godac.app${p}` });
    }
  });
  it("une page vitrine avec sous-chemin n'est pas vitrine", () => {
    expect(d("godac.fr", "/modules/autre").action).toBe("rediriger");
  });
});

describe("chemins techniques jamais redirigés", () => {
  const chemins = [
    "/api/webhooks/stripe",
    "/api/webhooks/supabase",
    "/api/cron/reset-demo",
    "/api/auth/passkey/login/options",
    "/api/public/demo-request",
    "/api",
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/sw.js",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/icon.png",
    "/apple-icon.png",
    "/robots.txt",
    "/sitemap.xml",
    "/brand/logo.svg",
    "/zxing/zxing.wasm",
    "/.well-known/assetlinks.json",
    "/images/photo.JPG",
  ];
  it.each(chemins)("%s passe sur tous les hôtes", (p) => {
    expect(estCheminTechnique(p)).toBe(true);
    for (const h of ["godac.fr", "www.godac.fr", "godac.app", "godac-v2.vercel.app", "localhost:3000"]) {
      expect(d(h, p, { connecte: false, search: "?x=1" })).toEqual(PASSER);
    }
  });
  it("une page applicative n'est pas technique", () => {
    expect(estCheminTechnique("/dashboard")).toBe(false);
    expect(estCheminTechnique("/apiary")).toBe(false);
  });
});

describe("previews et développement : comportement inchangé", () => {
  it.each(["godac-v2.vercel.app", "godac-git-feat-x-team.vercel.app", "localhost:3000", "127.0.0.1:3000", "godac.fr.evil.com", ""])(
    "%s : aucune redirection",
    (h) => {
      for (const p of ["/", "/dashboard", "/sign-in", "/contact", "/livreur"]) {
        expect(d(h, p, { connecte: true })).toEqual(PASSER);
        expect(d(h, p, { connecte: false })).toEqual(PASSER);
      }
    },
  );
});

describe("liens absolus", () => {
  it("canonique vitrine", () => {
    expect(urlCanoniqueVitrine("/")).toBe("https://godac.fr");
    expect(urlCanoniqueVitrine("/contact")).toBe("https://godac.fr/contact");
    expect(urlCanoniqueVitrine("/cgv/")).toBe("https://godac.fr/cgv");
    expect(urlCanoniqueVitrine("/dashboard")).toBeNull();
  });
  it("base du sitemap/robots selon l'hôte", () => {
    expect(urlSitePourHote("godac.fr", "https://godac.app")).toBe("https://godac.fr");
    expect(urlSitePourHote("godac.app", "https://x.test")).toBe("https://godac.app");
    expect(urlSitePourHote("godac-v2.vercel.app", "https://godac.app")).toBe("https://godac.app");
  });
});

describe("cohérence avec le sitemap", () => {
  it("toutes les pages du sitemap sont des pages de la vitrine", async () => {
    const { PAGES_PUBLIQUES } = await import("@/lib/site");
    for (const p of PAGES_PUBLIQUES) expect(VITRINE_PATHS).toContain(p.path);
    expect(VITRINE_PATHS.length).toBe(PAGES_PUBLIQUES.length);
  });
});
