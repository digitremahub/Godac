import { describe, expect, it } from "vitest";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import {
  affectationsParTournee,
  calendrierMois,
  cleCaseTournee,
  cleLigne,
  compteursDuJour,
  estCaseVerrouillee,
  estUnTrou,
  etatCase,
  joursSansChauffeur,
  texteAffectation,
  trousParJour,
  type LigneTournee,
} from "@/lib/planning/affectation";
import {
  ROLES_DESTINATAIRES_FUSION,
  cleAlerteFusion,
  clesTourneeJour,
  doublonsFusion,
  ecarterFusionnees,
  fusionneeAvec,
  libelleJourLong,
  libellePastille,
  libelleTourneeHote,
  marquerFusionnees,
  messageAlerteFusion,
  messageDoublon,
  messageRefusAffectation,
  messageVerrou,
  originesParHote,
  partagerJours,
  sansFusionnees,
  texteFusionnees,
  tourneesVerrouilleesParFusion,
  verrouDe,
  type EntreeVerrou,
} from "@/lib/planning/fusion-verrou";
import { copiesVersDates, planifierCopies, type AffectationPlanning } from "@/lib/planning/semaine";
import { decisionEnvoiAuto, planifierSemaineSuivante, resumeVide, texteResume, lireResume, cumulerResumes, casesSansChauffeur, messageRappelDoublonFusion, messageGeneration, type LigneSuivi } from "@/lib/planning/semaines-auto";
import type { ContexteAbsences } from "@/lib/planning/semaines-auto-absences";
import { alertesPlanning, type EntreePlanning } from "@/lib/exploitation/surveillance";
import { ECRANS_PAR_TYPE, LIBELLES_TYPE, SEUILS_URGENCE, TYPES_A_TRAITER, TYPES_MANAGER, calculerUrgence, typeVisiblePour } from "@/lib/a-traiter/logique";
import { TYPES_ALERTE_FUSION, TYPES_ALERTE_PLANNING, alerteAffichable, alerteVisiblePour, choisirDestinataires, peutChangerStatutAlerte, rolesCibles } from "@/lib/alerts/destinataires";

/**
 * Tournées d'origine d'une fusion : cases verrouillées. Lundi 9 novembre 2026 :
 * la n°106 (hôte) regroupe la n°105 ; le service est « s1 ».
 */
const LUNDI = "2026-11-09";
const MARDI = "2026-11-10";
const at = (date: string, heure = "07:00") => parisWallTimeToUtcISOString(date, heure);
const e = (p: Partial<EntreeVerrou> & { id: string }): EntreeVerrou => ({ service_id: "s1", tour_number: "105", start_at: at(LUNDI), status: "planned", driver_id: null, ...p });
const hote = e({ id: "h106", tour_number: "106", driver_id: "d2" });
const fusion106 = [{ entryId: "h106", tournees: ["105"] }];

const ligne = (tour: string, extra: Partial<LigneTournee> = {}): LigneTournee => ({ cle: cleLigne("s1", tour), serviceId: "s1", tourNumber: tour, routeId: null, heure: "07:00", joursPrevus: [1, 2, 3, 4, 5], villages: [], renfort: false, ...extra });

