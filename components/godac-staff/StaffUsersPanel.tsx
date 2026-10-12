"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/roles/labels";
import type { UserRole } from "@/lib/types/domain";

interface StaffUserRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

const ROLES: UserRole[] = ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"];

/**
 * Same role-select + active-toggle shape as components/admin/UsersPanel,
 * but calling the GODAC-staff-only route — no "last direction account"
 * guard here, that's the entire point of this panel existing (see
 * app/api/godac-staff/users/[id]/route.ts).
 */
export function StaffUsersPanel({ users }: { users: StaffUserRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: { role?: UserRole; active?: boolean }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/godac-staff/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  function changeRole(user: StaffUserRow, role: UserRole) {
    if (
      user.role === "direction" &&
      role !== "direction" &&
      !window.confirm(`${user.full_name} perdra le rôle direction. Continuer ?`)
    ) {
      return;
    }
    patch(user.id, { role });
  }

  function toggleActive(user: StaffUserRow) {
    if (user.active && !window.confirm(`Désactiver ${user.full_name} ? Son compte ne pourra plus se connecter.`)) {
      return;
    }
    patch(user.id, { active: !user.active });
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p className="mb-2 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Nom</th>
            <th className="pb-2">Email</th>
            <th className="pb-2">Rôle</th>
            <th className="pb-2">Statut</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-navy/5">
              <td className="py-2">{u.full_name}</td>
              <td className="py-2">{u.email}</td>
              <td className="py-2">
                <select
                  className="input !w-auto !py-1"
                  value={u.role}
                  disabled={busyId === u.id}
                  onChange={(e) => changeRole(u, e.target.value as UserRole)}
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
                <button
                  className="btn-secondary !px-2 !py-1 text-xs text-orange-ink"
                  disabled={busyId === u.id}
                  onClick={() => toggleActive(u)}
                >
                  {u.active ? "Désactiver" : "Réactiver"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
