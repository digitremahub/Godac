"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { IconCamera, IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconQrCode, IconX } from "@/components/layout/icons";
import { ParcelScanner } from "@/components/colis/ParcelScanner";
import { analyserCode } from "@/lib/colis/etiquette";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { lienSms, lienTel } from "@/lib/colis/telephone";
import { libelleLieu } from "@/lib/colis/livraison";
import { scannerNatif, scannerNatifDisponible } from "@/lib/colis/natif";
import { LivraisonSheet } from "@/components/colis/LivraisonSheet";
import { api, gmaps, imageEnBase64, waze, SMS_ARRIVEE, type Run, type RunResume, type Stop } from "@/components/colis/commun";
import { ImportTournee } from "@/components/colis/ImportTournee";
import { ExportTournee } from "@/components/colis/ExportTournee";

interface Draft {
  adresse: string;
  destinataire: string;
  telephone: string;
  code: string | null;
}

function AdresseInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  function change(v: string) {
    onChange(v);
    clearTimeout(timer.current);
    if (v.trim().length < 4) return setSuggestions([]);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(v)}&limit=5&autocomplete=1`);
        const data = (await res.json()) as { features?: { properties?: { label?: string } }[] };
        setSuggestions((data.features ?? []).map((f) => f.properties?.label ?? "").filter(Boolean));
      } catch {
        setSuggestions([]);
      }
    }, 250);
  }
  return (
    <div className="relative">
      <input className="input" value={value} onChange={(e) => change(e.target.value)} placeholder="N°, rue, code postal, ville" autoFocus={autoFocus} aria-label="Adresse de livraison" autoComplete="off" />
      {suggestions.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-navy/10 bg-surface shadow-pop">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" className="block w-full px-3 py-2.5 text-left text-sm hover:bg-navy/[0.05]" onClick={() => (onChange(s), setSuggestions([]))}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TourneeColis({ lectureEtiquette }: { lectureEtiquette: boolean }) {
  const [runs, setRuns] = useState<RunResume[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [scanner, setScanner] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edition, setEdition] = useState<{ id: string; adresse: string; destinataire: string; telephone: string; colis: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [livraison, setLivraison] = useState<Stop | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const chargerTournee = useCallback(async (id: string) => {
    try {
      const data = await api<{ run: Run; stops: Stop[] }>(`/api/colis/tournees/${id}`);
      setRun(data.run);
      setStops(data.stops);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }, []);

  const recharger = useCallback(
    async (prefere?: string | null) => {
      try {
        const { tournees } = await api<{ tournees: RunResume[] }>("/api/colis/tournees");
        setRuns(tournees);
        let memo: string | null = null;
        try {
          memo = localStorage.getItem("godac-tournee-colis");
        } catch {
          /* stockage indisponible */
        }
        const choix =
          [prefere, activeId, memo].find((id) => id && tournees.some((t) => t.id === id)) ??
          tournees.find((t) => t.status !== "done")?.id ??
          tournees[tournees.length - 1]?.id ??
          null;
        setActiveId(choix);
        if (choix) await chargerTournee(choix);
        else setRun(null);
      } catch (e) {
        setToast({ ok: false, text: networkErrorMessage(e) });
      }
    },
    [activeId, chargerTournee],
  );

  function choisir(id: string) {
    setActiveId(id);
    try {
      localStorage.setItem("godac-tournee-colis", id);
    } catch {
      /* stockage indisponible */
    }
    chargerTournee(id);
  }

  async function nouvelleTournee() {
    setBusy("nouvelle");
    try {
      const { run: cree } = await api<{ run: Run }>("/api/colis/tournees", { method: "POST", body: JSON.stringify({}) });
      try {
        localStorage.setItem("godac-tournee-colis", cree.id);
      } catch {
        /* stockage indisponible */
      }
      await recharger(cree.id);
      setToast({ ok: true, text: `${cree.name ?? "Tournée"} créée : scannez vos colis.` });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function supprimerTournee() {
    if (!run) return;
    if (!confirm(`Supprimer « ${run.name ?? "cette tournée"} » et ses ${stops.length} arrêt(s) ? C'est définitif.`)) return;
    setBusy("suppr");
    try {
      await api(`/api/colis/tournees/${run.id}`, { method: "DELETE" });
      setRun(null);
      setStops([]);
      await recharger(null);
      setToast({ ok: true, text: "Tournée supprimée." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function renommer() {
    if (!run) return;
    const nom = prompt("Nom de la tournée", run.name ?? "")?.trim();
    if (!nom || nom === run.name) return;
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ name: nom.slice(0, 60) }) }).catch((e) => setToast({ ok: false, text: networkErrorMessage(e) }));
    await recharger(run.id);
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function ajouter(d: Draft) {
    setBusy("ajout");
    try {
      const r = await api<{ duplicate?: boolean; grouped?: boolean; geocoded?: boolean; message?: string }>("/api/colis/arrets", {
        method: "POST",
        body: JSON.stringify({ run_id: run?.id, code: d.code, adresse: d.adresse, destinataire: d.destinataire || null, telephone: d.telephone.trim() || null }),
      });
      setToast(
        r.duplicate
          ? { ok: false, text: "Colis déjà scanné." }
          : r.grouped
            ? { ok: true, text: "Ajouté à un arrêt existant (même adresse)." }
            : r.geocoded === false
              ? { ok: false, text: "Ajouté, mais adresse introuvable sur la carte : vérifiez-la." }
              : { ok: true, text: run?.status === "in_progress" ? "Adresse ajoutée en fin de tournée : réoptimisez pour l'insérer au bon endroit." : "Colis ajouté." },
      );
      setDraft(null);
      await recharger(run?.id);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  /** Renvoie true si le colis a été ajouté directement (le scan peut continuer). */
  function onCode(text: string): boolean {
    const lu = analyserCode(text);
    if (lu.adresse) {
      // Adresse dans le code : ajout direct, sans quitter le scanner.
      ajouter({ adresse: lu.adresse, destinataire: lu.destinataire ?? "", telephone: lu.telephone ?? "", code: lu.code });
      return true;
    } else {
      setScanner(false);
      setDraft({ adresse: "", destinataire: "", telephone: lu.telephone ?? "", code: lu.code });
      setToast({ ok: true, text: "Colis lu : ajoutez l'adresse (photo de l'étiquette ou saisie)." });
      return false;
    }
  }

  /** Application des stores : scanner natif Google, rouvert après chaque colis ajouté. Sinon scanner web. */
  async function ouvrirScanner() {
    if (!scannerNatifDisponible()) return setScanner(true);
    try {
      for (;;) {
        const code = await scannerNatif();
        if (!code || !onCode(code)) break;
      }
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  async function photo(file: File) {
    setBusy("photo");
    try {
      const image = await imageEnBase64(file);
      const lu = await api<{ adresse: string | null; destinataire: string | null; telephone: string | null; code: string | null }>("/api/colis/etiquette", {
        method: "POST",
        body: JSON.stringify({ image, mediaType: "image/jpeg" }),
      });
      setDraft((d) => ({
        adresse: lu.adresse ?? d?.adresse ?? "",
        destinataire: lu.destinataire ?? d?.destinataire ?? "",
        telephone: lu.telephone ?? d?.telephone ?? "",
        code: d?.code ?? lu.code,
      }));
      if (!lu.adresse) setToast({ ok: false, text: "Adresse illisible : saisissez-la." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function optimiser(depuisMaPosition = false) {
    setBusy("optim");
    try {
      let depuis: { lat: number; lng: number } | null = null;
      if (depuisMaPosition) {
        depuis = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => reject(new Error("Position indisponible.")), {
            enableHighAccuracy: true,
            timeout: 10000,
          }),
        );
      }
      const r = await api<{ kmAvant: number; kmApres: number; sansGps: number }>("/api/colis/optimiser", { method: "POST", body: JSON.stringify({ run_id: run?.id, depuis }) });
      const gain = r.kmAvant - r.kmApres;
      await recharger(run?.id);
      setToast({ ok: true, text: `Ordre optimisé : ≈ ${r.kmApres} km${gain > 0.5 ? ` (−${Math.round(gain)} km)` : ""}${r.sansGps ? ` · ${r.sansGps} adresse(s) à vérifier en fin de liste` : ""}.` });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function statut(s: Stop, status: Stop["status"]) {
    setStops((all) => all.map((x) => (x.id === s.id ? { ...x, status } : x)));
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      await recharger(run?.id);
    }
  }

  async function supprimer(s: Stop) {
    if (!confirm(`Retirer « ${s.address} » de la tournée ?`)) return;
    setStops((all) => all.filter((x) => x.id !== s.id));
    await api(`/api/colis/arrets/${s.id}`, { method: "DELETE" }).catch(() => recharger(run?.id));
  }

  async function enregistrerEdition() {
    if (!edition) return;
    const avant = stops.find((x) => x.id === edition.id);
    setBusy("edition");
    try {
      await api(`/api/colis/arrets/${edition.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(avant && edition.adresse.trim() !== avant.address ? { adresse: edition.adresse.trim() } : {}),
          destinataire: edition.destinataire.trim() || null,
          telephone: edition.telephone.trim() || null,
          parcel_count: Math.max(1, edition.colis),
        }),
      });
      setEdition(null);
      await recharger(run?.id);
      setToast({ ok: true, text: avant && edition.adresse.trim() !== avant.address ? "Adresse modifiée : pensez à réoptimiser l'ordre." : "Arrêt mis à jour." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function deplacer(st: Stop, sens: "haut" | "bas") {
    try {
      await api(`/api/colis/arrets/${st.id}`, { method: "PATCH", body: JSON.stringify({ deplacer: sens }) });
      await recharger(run?.id);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  async function phase(status: Run["status"]) {
    if (!run) return;
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await recharger(run.id);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const selecteur = runs && (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Mes tournées colis">
      {runs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === activeId}
          onClick={() => choisir(t.id)}
          className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
            t.id === activeId ? "border-teal bg-teal/10 font-semibold" : "border-navy/10 bg-surface hover:border-navy/25"
          }`}
        >
          <span className="block leading-tight">
            {t.name ?? "Tournée"}
            {t.run_date !== today && <span className="ml-1 text-xs font-normal text-navy/55">({new Date(`${t.run_date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })})</span>}
          </span>
          <span className="block text-xs font-normal text-navy/60">
            {t.status === "done" ? "Clôturée" : t.status === "in_progress" ? `En livraison · ${t.nbRestants} restant(s)` : `${t.nbColis} colis`}
          </span>
        </button>
      ))}
      <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy !== null} onClick={nouvelleTournee}>
        + Nouvelle tournée
      </button>
    </div>
  );

  if (!runs) return <p className="text-sm text-navy/60">Chargement des tournées…</p>;
  if (!run) {
    return (
      <div className="flex flex-col gap-4">
        {toast && (
          <p role="status" className={`fixed inset-x-4 top-4 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-white"}`}>
            {toast.text}
          </p>
        )}
        <Card className="flex flex-col items-start gap-3">
          <h2 className="text-lg">Aucune tournée colis en cours</h2>
          <p className="text-sm text-navy/65">Créez une tournée, scannez vos colis, puis laissez GODAC calculer l&apos;ordre de passage. Vous pouvez en faire plusieurs par jour.</p>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={nouvelleTournee}>
            Créer une tournée
          </button>
        </Card>
      </div>
    );
  }

  const pending = stops.filter((s) => s.status === "pending");
  const colis = stops.reduce((n, s) => n + s.parcel_count, 0);
  const prochain = pending[0];
  const livres = stops.filter((s) => s.status === "delivered").length;
  const enLivraison = run.status === "in_progress";

  return (
    <div className="flex flex-col gap-4 pb-24">
      {toast && (
        <p role="status" className={`fixed inset-x-4 top-4 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-white"}`}>
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
      {scanner && <ParcelScanner onCode={onCode} onClose={() => setScanner(false)} />}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && photo(e.target.files[0])} />

      {selecteur}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">
          {run.name ?? "Tournée"}
          {run.status === "done" && <span className="ml-2 rounded-full bg-navy/[0.06] px-2 py-0.5 text-xs font-semibold text-navy/65">Clôturée</span>}
        </h2>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-sm" onClick={renommer}>
            Renommer
          </button>
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-sm text-orange-ink" disabled={busy !== null} onClick={supprimerTournee}>
            Supprimer la tournée
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Arrêts", stops.length],
          ["Colis", colis],
          ["Livrés", `${livres}/${stops.length}`],
        ].map(([l, v]) => (
          <Card key={l as string} className="!px-3 !py-2.5 text-center">
            <p className="text-xs text-navy/60">{l}</p>
            <p className="font-display text-xl font-bold tabular-nums">{v}</p>
          </Card>
        ))}
      </div>

      {enLivraison && prochain ? (
        <Card className="flex flex-col gap-3 border-2 border-teal/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-ink">
            Arrêt {stops.indexOf(prochain) + 1} / {stops.length}
            {prochain.parcel_count > 1 && ` · ${prochain.parcel_count} colis`}
          </p>
          <div>
            <p className="font-display text-xl font-bold leading-snug">{prochain.address}</p>
            {prochain.recipient && <p className="text-sm text-navy/70">{prochain.recipient}</p>}
            {prochain.notes && <p className="mt-1 text-sm text-navy/70">{prochain.notes}</p>}
          </div>
          {prochain.phone && (
            <div className="grid grid-cols-2 gap-2">
              <a href={lienTel(prochain.phone)} className="btn-secondary justify-center border-teal/70 !py-3 text-teal-ink">
                <IconPhone className="h-4 w-4" /> Appeler
              </a>
              <a href={lienSms(prochain.phone, SMS_ARRIVEE)} className="btn-secondary justify-center !py-3">
                <IconMessage className="h-4 w-4" /> Prévenir (SMS)
              </a>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a href={waze(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
              <IconNavigation className="h-4 w-4" /> Waze
            </a>
            <a href={gmaps(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
              <IconMapPin className="h-4 w-4" /> Google Maps
            </a>
            <button type="button" className="btn-primary justify-center !py-3 text-base" onClick={() => setLivraison(prochain)}>
              <IconCheck className="h-5 w-5" /> Livré
            </button>
            <button type="button" className="btn-secondary justify-center !py-3 text-orange-ink" onClick={() => statut(prochain, "failed")}>
              <IconX className="h-5 w-5" /> Échec / absent
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/livreur" className="btn-secondary !py-1.5 text-sm">
              Mode chauffeur plein écran
            </Link>
            <button type="button" className="btn-ghost w-fit !py-1.5 text-sm" disabled={busy !== null} onClick={() => optimiser(true)}>
              Réoptimiser depuis ma position
            </button>
          </div>
        </Card>
      ) : enLivraison ? (
        <Card className="text-center">
          <p className="font-display text-lg font-bold">Tournée terminée 🎉</p>
          <p className="mt-1 text-sm text-navy/65">{livres} arrêt(s) livré(s) sur {stops.length}.</p>
          <button type="button" className="btn-primary mt-3" onClick={() => phase("done")}>
            Clôturer la tournée
          </button>
        </Card>
      ) : run.status === "done" ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-sm text-navy/70">
            Tournée clôturée : {livres} arrêt(s) livré(s) sur {stops.length}.
          </p>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={nouvelleTournee}>
            + Nouvelle tournée
          </button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Charger les colis</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button type="button" className="btn-primary justify-center !py-3" onClick={ouvrirScanner}>
              <IconQrCode className="h-5 w-5" /> Scanner les colis
            </button>
            {lectureEtiquette && (
              <button type="button" className="btn-secondary justify-center !py-3" disabled={busy === "photo"} onClick={() => fileRef.current?.click()}>
                <IconCamera className="h-5 w-5" /> {busy === "photo" ? "Lecture…" : "Photo d'étiquette"}
              </button>
            )}
            <button type="button" className="btn-secondary justify-center !py-3" onClick={() => setDraft({ adresse: "", destinataire: "", telephone: "", code: null })}>
              + Saisir une adresse
            </button>
          </div>
          {run.start_label ? (
            <p className="text-xs text-navy/60">Départ : {run.start_label}{run.return_to_start ? " (retour au dépôt)" : ""}</p>
          ) : (
            <p className="text-xs text-navy/60">Pas d&apos;adresse de dépôt : l&apos;ordre partira du premier arrêt. Renseignez le dépôt dans Organisation → Services.</p>
          )}
          <ImportTournee
            runId={run.id}
            onImporte={async (texte, ok) => {
              setToast({ ok, text: texte });
              await recharger(run.id);
            }}
          />
        </Card>
      )}

      {enLivraison && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => setDraft({ adresse: "", destinataire: "", telephone: "", code: null })}>
            + Ajouter une adresse
          </button>
          <button type="button" className="btn-secondary !py-2 text-sm" onClick={ouvrirScanner}>
            <IconQrCode className="h-4 w-4" /> Scanner un colis
          </button>
        </div>
      )}

      {draft && (
        <Card className="flex flex-col gap-3 border-2 border-teal/40">
          <div className="flex items-center justify-between">
            <h2 className="text-lg">Nouveau colis</h2>
            <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setDraft(null)} aria-label="Annuler">
              <IconX className="h-5 w-5" />
            </button>
          </div>
          {draft.code && <p className="text-xs text-navy/60">Colis n° {draft.code}</p>}
          <AdresseInput value={draft.adresse} onChange={(adresse) => setDraft({ ...draft, adresse })} autoFocus={!lectureEtiquette} />
          <input className="input" value={draft.destinataire} onChange={(e) => setDraft({ ...draft, destinataire: e.target.value })} placeholder="Destinataire (facultatif)" aria-label="Destinataire" />
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={draft.telephone}
            onChange={(e) => setDraft({ ...draft, telephone: e.target.value })}
            placeholder="Téléphone du client (facultatif)"
            aria-label="Téléphone du client"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy !== null || draft.adresse.trim().length < 5} onClick={() => ajouter(draft)}>
              Ajouter à la tournée
            </button>
            {lectureEtiquette && (
              <button type="button" className="btn-secondary" disabled={busy === "photo"} onClick={() => fileRef.current?.click()}>
                <IconCamera className="h-4 w-4" /> {busy === "photo" ? "Lecture…" : "Lire l'étiquette"}
              </button>
            )}
          </div>
        </Card>
      )}

      {stops.length > 0 && (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
            <h2 className="text-lg">{run.optimized_at ? "Ordre de passage" : "Colis chargés"}</h2>
            {run.status !== "done" && pending.length > 1 && (
              <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={busy !== null} onClick={() => optimiser(enLivraison)}>
                {busy === "optim" ? "Calcul…" : run.optimized_at ? "Réoptimiser" : "Optimiser l'ordre"}
              </button>
            )}
          </div>
          <ol className="mt-2 divide-y divide-navy/[0.07]">
            {stops.map((s, i) => (
              <li key={s.id} className={`px-4 py-2.5 sm:px-5 ${s.status !== "pending" ? "opacity-55" : ""}`}>
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                      s.status === "delivered" ? "bg-teal text-marine" : s.status === "failed" ? "bg-orange text-white" : "bg-marine text-teal"
                    }`}
                  >
                    {s.status === "delivered" ? "✓" : s.status === "failed" ? "!" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{s.address}</p>
                    <p className="text-xs text-navy/60">
                      {[s.recipient, s.phone, s.parcel_count > 1 && `${s.parcel_count} colis`, s.status === "delivered" && libelleLieu(s.delivered_place), s.lat === null && "⚠ adresse non localisée"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {s.phone && s.status === "pending" && (
                    <a href={lienTel(s.phone)} className="btn-ghost !px-2 !py-1 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address} (${s.phone})`}>
                      <IconPhone className="h-4 w-4" />
                    </a>
                  )}
                  {s.proof_photo_path && (
                    <a href={`/api/colis/arrets/${s.id}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs" aria-label={`Photo de livraison — ${s.address}`}>
                      📷 Photo
                    </a>
                  )}
                  {s.status !== "pending" && (
                    <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => statut(s, "pending")}>
                      Annuler
                    </button>
                  )}
                </div>
                {s.status === "pending" && run.status !== "done" && edition?.id !== s.id && (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-9 text-xs">
                    <button type="button" className="btn-ghost !px-2 !py-1" aria-label={`Monter ${s.address}`} onClick={() => deplacer(s, "haut")}>
                      ↑
                    </button>
                    <button type="button" className="btn-ghost !px-2 !py-1" aria-label={`Descendre ${s.address}`} onClick={() => deplacer(s, "bas")}>
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-2 !py-1"
                      onClick={() => setEdition({ id: s.id, adresse: s.address, destinataire: s.recipient ?? "", telephone: s.phone ?? "", colis: s.parcel_count })}
                    >
                      Modifier
                    </button>
                    <button type="button" className="btn-ghost !px-2 !py-1 text-orange-ink" onClick={() => supprimer(s)} aria-label={`Retirer ${s.address}`}>
                      Retirer
                    </button>
                  </div>
                )}
                {edition?.id === s.id && (
                  <div className="mt-2 flex flex-col gap-2 rounded-xl border border-teal/40 p-3">
                    <AdresseInput value={edition.adresse} onChange={(adresse) => setEdition({ ...edition, adresse })} autoFocus />
                    <input
                      className="input"
                      value={edition.destinataire}
                      onChange={(e) => setEdition({ ...edition, destinataire: e.target.value })}
                      placeholder="Destinataire (facultatif)"
                      aria-label="Destinataire"
                    />
                    <input
                      className="input"
                      type="tel"
                      inputMode="tel"
                      value={edition.telephone}
                      onChange={(e) => setEdition({ ...edition, telephone: e.target.value })}
                      placeholder="Téléphone du client (facultatif)"
                      aria-label="Téléphone du client"
                    />
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-navy/65">Colis à cette adresse</span>
                      <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => setEdition({ ...edition, colis: Math.max(1, edition.colis - 1) })} aria-label="Un colis de moins">
                        −
                      </button>
                      <span className="w-6 text-center font-semibold tabular-nums">{edition.colis}</span>
                      <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => setEdition({ ...edition, colis: edition.colis + 1 })} aria-label="Un colis de plus">
                        +
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-primary !py-2 text-sm" disabled={busy !== null || edition.adresse.trim().length < 5} onClick={enregistrerEdition}>
                        Enregistrer
                      </button>
                      <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => setEdition(null)}>
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {pending.length > 0 && <ExportTournee run={run} stops={pending} />}

      {!enLivraison && run.status !== "done" && pending.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-paper via-paper to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:bg-none lg:p-0">
          <button
            type="button"
            className="btn-primary w-full !py-3.5 text-base"
            disabled={busy !== null}
            onClick={async () => {
              if (!run.optimized_at) await optimiser(false);
              await phase("in_progress");
              router.push("/livreur");
            }}
          >
            Démarrer la livraison ({pending.length} arrêt{pending.length > 1 ? "s" : ""})
          </button>
        </div>
      )}
    </div>
  );
}
