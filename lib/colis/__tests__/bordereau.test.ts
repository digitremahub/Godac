import { describe, expect, it } from "vitest";
import {
  ajouterPage,
  codesColis,
  compter,
  fusionnerPages,
  libelleCompteur,
  lireDate,
  lireHoraires,
  lireLocalite,
  lireNumeroColis,
  lirePlages,
  lireTransporteur,
  memeArret,
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
  entete: { transporteur: null, numero, tournee: "7", date: "05.03.2026", page: n, total_colis: 6, total_poids_kg: 40, code_barres: null, ...extra },
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

  it("schéma de la lecture IA : complet, ou tolérant aux écarts de forme", () => {
    expect(pageLueSchema.safeParse(page("1", 1, [bloc({})])).success).toBe(true);
    // Champs omis, nombres en texte, n° de colis seuls : rien de déclaré illisible, rien d'inventé.
    const lu = pageLueSchema.parse({
      entete: { transporteur: "GLS", page: "2", total_poids_kg: "12,5" },
      blocs: [{ nom: "DURAND PAUL", adresse: "4 AVENUE DU TEST", localite: "31000 TOULOUSE", colis: ["ZX12345678"], nombre_colis: "1" }, "bruit"],
    });
    expect(lu.lisible).toBe(true);
    expect(lu.entete).toMatchObject({ transporteur: "GLS", numero: null, page: 2, total_poids_kg: 12.5 });
    expect(lu.blocs).toHaveLength(1);
    expect(lu.blocs[0]).toMatchObject({ position: null, codes: [], telephone: null, nombre_colis: 1, colis: [{ numero: "ZX12345678", poids_kg: null }] });
    expect(pageLueSchema.parse({ lisible: false }).blocs).toEqual([]);
  });
});

