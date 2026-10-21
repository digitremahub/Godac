// CSV « à la française » pour Excel : séparateur point-virgule, décimales
// à la virgule, UTF-8 avec BOM (sans lui, Excel lit les accents en
// Windows-1252), fins de ligne CRLF. Fichier pur, testé dans
// lib/paie/__tests__/export-comptable.test.ts.

export const SEPARATEUR = ";";
export const BOM = "﻿";

export type Cellule = string | number | boolean | null | undefined;

/** 1234.5 → "1234,50" (pas de séparateur de milliers : Excel le relit comme du texte). */
export function nombreFr(n: number | null | undefined, decimales = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  // -0 → 0 : « -0,00 » trouble les comptables.
  const v = Math.abs(n) < 0.5 * 10 ** -decimales ? 0 : n;
  return v.toFixed(decimales).replace(".", ",");
}

/** AAAA-MM-JJ → JJ/MM/AAAA ; vide si absent ou mal formé. */
export function dateFr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Une cellule : les nombres au format français, le texte échappé
 * (guillemets doublés, cellule entre guillemets si elle contient le
 * séparateur, un guillemet ou un saut de ligne). Une cellule texte qui
 * commence par = + - @ est préfixée d'une apostrophe pour qu'Excel ne
 * l'interprète jamais comme une formule (injection CSV).
 */
export function celluleCsv(v: Cellule): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return nombreFr(v);
  if (typeof v === "boolean") return v ? "oui" : "non";
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function ligneCsv(cellules: readonly Cellule[]): string {
  return cellules.map(celluleCsv).join(SEPARATEUR);
}

/** Document complet : BOM, en-tête, lignes, CRLF. */
export function documentCsv(entete: readonly string[], lignes: readonly (readonly Cellule[])[]): string {
  return BOM + [ligneCsv(entete), ...lignes.map(ligneCsv)].join("\r\n") + "\r\n";
}

/** Nom de fichier sûr (accents retirés, espaces conservés). */
export function nomFichier(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
