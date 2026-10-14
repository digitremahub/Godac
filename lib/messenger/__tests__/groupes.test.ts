import { describe, expect, it } from "vitest";
import {
  compterNonLus,
  computeTeamGroupMembers,
  destinatairesNotification,
  diffTeamGroupMembers,
  estChefEquipe,
  extraireMentions,
  libelleVuPar,
  membresAutorisesGroupe,
  peutAdministrerGroupe,
  peutCreerGroupe,
  peutEcrireGroupe,
  peutLireGroupe,
  peutReagir,
  peutSupprimerMessage,
  pieceJointeAcceptee,
  type CandidateUser,
} from "@/lib/messenger/groupes";

const u = (id: string, role: CandidateUser["role"], extra: Partial<CandidateUser> = {}): CandidateUser => ({
  id,
  role,
  active: true,
  pending_approval: false,
  email: `${id}@ex.fr`,
  ...extra,
});

describe("chef d'équipe", () => {
  it("lien explicite ou e-mail (connexion ou contact), sans casse", () => {
    expect(estChefEquipe(u("a", "chauffeur"), { id: "s", team_leader_user_id: "a" })).toBe(true);
    expect(estChefEquipe(u("a", "chauffeur"), { id: "s", team_leader_email: " A@EX.fr " })).toBe(true);
    expect(estChefEquipe(u("b", "chauffeur", { email: "x@pin.local", contact_email: "karim@ex.fr" }), { id: "s", team_leader_email: "karim@ex.fr" })).toBe(true);
    expect(estChefEquipe(u("a", "chauffeur"), { id: "s", team_leader_email: null })).toBe(false);
    expect(estChefEquipe(u("a", "chauffeur", { email: null }), { id: "s", team_leader_email: "" })).toBe(false);
  });
});

describe("membres du groupe d'équipe", () => {
  const org = [
    u("chauffeur1", "chauffeur"),
    u("chauffeur2", "chauffeur"),
    u("inactif", "chauffeur", { active: false }),
    u("attente", "chauffeur", { pending_approval: true }),
    u("manager", "manager"),
    u("chef", "chauffeur"),
    u("compta", "comptable"),
    u("dir", "direction"),
    u("autre", "chauffeur"),
  ];
  const service = { id: "s1", team_leader_email: "chef@ex.fr" };
  const membres = computeTeamGroupMembers(service, ["chauffeur1", "chauffeur2", "inactif", "attente", "manager", "compta"], org);

  it("actifs du service + chef (même non rattaché), sans les désactivés", () => {
    expect(Array.from(membres.keys()).sort()).toEqual(["chauffeur1", "chauffeur2", "chef", "compta", "manager"]);
  });
  it("chef et managers responsables, les autres membres", () => {
    expect(membres.get("chef")).toBe("admin");
    expect(membres.get("manager")).toBe("admin");
    expect(membres.get("chauffeur1")).toBe("member");
    expect(membres.get("compta")).toBe("member");
  });
  it("direction rattachée au service = responsable", () => {
    expect(computeTeamGroupMembers({ id: "s" }, ["dir"], org).get("dir")).toBe("admin");
  });

  it("écart : ajoute, met à jour, retire les automatiques et les inactifs, garde la direction ajoutée à la main", () => {
    const actifs = new Set(org.filter((x) => x.active && !x.pending_approval).map((x) => x.id));
    const diff = diffTeamGroupMembers(
      [
        { user_id: "chauffeur1", role: "admin", source: "auto" },
        { user_id: "autre", role: "member", source: "auto" },
        { user_id: "dir", role: "admin", source: "manual" },
        { user_id: "inactif", role: "member", source: "manual" },
      ],
      membres,
      actifs,
    );
    expect(diff.toRemove.sort()).toEqual(["autre", "inactif"]);
    expect(diff.toUpdate).toEqual([{ user_id: "chauffeur1", role: "member" }]);
    expect(diff.toAdd.map((a) => a.user_id).sort()).toEqual(["chauffeur2", "chef", "compta", "manager"]);
  });
});