describe("tourneesVerrouilleesParFusion", () => {
  it("la tournée d'origine est verrouillée le jour de la fusion, dans le service de l'hôte, même sans ligne de planning", () => {
    const v = tourneesVerrouilleesParFusion([hote], fusion106);
    expect([...v.keys()]).toEqual([`s1|105@${LUNDI}`]);
    expect(v.get(`s1|105@${LUNDI}`)).toEqual({ cle: `s1|105@${LUNDI}`, serviceId: "s1", tourNumber: "105", date: LUNDI, hoteEntryId: "h106", hoteNumero: "106" });
    expect(verrouDe(v, "s1", "105", LUNDI)?.hoteNumero).toBe("106");
    // Un autre jour, un autre service, une autre tournée : libres.
    expect(verrouDe(v, "s1", "105", MARDI)).toBeNull();
    expect(verrouDe(v, "s2", "105", LUNDI)).toBeNull();
    expect(verrouDe(v, "s1", "107", LUNDI)).toBeNull();
  });

  it("plusieurs origines ; la tournée hôte listée parmi ses origines est ignorée", () => {
    const v = tourneesVerrouilleesParFusion([hote], [{ entryId: "h106", tournees: ["105", "106", "107", " 105 "] }]);
    expect([...v.keys()].sort()).toEqual([`s1|105@${LUNDI}`, `s1|107@${LUNDI}`]);
  });

  it("une tournée qui est elle-même hôte d'une fusion n'est jamais verrouillée (pas de chaîne)", () => {
    const autre = e({ id: "h105", tour_number: "105", driver_id: "d1" });
    const v = tourneesVerrouilleesParFusion([hote, autre], [...fusion106, { entryId: "h105", tournees: ["106"] }]);
    expect(v.size).toBe(0);
  });

  it("hôte annulé, présence ou sans service : aucune case verrouillée", () => {
    expect(tourneesVerrouilleesParFusion([{ ...hote, status: "cancelled" }], fusion106).size).toBe(0);
    expect(tourneesVerrouilleesParFusion([{ ...hote, status: "presence" }], fusion106).size).toBe(0);
    expect(tourneesVerrouilleesParFusion([{ ...hote, service_id: null }], fusion106).size).toBe(0);
    // Fusion d'une ligne absente de la liste : ignorée sans erreur.
    expect(tourneesVerrouilleesParFusion([], fusion106).size).toBe(0);
    expect(tourneesVerrouilleesParFusion([hote], [{ entryId: "h106", tournees: [] }]).size).toBe(0);
  });

  it("deux hôtes pour la même origine : le plus petit numéro l'emporte (résultat stable)", () => {
    const h107 = e({ id: "h107", tour_number: "107", driver_id: "d3" });
    const sens1 = tourneesVerrouilleesParFusion([hote, h107], [...fusion106, { entryId: "h107", tournees: ["105"] }]);
    const sens2 = tourneesVerrouilleesParFusion([h107, hote], [{ entryId: "h107", tournees: ["105"] }, ...fusion106]);
    expect(sens1.get(`s1|105@${LUNDI}`)?.hoteNumero).toBe("106");
    expect(sens2.get(`s1|105@${LUNDI}`)?.hoteNumero).toBe("106");
  });

  it("numéro de tournée numérique accepté (colonne lue sans typage)", () => {
    const v = tourneesVerrouilleesParFusion([{ ...hote, tour_number: 106 }], [{ entryId: "h106", tournees: ["105"] }]);
    expect(v.get(`s1|105@${LUNDI}`)?.hoteNumero).toBe("106");
  });
});

