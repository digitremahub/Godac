"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
import { libelleModule } from "@/lib/acces/catalogue";
import {
  actionsProposees,
  compterParStatut,
  filtrerComptes,
  FILTRES_COMPTE,
  LIBELLES_ACTION,
  LIBELLES_OFFRE,
  LIBELLES_STATUT_COMPTE,
  MOTIF_MIN,
  normaliserMotif,
  textesConfirmation,
  trierComptes,
  TRIS_COMPTE,
  type ActionCompte,
  type FiltreCompte,
  type LigneCompte,
  type StatutCompte,
  type TriCompte,
} from "@/lib/comptes-essai/regles";

const dateCourte = (v: string) => new Date(v).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
const dateHeure = (v: string) => new Date(v).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

const BADGE_STATUT: Record<StatutCompte, string> = {
  essai_en_cours: "badge-teal",
  essai_termine: "badge-gold",
  suspendu: "badge-orange",
  abonne: "badge-teal",
  autre: "badge-neutral",
};

/** Libellé de l'essai : « Essai en cours — 12 jours restants », « Essai terminé le … ». */
function libelleEtat(l: LigneCompte): string {
  const base = LIBELLES_STATUT_COMPTE[l.statut];
  if (l.statut === "essai_en_cours") {
    if (l.joursRestants === null) return `${base} (sans date de fin)`;
    return `${base} — ${l.joursRestants} jour${l.joursRestants > 1 ? "s" : ""} restant${l.joursRestants > 1 ? "s" : ""}`;
  }
  return base;
}

