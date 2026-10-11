"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

type ContractType = "cdi" | "cdd" | "interim" | "apprentissage";
type HrStatus = "active" | "suspended" | "terminated";

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  cdi: "CDI",
  cdd: "CDD",
  interim: "Intérim",
  apprentissage: "Apprentissage",
};

const HR_STATUS_LABELS: Record<HrStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
  terminated: "Sorti des effectifs",
};

/**
 * Direction-only edit of employee_files (Module "Dossiers Employés").
 * hr_status here only ever saves 'active'/'suspended'/'terminated' —
 * 'on_leave' is never a manual choice, it's derived at read time by
 * compute_hr_status() from approved congés (see the computed badge
 * shown next to this form on the fiche chauffeur).
 */
export function EmployeeFileForm({
  userId,
  initialContractType,
  initialHireDate,
  initialContractEndDate,
  initialHrStatus,
  initialNotes,
  initialBirthDate,
  initialMatricule,
  initialSocialSecurityNumber,
  initialClassification,
}: {
  userId: string;
  initialContractType: ContractType | null;
  initialHireDate: string | null;
  initialContractEndDate: string | null;
  initialHrStatus: HrStatus;
  initialNotes: string | null;
  initialBirthDate: string | null;
  initialMatricule: string | null;
  initialSocialSecurityNumber: string | null;
  initialClassification: string | null;
}) {
  const router = useRouter();
  const [contractType, setContractType] = useState<ContractType | "">(initialContractType ?? "");
  const [hireDate, setHireDate] = useState(initialHireDate ?? "");
  const [contractEndDate, setContractEndDate] = useState(initialContractEndDate ?? "");
  const [hrStatus, setHrStatus] = useState<HrStatus>(initialHrStatus);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [birthDate, setBirthDate] = useState(initialBirthDate ?? "");
  const [matricule, setMatricule] = useState(initialMatricule ?? "");
  const [socialSecurityNumber, setSocialSecurityNumber] = useState(initialSocialSecurityNumber ?? "");
  const [classification, setClassification] = useState(initialClassification ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_type: contractType || null,
          hire_date: hireDate || null,
          contract_end_date: contractEndDate || null,
          hr_status: hrStatus,
          hr_notes: notes || null,
          birth_date: birthDate || null,
          matricule: matricule.trim() || null,
          social_security_number: socialSecurityNumber.trim() || null,
          classification: classification.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm font-medium">Dossier RH</p>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Type de contrat</label>
          <select className="input" value={contractType} onChange={(e) => setContractType(e.target.value as ContractType)}>
            <option value="">—</option>
            {(Object.keys(CONTRACT_TYPE_LABELS) as ContractType[]).map((ct) => (
              <option key={ct} value={ct}>
                {CONTRACT_TYPE_LABELS[ct]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Statut</label>
          <select className="input" value={hrStatus} onChange={(e) => setHrStatus(e.target.value as HrStatus)}>
            {(Object.keys(HR_STATUS_LABELS) as HrStatus[]).map((st) => (
              <option key={st} value={st}>
                {HR_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Date d&apos;embauche</label>
          <input className="input" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Fin de contrat (si CDD/intérim)</label>
          <input className="input" type="date" value={contractEndDate} onChange={(e) => setContractEndDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Date de naissance</label>
          <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <p className="mt-1 text-sm text-navy/50">
            Recalcule automatiquement le code de secours du badge (initiales + mois/année, ex: FT11/88).
          </p>
        </div>
        <div>
          <label className="label">Matricule</label>
          <input className="input" value={matricule} onChange={(e) => setMatricule(e.target.value)} />
        </div>
        <div>
          <label className="label">N° de sécurité sociale</label>
          <input className="input" value={socialSecurityNumber} onChange={(e) => setSocialSecurityNumber(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Qualification / classification conventionnelle</label>
          <input
            className="input"
            placeholder="ex: Groupe 7, coefficient 150V"
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label">Notes RH (usage interne direction)</label>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary !px-3 !py-1.5 text-sm self-start" disabled={busy} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && <span className="text-sm text-teal-ink">Enregistré.</span>}
      </div>
    </Card>
  );
}
