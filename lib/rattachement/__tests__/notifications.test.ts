import { describe, expect, it } from "vitest";
import {
  messageAmendeAttribuee,
  messageAmendeStatut,
  messageContestationAttribuee,
  messageContestationCloturee,
  messageExplicationChauffeur,
} from "@/lib/rattachement/notifications";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

describe("notifications au concerné", () => {
  it("amende attribuée : date, véhicule, montant, date limite", () => {
    expect(messageAmendeAttribuee({ infractionAt: "2026-10-12T08:00:00Z", immatriculation: "AB-123-CD", montant: 135, dateLimite: "2026-10-26" })).toBe(
      "Une amende du 12/10 (véhicule AB-123-CD) vous est attribuée : 135 €, à régler avant le 26/10/2026.",
    );
  });

  it("amende : montant minoré et n° d'avis", () => {
    const m = messageAmendeAttribuee({ infractionAt: "2026-10-12T08:00:00Z", immatriculation: null, montant: 135, montantMinore: 90, reference: "123456" });
    expect(m).toBe("Une amende du 12/10 vous est attribuée : 135 € (90 € si réglée rapidement). Avis n°123456.");
  });

  it("amende : changement de statut", () => {
    expect(messageAmendeStatut({ infractionAt: "2026-10-12T08:00:00Z", immatriculation: "AB-123-CD" }, "paid")).toBe("Votre amende du 12/10 (véhicule AB-123-CD) a été marquée réglée.");
  });

  it("contestation attribuée : colis et date de livraison", () => {
    expect(messageContestationAttribuee({ parcelCode: "X123", clientName: null, livreLe: "2026-10-12T09:30:00Z", deliveryDate: null, reason: null })).toBe(
      "Une contestation client vous concerne : colis X123 livré le 12/10/2026.",
    );
  });

  it("contestation clôturée", () => {
    expect(messageContestationCloturee({ parcelCode: "X123", clientName: null }, "resolved")).toBe("La contestation client (colis X123) a été réglée.");
  });

  it("explication du chauffeur vers l'encadrement, bornée à 480 caractères", () => {
    expect(messageExplicationChauffeur("Paul", "amende", 2, "Je n'avais pas le véhicule")).toBe("Paul a ajouté une explication (2 photos) sur son amende : « Je n'avais pas le véhicule »");
    expect(messageContestationAttribuee({ parcelCode: null, clientName: null, livreLe: null, deliveryDate: null, reason: "x".repeat(600) }).length).toBeLessThanOrEqual(480);
  });
});

describe("tolérance à la migration absente", () => {
  it("reconnaît une colonne ou une table inconnue", () => {
    expect(estSchemaManquant({ code: "42703", message: "column fines.match_details does not exist" })).toBe(true);
    expect(estSchemaManquant({ code: "PGRST204", message: "Could not find the 'document_paths' column" })).toBe(true);
    expect(estSchemaManquant({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(estSchemaManquant(null)).toBe(false);
  });
});
