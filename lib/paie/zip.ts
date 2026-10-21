// Archive ZIP minimale, sans compression (« stored ») : les PDF sont déjà
// compressés, et cela évite une dépendance de plus. Sert à l'export des
// bulletins (salarié : les siens ; direction : tous) et à l'export
// comptable avec le journal PDF. Fichier pur, testé dans
// lib/paie/__tests__/zip.test.ts.

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE_CRC[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface FichierZip {
  nom: string;
  contenu: Uint8Array | string;
  /** Date de modification affichée ; par défaut maintenant. */
  date?: Date;
}

function dateDos(d: Date): { heure: number; jour: number } {
  return {
    heure: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    jour: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Noms uniques dans l'archive : « a.pdf », « a (2).pdf »… */
export function nomsUniques(noms: readonly string[]): string[] {
  const vus = new Map<string, number>();
  return noms.map((nom) => {
    const n = (vus.get(nom) ?? 0) + 1;
    vus.set(nom, n);
    if (n === 1) return nom;
    const i = nom.lastIndexOf(".");
    return i > 0 ? `${nom.slice(0, i)} (${n})${nom.slice(i)}` : `${nom} (${n})`;
  });
}

/** Construit l'archive (noms en UTF-8, drapeau 0x0800). */
export function creerZip(fichiers: readonly FichierZip[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const noms = nomsUniques(fichiers.map((f) => f.nom));
  const locaux: Uint8Array[] = [];
  const centraux: Uint8Array[] = [];
  let decalage = 0;

  fichiers.forEach((f, i) => {
    const nom = enc.encode(noms[i]!);
    const data = typeof f.contenu === "string" ? enc.encode(f.contenu) : f.contenu;
    const crc = crc32(data);
    const { heure, jour } = dateDos(f.date ?? new Date());

    const local = new Uint8Array(30 + nom.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, heure, true);
    lv.setUint16(12, jour, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nom.length, true);
    lv.setUint16(28, 0, true);
    local.set(nom, 30);
    locaux.push(local, data);

    const central = new Uint8Array(46 + nom.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, heure, true);
    cv.setUint16(14, jour, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nom.length, true);
    cv.setUint32(42, decalage, true);
    central.set(nom, 46);
    centraux.push(central);

    decalage += local.length + data.length;
  });

  const tailleCentral = centraux.reduce((t, c) => t + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, fichiers.length, true);
  fv.setUint16(10, fichiers.length, true);
  fv.setUint32(12, tailleCentral, true);
  fv.setUint32(16, decalage, true);

  const parties = [...locaux, ...centraux, fin];
  const sortie = new Uint8Array(parties.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parties) {
    sortie.set(p, o);
    o += p.length;
  }
  return sortie;
}
