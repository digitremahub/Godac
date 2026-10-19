"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";

export interface LigneModuleAffichee {
  key: string;
  name: string;
  description: string;
  /** Inclus dans la formule : toujours actif, non désactivable ici. */
  inclus: boolean;
  actif: boolean;
  prixMensuel: number;
  prixMiseEnService: number;
}

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

/**
 * Onglet Modules de l'abonnement : activation des modules à la carte par
 * la direction, via PATCH /api/admin/modules (prix toujours tirés de la
 * grille côté serveur). Pendant l'essai, l'activation est immédiate ;
 * une fois l'abonnement souscrit, l'ajout d'un module payant est refusé
 * (402) et passe par GODAC. Les modules sans fonctionnalité (Q7) ne sont
 * jamais listés.
 */
export function ModulesPanel({ modules, enEssai, formule }: { modules: LigneModuleAffichee[]; enEssai: boolean; formule: string }) {
  const router = useRouter();
  const initial = useMemo(() => new Set(modules.filter((m) => m.actif && !m.inclus).map((m) => m.key)), [modules]);
  const [selection, setSelection] = useState<Set<string>>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Arrivée depuis « Activer ce module » (#module-<clé>) : mise en évidence.
  const [cible, setCible] = useState<string | null>(null);
  useEffect(() => {
    const h = window.location.hash.replace(/^#module-/, "");
    if (h) {
      setCible(h);
      document.getElementById(`module-${h}`)?.scrollIntoView({ block: "center" });
    }
  }, []);

  const modifie = selection.size !== initial.size || [...selection].some((k) => !initial.has(k));
  const ajoutsPayants = modules.filter((m) => !m.inclus && selection.has(m.key) && !initial.has(m.key));

  function basculer(key: string) {
    setMessage(null);
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  async function enregistrer() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedModuleKeys: [...selection] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setMessage({ ok: true, text: "Modules mis à jour." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Erreur inattendue" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-navy/65">
        {enEssai
          ? `Période d'essai : les modules s'activent immédiatement et seront facturés à la souscription (formule ${formule}).`
          : "Abonnement en cours : vous pouvez retirer un module ou activer un module gratuit. Pour ajouter un module payant, contactez GODAC : il sera ajouté à votre abonnement."}
      </p>
      <Card className="!p-0">
        <ul className="divide-y divide-navy/[0.07]">
          {modules.map((m) => {
            const actif = m.inclus || selection.has(m.key);
            return (
              <li
                key={m.key}
                id={`module-${m.key}`}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 ${cible === m.key ? "bg-teal/10" : ""}`}
              >
                <div className="min-w-0 max-w-xl">
                  <p className="font-semibold">{m.name}</p>
                  {m.description && <p className="text-sm text-navy/60">{m.description}</p>}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {m.inclus ? (
                    <span className="rounded-full bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal-ink">Inclus</span>
                  ) : (
                    <span className="tabular-nums text-navy/70">
                      {eur(m.prixMensuel)} / mois{m.prixMiseEnService > 0 ? ` + ${eur(m.prixMiseEnService)} de mise en service` : ""}
                    </span>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={actif}
                      disabled={m.inclus || busy}
                      onChange={() => basculer(m.key)}
                      aria-label={`${actif ? "Désactiver" : "Activer"} ${m.name}`}
                    />
                    <span className={actif ? "font-semibold text-teal-ink" : "text-navy/55"}>{actif ? "Actif" : "Inactif"}</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary !py-2" disabled={!modifie || busy} onClick={enregistrer}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {ajoutsPayants.length > 0 && !enEssai && (
          <span className="text-sm text-orange-ink">Ajout payant : la demande sera refusée hors période d&apos;essai, contactez GODAC.</span>
        )}
        {message && (
          <span role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
