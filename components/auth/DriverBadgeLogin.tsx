"use client";

import { useState } from "react";
import { QrScanner } from "@/components/fuel/QrScanner";
import { IconQrCode } from "@/components/layout/icons";
import { postLoginPath } from "@/lib/auth/post-login";

/**
 * « Chauffeur ? Scanner mon badge » on the sign-in page — a driver who
 * scanned a truck QR with the phone's camera lands here in the browser
 * (not the installed app, so not signed in yet): badge → PIN → straight
 * back to the page they were going to (redirect_to).
 */
export function DriverBadgeLogin() {
  const [scanning, setScanning] = useState(false);

  if (scanning) {
    return (
      <div className="card flex flex-col items-center gap-3">
        <QrScanner
          expected="driver"
          allowManual={false}
          label="Présentez votre badge chauffeur"
          onScan={(payload) => {
            window.location.href = `/driver-pin/${payload.id}?redirect_to=${encodeURIComponent(postLoginPath())}`;
          }}
        />
        <button type="button" className="btn-ghost" onClick={() => setScanning(false)}>
          Annuler
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="btn-dark w-full !py-3.5 text-base" onClick={() => setScanning(true)}>
      <IconQrCode className="h-5 w-5 text-teal" />
      Chauffeur ? Scanner mon badge
    </button>
  );
}
