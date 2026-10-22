import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { UserRole } from "@/lib/types/domain";

/**
 * Static guide (Lot B) — one markdown file per topic in
 * content/help/, each scoped to the roles it's relevant for. Listed
 * explicitly (not a directory scan) so Next.js's file tracing bundles
 * exactly these files into the serverless function, and so adding a
 * guide is a deliberate two-line change here, not a silent pickup of
 * any new .md file.
 */
interface HelpGuide {
  slug: string;
  title: string;
  roles: UserRole[];
  file: string;
}

const ALL_ROLES: UserRole[] = ["chauffeur", "manager", "exploitation", "comptable", "direction"];

const GUIDES: HelpGuide[] = [
  { slug: "tournee", title: "Départ et retour de tournée", roles: ["chauffeur", "manager", "exploitation"], file: "tournee.md" },
  {
    slug: "carburant",
    title: "Saisir un ravitaillement et scanner un QR",
    roles: ["chauffeur", "manager", "exploitation", "direction"],
    file: "carburant.md",
  },
  {
    slug: "signalement",
    title: "Signaler un problème sur un véhicule",
    roles: ["chauffeur", "manager", "exploitation", "direction"],
    file: "signalement.md",
  },
  { slug: "conges", title: "Poser un congé", roles: ALL_ROLES, file: "conges.md" },
  {
    slug: "historique",
    title: "Voir mes tournées passées et les rapports",
    roles: ["chauffeur", "manager", "exploitation", "direction"],
    file: "historique.md",
  },
  {
    slug: "alertes",
    title: "Lire et traiter une alerte",
    roles: ["manager", "exploitation", "direction", "comptable"],
    file: "alertes.md",
  },
  { slug: "ticpe", title: "Exporter la TICPE", roles: ["comptable", "exploitation", "direction"], file: "ticpe.md" },
  { slug: "utilisateurs", title: "Inviter un utilisateur", roles: ["exploitation", "direction"], file: "utilisateurs.md" },
];

export interface HelpSource {
  title: string;
  content: string;
}

/** Loaded once per process — the guide files never change at runtime. */
let cache: Map<string, string> | null = null;

function loadFile(file: string): string {
  if (!cache) cache = new Map();
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const text = fs.readFileSync(path.join(process.cwd(), "content", "help", file), "utf-8");
  cache.set(file, text);
  return text;
}

/** Only the guides visible to `role` — never sends a role's irrelevant/other-role content to the AI. */
export function getHelpSourcesForRole(role: UserRole): HelpSource[] {
  return GUIDES.filter((g) => g.roles.includes(role)).map((g) => ({ title: g.title, content: loadFile(g.file) }));
}

/** Every guide, for the platform-level FAQ drafting (lib/assistant/faq.ts) — never sent in a user's own chat turn. */
export function getAllHelpSources(): HelpSource[] {
  return GUIDES.map((g) => ({ title: g.title, content: loadFile(g.file) }));
}
