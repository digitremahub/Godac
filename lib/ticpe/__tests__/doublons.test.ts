import { describe, expect, it } from "vitest";
import { BAREME_PAR_DEFAUT } from "@/lib/ticpe/bareme";
import { departager, doublonsProbables, exclureDoublons, litresProches, pleinsEcartes } from "@/lib/ticpe/doublons";
import { eligibiliteVehicule } from "@/lib/ticpe/eligibilite";
import { appliquerPlafond, calculerPlein, totaliser, type PleinTicpe } from "@/lib/ticpe/montant";
import { REGLAGES_PAR_DEFAUT } from "@/lib/ticpe/reglages";

const elig = eligibiliteVehicule({ type: "PL", ptac_kg: 19000, fuel_type: "Diesel" }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true });
const ctx = { eligibilite: elig, reglages: REGLAGES_PAR_DEFAUT, bareme: BAREME_PAR_DEFAUT, surcharges: [] };
const plein = (x: Partial<PleinTicpe> & { id: string }): PleinTicpe => ({ vehicle_id: "v1", occurred_at: "2026-03-10T11:00:00Z", liters: 300, status: "validated", product: "gazole", ...x });
const montant = (pleins: PleinTicpe[]) => {
  const brutes = pleins.map((p) => calculerPlein(p, ctx));
  return appliquerPlafond(exclureDoublons(brutes, pleins), null, "annuel").lignes;
};

// Scénario de l'audit : ticket de station à 12:00 (Paris) et ligne de relevé de carte datée 00:00.
const ticket = plein({ id: "ticket", occurred_at: "2026-03-10T11:00:00Z", ticket_photo_path: "t.jpg" });
const releve = plein({ id: "releve", occurred_at: "2026-03-09T23:00:00Z", ticpe_justificatif: "releve_carte" });

describe("doublon ticket + relevé de carte", () => {
  it("12:00 + 00:00 le même jour de Paris : 46,68 € et non 93,36 €", () => {
    const lignes = montant([ticket, releve]);
    expect(totaliser(lignes).montant).toBe(46.68);
    const ecartee = lignes.find((l) => l.statut === "exclu")!;
    expect(ecartee.id).toBe("releve");
    expect(ecartee.doublon).toBe(true);
    expect(ecartee.raison).toContain("deux pleins distincts");
    expect(ecartee.montant).toBe(0);
    expect(lignes.find((l) => l.id === "ticket")!.montant).toBe(46.68);
  });
  it("deux pleins distincts confirmés par une personne : les deux comptent", () => {
    const lignes = montant([ticket, { ...releve, ticpe_doublon_leve_le: "2026-03-12T09:00:00Z" }]);
    expect(totaliser(lignes).montant).toBe(93.36);
    expect(lignes.some((l) => l.doublon)).toBe(false);
  });
  it("la levée sur l'un ou l'autre des deux pleins suffit", () => {
    expect(totaliser(montant([{ ...ticket, ticpe_doublon_leve_le: "2026-03-12T09:00:00Z" }, releve])).montant).toBe(93.36);
  });
  it("jours de Paris différents : pas un doublon", () => {
    expect(totaliser(montant([ticket, plein({ id: "hier", occurred_at: "2026-03-09T11:00:00Z" })])).montant).toBe(93.36);
  });
  it("autre véhicule ou litres éloignés : pas un doublon", () => {
    expect(totaliser(montant([ticket, plein({ id: "x", occurred_at: "2026-03-10T15:00:00Z", vehicle_id: "v2" })]).filter((l) => l.vehicle_id === "v1")).montant).toBe(46.68);
    expect(doublonsProbables([ticket, plein({ id: "y", occurred_at: "2026-03-10T15:00:00Z", liters: 150 })])).toHaveLength(0);
  });
  it("tolérance : ±2 % ou ±2 L, paramétrable", () => {
    expect(litresProches(300, 305.9)).toBe(true);
    expect(litresProches(300, 306.2)).toBe(false);
    expect(litresProches(40, 42)).toBe(true);
    expect(litresProches(40, 42.1)).toBe(false);
    const proche = plein({ id: "p", occurred_at: "2026-03-10T16:00:00Z", liters: 312 });
    expect(doublonsProbables([ticket, proche])).toHaveLength(0);
    expect(doublonsProbables([ticket, proche], { pourcent: 0.05, litres: 2 })).toHaveLength(1);
  });
  it("fenêtre de 30 minutes conservée, y compris autour de minuit", () => {
    const a = plein({ id: "a", occurred_at: "2026-03-10T22:50:00Z" });
    const b = plein({ id: "b", occurred_at: "2026-03-10T23:10:00Z", liters: 301 });
    expect(doublonsProbables([a, b])).toHaveLength(1);
  });
  it("deux pleins à la cuve le même jour : pas un doublon (totaliseur mesuré)", () => {
    const a = plein({ id: "a", tank_id: "t1", occurred_at: "2026-03-10T05:00:00Z" });
    const b = plein({ id: "b", tank_id: "t1", occurred_at: "2026-03-10T15:00:00Z" });
    expect(doublonsProbables([a, b])).toHaveLength(0);
  });
  it("on garde le plein le mieux justifié ; à égalité, le plus ancien", () => {
    expect(departager(releve, ticket).garde.id).toBe("ticket");
    expect(departager(ticket, releve).ecarte.id).toBe("releve");
    const x = plein({ id: "x", occurred_at: "2026-03-10T08:00:00Z" });
    const y = plein({ id: "y", occurred_at: "2026-03-10T09:00:00Z" });
    expect(departager(y, x).garde.id).toBe("x");
  });
  it("trois saisies du même plein : une seule reste", () => {
    const t = plein({ id: "c", occurred_at: "2026-03-10T07:00:00Z", ticpe_justificatif: "facture" });
    const ecartes = pleinsEcartes(doublonsProbables([ticket, releve, t]));
    expect([...ecartes.keys()].sort()).toEqual(["c", "releve"]);
    expect(totaliser(montant([ticket, releve, t])).montant).toBe(46.68);
  });
  it("un plein déjà exclu (AdBlue) n'est pas touché", () => {
    const ad = plein({ id: "ad", product: "adblue" });
    const lignes = exclureDoublons([calculerPlein(ad, ctx)], [ad, plein({ id: "z" })]);
    expect(lignes[0]!.raison).toContain("AdBlue");
  });
});
