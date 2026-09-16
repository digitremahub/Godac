"use client";

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
  active: boolean;
}
interface ServiceOption {
  id: string;
  name: string;
}

const ROLES: UserRole[] = ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"];

export function UsersPanel({ users, services }: { users: UserRow[]; services: ServiceOption[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("chauffeur");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, service_id: serviceId || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setSent(true);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, newRole: UserRole) {
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Rôle</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
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
      </Card>
      {error && <p className="text-sm text-orange">{error}</p>}
      {sent && <p className="text-sm text-teal">Invitation envoyée par Clerk.</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-white/40">
            <tr>
              <th className="pb-2">Nom</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Rôle</th>
              <th className="pb-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-white/5">
                <td className="py-2">{u.full_name}</td>
                <td className="py-2">{u.email}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
