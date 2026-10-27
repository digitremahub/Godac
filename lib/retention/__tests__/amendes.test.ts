import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({}) }));

import { RETENTION_AMENDES_JOURS, cheminsAmendes, estPurgeable, limiteClotureAmendes } from "../amendes";
import { RETENTION_DAYS, purgerAmendes } from "../purge";

const maintenant = new Date("2026-10-27T10:00:00Z");
const ilYA = (jours: number) => new Date(maintenant.getTime() - jours * 86_400_000).toISOString();

describe("durée annoncée", () => {
  it("un an après la clôture, comme la page de confidentialité", () => {
    expect(RETENTION_AMENDES_JOURS).toBe(365);
    expect(RETENTION_DAYS.fines).toBe(365);
    expect(limiteClotureAmendes(maintenant)).toBe("2025-10-27T10:00:00.000Z");
  });
  it("purgeable : réglée ou classée depuis plus d'un an, jamais une amende en cours", () => {
    expect(estPurgeable({ status: "paid", closed_at: ilYA(366) }, maintenant)).toBe(true);
    expect(estPurgeable({ status: "dismissed", closed_at: ilYA(400) }, maintenant)).toBe(true);
    expect(estPurgeable({ status: "paid", closed_at: ilYA(364) }, maintenant)).toBe(false);
    for (const status of ["pending_identification", "identified", "contested"]) expect(estPurgeable({ status, closed_at: ilYA(900) }, maintenant), status).toBe(false);
    // Sans date de clôture (migration pas appliquée) : jamais.
    expect(estPurgeable({ status: "paid", closed_at: null }, maintenant)).toBe(false);
  });
  it("chemins des pièces : avis, pièces jointes et photos d'échanges, sans doublon ni vide", () => {
    expect(
      cheminsAmendes(
        [{ photo_path: "o/a1/avis.jpg", document_paths: ["o/a1/avis.jpg", "o/a1/piece.pdf", " "] }, { photo_path: null, document_paths: null }],
        [{ photo_paths: ["o/a1/echange.jpg"] }, { photo_paths: null }],
      ).sort(),
    ).toEqual(["o/a1/avis.jpg", "o/a1/echange.jpg", "o/a1/piece.pdf"]);
  });
});

/** Faux client : journalise l'ordre des opérations pour vérifier « fichiers d'abord, lignes ensuite ». */
function fauxAdmin(opts: { lots: { id: string; photo_path: string | null; document_paths: string[] }[][]; echecStockage?: boolean }) {
  const evenements: string[] = [];
  const lots = [...opts.lots];
  const constructeur = (table: string) => {
    let mode: "select" | "delete" = "select";
    const b: any = {
      select: () => b,
      in: () => b,
      not: () => b,
      lt: () => b,
      order: () => b,
      limit: () => b,
      delete: () => {
        mode = "delete";
        return b;
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        let r: unknown;
        if (table === "fines" && mode === "select") {
          const lot = lots.shift() ?? [];
          evenements.push(`lire ${lot.length} amende(s)`);
          r = { data: lot, error: null };
        } else if (table === "case_comments") {
          r = { data: [{ photo_paths: ["o/a1/echange.jpg"] }], error: null };
        } else {
          evenements.push("supprimer les lignes");
          r = { error: null, count: 2 };
        }
        return Promise.resolve(r).then(ok, ko);
      },
    };
    return b;
  };
  return {
    evenements,
    admin: {
      from: constructeur,
      storage: {
        from: (bucket: string) => ({
          remove: async (chemins: string[]) => {
            evenements.push(`effacer ${chemins.length} fichier(s) de ${bucket}`);
            return { error: opts.echecStockage ? { message: "stockage indisponible" } : null };
          },
        }),
      },
    } as never,
  };
}

describe("purge des amendes clôturées", () => {
  const lot = [
    { id: "a1", photo_path: "o/a1/avis.jpg", document_paths: ["o/a1/piece.pdf"] },
    { id: "a2", photo_path: null, document_paths: [] },
  ];
  beforeEach(() => vi.clearAllMocks());

  it("efface d'abord les fichiers, puis les lignes", async () => {
    const { admin, evenements } = fauxAdmin({ lots: [lot, []] });
    const r = await purgerAmendes(admin, maintenant);
    expect(r).toEqual({ fichiers: 3, amendes: 2, erreur: null });
    expect(evenements).toEqual(["lire 2 amende(s)", "effacer 3 fichier(s) de fine-photos", "supprimer les lignes", "lire 0 amende(s)"]);
  });
  it("si l'effacement des fichiers échoue, aucune ligne n'est supprimée (rien d'orphelin)", async () => {
    const { admin, evenements } = fauxAdmin({ lots: [lot, []], echecStockage: true });
    const r = await purgerAmendes(admin, maintenant);
    expect(r.erreur).toContain("stockage indisponible");
    expect(r.amendes).toBe(0);
    expect(evenements).not.toContain("supprimer les lignes");
  });
  it("rien à purger : aucune opération d'effacement", async () => {
    const { admin, evenements } = fauxAdmin({ lots: [[]] });
    expect(await purgerAmendes(admin, maintenant)).toEqual({ fichiers: 0, amendes: 0, erreur: null });
    expect(evenements).toEqual(["lire 0 amende(s)"]);
  });
});
