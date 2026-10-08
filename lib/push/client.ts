"use client";

/**
 * Browser-side half of web push (Module 8) — the server half is
 * lib/push/send.ts. Degrades the same way every optional integration
 * in this app does: unsupported browser or missing VAPID key just
 * means the "Activer les notifications" button never succeeds,
 * email notifications keep working regardless.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export type SubscribeResult = { ok: true } | { ok: false; reason: string };

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "Notifications non supportées par ce navigateur." };
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return { ok: false, reason: "Notifications push non configurées pour cette organisation." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Autorisation refusée — activez les notifications dans les réglages du navigateur." };
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) {
    return { ok: false, reason: "Échec de l'enregistrement côté serveur." };
  }

  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}
