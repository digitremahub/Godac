import { describe, expect, it } from "vitest";
import {
  JOURS_REMPLACEMENT_CHAUFFEUR,
  TAILLE_MAX_TICKET_OCTETS,
  cheminTicket,
  cheminTicketValide,
  extensionTicket,
  justificatifManquant,
  peutJoindreTicket,
  verifierFichierTicket,
} from "../justificatif";

const ORG = "11111111-1111-1111-1111-111111111111";
const PLEIN = "22222222-2222-2222-2222-222222222222";
const maintenant = new Date("2026-10-27T10:00:00Z");
const plein = (o: Partial<Parameters<typeof peutJoindreTicket>[0]["plein"]> = {}) => ({ driver_id: "chauffeur-1", created_by: "chauffeur-1", occurred_at: "2026-10-26T08:00:00Z", ticket_photo_path: null as string | null, ...o });

describe("type et taille de la photo", () => {
  it("accepte les photos de téléphone, refuse le reste", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic", "IMAGE/JPEG"]) expect(verifierFichierTicket({ mime, taille: 2_000_000 }), mime).toBeNull();
    for (const mime of ["application/pdf", "text/html", "image/svg+xml", "", null, undefined]) expect(verifierFichierTicket({ mime, taille: 1000 }), String(mime)).not.toBeNull();
  });
  it("taille bornée, fichier vide refusé", () => {
    expect(verifierFichierTicket({ mime: "image/jpeg", taille: TAILLE_MAX_TICKET_OCTETS })).toBeNull();
    expect(verifierFichierTicket({ mime: "image/jpeg", taille: TAILLE_MAX_TICKET_OCTETS + 1 })).toMatch(/lourde/);
    expect(verifierFichierTicket({ mime: "image/jpeg", taille: 0 })).toMatch(/vide/);
    expect(verifierFichierTicket({ mime: "image/jpeg", taille: Number.NaN })).not.toBeNull();
  });
  it("extension de stockage déduite du type", () => {
    expect(extensionTicket("image/jpeg")).toBe("jpg");
    expect(extensionTicket("image/gif")).toBeNull();
  });
});

describe("chemin dans le dossier de l'organisation", () => {
  it("construit <organisation>/<plein>/ticket-<horodatage>.<ext>", () => {
    expect(cheminTicket(ORG, PLEIN, "jpg", 1761559200000)).toBe(`${ORG}/${PLEIN}/ticket-1761559200000.jpg`);
  });
  it("accepte le chemin du parcours OCR et ceux de cette route", () => {
    expect(cheminTicketValide(`${ORG}/${PLEIN}/ticket.jpg`, ORG, PLEIN)).toBe(true);
    expect(cheminTicketValide(cheminTicket(ORG, PLEIN, "png", 1761559200000), ORG, PLEIN)).toBe(true);
  });
  it("refuse une autre organisation, un autre plein, un sous-dossier, une remontée, une autre extension", () => {
    const autre = "33333333-3333-3333-3333-333333333333";
    for (const c of [
      `${autre}/${PLEIN}/ticket.jpg`,
      `${ORG}/${autre}/ticket.jpg`,
      `${ORG}/${PLEIN}/sous/ticket.jpg`,
      `${ORG}/${PLEIN}/../${autre}/ticket.jpg`,
      `${ORG}/${PLEIN}/ticket.pdf`,
      `${ORG}/${PLEIN}/autre.jpg`,
      `${ORG}/${PLEIN}/`,
      "",
      null,
      undefined,
    ]) {
      expect(cheminTicketValide(c as string, ORG, PLEIN), String(c)).toBe(false);
    }
  });
});

describe("qui peut joindre ou remplacer le justificatif", () => {
  it("le chauffeur de son plein, ou celui qui l'a saisi pour lui", () => {
    expect(peutJoindreTicket({ role: "chauffeur", userId: "chauffeur-1", plein: plein(), maintenant })).toBe(true);
    expect(peutJoindreTicket({ role: "chauffeur", userId: "aide-1", plein: plein({ created_by: "aide-1" }), maintenant })).toBe(true);
  });
  it("jamais le plein d'un autre chauffeur", () => {
    expect(peutJoindreTicket({ role: "chauffeur", userId: "chauffeur-2", plein: plein(), maintenant })).toBe(false);
  });
  it("le chauffeur ne remplace une photo existante que dans les 7 jours", () => {
    const recent = plein({ ticket_photo_path: "x/ticket.jpg" });
    const ancien = plein({ ticket_photo_path: "x/ticket.jpg", occurred_at: new Date(maintenant.getTime() - (JOURS_REMPLACEMENT_CHAUFFEUR + 1) * 86_400_000).toISOString() });
    expect(peutJoindreTicket({ role: "chauffeur", userId: "chauffeur-1", plein: recent, maintenant })).toBe(true);
    expect(peutJoindreTicket({ role: "chauffeur", userId: "chauffeur-1", plein: ancien, maintenant })).toBe(false);
    // Sans photo, il peut toujours en joindre une.
    expect(peutJoindreTicket({ role: "chauffeur", userId: "chauffeur-1", plein: plein({ occurred_at: "2026-01-01T08:00:00Z" }), maintenant })).toBe(true);
  });
  it("l'encadrement et le comptable corrigent (le périmètre est celui de la lecture du plein sous RLS)", () => {
    for (const role of ["manager", "exploitation", "direction", "comptable"]) expect(peutJoindreTicket({ role, userId: "x", plein: plein({ ticket_photo_path: "x/ticket.jpg", occurred_at: "2025-01-01T08:00:00Z" }), maintenant }), role).toBe(true);
  });
  it("rôle inconnu : non", () => {
    expect(peutJoindreTicket({ role: "visiteur", userId: "x", plein: plein(), maintenant })).toBe(false);
  });
});

describe("justificatif manquant", () => {
  it("un plein enregistré sans photo", () => {
    expect(justificatifManquant({ status: "manual", ticket_photo_path: null })).toBe(true);
    expect(justificatifManquant({ status: "validated" })).toBe(true);
    expect(justificatifManquant({ status: "manual", ticket_photo_path: "x/ticket.jpg" })).toBe(false);
    expect(justificatifManquant({ status: "pending_ocr", ticket_photo_path: null })).toBe(false);
  });
});