describe("état de case « fusionnee » : jamais un trou", () => {
  const verrous = tourneesVerrouilleesParFusion([hote], fusion106);

  it("case verrouillée : fusionnée, quel que soit son contenu et qu'elle roule d'habitude ou non", () => {
    expect(etatCase([], true, true)).toBe("fusionnee");
    expect(etatCase([], false, true)).toBe("fusionnee");
    expect(etatCase([{ driver_id: null }], true, true)).toBe("fusionnee");
    expect(etatCase([{ driver_id: "d1" }], true, true)).toBe("fusionnee");
    expect(etatCase([{ driver_id: null, tour_open: false }], true, true)).toBe("fusionnee");
  });

  it("ni trou de couverture, ni « à pourvoir »", () => {
    expect(estUnTrou("fusionnee")).toBe(false);
    expect(estUnTrou(etatCase([], true, true))).toBe(false);
  });

  it("sans verrou, les états existants sont inchangés", () => {
    expect(etatCase([], true)).toBe("vide_prevue");
    expect(etatCase([], true, false)).toBe("vide_prevue");
    expect(etatCase([{ driver_id: null }], true, false)).toBe("a_remplacer");
    expect(etatCase([{ driver_id: "d1" }], true)).toBe("remplie");
    expect(etatCase([{ driver_id: null, tour_open: false }], true)).toBe("fermee");
  });

  it("estCaseVerrouillee lit la clé de la grille", () => {
    expect(estCaseVerrouillee(verrous, ligne("105"), LUNDI)).toBe(true);
    expect(estCaseVerrouillee(verrous, ligne("105"), MARDI)).toBe(false);
    expect(estCaseVerrouillee(undefined, ligne("105"), LUNDI)).toBe(false);
    expect(cleCaseTournee(ligne("105").cle, LUNDI)).toBe(`s1|105@${LUNDI}`);
  });

  const lignes = [ligne("105"), ligne("106"), ligne("107")];
  const entrees: AffectationPlanning[] = [{ id: "h106", service_id: "s1", tour_number: "106", driver_id: "d2", vehicle_id: "v2", start_at: at(LUNDI), status: "planned" }];
  const parCase = affectationsParTournee(entrees);

  it("trous par jour : la tournée fusionnée n'en est pas un (107 vide reste un trou)", () => {
    expect(trousParJour(lignes, [LUNDI], parCase)).toEqual({ [LUNDI]: 2 });
    expect(trousParJour(lignes, [LUNDI], parCase, verrous)).toEqual({ [LUNDI]: 1 });
  });

  it("jours sans chauffeur à fermer : une tournée fusionnée n'est pas proposée", () => {
    expect(joursSansChauffeur(ligne("105"), [LUNDI, MARDI], parCase, undefined, verrous)).toEqual([MARDI]);
    expect(joursSansChauffeur(ligne("105"), [LUNDI, MARDI], parCase)).toEqual([LUNDI, MARDI]);
  });

  it("compteurs du jour : « n fusionnées » à côté des fermées, hors tournées et hors sans chauffeur", () => {
    const base = { date: LUNDI, lignes, parCase, chauffeurs: [], affectations: entrees, conges: [] };
    expect(compteursDuJour(base)).toMatchObject({ tournees: 3, sansChauffeur: 2 });
    const c = compteursDuJour({ ...base, verrous });
    expect(c).toMatchObject({ tournees: 2, affectees: 1, sansChauffeur: 1, fermees: 0, fusionnees: 1 });
    // Aucune fusion : la clé n'apparaît pas (forme historique).
    expect("fusionnees" in compteursDuJour({ ...base, date: MARDI, verrous })).toBe(false);
  });

  it("calendrier du mois : une tournée fusionnée ne compte ni comme tournée ni comme trou", () => {
    const sans = calendrierMois("2026-11", [ligne("105")], new Map());
    const avec = calendrierMois("2026-11", [ligne("105")], new Map(), verrous);
    const jourSans = sans.flatMap((s) => s.jours).find((j) => j.date === LUNDI)!;
    const jourAvec = avec.flatMap((s) => s.jours).find((j) => j.date === LUNDI)!;
    expect(jourSans).toMatchObject({ tournees: 1, trous: 1, couverture: "trous" });
    expect(jourAvec).toMatchObject({ tournees: 0, trous: 0, couverture: "aucune" });
  });

  it("texte d'affectation : jours fusionnés comptés « inchangés »", () => {
    const t = texteAffectation({ places: 2, absents: [], figees: 0, deja: 0, fusionnees: 1 }, (d) => d);
    expect(t).toContain("2 jours placés");
    expect(t).toContain("1 tournée fusionnée, inchangée");
    expect(texteAffectation({ places: 0, absents: [], figees: 0, deja: 0 }, (d) => d)).toBe("Rien à changer");
    expect(texteFusionnees(2)).toBe("2 tournées fusionnées, inchangées");
  });
});

