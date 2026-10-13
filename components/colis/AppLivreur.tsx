"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconRefresh, IconX } from "@/components/layout/icons";
import { lienSms, lienTel, normaliserTelephone } from "@/lib/colis/telephone";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { api, gmaps, waze, SMS_ARRIVEE, type Run, type RunResume, type Stop } from "@/components/colis/commun";

const MEMO = "godac-tournee-colis";

/**
 * Application chauffeur : l'arrêt en cours en grand (adresse, client,
 * appel, SMS, navigation, livré / absent), puis la liste des adresses
 * suivantes avec leur bouton d'appel. L'écran reste allumé pendant la
 * tournée quand le téléphone le permet.
 */
export function AppLivreur({ prenom }: { prenom: string | null }) {
  const [runs, setRuns] = useState<RunResume[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [voirTermines, setVoirTermines] = useState(false);

  const charger = useCallback(async (prefere?: string | null) => {
    try {
      const { tournees } = await api<{ tournees: RunResume[] }>("/api/colis/tournees");
      setRuns(tournees);
      let memo: string | null = null;
      try {
        memo = localStorage.getItem(MEMO);
      } catch {
        /* stockage indisponible */
      }
      const actives = tournees.filter((t) => t.status !== "done");
      const choix =
        [prefere, memo].find((id) => id && actives.some((t) => t.id === id)) ??
        actives.find((t) => t.status === "in_progress")?.id ??
        actives[0]?.id ??
        null;
      if (!choix) {
        setRun(null);
        setStops([]);
        return;
      }
      const data = await api<{ run: Run; stops: Stop[] }>(`/api/colis/tournees/${choix}`);
      setRun(data.run);
      setStops(data.stops);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      setRuns((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Écran toujours allumé pendant la livraison (Android / iOS récents).
  useEffect(() => {
    if (run?.status !== "in_progress") return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const demander = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    demander();
    const visible = () => document.visibilityState === "visible" && demander();
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      lock?.release().catch(() => undefined);
    };
  }, [run?.status]);

  function choisir(id: string) {
    try {
      localStorage.setItem(MEMO, id);
    } catch {
      /* stockage indisponible */
    }
    charger(id);
  }

  async function statut(s: Stop, status: Stop["status"]) {
    setStops((all) => all.map((x) => (x.id === s.id ? { ...x, status } : x)));
    if (status !== "pending") navigator.vibrate?.(40);
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run?.id);
    }
  }

  async function ajouterTelephone(s: Stop) {
    const saisi = prompt(`Téléphone du client — ${s.recipient ?? s.address}`, s.phone ?? "");
    if (saisi === null) return;
    const tel = normaliserTelephone(saisi);
    if (saisi.trim() && !tel) return setToast({ ok: false, text: "Numéro non reconnu." });
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ telephone: tel }) });
      setStops((all) => all.map((x) => (x.id === s.id ? { ...x, phone: tel } : x)));
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  async function demarrer() {
    if (!run) return;
    setBusy(true);
    try {
      if (!run.optimized_at && stops.length > 1) await api("/api/colis/optimiser", { method: "POST", body: JSON.stringify({ run_id: run.id }) });
      await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
      await charger(run.id);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function reoptimiser() {
    if (!run) return;
    setBusy(true);
    try {
      const depuis = await new Promise<{ lat: number; lng: number } | null>((resolve) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 10000 })
          : resolve(null),
      );
      const r = await api<{ kmApres: number }>("/api/colis/optimiser", { method: "POST", body: JSON.stringify({ run_id: run.id, depuis }) });
      await charger(run.id);
      setToast({ ok: true, text: `Ordre recalculé${depuis ? " depuis votre position" : ""} : ≈ ${r.kmApres} km.` });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function cloturer() {
    if (!run) return;
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }).catch(() => undefined);
    await charger(null);
  }

  const pending = stops.filter((s) => s.status === "pending");
  const termines = stops.filter((s) => s.status !== "pending");
  const prochain = pending[0];
  const suivants = pending.slice(1);
  const actives = (runs ?? []).filter((t) => t.status !== "done");
  const progression = stops.length ? Math.round((termines.length / stops.length) * 100) : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-30 bg-marine px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-pop">
        <div className="flex items-center justify-between gap-3">
          <Link href="/colis" className="flex items-center gap-2 text-sm text-white/75" aria-label="Retour à la tournée colis">
            <span aria-hidden="true" className="text-lg leading-none">‹</span>
            <Wordmark inverted height={22} />
          </Link>
          <button type="button" className="rounded-full p-2 text-white/80 hover:bg-white/10" onClick={() => charger(run?.id)} aria-label="Actualiser">
            <IconRefresh className="h-5 w-5" />
          </button>
        </div>
        {run && (
          <div className="mt-2">
            <div className="flex items-baseline justify-between gap-2">
              {actives.length > 1 ? (
                <select
                  className="min-w-0 rounded-lg bg-white/10 px-2 py-1 text-sm font-semibold text-white"
                  value={run.id}
                  onChange={(e) => choisir(e.target.value)}
                  aria-label="Choisir la tournée"
                >
                  {actives.map((t) => (
                    <option key={t.id} value={t.id} className="text-navy">
                      {t.name ?? "Tournée"}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="truncate text-sm font-semibold">{run.name ?? "Tournée"}</p>
              )}
              <p className="shrink-0 text-sm tabular-nums text-white/80">
                {termines.length}/{stops.length} arrêts
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={progression} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement">
              <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${progression}%` }} />
            </div>
          </div>
        )}
      </header>

      {toast && (
        <p role="status" className={`fixed inset-x-4 top-24 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-white"}`}>
          {toast.text}
        </p>
      )}

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {runs === null ? (
          <p className="py-10 text-center text-sm text-navy/60">Chargement de la tournée…</p>
        ) : !run ? (
          <section className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-display text-xl font-bold">{prenom ? `Bonjour ${prenom}` : "Bonjour"}</p>
            <p className="text-sm text-navy/65">Aucune tournée colis en cours. Chargez vos colis pour commencer.</p>
            <Link href="/colis" className="btn-primary !py-3">
              Charger mes colis
            </Link>
          </section>
        ) : run.status === "loading" ? (
          <section className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-card">
            <p className="font-display text-lg font-bold">Tournée pas encore démarrée</p>
            <p className="text-sm text-navy/65">
              {stops.length} adresse(s) chargée(s). GODAC calcule le meilleur ordre puis vous guide arrêt par arrêt.
            </p>
            <button type="button" className="btn-primary !py-3.5 text-base" disabled={busy || !stops.length} onClick={demarrer}>
              {busy ? "Calcul de l'ordre…" : "Démarrer la livraison"}
            </button>
            <Link href="/colis" className="btn-ghost w-fit !px-2 text-sm">
              Ajouter ou modifier des colis
            </Link>
          </section>
        ) : prochain ? (
          <section className="flex flex-col gap-4 rounded-2xl border-2 border-teal/60 bg-surface p-5 shadow-card" aria-label="Arrêt en cours">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-ink">
              Arrêt {stops.indexOf(prochain) + 1} / {stops.length}
              {prochain.parcel_count > 1 && ` · ${prochain.parcel_count} colis`}
            </p>
            <div>
              <p className="font-display text-2xl font-bold leading-tight">{prochain.address}</p>
              {prochain.recipient && <p className="mt-1 text-base text-navy/75">{prochain.recipient}</p>}
              {prochain.notes && <p className="mt-1 text-sm text-navy/65">{prochain.notes}</p>}
              {prochain.lat === null && <p className="mt-1 text-xs font-semibold text-orange-ink">Adresse non localisée : vérifiez-la dans la navigation.</p>}
            </div>

            {prochain.phone ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <a href={lienTel(prochain.phone)} className="btn-secondary justify-center border-teal/70 !py-3.5 text-base text-teal-ink">
                  <IconPhone className="h-5 w-5" /> Appeler · {prochain.phone}
                </a>
                <a href={lienSms(prochain.phone, SMS_ARRIVEE)} className="btn-secondary justify-center !px-4 !py-3.5" aria-label="Envoyer un SMS « j'arrive »">
                  <IconMessage className="h-5 w-5" />
                </a>
              </div>
            ) : (
              <button type="button" className="btn-secondary justify-center !py-3" onClick={() => ajouterTelephone(prochain)}>
                <IconPhone className="h-4 w-4" /> Ajouter le numéro du client
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <a href={waze(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
                <IconNavigation className="h-4 w-4" /> Waze
              </a>
              <a href={gmaps(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
                <IconMapPin className="h-4 w-4" /> Google Maps
              </a>
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <button type="button" className="btn-primary justify-center !py-4 text-lg" onClick={() => statut(prochain, "delivered")}>
                <IconCheck className="h-6 w-6" /> Livré
              </button>
              <button type="button" className="btn-secondary justify-center !py-4 text-orange-ink" onClick={() => statut(prochain, "failed")}>
                <IconX className="h-5 w-5" /> Absent
              </button>
            </div>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-6 text-center shadow-card">
            <p className="font-display text-xl font-bold">Tournée terminée 🎉</p>
            <p className="text-sm text-navy/65">
              {stops.filter((s) => s.status === "delivered").length} livré(s), {stops.filter((s) => s.status === "failed").length} absent(s).
            </p>
            {run.status !== "done" && (
              <button type="button" className="btn-primary !py-3" onClick={cloturer}>
                Clôturer la tournée
              </button>
            )}
          </section>
        )}

        {run && run.status !== "loading" && suivants.length > 0 && (
          <section aria-label="Adresses suivantes">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-navy/60">Ensuite · {suivants.length}</h2>
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={reoptimiser}>
                {busy ? "Calcul…" : "Recalculer depuis ici"}
              </button>
            </div>
            <ol className="flex flex-col gap-2">
              {suivants.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 shadow-card">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal">{stops.indexOf(s) + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{s.address}</p>
                    <p className="truncate text-xs text-navy/60">{[s.recipient, s.parcel_count > 1 && `${s.parcel_count} colis`].filter(Boolean).join(" · ") || " "}</p>
                  </div>
                  {s.phone ? (
                    <a href={lienTel(s.phone)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address} (${s.phone})`}>
                      <IconPhone className="h-5 w-5" />
                    </a>
                  ) : (
                    <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/[0.05] text-navy/40" onClick={() => ajouterTelephone(s)} aria-label={`Ajouter le numéro de ${s.recipient ?? s.address}`}>
                      <IconPhone className="h-5 w-5" />
                    </button>
                  )}
                  <a href={waze(s)} target="_blank" rel="noreferrer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/[0.05] text-navy/70" aria-label={`Naviguer vers ${s.address}`}>
                    <IconNavigation className="h-5 w-5" />
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        {run && termines.length > 0 && (
          <section aria-label="Arrêts terminés">
            <button type="button" className="btn-ghost w-full justify-between !px-1 text-sm text-navy/60" onClick={() => setVoirTermines((v) => !v)} aria-expanded={voirTermines}>
              <span>Terminés · {termines.length}</span>
              <span aria-hidden="true">{voirTermines ? "▴" : "▾"}</span>
            </button>
            {voirTermines && (
              <ol className="mt-1 flex flex-col gap-1.5">
                {termines.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2 opacity-70">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.status === "delivered" ? "bg-teal text-marine" : "bg-orange text-white"}`}>
                      {s.status === "delivered" ? "✓" : "!"}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm">{s.address}</p>
                    {s.phone && (
                      <a href={lienTel(s.phone)} className="btn-ghost !px-2 !py-1 text-teal-ink" aria-label={`Rappeler ${s.recipient ?? s.address}`}>
                        <IconPhone className="h-4 w-4" />
                      </a>
                    )}
                    {run.status !== "done" && (
                      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => statut(s, "pending")}>
                        Annuler
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
