"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Scanne un QR code contenant directement une adresse ou un texte d'adresse. */
export function AddressQrScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let cancelled = false;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Caméra non prise en charge.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch {
        setError("Caméra indisponible. Vous pouvez saisir l'adresse manuellement.");
      }
    }
    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height);
      if (code?.data.trim()) {
        onScanRef.current(code.data.trim());
        return;
      }
      rafId = requestAnimationFrame(tick);
    }
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-teal/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Scanner le QR code de l'adresse</p>
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={onClose}>Fermer</button>
      </div>
      {error ? <p role="alert" className="text-sm text-orange-ink">{error}</p> : (
        <div className="mx-auto w-full max-w-xs overflow-hidden rounded-lg">
          <video ref={videoRef} muted playsInline className="w-full" aria-label="Caméra de lecture du QR code d'adresse" />
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
      <p className="text-xs text-navy/60">Le QR code doit contenir l'adresse ou le texte d'adresse. Vérifiez la valeur avant d'enregistrer.</p>
    </div>
  );
}
