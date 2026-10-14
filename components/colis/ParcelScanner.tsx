"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Scanner continu pour charger une tournée : on passe les colis devant
 * la caméra les uns après les autres. Utilise le détecteur natif du
 * téléphone (QR, Datamatrix, codes-barres 1D) quand le navigateur le
 * propose, sinon jsQR (QR uniquement). Un même code n'est remonté
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
  calque = "z-[60]",
}: {
  onCode: (text: string) => void;
  onClose: () => void;
  consigne?: string;
  bouton?: string;
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
    let detector: Detector | null = null;

    const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (BD) {
      try {
        detector = new BD({ formats: ["qr_code", "data_matrix", "code_128", "code_39", "ean_13", "itf", "pdf417", "aztec"] });
        setNatif(true);
      } catch {
        detector = null;
      }
    }

    const emit = (text: string) => {
      const now = Date.now();
      if (text === last.current.text && now - last.current.at < 3000) return;
      last.current = { text, at: now };
      navigator.vibrate?.(60);
      setFlash(true);
      setTimeout(() => setFlash(false), 250);
      onCodeRef.current(text);
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
