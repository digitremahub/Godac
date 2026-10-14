import { describe, expect, it } from "vitest";
import {
  CODE_QR_MAX,
  LIEUX_LIVRAISON,
  estRamasse,
  libelleLieu,
  libellePreuve,
  libelleStatut,
  normaliserCodeQr,
  photoObligatoire,
  qrObligatoire,
  resumeCodeQr,
  typeArret,
} from "@/lib/colis/livraison";

describe("lieu de livraison", () => {
  it("photo obligatoire seulement pour boîte aux lettres et jardin", () => {
    expect(photoObligatoire("boite_aux_lettres")).toBe(true);
    expect(photoObligatoire("jardin")).toBe(true);
    expect(photoObligatoire("main_propre")).toBe(false);
    expect(photoObligatoire("voisin")).toBe(false);
    expect(photoObligatoire("qr_code")).toBe(false);
  });
  it("QR code obligatoire seulement pour la livraison avec QR code", () => {
    expect(qrObligatoire("qr_code")).toBe(true);
    expect(LIEUX_LIVRAISON.filter((l) => qrObligatoire(l.key)).map((l) => l.key)).toEqual(["qr_code"]);
  });
  it("libellés", () => {
    expect(libelleLieu("jardin")).toBe("Jardin / terrasse");
    expect(libelleLieu("qr_code")).toBe("Avec QR code");
    expect(libelleLieu(null)).toBeNull();
  });
});

describe("code QR de remise", () => {
  it("nettoie la valeur lue", () => {
    expect(normaliserCodeQr("  ABC\n123\t ")).toBe("ABC 123");
    expect(normaliserCodeQr("\u0000\u001f")).toBeNull();
    expect(normaliserCodeQr("")).toBeNull();
    expect(normaliserCodeQr(null)).toBeNull();
    expect(normaliserCodeQr("x".repeat(800))).toHaveLength(CODE_QR_MAX);
  });
  it("abrège les codes longs pour l'affichage", () => {
    expect(resumeCodeQr("RET-4821")).toBe("RET-4821");
    const long = "https://exemple.fr/retrait?id=ABCDEFGHIJKLMNOP";
    const court = resumeCodeQr(long);
    expect(court.length).toBe(28);
    expect(court).toContain("…");
    expect(court.endsWith(long.slice(-9))).toBe(true);
  });
  it("preuve lisible", () => {
    expect(libellePreuve({ delivered_place: "qr_code", proof_code: "RET-4821" })).toBe("Avec QR code (RET-4821)");
    expect(libellePreuve({ delivered_place: "qr_code", proof_code: null })).toBe("Avec QR code");
    expect(libellePreuve({ delivered_place: "boite_aux_lettres", proof_code: "ignoré" })).toBe("Boîte aux lettres");
    expect(libellePreuve({ delivered_place: null })).toBeNull();
  });
});

describe("type d'arrêt", () => {
  it("livraison par défaut", () => {
    expect(typeArret(undefined)).toBe("livraison");
    expect(typeArret(null)).toBe("livraison");
    expect(typeArret("autre")).toBe("livraison");
    expect(typeArret("ramasse")).toBe("ramasse");
    expect(estRamasse({ kind: "ramasse" })).toBe(true);
    expect(estRamasse({})).toBe(false);
  });
  it("statut selon le type", () => {
    expect(libelleStatut({ status: "delivered" })).toBe("Livré");
    expect(libelleStatut({ kind: "ramasse", status: "delivered" })).toBe("Ramassé");
    expect(libelleStatut({ kind: "ramasse", status: "failed" })).toBe("Ramasse manquée");
    expect(libelleStatut({ kind: "livraison", status: "pending" })).toBe("Non fait");
  });
});
