"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { LIBELLES_STATUT_INVITATION, statutInvitation, VALIDITE_INVITATION_JOURS, type StatutInvitation } from "@/lib/go-navigation/offre";
import { confirmer } from "@/lib/ui/confirmation";

export interface LigneInvitationStaff {
  id: string;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  usedAt: string | null;
  revokedAt: string | null;
  organizationId: string | null;
  organizationName: string | null;
}

const BADGE: Record<StatutInvitation, string> = { envoyee: "badge-teal", utilisee: "badge-teal", expiree: "badge-gold", revoquee: "badge-gold" };
const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/** Création d'un lien (affiché une seule fois, bouton copier) et liste des invitations avec révocation. */
export function InvitationsGoNavigation({ invitations }: { invitations: LigneInvitationStaff[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [lien, setLien] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    setBusy("creer");
    setErreur(null);
    setCopie(false);
    const r = await fetchGodac<{ chemin: string }>("/api/godac-staff/go-navigation/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setBusy(null);
    if (!r.ok) return setErreur(r.refus.message);
    setLien(`${window.location.origin}${r.data.chemin}`);
    setNote("");
    router.refresh();
  }

  async function copier() {
    if (!lien) return;
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(true);
    } catch {
      setErreur("Copie impossible : sélectionnez le lien et copiez-le à la main.");
    }
  }

  async function revoquer(id: string) {
    if (!(await confirmer({ titre: "Révoquer ce lien ?", message: "Il ne pourra plus servir à s'inscrire.", action: "Révoquer", danger: true }))) return;
    setBusy(id);
    setErreur(null);
    const r = await fetchGodac(`/api/godac-staff/go-navigation/invitations/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return setErreur(r.refus.message);
    router.refresh();
  }

  const maintenant = new Date();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-1 text-lg">Nouveau lien d&apos;invitation</h2>
        <p className="mb-3 text-sm text-navy/65">
          Usage unique, valable {VALIDITE_INVITATION_JOURS} jours. Le lien complet n&apos;est affiché qu&apos;une fois : copiez-le avant de quitter la page.
        </p>
        <form onSubmit={creer} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            aria-label="Note"
            placeholder="Note (ex. pour Jean, Transports X)"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={busy === "creer"}>
            {busy === "creer" ? "Création…" : "Générer le lien"}
          </button>
        </form>
        {lien && (
          <div className="mt-3 rounded-lg border border-teal/40 bg-teal/5 p-3">
            <p className="mb-2 text-xs font-semibold text-navy/70">Lien à transmettre (ne sera plus affiché) :</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input font-mono text-xs" readOnly value={lien} onFocus={(e) => e.currentTarget.select()} aria-label="Lien d'invitation" />
              <button type="button" className="btn-secondary shrink-0" onClick={copier}>
                {copie ? "Copié" : "Copier"}
              </button>
            </div>
          </div>
        )}
        {erreur && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {erreur}
          </p>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="mb-2 text-lg">Invitations</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-navy/60">Aucune invitation pour l&apos;instant.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Créée le</th>
                <th className="pb-2">Note</th>
                <th className="pb-2">Statut</th>
                <th className="pb-2">Expire le</th>
                <th className="pb-2">Compte créé</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => {
                const statut = statutInvitation({ expires_at: i.expiresAt, used_at: i.usedAt, revoked_at: i.revokedAt }, maintenant);
                return (
                  <tr key={i.id} className="border-t border-navy/5 align-top">
                    <td className="py-2">
                      {date(i.createdAt)}
                      <span className="block text-xs text-navy/55">{i.createdBy}</span>
                    </td>
                    <td className="py-2">{i.note ?? "—"}</td>
                    <td className="py-2">
                      <span className={BADGE[statut]}>{LIBELLES_STATUT_INVITATION[statut]}</span>
                      {i.usedAt && <span className="block text-xs text-navy/55">{date(i.usedAt)}</span>}
                    </td>
                    <td className="py-2">{date(i.expiresAt)}</td>
                    <td className="py-2">
                      {i.organizationId ? (
                        <Link href={`/godac-staff/${i.organizationId}`} className="text-teal-ink hover:underline">
                          {i.organizationName ?? "Organisation"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {statut === "envoyee" && (
                        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={busy === i.id} onClick={() => revoquer(i.id)}>
                          {busy === i.id ? "Révocation…" : "Révoquer"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
