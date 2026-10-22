"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { LIBELLES_ACOMPTE, montantAcompte, moisDe, moisLisible, type DemandeAcompte, type StatutAcompte } from "@/lib/paie/acomptes";
import { confirmer } from "@/lib/ui/confirmation";

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "");

async function envoyer(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible");
  return json as { avertissement?: string | null };
}

const STYLE: Record<StatutAcompte, string> = {
  en_attente: "bg-gold/25 text-navy",
  acceptee: "bg-teal/15 text-teal-ink",
  versee: "bg-teal/25 text-teal-ink",
  refusee: "bg-orange/15 text-orange-ink",
  annulee: "bg-navy/10 text-navy/60",
};

export function BadgeAcompte({ statut }: { statut: StatutAcompte }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[statut]}`}>{LIBELLES_ACOMPTE[statut]}</span>;
}

/** Mon espace › Demander un acompte : formulaire et historique. */
export function MesAcomptes({ demandes, plafond, mois }: { demandes: DemandeAcompte[]; plafond: number | null; mois: string }) {
  const router = useRouter();
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const enAttente = demandes.some((d) => d.status === "en_attente" && moisDe(d.period) === mois);
  const valeur = Number(montant.replace(",", "."));

  async function demander() {
    setBusy(true);
    setMessage(null);
    try {
      const json = await envoyer("/api/paie/acomptes", "POST", { montant: valeur, motif: motif.trim() || null });
      setMontant("");
      setMotif("");
      setMessage({ ok: true, text: `Demande envoyée à la direction.${json.avertissement ? ` ${json.avertissement}` : ""}` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function annuler(id: string) {
    if (!(await confirmer({ titre: "Annuler cette demande d'acompte ?", message: "", action: "Oui, annuler", annuler: "Non", danger: true }))) return;
    setBusy(true);
    setMessage(null);
    try {
      await envoyer(`/api/paie/acomptes/${id}`, "PATCH", { action: "annuler" });
      setMessage({ ok: true, text: "Demande annulée." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex max-w-xl flex-col gap-3">
        <h2 className="text-lg">Nouvelle demande · {moisLisible(mois)}</h2>
        <p className="text-sm text-navy/70">
          {plafond !== null
            ? `Plafond indicatif : ${eur(plafond)} €. Au-delà, la direction décide au cas par cas.`
            : "Pas encore de plafond calculé (aucun bulletin validé) : la direction décide au cas par cas."}{" "}
          L&apos;acompte accepté est déduit de votre bulletin du mois.
        </p>
        {enAttente ? (
          <p className="rounded-lg bg-gold/20 px-3 py-2 text-sm">Une demande est déjà en attente ce mois-ci. Vous pouvez l&apos;annuler ci-dessous.</p>
        ) : (
          <>
            <label className="block">
              <span className="label">Montant demandé</span>
              <span className="relative block">
                <input className="input pr-10 tabular-nums" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="Ex. 300" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-navy/50">€</span>
              </span>
              {plafond !== null && valeur > plafond && <span className="mt-1 block text-xs text-orange-ink">Au-delà du plafond indicatif.</span>}
            </label>
            <label className="block">
              <span className="label">Motif (facultatif)</span>
              <textarea className="input min-h-[4rem]" value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={500} />
            </label>
            <button type="button" className="btn-primary w-fit" disabled={busy || !(valeur > 0)} onClick={demander}>
              {busy ? "Envoi…" : "Demander l'acompte"}
            </button>
          </>
        )}
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
            {message.text}
          </p>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">Mes demandes</h2>
        {demandes.length === 0 ? (
          <p className="text-sm text-navy/60">Aucune demande pour le moment.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {demandes.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{eur(d.status === "acceptee" || d.status === "versee" ? montantAcompte(d) : d.amount_requested)} €</span>
                      <BadgeAcompte statut={d.status} />
                      <span className="text-navy/60">demandé le {date(d.created_at)}</span>
                    </span>
                    {(d.status === "acceptee" || d.status === "versee") && d.amount_granted !== null && d.amount_granted !== d.amount_requested && (
                      <span className="text-navy/70">Demandé : {eur(d.amount_requested)} €</span>
                    )}
                    {d.paid_at && (d.status === "acceptee" || d.status === "versee") && (
                      <span className="text-navy/70">{d.status === "versee" ? "Versé le" : "Versement prévu le"} {date(d.paid_at)}</span>
                    )}
                    {(d.status === "acceptee" || d.status === "versee") && <span className="text-navy/60">Déduit du bulletin de {moisLisible(moisDe(d.period))}{d.original_period ? " (reporté : bulletin du mois déjà validé)" : ""}</span>}
                    {d.reason && <span className="text-navy/60">Motif : {d.reason}</span>}
                    {d.status === "refusee" && d.decision_comment && <span className="text-orange-ink">Motif du refus : {d.decision_comment}</span>}
                  </div>
                  {d.status === "en_attente" && (
                    <button type="button" className="btn-ghost !px-2 !py-1 text-sm text-orange-ink" disabled={busy} onClick={() => annuler(d.id)}>
                      Annuler
                    </button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export type DemandeAvecNom = DemandeAcompte & { nom: string };

function LigneGestion({ d, direction, plafond }: { d: DemandeAvecNom; direction: boolean; plafond: number | null }) {
  const router = useRouter();
  const [montant, setMontant] = useState(String(d.amount_granted ?? d.amount_requested));
  const [dateVersement, setDateVersement] = useState(d.paid_at ?? new Date().toISOString().slice(0, 10));
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const valeur = Number(montant.replace(",", "."));

  async function agir(action: "preparer" | "accepter" | "refuser" | "verser" | "annuler", texteOk: string) {
    setBusy(true);
    setMessage(null);
    try {
      const json = await envoyer(`/api/paie/acomptes/${d.id}`, "PATCH", {
        action,
        montant: action === "preparer" || action === "accepter" ? valeur : undefined,
        date_versement: action === "refuser" || action === "annuler" ? undefined : dateVersement || null,
        commentaire: action === "refuser" ? commentaire : undefined,
      });
      setMessage({ ok: true, text: `${texteOk}${json.avertissement ? ` ${json.avertissement}` : ""}` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{d.nom}</span>
          <BadgeAcompte statut={d.status} />
          <span className="text-sm text-navy/60">
            {moisLisible(moisDe(d.period))} · demandé le {date(d.created_at)}
          </span>
        </span>
        <span className="tabular-nums">
          {eur(d.amount_requested)} € demandés
          {plafond !== null && d.amount_requested > plafond && <span className="ml-1 text-xs text-orange-ink">(plafond indicatif {eur(plafond)} €)</span>}
        </span>
      </div>
      {d.reason && <p className="text-sm text-navy/70">Motif : {d.reason}</p>}
      {(d.status === "acceptee" || d.status === "versee") && (
        <p className="text-sm text-navy/70">
          Accordé : {eur(montantAcompte(d))} €{d.paid_at ? ` · ${d.status === "versee" ? "versé le" : "versement prévu le"} ${date(d.paid_at)}` : ""} ·{" "}
          {d.payslip_id ? "déduit du bulletin" : `à déduire du bulletin de ${moisLisible(moisDe(d.period))}`}
          {d.original_period ? ` (reporté de ${moisLisible(moisDe(d.original_period))})` : ""}
        </p>
      )}
      {d.status === "refusee" && d.decision_comment && <p className="text-sm text-orange-ink">Motif du refus : {d.decision_comment}</p>}

      {d.status === "en_attente" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block w-36">
              <span className="label">Montant accordé</span>
              <input className="input !py-1.5 tabular-nums" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Date de versement</span>
              <input className="input !py-1.5" type="date" value={dateVersement} onChange={(e) => setDateVersement(e.target.value)} />
            </label>
            {direction ? (
              <>
                <button type="button" className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy || !(valeur > 0)} onClick={() => agir("accepter", "Acompte accepté, le salarié est prévenu.")}>
                  Accepter
                </button>
                <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy} onClick={() => setRefusOuvert((o) => !o)}>
                  Refuser
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy || !(valeur > 0)} onClick={() => agir("preparer", "Préparé : la direction n'a plus qu'à accepter.")}>
                Préparer pour la direction
              </button>
            )}
          </div>
          {d.amount_granted !== null && <p className="text-xs text-navy/60">Préparé : {eur(d.amount_granted)} €{d.paid_at ? ` le ${date(d.paid_at)}` : ""}.</p>}
          {refusOuvert && (
            <div className="flex flex-col gap-2">
              <label className="block">
                <span className="label">Motif du refus (transmis au salarié)</span>
                <textarea className="input min-h-[4rem]" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={2000} />
              </label>
              <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" disabled={busy || !commentaire.trim()} onClick={() => agir("refuser", "Demande refusée, le salarié est prévenu.")}>
                Confirmer le refus
              </button>
            </div>
          )}
        </div>
      )}

      {d.status === "acceptee" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Versé le</span>
            <input className="input !py-1.5" type="date" value={dateVersement} onChange={(e) => setDateVersement(e.target.value)} />
          </label>
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy} onClick={() => agir("verser", "Acompte marqué versé.")}>
            Marquer versé
          </button>
          {direction && !d.payslip_id && (
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-sm text-orange-ink"
              disabled={busy}
              onClick={async () => (await confirmer({ titre: "Annuler cet acompte accepté ?", message: "Il ne sera pas déduit du bulletin.", action: "Oui, annuler", annuler: "Non", danger: true })) && agir("annuler", "Acompte annulé.")}
            >
              Annuler l&apos;acompte
            </button>
          )}
        </div>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}

/** Équipe › Paie › Acomptes : demandes à traiter, puis historique. */
export function GestionAcomptes({ demandes, direction, plafonds }: { demandes: DemandeAvecNom[]; direction: boolean; plafonds: Record<string, number | null> }) {
  const aTraiter = demandes.filter((d) => d.status === "en_attente" || d.status === "acceptee");
  const historique = demandes.filter((d) => !(d.status === "en_attente" || d.status === "acceptee"));
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg">À traiter</h2>
        {!direction && <p className="text-xs text-navy/60">Vous pouvez préparer le montant et la date ; seule la direction accepte ou refuse.</p>}
        {aTraiter.length === 0 ? (
          <p className="text-sm text-navy/60">Aucune demande en cours.</p>
        ) : (
          aTraiter.map((d) => <LigneGestion key={`${d.id}-${d.status}-${d.amount_granted}-${d.paid_at}`} d={d} direction={direction} plafond={plafonds[d.user_id] ?? null} />)
        )}
      </section>
      {historique.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">Historique</h2>
          {historique.map((d) => (
            <LigneGestion key={d.id} d={d} direction={direction} plafond={plafonds[d.user_id] ?? null} />
          ))}
        </section>
      )}
    </div>
  );
}

/** Réglage du plafond indicatif (direction). */
export function ReglagePlafondAcompte({ pourcentage, montantFixe }: { pourcentage: number; montantFixe: number | null }) {
  const router = useRouter();
  const [pct, setPct] = useState(String(pourcentage));
  const [fixe, setFixe] = useState(montantFixe ? String(montantFixe) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function enregistrer() {
    setBusy(true);
    setMessage(null);
    try {
      await envoyer("/api/paie/acomptes/reglage", "PUT", { pourcentage: Number(pct.replace(",", ".")) || 0, montant_fixe: fixe.trim() ? Number(fixe.replace(",", ".")) : null });
      setMessage({ ok: true, text: "Plafond enregistré." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg">Plafond indicatif</h2>
      <p className="text-sm text-navy/70">
        Montré au salarié quand il demande un acompte. Un montant fixe s&apos;il est renseigné, sinon un pourcentage du net habituel (net avant retenues
        du dernier bulletin validé). Le plafond n&apos;empêche pas la demande : vous décidez.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-40">
          <span className="label">% du net habituel</span>
          <input className="input tabular-nums" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
        </label>
        <label className="block w-44">
          <span className="label">ou montant fixe (€)</span>
          <input className="input tabular-nums" inputMode="decimal" value={fixe} onChange={(e) => setFixe(e.target.value)} placeholder="Vide = pourcentage" />
        </label>
        <button type="button" className="btn-secondary" disabled={busy} onClick={enregistrer}>
          Enregistrer
        </button>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}
