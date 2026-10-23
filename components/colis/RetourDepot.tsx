"use client";

import { IconNavigation } from "@/components/layout/icons";

export interface DestinationRetour {
  cle: "depot" | "siege";
  titre: string;
  detail: string | null;
  /** Lien de l'application de navigation externe, vers cette destination. */
  lien: string;
  /** Coordonnées connues : le retour peut être guidé dans GO. */
  point: { lat: number; lng: number } | null;
}

export interface InfoGasoil {
  station: { nom: string; lat: number; lng: number; detourKm: number; distanceKm: number } | null;
  retour: { km: number; lPer100: number | null; litres: number | null };
}

/**
 * Fin de tournée : dernier arrêt traité, on propose de lancer le retour au
 * dépôt ou au siège de l'entreprise (navigation externe) avant de clôturer.
 */
export function RetourDepot({
  destinations,
  nomNavigation,
  onLancerGo,
  gasoil,
  onPlusTard,
}: {
  destinations: DestinationRetour[];
  nomNavigation: string;
  /** Lance le retour guidé dans GO Navigation. */
  onLancerGo: (d: DestinationRetour) => void;
  /** Option « passer au gasoil » : null = déjà fait / indisponible. */
  gasoil: { info: InfoGasoil | null; chargement: boolean; erreur: boolean; onDemander: () => void; onLancer: (s: NonNullable<InfoGasoil["station"]>) => void } | null;
  onPlusTard: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-marine/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="retour-depot-titre">
      <section className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop">
        <h2 id="retour-depot-titre" className="font-display text-xl font-bold">
          Tournée terminée 🎉
        </h2>
        <p className="text-sm text-navy/70">Tous les arrêts sont traités. Où voulez-vous rentrer ? Le guidage se lance dans GO.</p>
        {destinations.map((d, i) => (
          <div key={d.cle} className="flex flex-col gap-1">
            {d.point ? (
              <button type="button" onClick={() => onLancerGo(d)} className={`${i === 0 ? "btn-primary" : "btn-secondary"} min-h-[56px] flex-col justify-center !gap-0 text-base`}>
                <span className="flex items-center gap-2">
                  <IconNavigation className="h-5 w-5" /> {d.titre} avec GO
                </span>
                {d.detail && <span className="max-w-full truncate text-xs font-normal opacity-80">{d.detail}</span>}
              </button>
            ) : (
              <a href={d.lien} target="_blank" rel="noreferrer" onClick={onPlusTard} className={`${i === 0 ? "btn-primary" : "btn-secondary"} min-h-[56px] flex-col justify-center !gap-0 text-base`}>
                <span className="flex items-center gap-2">
                  <IconNavigation className="h-5 w-5" /> {d.titre} avec {nomNavigation}
                </span>
                {d.detail && <span className="max-w-full truncate text-xs font-normal opacity-80">{d.detail}</span>}
              </a>
            )}
            {d.point && (
              <a href={d.lien} target="_blank" rel="noreferrer" onClick={onPlusTard} className="text-center text-xs font-semibold text-navy/60 underline">
                ou ouvrir dans {nomNavigation}
              </a>
            )}
          </div>
        ))}
        {gasoil && (
          <div className="rounded-2xl border border-navy/15 p-3">
            {!gasoil.info ? (
              <button type="button" className="btn-secondary min-h-[48px] w-full justify-center" onClick={gasoil.onDemander} disabled={gasoil.chargement}>
                ⛽ {gasoil.chargement ? "Recherche d'une station…" : "Passer au gasoil avant de rentrer"}
              </button>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-navy/80">
                  Retour estimé : <strong>{gasoil.info.retour.km.toLocaleString("fr-FR")} km</strong>
                  {gasoil.info.retour.litres !== null ? (
                    <>
                      {" "}
                      ≈ <strong>{gasoil.info.retour.litres.toLocaleString("fr-FR")} L</strong> ({gasoil.info.retour.lPer100?.toLocaleString("fr-FR")} L/100 km du véhicule)
                    </>
                  ) : (
                    " — consommation du véhicule inconnue"
                  )}
                  .
                </p>
                {gasoil.info.station ? (
                  <button type="button" className="btn-primary min-h-[52px] flex-col justify-center !gap-0" onClick={() => gasoil.info?.station && gasoil.onLancer(gasoil.info.station)}>
                    <span>⛽ {gasoil.info.station.nom} avec GO</span>
                    <span className="text-xs font-normal opacity-80">
                      {gasoil.info.station.distanceKm.toLocaleString("fr-FR")} km · détour ≈ +{gasoil.info.station.detourKm.toLocaleString("fr-FR")} km
                    </span>
                  </button>
                ) : (
                  <p className="font-semibold text-orange-ink">Aucune station trouvée à proximité.</p>
                )}
              </div>
            )}
            {gasoil.erreur && <p className="mt-1 text-xs font-semibold text-orange-ink">Recherche impossible pour le moment.</p>}
          </div>
        )}
        <button type="button" className="btn-ghost min-h-[44px] justify-center text-sm" onClick={onPlusTard}>
          Plus tard
        </button>
      </section>
    </div>
  );
}
