"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { creerDetecteur, type Detecteur } from "@/lib/colis/detecteur";

/**
 * Scanner continu pour charger une tournée : on passe les colis devant
 * la caméra les uns après les autres. Lit QR, Datamatrix et codes-barres
 * 1D avec le détecteur natif du navigateur, ou ZXing là où il manque
 * (iPhone, Firefox) — voir lib/colis/detecteur.ts. jsQR (QR seulement)
 * ne sert que si aucun des deux ne se charge. Un même code n'est remonté
 * qu'une fois toutes les 3 secondes.
 *
 * `consigne`, `bouton` et `calque` adaptent le scanner à d'autres usages
 * (QR code du destinataire à la livraison, au-dessus de la feuille de
 * livraison).
 */
export function ParcelScanner({
  onCode,
  onClose,
  consigne = "Passez les colis un par un devant la caméra",
  bouton = "Terminer le scan",
  statut = "",
  calque = "z-[60]",
}: {
  onCode: (text: string, image?: string) => void;
  onClose: () => void;
  consigne?: string;
  bouton?: string;
  statut?: string;
  calque?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [error, setError] = useState<string | null>(null);
  const [natif, setNatif] = useState(false);
  const [flash, setFlash] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let detector: Detecteur | null = null;

    creerDetecteur().then((d) => {
      if (cancelled) return;
      detector = d;
      setNatif(d !== null);
    });

    const emit = (text: string) => {
      const now = Date.now();
      if (text === last.current.text && now - last.current.at < 3000) return;
      last.current = { text, at: now };
      navigator.vibrate?.(60);
      setFlash(true);
      setTimeout(() => setFlash(false), 250);
      // Capture l'étiquette au moment du scan pour lire l'adresse automatiquement.
      let image: string | undefined;
      const video = videoRef.current;
      if (video?.videoWidth && video.videoHeight) {
        const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
        const shot = document.createElement("canvas");
        shot.width = Math.round(video.videoWidth * scale);
        shot.height = Math.round(video.videoHeight * scale);
        const ctx = shot.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, shot.width, shot.height);
          image = shot.toDataURL("image/jpeg", 0.45).split(",")[1];
        }
      }
      onCodeRef.current(text, image);
    };

    async function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!cancelled && video && canvas && video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) emit(codes[0].rawValue);
          } else {
            const w = video.videoWidth;
            const h = video.videoHeight;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, w, h);
              const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
              if (code?.data) emit(code.data);
            }
          }
        } catch {
          /* image suivante */
        }
      }
      if (!cancelled) timer = setTimeout(tick, 180);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setError("Caméra indisponible : autorisez l'accès à la caméra dans le navigateur.");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={`fixed inset-0 ${calque} flex flex-col bg-black`}>
      <div className="relative flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-8 top-1/2 h-48 -translate-y-1/2 rounded-2xl border-4 transition-colors ${flash ? "border-teal" : "border-white/70"}`} />
        <p className="absolute inset-x-0 top-4 text-center text-sm font-semibold text-white drop-shadow">
          {consigne}
          <span className="block text-xs font-normal text-white/75">{natif ? "QR, Datamatrix et codes-barres" : "Codes QR"}</span>
          {statut && <span className="mx-auto mt-2 block max-w-[90%] rounded-lg bg-teal px-3 py-2 text-sm font-semibold text-white">{statut}</span>}
        </p>
        {error && <p className="absolute inset-x-4 bottom-24 rounded-xl bg-orange px-4 py-3 text-sm font-semibold text-white">{error}</p>}
      </div>
      <div className="bg-marine p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" className="btn-primary w-full !py-3 text-base" onClick={onClose}>
          {bouton}
        </button>
      </div>
    </div>
  );
}
