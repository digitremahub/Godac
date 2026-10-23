"use client";

import { contraintesCamera } from "@/lib/colis/scan";

/**
 * Flux caméra partagé : le scanner se rouvre souvent (un colis après
 * l'autre, livraison après livraison) et rouvrir getUserMedia coûte 0,5 à
 * 2 s sur téléphone (et redemande l'autorisation sur certains
 * navigateurs). Le flux est donc gardé quelques secondes après la
 * fermeture du scanner, puis coupé : la LED de la caméra s'éteint.
 */
const GARDE_MS = 8000;

let flux: MediaStream | null = null;
let ouverture: Promise<MediaStream> | null = null;
let utilisateurs = 0;
let minuterie: ReturnType<typeof setTimeout> | null = null;

const vivant = (s: MediaStream | null): s is MediaStream => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

function couper() {
  flux?.getTracks().forEach((t) => t.stop());
  flux = null;
}

async function demander(): Promise<MediaStream> {
  const essais: MediaStreamConstraints[] = [
    contraintesCamera(),
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];
  let derniere: unknown;
  for (const c of essais) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      derniere = e;
      // Refus de l'utilisateur ou caméra occupée : inutile d'insister avec d'autres contraintes.
      const nom = (e as { name?: string })?.name;
      if (nom !== "OverconstrainedError" && nom !== "NotFoundError" && nom !== "TypeError") break;
    }
  }
  throw derniere;
}

/** Ouvre (ou réutilise) la caméra arrière. Chaque appel doit être suivi d'un relacherCamera(). */
export async function ouvrirCamera(): Promise<MediaStream> {
  utilisateurs++;
  if (minuterie) {
    clearTimeout(minuterie);
    minuterie = null;
  }
  try {
    if (vivant(flux)) return flux;
    ouverture ??= demander().finally(() => {
      ouverture = null;
    });
    flux = await ouverture;
    return flux;
  } catch (e) {
    utilisateurs = Math.max(0, utilisateurs - 1);
    throw e;
  }
}

/** Libère la caméra : coupée après quelques secondes si personne ne la reprend. */
export function relacherCamera(): void {
  utilisateurs = Math.max(0, utilisateurs - 1);
  if (utilisateurs > 0 || minuterie) return;
  minuterie = setTimeout(() => {
    minuterie = null;
    if (utilisateurs === 0) couper();
  }, GARDE_MS);
}

/** Coupe tout de suite (page masquée, navigation). */
export function couperCameraMaintenant(): void {
  if (minuterie) clearTimeout(minuterie);
  minuterie = null;
  if (utilisateurs === 0) couper();
}

/** Torche disponible sur ce flux ? (Android Chrome ; absente sur iOS Safari.) */
export function torcheSupportee(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { getCapabilities?: () => Record<string, unknown> }) | undefined;
  return Boolean(track?.getCapabilities && "torch" in track.getCapabilities());
}

export async function reglerTorche(stream: MediaStream, allumee: boolean): Promise<boolean> {
  try {
    await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: allumee } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Mise au point continue si l'appareil la propose (sinon sans effet). */
export async function activerAutofocus(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  const modes = (track?.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode;
  if (!modes?.includes("continuous")) return;
  await track!.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
}
