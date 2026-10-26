"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { confirmer } from "@/lib/ui/confirmation";
import {
  LIBELLES_TYPE,
  TYPES_A_TRAITER,
  compter,
  filtrerParTypes,
  libelleDuree,
  libelleNombre,
  type ElementATraiter,
  type TypeATraiter,
} from "@/lib/a-traiter/logique";
import {
  COMMENTAIRE_LOT_MAX,
  LIBELLE_ACTION,
  LOT_MAX,
  SENS_ACTION,
  actionPossible,
  commentaireRequis,
  commentaireValide,
  estTypeLot,
  messageResume,
  phraseLitrage,
  resumeLitrage,
  type ActionLot,
  type ResultatElement,
  type ResumeLot,
} from "@/lib/a-traiter/lot";

/**
 * « À traiter aujourd'hui » : une seule liste de tout ce qui attend
 * l'exploitation, triée par urgence puis ancienneté, avec un compteur,
 * des filtres par type et — sur la page dédiée — des actions groupées
 * (Valider / Refuser avec un motif commun).
 *
 * Deux présentations :
 *  - « apercu » (tableau de bord) : les premières lignes, les compteurs
 *    par type et un lien vers la page ;
 *  - « page » (/dashboard/a-traiter) : filtres, cases à cocher, barre
 *    d'actions, retour détaillé par élément.
 * Les données viennent de lib/a-traiter/serveur.ts (déjà filtrées par la
 * règle de hiérarchie : jamais ses propres demandes comme « à valider »).
 */

const LIEN_PAGE = "/dashboard/a-traiter";

interface Props {
  elements: ElementATraiter[];
  verrouilles?: ElementATraiter[];
  /** Sources non lues (libellés courts) : message discret. */
  erreurs?: string[];
  /** Types dont la lecture a atteint le plafond. */
  plafonnes?: TypeATraiter[];
  /** Instant du chargement (ISO) : base des durées affichées. */
  maintenantIso: string;
  presentation: "apercu" | "page";
  /** Types filtrés au départ (page). */
  typesInitiaux?: TypeATraiter[];
  /** Nombre de lignes de l'aperçu. */
  lignesApercu?: number;
}

interface RetourLot {
  action: ActionLot;
  resume: ResumeLot;
  refus: { libelle: string; motif: string }[];
}

function texteDate(e: ElementATraiter, maintenant: Date): string | null {
  if (e.depuis) {
    const d = libelleDuree(e.depuis, maintenant);
    return d ? `Demandé ${d}` : null;
  }
  if (e.echeance) {
    const d = libelleDuree(e.echeance, maintenant);
    return d ? `Échéance ${d}` : null;
  }
  return null;
}

