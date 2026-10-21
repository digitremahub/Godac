import { describe, expect, it } from "vitest";
import {
  ajouterPage,
  compter,
  fusionnerPages,
  libelleCompteur,
  lireDate,
  lireHoraires,
  lireLocalite,
  lirePlages,
  normaliserBloc,
  normaliserPage,
  pageLueSchema,
  pointDepuisArret,
  typeDepuisCodes,
  type BlocLu,
  type PageLue,
} from "@/lib/colis/bordereau";

// Données entièrement fictives.
const bloc = (b: Partial<BlocLu>): BlocLu => ({
  position: 1,
  codes: [],
  nom: "MARTIN ALICE",
  contact: null,
  adresse: "12 RUE DES TILLEULS",
  localite: "F-11000 CARCASSONNE",
  telephone: null,
  expediteur: null,
  colis: [],
  nombre_colis: 1,
  poids_total_kg: 3.5,
  nature: null,
  horaires: null,
  mentions: null,
  adresse_rappel: null,
  ...b,
});

const page = (numero: string | null, n: number | null, blocs: BlocLu[], extra: Partial<PageLue["entete"]> = {}): PageLue => ({
  lisible: true,
  entete: { numero, tournee: "7", date: "05.03.2026", page: n, total_colis: 6, total_poids_kg: 40, code_barres: null, ...extra },
  blocs,
});

describe("lireLocalite", () => {
  it("pays depuis le préfixe, code postal et ville", () => {
    expect(lireLocalite("F-11000 CARCASSONNE")).toEqual({ pays: "FR", codePostal: "11000", ville: "CARCASSONNE", villeTronquee: false });
    expect(lireLocalite("B-1000 BRUXELLES")).toMatchObject({ pays: "BE", codePostal: "1000" });
    expect(lireLocalite("D-10115 BERLIN")).toMatchObject({ pays: "DE", codePostal: "10115", ville: "BERLIN" });
  });
  it("ville tronquée par « .. »", () => {
    expect(lireLocalite("F-11000 SAINT-MARTIN-DES-PR..")).toEqual({ pays: "FR", codePostal: "11000", ville: "SAINT-MARTIN-DES-PR", villeTronquee: true });
  });
  it("code postal absent", () => {
    expect(lireLocalite("CARCASSONNE")).toMatchObject({ codePostal: null, ville: "CARCASSONNE" });
    expect(lireLocalite(null)).toMatchObject({ codePostal: null, ville: null });
  });
});

describe("typeDepuisCodes", () => {
  it("CR, PRE, RDV, relais, inconnu", () => {
    expect(typeDepuisCodes(["CR", "CR"])).toBe("ramasse");
    expect(typeDepuisCodes(["PRE"])).toBe("livraison");
    expect(typeDepuisCodes(["PRE /RDV"])).toBe("rdv");
    expect(typeDepuisCodes(["PRE", "/RDV"])).toBe("rdv");
    expect(typeDepuisCodes(["REL"])).toBe("relais");
    expect(typeDepuisCodes(["XYZ"])).toBe("livraison");
    expect(typeDepuisCodes([])).toBe("livraison");
  });
});

describe("horaires", () => {
  it("« 8h15 / 12h15 - 13h30/17h15 » → deux plages", () => {
    expect(lirePlages("8h15 / 12h15 - 13h30/17h15")).toEqual([
      { debut: "08:15", fin: "12:15" },
      { debut: "13:30", fin: "17:15" },
    ]);
    expect(lirePlages("9h-12h 14h-18h")).toEqual([
      { debut: "09:00", fin: "12:00" },
      { debut: "14:00", fin: "18:00" },
    ]);
  });
  it("suite incohérente ou impaire : null", () => {
    expect(lirePlages("12h / 8h")).toBeNull();
    expect(lirePlages("8h15")).toBeNull();
    expect(lirePlages(null)).toBeNull();
  });
  it("ligne d'enlèvement : fenêtre, contact et horaires", () => {
    expect(lireHoraires("Enl.: 05/03/26 08:00-18:00 2~Paul (accueil)~~~~8h15 / 12h15 - 13h30/17h15")).toEqual({
      fenetre: { debut: "08:00", fin: "18:00" },
      contact: "Paul (accueil)",
      plages: [
        { debut: "08:15", fin: "12:15" },
        { debut: "13:30", fin: "17:15" },
      ],
    });
    expect(lireHoraires("Enl.: 05/03/26 09:00-17:00")).toEqual({ fenetre: { debut: "09:00", fin: "17:00" }, contact: null, plages: null });
  });
});

