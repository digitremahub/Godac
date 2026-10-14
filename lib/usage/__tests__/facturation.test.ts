import { describe, expect, it, vi } from "vitest";
import { facturerDepassements, type DepotFacturation } from "@/lib/usage/facturation";

/** Dépôt en mémoire — jamais de base ni de Stripe réels dans les tests. */
function depotMemoire(totaux: Record<string, { feature: string; units: number }[]>) {
  const runs = new Map<string, { stripe_invoice_item_id: string | null }>();
  const depot: DepotFacturation = {
    organisations: async () => [
      { id: "org-a", plan: "essentiel", stripe_customer_id: "cus_a", stripe_subscription_id: "sub_a" },
      { id: "org-b", plan: "pro", stripe_customer_id: "cus_b", stripe_subscription_id: null },
    ],
    quotas: async () => [
      { plan_id: "essentiel", feature: "ocr_ticket", included_per_month: 300 },
      { plan_id: "pro", feature: "ocr_ticket", included_per_month: 3000 },
      { plan_id: "essentiel", feature: "assistant", included_per_month: 200 },
    ],
    prix: async () => [
      { feature: "ocr_ticket", unit_price_eur: 0.05, label: "Lecture automatique des tickets carburant" },
      { feature: "assistant", unit_price_eur: 0.05, label: "Assistant GODAC" },
    ],
    totaux: async (org) => totaux[org] ?? [],
    reserver: async (l) => {
      const k = `${l.organization_id}|${l.period}|${l.feature}`;
      if (runs.has(k)) return false;
      runs.set(k, { stripe_invoice_item_id: null });
      return true;
    },
    confirmer: async (o, p, f, id) => {
      runs.set(`${o}|${p}|${f}`, { stripe_invoice_item_id: id });
    },
    liberer: async (o, p, f) => {
      if (runs.get(`${o}|${p}|${f}`)?.stripe_invoice_item_id === null) runs.delete(`${o}|${p}|${f}`);
    },
  };
  return { depot, runs };
}

const instant = new Date("2026-05-01T04:15:00Z");

describe("facturerDepassements", () => {
  it("facture le dépassement du mois écoulé, une seule fois", async () => {
    const { depot, runs } = depotMemoire({
      "org-a": [
        { feature: "ocr_ticket", units: 420 },
        { feature: "assistant", units: 150 },
      ],
      "org-b": [{ feature: "ocr_ticket", units: 2000 }],
    });
    const creerLigne = vi.fn(async () => ({ id: "ii_1" }));

    const r1 = await facturerDepassements(depot, creerLigne, instant);
    expect(r1.periode).toBe("2026-04");
    expect(creerLigne).toHaveBeenCalledTimes(1);
    expect(creerLigne).toHaveBeenCalledWith(
      {
        customer: "cus_a",
        currency: "eur",
        amount: 600,
        description: "Lecture automatique des tickets carburant — 120 au-delà du forfait (avril 2026)",
        subscription: "sub_a",
        metadata: { godac_organization_id: "org-a", godac_usage_period: "2026-04", godac_usage_feature: "ocr_ticket" },
      },
      "godac-usage-org-a-2026-04-ocr_ticket",
    );
    expect(runs.get("org-a|2026-04|ocr_ticket")).toEqual({ stripe_invoice_item_id: "ii_1" });

    const r2 = await facturerDepassements(depot, creerLigne, instant);
    expect(creerLigne).toHaveBeenCalledTimes(1);
    expect(r2.ignorees).toBe(1);
    expect(r2.lignes).toEqual([]);
  });

  it("libère la réservation si Stripe échoue, pour réessayer au prochain passage", async () => {
    const { depot, runs } = depotMemoire({ "org-a": [{ feature: "ocr_ticket", units: 301 }] });
    const echec = vi.fn(async () => {
      throw new Error("stripe down");
    });
    const r = await facturerDepassements(depot, echec, instant);
    expect(r.erreurs).toEqual([{ organizationId: "org-a", feature: "ocr_ticket", message: "stripe down" }]);
    expect(runs.size).toBe(0);

    const ok = vi.fn(async () => ({ id: "ii_2" }));
    const r2 = await facturerDepassements(depot, ok, instant);
    expect(r2.lignes).toHaveLength(1);
    expect(r2.lignes[0]!.montantCentimes).toBe(5);
  });
});
