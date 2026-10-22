import { describe, expect, it } from "vitest";
import { compterNonLues, filtreDestinataire, libelleGravite, libelleStatutAlerte, marquerLues, trierNonLuesDabord } from "@/lib/alerts/lecture";

describe("notifications lues par personne", () => {
  const alertes = [
    { id: "a", created_at: "2026-10-20T08:00:00Z" },
    { id: "b", created_at: "2026-10-21T08:00:00Z" },
    { id: "c", created_at: "2026-10-22T08:00:00Z" },
  ];

  it("le compteur baisse quand le chauffeur marque une alerte comme lue", () => {
    const ids = alertes.map((a) => a.id);
    expect(compterNonLues(ids, [])).toBe(3);
    expect(compterNonLues(ids, ["b"])).toBe(2);
    expect(compterNonLues(ids, ["a", "b", "c", "autre"])).toBe(0);
  });

  it("non lues en premier, puis de la plus récente à la plus ancienne", () => {
    const triees = trierNonLuesDabord(marquerLues(alertes, ["c"]));
    expect(triees.map((a) => [a.id, a.lu])).toEqual([
      ["b", false],
      ["a", false],
      ["c", true],
    ]);
  });

  it("filtre du destinataire : alertes diffusées et personnelles, jamais celles d'un collègue", () => {
    expect(filtreDestinataire("u1")).toBe("recipient_user_id.is.null,recipient_user_id.eq.u1");
  });

  it("gravité et statut en français", () => {
    expect(["info", "warning", "critical"].map(libelleGravite)).toEqual(["Info", "À surveiller", "Urgent"]);
    expect(["acknowledged", "resolved"].map(libelleStatutAlerte)).toEqual(["Pris en compte", "Résolu"]);
  });
});