describe("normaliserBloc", () => {
  it("téléphones « 04.68… » et « +336… »", () => {
    expect(normaliserBloc(bloc({ telephone: "04.68.00.11.22" })).telephone).toBe("04 68 00 11 22");
    expect(normaliserBloc(bloc({ telephone: "+33612345678" })).telephone).toBe("06 12 34 56 78");
    const tronque = normaliserBloc(bloc({ telephone: "0.." }));
    expect(tronque.telephone).toBeNull();
    expect(tronque.doutes).toContain("telephone");
  });
  it("ville tronquée retrouvée dans l'adresse rappelée", () => {
    const a = normaliserBloc(bloc({ localite: "F-11000 SAINT-MARTIN-DES-PR..", adresse_rappel: "SOCIETE TEST, F-11000 SAINT-MARTIN-DES-PRES, 12 R DES TILLEULS" }));
    expect(a.ville).toBe("SAINT MARTIN DES PRES");
    expect(a.doutes).not.toContain("ville_tronquee");
    const b = normaliserBloc(bloc({ localite: "F-11000 SAINT-MARTIN-DES-PR.." }));
    expect(b.doutes).toContain("ville_tronquee");
  });
  it("champs douteux : CP absent, rue absente", () => {
    const a = normaliserBloc(bloc({ localite: "CARCASSONNE", adresse: null }));
    expect(a.doutes).toEqual(expect.arrayContaining(["code_postal", "adresse"]));
  });
  it("société : forme juridique ou contact entre parenthèses", () => {
    expect(normaliserBloc(bloc({ nom: "EXEMPLE INDUSTRIE SA" })).societe).toBe("EXEMPLE INDUSTRIE SA");
    expect(normaliserBloc(bloc({ nom: "ATELIER DUPONT", contact: "DUPONT JEAN" })).societe).toBe("ATELIER DUPONT");
    expect(normaliserBloc(bloc({ nom: "MARTIN ALICE" })).societe).toBeNull();
  });
  it("ramasse CR → point d'import avec horaires pro et notes", () => {
    const a = normaliserBloc(
      bloc({
        codes: ["CR", "CR"],
        nom: "EXEMPLE INDUSTRIE SA",
        colis: [
          { numero: "11112222333301", poids_kg: 0 },
          { numero: "11112222333302", poids_kg: 0 },
        ],
        nombre_colis: 2,
        poids_total_kg: 0,
        nature: "Divers",
        expediteur: "SOCIETE EXP, F-64000 PAU (DPD 065)",
        horaires: "Enl.: 05/03/26 08:00-18:00 2~Paul~~~~8h15 / 12h15 - 13h30/17h15",
      }),
    );
    expect(a.type).toBe("ramasse");
    const p = pointDepuisArret(a);
    expect(p).toMatchObject({ type: "ramasse", colis: 0, code: "11112222333301,11112222333302", window_start: null, adresse: "12 RUE DES TILLEULS, 11000 CARCASSONNE" });
    expect(p.plages).toHaveLength(2);
    expect(p.notes).toContain("Enlèvement : 2 colis");
    expect(p.notes).toContain("Expéditeur : SOCIETE EXP");
  });
  it("RDV : livraison avec note ; fenêtre d'enlèvement seule → créneau", () => {
    const rdv = pointDepuisArret(normaliserBloc(bloc({ codes: ["PRE /RDV"], mentions: "Emargement obligatoire à effectuer sur le PDA." })));
    expect(rdv.type).toBe("livraison");
    expect(rdv.notes).toContain("Rendez-vous");
    expect(rdv.notes).toContain("Emargement obligatoire");
    const cr = pointDepuisArret(normaliserBloc(bloc({ codes: ["CR"], horaires: "Enl.: 05/03/26 09:00-17:00" })));
    expect(cr).toMatchObject({ window_start: "09:00", window_end: "17:00", plages: null });
  });
  it("adresse hors de France : pays ajouté", () => {
    expect(pointDepuisArret(normaliserBloc(bloc({ localite: "B-1000 BRUXELLES", adresse: "1 RUE TEST" }))).adresse).toBe("1 RUE TEST, 1000 BRUXELLES, BE");
  });
});

