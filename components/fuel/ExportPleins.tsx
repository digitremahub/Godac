import { EXPORT_MAX_PLEINS, mentionTva } from "@/lib/fuel/export";

/**
 * Export comptable des pleins (CSV ou Excel) : formulaire GET vers
 * /api/fuel-entries/export, qui télécharge le fichier. Reprend les filtres de
 * la page (période, véhicule, chauffeur) et ajoute le statut. Réservé au
 * comptable, à la direction, à l'exploitation et, pour son service, au manager
 * (la page ne l'affiche qu'à eux ; la route revérifie).
 */
export function ExportPleins({ du, au, vehicule, chauffeur }: { du: string; au: string; vehicule?: string; chauffeur?: string }) {
  return (
    <details className="card mb-4 p-4">
      <summary className="min-h-[44px] cursor-pointer text-sm font-semibold text-navy">Exporter pour la comptabilité (CSV, Excel)</summary>
      <form method="get" action="/api/fuel-entries/export" className="mt-3 flex flex-wrap items-end gap-3">
        {vehicule && <input type="hidden" name="vehicule" value={vehicule} />}
        {chauffeur && <input type="hidden" name="chauffeur" value={chauffeur} />}
        <label className="block">
          <span className="label">Du</span>
          <input type="date" name="du" defaultValue={du} required className="input min-h-[44px]" />
        </label>
        <label className="block">
          <span className="label">Au</span>
          <input type="date" name="au" defaultValue={au} required className="input min-h-[44px]" />
        </label>
        <label className="block">
          <span className="label">Pleins</span>
          <select name="statut" defaultValue="enregistres" className="input min-h-[44px]">
            <option value="enregistres">Enregistrés (saisis ou validés)</option>
            <option value="tous">Tous, tickets en attente compris</option>
            <option value="awaiting_validation">Tickets à valider</option>
            <option value="ocr_failed">Lecture du ticket échouée</option>
          </select>
        </label>
        <button type="submit" name="format" value="csv" className="btn-primary min-h-[44px]">
          Télécharger en CSV
        </button>
        <button type="submit" name="format" value="xlsx" className="btn-secondary min-h-[44px]">
          Télécharger en Excel
        </button>
        <p className="w-full text-xs text-navy/60">
          Totaux : litres, montant HT, TTC et TVA. {mentionTva()} Au plus {EXPORT_MAX_PLEINS.toLocaleString("fr-FR")} pleins par fichier ; au-delà, l&apos;export est tronqué et le dit.
        </p>
      </form>
    </details>
  );
}
