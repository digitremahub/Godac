"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { calculerBulletin, HEURES_EQUIVALENCE } from "@/lib/paie/calcul";
import { networkErrorMessage } from "@/lib/utils/network-error";
import type { ParametresEntreprise, ParametresLegaux, Prime, ProfilSalarie, RegimeTransport, Section, VariablesMois } from "@/lib/paie/types";

const eur = (n: number | null) => (n === null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const REGIMES: { key: RegimeTransport; label: string }[] = [
  { key: "grand_routier", label: "Conducteur grand routier (43 h)" },
  { key: "courte_distance", label: "Conducteur courte distance (39 h)" },
  { key: "sedentaire", label: "Sédentaire (35 h)" },
];
const SECTIONS: Record<Section, string> = {
  brut: "Rémunération",
  sante: "Santé",
  retraite: "Retraite",
  famille: "Famille",
  chomage: "Assurance chômage",
  autres: "Autres contributions employeur",
  csg: "CSG / CRDS",
  exonerations: "Exonérations et allègements",
  net: "Après le net imposable",
};

type Num = number | "";
const n = (v: Num) => (v === "" ? 0 : v);

function Field({ label, value, onChange, step = "0.01", suffix, hint }: { label: string; value: Num; onChange: (v: Num) => void; step?: string; suffix?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="relative block">
        <input
          className="input pr-10 tabular-nums"
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-navy/50">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-navy/55">{hint}</span>}
    </label>
  );
}

