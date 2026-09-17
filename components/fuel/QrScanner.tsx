"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parseScanPayload, type ScanPayload } from "@/lib/qr/scan-targets";

/**
 * Live QR scanner for the fuel-entry flow: point the phone at the
 * sticker on the truck, then the one on the pump/cuve, and the form
 * fills itself in — no dropdown hunting. Decodes frames with jsQR off
 * a hidden canvas rather than pulling in a native barcode API, so it
 * works the same on any mobile browser.
 */
export function QrScanner({
  expected,
  onScan,
  label,
}: {
  expected: ScanPayload["type"];
  onScan: (payload: ScanPayload) => void;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch (err) {
        setError("Caméra indisponible — utilisez la saisie manuelle ci-dessous.");
        setManualInput(true);
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        const payload = parseScanPayload(code.data);
        if (payload && payload.type === expected) {
          onScan(payload);
          return; // stop scanning loop, parent will unmount/advance
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [expected, onScan]);

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-navy/70">{label}</p>
      {!manualInput && (
        <div className="relative w-full max-w-xs overflow-hidden rounded-xl border border-teal/40">
          <video ref={videoRef} className="w-full" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <button className="text-xs text-navy/50 underline" onClick={() => setManualInput((v) => !v)}>
        {manualInput ? "Réessayer la caméra" : "Saisir le code manuellement"}
      </button>
      {manualInput && (
        <ManualScanInput expected={expected} onScan={onScan} />
      )}
    </div>
  );
}

function ManualScanInput({
  expected,
  onScan,
}: {
  expected: ScanPayload["type"];
  onScan: (payload: ScanPayload) => void;
}) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <div className="flex w-full max-w-xs gap-2">
      <input
        className="input"
        placeholder="Coller le contenu du QR ou l'identifiant"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="btn-secondary"
        onClick={() => {
          const payload = parseScanPayload(value) ?? (isUuid(value) ? { type: expected, id: value } : null);
          if (!payload || payload.type !== expected) {
            setLocalError("Code invalide pour ce type d'élément.");
            return;
          }
          setLocalError(null);
          onScan(payload);
        }}
      >
        OK
      </button>
      {localError && <p className="text-xs text-orange-ink">{localError}</p>}
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}
