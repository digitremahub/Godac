"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BandeauSemaine } from "@/lib/planning/bandeau-semaine";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { confirmer } from "@/lib/ui/confirmation";
import { textePublication } from "@/lib/planning/publication";

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Bandeau de la vue Semaine : planning de la semaine suivante généré
 * automatiquement le jeudi, à confirmer avant le vendredi 17 h (un par service).
 * - « Confirmer et envoyer aux chauffeurs » publie tout de suite et prévient chaque
 *   chauffeur concerné (POST /api/planning/semaine-suivante/confirmer) ; s'il reste
 *   des cases à remplacer, il faut choisir « Envoyer quand même » ;
 * - « Régénérer les cases vides » complète sans rien écraser ;
 * - l'édition habituelle (affecter, remplacer, fermer, glisser-déposer) reste possible :
 *   la semaine est alors notée « modifiée » et ne part pas toute seule le vendredi.
 * Les absents sont nommés sans motif (« en congé du … au … », « absent »).
 */
export function BandeauSemaineAuto({ bandeaux }: { bandeaux: BandeauSemaine[] }) {
  const router = useRouter();
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<{ texte: string; ton: "ok" | "erreur" } | null>(null);

  async function appeler(url: string, corps: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, json };
  }

  async function confirmerEtEnvoyer(b: BandeauSemaine) {
    const restantes = b.compteurs.aRemplacer;
    const ok = await confirmer(
      restantes > 0
        ? { titre: "Envoyer quand même ?", message: `${pluriel(restantes, "case reste", "cases restent")} à remplacer : ces tournées partiront sans chauffeur. Chaque chauffeur concerné reçoit une notification avec ses tournées.`, action: "Envoyer quand même" }
        : { titre: "Envoyer le planning aux chauffeurs ?", message: "Chaque chauffeur concerné reçoit UNE notification avec ses tournées de la semaine.", action: "Confirmer et envoyer" },
    );
    if (!ok) return;
    setOccupe(b.serviceId);
    setMessage(null);
    try {
      const { res, json } = await appeler("/api/planning/semaine-suivante/confirmer", { service_id: b.serviceId, semaine_debut: b.lundi, envoyer_quand_meme: restantes > 0 });
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Envoi impossible");
      setMessage({ texte: textePublication(Number(json.sent ?? 0)), ton: "ok" });
      router.refresh();
    } catch (e) {
      setMessage({ texte: `Envoi impossible : ${networkErrorMessage(e)}`, ton: "erreur" });
    } finally {
      setOccupe(null);
    }
  }

  async function regenerer(b: BandeauSemaine) {
    if (!(await confirmer({ titre: "Régénérer les cases vides ?", message: "Les cases encore vides sont remplies d'après la semaine précédente et les modèles. Rien de ce qui existe n'est modifié. La semaine ne sera plus envoyée toute seule vendredi : vous la confirmerez.", action: "Régénérer" }))) return;
    setOccupe(b.serviceId);
    setMessage(null);
    try {
      const { res, json } = await appeler("/api/planning/semaine-suivante/regenerer", { service_id: b.serviceId, semaine_debut: b.lundi });
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Génération impossible");
      const n = Number(json.cases_creees ?? 0);
      setMessage({ texte: n ? `${pluriel(n, "case créée", "cases créées")}.` : "Aucune case vide à remplir.", ton: "ok" });
      router.refresh();
    } catch (e) {
      setMessage({ texte: `Génération impossible : ${networkErrorMessage(e)}`, ton: "erreur" });
    } finally {
      setOccupe(null);
    }
  }

  // Le message de confirmation reste affiché après l'envoi, quand le bandeau a disparu.
  if (!bandeaux.length && !message) return null;
  return (
    <div className="mb-4 flex flex-col gap-3">
      {bandeaux.map((b) => (
        <section key={b.serviceId} aria-label={`Planning à confirmer : ${b.service}`} className="rounded-2xl border border-teal/30 bg-teal/[0.06] p-4">
          <h2 className="text-base">{b.titre}</h2>
          <p className="mt-0.5 text-sm text-navy/65">
            Service {b.service} · {b.compteurs.tournees} tournée{b.compteurs.tournees > 1 ? "s" : ""}, {pluriel(b.compteurs.chauffeurs, "chauffeur affecté", "chauffeurs affectés")},{" "}
            {pluriel(b.compteurs.aRemplacer, "case à remplacer", "cases à remplacer")}, {pluriel(b.compteurs.fermees, "tournée fermée", "tournées fermées")}, {pluriel(b.compteurs.conflits, "conflit", "conflits")}.
          </p>
          <p className="mt-1 text-sm text-navy/65">
            {b.etat === "modifiee"
              ? "Modifié depuis la génération : il ne partira pas tout seul. Confirmez-le pour l'envoyer aux chauffeurs."
              : "Les chauffeurs ne voient rien pour l'instant. Sans changement de votre part, il leur est envoyé automatiquement vendredi à 17 h."}
          </p>

          {b.aRemplacer.length > 0 && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">À remplacer ({b.aRemplacer.length})</h3>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {b.aRemplacer.map((c) => (
                  <li key={c.href}>
                    <Link href={c.href} className="block rounded-xl bg-surface px-3 py-2 text-sm shadow-card hover:bg-paper">
                      {c.texte}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {b.absentsApparus.length > 0 && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Absents depuis la génération ({b.absentsApparus.length})</h3>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {b.absentsApparus.map((c) => (
                  <li key={c.href}>
                    <Link href={c.href} className="block rounded-xl bg-surface px-3 py-2 text-sm shadow-card hover:bg-paper">
                      {c.texte}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {b.peutConfirmer && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" className="btn-dark min-h-[44px] w-full !px-4 text-sm sm:w-auto" disabled={occupe !== null} onClick={() => confirmerEtEnvoyer(b)}>
                {occupe === b.serviceId ? "Envoi…" : "Confirmer et envoyer aux chauffeurs"}
              </button>
              <button type="button" className="btn-secondary min-h-[44px] w-full !px-4 text-sm sm:w-auto" disabled={occupe !== null} onClick={() => regenerer(b)}>
                Régénérer les cases vides
              </button>
            </div>
          )}
        </section>
      ))}
      {message && (
        <p role={message.ton === "erreur" ? "alert" : "status"} className={`rounded-xl px-3.5 py-2.5 text-sm font-semibold ${message.ton === "erreur" ? "bg-orange/15 text-orange-ink" : "bg-success/10 text-success-ink"}`}>
          {message.texte}
        </p>
      )}
    </div>
  );
}