describe("refus d'affectation sur une tournée d'origine", () => {
  const verrous = tourneesVerrouilleesParFusion([hote], fusion106);

  it("partager les jours demandés : fusionnés refusés, les autres libres", () => {
    expect(partagerJours(verrous, "s1", "105", [LUNDI, MARDI])).toEqual({ libres: [MARDI], fusionnes: [LUNDI] });
    expect(partagerJours(verrous, "s1", "105", [LUNDI])).toEqual({ libres: [], fusionnes: [LUNDI] });
    expect(partagerJours(verrous, "s1", "106", [LUNDI])).toEqual({ libres: [LUNDI], fusionnes: [] });
  });

  it("messages clairs", () => {
    const v = verrouDe(verrous, "s1", "105", LUNDI)!;
    expect(libellePastille(v)).toBe("Fusionnée avec n°106");
    expect(messageVerrou(v)).toBe("Cette tournée est fusionnée avec la n°106 : modifiez la tournée 106.");
    expect(messageRefusAffectation(v, () => "lun. 09/11")).toContain("n°105 est fusionnée avec la n°106 le lun. 09/11");
  });
});

describe("doublons : une affectation existe déjà sur la tournée d'origine", () => {
  const verrous = tourneesVerrouilleesParFusion([hote], fusion106);
  const doublon = e({ id: "x105", tour_number: "105", driver_id: "d1" });

  it("repère l'affectation (prévue ou en cours) d'une tournée d'origine, et elle seule", () => {
    const liste = [hote, doublon, e({ id: "y105", tour_number: "105", start_at: at(MARDI), driver_id: "d1" }), e({ id: "z105", tour_number: "105", driver_id: null }), e({ id: "t105", tour_number: "105", driver_id: "d4", status: "in_progress", start_at: at(LUNDI, "09:00") })];
    const d = doublonsFusion(liste, verrous);
    expect(d.map((x) => x.entryId)).toEqual(["x105", "t105"]);
    expect(d[0]).toMatchObject({ tourNumber: "105", date: LUNDI, driverId: "d1", status: "planned" });
    expect(d[0]!.verrou.hoteNumero).toBe("106");
  });

  it("terminée, annulée, présence, sans chauffeur ou sans fusion : pas un doublon", () => {
    expect(doublonsFusion([{ ...doublon, status: "done" }, { ...doublon, id: "a", status: "cancelled" }, { ...doublon, id: "b", status: "presence" }, { ...doublon, id: "c", driver_id: null }], verrous)).toEqual([]);
    expect(doublonsFusion([doublon], new Map())).toEqual([]);
  });

  it("message : « La tournée n°105 est déjà affectée à X : retirez-le ou conservez la tournée séparée »", () => {
    const m = messageDoublon({ tourNumber: "105", nom: "Karim Mansouri", hoteNumero: "106" });
    expect(m).toContain("La tournée n°105 est déjà affectée à Karim Mansouri : retirez-le ou conservez la tournée séparée");
    expect(messageDoublon({ tourNumber: "105", nom: null, hoteNumero: "106" })).toContain("à un chauffeur");
  });
});

