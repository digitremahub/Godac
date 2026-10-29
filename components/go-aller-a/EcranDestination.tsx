"use client";

import Link from "next/link";
import { useState } from "react";
import { AdresseInput } from "@/components/colis/AdresseInput";
import { EnregistrerFavori } from "@/components/go-aller-a/EnregistrerFavori";
import { api } from "@/components/colis/commun";
import { IconNavigation } from "@/components/layout/icons";
import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { LIBELLE_MAX, libelleDuLieu, ordonnerFavoris, ordonnerRecents, type Lieu, type LieuSaisie, type TypeLieuFixe } from "@/lib/go-lieux/lieux";
import { MAX_ETAPES, ajouterEtape, deplacerEtape, optimiserEtapes, retirerEtape, type Destination, type MissionLibre } from "@/lib/go-lieux/mission";
import { MESSAGE_SAISIE_BLOQUEE } from "@/lib/go-lieux/saisie";
import type { PositionGo } from "@/components/go-aller-a/usePosition";
import type { useLieux } from "@/components/go-aller-a/useLieux";

type Lieux = ReturnType<typeof useLieux>;

const enDestination = (l: { libelle: string; adresse: string; lat: number; lng: number }): Destination => ({ libelle: l.libelle, adresse: l.adresse, lat: l.lat, lng: l.lng });

