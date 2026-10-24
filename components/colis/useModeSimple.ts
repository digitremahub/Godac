"use client";

import { useCallback, useEffect, useState } from "react";
import type { Run, Toast } from "@/components/colis/commun";
import { ecrireModesLocaux, lireModesLocaux, modeAffiche } from "@/lib/colis/mode-simple";
import { patchTournee } from "@/lib/colis/envoi-arret";
import { networkErrorMessage } from "@/lib/utils/network-error";

/** Mode simple mémorisé sur l'appareil (repli tant que la colonne n'existe pas en base). */
const CLE_MODES_LOCAUX = "godac.mode-simple.tournees";

/**
 * Mode (simple / complet) de la tournée affichée, modifiable à tout moment
 * jusqu'à la clôture : l'effet est immédiat, les arrêts ne sont pas touchés
 * (les clôturés restent clôturés), l'enregistrement passe par la file hors
 * ligne s'il n'y a pas de réseau.
 */
export function useModeSimple(run: Run | null, onToast: (t: Toast) => void) {
  const [locaux, setLocaux] = useState<Set<string>>(() => new Set());
  const [choix, setChoix] = useState<{ id: string; simple: boolean } | null>(null);
  useEffect(() => {
    try {
      setLocaux(lireModesLocaux(localStorage.getItem(CLE_MODES_LOCAUX)));
    } catch {
      /* stockage indisponible */
    }
  }, []);
  const simple = modeAffiche(run, locaux, choix);
  const basculer = useCallback(
    async (vers: boolean) => {
      if (!run || run.status === "done" || vers === simple) return;
      const avant = choix;
      setChoix({ id: run.id, simple: vers });
      try {
        const brut = ecrireModesLocaux(locaux, run.id, vers);
        setLocaux(lireModesLocaux(brut));
        localStorage.setItem(CLE_MODES_LOCAUX, brut);
      } catch {
        /* stockage indisponible */
      }
      try {
        const issue = await patchTournee(run.id, { mode_simple: vers });
        onToast({
          ok: true,
          text: `${vers ? "Interface simple : Livré / Non livré seulement." : "Interface complète rétablie."}${issue === "en_attente" ? " Enregistrée sur le téléphone, synchronisée au retour du réseau." : ""}`,
        });
      } catch (e) {
        setChoix(avant);
        onToast({ ok: false, text: networkErrorMessage(e) });
      }
    },
    [run, simple, choix, locaux, onToast],
  );
  return { simple, basculer };
}