/** Liste des comptes (hors démo) : recherche, filtres par statut, tri, et actions de suspension / rétablissement / révocation. */
export function ComptesEssaiListe({ lignes, suspensionDisponible }: { lignes: LigneCompte[]; suspensionDisponible: boolean }) {
  const [filtre, setFiltre] = useState<FiltreCompte>("tous");
  const [tri, setTri] = useState<TriCompte>("creation_recent");
  const [recherche, setRecherche] = useState("");
  const idRecherche = useId();
  const idTri = useId();

  const compteurs = useMemo(() => compterParStatut(lignes), [lignes]);
  const visibles = useMemo(() => trierComptes(filtrerComptes(lignes, filtre, recherche), tri), [lignes, filtre, recherche, tri]);

  return (
    <div className="flex flex-col gap-4">
      {!suspensionDisponible && (
        <p role="status" className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm text-navy">
          La suspension n&apos;est pas encore installée sur la base (migration 20261116000001_comptes_suspension.sql à appliquer) : la liste est en lecture seule.
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label htmlFor={idRecherche} className="label">
              Rechercher un compte
            </label>
            <input id={idRecherche} type="search" className="input" placeholder="Nom, e-mail de la direction, apporteur…" value={recherche} onChange={(e) => setRecherche(e.target.value)} autoComplete="off" />
          </div>
          <div className="md:w-72">
            <label htmlFor={idTri} className="label">
              Trier par
            </label>
            <select id={idTri} className="input" value={tri} onChange={(e) => setTri(e.target.value as TriCompte)}>
              {TRIS_COMPTE.map((t) => (
                <option key={t.cle} value={t.cle}>
                  {t.libelle}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-2">
          {FILTRES_COMPTE.map((f) => (
            <button key={f.cle} type="button" aria-pressed={filtre === f.cle} onClick={() => setFiltre(f.cle)} className={filtre === f.cle ? "btn-primary !px-3 !py-2" : "btn-secondary !px-3 !py-2"}>
              {f.libelle} <span className="tabular-nums opacity-80">({compteurs[f.cle]})</span>
            </button>
          ))}
        </div>
        <p aria-live="polite" className="text-sm text-navy/65">
          {visibles.length} compte{visibles.length > 1 ? "s" : ""} affiché{visibles.length > 1 ? "s" : ""} sur {lignes.length}.
        </p>
      </Card>

      {visibles.length === 0 ? (
        <Card>
          <p className="text-sm text-navy/65">Aucun compte ne correspond à cette recherche.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibles.map((l) => (
            <li key={l.id}>
              <FicheCompte ligne={l} suspensionDisponible={suspensionDisponible} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-navy/55">{libelle}</dt>
      <dd className="break-words text-sm text-navy">{children}</dd>
    </div>
  );
}

function FicheCompte({ ligne: l, suspensionDisponible }: { ligne: LigneCompte; suspensionDisponible: boolean }) {
  const titre = useId();
  return (
    <Card className="flex flex-col gap-3">
      <article aria-labelledby={titre} className="flex flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h2 id={titre} className="mr-1 break-words text-base font-semibold">
            {l.nom}
          </h2>
          <span className="badge-neutral">{LIBELLES_OFFRE[l.offre]}</span>
          <span className={BADGE_STATUT[l.statut]}>{libelleEtat(l)}</span>
          {l.organisationDuStaff && <span className="badge-gold">Votre organisation</span>}
        </header>

        {l.statut === "suspendu" && (
          <p className="rounded-lg border border-orange/30 bg-orange/10 p-2 text-sm text-orange-ink">
            Suspendu{l.suspendueLe ? ` le ${dateHeure(l.suspendueLe)}` : ""}
            {l.suspenduePar ? ` par ${l.suspenduePar}` : ""} : {l.suspendueMotif ?? "motif non renseigné"}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-4">
          <Champ libelle="Créé le">{dateCourte(l.creeLe)}</Champ>
          <Champ libelle="Fin d'essai">{l.trialEndsAt ? dateCourte(l.trialEndsAt) : "—"}</Champ>
          <Champ libelle="Dernière activité">{l.derniereActivite ? dateHeure(l.derniereActivite) : "Aucune connue"}</Champ>
          <Champ libelle="Usage (30 jours)">
            <span className="tabular-nums">
              {l.tournees} tournée{l.tournees > 1 ? "s" : ""} · {l.arrets} arrêt{l.arrets > 1 ? "s" : ""} ({l.arretsLivres} livré{l.arretsLivres > 1 ? "s" : ""})
            </span>
          </Champ>
        </dl>

        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-teal-ink">Détails du compte</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Champ libelle="Abonnement">
              {l.abonnement ?? "—"}
              {l.plan ? <span className="capitalize"> · plan {l.plan}</span> : null}
            </Champ>
            <Champ libelle="Apporteur / parrainage">{l.apporteur ?? "—"}</Champ>
            <Champ libelle="Utilisateurs actifs">{l.utilisateursActifs}</Champ>
            <Champ libelle="Compte direction">
              {l.emailDirection ? (
                <a href={`mailto:${l.emailDirection}`} className="text-teal-ink hover:underline">
                  {l.emailDirection}
                </a>
              ) : (
                "Aucun (pas de rôle direction)"
              )}
            </Champ>
            <Champ libelle="Source de l'activité">{l.derniereActivite ? (l.sourceActivite === "connexion" ? "connexion" : "activité") : "—"}</Champ>
            <Champ libelle="Détail de l'usage">
              <span className="tabular-nums">
                {l.tourneesDemarrees} tournée{l.tourneesDemarrees > 1 ? "s" : ""} démarrée{l.tourneesDemarrees > 1 ? "s" : ""} · {l.optimisations} optimisation{l.optimisations > 1 ? "s" : ""} · {l.lecturesEtiquettes} étiquette{l.lecturesEtiquettes > 1 ? "s" : ""} lue{l.lecturesEtiquettes > 1 ? "s" : ""}
              </span>
            </Champ>
          </dl>
          <p className="mb-1 mt-3 text-xs font-medium text-navy/55">Modules activés ({l.modules.length})</p>
          {l.modules.length === 0 ? (
            <p className="text-navy/60">Aucun</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {l.modules.map((m) => (
                <li key={m} className="badge-neutral !whitespace-normal">
                  {libelleModule(m)}
                </li>
              ))}
            </ul>
          )}
        </details>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-navy/5 pt-3 text-sm">
          <Link href={`/godac-staff/${l.id}`} className="font-semibold text-teal-ink hover:underline">
            Utilisateurs / rôles
          </Link>
          {l.offre === "go_navigation" && (
            <Link href="/godac-staff/usage-essais" className="font-semibold text-teal-ink hover:underline">
              Usage des essais
            </Link>
          )}
        </div>

        {suspensionDisponible && <ActionsCompte ligne={l} />}
      </article>
    </Card>
  );
}

/** Actions du staff sur un compte : motif obligatoire, confirmation (boîte GODAC), nom retapé pour sa propre organisation. */
function ActionsCompte({ ligne: l }: { ligne: LigneCompte }) {
  const router = useRouter();
  const idMotif = useId();
  const idNom = useId();
  const [motif, setMotif] = useState("");
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState<ActionCompte | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const actions = actionsProposees(l);
  const motifOk = normaliserMotif(motif) !== null;
  const nomOk = !l.organisationDuStaff || nom.trim() === l.nom.trim();

  async function lancer(action: ActionCompte) {
    setErreur(null);
    setInfo(null);
    if (!motifOk) return setErreur(`Indiquez le motif (${MOTIF_MIN} caractères au moins).`);
    if (action !== "retablir" && !nomOk) return setErreur("C'est votre propre organisation : retapez son nom exact pour confirmer.");
    const t = textesConfirmation(action, l.nom);
    if (!(await confirmer(t))) return;
    setBusy(action);
    const r = await fetchGodac<{ avertissement?: string; invitationsRevoquees?: number; liensRevoques?: number }>(`/api/godac-staff/comptes-essai/${l.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, motif, ...(l.organisationDuStaff ? { confirmation_nom: nom } : {}) }),
    });
    setBusy(null);
    if (!r.ok) return setErreur(r.refus.message);
    const d = r.data;
    setInfo(
      action === "revoquer"
        ? `Compte révoqué : ${d.invitationsRevoquees ?? 0} invitation(s) et ${d.liensRevoques ?? 0} lien(s) personnel(s) invalidé(s).${d.avertissement ? ` ${d.avertissement}` : ""}`
        : `${LIBELLES_ACTION[action]} : fait.`,
    );
    setMotif("");
    setNom("");
    router.refresh();
  }

  if (actions.length === 0) return null;
  return (
    <details className="rounded-xl border border-navy/10 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-navy">Actions sur ce compte</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label htmlFor={idMotif} className="label">
            Motif (obligatoire, conservé au journal d&apos;audit)
          </label>
          <textarea id={idMotif} className="input" rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} aria-required="true" />
        </div>
        {l.organisationDuStaff && (
          <div>
            <label htmlFor={idNom} className="label">
              C&apos;est votre propre organisation : retapez son nom exact pour agir dessus
            </label>
            <input id={idNom} className="input" value={nom} onChange={(e) => setNom(e.target.value)} placeholder={l.nom} autoComplete="off" />
            <p className="mt-1 text-xs text-navy/60">Vous perdriez vous-même l&apos;accès à l&apos;application (le back-office reste accessible pour rétablir).</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={a === "retablir" ? "btn-primary" : a === "terminer_essai" ? "btn-secondary" : "btn-danger"}
              disabled={busy !== null || !motifOk || (a !== "retablir" && !nomOk)}
              onClick={() => lancer(a)}
            >
              {busy === a ? "En cours…" : LIBELLES_ACTION[a]}
            </button>
          ))}
        </div>
        <p className="text-xs text-navy/60">Rien n&apos;est supprimé : suspendre coupe l&apos;accès, rétablir le rend. Révoquer suspend et invalide aussi les invitations « Faire essayer GO » non utilisées et le lien personnel du compte.</p>
        {erreur && (
          <p role="alert" className="text-sm text-orange-ink">
            {erreur}
          </p>
        )}
        {info && (
          <p role="status" className="text-sm text-teal-ink">
            {info}
          </p>
        )}
      </div>
    </details>
  );
}
