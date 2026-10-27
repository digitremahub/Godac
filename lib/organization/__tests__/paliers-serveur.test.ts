import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const stripeItemsUpdate = vi.fn();
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: {
      retrieve: async () => ({
        items: { data: [{ id: "si_1", price: { product: { id: "prod_1", metadata: { godac_module: "route_optimizer" } } } }] },
      }),
    },
    subscriptionItems: { update: stripeItemsUpdate },
  }),
}));

import { compterUtilisateursLivreur, synchroniserPaliers } from "@/lib/organization/paliers-serveur";

type Resultat = { data?: unknown; error?: { message: string } | null; count?: number | null };

/** Faux client Supabase : chaque table renvoie un résultat fixe ; les filtres sont enregistrés. */
function fauxClient(tables: Record<string, Resultat>) {
  const appels: { table: string; methode: string; args: unknown[] }[] = [];
  const client = {
    appels,
    from(table: string) {
      const chaine: Record<string, unknown> = {};
      const enregistrer =
        (methode: string) =>
        (...args: unknown[]) => {
          appels.push({ table, methode, args });
          return chaine;
        };
      for (const m of ["select", "eq", "in", "is", "or", "update", "order", "limit"]) chaine[m] = enregistrer(m);
      chaine.then = (resolve: (r: Resultat) => unknown) => resolve({ error: null, ...tables[table] });
      return chaine;
    },
  };
  return client;
}

const grille = { data: [{ module_key: "route_optimizer", min_users: 1, max_users: 20, monthly_price: 29, extra_per_user: 0 }, { module_key: "route_optimizer", min_users: 21, max_users: null, monthly_price: 59, extra_per_user: 0 }] };
const ligne = {
  data: [
    {
      organization_id: "org-1",
      module_key: "route_optimizer",
      effective_monthly_price: 29,
      billed_users: 5,
      organizations: { stripe_subscription_id: "sub_1" },
    },
  ],
};

beforeEach(() => stripeItemsUpdate.mockReset());

describe("compterUtilisateursLivreur", () => {
  it("ne filtre plus sur users.deleted_at (colonne absente)", async () => {
    const client = fauxClient({ users: { count: 7 } });
    expect(await compterUtilisateursLivreur(client as never, "org-1")).toBe(7);
    expect(client.appels.some((a) => a.methode === "is" && a.args[0] === "deleted_at")).toBe(false);
    // Palier App Livreur : chauffeurs ET managers qui conduisent (can_drive).
    expect(client.appels.some((a) => a.methode === "or" && String(a.args[0]).includes("can_drive.is.true"))).toBe(true);
  });

  it("lève une erreur au lieu de renvoyer 0", async () => {
    const client = fauxClient({ users: { count: null, error: { message: "column users.deleted_at does not exist" } } });
    await expect(compterUtilisateursLivreur(client as never, "org-1")).rejects.toThrow(/deleted_at/);
  });
});

describe("synchroniserPaliers", () => {
  it("en cas d'erreur de comptage : rien n'est écrit ni poussé vers Stripe", async () => {
    const client = fauxClient({
      module_user_tiers: grille,
      organization_modules: ligne,
      users: { count: null, error: { message: "boom" } },
    });
    const changes = await synchroniserPaliers(client as never, "org-1");
    expect(changes).toEqual([]);
    expect(client.appels.some((a) => a.methode === "update")).toBe(false);
    expect(stripeItemsUpdate).not.toHaveBeenCalled();
  });

  it("applique le palier réel et le pousse vers Stripe", async () => {
    const client = fauxClient({ module_user_tiers: grille, organization_modules: ligne, users: { count: 30 } });
    const changes = await synchroniserPaliers(client as never, "org-1");
    expect(changes).toEqual([{ organizationId: "org-1", moduleKey: "route_optimizer", utilisateurs: 30, prix: 59 }]);
    expect(client.appels.some((a) => a.methode === "update")).toBe(true);
    expect(stripeItemsUpdate).toHaveBeenCalledOnce();
  });

  it("échec Stripe : la base n'est pas modifiée (le cron réessaiera) et l'échec est signalé", async () => {
    stripeItemsUpdate.mockRejectedValueOnce(new Error("stripe indisponible"));
    const client = fauxClient({ module_user_tiers: grille, organization_modules: ligne, users: { count: 30 } });
    const changes = await synchroniserPaliers(client as never, "org-1");
    expect(changes).toEqual([{ organizationId: "org-1", moduleKey: "route_optimizer", utilisateurs: 30, prix: 59, echecStripe: "stripe indisponible" }]);
    // Seul le marquage de l'échec est écrit, jamais le nouveau prix.
    const maj = client.appels.filter((a) => a.methode === "update").map((a) => a.args[0] as Record<string, unknown>);
    expect(maj.some((m) => "effective_monthly_price" in m)).toBe(false);
    expect(maj.some((m) => m.stripe_sync_pending === true)).toBe(true);
  });

  it("lève une erreur si la grille est illisible", async () => {
    const client = fauxClient({ module_user_tiers: { error: { message: "rls" } } });
    await expect(synchroniserPaliers(client as never)).rejects.toThrow(/Grille/);
  });
});