describe("duplication, recopie et publication ignorent les cases fusionnées", () => {
  const verrous = tourneesVerrouilleesParFusion([hote], fusion106);
  const source = (id: string, tour: string, date: string): AffectationPlanning => ({ id, service_id: "s1", tour_number: tour, driver_id: "d1", vehicle_id: "v1", start_at: at(date), status: "planned" });

  it("côté cible : une tournée d'origine fusionnée n'est pas recopiée comme une affectation", () => {
    const sources = [source("a", "105", "2026-11-02"), source("b", "107", "2026-11-02")];
    const demandes = copiesVersDates(sources, [LUNDI]);
    const { gardees, fusionnees } = ecarterFusionnees(demandes, verrous);
    expect(gardees.map((d) => d.source.tour_number)).toEqual(["107"]);
    expect(fusionnees.map((d) => d.source.tour_number)).toEqual(["105"]);
    const plan = planifierCopies(gardees, []);
    expect(plan.aCreer.map((l) => l.tour_number)).toEqual(["107"]);
  });

  it("côté source : l'affectation d'une tournée fusionnée (doublon) n'est pas recopiée", () => {
    const { gardees, fusionnees } = ecarterFusionnees(copiesVersDates([source("c", "105", LUNDI)], ["2026-11-16"]), verrous);
    expect(gardees).toEqual([]);
    expect(fusionnees).toHaveLength(1);
  });

  it("sans fusion, rien n'est écarté", () => {
    const demandes = copiesVersDates([source("a", "105", "2026-11-02")], [LUNDI]);
    expect(ecarterFusionnees(demandes, new Map()).gardees).toEqual(demandes);
  });

  it("la publication ignore les cases fusionnées (tournées et changements)", () => {
    const lignes = [
      { service_id: "s1", tour_number: "105", start_at: at(LUNDI) },
      { service_id: "s1", tour_number: "106", start_at: at(LUNDI) },
      { service_id: "s1", tour_number: "105", start_at: at(MARDI) },
      { service_id: null, tour_number: "105", start_at: at(LUNDI) },
    ];
    expect(sansFusionnees(lignes, verrous).map((l) => `${l.tour_number}@${l.start_at.slice(0, 10)}`)).toEqual(["106@" + at(LUNDI).slice(0, 10), "105@" + at(MARDI).slice(0, 10), "105@" + at(LUNDI).slice(0, 10)]);
    expect(sansFusionnees(lignes, new Map())).toHaveLength(4);
  });

  it("marquer les lignes fusionnées (bandeau « à confirmer », cases à pourvoir)", () => {
    const lignes = marquerFusionnees(
      [
        { id: "1", service_id: "s1", tour_number: "105", driver_id: null, start_at: at(LUNDI), status: "planned" },
        { id: "2", service_id: "s1", tour_number: "107", driver_id: null, start_at: at(LUNDI), status: "planned" },
      ],
      verrous,
    );
    expect(lignes.map((l) => l.fusionnee)).toEqual([true, false]);
    expect(casesSansChauffeur(lignes).map((c) => c.entree_id)).toEqual(["2"]);
  });

  it("chauffeur de la tournée hôte : « Tournée n°106 (fusionnée avec 105) » seulement", () => {
    expect(libelleTourneeHote("106", ["105"])).toBe("Tournée n°106 (fusionnée avec 105)");
    expect(libelleTourneeHote("106", ["105", "107", "106"])).toBe("Tournée n°106 (fusionnée avec 105, 107)");
    expect(libelleTourneeHote("105", [])).toBe("Tournée n°105");
    expect(fusionneeAvec("106", [])).toBeNull();
    expect(originesParHote(tourneesVerrouilleesParFusion([hote], [{ entryId: "h106", tournees: ["105", "107"] }])).get("h106")).toEqual(["105", "107"]);
  });
});

describe("surveillance : la tournée fusionnée n'est jamais « sans chauffeur » ni « non démarrée »", () => {
  const maintenant = new Date("2026-11-09T08:50:00Z"); // lundi 9 h 50 à Paris
  const base: EntreePlanning = { id: "x", tour_number: "105", start_at: at(LUNDI, "11:00"), driver_id: null, status: "planned", service_id: "s1" };

  it("sans chauffeur : alerte sans fusion, aucune avec", () => {
    expect(alertesPlanning([base], maintenant)).toHaveLength(1);
    expect(alertesPlanning([{ ...base, fusionnee: true }], maintenant)).toEqual([]);
  });

  it("non démarrée : même règle", () => {
    const nd = { ...base, driver_id: "d1", start_at: at(LUNDI, "09:00") };
    expect(alertesPlanning([nd], maintenant)).toHaveLength(1);
    expect(alertesPlanning([{ ...nd, fusionnee: true }], maintenant)).toEqual([]);
  });
});

