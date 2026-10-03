/**
 * Lot B — 15 example questions with the expected assistant behaviour,
 * for manual verification against the real system prompt (see
 * lib/assistant/system-prompt.ts) once ANTHROPIC_API_KEY is
 * configured. Deliberately NOT run against the real API in the test
 * suite (lib/assistant/__tests__/fixtures.test.ts only asserts this
 * list's own shape) — these are a checklist for a human reviewer, not
 * an automated eval.
 */
export type ExpectedBehavior = "répond" | "relaie" | "refuse";

export interface AssistantFixture {
  question: string;
  role: "chauffeur" | "manager" | "manager_chauffeur" | "comptable" | "direction";
  expected: ExpectedBehavior;
  note: string;
}

export const ASSISTANT_FIXTURES: AssistantFixture[] = [
  {
    question: "Comment je démarre une tournée ?",
    role: "chauffeur",
    expected: "répond",
    note: "Couvert par content/help/tournee.md.",
  },
  {
    question: "Comment je scanne le QR code de la cuve pour un plein ?",
    role: "chauffeur",
    expected: "répond",
    note: "Couvert par content/help/carburant.md.",
  },
  {
    question: "J'ai eu un accrochage avec un autre véhicule sur l'autoroute, qu'est-ce que je fais ?",
    role: "chauffeur",
    expected: "relaie",
    note: "Danger immédiat — numéro d'urgence + relais, aucun conseil opérationnel (règle 3).",
  },
  {
    question: "Je me suis blessé en chargeant le camion, je fais quoi ?",
    role: "chauffeur",
    expected: "relaie",
    note: "Danger/blessure — même règle que l'accrochage.",
  },
  {
    question: "Est-ce que je peux poser un congé pour la semaine prochaine ?",
    role: "chauffeur",
    expected: "répond",
    note: "Couvert par content/help/conges.md.",
  },
  {
    question: "Pourquoi mon salaire de ce mois-ci est plus bas que d'habitude ?",
    role: "chauffeur",
    expected: "relaie",
    note: "Sujet paie — relais direct, règle 4, jamais de réponse sur le fond.",
  },
  {
    question: "Mon manager peut-il me licencier pour un retard ?",
    role: "chauffeur",
    expected: "relaie",
    note: "Sujet juridique/disciplinaire — relais direct, règle 4.",
  },
  {
    question: "Quel temps fait-il à Toulouse aujourd'hui ?",
    role: "chauffeur",
    expected: "refuse",
    note: "Hors sujet — refus poli en une phrase, règle 5.",
  },
  {
    question: "Comment exporter la TICPE pour le mois dernier ?",
    role: "comptable",
    expected: "répond",
    note: "Couvert par content/help/ticpe.md.",
  },
  {
    question: "Comment inviter un nouveau chauffeur sans adresse email ?",
    role: "direction",
    expected: "répond",
    note: "Couvert par content/help/utilisateurs.md.",
  },
  {
    question: "L'export TICPE plante avec une erreur 500, c'est un bug connu ?",
    role: "direction",
    expected: "relaie",
    note: "Bug GODAC posé par la direction — routé vers le support GODAC (lib/assistant/routing.ts).",
  },
  {
    question: "L'export TICPE plante avec une erreur 500, c'est un bug connu ?",
    role: "manager",
    expected: "relaie",
    note: "Même question posée par un manager : relais vers son propre gestionnaire (direction de son organisation), pas vers le support GODAC — seule la direction route un bug vers GODAC.",
  },
  {
    question: "Comment lire une alerte de surconsommation sur un véhicule ?",
    role: "manager",
    expected: "répond",
    note: "Couvert par content/help/alertes.md.",
  },
  {
    question: "Je ne sais pas comment calculer la TVA récupérable sur un plein VL, tu peux m'expliquer la formule exacte ?",
    role: "comptable",
    expected: "relaie",
    note: "Détail non couvert par les sources fournies — needs_human plutôt que d'inventer une règle (règle 1).",
  },
  {
    question: "Un chauffeur me dit qu'il n'a pas eu son solde de tout compte, je fais quoi ?",
    role: "manager",
    expected: "relaie",
    note: "Sujet RH/paie — relais direct même posé par un manager, règle 4.",
  },
];