function Ligne({ e, maintenant, selection }: { e: ElementATraiter; maintenant: Date; selection?: { coche: boolean; desactive: boolean; basculer: () => void } }) {
  const date = texteDate(e, maintenant);
  return (
    <li className="flex items-start gap-3 py-3">
      {selection &&
        (e.groupable ? (
          <input
            type="checkbox"
            className="h-11 w-11 shrink-0 accent-teal"
            checked={selection.coche}
            disabled={selection.desactive}
            onChange={selection.basculer}
            aria-label={`Sélectionner : ${e.libelle}`}
          />
        ) : (
          <span className="h-11 w-11 shrink-0" aria-hidden="true" />
        ))}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={e.urgence === "haute" ? "badge-orange" : "badge-neutral"}>{e.urgence === "haute" ? "Urgent" : "Normal"}</span>
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/60">{LIBELLES_TYPE[e.type].singulier}</span>
        </div>
        <p className="mt-1 text-sm font-medium text-navy">{e.libelle}</p>
        {e.detail && <p className="text-sm text-navy/70">{e.detail}</p>}
        {e.autoValidation && <p className="mt-0.5 text-xs text-gold-ink">Votre propre demande : direction seule, décision tracée « auto-validée ».</p>}
        {e.verrou && <p className="mt-0.5 text-xs text-orange-ink">{e.verrou}</p>}
        {selection && !e.groupable && !e.verrou && estTypeLot(e.type) && <p className="mt-0.5 text-xs text-navy/60">À traiter sur son écran : le responsable se choisit à la main.</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {date && <span className="text-xs text-navy/60">{date}</span>}
        <Link href={e.href} className="text-xs font-semibold text-teal-ink hover:underline">
          {e.verrou ? "Voir →" : "Traiter →"}
        </Link>
      </div>
    </li>
  );
}

export function ATraiter({ elements, verrouilles = [], erreurs = [], plafonnes = [], maintenantIso, presentation, typesInitiaux = [], lignesApercu = 6 }: Props) {
  const router = useRouter();
  const maintenant = useMemo(() => new Date(maintenantIso), [maintenantIso]);
  const [types, setTypes] = useState<Set<TypeATraiter>>(() => new Set(typesInitiaux));
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [commentaire, setCommentaire] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [retour, setRetour] = useState<RetourLot | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // La liste vit : rafraîchie toutes les 60 s et au retour sur l'onglet (jamais onglet masqué, ni pendant un traitement).
  useEffect(() => {
    let minuteur: ReturnType<typeof setInterval> | null = null;
    const rafraichir = () => {
      if (!document.hidden && !occupe) router.refresh();
    };
    const demarrer = () => {
      if (!minuteur) minuteur = setInterval(rafraichir, 60_000);
    };
    const arreter = () => {
      if (minuteur) clearInterval(minuteur);
      minuteur = null;
    };
    const visibilite = () => {
      if (document.hidden) arreter();
      else {
        rafraichir();
        demarrer();
      }
    };
    if (!document.hidden) demarrer();
    document.addEventListener("visibilitychange", visibilite);
    return () => {
      arreter();
      document.removeEventListener("visibilitychange", visibilite);
    };
  }, [router, occupe]);

  const compteurs = useMemo(() => compter(elements), [elements]);
  const visibles = useMemo(() => filtrerParTypes(elements, presentation === "page" ? types : null), [elements, types, presentation]);
  const plafonne = (t: TypeATraiter) => plafonnes.includes(t);
  const parCle = useMemo(() => new Map(elements.map((e) => [e.cle, e])), [elements]);
  // Une sélection qui n'existe plus (élément traité, liste rafraîchie) disparaît d'elle-même.
  const choisis = useMemo(() => [...selection].map((c) => parCle.get(c)).filter((e): e is ElementATraiter => Boolean(e && e.groupable)), [selection, parCle]);

  function basculerType(t: TypeATraiter) {
    setTypes((avant) => {
      const apres = new Set(avant);
      if (apres.has(t)) apres.delete(t);
      else apres.add(t);
      return apres;
    });
  }

  function basculer(cle: string) {
    setSelection((avant) => {
      const apres = new Set(avant);
      if (apres.has(cle)) apres.delete(cle);
      else if (apres.size < LOT_MAX) apres.add(cle);
      return apres;
    });
  }

  const selectionnables = visibles.filter((e) => e.groupable);
  const toutCoche = selectionnables.length > 0 && selectionnables.slice(0, LOT_MAX).every((e) => selection.has(e.cle));
  function toutBasculer() {
    setSelection(toutCoche ? new Set() : new Set(selectionnables.slice(0, LOT_MAX).map((e) => e.cle)));
  }

  async function lancer(action: ActionLot) {
    setErreur(null);
    const concernes = choisis.filter((e) => actionPossible(e.type, action));
    const ignores = choisis.length - concernes.length;
    if (concernes.length === 0) return;
    if (commentaireRequis(action, concernes.map((e) => e.type)) && !commentaireValide(commentaire)) {
      setErreur("Un commentaire (3 caractères au moins) est obligatoire pour cette action.");
      return;
    }
    const detail = TYPES_A_TRAITER.map((t) => [t, concernes.filter((e) => e.type === t).length] as const)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${n} ${n > 1 ? LIBELLES_TYPE[t].pluriel.toLowerCase() : LIBELLES_TYPE[t].singulier.toLowerCase()}`)
      .join(", ");
    const ok = await confirmer({
      titre: `${LIBELLE_ACTION[action].verbe} ${concernes.length} élément${concernes.length > 1 ? "s" : ""} ?`,
      message: `${detail}.${action === "valider" && concernes.some((e) => e.type === "ecart_carburant") ? ` ${phraseLitrage(resumeLitrage(concernes))}` : ""}${ignores > 0 ? ` ${ignores} élément${ignores > 1 ? "s" : ""} de la sélection ne se ${action === "valider" ? "valident" : "refusent"} pas en groupe et ne seront pas touchés.` : ""} Chaque élément est contrôlé comme s'il était traité seul : ceux qui ne passent pas sont signalés avec leur motif, les autres sont traités.`,
      action: LIBELLE_ACTION[action].verbe,
      danger: action === "refuser",
    });
    if (!ok) return;

    setOccupe(true);
    try {
      const res = await fetch("/api/a-traiter/lot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, commentaire: commentaire.trim() || undefined, elements: concernes.map((e) => ({ type: e.type, id: e.id })) }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; resultats?: ResultatElement[]; resume?: ResumeLot } | null;
      if (!res.ok || !json?.resultats || !json.resume) {
        setErreur(json?.error ?? "Le traitement groupé a échoué.");
        return;
      }
      setRetour({
        action,
        resume: json.resume,
        refus: json.resultats.filter((r) => !r.ok).map((r) => ({ libelle: parCle.get(r.cle)?.libelle ?? "Élément", motif: r.motif ?? "Refusé." })),
      });
      // Les éléments traités quittent la liste ; les refusés restent sélectionnés pour être repris.
      const refuses = new Set(json.resultats.filter((r) => !r.ok).map((r) => r.cle));
      setSelection(new Set([...selection].filter((c) => refuses.has(c))));
      router.refresh();
    } catch {
      setErreur("Connexion impossible : le traitement groupé n'a pas été confirmé, vérifiez la liste avant de recommencer.");
    } finally {
      setOccupe(false);
    }
  }

  const nbValider = choisis.filter((e) => actionPossible(e.type, "valider")).length;
  const nbRefuser = choisis.filter((e) => actionPossible(e.type, "refuser")).length;
  const sensChoisis = (action: ActionLot) => [...new Set(choisis.filter((e) => estTypeLot(e.type) && SENS_ACTION[e.type][action]).map((e) => `${LIBELLES_TYPE[e.type].singulier.toLowerCase()} : ${SENS_ACTION[e.type as keyof typeof SENS_ACTION][action]}`))];

  const entete = (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg">À traiter aujourd&apos;hui</h2>
        <p className="mt-0.5 text-sm text-navy/70">
          <span className="text-2xl font-bold tabular-nums text-navy">{compteurs.total}</span>{" "}
          {compteurs.total > 1 ? "éléments" : "élément"}
          {compteurs.hautes > 0 && (
            <>
              {" "}
              dont <span className="font-semibold text-orange-ink">{compteurs.hautes} urgent{compteurs.hautes > 1 ? "s" : ""}</span>
            </>
          )}
          {plafonnes.length > 0 && <span className="text-navy/60"> (affichage limité à 200 par type)</span>}
        </p>
      </div>
      {presentation === "apercu" && compteurs.total > 0 && (
        <Link href={LIEN_PAGE} className="btn-secondary">
          Tout voir et traiter en lot
        </Link>
      )}
    </div>
  );

  const pastilles = TYPES_A_TRAITER.filter((t) => compteurs.parType[t] > 0);
  const filtres =
    pastilles.length > 0 ? (
      <div className="mb-3 flex flex-wrap gap-2" role={presentation === "page" ? "group" : undefined} aria-label={presentation === "page" ? "Filtrer par type" : undefined}>
        {presentation === "page" && (
          <button type="button" className={types.size === 0 ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"} aria-pressed={types.size === 0} onClick={() => setTypes(new Set())}>
            Tout ({compteurs.total})
          </button>
        )}
        {pastilles.map((t) => {
          const libelle = `${LIBELLES_TYPE[t].pluriel} (${libelleNombre(compteurs.parType[t], plafonne(t))})`;
          return presentation === "page" ? (
            <button key={t} type="button" className={types.has(t) ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"} aria-pressed={types.has(t)} onClick={() => basculerType(t)}>
              {libelle}
            </button>
          ) : (
            <Link key={t} href={`${LIEN_PAGE}?type=${t}`} className="btn-secondary !px-3 !py-1.5 text-xs">
              {libelle}
            </Link>
          );
        })}
      </div>
    ) : null;

  const notes = (
    <>
      {erreurs.length > 0 && (
        <p className="mt-3 text-xs text-navy/60">
          Certaines sources n&apos;ont pas pu être lues ({erreurs.join(", ")}) : le reste de la liste est à jour.
        </p>
      )}
    </>
  );

  if (presentation === "apercu") {
    return (
      <Card className="mb-6">
        {entete}
        {compteurs.total === 0 ? (
          <p className="text-sm text-navy/60">Rien n&apos;attend de décision pour le moment.</p>
        ) : (
          <>
            {filtres}
            <ul className="flex flex-col divide-y divide-navy/5">
              {elements.slice(0, lignesApercu).map((e) => (
                <Ligne key={e.cle} e={e} maintenant={maintenant} />
              ))}
            </ul>
            {elements.length > lignesApercu && (
              <p className="mt-3 text-sm">
                <Link href={LIEN_PAGE} className="font-semibold text-teal-ink hover:underline">
                  + {elements.length - lignesApercu} autre{elements.length - lignesApercu > 1 ? "s" : ""} à traiter →
                </Link>
              </p>
            )}
          </>
        )}
        {notes}
      </Card>
    );
  }

  return (
    <div>
      <Card>
        {entete}
        {filtres}
        {visibles.length === 0 ? (
          <EmptyState title="Rien à traiter" description={elements.length === 0 ? "Aucun élément n'attend l'exploitation pour le moment." : "Aucun élément pour les types choisis."} />
        ) : (
          <>
            {selectionnables.length > 0 && (
              <label className="mb-1 flex min-h-[44px] items-center gap-2 text-sm text-navy/70">
                <input type="checkbox" className="h-11 w-11 shrink-0 accent-teal" checked={toutCoche} onChange={toutBasculer} />
                Sélectionner les éléments traitables en groupe ({Math.min(selectionnables.length, LOT_MAX)} au plus)
              </label>
            )}
            <ul className="flex flex-col divide-y divide-navy/5">
              {visibles.map((e) => (
                <Ligne key={e.cle} e={e} maintenant={maintenant} selection={{ coche: selection.has(e.cle), desactive: !selection.has(e.cle) && selection.size >= LOT_MAX, basculer: () => basculer(e.cle) }} />
              ))}
            </ul>
          </>
        )}
        {notes}
      </Card>

      {choisis.length > 0 && (
        <section aria-label="Actions groupées" className="card sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 mt-4 lg:bottom-3 flex flex-col gap-3 shadow-raised">
          <p className="text-sm font-semibold text-navy">
            {choisis.length} sélectionné{choisis.length > 1 ? "s" : ""} (au plus {LOT_MAX})
          </p>
          <div>
            <label htmlFor="commentaire-lot" className="label">
              Motif ou commentaire commun
            </label>
            <textarea
              id="commentaire-lot"
              className="input"
              rows={2}
              maxLength={COMMENTAIRE_LOT_MAX}
              value={commentaire}
              onChange={(ev) => setCommentaire(ev.target.value)}
              placeholder="Obligatoire pour justifier un écart carburant et pour refuser un arrêt de travail"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={occupe || nbValider === 0} onClick={() => lancer("valider")}>
              Valider ({nbValider})
            </button>
            <button type="button" className="btn-danger" disabled={occupe || nbRefuser === 0} onClick={() => lancer("refuser")}>
              Refuser ({nbRefuser})
            </button>
            <button type="button" className="btn-secondary" disabled={occupe} onClick={() => setSelection(new Set())}>
              Tout désélectionner
            </button>
          </div>
          <p className="text-xs text-navy/60">
            Valider : {sensChoisis("valider").join(" ; ") || "—"}. Refuser : {sensChoisis("refuser").join(" ; ") || "non disponible pour cette sélection"}.
          </p>
        </section>
      )}

      {erreur && (
        <p role="alert" className="mt-4 text-sm text-orange-ink">
          {erreur}
        </p>
      )}

      {retour && (
        <Card className="mt-4">
          <div role="status">
            <p className="font-semibold text-navy">
              {LIBELLE_ACTION[retour.action].verbe} : {messageResume(retour.resume)}
            </p>
            {retour.refus.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {retour.refus.map((r, i) => (
                  <li key={i} className="text-navy/80">
                    <span className="font-medium">{r.libelle}</span> — <span className="text-orange-ink">{r.motif}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="btn-secondary mt-3" onClick={() => setRetour(null)}>
            Fermer
          </button>
        </Card>
      )}

      {verrouilles.length > 0 && (
        <Card className="mt-6">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-navy">
              Vos propres demandes en attente ({verrouilles.length}) : vous ne pouvez pas les décider
            </summary>
            <p className="mt-2 text-sm text-navy/70">Personne ne décide sa propre demande : elles ne sont pas comptées ci-dessus et attendent une autre personne.</p>
            <ul className="mt-2 flex flex-col divide-y divide-navy/5">
              {verrouilles.map((e) => (
                <Ligne key={e.cle} e={e} maintenant={maintenant} />
              ))}
            </ul>
          </details>
        </Card>
      )}
    </div>
  );
}
