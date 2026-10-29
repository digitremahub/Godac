"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/colis/commun";
import { ajouterFavori, ajouterRecent, effacerRecents, renommer, supprimer, type Lieu, type LieuSaisie, type TypeLieuFixe } from "@/lib/go-lieux/lieux";

/**
 * Favoris et récents de l'utilisateur (API /api/go/lieux). Table absente ou
 * réseau coupé : les listes restent vides et « Go! » fonctionne quand même.
 */
export function useLieux() {
  const [lieux, setLieux] = useState<Lieu[]>([]);
  const [disponible, setDisponible] = useState(true);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    api<{ favoris: Lieu[]; recents: Lieu[]; disponible: boolean }>("/api/go/lieux")
      .then((r) => {
        if (annule) return;
        setLieux([...r.favoris, ...r.recents]);
        setDisponible(r.disponible);
      })
      .catch(() => !annule && setDisponible(false))
      .finally(() => !annule && setCharge(true));
    return () => {
      annule = true;
    };
  }, []);

  const favoris = lieux.filter((l) => l.genre === "favori");
  const recents = lieux.filter((l) => l.genre === "recent");

  /** Destination choisie : mémorisée en tête des récents (échec silencieux). */
  const noterRecent = useCallback(async (lieu: LieuSaisie) => {
    setLieux((l) => [...l.filter((x) => x.genre === "favori"), ...ajouterRecent(l.filter((x) => x.genre === "recent"), lieu, `local-${Date.now()}`)]);
    try {
      await api("/api/go/lieux", { method: "POST", body: JSON.stringify({ genre: "recent", ...lieu }) });
    } catch {
      /* récents indisponibles : sans gravité */
    }
  }, []);

  const enregistrerFavori = useCallback(
    async (lieu: LieuSaisie, type: TypeLieuFixe | null): Promise<boolean> => {
      setErreur(null);
      const local = ajouterFavori(favoris, lieu, "tmp", type);
      if (!local.ok) {
        setErreur(local.motif === "plafond" ? "Vous avez déjà 20 favoris : supprimez-en un pour en ajouter." : local.motif === "doublon" ? "Ce lieu est déjà dans vos favoris." : "Nom ou adresse invalide.");
        return false;
      }
      try {
        const r = await api<{ lieu: Lieu }>("/api/go/lieux", { method: "POST", body: JSON.stringify({ genre: "favori", type_lieu: type, ...lieu }) });
        setLieux((l) => [...l.filter((x) => !(x.genre === "favori" && type !== null && x.type_lieu === type)), r.lieu]);
        return true;
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Favori non enregistré.");
        return false;
      }
    },
    [favoris],
  );

  const renommerLieu = useCallback(
    async (id: string, libelle: string) => {
      setErreur(null);
      const maj = renommer(lieux, id, libelle);
      if (!maj) return setErreur("Nom invalide.");
      try {
        await api(`/api/go/lieux/${id}`, { method: "PATCH", body: JSON.stringify({ libelle }) });
        setLieux(maj);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Nom non modifié.");
      }
    },
    [lieux],
  );

  const supprimerLieu = useCallback(async (id: string) => {
    setErreur(null);
    try {
      await api(`/api/go/lieux/${id}`, { method: "DELETE" });
      setLieux((l) => supprimer(l, id));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Lieu non supprimé.");
    }
  }, []);

  const toutEffacer = useCallback(async () => {
    setErreur(null);
    try {
      await api("/api/go/lieux?genre=recent", { method: "DELETE" });
      setLieux((l) => effacerRecents(l));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Historique non effacé.");
    }
  }, []);

  return { favoris, recents, disponible, charge, erreur, noterRecent, enregistrerFavori, renommerLieu, supprimerLieu, toutEffacer };
}
