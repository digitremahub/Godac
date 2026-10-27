import { describe, expect, it } from "vitest";
import { marquerPrime, primeRecopieeSansMarqueur, reprendrePrimes } from "@/lib/paie/primes";

const p = (libelle: string, extra = {}) => ({ libelle, montant: 100, soumise: true, ...extra });

describe("primes reprises", () => {
  it("ponctuelle : jamais reprise", () => expect(reprendrePrimes([p("Exceptionnelle", { nature: "ponctuelle" })])).toEqual([]));
  it("récurrente : reprise, sans alerte", () => {
    const [r] = reprendrePrimes([p("Ancienneté", { nature: "recurrente" })]);
    expect(r).toMatchObject({ nature: "recurrente", recopiee: false });
    expect(primeRecopieeSansMarqueur(r!)).toBe(false);
  });
  it("sans marqueur : reprise et signalée", () => {
    const [r] = reprendrePrimes([p("Prime")]);
    expect(primeRecopieeSansMarqueur(r!)).toBe(true);
  });
  it("marquer lève le signalement", () => {
    const [r] = reprendrePrimes([p("Prime")]);
    expect(primeRecopieeSansMarqueur(marquerPrime(r!, "ponctuelle"))).toBe(false);
  });
  it("montant nul ignoré", () => expect(reprendrePrimes([{ ...p("Zéro"), montant: 0 }])).toEqual([]));
});
