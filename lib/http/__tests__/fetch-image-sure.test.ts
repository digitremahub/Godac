import { describe, expect, it, vi } from "vitest";
import { estAdresseNonPublique, formatImage, telechargerImageSure, urlImageAutorisee, type Telechargeur } from "@/lib/http/fetch-image-sure";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 1]);
const publique = async () => [{ address: "93.184.216.34", family: 4 }];
const ok = (corps: Buffer, contentType = "image/png"): Telechargeur => async () => ({ status: 200, corps, contentType });

describe("adresses non publiques", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"])("%s est refusée", (ip) => {
    expect(estAdresseNonPublique(ip)).toBe(true);
  });
  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"])("%s est acceptée", (ip) => {
    expect(estAdresseNonPublique(ip)).toBe(false);
  });
  it("ce qui n'est pas une adresse est refusé", () => {
    expect(estAdresseNonPublique("pas-une-ip")).toBe(true);
  });
});

describe("URL du logo", () => {
  it("https seulement, sans identifiants, port 443", () => {
    expect(urlImageAutorisee("https://exemple.fr/logo.png")).not.toBeNull();
    expect(urlImageAutorisee("http://exemple.fr/logo.png")).toBeNull();
    expect(urlImageAutorisee("file:///etc/passwd")).toBeNull();
    expect(urlImageAutorisee("https://user:mdp@exemple.fr/logo.png")).toBeNull();
    expect(urlImageAutorisee("https://exemple.fr:8443/logo.png")).toBeNull();
    expect(urlImageAutorisee("pas une url")).toBeNull();
  });
  it("refuse localhost, noms internes et adresses privées littérales", () => {
    for (const u of ["https://localhost/x.png", "https://api.localhost/x.png", "https://base.internal/x.png", "https://imprimante.local/x.png", "https://127.0.0.1/x.png", "https://[::1]/x.png", "https://169.254.169.254/latest/meta-data"]) {
      expect(urlImageAutorisee(u), u).toBeNull();
    }
  });
});

describe("téléchargement", () => {
  it("renvoie un PNG ou un JPEG d'une adresse publique", async () => {
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: ok(PNG) })).toEqual({ data: PNG, format: "png" });
    expect(await telechargerImageSure("https://exemple.fr/l.jpg", { resoudre: publique, telecharger: ok(JPG, "image/jpeg") })).toEqual({ data: JPG, format: "jpg" });
  });
  it("refuse un nom qui se résout vers une adresse privée (aucune requête n'est faite)", async () => {
    const telecharger = vi.fn(ok(PNG));
    const mixte = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    expect(await telechargerImageSure("https://piege.exemple.fr/l.png", { resoudre: mixte, telecharger })).toBeNull();
    expect(telecharger).not.toHaveBeenCalled();
  });
  it("recontrôle chaque redirection", async () => {
    const vers = (location: string): Telechargeur => async () => ({ status: 302, location, corps: Buffer.alloc(0) });
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: vers("http://exemple.fr/l.png") })).toBeNull();
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: vers("https://169.254.169.254/latest") })).toBeNull();
    // Redirection vers un nom qui se résout en privé.
    const resoudre = async (h: string) => (h === "interne.exemple.fr" ? [{ address: "192.168.0.9", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre, telecharger: vers("https://interne.exemple.fr/l.png") })).toBeNull();
  });
  it("suit une redirection légitime, mais pas à l'infini", async () => {
    let n = 0;
    const telecharger: Telechargeur = async () => (n++ < 1 ? { status: 301, location: "/autre.png", corps: Buffer.alloc(0) } : { status: 200, corps: PNG, contentType: "image/png" });
    expect((await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger }))?.format).toBe("png");
    const boucle: Telechargeur = async () => ({ status: 302, location: "/encore", corps: Buffer.alloc(0) });
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: boucle })).toBeNull();
  });
  it("refuse les mauvais types, les gros fichiers et les erreurs", async () => {
    expect(await telechargerImageSure("https://exemple.fr/l.svg", { resoudre: publique, telecharger: ok(Buffer.from("<svg/>"), "image/svg+xml") })).toBeNull();
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: ok(Buffer.from("GIF89a"), "image/png") })).toBeNull();
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: ok(PNG), tailleMax: 3 })).toBeNull();
    expect(await telechargerImageSure("https://exemple.fr/l.png", { resoudre: publique, telecharger: async () => ({ status: 404, corps: PNG }) })).toBeNull();
  });
  it("reconnaît le format d'après les octets, pas le type annoncé", () => {
    expect(formatImage(PNG)).toBe("png");
    expect(formatImage(JPG)).toBe("jpg");
    expect(formatImage(Buffer.from("<html>"))).toBeNull();
  });
});