describe("permissions", () => {
  const membre = { userRole: "chauffeur" as const, memberRole: "member" as const, active: true };
  const admin = { userRole: "chauffeur" as const, memberRole: "admin" as const, active: true };
  const direction = { userRole: "direction" as const, memberRole: null, active: true };
  const exclu = { userRole: "chauffeur" as const, memberRole: null, active: true };
  const desactive = { userRole: "manager" as const, memberRole: "admin" as const, active: false };

  it("lecture : membres et direction ; jamais un compte désactivé", () => {
    expect(peutLireGroupe(membre)).toBe(true);
    expect(peutLireGroupe(direction)).toBe(true);
    expect(peutLireGroupe(exclu)).toBe(false);
    expect(peutLireGroupe(desactive)).toBe(false);
  });
  it("mode annonces : seuls les responsables écrivent, tout membre réagit", () => {
    expect(peutEcrireGroupe(membre, false)).toBe(true);
    expect(peutEcrireGroupe(membre, true)).toBe(false);
    expect(peutEcrireGroupe(admin, true)).toBe(true);
    expect(peutReagir(membre)).toBe(true);
    expect(peutEcrireGroupe(direction, false)).toBe(false); // la direction rejoint d'abord
    expect(peutEcrireGroupe(desactive, false)).toBe(false);
  });
  it("administration et suppression", () => {
    expect(peutAdministrerGroupe(admin)).toBe(true);
    expect(peutAdministrerGroupe(direction)).toBe(true);
    expect(peutAdministrerGroupe(membre)).toBe(false);
    expect(peutSupprimerMessage(membre, "moi", "moi")).toBe(true);
    expect(peutSupprimerMessage(membre, "lui", "moi")).toBe(false);
    expect(peutSupprimerMessage(admin, "lui", "moi")).toBe(true);
  });
  it("création de groupe", () => {
    expect(peutCreerGroupe("chauffeur", false)).toBe(false);
    expect(peutCreerGroupe("chauffeur", true)).toBe(true);
    expect(peutCreerGroupe("manager", false)).toBe(true);
    expect(peutCreerGroupe("comptable", false)).toBe(false);
  });
  it("membres d'un groupe ponctuel : l'équipe seulement (direction : toute l'organisation)", () => {
    const equipe = new Set(["a", "b"]);
    const actifs = new Set(["a", "b", "c"]);
    expect(membresAutorisesGroupe(["a", "c", "a", "z"], equipe, "chauffeur", actifs)).toEqual(["a"]);
    expect(membresAutorisesGroupe(["a", "c", "z"], equipe, "direction", actifs)).toEqual(["a", "c"]);
  });
});

describe("mentions @prénom", () => {
  const members = [
    { id: "1", full_name: "Rémi Martin" },
    { id: "2", full_name: "Karim Benali" },
    { id: "3", full_name: "Karim Durand" },
    { id: "4", full_name: "Sophie Leroy" },
  ];
  it("prénom sans accent ni casse, homonymes tous mentionnés", () => {
    expect(extraireMentions("Salut @remi et @KARIM !", members, { authorId: "4", authorIsAdmin: false }).sort()).toEqual(["1", "2", "3"]);
  });
  it("nom complet collé, pas les adresses e-mail, jamais l'auteur", () => {
    expect(extraireMentions("@KarimDurand voir chef@sophie.fr", members, { authorId: "4", authorIsAdmin: false })).toEqual(["3"]);
    expect(extraireMentions("@Sophie", members, { authorId: "4", authorIsAdmin: false })).toEqual([]);
  });
  it("@tous réservé aux responsables", () => {
    expect(extraireMentions("@tous réunion", members, { authorId: "4", authorIsAdmin: true }).sort()).toEqual(["1", "2", "3"]);
    expect(extraireMentions("@tous réunion", members, { authorId: "4", authorIsAdmin: false })).toEqual([]);
    expect(extraireMentions(null, members, { authorId: "4", authorIsAdmin: true })).toEqual([]);
  });
});

describe("notifications, vu par, non lus, pièces jointes", () => {
  it("sourdine respectée sauf mention, jamais l'auteur", () => {
    const r = destinatairesNotification(
      [
        { user_id: "a", muted: false },
        { user_id: "b", muted: true },
        { user_id: "c", muted: true },
        { user_id: "auteur", muted: false },
      ],
      "auteur",
      ["c", "auteur"],
    );
    expect(r).toEqual({ mentionnes: ["c"], autres: ["a"] });
  });
  it("vu par X/Y hors auteur", () => {
    expect(libelleVuPar(["a", "auteur", "x"], ["auteur", "a", "b", "c"], "auteur")).toEqual({ vus: 1, total: 3, libelle: "Vu par 1/3" });
  });
  it("non lus depuis la dernière lecture", () => {
    const msgs = [
      { sender_id: "a", created_at: "2026-10-01T10:00:00Z" },
      { sender_id: "moi", created_at: "2026-10-01T11:00:00Z" },
      { sender_id: "b", created_at: "2026-10-01T12:00:00Z" },
    ];
    expect(compterNonLus(msgs, "moi", null)).toBe(2);
    expect(compterNonLus(msgs, "moi", "2026-10-01T10:30:00Z")).toBe(1);
  });
  it("photos et documents, 15 Mo max", () => {
    expect(pieceJointeAcceptee("image/jpeg", 1000)).toBe(true);
    expect(pieceJointeAcceptee("application/pdf", 1000)).toBe(true);
    expect(pieceJointeAcceptee("application/x-msdownload", 1000)).toBe(false);
    expect(pieceJointeAcceptee("image/png", 16 * 1024 * 1024)).toBe(false);
  });
});
