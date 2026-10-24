import { describe, expect, it } from "vitest";
import { appliquerContacts, libelleContacts, majContacts } from "@/lib/colis/contacts";

const T = "2026-10-24T10:00:00.000Z";

describe("contacts du client", () => {
  it("cocher « Message envoyé » : colonnes, date et libellé du journal", () => {
    const m = majContacts({}, { contact_message: true }, T);
    expect(m?.update).toEqual({ contact_message: true, contact_phone: false, contact_at: T });
    expect(m?.details).toBe("Message envoyé : oui");
  });
  it("rien ne change : pas d'écriture ni de journal", () => {
    expect(majContacts({ contact_message: true }, { contact_message: true }, T)).toBeNull();
    expect(majContacts({}, {}, T)).toBeNull();
  });
  it("les deux cases ensemble", () => {
    const m = majContacts({}, { contact_message: true, contact_phone: true }, T);
    expect(m?.details).toBe("Message envoyé : oui · Eu au téléphone : oui");
  });
  it("décocher une case garde la date tant que l'autre reste cochée, l'efface sinon", () => {
    const avant = { contact_message: true, contact_phone: true, contact_at: "2026-10-24T09:00:00.000Z" };
    expect(majContacts(avant, { contact_phone: false }, T)?.update).toMatchObject({ contact_message: true, contact_phone: false, contact_at: avant.contact_at });
    expect(majContacts({ ...avant, contact_phone: false }, { contact_message: false }, T)?.update).toMatchObject({ contact_at: null });
  });
  it("libellé lisible (historique)", () => {
    expect(libelleContacts({})).toBeNull();
    expect(libelleContacts({ contact_phone: true })).toBe("Eu au téléphone");
    expect(libelleContacts({ contact_message: true, contact_phone: true })).toBe("Message envoyé · Eu au téléphone");
  });
  it("affichage optimiste : seul l'arrêt visé change", () => {
    const r = appliquerContacts([{ id: "a" }, { id: "b" }], "b", { contact_message: true }, T);
    expect(r[0]).toEqual({ id: "a" });
    expect(r[1]).toMatchObject({ id: "b", contact_message: true });
  });
});
