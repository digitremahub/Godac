"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";

type Etat = { busy: boolean; refus: Refus | null; message: string | null };
const initial: Etat = { busy: false, refus: null, message: null };

/**
 * Génération des documents TICPE : récapitulatif 3310-TIC d'une période
 * (Excel + PDF), état récapitulatif annuel (ERA), dossier de contrôle ZIP.
 */
export function GenerateurDocuments({ debut, fin, libelle, anneeEra, annees }: { debut: string; fin: string; libelle: string; anneeEra: number; annees: number[] }) {
  const router = useRouter();
  const [du, setDu] = useState(debut);
  const [au, setAu] = useState(fin);
  const [annee, setAnnee] = useState(anneeEra);
  const [recap, setRecap] = useState<Etat>(initial);
  const [era, setEra] = useState<Etat>(initial);
  const [dossier, setDossier] = useState<Etat>(initial);

  async function lancer<T>(set: (e: Etat) => void, url: string, corps: unknown, ouvrir: (d: T) => (string | undefined)[], message: (d: T) => string) {
    set({ busy: true, refus: null, message: null });
    const r = await fetchGodac<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    if (!r.ok) return set({ busy: false, refus: r.refus, message: null });
    for (const u of ouvrir(r.data)) if (u) window.open(u, "_blank");
    set({ busy: false, refus: null, message: message(r.data) });
    router.refresh();
  }

  const periodeValide = du && au && du <= au;
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-3">
        <div>
          <h3 className="text-base">Récapitulatif 3310-TIC</h3>
          <p className="text-xs text-navy/60">Volumes en hectolitres et montant par activité, zone et taux, détail par véhicule et par plein (Excel + PDF). Proposé : {libelle}.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Du</span>
            <input type="date" className="input" value={du} onChange={(e) => setDu(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Au</span>
            <input type="date" className="input" value={au} onChange={(e) => setAu(e.target.value)} />
          </label>
        </div>
        <BandeauRefus refus={recap.refus} onFermer={() => setRecap(initial)} />
        <button
          type="button"
          className="btn-primary"
          disabled={recap.busy || !periodeValide}
          onClick={() =>
            void lancer<{ downloadUrl?: string }>(setRecap, "/api/ticpe/export", { period_start: du, period_end: au }, (d) => [d.downloadUrl], () => "Récapitulatif généré : à vérifier ligne par ligne (« Vérifier »).")
          }
        >
          {recap.busy ? "Génération…" : "Générer le récapitulatif"}
        </button>
        {recap.message && <p className="text-sm text-teal-ink">{recap.message}</p>}
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h3 className="text-base">État récapitulatif annuel (ERA)</h3>
          <p className="text-xs text-navy/60">
            Par véhicule : quantités acquises, informations du véhicule, montant, détail par usage et zone. À établir au plus tard le 31 janvier de l&apos;année
            suivante et à conserver.
          </p>
        </div>
        <label className="block">
          <span className="label">Année</span>
          <select className="input" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {annees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <BandeauRefus refus={era.refus} onFermer={() => setEra(initial)} />
        <button
          type="button"
          className="btn-primary"
          disabled={era.busy}
          onClick={() =>
            void lancer<{ excelUrl?: string; pdfUrl?: string; enregistre: boolean }>(
              setEra,
              "/api/ticpe/era",
              { annee },
              (d) => [d.excelUrl, d.pdfUrl],
              (d) => (d.enregistre ? `ERA ${annee} généré et rangé ci-dessous.` : `ERA ${annee} généré (non rangé : mise à jour de la base en attente).`),
            )
          }
        >
          {era.busy ? "Génération…" : `Générer l'ERA ${annee}`}
        </button>
        {era.message && <p className="text-sm text-teal-ink">{era.message}</p>}
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h3 className="text-base">Dossier de contrôle (ZIP)</h3>
          <p className="text-xs text-navy/60">
            Récapitulatif de la période ({du || "…"} → {au || "…"}) et justificatifs présents dans GODAC : photos de tickets, factures de livraison des cuves,
            cartes grises. Les relevés de cartes et factures papier restent à ajouter par vos soins.
          </p>
        </div>
        <BandeauRefus refus={dossier.refus} onFermer={() => setDossier(initial)} />
        <button
          type="button"
          className="btn-secondary"
          disabled={dossier.busy || !periodeValide}
          onClick={() =>
            void lancer<{ url?: string; fichiers: number; absents: number }>(
              setDossier,
              "/api/ticpe/dossier",
              { periode_debut: du, periode_fin: au },
              (d) => [d.url],
              (d) => `Archive prête : ${d.fichiers} fichier(s)${d.absents ? `, ${d.absents} non inclus (voir LISEZMOI.txt)` : ""}.`,
            )
          }
        >
          {dossier.busy ? "Préparation de l'archive…" : "Préparer le dossier de contrôle"}
        </button>
        {dossier.message && <p className="text-sm text-teal-ink">{dossier.message}</p>}
      </Card>
    </div>
  );
}
