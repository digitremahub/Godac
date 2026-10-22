"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { LIBELLES_CATEGORIE, type CategorieTicpe } from "@/lib/ticpe/bareme";
import { LIBELLES_REGIME, MENTION_A_CONFIRMER, REGIMES_TVA, type ReglagesTicpe } from "@/lib/ticpe/reglages";

/** Formulaire des réglages TICPE de l'organisation (direction, comptable). */
export function ReglagesTicpeForm({ initial, lectureSeule = false }: { initial: ReglagesTicpe; lectureSeule?: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<ReglagesTicpe>(initial);
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);
  const [ok, setOk] = useState(false);

  const maj = <K extends keyof ReglagesTicpe>(k: K, v: ReglagesTicpe[K]) => {
    setOk(false);
    setR((p) => ({ ...p, [k]: v }));
  };

  async function enregistrer(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const res = await fetchGodac("/api/ticpe/reglages", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) });
    setBusy(false);
    if (!res.ok) return setRefus(res.refus);
    setOk(true);
    router.refresh();
  }

  const activites: { cle: "activite_trm" | "activite_trv" | "activite_taxi"; cat: CategorieTicpe }[] = [
    { cle: "activite_trm", cat: "trm" },
    { cle: "activite_trv", cat: "trv" },
    { cle: "activite_taxi", cat: "taxi" },
  ];

  return (
    <form onSubmit={enregistrer} className="flex flex-col gap-5">
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      <fieldset disabled={lectureSeule || busy} className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-base">Activités</h3>
          <div className="flex flex-col gap-1.5 text-sm">
            {activites.map((a) => (
              <label key={a.cle} className="flex items-center gap-2">
                <input type="checkbox" checked={r[a.cle]} onChange={(e) => maj(a.cle, e.target.checked)} />
                {LIBELLES_CATEGORIE[a.cat]}
                {a.cat !== "trm" && <span className="text-xs text-navy/55">(taux 2026 à compléter au barème)</span>}
              </label>
            ))}
          </div>
          <label className="mt-3 block max-w-md">
            <span className="label">Catégorie par défaut des véhicules</span>
            <select className="input" value={r.categorie_par_defaut} onChange={(e) => maj("categorie_par_defaut", e.target.value as CategorieTicpe)}>
              {activites.map((a) => (
                <option key={a.cat} value={a.cat} disabled={!r[a.cle]}>
                  {LIBELLES_CATEGORIE[a.cat]}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3 className="mb-2 text-base">Déclaration (annexe 3310-TIC)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Régime de TVA</span>
              <select className="input" value={r.regime_tva} onChange={(e) => maj("regime_tva", e.target.value as ReglagesTicpe["regime_tva"])}>
                {REGIMES_TVA.map((x) => (
                  <option key={x} value={x}>
                    {LIBELLES_REGIME[x]}
                  </option>
                ))}
              </select>
            </label>
            {r.regime_tva === "annuel_ca12" ? (
              <label className="block">
                <span className="label">Date limite de la CA12 (MM-JJ)</span>
                <input
                  className="input"
                  placeholder="par défaut : début mai (2e jour ouvré après le 1er mai)"
                  value={r.date_limite_ca12 ?? ""}
                  onChange={(e) => maj("date_limite_ca12", e.target.value.trim() || null)}
                />
              </label>
            ) : (
              <label className="block">
                <span className="label">Jour limite de dépôt de la TVA (mois suivant)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  placeholder="par défaut : fin du mois suivant"
                  value={r.jour_limite_depot ?? ""}
                  onChange={(e) => maj("jour_limite_depot", e.target.value ? Number(e.target.value) : null)}
                />
              </label>
            )}
            <label className="block">
              <span className="label">Rappel avant l&apos;échéance (jours)</span>
              <input className="input" type="number" min={0} max={60} value={r.rappel_jours} onChange={(e) => maj("rappel_jours", Number(e.target.value || 0))} />
            </label>
          </div>
          <p className="mt-1 text-xs text-navy/55">
            Depuis les consommations 2025, la demande se fait auprès des impôts (DGFiP) avec la déclaration de TVA. La date limite dépend de votre entreprise :
            reprenez celle de votre espace professionnel ({MENTION_A_CONFIRMER}).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-base">Plafond par véhicule</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Litres au maximum</span>
              <input className="input" type="number" min={1} value={r.plafond_litres} onChange={(e) => maj("plafond_litres", Number(e.target.value || 0))} />
            </label>
            <label className="block">
              <span className="label">Par</span>
              <select className="input" value={r.plafond_periode} onChange={(e) => maj("plafond_periode", e.target.value as "annuel" | "semestriel")}>
                <option value="annuel">an (année civile)</option>
                <option value="semestriel">semestre</option>
              </select>
            </label>
          </div>
          <p className="mt-1 text-xs text-navy/55">
            Les sources se contredisent (40 000 L par an ou 20 000 L par semestre) : {MENTION_A_CONFIRMER}. Les litres au-delà restent visibles mais ne comptent
            pas dans le montant.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-base">Produits, zone, location</h3>
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-navy/70">Gazole : toujours. AdBlue, essence, GNV et électrique : jamais.</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={r.accepte_hvo_b100} onChange={(e) => maj("accepte_hvo_b100", e.target.checked)} />
              Compter les véhicules au HVO / B100 <span className="text-xs text-navy/55">({MENTION_A_CONFIRMER})</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={r.forfait_pondere_2025} onChange={(e) => maj("forfait_pondere_2025", e.target.checked)} />
              2025 : appliquer le taux forfaitaire pondéré plutôt que les taux régionaux
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Zone des pleins par défaut</span>
              <select className="input" value={r.zone_par_defaut} onChange={(e) => maj("zone_par_defaut", e.target.value as "metropole" | "corse")}>
                <option value="metropole">Métropole hors Corse</option>
                <option value="corse">Corse</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Véhicules loués : le remboursement est demandé par</span>
              <select className="input" value={r.location_demandeur} onChange={(e) => maj("location_demandeur", e.target.value as "nous" | "loueur")}>
                <option value="nous">nous (l&apos;entreprise qui utilise le véhicule)</option>
                <option value="loueur">le loueur</option>
              </select>
            </label>
          </div>
          <p className="mt-1 text-xs text-navy/55">
            Location et crédit-bail : qui demande le remboursement est {MENTION_A_CONFIRMER}. Vous pouvez aussi le régler véhicule par véhicule.
          </p>
        </section>
      </fieldset>

      {!lectureSeule && (
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer les réglages"}
          </button>
          {ok && <span className="text-sm text-teal-ink">Réglages enregistrés.</span>}
        </div>
      )}
    </form>
  );
}
