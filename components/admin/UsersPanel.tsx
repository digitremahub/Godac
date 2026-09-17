"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/roles/labels";
import type { UserRole } from "@/lib/types/domain";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  role_title: string | null;
  active: boolean;
  service_id: string | null;
}
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
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("chauffeur");
  const [roleTitle, setRoleTitle] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
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
      setRoleTitle("");
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

  function startEdit(user: UserRow) {
    setEditingId(user.id);
    setEditName(user.full_name);
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
        body: JSON.stringify({ full_name: editName, role_title: editRoleTitle || null, service_id: editServiceId || null }),
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

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
          <div className="flex-1">
            <label className="label">Nom</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Rôle (permissions)</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="label">Titre affiché (optionnel)</label>
            <input
              className="input"
              placeholder="ex: Chef de dépôt"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Service</label>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Aucun</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-primary shrink-0" disabled={busy || !email} onClick={invite}>
            Inviter
          </button>
        </div>
        <p className="text-xs text-navy/40">
          Le titre affiché est libre (ex: &quot;Chef de dépôt&quot;, &quot;Assistante RH&quot;) — c&apos;est le rôle
          choisi ci-dessus qui détermine les permissions réelles dans GODAC.
        </p>
      </Card>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {sent && <p className="text-sm text-teal-ink">Invitation envoyée par email.</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-navy/40">
            <tr>
              <th className="pb-2">Nom</th>
              <th className="pb-2">Titre</th>
              <th className="pb-2">Email</th>
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
                      <input className="input !py-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    ) : (
                      <Link href={`/admin/users/${u.id}`} className="text-teal-ink hover:underline">
                        {u.full_name}
                      </Link>
                    )}
                  </td>
                  <td className="py-2 text-navy/60">
                    {isEditing ? (
                      <input
                        className="input !py-1"
                        placeholder="ex: Chef de dépôt"
                        value={editRoleTitle}
                        onChange={(e) => setEditRoleTitle(e.target.value)}
                      />
                    ) : (
                      u.role_title ?? "—"
                    )}
                  </td>
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">
                    {isEditing ? (
                      <select className="input !w-auto !py-1" value={editServiceId} onChange={(e) => setEditServiceId(e.target.value)}>
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
                    <select
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
                      <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => startEdit(u)}>
                        Modifier
                      </button>
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