/** Bouton principal de lancement du guidage : « GO ». */
function BoutonGo({ vers, onClick, grand = false, desactive = false }: { vers: string; onClick: () => void; grand?: boolean; desactive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactive}
      aria-label={`Lancer le guidage vers ${vers}`}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-marine font-display font-extrabold tracking-wide text-white shadow-pop disabled:opacity-50 ${grand ? "min-h-[56px] w-full text-xl" : "min-h-[48px] min-w-[72px] px-4 text-base"}`}
    >
      <IconNavigation className="h-5 w-5 text-teal" /> GO
    </button>
  );
}

export function EcranDestination({
  position,
  erreurGps,
  mouvement,
  onActualiser,
  lieux,
  tourneeEnCours,
  onLancer,
}: {
  position: PositionGo | null;
  erreurGps: string | null;
  mouvement: boolean;
  onActualiser: () => void;
  lieux: Lieux;
  tourneeEnCours: boolean;
  onLancer: (m: MissionLibre) => void;
}) {
  const [texte, setTexte] = useState("");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [etapes, setEtapes] = useState<Destination[]>([]);
  /** La prochaine adresse choisie devient une étape (sinon la destination). */
  const [pourEtape, setPourEtape] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [favoriOuvert, setFavoriOuvert] = useState(false);
  const [renomme, setRenomme] = useState<{ id: string; nom: string } | null>(null);
  const [confirmeEffacement, setConfirmeEffacement] = useState(false);
  const biais = position ? { lat: position.lat, lng: position.lng } : null;
  const pret = position !== null;

  async function choisir(sug: SuggestionAdresse) {
    setMessage(null);
    let lat = sug.lat;
    let lng = sug.lng;
    if (lat === null || lng === null) {
      try {
        const p = await api<{ lat: number; lng: number }>(`/api/colis/adresses/localiser?q=${encodeURIComponent(sug.adresse)}`);
        lat = p.lat;
        lng = p.lng;
      } catch {
        return setMessage("Adresse introuvable : précisez la rue et la ville.");
      }
    }
    const d: Destination = { libelle: libelleDuLieu(sug), adresse: sug.adresse, lat, lng };
    setTexte("");
    if (pourEtape && destination) {
      const r = ajouterEtape(etapes, d, destination);
      if (r.ok) setEtapes(r.etapes);
      else setMessage(r.motif === "plafond" ? `${MAX_ETAPES} étapes au plus.` : "Ce lieu est déjà dans le trajet.");
      setPourEtape(false);
    } else {
      setDestination(d);
      setEtapes([]);
    }
  }

  function lancer(d: Destination, avecEtapes: Destination[] = [], noter = false) {
    if (noter) void lieux.noterRecent(d);
    onLancer({ destination: d, etapes: avecEtapes });
  }

  const favoris = ordonnerFavoris(lieux.favoris);
  const recents = ordonnerRecents(lieux.recents);
  const enregistrable: LieuSaisie | null = destination;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col bg-paper">
      <header className="bg-marine px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center justify-between gap-3">
          <Link href="/livreur" className="flex min-h-[44px] items-center gap-1 text-sm text-white/80" aria-label="Retour à ma tournée colis">
            <span aria-hidden="true" className="text-lg leading-none">‹</span> {tourneeEnCours ? "Ma tournée" : "Retour"}
          </Link>
          <h1 className="font-display text-lg font-bold">Aller à…</h1>
          <span className="w-16" aria-hidden="true" />
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* Départ implicite : la position actuelle */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3 shadow-card">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-navy/55">Départ</p>
            <p className="text-sm font-semibold" role="status">
              {pret ? `Ma position actuelle${position!.precision !== null ? ` (± ${position!.precision} m)` : ""}` : (erreurGps ?? "En attente de la position GPS…")}
            </p>
          </div>
          <button type="button" className="btn-secondary min-h-[44px] shrink-0 !px-3 text-sm" onClick={onActualiser} aria-label="Ma position actuelle : actualiser">
            📍 Ma position
          </button>
        </div>

        {/* Recherche : bloquée en roulant */}
        <section aria-label="Destination" className="flex flex-col gap-2">
          {mouvement ? (
            <>
              <input className="input" disabled value="" placeholder="Adresse, commerce, entreprise…" aria-label="Destination (saisie bloquée en roulant)" />
              <p role="alert" className="rounded-lg bg-orange/10 px-3 py-2 text-sm font-semibold text-orange-ink">{MESSAGE_SAISIE_BLOQUEE}</p>
            </>
          ) : (
            <>
              <label className="text-sm font-semibold" htmlFor="aller-a-recherche">
                {pourEtape ? "Adresse de l'étape" : "Où allez-vous ?"}
              </label>
              <div id="aller-a-recherche-zone">
                <AdresseInput value={texte} onChange={setTexte} onChoisir={(s) => void choisir(s)} biais={biais} />
              </div>
            </>
          )}
          {message && (
            <p role="alert" className="text-sm font-semibold text-orange-ink">
              {message}
            </p>
          )}
        </section>

        {/* Destination choisie : GO, étapes, favori */}
        {destination && (
          <section aria-label="Destination choisie" className="flex flex-col gap-3 rounded-2xl border-2 border-teal/50 bg-surface p-4 shadow-card">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-ink">Destination</p>
              <p className="text-lg font-bold leading-snug">{destination.libelle}</p>
              {destination.libelle !== destination.adresse && <p className="text-sm text-navy/65">{destination.adresse}</p>}
            </div>
            {etapes.length > 0 && (
              <ol className="flex flex-col gap-1.5" aria-label="Étapes, dans l'ordre de passage">
                {etapes.map((e, i) => (
                  <li key={`${e.lat}-${e.lng}`} className="flex items-center gap-1.5 rounded-xl bg-navy/[0.04] p-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-bold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.libelle}</span>
                    <button type="button" className="h-11 w-11 rounded-full text-lg" disabled={i === 0} onClick={() => setEtapes(deplacerEtape(etapes, i, -1))} aria-label={`Monter l'étape ${e.libelle}`}>
                      ↑
                    </button>
                    <button type="button" className="h-11 w-11 rounded-full text-lg" disabled={i === etapes.length - 1} onClick={() => setEtapes(deplacerEtape(etapes, i, 1))} aria-label={`Descendre l'étape ${e.libelle}`}>
                      ↓
                    </button>
                    <button type="button" className="h-11 w-11 rounded-full text-lg text-orange-ink" onClick={() => setEtapes(retirerEtape(etapes, i))} aria-label={`Retirer l'étape ${e.libelle}`}>
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <BoutonGo grand vers={destination.libelle} desactive={!pret} onClick={() => lancer(destination, etapes, true)} />
            {!pret && <p className="text-center text-xs text-navy/65">GO démarre dès que la position GPS est trouvée.</p>}
            <div className="flex flex-wrap gap-2">
              {etapes.length < MAX_ETAPES && (
                <button type="button" className="btn-secondary min-h-[48px] text-sm" aria-pressed={pourEtape} onClick={() => setPourEtape((v) => !v)}>
                  {pourEtape ? "Annuler l'étape" : `+ Ajouter une étape (${etapes.length}/${MAX_ETAPES})`}
                </button>
              )}
              {etapes.length > 1 && (
                <button type="button" className="btn-secondary min-h-[48px] text-sm" onClick={() => setEtapes(optimiserEtapes(biais, etapes, destination))}>
                  Optimiser l&apos;ordre
                </button>
              )}
              <button type="button" className="btn-secondary min-h-[48px] text-sm" onClick={() => setFavoriOuvert((v) => !v)} aria-expanded={favoriOuvert}>
                ☆ Favori
              </button>
            </div>
            {favoriOuvert && enregistrable && (
              <EnregistrerFavori lieu={enregistrable} mouvement={mouvement} onEnregistrer={lieux.enregistrerFavori} onFermer={() => setFavoriOuvert(false)} />
            )}
          </section>
        )}

        {lieux.erreur && (
          <p role="alert" className="text-sm font-semibold text-orange-ink">
            {lieux.erreur}
          </p>
        )}
        {lieux.charge && !lieux.disponible && <p className="text-xs text-navy/60">Favoris et récents momentanément indisponibles : vous pouvez quand même choisir une destination.</p>}

        {favoris.length > 0 && (
          <section aria-label="Favoris" className="flex flex-col gap-2">
            <h2 className="font-display text-base font-bold">Favoris</h2>
            <ul className="flex flex-col gap-2">
              {favoris.map((f) => (
                <li key={f.id} className="flex flex-col gap-2 rounded-xl bg-surface p-3 shadow-card">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      {renomme?.id === f.id ? (
                        mouvement ? (
                          <p role="alert" className="text-sm font-semibold text-orange-ink">{MESSAGE_SAISIE_BLOQUEE}</p>
                        ) : (
                          <input className="input" value={renomme.nom} maxLength={LIBELLE_MAX} onChange={(e) => setRenomme({ id: f.id, nom: e.target.value })} aria-label={`Nouveau nom de ${f.libelle}`} autoFocus />
                        )
                      ) : (
                        <>
                          <p className="truncate font-semibold">{f.type_lieu === "domicile" ? "🏠 " : f.type_lieu === "travail" ? "💼 " : "⭐ "}{f.libelle}</p>
                          <p className="truncate text-xs text-navy/60">{f.adresse}</p>
                        </>
                      )}
                    </div>
                    <BoutonGo vers={f.libelle} onClick={() => lancer(enDestination(f))} desactive={!pret} />
                  </div>
                  <div className="flex gap-2">
                    {renomme?.id === f.id ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary min-h-[44px] !px-3 text-sm"
                          disabled={mouvement || !renomme.nom.trim()}
                          onClick={() => {
                            void lieux.renommerLieu(f.id, renomme.nom);
                            setRenomme(null);
                          }}
                        >
                          Enregistrer
                        </button>
                        <button type="button" className="btn-ghost min-h-[44px] !px-3 text-sm" onClick={() => setRenomme(null)}>
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        {!f.type_lieu && (
                          <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" onClick={() => setRenomme({ id: f.id, nom: f.libelle })} aria-label={`Renommer ${f.libelle}`}>
                            Renommer
                          </button>
                        )}
                        <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm text-orange-ink" onClick={() => void lieux.supprimerLieu(f.id)} aria-label={`Supprimer ${f.libelle}`}>
                          Supprimer
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recents.length > 0 && (
          <section aria-label="Destinations récentes" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold">Récents</h2>
              {confirmeEffacement ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary min-h-[44px] !px-3 text-sm"
                    onClick={() => {
                      void lieux.toutEffacer();
                      setConfirmeEffacement(false);
                    }}
                  >
                    Confirmer
                  </button>
                  <button type="button" className="btn-ghost min-h-[44px] !px-3 text-sm" onClick={() => setConfirmeEffacement(false)}>
                    Annuler
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-ghost min-h-[44px] !px-2 text-sm text-orange-ink" onClick={() => setConfirmeEffacement(true)}>
                  Tout effacer l&apos;historique
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {recents.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-xl bg-surface p-3 shadow-card">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.libelle}</p>
                    <p className="truncate text-xs text-navy/60">{r.adresse}</p>
                  </div>
                  <BoutonGo vers={r.libelle} onClick={() => lancer(enDestination(r), [], true)} desactive={!pret} />
                  <button type="button" className="h-11 w-11 shrink-0 rounded-full text-lg text-orange-ink" onClick={() => void lieux.supprimerLieu(r.id)} aria-label={`Supprimer ${r.libelle} de l'historique`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-center text-xs text-navy/55">Votre trajet et votre position ne sont pas enregistrés. Seuls vos favoris et vos destinations récentes (90 jours) le sont.</p>
      </div>
    </main>
  );
}
