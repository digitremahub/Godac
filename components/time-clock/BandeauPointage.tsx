"use client";

import { IconCheck, IconMapPin } from "@/components/layout/icons";
import { heureParis } from "@/components/time-clock/position";
import type { Bandeau } from "@/components/time-clock/useSortieDepot";

/**
 * Bandeau du pointage assisté (entrée automatique, sortie automatique,
 * propositions de sortie). Présentation seule : les actions viennent de
 * useSortieDepot, partagé par l'app livreur et le tableau de bord.
 */
export function BandeauPointage({
  bandeau,
  occupe,
  aideVisible,
  onFermerAide,
  onAnnuler,
  onPointer,
  onPlusTard,
  className = "mb-6",
}: {
  bandeau: Bandeau;
  occupe: boolean;
  aideVisible: boolean;
  onFermerAide: () => void;
  onAnnuler: (entryId: string, quoi: "entree" | "sortie") => void;
  onPointer: (quand: "maintenant" | "derniere_presence") => void;
  onPlusTard: () => void;
  className?: string;
}) {
  if (!bandeau && !aideVisible) return null;
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {bandeau && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-teal/30 bg-teal/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal text-on-teal">
              {bandeau.kind === "offer_out" || bandeau.kind === "offer_left" ? <IconMapPin className="h-5 w-5" /> : <IconCheck className="h-5 w-5" />}
            </span>
            <p className="text-sm">
              {bandeau.kind === "auto_in" && (
                <>
                  <strong>Entrée pointée à {bandeau.time}</strong> — vous êtes au dépôt.
                </>
              )}
              {bandeau.kind === "auto_out" && (
                <>
                  <strong>Sortie pointée à {bandeau.time}</strong> — vous avez quitté le dépôt.
                </>
              )}
              {bandeau.kind === "offer_out" && (
                <>
                  <strong>Vous êtes au dépôt.</strong> Votre tournée est terminée : pointer la sortie ?
                </>
              )}
              {bandeau.kind === "offer_left" && (
                <>
                  <strong>Vous avez quitté le dépôt.</strong>{" "}
                  {bandeau.lastSeenAt
                    ? `Dernière présence au dépôt à ${heureParis(bandeau.lastSeenAt)}. Pointer la sortie à cette heure, ou maintenant ?`
                    : "Votre tournée est terminée : pointer la sortie maintenant ?"}
                </>
              )}
              {bandeau.kind === "done" && bandeau.message}
            </p>
          </div>
          {bandeau.kind === "auto_in" && (
            <button type="button" className="btn-secondary shrink-0" disabled={occupe} onClick={() => onAnnuler(bandeau.entryId, "entree")}>
              {occupe ? "Annulation…" : "Annuler"}
            </button>
          )}
          {bandeau.kind === "auto_out" && (
            <button type="button" className="btn-secondary shrink-0" disabled={occupe} onClick={() => onAnnuler(bandeau.entryId, "sortie")}>
              {occupe ? "Annulation…" : "Annuler"}
            </button>
          )}
          {bandeau.kind === "offer_out" && (
            <div className="flex shrink-0 gap-2">
              <button type="button" className="btn-ghost" onClick={onPlusTard}>
                Plus tard
              </button>
              <button type="button" className="btn-primary" disabled={occupe} onClick={() => onPointer("maintenant")}>
                {occupe ? "Pointage…" : "Pointer la sortie"}
              </button>
            </div>
          )}
          {bandeau.kind === "offer_left" && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" className="btn-ghost" onClick={onPlusTard}>
                Plus tard
              </button>
              <button type="button" className={bandeau.lastSeenAt ? "btn-secondary" : "btn-primary"} disabled={occupe} onClick={() => onPointer("maintenant")}>
                {occupe ? "Pointage…" : "Sortie maintenant"}
              </button>
              {bandeau.lastSeenAt && (
                <button type="button" className="btn-primary" disabled={occupe} onClick={() => onPointer("derniere_presence")}>
                  {occupe ? "Pointage…" : `Sortie à ${heureParis(bandeau.lastSeenAt)}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {aideVisible && !bandeau && (
        <div role="note" className="flex items-start justify-between gap-3 rounded-2xl border border-navy/[0.08] bg-surface p-3 text-sm text-navy/75">
          <p>Gardez GODAC ouvert jusqu&apos;à la sortie du dépôt, sinon la sortie vous sera proposée à la prochaine ouverture.</p>
          <button type="button" className="btn-ghost shrink-0" onClick={onFermerAide}>
            Compris
          </button>
        </div>
      )}
    </div>
  );
}
