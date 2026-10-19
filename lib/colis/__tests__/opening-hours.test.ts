import { describe, expect, it } from "vitest";
import { convertirPeriodesGoogle, parserOpeningHours } from "@/lib/colis/opening-hours";

describe("parserOpeningHours (OSM)", () => {
  it("jours ouvrés avec coupure, samedi matin, dimanche fermé", () => {
    expect(parserOpeningHours("Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off")).toEqual({
      "1": [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
      "2": [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
      "3": [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
      "4": [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
      "5": [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
      "6": [{ open: "09:00", close: "12:00" }],
      "7": [],
    });
  });

  it("24/7 et heures sans jours", () => {
    expect(parserOpeningHours("24/7")?.["3"]).toEqual([{ open: "00:00", close: "24:00" }]);
    const s = parserOpeningHours("07:30-19:00")!;
    expect(Object.keys(s)).toHaveLength(7);
    expect(s["7"]).toEqual([{ open: "07:30", close: "19:00" }]);
  });

  it("listes de jours, heures sur un chiffre, espaces après la virgule", () => {
    const s = parserOpeningHours("Mo,We,Fr 8:30-12:00, 14:00-17:30")!;
    expect(s["1"]).toEqual([{ open: "08:30", close: "12:00" }, { open: "14:00", close: "17:30" }]);
    expect(s["2"]).toBeUndefined();
    expect(s["5"]).toHaveLength(2);
  });

  it("une règle ultérieure remplace la précédente ; une règle additionnelle s'ajoute", () => {
    const s = parserOpeningHours("Mo-Sa 09:00-19:00; Sa 09:00-12:00")!;
    expect(s["6"]).toEqual([{ open: "09:00", close: "12:00" }]);
    expect(s["1"]).toEqual([{ open: "09:00", close: "19:00" }]);
    const t = parserOpeningHours("Mo-Fr 09:00-12:00, Sa 10:00-12:00")!;
    expect(t["6"]).toEqual([{ open: "10:00", close: "12:00" }]);
  });

  it("jours fériés ignorés, fermeture après minuit bornée", () => {
    const s = parserOpeningHours("Tu-Su 18:00-02:00; PH off")!;
    expect(s["2"]).toEqual([{ open: "18:00", close: "24:00" }]);
    expect(s["1"]).toBeUndefined();
    expect(parserOpeningHours("Mo-Fr,PH 08:00-12:00")!["1"]).toEqual([{ open: "08:00", close: "12:00" }]);
  });

  it("règles illisibles : null plutôt que des horaires inventés", () => {
    expect(parserOpeningHours("")).toBeNull();
    expect(parserOpeningHours(null)).toBeNull();
    expect(parserOpeningHours("sunrise-sunset")).toBeNull();
    expect(parserOpeningHours("Jan-Mar Mo-Fr 08:00-12:00")).toBeNull();
    expect(parserOpeningHours("sur rendez-vous")).toBeNull();
  });
});

describe("convertirPeriodesGoogle", () => {
  it("dimanche = 0, jours sans période = fermés", () => {
    const s = convertirPeriodesGoogle([
      { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 12, minute: 0 } },
      { open: { day: 1, hour: 14 }, close: { day: 1, hour: 18 } },
      { open: { day: 6, hour: 9 }, close: { day: 6, hour: 12, minute: 30 } },
    ])!;
    expect(s["1"]).toEqual([{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }]);
    expect(s["6"]).toEqual([{ open: "09:00", close: "12:30" }]);
    expect(s["7"]).toEqual([]);
    expect(s["3"]).toEqual([]);
  });

  it("ouvert 24 h/24", () => {
    expect(convertirPeriodesGoogle([{ open: { day: 0, hour: 0 } }])?.["7"]).toEqual([{ open: "00:00", close: "24:00" }]);
    expect(convertirPeriodesGoogle([])).toBeNull();
  });
});
