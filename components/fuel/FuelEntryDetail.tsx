"use client";

import { decrireModification } from "@/lib/audit/avant-apres";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import {
  COMMENTAIRE_MAX,
  LIBELLES_ACTION_ECART,
  LIBELLES_STATUT_ECART,
  commentaireValide,
  type ActionEcart,
  type StatutEcart,
} from "@/lib/fuel/ecarts";
import {
  LIBELLES_CHAMPS_PLEIN,
  LIBELLES_CONFIANCE_OCR,
  LIBELLES_STATUT_PLEIN,
  type DetailPlein,
} from "@/lib/fuel/detail-plein";
import { SectionTicpePlein } from "@/components/ticpe/SectionTicpePlein";

const dateHeure = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "—";
const nb = (n: number | null | undefined, suffixe = "", decimales = 2) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: decimales })}${suffixe}`;
const euros = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));

const CLASSE_STATUT_ECART: Record<StatutEcart, string> = {
  aucun: "badge-neutral",
  ouvert: "badge-orange",
  explication_demandee: "badge-gold",
  reponse_recue: "badge-gold",
  traite: "badge-teal",
};

const LIBELLES_ALERTE: Record<string, string> = {
  totalizer_gap: "Écart de totaliseur",
  price_anomaly: "Prix inhabituel",
  consumption_anomaly: "Consommation anormale",
  ocr_failure: "Échec OCR",
  fuel_gap_explanation: "Écart : échange avec le chauffeur",
};
const LIBELLES_STATUT_ALERTE: Record<string, string> = { open: "ouverte", acknowledged: "vue", resolved: "résolue" };

export function BadgeStatutEcart({ statut }: { statut: StatutEcart }) {
  return <span className={CLASSE_STATUT_ECART[statut]}>{LIBELLES_STATUT_ECART[statut]}</span>;
}

/** Ligne libellé / valeur de la fiche. */
function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-navy/55">{libelle}</dt>
      <dd className="break-words text-sm text-navy">{children}</dd>
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy/60">{titre}</h4>
      {children}
    </section>
  );
}

function valeurCorrection(champ: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (champ === "occurred_at" && typeof v === "string") return dateHeure(v);
  if (champ.endsWith("_photo_path")) return "nouvelle photo";
  if (champ === "tank_id" || champ === "vehicle_id") return "modifié";
  return String(v);
}

/**
 * Fiche complète d'un plein, dépliée sous sa ligne dans l'historique :
 * tout ce qui a été saisi, les photos, l'OCR, la validation, les
 * corrections, et les écarts avec leur traitement (action réservée à
 * l'encadrement ; le chauffeur répond à une demande d'explication).
 */
export function FuelEntryDetail({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [plein, setPlein] = useState<DetailPlein | null>(null);
  const [refus, setRefus] = useState<Refus | null>(null);

  const charger = useCallback(async () => {
    const r = await fetchGodac<{ plein: DetailPlein }>(`/api/fuel-entries/${entryId}/detail`);
    if (r.ok) {
      setPlein(r.data.plein);
      setRefus(null);
    } else setRefus(r.refus);
  }, [entryId]);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (refus && !plein) return <BandeauRefus refus={refus} />;
  if (!plein) return <p className="py-3 text-sm text-navy/60">Chargement de la fiche…</p>;

  const origine = plein.tank_id ? `Cuve ${plein.cuve ?? ""}`.trim() : `Station${plein.station_name ? ` ${plein.station_name}` : ""}`;
  const distribue =
    plein.totalizer_before !== null && plein.totalizer_after !== null ? Math.round((plein.totalizer_after - plein.totalizer_before) * 100) / 100 : null;
  const confiance = plein.ocr_confidence
    ? Object.entries(plein.ocr_confidence)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => `${LIBELLES_CONFIANCE_OCR[k] ?? k} ${Math.round((v as number) * 100)} %`)
        .join(" · ")
    : "";
  const aOcr = Boolean(plein.ticket_total !== null || plein.ticket_carburant || plein.ocr_error || confiance);

  return (
    <div className="rounded-xl bg-navy/[0.03] p-4">
      <Section titre="Saisie">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          <Champ libelle="Date et heure du plein">{dateHeure(plein.occurred_at)}</Champ>
          <Champ libelle="Chauffeur">{plein.chauffeur ?? "—"}</Champ>
          <Champ libelle="Véhicule">{plein.vehicule ?? "—"}</Champ>
          <Champ libelle="Kilométrage">{nb(plein.vehicle_km, " km", 0)}</Champ>
          <Champ libelle="Produit">{plein.product === "adblue" ? "AdBlue" : "Gazole"}</Champ>
          <Champ libelle="Origine">{origine}</Champ>
          <Champ libelle="Litres">{nb(plein.liters, " L")}</Champ>
          <Champ libelle="Prix unitaire">{plein.unit_price === null ? "—" : `${nb(plein.unit_price, " €/L", 4)}`}</Champ>
          <Champ libelle="Montant">{euros(plein.total_amount)}</Champ>
          <Champ libelle="Statut">{LIBELLES_STATUT_PLEIN[plein.status] ?? plein.status}</Champ>
          <Champ libelle="Saisi par">
            {plein.saisi_par ?? "—"} <span className="text-navy/55">le {dateHeure(plein.created_at)}</span>
          </Champ>
          {plein.validated_at && (
            <Champ libelle="Validé par">
              {plein.valide_par ?? "—"} <span className="text-navy/55">le {dateHeure(plein.validated_at)}</span>
            </Champ>
          )}
          {plein.updated_at && plein.updated_at !== plein.created_at && <Champ libelle="Dernière modification">{dateHeure(plein.updated_at)}</Champ>}
        </dl>
      </Section>

      {plein.tank_id && (
        <Section titre="Cuve et totaliseur">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
            <Champ libelle="Totaliseur avant">{nb(plein.totalizer_before)}</Champ>
            <Champ libelle="Totaliseur après">{nb(plein.totalizer_after)}</Champ>
            <Champ libelle="Distribué (totaliseur)">{nb(distribue, " L")}</Champ>
            <Champ libelle="Écart avec le plein précédent">
              {plein.totalizer_gap === null ? "—" : <span className={plein.gap_flagged ? "font-semibold text-orange-ink" : undefined}>{nb(plein.totalizer_gap, " L")}</span>}
            </Champ>
            <Champ libelle="PMP de la cuve au plein">{plein.pmp_at_entry === null ? "—" : nb(plein.pmp_at_entry, " €/L", 4)}</Champ>
          </dl>
        </Section>
      )}

      {aOcr && (
        <Section titre="Lecture OCR du ticket">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Champ libelle="Total lu sur le ticket">{euros(plein.ticket_total)}</Champ>
            <Champ libelle="Carburant lu">{plein.ticket_carburant ?? "—"}</Champ>
            {confiance && <Champ libelle="Confiance">{confiance}</Champ>}
            {plein.ocr_error && <Champ libelle="Erreur OCR"><span className="text-orange-ink">{plein.ocr_error}</span></Champ>}
          </dl>
        </Section>
      )}

      {plein.ticpe && (
        <Section titre="Remboursement TICPE">
          <SectionTicpePlein
            entryId={plein.id}
            ticpe={plein.ticpe}
            onModifie={async () => {
              await charger();
              router.refresh();
            }}
          />
        </Section>
      )}

      <Section titre="Photos">
        {plein.photos.length === 0 ? (
          <p className="text-sm text-navy/60">Aucune photo jointe.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {plein.photos.map((p) => (
              <a key={p.libelle} href={p.url} target="_blank" rel="noreferrer" className="block w-32 text-center text-xs text-navy/70 hover:text-navy">
                <img src={p.url} alt={p.libelle} className="mb-1 h-24 w-32 rounded-lg border border-navy/10 bg-surface object-cover" />
                {p.libelle}
              </a>
            ))}
          </div>
        )}
      </Section>

      <SectionEcarts plein={plein} onTraite={async () => {
        await charger();
        router.refresh();
      }} />

      {plein.alertes.length > 0 && (
        <Section titre="Alertes liées">
          <ul className="flex flex-col gap-1 text-sm">
            {plein.alertes.map((a) => (
              <li key={a.id}>
                <span className="text-navy/55">{dateHeure(a.created_at)}</span> · <span className="font-medium">{LIBELLES_ALERTE[a.type] ?? a.type}</span>
                {a.message ? ` — ${a.message}` : ""} <span className="text-navy/55">({LIBELLES_STATUT_ALERTE[a.status] ?? a.status})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plein.corrections && plein.corrections.length > 0 && (
        <Section titre="Corrections du plein">
          <ul className="flex flex-col gap-1 text-sm">
            {plein.corrections.map((c) => (
              <li key={c.id}>
                <span className="text-navy/55">{dateHeure(c.created_at)}</span> · {c.auteur ?? "—"}
                {c.details && Object.keys(c.details).length > 0 && (
                  <span className="text-navy/70">
                    {" — "}
                    {decrireModification(c.details, (k) => LIBELLES_CHAMPS_PLEIN[k] ?? k, valeurCorrection)}
                    {typeof c.details.periode_declaree === "string" && <span className="text-orange-ink"> · période TICPE déjà déclarée ({c.details.periode_declaree}) : à régulariser</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Écarts détectés, journal de traitement et action. */
function SectionEcarts({ plein, onTraite }: { plein: DetailPlein; onTraite: () => Promise<void> }) {
  if (plein.statutEcart === "aucun" && plein.traitements.length === 0) {
    return (
      <Section titre="Écarts">
        <p className="text-sm text-navy/60">Aucun écart détecté sur ce plein.</p>
      </Section>
    );
  }
  return (
    <Section titre="Écarts">
      <div className="mb-2">
        <BadgeStatutEcart statut={plein.statutEcart} />
      </div>
      {plein.ecarts.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {plein.ecarts.map((e) => (
            <li key={e.code}>
              <span className="font-medium text-orange-ink">{e.libelle}</span> — {e.detail}
            </li>
          ))}
        </ul>
      )}
      {plein.traitements.length > 0 && (
        <ol className="mb-3 flex flex-col gap-2 border-l-2 border-navy/10 pl-3 text-sm">
          {plein.traitements.map((t) => (
            <li key={t.id}>
              <p className="text-xs text-navy/55">
                {dateHeure(t.created_at)} · {t.auteur ?? "—"} · {LIBELLES_ACTION_ECART[t.action as ActionEcart] ?? t.action}
              </p>
              <p className="whitespace-pre-wrap">{t.commentaire}</p>
            </li>
          ))}
        </ol>
      )}
      {!plein.traitementDisponible && (
        <p className="text-xs text-navy/55">Le traitement des écarts sera disponible après la prochaine mise à jour de la base.</p>
      )}
      {plein.droits.mention && (
        <p className="mb-2 rounded-lg bg-navy/5 px-3 py-2 text-xs text-navy/70" data-testid="mention-hierarchie">
          {plein.droits.mention} : vous ne pouvez pas traiter cet écart.
        </p>
      )}
      {(plein.droits.traiter || plein.droits.repondre) && <TraitementEcartForm entryId={plein.id} droits={plein.droits} onTraite={onTraite} />}
    </Section>
  );
}

function TraitementEcartForm({
  entryId,
  droits,
  onTraite,
}: {
  entryId: string;
  droits: DetailPlein["droits"];
  onTraite: () => Promise<void>;
}) {
  const actions: ActionEcart[] = droits.traiter ? ["traite", "explication_demandee"] : ["reponse_chauffeur"];
  const [action, setAction] = useState<ActionEcart | null>(droits.traiter ? null : "reponse_chauffeur");
  const [commentaire, setCommentaire] = useState("");
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);

  async function envoyer() {
    if (!action || !commentaireValide(commentaire)) return;
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac(`/api/fuel-entries/${entryId}/ecart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, commentaire: commentaire.trim() }),
    });
    setBusy(false);
    if (!r.ok) {
      setRefus(r.refus);
      return;
    }
    setCommentaire("");
    setAction(droits.traiter ? null : "reponse_chauffeur");
    await onTraite();
  }

  const libelleBouton: Record<ActionEcart, string> = {
    traite: "Justifier / classer",
    explication_demandee: "Demander une explication au chauffeur",
    reponse_chauffeur: "Répondre",
  };
  const aide: Record<ActionEcart, string> = {
    traite: "Justification (obligatoire) : jauge recalée, plein oublié retrouvé, erreur de saisie… L'écart passe à « traité » et ses alertes sont soldées.",
    explication_demandee: "Question au chauffeur (obligatoire) : il reçoit une alerte et peut répondre depuis ce plein.",
    reponse_chauffeur: "Votre explication sur cet écart (obligatoire) : l'encadrement est prévenu.",
  };

  return (
    <div className="rounded-lg border border-navy/10 bg-surface p-3">
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      {actions.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={action === a ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-secondary !px-3 !py-1.5 text-sm"}
              aria-pressed={action === a}
              onClick={() => setAction(a)}
            >
              {libelleBouton[a]}
            </button>
          ))}
        </div>
      )}
      {action && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void envoyer();
          }}
        >
          <label className="block">
            <span className="label">{actions.length > 1 ? "Commentaire" : "Votre réponse"} *</span>
            <textarea
              className="input min-h-[80px]"
              value={commentaire}
              maxLength={COMMENTAIRE_MAX}
              required
              onChange={(ev) => setCommentaire(ev.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-navy/55">{aide[action]}</p>
          <div className="mt-2 flex gap-2">
            <button type="submit" className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy || !commentaireValide(commentaire)}>
              {busy ? "Enregistrement…" : libelleBouton[action]}
            </button>
            {actions.length > 1 && (
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => setAction(null)} disabled={busy}>
                Annuler
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