describe("génération de la semaine suivante", () => {
  const vide: ContexteAbsences = { conges: [], arrets: [], inactifs: new Set(), sorties: new Map() };
  const nomDe = () => "Chauffeur";
  const src = (id: string, tour: string, date: string): AffectationPlanning => ({ id, service_id: "s1", tour_number: tour, driver_id: "d1", vehicle_id: "v1", start_at: at(date), status: "planned" });
  const modele = { service_id: "s1", tour_number: "105", departure_time: "07:00:00", weekdays: [1], default_vehicle_id: null };

  it("une tournée d'origine d'une fusion n'est ni recopiée ni comblée par un modèle, et la semaine l'indique", () => {
    const plan = planifierSemaineSuivante({
      lundiSource: "2026-11-02",
      lundiCible: LUNDI,
      sources: [src("a", "105", "2026-11-02"), src("b", "107", "2026-11-02")],
      existantes: [],
      modeles: [modele],
      contexte: vide,
      nomDe,
      fusionnees: new Set([`105|${LUNDI}`]),
    });
    expect(plan.lignes.map((l) => l.tour_number)).toEqual(["107"]);
    expect(plan.resume.fusionnees).toBe(1);
    expect(texteResume(plan.resume)).toContain("1 tournée fusionnée");
    expect(messageGeneration(LUNDI, plan.resume)).toContain("1 tournée fusionnée laissée vide");
  });

  it("une source fusionnée la semaine précédente (doublon) n'est pas recopiée non plus", () => {
    const plan = planifierSemaineSuivante({ lundiSource: "2026-11-02", lundiCible: LUNDI, sources: [src("a", "105", "2026-11-02")], existantes: [], modeles: [], contexte: vide, nomDe, fusionnees: new Set(["105|2026-11-02"]) });
    expect(plan.lignes).toEqual([]);
  });

  it("sans fusion, la génération est inchangée et le résumé garde son compte à zéro", () => {
    const plan = planifierSemaineSuivante({ lundiSource: "2026-11-02", lundiCible: LUNDI, sources: [src("a", "105", "2026-11-02")], existantes: [], modeles: [modele], contexte: vide, nomDe });
    expect(plan.lignes.map((l) => l.tour_number)).toEqual(["105"]);
    expect(plan.resume.fusionnees).toBe(0);
    expect(texteResume(plan.resume)).not.toContain("fusionnée");
  });

  it("résumé : relu tolérant, cumulé sur une régénération", () => {
    expect(resumeVide().fusionnees).toBe(0);
    expect(lireResume({ tournees: 3 }).fusionnees).toBe(0);
    expect(lireResume({ fusionnees: 2 }).fusionnees).toBe(2);
    expect(cumulerResumes({ ...resumeVide(), fusionnees: 2 }, { ...resumeVide(), fusionnees: 1 }).fusionnees).toBe(2);
  });

  it("clés « tournée|jour » d'un service", () => {
    const verrous = tourneesVerrouilleesParFusion([hote, { ...hote, id: "h2", service_id: "s2" }], [...fusion106, { entryId: "h2", tournees: ["108"] }]);
    expect([...clesTourneeJour(verrous, "s1")]).toEqual([`105|${LUNDI}`]);
    expect([...clesTourneeJour(verrous, "s2")]).toEqual([`108|${LUNDI}`]);
  });
});

