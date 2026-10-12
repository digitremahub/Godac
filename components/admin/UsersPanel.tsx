"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { ROLE_LABELS } from "@/lib/roles/labels";
import type { UserRole } from "@/lib/types/domain";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  role_title: string | null;
  active: boolean;
  service_id: string | null;
  auth_method: "email" | "pin";
  pin_set_at: string | null;
}

const PIN_DRIVER_ROLES: UserRole[] = ["chauffeur", "manager_chauffeur"];
interface ServiceOption {
  id: string;
  name: string;
}

const ROLES: UserRole[] = ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"];

/** API routes return either a plain string (thrown Error) or a zod .flatten() object — never {message}. */
function apiErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const flat = error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const messages = [...(flat.formErrors ?? []), ...Object.values(flat.fieldErrors ?? {}).flat()];
    if (messages.length > 0) return messages.join(" ");
  }
  return "Erreur";
}

export function UsersPanel({ users, services }: { users: UserRow[]; services: ServiceOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "pin">("email");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("chauffeur");
  const [roleTitle, setRoleTitle] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [newBadge, setNewBadge] = useState<{ id: string; fullName: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRoleTitle, setEditRoleTitle] = useState("");
  const [editServiceId, setEditServiceId] = useState("");

  async function invite() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName || undefined,
          phone: phone || undefined,
          role,
          role_title: roleTitle || undefined,
          service_id: serviceId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      setSent(true);
      setEmail("");
      setFullName("");
      setPhone("");
      setRoleTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function createPinDriver() {
    setBusy(true);
    setError(null);
    setSent(false);
    setNewBadge(null);
    try {
      const res = await fetch("/api/admin/create-pin-driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          phone: phone || undefined,
          role,
          role_title: roleTitle || undefined,
          service_id: serviceId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      setNewBadge({ id: json.id, fullName });
      setFullName("");
      setPhone("");
      setRoleTitle("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(user: UserRow) {
    if (!window.confirm(`Réinitialiser le code PIN de ${user.full_name} ? Il devra en créer un nouveau à sa prochaine connexion.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset_pin: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, newRole: UserRole) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: UserRow) {
    if (user.active && !window.confirm(`Désactiver ${user.full_name} ? Son compte ne pourra plus se connecter.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(user: UserRow) {
    setEditingId(user.id);
    setEditName(user.full_name);
    setEditPhone(user.phone ?? "");
    setEditRoleTitle(user.role_title ?? "");
    setEditServiceId(user.service_id ?? "");
    setError(null);
  }

  async function saveEdit(userId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: editName,
          phone: editPhone || null,
          role_title: editRoleTitle || null,
          service_id: editServiceId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  const roleOptions = mode === "pin" ? PIN_DRIVER_ROLES : ROLES;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            className={mode === "email" ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"}
            onClick={() => {
              setMode("email");
              setError(null);
              setRole("chauffeur");
            }}
          >
            Inviter par email
          </button>
          <button
            className={mode === "pin" ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"}
            onClick={() => {
              setMode("pin");
              setError(null);
              setRole("chauffeur");
            }}
          >
            Chauffeur sans email (badge + PIN)
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
          <div className="flex-1">
            <label className="block"><span className="label">Nom</span>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
          </div>
          {mode === "email" && (
            <div className="flex-1">
              <label className="block"><span className="label">Email</span>
              <input className="input" type="email" autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            </div>
          )}
          <div className="flex-1">
            <label className="block"><span className="label">Téléphone (optionnel)</span>
            <input
              className="input"
              type="tel"
              placeholder="ex: 06 12 34 56 78"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            /></label>
          </div>
          <div>
            <label className="block"><span className="label">Rôle (permissions)</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select></label>
          </div>
          <div className="flex-1">
            <label className="block"><span className="label">Titre affiché (optionnel)</span>
            <input
              className="input"
              placeholder="ex: Chef de dépôt"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
            /></label>
          </div>
          <div>
            <label className="block"><span className="label">Service</span>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Aucun</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select></label>
          </div>
          {mode === "email" ? (
            <button className="btn-primary shrink-0" disabled={busy || !email} onClick={invite}>
              Inviter
            </button>
          ) : (
            <button className="btn-primary shrink-0" disabled={busy || !fullName} onClick={createPinDriver}>
              Créer la fiche et le badge
            </button>
          )}
        </div>
        <p className="text-xs text-navy/60">
          {mode === "email"
            ? "Le titre affiché est libre (ex: \"Chef de dépôt\", \"Assistante RH\") — c'est le rôle choisi ci-dessus qui détermine les permissions réelles dans GODAC."
            : "Aucun email n'est envoyé : imprimez le badge QR affiché après la création et remettez-le au chauffeur. Il scanne son badge pour créer son propre code PIN à la première connexion."}
        </p>
      </Card>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {sent && <p role="status" className="text-sm text-teal-ink">Invitation envoyée par email.</p>}

      {newBadge && (
        <Card className="flex flex-col items-center gap-3">
          <p className="text-sm text-navy/70">
            Fiche créée pour <strong>{newBadge.fullName}</strong> — imprimez ce badge et remettez-le lui. Il le
            scanne pour créer son code PIN et se connecter.
          </p>
          <QrCodeBadge type="driver" id={newBadge.id} title={newBadge.fullName} subtitle="Scannez pour créer votre code PIN" />
          <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setNewBadge(null)}>
            Fermer
          </button>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-navy/60">
            <tr>
              <th className="pb-2">Nom</th>
              <th className="pb-2">Titre</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Téléphone</th>
              <th className="pb-2">Service</th>
              <th className="pb-2">Rôle (permissions)</th>
              <th className="pb-2">Statut</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isEditing = editingId === u.id;
              return (
                <tr key={u.id} className="border-t border-navy/5">
                  <td className="py-2">
                    {isEditing ? (
                      <input aria-label="Nom" className="input !py-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    ) : (
                      <Link href={`/admin/users/${u.id}`} className="text-teal-ink hover:underline">
                        {u.full_name}
                      </Link>
                    )}
                  </td>
                  <td className="py-2 text-navy/70">
                    {isEditing ? (
                      <input aria-label="Titre affiché"
                        className="input !py-1"
                        placeholder="ex: Chef de dépôt"
                        value={editRoleTitle}
                        onChange={(e) => setEditRoleTitle(e.target.value)}
                      />
                    ) : (
                      u.role_title ?? "—"
                    )}
                  </td>
                  <td className="py-2">
                    {u.auth_method === "pin" ? (
                      <span className="badge-neutral">{u.pin_set_at ? "Badge + PIN" : "Badge — PIN non créé"}</span>
                    ) : (
                      u.email
                    )}
                  </td>
                  <td className="py-2 text-navy/70">
                    {isEditing ? (
                      <input aria-label="Téléphone"
                        className="input !py-1"
                        type="tel"
                        placeholder="ex: 06 12 34 56 78"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                      />
                    ) : (
                      u.phone ?? "—"
                    )}
                  </td>
                  <td className="py-2">
                    {isEditing ? (
                      <select aria-label="Service" className="input !w-auto !py-1" value={editServiceId} onChange={(e) => setEditServiceId(e.target.value)}>
                        <option value="">Aucun</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      services.find((s) => s.id === u.service_id)?.name ?? "—"
                    )}
                  </td>
                  <td className="py-2">
                    <select aria-label="Rôle"
                      className="input !w-auto !py-1"
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => changeRole(u.id, e.target.value as UserRole)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <span className={u.active ? "badge-teal" : "badge-neutral"}>{u.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td className="py-2">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button className="btn-primary !px-2 !py-1 text-xs" disabled={busy} onClick={() => saveEdit(u.id)}>
                          Enregistrer
                        </button>
                        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => setEditingId(null)}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => startEdit(u)}>
                          Modifier
                        </button>
                        {u.auth_method === "pin" && u.pin_set_at && (
                          <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => resetPin(u)}>
                            Réinitialiser le PIN
                          </button>
                        )}
                        <button
                          className="btn-secondary !px-2 !py-1 text-xs text-orange-ink"
                          disabled={busy}
                          onClick={() => toggleActive(u)}
                        >
                          {u.active ? "Désactiver" : "Réactiver"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
