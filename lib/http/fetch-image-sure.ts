import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

/**
 * Téléchargement d'une image à partir d'une URL saisie par un utilisateur
 * (logo d'entreprise du bulletin de paie), protégé contre la SSRF :
 * - https seulement, sans identifiants dans l'URL, port 443 ;
 * - le nom de domaine est résolu, et TOUTES les adresses doivent être
 *   publiques (ni loopback, ni privées, ni lien-local, ni métadonnées cloud) ;
 * - la connexion est épinglée sur l'adresse contrôlée (pas de seconde
 *   résolution DNS exploitable) ;
 * - redirections suivies à la main (3 au maximum), chacune recontrôlée ;
 * - délai total et taille bornés, types PNG/JPEG seulement.
 * La partie décisionnelle est pure et testée (lib/http/__tests__/fetch-image-sure.test.ts).
 */

export const IMAGE_TAILLE_MAX = 2_000_000;
export const IMAGE_DELAI_MS = 4000;
export const IMAGE_REDIRECTIONS_MAX = 3;

/** Adresse IPv4 ou IPv6 non routable publiquement. */
export function estAdresseNonPublique(adresse: string): boolean {
  const version = isIP(adresse);
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = adresse.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // partage d'adresses opérateur
      (a === 169 && b === 254) || // lien-local, métadonnées cloud
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast et réservé
    );
  }
  if (version === 6) {
    const brut = adresse.toLowerCase().split("%")[0] ?? "";
    // IPv4 inscrite dans de l'IPv6 (::ffff:10.0.0.1) : on contrôle l'IPv4.
    const mappee = brut.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mappee) return estAdresseNonPublique(mappee[1]!);
    if (/^(?:::ffff:|64:ff9b::)[0-9a-f]+:[0-9a-f]+$/.test(brut)) return true;
    return brut === "::" || brut === "::1" || /^f[cd]/.test(brut) || /^fe[89ab]/.test(brut) || brut.startsWith("ff");
  }
  return true;
}

/** URL acceptée avant toute résolution : https, sans identifiants, port 443. */
export function urlImageAutorisee(brut: string): URL | null {
  let url: URL;
  try {
    url = new URL(brut);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const hote = url.hostname.replace(/^\[|\]$/g, "");
  if (!hote || hote === "localhost" || hote.endsWith(".localhost") || hote.endsWith(".internal") || hote.endsWith(".local")) return null;
  if (isIP(hote) && estAdresseNonPublique(hote)) return null;
  return url;
}

/** PNG ou JPEG d'après les premiers octets (le type annoncé par le serveur n'est pas fiable). */
export function formatImage(data: Buffer): "png" | "jpg" | null {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0xff && data[1] === 0xd8) return "jpg";
  return null;
}

export interface Adresse {
  address: string;
  family: number;
}
export interface ReponseBrute {
  status: number;
  location?: string;
  contentType?: string;
  corps: Buffer;
}
export type Resolveur = (hote: string) => Promise<Adresse[]>;
export type Telechargeur = (url: URL, adresse: Adresse, delaiMs: number, tailleMax: number) => Promise<ReponseBrute>;

const resoudre: Resolveur = (hote) => lookup(hote, { all: true });

/** Connexion https épinglée sur l'adresse déjà contrôlée ; lecture arrêtée au-delà de la taille permise. */
const telechargerEpingle: Telechargeur = (url, adresse, delaiMs, tailleMax) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", timeout: delaiMs, headers: { Accept: "image/png,image/jpeg", "User-Agent": "GODAC-logo" }, lookup: (_h, _o, cb) => (cb as (e: null, a: string, f: number) => void)(null, adresse.address, adresse.family) },
      (res) => {
        const morceaux: Buffer[] = [];
        let total = 0;
        res.on("data", (m: Buffer) => {
          total += m.length;
          if (total > tailleMax) {
            req.destroy(new Error("image trop lourde"));
            return;
          }
          morceaux.push(m);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            contentType: res.headers["content-type"],
            corps: Buffer.concat(morceaux),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("délai dépassé")));
    req.on("error", reject);
    req.end();
  });

export type ImageSure = { data: Buffer; format: "png" | "jpg" };

/** Image PNG/JPEG téléchargée en sécurité, ou null (refus ou échec : l'appelant n'a pas à distinguer). */
export async function telechargerImageSure(
  brut: string,
  options: { resoudre?: Resolveur; telecharger?: Telechargeur; delaiMs?: number; tailleMax?: number } = {},
): Promise<ImageSure | null> {
  const { resoudre: resoudreHote = resoudre, telecharger = telechargerEpingle, delaiMs = IMAGE_DELAI_MS, tailleMax = IMAGE_TAILLE_MAX } = options;
  const fin = Date.now() + delaiMs;
  let url = urlImageAutorisee(brut);
  for (let saut = 0; url && saut <= IMAGE_REDIRECTIONS_MAX; saut++) {
    const restant = fin - Date.now();
    if (restant <= 0) return null;
    const hote = url.hostname.replace(/^\[|\]$/g, "");
    const adresses = isIP(hote) ? [{ address: hote, family: isIP(hote) }] : await resoudreHote(hote);
    if (!adresses.length || adresses.some((a) => estAdresseNonPublique(a.address))) return null;
    const reponse = await telecharger(url, adresses[0]!, restant, tailleMax);
    if (reponse.status >= 300 && reponse.status < 400 && reponse.location) {
      url = urlImageAutorisee(new URL(reponse.location, url).toString());
      continue;
    }
    if (reponse.status !== 200 || reponse.corps.length > tailleMax) return null;
    if (reponse.contentType && !/^image\/(png|jpe?g)\b/i.test(reponse.contentType)) return null;
    const format = formatImage(reponse.corps);
    return format ? { data: reponse.corps, format } : null;
  }
  return null;
}