describe("envoi automatique du vendredi : un doublon de fusion bloque l'envoi", () => {
  const ligneSuivi: Pick<LigneSuivi, "semaine_debut" | "modifie_at" | "confirme_at" | "publie_at" | "rappel_envoye_at"> = { semaine_debut: LUNDI, modifie_at: null, confirme_at: null, publie_at: null, rappel_envoye_at: null };
  const vendredi17 = new Date("2026-11-06T16:30:00Z"); // 17 h 30 à Paris

  it("semaine intacte sans doublon : publication automatique (inchangé)", () => {
    expect(decisionEnvoiAuto({ ligne: ligneSuivi, maintenant: vendredi17 })).toEqual({ action: "publier" });
    expect(decisionEnvoiAuto({ ligne: ligneSuivi, maintenant: vendredi17, doublonsFusion: 0 })).toEqual({ action: "publier" });
  });

  it("semaine intacte avec un doublon : jamais d'envoi, rappel à l'encadrement (une seule fois)", () => {
    expect(decisionEnvoiAuto({ ligne: ligneSuivi, maintenant: vendredi17, doublonsFusion: 1 })).toEqual({ action: "rappeler", motif: "doublon_fusion" });
    expect(decisionEnvoiAuto({ ligne: { ...ligneSuivi, rappel_envoye_at: "2026-11-06T16:00:00Z" }, maintenant: vendredi17, doublonsFusion: 1 })).toEqual({ action: "rien", raison: "rappel_deja_envoye" });
  });

  it("même la constante « publier si modifiée » ne contourne pas un doublon", () => {
    expect(decisionEnvoiAuto({ ligne: { ...ligneSuivi, modifie_at: "2026-11-05T09:00:00Z" }, maintenant: vendredi17, publierSiModifie: true, doublonsFusion: 2 })).toEqual({ action: "rappeler", motif: "doublon_fusion" });
  });

  it("semaine modifiée : le rappel habituel (inchangé)", () => {
    expect(decisionEnvoiAuto({ ligne: { ...ligneSuivi, modifie_at: "2026-11-05T09:00:00Z" }, maintenant: vendredi17 })).toEqual({ action: "rappeler" });
  });

  it("déjà publiée, avant 17 h ou pas vendredi : rien, doublon ou pas", () => {
    expect(decisionEnvoiAuto({ ligne: { ...ligneSuivi, publie_at: "2026-11-06T10:00:00Z" }, maintenant: vendredi17, doublonsFusion: 1 })).toEqual({ action: "rien", raison: "deja_publiee" });
    expect(decisionEnvoiAuto({ ligne: ligneSuivi, maintenant: new Date("2026-11-06T14:00:00Z"), doublonsFusion: 1 })).toEqual({ action: "rien", raison: "avant_17h" });
    expect(decisionEnvoiAuto({ ligne: ligneSuivi, maintenant: new Date("2026-11-05T16:30:00Z"), doublonsFusion: 1 })).toEqual({ action: "rien", raison: "pas_vendredi" });
  });

  it("message du rappel", () => {
    const m = messageRappelDoublonFusion(LUNDI, 2, "Colis");
    expect(m).toContain("2 doublons de tournées fusionnées");
    expect(m).toContain("Colis");
    expect(m).toContain("Retirez l'affectation ou gardez la tournée séparée");
    expect(messageRappelDoublonFusion(LUNDI, 1)).toContain("1 doublon de tournée fusionnée");
  });
});

