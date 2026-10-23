/**
 * Fiche complète d'un plein, renvoyée par GET /api/fuel-entries/[id]/detail
 * et affichée dans l'historique carburant (components/fuel/FuelEntryDetail).
 * Toutes les colonnes viennent réellement de fuel_entries (migrations 003,
 * 033, 084, 088, 121) ; rien n'est inventé.
 */

import type { DroitsEcart, Ecart, StatutEcart } from "@/lib/fuel/ecarts";

export interface PhotoPlein {
  libelle: string;
  url: string;
}

export interface TraitementAffiche {
  id: string;
  action: string;
  commentaire: string;
  auteur: string | null;
  created_at: string;
}

export interface AlerteAffichee {
  id: string;
  type: string;
  severity: string;
  message: string | null;
  status: string;
  created_at: string;
}

export interface CorrectionAffichee {
  id: string;
  auteur: string | null;
  created_at: string;
  /** Champs envoyés lors de la modification (nom de colonne → valeur). */
  details: Record<string, unknown> | null;
}

/** Montant TICPE du plein (lib/ticpe/montant.ts) ; null si non visible pour ce rôle ou module coupé. */
export interface TicpeDuPlein {
  statut: "compte" | "exclu" | "taux_manquant";
  raison: string | null;
  categorie: string | null;
  zone: string | null;
  origineZone: string | null;
  taux: number | null;
  tauxAConfirmer: boolean;
  origineTaux: "bareme" | "surcharge" | null;
  litres: number;
  litresRetenus: number;
  litresHorsPlafond: number;
  montant: number;
  justificatif: { type: string | null; present: boolean; libelle: string };
  /** L'encadrement peut déclarer un relevé de carte ou une facture. */
  justificatifModifiable: boolean;
}

export interface DetailPlein {
  id: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
  status: string;
  product: string;
  liters: number | null;
  unit_price: number | null;
  total_amount: number | null;
  station_name: string | null;
  tank_id: string | null;
  cuve: string | null;
  vehicule: string | null;
  chauffeur: string | null;
  vehicle_km: number | null;
  totalizer_before: number | null;
  totalizer_after: number | null;
  totalizer_gap: number | null;
  gap_flagged: boolean;
  pmp_at_entry: number | null;
  saisi_par: string | null;
  valide_par: string | null;
  validated_at: string | null;
  ocr_error: string | null;
  ocr_confidence: Record<string, number | null> | null;
  /** Total et carburant lus sur le ticket (ocr_raw). */
  ticket_total: number | null;
  ticket_carburant: string | null;
  photos: PhotoPlein[];
  ecarts: Ecart[];
  statutEcart: StatutEcart;
  traitements: TraitementAffiche[];
  traitementDisponible: boolean;
  alertes: AlerteAffichee[];
  /** null : non visible pour ce rôle (journal d'audit réservé à l'encadrement). */
  corrections: CorrectionAffichee[] | null;
  /** mention : lecture seule hiérarchique (« À décider par … »), null sinon. */
  droits: DroitsEcart & { mention?: string | null };
  ticpe?: TicpeDuPlein | null;
}

/** Libellés des colonnes modifiables (journal « plein_modification »). */
export const LIBELLES_CHAMPS_PLEIN: Record<string, string> = {
  occurred_at: "Date",
  liters: "Litres",
  unit_price: "Prix unitaire",
  totalizer_before: "Totaliseur avant",
  totalizer_after: "Totaliseur après",
  totalizer_before_photo_path: "Photo totaliseur avant",
  totalizer_after_photo_path: "Photo totaliseur après",
  vehicle_km: "Kilométrage",
  vehicle_km_photo_path: "Photo compteur",
  station_name: "Station",
  product: "Produit",
  vehicle_id: "Véhicule",
  tank_id: "Cuve",
  ticpe_justificatif: "Justificatif TICPE",
  ticpe_justificatif_ref: "Référence du justificatif",
};

export const LIBELLES_STATUT_PLEIN: Record<string, string> = {
  manual: "Saisi à la main",
  validated: "Ticket OCR validé",
  pending_ocr: "OCR en cours",
  awaiting_validation: "À valider",
  ocr_failed: "Échec OCR",
};

export const LIBELLES_CONFIANCE_OCR: Record<string, string> = {
  liters: "litres",
  unit_price: "prix",
  total_amount: "total",
  occurred_at: "date",
  station_name: "station",
  fuel_type: "carburant",
  totalizer_before: "totaliseur avant",
  totalizer_after: "totaliseur après",
};
