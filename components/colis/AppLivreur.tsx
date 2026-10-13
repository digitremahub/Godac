"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Wordmark } from "@/components/brand/Wordmark";
import { IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconRefresh, IconX } from "@/components/layout/icons";
import { lienSms, lienTel, normaliserTelephone } from "@/lib/colis/telephone";
import { garderEcranAllume } from "@/lib/colis/natif";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { LivraisonSheet } from "@/components/colis/LivraisonSheet";
import { api, gmaps, waze, SMS_ARRIVEE, type Liste, type Run, type RunResume, type Stop } from "@/components/colis/commun";
import { compteurs, grouperParListe, nomGroupe } from "@/lib/colis/listes";
import type { Itineraire } from "@/lib/colis/itineraire";
import { estimerAvancement, heureFin } from "@/lib/colis/estimation";

// La carte (MapLibre) n'est chargée que si le chauffeur l'ouvre.
const CarteTournee = dynamic(() => import("@/components/colis/CarteTournee").then((m) => m.CarteTournee), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-sm text-navy/60">Chargement de la carte…</p>,
});
const MEMO_VUE = "godac-livreur-vue";
const MEMO_PARTAGE = "godac-partage-position";
/** Fréquence d'envoi de la position à l'exploitation pendant la tournée. */
const ENVOI_POSITION_MS = 60_000;

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
  const [lists, setLists] = useState<Liste[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [voirTermines, setVoirTermines] = useState(false);
  const [livraison, setLivraison] = useState<Stop | null>(null);
  const [vue, setVue] = useState<"liste" | "carte">("liste");
  const [selection, setSelection] = useState<string | null>(null);
  const [itineraire, setItineraire] = useState<Itineraire | null>(null);
  const [partage, setPartage] = useState(true);
  const [maPosition, setMaPosition] = useState<{ lat: number; lng: number } | null>(null);
  const dernierEnvoi = useRef(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(MEMO_PARTAGE) === "non") setPartage(false);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  // Pendant la tournée en cours : dernière position envoyée à l'exploitation
  // (au plus une fois par minute, écran ouvert), jamais en dehors.
  const runEnCours = run?.status === "in_progress" ? run.id : null;
  useEffect(() => {
    if (!runEnCours || !partage || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        const maintenant = Date.now();
        if (maintenant - dernierEnvoi.current < ENVOI_POSITION_MS) return;
        dernierEnvoi.current = maintenant;
        setMaPosition(pos);
        fetch("/api/colis/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runEnCours, ...pos }) }).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [runEnCours, partage]);

  function basculerPartage() {
    const suivant = !partage;
    setPartage(suivant);
    dernierEnvoi.current = 0;
    try {
      localStorage.setItem(MEMO_PARTAGE, suivant ? "oui" : "non");
    } catch {
      /* stockage indisponible */
    }
    if (!suivant && runEnCours) {
      fetch("/api/colis/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runEnCours, masquer: true }) }).catch(() => undefined);
    }
  }

  useEffect(() => {
    try {
      if (localStorage.getItem(MEMO_VUE) === "carte") setVue("carte");
    } catch {
      /* stockage indisponible */
    }
  }, []);
  function changerVue(v: "liste" | "carte") {
    setVue(v);
    try {
      localStorage.setItem(MEMO_VUE, v);
    } catch {
      /* stockage indisponible */
    }
  }
  const choisirArret = useCallback((id: string) => setSelection(id), []);

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
      const data = await api<{ run: Run; stops: Stop[]; lists?: Liste[] }>(`/api/colis/tournees/${choix}`);
      setRun(data.run);
      setStops(data.stops);
      setLists(data.lists ?? []);
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
    let relacherNatif: (() => void) | null = null;
    garderEcranAllume().then((f) => (relacherNatif = f));
    const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const demander = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    demander();
    const visible = () => document.visibilityState === "visible" && demander();
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      lock?.release().catch(() => undefined);
      relacherNatif?.();
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
    setStops((all) => all.map((x) => (x.id === s.id ? { ...x, status, done_at: status === "pending" ? null : new Date().toISOString() } : x)));
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
  // Plusieurs listes : séparateurs avec le nom et les arrêts restants de chaque liste.
  const groupes = grouperParListe(stops, lists);
  const multi = groupes.length > 1 || groupes[0]?.liste != null;
  const groupeDe = (s: Stop) => groupes.find((g) => g.arrets.includes(s)) ?? groupes[0]!;
  const separateur = (s: Stop) => {
    const g = groupeDe(s);
    const r = compteurs(g.arrets).restants;
    return `${nomGroupe(g)} · ${r} restant${r > 1 ? "s" : ""}`;
  };
  const actives = (runs ?? []).filter((t) => t.status !== "done");
  const progression = stops.length ? Math.round((termines.length / stops.length) * 100) : 0;
  const avancement = estimerAvancement(
    stops.map((s) => ({ status: s.status, parcel_count: s.parcel_count, lat: s.lat, lng: s.lng, done_at: s.done_at ?? null })),
    {
      position: maPosition,
      depot: run && run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null,
      retourDepot: run?.return_to_start,
      minutesItineraire: itineraire && !itineraire.approx ? itineraire.dureeMin : null,
    },
  );
  const enCarte = vue === "carte" && run !== null && run.status !== "loading" && stops.length > 0;
  const arretCarte = stops.find((s) => s.id === selection) ?? prochain ?? null;

  return (
    <div className={`flex flex-col bg-paper ${enCarte ? "h-dvh" : "min-h-dvh"}`}>
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
            {run.status === "in_progress" && avancement.adressesRestantes > 0 && (
              <p className="mt-2 text-xs text-white/80">
                <strong className="text-white">{avancement.adressesRestantes}</strong> adresse{avancement.adressesRestantes > 1 ? "s" : ""} ·{" "}
                <strong className="text-white">{avancement.colisRestants}</strong> colis restant{avancement.colisRestants > 1 ? "s" : ""}
                {avancement.finEstimee && (
                  <>
                    {" "}
                    · fin ≈ <strong className="text-teal">{heureFin(avancement.finEstimee)}</strong>
                  </>
                )}
              </p>
            )}
            {run.status === "in_progress" && (
              <button type="button" onClick={basculerPartage} className="mt-1 text-left text-[11px] text-white/60 underline-offset-2 hover:underline">
                {partage ? "📍 Position partagée avec l'exploitation pendant la tournée — masquer (pause)" : "📍 Position masquée — la partager à nouveau"}
              </button>
            )}
            {run.status !== "loading" && stops.length > 0 && (
              <div className="mt-3 grid grid-cols-2 rounded-full bg-white/10 p-1 text-sm font-semibold" role="tablist" aria-label="Affichage">
                {(["liste", "carte"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={vue === v}
                    onClick={() => changerVue(v)}
                    className={`rounded-full py-1.5 ${vue === v ? "bg-teal text-marine" : "text-white/80"}`}
                  >
                    {v === "liste" ? "Arrêts" : "Carte"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {toast && (
        <p role="status" className={`fixed inset-x-4 top-24 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-white"}`}>
          {toast.text}
        </p>
      )}

      {livraison && (
        <LivraisonSheet
          stop={livraison}
          onClose={() => setLivraison(null)}
          onLivre={(maj) => {
            setStops((all) => all.map((x) => (x.id === maj.id ? maj : x)));
            setLivraison(null);
          }}
        />
      )}

      {enCarte && run && (
        <section className="relative min-h-0 flex-1" aria-label="Carte de la tournée">
          <CarteTournee run={run} stops={stops} selection={arretCarte?.id ?? null} onSelection={choisirArret} onItineraire={setItineraire} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {itineraire && itineraire.distanceKm > 0 && (
              <p className="pointer-events-auto mx-auto mb-2 w-fit rounded-full bg-marine px-3 py-1 text-xs font-semibold text-white shadow-pop">
                Reste ≈ {itineraire.distanceKm} km
                {itineraire.dureeMin !== null && ` · ${itineraire.dureeMin >= 60 ? `${Math.floor(itineraire.dureeMin / 60)} h ${String(itineraire.dureeMin % 60).padStart(2, "0")}` : `${itineraire.dureeMin} min`} de route`}
                {itineraire.approx && " (estimation)"}
              </p>
            )}
            {arretCarte ? (
              <div className="pointer-events-auto mx-auto flex max-w-xl flex-col gap-3 rounded-2xl bg-surface p-4 shadow-pop">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-ink">
                    Arrêt {stops.indexOf(arretCarte) + 1} / {stops.length}
                    {arretCarte.parcel_count > 1 && ` · ${arretCarte.parcel_count} colis`}
                    {arretCarte.status === "delivered" ? " · livré" : arretCarte.status === "failed" ? " · absent" : arretCarte.id === prochain?.id ? " · prochain" : ""}
                  </p>
                  <p className="font-display text-lg font-bold leading-snug">{arretCarte.address}</p>
                  {arretCarte.recipient && <p className="text-sm text-navy/70">{arretCarte.recipient}</p>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <a href={waze(arretCarte)} className="btn-secondary justify-center !px-2 !py-2.5 text-sm" target="_blank" rel="noreferrer">
                    <IconNavigation className="h-4 w-4" /> Y aller
                  </a>
                  {arretCarte.phone ? (
                    <a href={lienTel(arretCarte.phone)} className="btn-secondary justify-center !px-2 !py-2.5 text-sm text-teal-ink">
                      <IconPhone className="h-4 w-4" /> Appeler
                    </a>
                  ) : (
                    <button type="button" className="btn-secondary justify-center !px-2 !py-2.5 text-sm" onClick={() => ajouterTelephone(arretCarte)}>
                      <IconPhone className="h-4 w-4" /> N°
                    </button>
                  )}
                  {arretCarte.status === "pending" ? (
                    <button type="button" className="btn-primary justify-center !px-2 !py-2.5 text-sm" onClick={() => setLivraison(arretCarte)}>
                      <IconCheck className="h-4 w-4" /> Livré
                    </button>
                  ) : (
                    <button type="button" className="btn-ghost justify-center !px-2 !py-2.5 text-sm" onClick={() => statut(arretCarte, "pending")}>
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="pointer-events-auto mx-auto w-fit rounded-xl bg-surface px-4 py-3 text-sm font-semibold shadow-pop">Tournée terminée 🎉</p>
            )}
          </div>
        </section>
      )}

      <main className={`mx-auto w-full max-w-xl flex-1 flex-col gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${enCarte ? "hidden" : "flex"}`}>
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
            {multi && <p className="-mb-2 text-xs font-semibold text-navy/60">{separateur(prochain)}</p>}
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
              <button type="button" className="btn-primary justify-center !py-4 text-lg" onClick={() => setLivraison(prochain)}>
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
              {suivants.map((s, k) => (
                <Fragment key={s.id}>
                  {multi && groupeDe(s) !== groupeDe(k ? suivants[k - 1]! : prochain!) && (
                    <li className="mt-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-navy/60" aria-label={`Liste ${separateur(s)}`}>
                      <span className="h-px flex-1 bg-navy/15" aria-hidden="true" />
                      {separateur(s)}
                      <span className="h-px flex-1 bg-navy/15" aria-hidden="true" />
                    </li>
                  )}
                  <li className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 shadow-card">
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
                </Fragment>
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
                    {s.proof_photo_path && (
                      <a href={`/api/colis/arrets/${s.id}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs" aria-label={`Photo de livraison — ${s.address}`}>
                        📷
                      </a>
                    )}
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