describe("notification d'encadrement : message, clé, destinataires", () => {
  it("« Tournée n°105 fusionnée avec la n°106 le lundi 9 novembre »", () => {
    expect(messageAlerteFusion({ origines: ["105"], hoteNumero: "106", date: LUNDI })).toBe("Tournée n°105 fusionnée avec la n°106 le lundi 9 novembre");
    expect(messageAlerteFusion({ origines: ["107", "105"], hoteNumero: "106", date: LUNDI })).toBe("Tournées n°105 et n°107 fusionnées avec la n°106 le lundi 9 novembre");
    expect(messageAlerteFusion({ origines: ["105", "107", "108"], hoteNumero: "106", date: "2026-12-01" })).toBe("Tournées n°105, n°107 et n°108 fusionnées avec la n°106 le mardi 1er décembre");
    expect(libelleJourLong("2026-11-09")).toBe("lundi 9 novembre");
  });

  it("une clé par fusion (ligne hôte, donc par jour) et par liste d'origines, indépendante de l'ordre", () => {
    expect(cleAlerteFusion("h106", ["105"])).toBe("planning:fusion:h106:105");
    expect(cleAlerteFusion("h106", ["107", "105"])).toBe(cleAlerteFusion("h106", ["105", "107", "105"]));
    expect(cleAlerteFusion("h106", ["105"])).not.toBe(cleAlerteFusion("h106", ["105", "107"]));
    expect(cleAlerteFusion("h106", ["105"])).not.toBe(cleAlerteFusion("h206", ["105"]));
  });

  const gens = [
    { id: "m1", role: "manager" },
    { id: "m2", role: "manager" },
    { id: "e1", role: "exploitation" },
    { id: "d1", role: "direction" },
    { id: "c1", role: "comptable" },
    { id: "ch1", role: "chauffeur" },
  ];
  const services = new Map([
    ["m1", ["A"]],
    ["m2", ["B"]],
  ]);
  const alerte = { type: "planning_fusion", service_id: "A" };

  it("direction, exploitation et managers DU service ; jamais le comptable ni un chauffeur", () => {
    expect(choisirDestinataires(gens, alerte, services).map((g) => g.id)).toEqual(["m1", "e1", "d1"]);
    expect(choisirDestinataires(gens, { ...alerte, service_id: "B" }, services).map((g) => g.id)).toEqual(["m2", "e1", "d1"]);
    expect([...ROLES_DESTINATAIRES_FUSION]).toEqual(["manager", "exploitation", "direction"]);
    expect(rolesCibles([...ROLES_DESTINATAIRES_FUSION]).sort()).toEqual(["direction", "exploitation", "manager"]);
  });

  it("par rôle : lecture et traitement", () => {
    expect(TYPES_ALERTE_FUSION).toEqual(["planning_fusion"]);
    // Le planning à confirmer garde sa liste d'origine.
    expect(TYPES_ALERTE_PLANNING).toEqual(["planning_a_confirmer"]);
    expect(alerteVisiblePour("direction", "planning_fusion", "A")).toBe(true);
    expect(alerteVisiblePour("exploitation", "planning_fusion", "A")).toBe(true);
    expect(alerteVisiblePour("manager", "planning_fusion", "A", ["A"])).toBe(true);
    expect(alerteVisiblePour("manager", "planning_fusion", "A", ["B"])).toBe(false);
    expect(alerteVisiblePour("manager", "planning_fusion", null, ["A"])).toBe(false);
    expect(alerteVisiblePour("comptable", "planning_fusion", "A")).toBe(false);
    expect(alerteVisiblePour("chauffeur", "planning_fusion", "A")).toBe(false);
    expect(alerteAffichable("comptable", alerte)).toBe(false);
    expect(alerteAffichable("chauffeur", alerte)).toBe(false);
    expect(peutChangerStatutAlerte({ role: "manager", userId: "m1", statut: "resolved", alerte, mesServices: ["A"] }).ok).toBe(true);
    expect(peutChangerStatutAlerte({ role: "manager", userId: "m2", statut: "resolved", alerte, mesServices: ["B"] }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ role: "comptable", userId: "c1", statut: "resolved", alerte, mesServices: [] }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ role: "chauffeur", userId: "ch1", statut: "acknowledged", alerte, mesServices: [] }).ok).toBe(false);
  });
});

describe("« À traiter » : badge doublon", () => {
  it("type additif visible de la direction, de l'exploitation et du manager (son service) ; jamais le comptable ni le chauffeur", () => {
    expect(TYPES_A_TRAITER).toContain("planning_doublon_fusion");
    expect(LIBELLES_TYPE.planning_doublon_fusion.singulier).toContain("Doublon");
    expect(ECRANS_PAR_TYPE.planning_doublon_fusion).toEqual(["exploitation.planning"]);
    expect(TYPES_MANAGER).toContain("planning_doublon_fusion");
    for (const role of ["direction", "exploitation", "manager"]) expect(typeVisiblePour("planning_doublon_fusion", role), role).toBe(true);
    for (const role of ["comptable", "chauffeur"]) expect(typeVisiblePour("planning_doublon_fusion", role), role).toBe(false);
  });

  it("urgent à moins de 48 h du jour de la tournée", () => {
    expect(SEUILS_URGENCE.planning_doublon_fusion.echeanceHeures).toBe(48);
    const maintenant = new Date("2026-11-05T09:00:00Z");
    expect(calculerUrgence("planning_doublon_fusion", { echeance: at("2026-11-06", "00:00") }, maintenant)).toBe("haute");
    expect(calculerUrgence("planning_doublon_fusion", { echeance: at("2026-11-12", "00:00") }, maintenant)).toBe("normale");
  });
});
