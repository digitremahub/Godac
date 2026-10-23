"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card, StatTile } from "@/components/ui";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
import { ROLE_LABELS } from "@/lib/roles/labels";
import type { UserRole } from "@/lib/types/domain";
import {
  LIBELLES_STATUT_INVITE,
  LIBELLES_STATUT_LIEN,
  MAX_CREATIONS_PAR_JOUR,
  lienSms,
  lienWhatsapp,
  messagePartage,
  type StatutInvite,
} from "@/lib/partage-go/apporteur";
import { VALIDITE_INVITATION_JOURS } from "@/lib/go-navigation/offre";
import type { MembreDroit, VuePartageGo } from "@/lib/partage-go/donnees";

const BADGE: Record<StatutInvite, string> = {
  envoyee: "badge-neutral",
  essai_en_cours: "badge-teal",
  essai_termine: "badge-gold",
  abonnee: "badge-teal",
  expiree: "badge-gold",
  revoquee: "badge-gold",
};
const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

/** Boutons de partage d'un lien : copier, SMS, WhatsApp. */
function Partager({ url, prenom }: { url: string; prenom: string | null }) {
  const [copie, setCopie] = useState(false);
  const message = messagePartage(url, prenom);
  async function copier() {
    try {
      await navigator.clipboard.writeText(url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      /* copie refusée : le lien reste sélectionnable dans le champ */
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Lien à partager" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={copier}>
          {copie ? "Copié" : "Copier le lien"}
        </button>
        <a className="btn-secondary !px-3 !py-1.5 text-sm" href={lienSms(message)}>
          Envoyer par SMS
        </a>
        <a className="btn-secondary !px-3 !py-1.5 text-sm" href={lienWhatsapp(message)} target="_blank" rel="noopener noreferrer">
          Envoyer par WhatsApp
        </a>
      </div>
    </div>
  );
}

function Qr({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, url, { width: 160, margin: 1 });
  }, [url]);
  return <canvas ref={ref} role="img" aria-label="QR code de votre lien personnel" className="rounded-lg border border-navy/10" />;
}