describe("pages et colis", () => {
  const p1 = normaliserPage(
    page("123,456", 1, [
      bloc({ position: 1, colis: [{ numero: "10000000000001", poids_kg: 5 }], nombre_colis: 1, poids_total_kg: 5 }),
      bloc({ position: 2, nombre_colis: 2, poids_total_kg: 10 }),
    ]),
  );
  const p2 = normaliserPage(page("123456", 2, [bloc({ position: 3, nombre_colis: 1, poids_total_kg: 4 })]));

  it("en-tête normalisé", () => {
    expect(p1.entete).toMatchObject({ numero: "123456", page: 1, date: "2026-03-05", totalColis: 6, totalPoidsKg: 40 });
    expect(lireDate("21/10/26")).toBe("2026-10-21");
    expect(lireDate("illisible")).toBeNull();
  });

  it("une page re-photographiée remplace la précédente", () => {
    const relue = normaliserPage(page("123456", 1, [bloc({ position: 1, nombre_colis: 1, poids_total_kg: 6 })]));
    const pages = ajouterPage(ajouterPage(ajouterPage([], p1), p2), relue);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(relue);
  });

  it("colis en double retirés, ordre des positions", () => {
    const doublon = normaliserPage(page("123456", 3, [bloc({ position: 4, colis: [{ numero: "10000000000001", poids_kg: 5 }], nombre_colis: 1 })]));
    const arrets = fusionnerPages([p2, p1, doublon]);
    expect(arrets.map((a) => a.position)).toEqual([1, 2, 3]);
  });

  it("même position lue sur deux photos sans en-tête : un seul arrêt", () => {
    const sansEntete = normaliserPage(page(null, null, [bloc({ position: 3, nombre_colis: 1, poids_total_kg: 4 })]));
    expect(fusionnerPages([p1, p2, sansEntete])).toHaveLength(3);
  });

  it("compteur colis / poids face au total d'en-tête", () => {
    const c = compter([p1, p2]);
    expect(c).toMatchObject({ numero: "123456", pagesLues: 2, colis: 4, totalColis: 6, poidsKg: 19, totalPoidsKg: 40, complet: false, pagesManquantes: [] });
    expect(libelleCompteur(c)).toBe("Pages lues : 2 / ? · Colis : 4 / 6 · Poids : 19 / 40 kg");
    expect(compter([p2]).pagesManquantes).toEqual([1]);
    const p3 = normaliserPage(page("123456", 3, [bloc({ position: 4, nombre_colis: 2, poids_total_kg: 21 })]));
    expect(compter([p1, p2, p3]).complet).toBe(true);
  });

  it("schéma strict de la lecture IA", () => {
    expect(pageLueSchema.safeParse(page("1", 1, [bloc({})])).success).toBe(true);
    expect(pageLueSchema.safeParse({ lisible: true, entete: {}, blocs: [] }).success).toBe(false);
  });
});
