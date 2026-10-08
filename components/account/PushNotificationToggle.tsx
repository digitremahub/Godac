"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push/client";

/**
 * Self-service opt-in for web push — per device, not per account (a
 * driver with a phone and a desktop activates each separately). Sits
 * alongside email as a second notification channel for the same
 * alerts (see app/api/webhooks/supabase-alerts), never replacing it.
 */
export function PushNotificationToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = isPushSupported();
      setSupported(ok);
      if (ok) setSubscribed(Boolean(await getExistingSubscription()));
      setChecked(true);
    })();
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        const result = await subscribeToPush();
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        setSubscribed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return null;

  return (
    <Card className="flex max-w-md flex-col gap-2">
      <p className="label">Notifications push</p>
      {!supported ? (
        <p className="text-sm text-navy/50">
          Non disponible sur ce navigateur — sur iPhone, ajoutez d&apos;abord GODAC à l&apos;écran d&apos;accueil.
        </p>
      ) : (
        <>
          <p className="text-sm text-navy/60">
            {subscribed
              ? "Activées sur cet appareil — vous recevrez les alertes même sans avoir GODAC ouvert."
              : "Recevez les alertes directement sur cet appareil, en plus de l'email."}
          </p>
          <button className={subscribed ? "btn-secondary self-start" : "btn-primary self-start"} disabled={busy} onClick={toggle}>
            {busy ? "…" : subscribed ? "Désactiver" : "Activer les notifications"}
          </button>
          {error && <p className="text-xs text-orange-ink">{error}</p>}
        </>
      )}
    </Card>
  );
}
