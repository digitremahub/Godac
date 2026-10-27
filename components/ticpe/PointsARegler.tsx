"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
import { ACTIONS_LOT, LIBELLES_ACTION_LOT, actionPourPoint, type ActionLot } from "@/lib/ticpe/corrections";
import type { PointARegler } from "@/lib/ticpe/controles";

interface Retour {
  traites: number;
  refuses: { id: string; error: string; code?: string }[];
}

/**
 * Écran « TICPE : à régler » : les points bloquants et les avertissements de la
 * période. Ceux qui se corrigent plein par plein (justificatif manquant, zone
 * ou pays à confirmer, doublon probable) se cochent et se corrigent en lot
 * (app/api/ticpe/bloquants/lot) : une action pour N pleins, tracée plein par
 * plein au journal d'audit. Aucun litre ni montant n'est modifié ici.
 */
export function PointsARegler({ points }: { points: PointARegler[] }) {
  const router = useRouter();
  const groupes = useMemo(() => {
    const g: Record<ActionLot, PointARegler[]> = { justificatif: [], zone: [], doublon: [] };
    const autres: PointARegler[] = [];
    for (const p of points) {
      const action = actionPourPoint(p);
      if (action) g[action].push(p);
      else autres.push(p);
    }
    return { groupes: g, autres };
  }, [points]);

  return (
    <div className="flex flex-col gap-4">
      {ACTIONS_LOT.filter((a) => groupes.groupes[a].length > 0).map((action) => (
        <GroupeEnLot key={action} action={action} points={groupes.groupes[action]} onFait={() => router.refresh()} />
      ))}
      {groupes.autres.length > 0 && (
        <Card className="overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold text-navy">À corriger ailleurs</h2>
          <ul className="flex flex-col divide-y divide-navy/5">
            {groupes.autres.map((pt) => (
              <li key={pt.cle}>
                <Link href={pt.lien} className="flex min-h-[44px] flex-wrap items-start gap-3 py-2.5 hover:bg-navy/[0.02]">
                  <span className={pt.gravite === "bloquant" ? "badge-orange" : "badge-gold"}>{pt.gravite === "bloquant" ? "Bloquant" : "Avertissement"}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium text-navy">{pt.titre}</span>
                    <span className="block text-navy/70">{pt.detail}</span>
                  </span>
                  <span className="text-xs text-teal-ink">Corriger →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function GroupeEnLot({ action, points, onFait }: { action: ActionLot; points: PointARegler[]; onFait: () => void }) {
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [type, setType] = useState<"releve_carte" | "facture">("releve_carte");
  const [ref, setRef] = useState("");
  const [zone, setZone] = useState<"" | "metropole" | "corse">("metropole");
  const [pays, setPays] = useState("FR");
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);
  const [retour, setRetour] = useState<Retour | null>(null);

  const bloquants = points.filter((p) => p.gravite === "bloquant").length;
  const tousCoches = choisis.size === points.length;
  const basculer = (id: string) =>
    setChoisis((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function appliquer(ids: string[], confirmerPeriode = false) {
    setBusy(true);
    setRefus(null);
    const corps =
      action === "justificatif"
        ? { action, ids, type, ref: ref.trim() || null }
        : action === "zone"
          ? { action, ids, ticpe_zone: zone || null, pays_achat: pays.trim() ? pays.trim().toUpperCase() : null, confirmer_periode_declaree: confirmerPeriode }
          : { action, ids, confirmer_periode_declaree: confirmerPeriode };
    const r = await fetchGodac<Retour>("/api/ticpe/bloquants/lot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setRetour(r.data);
    setChoisis(new Set(r.data.refuses.map((x) => x.id)));
    onFait();
  }

  async function lancer() {
    const ids = [...choisis];
    if (ids.length === 0) return;
    const ok = await confirmer({
      titre: LIBELLES_ACTION_LOT[action],
      message:
        action === "doublon"
          ? `Confirmer que ${ids.length} plein(s) sont bien distincts de ceux qui leur ressemblent ? Vérifiez d'abord chaque ticket ou relevé : tous seront comptés.`
          : action === "zone"
            ? `Indiquer ${zone === "corse" ? "la Corse" : zone === "metropole" ? "la métropole hors Corse" : "aucune zone précise"}, pays ${pays.trim().toUpperCase() || "non précisé"}, sur ${ids.length} plein(s) ?`
            : `Déclarer ${type === "facture" ? "une facture" : "un relevé de carte"} conservé(e) par l'entreprise sur ${ids.length} plein(s) ?`,
      action: "Appliquer",
    });
    if (ok) await appliquer(ids);
  }

  const periodeDeclaree = retour?.refuses.filter((x) => x.code === "PERIODE_DECLAREE") ?? [];
  const autresRefus = retour?.refuses.filter((x) => x.code !== "PERIODE_DECLAREE") ?? [];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy">
          {LIBELLES_ACTION_LOT[action]} <span className="font-normal text-navy/60">· {points.length} plein(s){bloquants > 0 ? `, dont ${bloquants} bloquant(s)` : ""}</span>
        </h2>
        <button type="button" className="btn-ghost min-h-[44px] text-sm" onClick={() => setChoisis(tousCoches ? new Set() : new Set(points.map((p) => p.objet.id!)))}>
          {tousCoches ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
      </div>

      <ul className="flex flex-col divide-y divide-navy/5">
        {points.map((pt) => {
          const id = pt.objet.id!;
          return (
            <li key={pt.cle} className="flex items-start gap-3">
              <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
                <input type="checkbox" className="h-5 w-5" checked={choisis.has(id)} onChange={() => basculer(id)} aria-label={`Sélectionner : ${pt.detail}`} />
              </label>
              <Link href={pt.lien} className="flex min-w-0 flex-1 flex-wrap items-start gap-3 py-2.5 hover:bg-navy/[0.02]">
                <span className={pt.gravite === "bloquant" ? "badge-orange" : "badge-gold"}>{pt.gravite === "bloquant" ? "Bloquant" : "Avertissement"}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block text-navy/80">{pt.detail}</span>
                </span>
                <span className="text-xs text-teal-ink">Ouvrir →</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-navy/10 bg-surface p-3">
        {action === "justificatif" && (
          <>
            <label className="block">
              <span className="label">Justificatif conservé</span>
              <select className="input min-h-[44px]" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="releve_carte">Relevé de carte carburant</option>
                <option value="facture">Facture carburant</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Référence (facultatif)</span>
              <input className="input min-h-[44px]" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          </>
        )}
        {action === "zone" && (
          <>
            <label className="block">
              <span className="label">Zone</span>
              <select className="input min-h-[44px]" value={zone} onChange={(e) => setZone(e.target.value as typeof zone)}>
                <option value="metropole">Métropole hors Corse</option>
                <option value="corse">Corse</option>
                <option value="">Non précisée</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Pays d&apos;achat (2 lettres)</span>
              <input className="input min-h-[44px] w-28" maxLength={2} value={pays} onChange={(e) => setPays(e.target.value.toUpperCase())} />
            </label>
          </>
        )}
        {action === "doublon" && <p className="max-w-md text-xs text-navy/70">Après vérification des tickets ou relevés : les pleins cochés sont confirmés distincts et comptés dans le montant.</p>}
        <button type="button" className="btn-primary min-h-[44px]" disabled={busy || choisis.size === 0} onClick={lancer}>
          {busy ? "Enregistrement…" : `Appliquer à ${choisis.size} plein(s)`}
        </button>
      </div>

      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      {retour && (
        <div role="status" className="text-sm text-navy/80">
          <p>
            {retour.traites} plein(s) corrigé(s){retour.refuses.length > 0 ? `, ${retour.refuses.length} refusé(s)` : ""}. Chaque correction est tracée au journal d&apos;audit.
          </p>
          {periodeDeclaree.length > 0 && (
            <p className="mt-1 text-orange-ink">
              {periodeDeclaree.length} plein(s) appartiennent à une période déjà déclarée : la correction change le montant calculé et devra être régularisée.{" "}
              <button type="button" className="underline" disabled={busy} onClick={() => appliquer(periodeDeclaree.map((x) => x.id), true)}>
                Corriger quand même
              </button>
            </p>
          )}
          {autresRefus.length > 0 && <p className="mt-1 text-orange-ink">{autresRefus[0]!.error}</p>}
        </div>
      )}
    </Card>
  );
}
