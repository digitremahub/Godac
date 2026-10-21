"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { champsManquants, LIBELLES_CONTRAT, sexeValide, titreTravailRequis, TYPES_CONTRAT, type EntreeRegistre } from "@/lib/registre/personnel";

export interface ValeursRegistre {
  last_name: string;
  first_names: string;
  sex: "" | "F" | "M";
  nationality: string;
  birth_date: string;
  role_title: string;
  classification: string;
  hire_date: string;
  exit_date: string;
  contract_type: string;
  temp_agency: string;
  work_permit_type: string;
  work_permit_number: string;
  work_permit_expiry: string;
  register_excluded: boolean;
}

/**
 * Fiche salarié › Registre du personnel (direction) : saisie ou
 * complément des mentions obligatoires (art. D1221-23). Nationalité et
 * titre de travail sont enregistrés à part, lisibles de la direction et
 * du salarié seulement.
 */
export function RegistreSalarieForm({ userId, initial, actif, nomAffiche }: { userId: string; initial: ValeursRegistre; actif: boolean; nomAffiche: string }) {
  const router = useRouter();
  const [v, setV] = useState<ValeursRegistre>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const champ = <K extends keyof ValeursRegistre>(k: K) => (val: ValeursRegistre[K]) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: val }));
  };

  const manque = useMemo(() => {
    const e: EntreeRegistre = {
      userId,
      nomAffiche,
      nom: v.last_name || null,
      prenoms: v.first_names || null,
      nationalite: v.nationality || null,
      dateNaissance: v.birth_date || null,
      sexe: sexeValide(v.sex),
      emploi: v.role_title || null,
      qualification: v.classification || null,
      dateEntree: v.hire_date || null,
      dateSortie: v.exit_date || null,
      typeContrat: v.contract_type || null,
      tempsPartiel: false,
      agenceInterim: v.temp_agency || null,
      titreTravailType: v.work_permit_type || null,
      titreTravailNumero: v.work_permit_number || null,
      actif,
    };
    return champsManquants(e);
  }, [v, userId, nomAffiche, actif]);
  const titreRequis = titreTravailRequis(v.nationality);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/paie/registre/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          sex: v.sex || null,
          contract_type: v.contract_type || null,
          birth_date: v.birth_date || null,
          hire_date: v.hire_date || null,
          exit_date: v.exit_date || null,
          work_permit_expiry: v.work_permit_expiry || null,
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

  const texte = (k: keyof ValeursRegistre, label: string, extra?: { placeholder?: string; type?: string }) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" type={extra?.type ?? "text"} placeholder={extra?.placeholder} value={v[k] as string} onChange={(e) => champ(k)(e.target.value as never)} />
    </label>
  );

  return (
    <Card className="flex flex-col gap-3">
      <div id="registre" className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Registre du personnel</p>
        {!v.register_excluded &&
          (manque.length ? (
            <span className="rounded-full bg-gold/25 px-2 py-0.5 text-xs font-semibold">À compléter : {manque.join(", ")}</span>
          ) : (
            <span className="badge-teal">Complet</span>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-orange-ink">
          {error}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.register_excluded} onChange={(e) => champ("register_excluded")(e.target.checked)} />
        Ne figure pas au registre (gérant non salarié, prestataire)
      </label>
      {!v.register_excluded && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {texte("last_name", "Nom de naissance", { placeholder: "En capitales" })}
          {texte("first_names", "Prénoms", { placeholder: "Tous les prénoms" })}
          <label className="block">
            <span className="label">Sexe</span>
            <select className="input" value={v.sex} onChange={(e) => champ("sex")(e.target.value as ValeursRegistre["sex"])}>
              <option value="">—</option>
              <option value="F">Femme</option>
              <option value="M">Homme</option>
            </select>
          </label>
          {texte("nationality", "Nationalité", { placeholder: "ex : Française" })}
          {texte("birth_date", "Date de naissance", { type: "date" })}
          {texte("role_title", "Emploi", { placeholder: "ex : Conducteur SPL" })}
          {texte("classification", "Qualification", { placeholder: "ex : Groupe 7, coefficient 150M" })}
          <label className="block">
            <span className="label">Type de contrat</span>
            <select className="input" value={v.contract_type} onChange={(e) => champ("contract_type")(e.target.value)}>
              <option value="">—</option>
              {TYPES_CONTRAT.map((t) => (
                <option key={t} value={t}>
                  {LIBELLES_CONTRAT[t]}
                </option>
              ))}
            </select>
          </label>
          {v.contract_type === "interim" && texte("temp_agency", "Entreprise de travail temporaire (nom, adresse)")}
          {texte("hire_date", "Date d'entrée", { type: "date" })}
          {texte("exit_date", "Date de sortie", { type: "date" })}
          {(titreRequis || v.work_permit_type || v.work_permit_number) && (
            <>
              {texte("work_permit_type", "Type du titre de travail", { placeholder: "ex : Carte de séjour pluriannuelle" })}
              {texte("work_permit_number", "N° d'ordre du titre")}
              {texte("work_permit_expiry", "Fin de validité du titre", { type: "date" })}
            </>
          )}
        </div>
      )}
      <p className="text-xs text-navy/60">
        Nationalité et titre de travail ne sont visibles que de la direction et du salarié. Un salarié étranger hors Union européenne, EEE et Suisse doit
        détenir un titre l&apos;autorisant à travailler.
      </p>
      <div className="flex items-center gap-3">
        <button className="btn-primary !px-3 !py-1.5 text-sm self-start" disabled={busy} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && (
          <span role="status" className="text-sm text-teal-ink">
            Enregistré.
          </span>
        )}
      </div>
    </Card>
  );
}