export function PartageGo({ vue, prenom }: { vue: VuePartageGo; prenom: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Lien à usage unique : affiché une seule fois, à la création.
  const [nouveau, setNouveau] = useState<string | null>(null);

  const origine = typeof window !== "undefined" ? window.location.origin : "";

  async function action<T>(cle: string, url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false }> {
    setBusy(cle);
    setErreur(null);
    const r = await fetchGodac<T>(url, init);
    setBusy(null);
    if (!r.ok) {
      setErreur(r.refus.message);
      return { ok: false };
    }
    router.refresh();
    return { ok: true, data: r.data };
  }

  async function regenerer() {
    if (vue.lien && !(await confirmer({ titre: "Régénérer votre lien ?", message: "L'ancien lien ne fonctionnera plus. Les comptes déjà créés restent à votre nom.", action: "Régénérer" }))) return;
    await action("lien", "/api/partage-go/lien", { method: "POST" });
  }

  async function revoquerLien() {
    if (!(await confirmer({ titre: "Révoquer votre lien ?", message: "Il ne pourra plus servir à s'inscrire. Les comptes déjà créés restent à votre nom.", action: "Révoquer", danger: true }))) return;
    await action("lien", "/api/partage-go/lien", { method: "DELETE" });
  }

  async function inviter(e: React.FormEvent) {
    e.preventDefault();
    const r = await action<{ chemin: string }>("inviter", "/api/partage-go/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (r.ok) {
      setNouveau(`${origine}${r.data.chemin}`);
      setNote("");
    }
  }

  async function revoquerInvitation(id: string) {
    if (!(await confirmer({ titre: "Révoquer cette invitation ?", message: "Elle ne pourra plus servir à s'inscrire.", action: "Révoquer", danger: true }))) return;
    await action(id, `/api/partage-go/invitations/${id}`, { method: "DELETE" });
  }

  const lien = vue.lien;
  const urlLien = lien?.chemin ? `${origine}${lien.chemin}` : null;

  return (
    <div className="flex flex-col gap-6">
      {erreur && (
        <p role="alert" className="text-sm text-orange-ink">
          {erreur}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">Mon lien personnel</h2>
          <p className="text-sm text-navy/65">Un seul lien à partager à plusieurs personnes : chaque inscription vous est attribuée.</p>
        </div>
        {lien ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={lien.statut === "actif" ? "badge-teal" : "badge-gold"}>{LIBELLES_STATUT_LIEN[lien.statut]}</span>
              <span className="text-navy/65">
                {lien.inscrits} inscrit{lien.inscrits > 1 ? "s" : ""} sur {lien.maxInscriptions} · valable jusqu&apos;au {date(lien.expiresAt)}
              </span>
            </div>
            {urlLien ? (
              <div className="flex flex-wrap items-start gap-4">
                <Qr url={urlLien} />
                <div className="min-w-[240px] flex-1">
                  <Partager url={urlLien} prenom={prenom} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-navy/70">Ce lien ne peut plus être affiché : régénérez-le pour en obtenir un nouveau.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy === "lien"} onClick={regenerer}>
                Régénérer
              </button>
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm text-orange-ink" disabled={busy === "lien"} onClick={revoquerLien}>
                Révoquer
              </button>
            </div>
          </>
        ) : (
          <div>
            <button type="button" className="btn-primary" disabled={busy === "lien"} onClick={regenerer}>
              {busy === "lien" ? "Création…" : "Créer mon lien"}
            </button>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">Inviter une personne</h2>
          <p className="text-sm text-navy/65">
            Lien à usage unique, valable {VALIDITE_INVITATION_JOURS} jours, avec une note pour vous y retrouver. Il n&apos;est affiché qu&apos;une fois. Limite : {MAX_CREATIONS_PAR_JOUR} liens ou invitations par jour.
          </p>
        </div>
        <form onSubmit={inviter} className="flex flex-col gap-2 sm:flex-row">
          <input className="input" aria-label="Note" placeholder="Note (ex. Jean, Transports X)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn-primary shrink-0" disabled={busy === "inviter"}>
            {busy === "inviter" ? "Création…" : "Générer l'invitation"}
          </button>
        </form>
        {nouveau && (
          <div className="rounded-lg border border-teal/40 bg-teal/5 p-3">
            <p className="mb-2 text-xs font-semibold text-navy/70">Invitation à transmettre (ne sera plus affichée) :</p>
            <Partager url={nouveau} prenom={prenom} />
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="mb-2 text-lg">Mes invités</h2>
        {vue.invites.length === 0 ? (
          <p className="text-sm text-navy/60">Personne n&apos;a encore été invité.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Origine</th>
                <th className="pb-2">Entreprise d&apos;essai</th>
                <th className="pb-2">Statut</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {vue.invites.map((i) => (
                <tr key={i.id} className="border-t border-navy/5 align-top">
                  <td className="py-2">{date(i.creeLe)}</td>
                  <td className="py-2">{i.type === "lien" ? "Mon lien personnel" : (i.note ?? "Invitation")}</td>
                  <td className="py-2">{i.organisation ?? "—"}</td>
                  <td className="py-2">
                    <span className={BADGE[i.statut]}>{LIBELLES_STATUT_INVITE[i.statut]}</span>
                  </td>
                  <td className="py-2 text-right">
                    {i.revocable && (
                      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={busy === i.id} onClick={() => revoquerInvitation(i.id)}>
                        Révoquer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {vue.organisation && (
        <section className="flex flex-col gap-3" aria-label="Vue de l'organisation">
          <h2 className="text-lg">Toute l&apos;organisation</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Inscrits" value={String(vue.organisation.total.inscrits)} />
            <StatTile label="Essais en cours" value={String(vue.organisation.total.essaisEnCours)} accent="gold" />
            <StatTile label="Essais terminés" value={String(vue.organisation.total.essaisTermines)} accent="orange" />
            <StatTile label="Passés clients" value={String(vue.organisation.total.abonnes)} />
          </div>
          <Card className="overflow-x-auto">
            {vue.organisation.parApporteur.length === 0 ? (
              <p className="text-sm text-navy/60">Aucun compte d&apos;essai créé pour l&apos;instant.</p>
            ) : (
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-navy/60">
                  <tr>
                    <th className="pb-2">Apporteur</th>
                    <th className="pb-2">Inscrits</th>
                    <th className="pb-2">Essais en cours</th>
                    <th className="pb-2">Passés clients</th>
                  </tr>
                </thead>
                <tbody>
                  {vue.organisation.parApporteur.map((a) => (
                    <tr key={a.cle} className="border-t border-navy/5">
                      <td className="py-2">{a.nom}</td>
                      <td className="py-2">{a.inscrits}</td>
                      <td className="py-2">{a.essaisEnCours}</td>
                      <td className="py-2">{a.abonnes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      )}

      {vue.droits && <DroitsPartage tous={vue.droits.tous} membres={vue.droits.membres} />}
    </div>
  );
}

/** Direction : « Faire essayer GO » pour des personnes désignées ou pour toute l'équipe. */
function DroitsPartage({ tous, membres }: { tous: boolean; membres: MembreDroit[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(cle: string, corps: Record<string, unknown>) {
    setBusy(cle);
    setErreur(null);
    const r = await fetchGodac("/api/partage-go/droits", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    setBusy(null);
    if (!r.ok) setErreur(r.refus.message);
    else router.refresh();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg">Qui peut faire essayer GO ?</h2>
        <p className="text-sm text-navy/65">La direction le peut toujours. Ouvrez-le à des personnes de votre choix, ou à toute l&apos;équipe.</p>
      </div>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-teal" checked={tous} disabled={busy === "tous"} onChange={(e) => void envoyer("tous", { tous: e.target.checked })} />
        <span>
          <span className="font-medium text-navy">Tous les membres peuvent faire essayer GO</span>
          <span className="block text-navy/65">Chaque membre dispose de son propre lien, vous voyez qui a partagé.</span>
        </span>
      </label>
      {!tous && (
        <div className="flex flex-col gap-1 border-t border-navy/5 pt-3">
          <p className="text-xs font-semibold text-navy/60">Personnes désignées</p>
          {membres.length === 0 ? (
            <p className="text-sm text-navy/60">Aucun autre membre.</p>
          ) : (
            membres.map((m) => (
              <label key={m.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-teal" checked={m.autorise} disabled={busy === m.id} onChange={(e) => void envoyer(m.id, { userId: m.id, autorise: e.target.checked })} />
                <span className="text-navy">
                  {m.nom} <span className="text-navy/55">· {ROLE_LABELS[m.role as UserRole] ?? m.role}</span>
                </span>
              </label>
            ))
          )}
        </div>
      )}
      {erreur && (
        <p role="alert" className="text-sm text-orange-ink">
          {erreur}
        </p>
      )}
    </Card>
  );
}