describe("autres transporteurs (données fictives)", () => {
  it("transporteur détecté et ramené à un nom connu", () => {
    expect(lireTransporteur("GLS France")).toBe("GLS");
    expect(lireTransporteur("chronopost")).toBe("Chronopost");
    expect(lireTransporteur("Relais Colis")).toBe("Relais Colis");
    expect(lireTransporteur("COLIS PRIVE")).toBe("Colis Privé");
    expect(lireTransporteur("dpd")).toBe("DPD");
    expect(lireTransporteur("Transports Exemple")).toBe("Transports Exemple");
    expect(lireTransporteur(null)).toBeNull();
  });

  it("localité sans préfixe pays, ou code postal après la ville", () => {
    expect(lireLocalite("31000 TOULOUSE")).toEqual({ pays: null, codePostal: "31000", ville: "TOULOUSE", villeTronquee: false });
    expect(lireLocalite("TOULOUSE 31000")).toEqual({ pays: null, codePostal: "31000", ville: "TOULOUSE", villeTronquee: false });
    expect(lireLocalite("FR-31000 TOULOUSE")).toMatchObject({ pays: "FR", codePostal: "31000" });
  });

  it("libellés de service des autres transporteurs", () => {
    expect(typeDepuisCodes(["Enlèvement"])).toBe("ramasse");
    expect(typeDepuisCodes(["Collecte"])).toBe("ramasse");
    expect(typeDepuisCodes(["Point relais"])).toBe("relais");
    expect(typeDepuisCodes(["ParcelShop"])).toBe("relais");
    expect(typeDepuisCodes(["Consigne"])).toBe("relais");
    expect(typeDepuisCodes(["Livraison sur rendez-vous"])).toBe("rdv");
    expect(typeDepuisCodes(["Express", "13H"])).toBe("livraison");
  });

  it("n° de colis : alphanumériques gardés, lettre de contrôle DPD retirée", () => {
    expect(lireNumeroColis("6A 1234 5678 901")).toBe("6A12345678901");
    expect(lireNumeroColis("1Z 999 AA1 01 2345 6784")).toBe("1Z999AA10123456784");
    expect(lireNumeroColis("XY123456789FR")).toBe("XY123456789FR");
    expect(lireNumeroColis("01234567890123 A")).toBe("01234567890123");
    expect(lireNumeroColis("AB12")).toBeNull();
    expect(lireNumeroColis("REF-CLIENT")).toBeNull();
  });

  it("feuille de route en tableau, sans position ni poids : pas de faux doutes, notes au nom du transporteur", () => {
    const p = normaliserPage(
      page(
        "FR-TEST-01",
        1,
        [
          bloc({ position: null, codes: ["Point relais"], nom: "TABAC DE LA GARE", adresse: "1 PLACE DU TEST", localite: "31000 TOULOUSE", poids_total_kg: null, colis: [{ numero: "ZX00000001", poids_kg: null }] }),
          bloc({ position: null, codes: ["Express"], nom: "DURAND PAUL", adresse: "4 AVENUE DU TEST", localite: "TOULOUSE 31000", telephone: "06 00 00 00 01", poids_total_kg: null, colis: [{ numero: "ZX00000002", poids_kg: null }] }),
        ],
        { transporteur: "gls france", total_colis: 2, total_poids_kg: null },
      ),
    );
    expect(p.entete).toMatchObject({ transporteur: "GLS", numero: "FRTEST01" });
    expect(p.arrets.map((a) => a.doutes)).toEqual([[], []]);
    expect(p.arrets.map((a) => a.type)).toEqual(["relais", "livraison"]);
    const point = pointDepuisArret(p.arrets[1]!, p.entete.transporteur);
    expect(point).toMatchObject({ adresse: "4 AVENUE DU TEST, 31000 TOULOUSE", code: "ZX00000002", type: "livraison", telephone: "06 00 00 00 01" });
    expect(point.notes).toContain("Code GLS : Express");
    expect(pointDepuisArret(p.arrets[0]!).notes).toContain("Code bordereau : Point relais");
    // Sans position : l'ordre de la page est gardé.
    expect(fusionnerPages([p]).map((a) => a.nom)).toEqual(["TABAC DE LA GARE", "DURAND PAUL"]);
  });

  it("numérotation qui repart à 1 à chaque page : aucun arrêt perdu, ordre des pages", () => {
    const p1 = normaliserPage(page("9", 1, [bloc({ position: 1, nom: "ARRET UN", adresse: "1 RUE A" }), bloc({ position: 2, nom: "ARRET DEUX", adresse: "2 RUE B" })]));
    const p2 = normaliserPage(page("9", 2, [bloc({ position: 1, nom: "ARRET TROIS", adresse: "3 RUE C" }), bloc({ position: 2, nom: "ARRET QUATRE", adresse: "4 RUE D" })]));
    const arrets = fusionnerPages([p2, p1]);
    expect(arrets.map((a) => a.nom)).toEqual(["ARRET UN", "ARRET DEUX", "ARRET TROIS", "ARRET QUATRE"]);
    expect(new Set(arrets.map((a) => a.cle)).size).toBe(4);
  });

  it("bloc à cheval sur deux pages : un seul arrêt avec tous ses colis", () => {
    const haut = normaliserPage(page("9", 1, [bloc({ position: 5, nombre_colis: null, colis: [{ numero: "10000000000005", poids_kg: 1 }] })]));
    const bas = normaliserPage(page("9", 2, [bloc({ position: 5, nom: null, adresse: null, localite: null, nombre_colis: 2, colis: [{ numero: "10000000000006", poids_kg: 1 }] })]));
    const arrets = fusionnerPages([haut, bas]);
    expect(arrets).toHaveLength(1);
    expect(arrets[0]).toMatchObject({ nom: "MARTIN ALICE", colis: ["10000000000005", "10000000000006"], nombreColis: 2 });
    expect(memeArret(arrets[0]!, normaliserBloc(bloc({ nom: "AUTRE CLIENT", adresse: "9 RUE Z", localite: "F-31000 TOULOUSE" })))).toBe(false);
  });

  it("liste des n° de colis jamais coupée au milieu d'un n°", () => {
    const colis = Array.from({ length: 80 }, (_, i) => `1000000000${String(i).padStart(4, "0")}`);
    const codes = codesColis(colis)!;
    expect(codes.length).toBeLessThanOrEqual(1000);
    expect(codes.split(",").every((c) => c.length === 14)).toBe(true);
    expect(codesColis([])).toBeNull();
  });
});