export function PaieEditor({
  userId,
  mois,
  legal,
  entreprise,
  profil,
  coefficient: coefficientInitial,
  profilComplet,
  prefill,
  joursTravailles,
  dejaGenere,
}: {
  userId: string;
  mois: string;
  legal: ParametresLegaux;
  entreprise: ParametresEntreprise;
  profil: ProfilSalarie;
  coefficient: string | null;
  profilComplet: boolean;
  prefill: VariablesMois;
  joursTravailles: number;
  dejaGenere: boolean;
}) {
  const router = useRouter();
  const [regime, setRegime] = useState<RegimeTransport>(profil.regime);
  const [cadre, setCadre] = useState(profil.cadre);
  const [coefficient, setCoefficient] = useState(coefficientInitial ?? "");
  const [tauxHoraire, setTauxHoraire] = useState<Num>(profil.tauxHoraire || "");
  const [heuresContrat, setHeuresContrat] = useState<Num>(profil.heuresContractuelles);
  const [tauxPas, setTauxPas] = useState<Num>(profil.tauxPas ?? "");
  const [profilEnregistre, setProfilEnregistre] = useState(profilComplet);

  const [heures, setHeures] = useState<Num>(prefill.heuresTravaillees ?? "");
  const [absence, setAbsence] = useState<Num>(prefill.heuresAbsenceNonPayee);
  const [conges, setConges] = useState<Num>(prefill.joursCongesPris);
  const [primes, setPrimes] = useState<Prime[]>(prefill.primes);
  const [repas, setRepas] = useState<Num>(prefill.nbRepas);
  const [repasUnique, setRepasUnique] = useState<Num>(prefill.nbRepasUnique);
  const [casse, setCasse] = useState<Num>(prefill.nbCasseCroute);
  const [decoucher, setDecoucher] = useState<Num>(prefill.nbGrandDeplacement);

  const [busy, setBusy] = useState<"profil" | "bulletin" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const salarie: ProfilSalarie = { regime, cadre, tauxHoraire: n(tauxHoraire), heuresContractuelles: n(heuresContrat) || HEURES_EQUIVALENCE[regime], tauxPas: tauxPas === "" ? null : tauxPas };
  const variables: VariablesMois = {
    heuresTravaillees: heures === "" ? null : heures,
    heuresAbsenceNonPayee: n(absence),
    joursCongesPris: n(conges),
    primes: primes.filter((p) => p.montant),
    nbRepas: n(repas),
    nbRepasUnique: n(repasUnique),
    nbCasseCroute: n(casse),
    nbGrandDeplacement: n(decoucher),
    cumulHeuresSupExonereesAnnee: prefill.cumulHeuresSupExonereesAnnee,
  };
  const bulletin = useMemo(
    () => (salarie.tauxHoraire > 0 ? calculerBulletin({ legal, entreprise, salarie, variables }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(salarie), JSON.stringify(variables)],
  );

  async function send(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible");
    return json;
  }

  async function saveProfil() {
    setBusy("profil");
    setMessage(null);
    try {
      await send(`/api/paie/profils/${userId}`, "PUT", {
        regime,
        is_cadre: cadre,
        coefficient: coefficient.trim() || null,
        hourly_rate: n(tauxHoraire),
        contractual_hours: salarie.heuresContractuelles,
        pas_rate: tauxPas === "" ? null : tauxPas,
      });
      setProfilEnregistre(true);
      setMessage({ ok: true, text: "Profil enregistré." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function generer() {
    setBusy("bulletin");
    setMessage(null);
    try {
      if (!profilEnregistre) await saveProfil();
      const json = await send("/api/paie/bulletins", "POST", { user_id: userId, mois, variables });
      setMessage({ ok: true, text: `Bulletin généré — net à payer ${eur(json.netAPayer)} €. Le salarié le retrouve dans « Fiches de paie ».` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const sections = bulletin ? Array.from(new Set(bulletin.lignes.map((l) => l.section))) : [];

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Profil de paie</h2>
          <label className="block">
            <span className="label">Régime</span>
            <select
              className="input"
              value={regime}
              onChange={(e) => {
                const r = e.target.value as RegimeTransport;
                setRegime(r);
                setHeuresContrat(HEURES_EQUIVALENCE[r]);
                setProfilEnregistre(false);
              }}
            >
              {REGIMES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Taux horaire brut" value={tauxHoraire} onChange={(v) => (setTauxHoraire(v), setProfilEnregistre(false))} step="0.0001" suffix="€" hint={`SMIC : ${eur(legal.smicHoraire)} €`} />
            <Field label="Heures payées / mois" value={heuresContrat} onChange={(v) => (setHeuresContrat(v), setProfilEnregistre(false))} suffix="h" />
            <label className="block">
              <span className="label">Coefficient</span>
              <input className="input" value={coefficient} onChange={(e) => (setCoefficient(e.target.value), setProfilEnregistre(false))} placeholder="ex. 138M" />
            </label>
            <Field label="Taux PAS" value={tauxPas} onChange={(v) => (setTauxPas(v), setProfilEnregistre(false))} suffix="%" hint="Vide = taux neutre" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cadre} onChange={(e) => (setCadre(e.target.checked), setProfilEnregistre(false))} />
            Statut cadre
          </label>
          {!profilEnregistre && (
            <button type="button" className="btn-secondary w-fit !py-2 text-sm" disabled={busy !== null || !tauxHoraire} onClick={saveProfil}>
              Enregistrer le profil
            </button>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg">Variables du mois</h2>
            <p className="text-sm text-navy/60">Préremplies depuis les tournées ({joursTravailles} jour{joursTravailles > 1 ? "s" : ""} travaillé{joursTravailles > 1 ? "s" : ""}) et les congés validés.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heures travaillées" value={heures} onChange={setHeures} suffix="h" hint="Vide = heures du contrat" />
            <Field label="Absence non payée" value={absence} onChange={setAbsence} suffix="h" />
            <Field label="Congés payés pris" value={conges} onChange={setConges} step="0.5" suffix="j" />
          </div>
          <p className="label !mb-0">Frais de déplacement</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Repas (${eur(entreprise.frais.repas)} €)`} value={repas} onChange={setRepas} step="1" />
            <Field label={`Repas unique (${eur(entreprise.frais.repasUnique)} €)`} value={repasUnique} onChange={setRepasUnique} step="1" />
            <Field label={`Casse-croûte (${eur(entreprise.frais.cassecroute)} €)`} value={casse} onChange={setCasse} step="1" />
            <Field label={`Découchers (${eur(entreprise.frais.grandDeplacement)} €)`} value={decoucher} onChange={setDecoucher} step="1" />
          </div>
          <p className="label !mb-0">Primes et retenues</p>
          {primes.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                className="input min-w-0 flex-1 !py-1.5"
                placeholder="Libellé"
                value={p.libelle}
                onChange={(e) => setPrimes(primes.map((x, j) => (j === i ? { ...x, libelle: e.target.value } : x)))}
                aria-label="Libellé de la prime"
              />
              <input
                className="input w-28 !py-1.5 tabular-nums"
                type="number"
                step="0.01"
                value={p.montant || ""}
                onChange={(e) => setPrimes(primes.map((x, j) => (j === i ? { ...x, montant: Number(e.target.value) } : x)))}
                aria-label="Montant"
              />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={p.soumise} onChange={(e) => setPrimes(primes.map((x, j) => (j === i ? { ...x, soumise: e.target.checked } : x)))} />
                soumise
              </label>
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-orange-ink" onClick={() => setPrimes(primes.filter((_, j) => j !== i))}>
                Retirer
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" onClick={() => setPrimes([...primes, { libelle: "", montant: 0, soumise: true }])}>
            + Prime ou retenue
          </button>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Bulletin calculé</h2>
          <button type="button" className="btn-primary !py-2" disabled={busy !== null || !bulletin} onClick={generer}>
            {busy === "bulletin" ? "Génération…" : dejaGenere ? "Regénérer le bulletin" : "Générer le bulletin"}
          </button>
        </div>
        {message && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-teal/10 text-teal-ink" : "bg-orange/10 text-orange-ink"}`}>{message.text}</p>}
        {!bulletin ? (
          <p className="text-sm text-navy/60">Renseignez le taux horaire pour voir le bulletin.</p>
        ) : (
          <>
            {bulletin.avertissements.map((a) => (
              <p key={a} className="rounded-lg bg-gold/15 px-3 py-2 text-sm">{a}</p>
            ))}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Brut", bulletin.brut],
                ["Net avant impôt", bulletin.netAvantImpot],
                ["Net à payer", bulletin.netAPayer],
                ["Coût employeur", bulletin.coutEmployeur],
              ].map(([l, v]) => (
                <div key={l as string} className={`rounded-xl px-3 py-2.5 ${l === "Net à payer" ? "bg-marine text-white" : "bg-navy/[0.04]"}`}>
                  <p className={`text-xs ${l === "Net à payer" ? "text-white/70" : "text-navy/60"}`}>{l}</p>
                  <p className="font-display text-lg font-bold tabular-nums">{eur(v as number)} €</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm [&_td]:py-1.5 [&_td]:pr-3 [&_th]:pb-2 [&_th]:pr-3">
                <thead className="text-left text-xs text-navy/55">
                  <tr>
                    <th>Rubrique</th>
                    <th className="text-right">Base</th>
                    <th className="text-right">Taux sal.</th>
                    <th className="text-right">Salarié</th>
                    <th className="text-right">Taux pat.</th>
                    <th className="text-right">Employeur</th>
                  </tr>
                </thead>
                {sections.map((sec) => (
                  <tbody key={sec} className="border-t border-navy/[0.08]">
                    <tr>
                      <td colSpan={6} className="!pt-3 text-xs font-semibold uppercase tracking-wide text-navy/55">{SECTIONS[sec]}</td>
                    </tr>
                    {bulletin.lignes
                      .filter((l) => l.section === sec)
                      .map((l, i) => (
                        <tr key={i}>
                          <td>{l.libelle}</td>
                          <td className="text-right tabular-nums text-navy/70">{l.base !== null ? eur(l.base) : ""}</td>
                          <td className="text-right tabular-nums text-navy/70">{l.tauxSalarial !== null ? eur(l.tauxSalarial) : ""}</td>
                          <td className={`text-right tabular-nums ${l.gain ? "font-semibold" : ""}`}>{eur(l.montantSalarial)}</td>
                          <td className="text-right tabular-nums text-navy/70">{l.tauxPatronal !== null ? eur(l.tauxPatronal) : ""}</td>
                          <td className="text-right tabular-nums">{eur(l.montantPatronal)}</td>
                        </tr>
                      ))}
                  </tbody>
                ))}
              </table>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["Total cotisations salariales", bulletin.totalSalarial],
                ["Total cotisations patronales", bulletin.totalPatronal],
                ["Réduction générale", bulletin.reductionGenerale],
                ["Montant net social", bulletin.netSocial],
                ["Net imposable", bulletin.netImposable],
                [`Prélèvement à la source (${eur(bulletin.tauxPas)} %)`, bulletin.montantPas],
                ["Frais non soumis", bulletin.fraisNonSoumis],
                ["Heures sup. exonérées d'impôt", bulletin.heuresSupExonerees],
              ].map(([l, v]) => (
                <div key={l as string} className="flex justify-between border-b border-navy/[0.06] py-1">
                  <dt className="text-navy/65">{l}</dt>
                  <dd className="tabular-nums">{eur(v as number)} €</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-navy/55">
              Calcul sur un mois complet, heures décomptées au mois. Entrée ou sortie en cours de mois, maladie avec indemnités journalières ou
              décompte trimestriel : à ajuster en prime ou retenue. L&apos;employeur reste responsable du bulletin.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
