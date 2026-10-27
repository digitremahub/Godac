"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { calculerBulletin, HEURES_EQUIVALENCE, LIBELLE_RETENUE, LIBELLE_TYPE_TAUX_PAS } from "@/lib/paie/calcul";
import { MODES_PAIEMENT, paiementDuBulletin } from "@/lib/paie/paiement";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { TYPES_ARRET } from "@/lib/paie/arrets";
import { LIBELLE_MOTIF } from "@/lib/paie/sortie";
import type { ArretTravail, NaturePrime, TypeArret } from "@/lib/paie/types";
import type { ModePaiement, ParametresEntreprise, ParametresLegaux, PeriodeConges, Prime, ProfilSalarie, RegimeTransport, Retenue, Section, TypeRetenue, TypeTauxPas, VariablesMois } from "@/lib/paie/types";
import { joursOuvrables } from "@/lib/paie/conges";
import { LIBELLE_NATURE_PRIME, marquerPrime, primeRecopieeSansMarqueur } from "@/lib/paie/primes";

const eur = (n: number | null) => (n === null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const REGIMES: { key: RegimeTransport; label: string }[] = [
  { key: "grand_routier", label: "Conducteur grand routier (43 h)" },
  { key: "courte_distance", label: "Conducteur courte distance (39 h)" },
  { key: "sedentaire", label: "Sédentaire (35 h)" },
];
const SECTIONS: Record<Section, string> = {
  brut: "Rémunération",
  sante: "Santé",
  at: "Accidents du travail & maladies professionnelles",
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
  peutModifierProfil = true,
  avertissementsAcomptes = [],
  repriseConges = null,
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
  /** Comptable : le profil de paie se lit, seule la direction le modifie. */
  peutModifierProfil?: boolean;
  /** Acomptes reportés (bulletin validé), venus d'un mois antérieur… */
  avertissementsAcomptes?: string[];
  /** Solde de congés de reprise (profil de paie). */
  repriseConges?: { au: string; n1: number; n: number } | null;
}) {
  const router = useRouter();
  const [regime, setRegime] = useState<RegimeTransport>(profil.regime);
  const [cadre, setCadre] = useState(profil.cadre);
  const [coefficient, setCoefficient] = useState(coefficientInitial ?? "");
  const [tauxHoraire, setTauxHoraire] = useState<Num>(profil.tauxHoraire || "");
  const [heuresContrat, setHeuresContrat] = useState<Num>(profil.heuresContractuelles);
  const [tauxPas, setTauxPas] = useState<Num>(profil.tauxPas ?? "");
  const [profilEnregistre, setProfilEnregistre] = useState(profilComplet);
  const [groupe, setGroupe] = useState(profil.groupe ?? "");
  const [tauxRepasProfil, setTauxRepasProfil] = useState<Num>(profil.tauxRepas ?? "");
  const [repriseN1, setRepriseN1] = useState<Num>(repriseConges?.n1 ?? "");
  const [repriseN, setRepriseN] = useState<Num>(repriseConges?.n ?? "");
  const [repriseAu, setRepriseAu] = useState(repriseConges?.au ?? "");

  const [heures, setHeures] = useState<Num>(prefill.heuresTravaillees ?? "");
  const [absence, setAbsence] = useState<Num>(prefill.heuresAbsenceNonPayee);
  const [conges, setConges] = useState<Num>(prefill.joursCongesPris);
  const [primes, setPrimes] = useState<Prime[]>(prefill.primes);
  const [repas, setRepas] = useState<Num>(prefill.nbRepas);
  const [repasUnique, setRepasUnique] = useState<Num>(prefill.nbRepasUnique);
  const [casse, setCasse] = useState<Num>(prefill.nbCasseCroute);
  const [decoucher, setDecoucher] = useState<Num>(prefill.nbGrandDeplacement);
  const [retenues, setRetenues] = useState<Retenue[]>(prefill.retenues ?? []);
  const [personnesACharge, setPersonnesACharge] = useState<Num>(prefill.personnesACharge ?? 0);
  const [hs25, setHs25] = useState<Num>(prefill.heuresSup25 ?? "");
  const [hs50, setHs50] = useState<Num>(prefill.heuresSup50 ?? "");
  const [periodes, setPeriodes] = useState<PeriodeConges[]>(prefill.periodesConges ?? []);
  const [tauxRepasMois, setTauxRepasMois] = useState<Num>(prefill.tauxRepas ?? "");
  const paiementInitial = paiementDuBulletin(mois, prefill);
  const [datePaiement, setDatePaiement] = useState(paiementInitial.datePaiement);
  const [modePaiement, setModePaiement] = useState<ModePaiement>(paiementInitial.modePaiement);
  const [typeTauxPas, setTypeTauxPas] = useState<TypeTauxPas | "">(prefill.typeTauxPas ?? "");
  const [arrets, setArrets] = useState<ArretTravail[]>(prefill.arrets ?? []);
  const [subrogation, setSubrogation] = useState<boolean>(prefill.subrogation ?? entreprise.subrogation ?? false);

  const [busy, setBusy] = useState<"profil" | "bulletin" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const salarie: ProfilSalarie = {
    regime,
    cadre,
    tauxHoraire: n(tauxHoraire),
    heuresContractuelles: n(heuresContrat) || HEURES_EQUIVALENCE[regime],
    tauxPas: tauxPas === "" ? null : tauxPas,
    groupe: groupe.trim() || null,
    tauxRepas: tauxRepasProfil === "" ? null : tauxRepasProfil,
  };
  const periodesValides = periodes.filter((p) => p.du && p.au && p.jours > 0);
  const variables: VariablesMois = {
    heuresTravaillees: heures === "" ? null : heures,
    heuresAbsenceNonPayee: n(absence),
    joursCongesPris: periodesValides.length ? periodesValides.reduce((t, p) => t + p.jours, 0) : n(conges),
    periodesConges: periodesValides,
    heuresSup25: hs25 === "" && hs50 === "" ? null : n(hs25),
    heuresSup50: hs25 === "" && hs50 === "" ? null : n(hs50),
    tauxRepas: tauxRepasMois === "" ? null : tauxRepasMois,
    primes: primes.filter((p) => p.montant),
    nbRepas: n(repas),
    nbRepasUnique: n(repasUnique),
    nbCasseCroute: n(casse),
    nbGrandDeplacement: n(decoucher),
    retenues: retenues.filter((r) => r.montant > 0),
    personnesACharge: n(personnesACharge),
    cumulHeuresSupExonereesAnnee: prefill.cumulHeuresSupExonereesAnnee,
    datePaiement: datePaiement || null,
    modePaiement,
    typeTauxPas: typeTauxPas || null,
    arrets: arrets.filter((a) => a.du && a.au && a.au >= a.du),
    subrogation,
    // Relus côté serveur à la génération : affichés ici pour l'aperçu.
    cpReference: prefill.cpReference ?? null,
    sortie: prefill.sortie ?? null,
  };
  const [annee, numMois] = mois.split("-").map(Number) as [number, number];
  const periode = { debut: `${mois}-01`, fin: new Date(Date.UTC(annee, numMois, 0)).toISOString().slice(0, 10) };
  const bulletin = useMemo(
    () => (salarie.tauxHoraire > 0 ? calculerBulletin({ legal, entreprise, salarie, variables, periode }) : null),
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
        job_group: groupe.trim() || null,
        meal_rate: tauxRepasProfil === "" ? null : tauxRepasProfil,
        leave_balance_n1: repriseN1 === "" ? null : repriseN1,
        leave_balance_n: repriseN === "" ? null : repriseN,
        leave_balance_date: repriseAu || null,
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
      if (!profilEnregistre && peutModifierProfil) await saveProfil();
      const json = await send("/api/paie/bulletins", "POST", { user_id: userId, mois, variables });
      setMessage({
        ok: true,
        text:
          json.validation === "valide"
            ? `Bulletin généré et validé — net à payer ${eur(json.netAPayer)} €. Le salarié le retrouve dans « Fiches de paie ».`
            : `Bulletin généré — net à payer ${eur(json.netAPayer)} €. Il attend la validation de la direction : le salarié ne le verra qu'une fois validé.`,
      });
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
          {!peutModifierProfil && <p className="text-xs text-navy/60">Lecture seule : le profil de paie est modifié par la direction.</p>}
          <fieldset disabled={!peutModifierProfil} className="flex flex-col gap-3 disabled:opacity-80">
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
            <label className="block">
              <span className="label">Groupe</span>
              <input className="input" value={groupe} onChange={(e) => (setGroupe(e.target.value), setProfilEnregistre(false))} placeholder="ex. 03 bis" />
            </label>
            <Field label="Taux du panier" value={tauxRepasProfil} onChange={(v) => (setTauxRepasProfil(v), setProfilEnregistre(false))} suffix="€" hint={`Vide = réglage (${eur(entreprise.frais.repas)} €)`} />
          </div>
          <p className="label !mb-0">Solde de congés de reprise</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="N-1" value={repriseN1} onChange={(v) => (setRepriseN1(v), setProfilEnregistre(false))} step="0.5" suffix="j" />
            <Field label="N" value={repriseN} onChange={(v) => (setRepriseN(v), setProfilEnregistre(false))} step="0.5" suffix="j" />
            <label className="block">
              <span className="label">Au</span>
              <input className="input" type="date" value={repriseAu} onChange={(e) => (setRepriseAu(e.target.value), setProfilEnregistre(false))} />
            </label>
          </div>
          <p className="-mt-1 text-xs text-navy/55">Soldes du dernier bulletin (ex. N-1 : 5, N : 5 au 30/09). Ensuite : + 2,5 j par mois, − congés validés.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cadre} onChange={(e) => (setCadre(e.target.checked), setProfilEnregistre(false))} />
            Statut cadre
          </label>
          </fieldset>
          {!profilEnregistre && peutModifierProfil && (
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
            {periodesValides.length === 0 && <Field label="Congés payés pris" value={conges} onChange={setConges} step="0.5" suffix="j" />}
            <Field label="Heures sup. 25 %" value={hs25} onChange={setHs25} suffix="h" hint="Saisies : remplacent celles des heures travaillées" />
            <Field label="Heures sup. 50 %" value={hs50} onChange={setHs50} suffix="h" />
          </div>
          <p className="label !mb-0">Congés payés pris (dates)</p>
          {periodes.map((p, i) => {
            const maj = (champ: Partial<PeriodeConges>) =>
              setPeriodes(
                periodes.map((x, j) => {
                  if (j !== i) return x;
                  const nouveau = { ...x, ...champ };
                  // Jours ouvrables recalculés quand les dates changent.
                  if ((champ.du !== undefined || champ.au !== undefined) && nouveau.du && nouveau.au) nouveau.jours = joursOuvrables(nouveau.du, nouveau.au);
                  return nouveau;
                }),
              );
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input className="input w-auto !py-1.5" type="date" value={p.du} onChange={(e) => maj({ du: e.target.value })} aria-label="Du" />
                <input className="input w-auto !py-1.5" type="date" value={p.au} onChange={(e) => maj({ au: e.target.value })} aria-label="Au" />
                <input className="input w-20 !py-1.5 tabular-nums" type="number" step="0.5" min="0" value={p.jours || ""} onChange={(e) => maj({ jours: Math.max(0, Number(e.target.value)) })} aria-label="Jours ouvrables" />
                <span className="text-xs text-navy/55">j ouvr.</span>
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-orange-ink" onClick={() => setPeriodes(periodes.filter((_, j) => j !== i))}>
                  Retirer
                </button>
              </div>
            );
          })}
          <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" onClick={() => setPeriodes([...periodes, { du: "", au: "", jours: 0 }])}>
            + Période de congés
          </button>
          <p className="label !mb-0">Arrêts de travail et congés sans solde</p>
          {arrets.map((a, i) => {
            const maj = (champ: Partial<ArretTravail>) => setArrets(arrets.map((x, j) => (j === i ? { ...x, ...champ } : x)));
            const nombre = (v: string) => (v === "" ? null : Math.max(0, Number(v)));
            return (
              <div key={a.id ?? i} className="flex flex-col gap-2 rounded-lg border border-navy/10 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input w-auto !py-1.5" value={a.type} onChange={(e) => maj({ type: e.target.value as TypeArret })} aria-label="Nature de l'arrêt">
                    {TYPES_ARRET.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input className="input w-auto !py-1.5" type="date" value={a.du} onChange={(e) => maj({ du: e.target.value })} aria-label="Du" />
                  <input className="input w-auto !py-1.5" type="date" value={a.au} onChange={(e) => maj({ au: e.target.value })} aria-label="Au" />
                  <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-orange-ink" onClick={() => setArrets(arrets.filter((_, j) => j !== i))}>
                    Retirer
                  </button>
                </div>
                {a.type !== "sans_solde" && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <label className="block text-xs">
                      <span className="label">Prolongation de l&apos;arrêt du</span>
                      <input className="input !py-1.5" type="date" value={a.prolongationDu ?? ""} onChange={(e) => maj({ prolongationDu: e.target.value || null })} />
                    </label>
                    <label className="block text-xs">
                      <span className="label">IJSS brutes / jour</span>
                      <input className="input !py-1.5 tabular-nums" type="number" step="0.01" min="0" value={a.ijssBrutesJour ?? ""} onChange={(e) => maj({ ijssBrutesJour: nombre(e.target.value) })} />
                    </label>
                    <label className="block text-xs">
                      <span className="label">IJSS nettes / jour</span>
                      <input className="input !py-1.5 tabular-nums" type="number" step="0.01" min="0" value={a.ijssNettesJour ?? ""} onChange={(e) => maj({ ijssNettesJour: nombre(e.target.value) })} />
                    </label>
                    <label className="block text-xs">
                      <span className="label">Jours d&apos;IJSS (mois)</span>
                      <input className="input !py-1.5 tabular-nums" type="number" step="1" min="0" value={a.joursIjss ?? ""} placeholder="calculé" onChange={(e) => maj({ joursIjss: nombre(e.target.value) })} />
                    </label>
                    <label className="block text-xs">
                      <span className="label">Maintien saisi</span>
                      <input className="input !py-1.5 tabular-nums" type="number" step="0.01" min="0" value={a.maintienManuel ?? ""} placeholder="calculé" onChange={(e) => maj({ maintienManuel: nombre(e.target.value) })} />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-secondary w-fit !py-1.5 text-sm"
              onClick={() => setArrets([...arrets, { id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined, type: "maladie", du: "", au: "" }])}
            >
              + Arrêt ou absence
            </button>
            {arrets.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={subrogation} onChange={(e) => setSubrogation(e.target.checked)} />
                Subrogation (l&apos;employeur perçoit les IJSS)
              </label>
            )}
          </div>
          {arrets.length > 0 && (
            <p className="-mt-1 text-xs text-navy/55">
              Absence en jours calendaires ; carence IJSS 3 j (maladie) ; maintien légal après 1 an d&apos;ancienneté{profil.dateEntree ? ` (entrée le ${new Date(`${profil.dateEntree}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" })})` : " — date d'entrée inconnue"}, carence 7 j sauf AT/MP.
              Enregistrés dans la fiche du salarié à la génération du bulletin.
            </p>
          )}
          {prefill.sortie && (
            <div role="note" className="rounded-lg border border-orange/30 bg-orange/5 px-3 py-2 text-xs text-navy">
              <p className="font-semibold">
                Bulletin de sortie — {LIBELLE_MOTIF[prefill.sortie.motif]} le {new Date(`${prefill.sortie.date}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
              </p>
              <p>Indemnités calculées depuis la fiche de sortie (ci-dessous) : modifiez-la pour les changer.</p>
            </div>
          )}
          <p className="label !mb-0">Paiement et impôt</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Date de paiement</span>
              <input className="input" type="date" value={datePaiement} onChange={(e) => setDatePaiement(e.target.value)} />
              <span className="mt-1 block text-xs text-navy/55">Vide = dernier jour du mois</span>
            </label>
            <label className="block">
              <span className="label">Mode de paiement</span>
              <select className="input" value={modePaiement} onChange={(e) => setModePaiement(e.target.value as ModePaiement)}>
                {(Object.keys(MODES_PAIEMENT) as ModePaiement[]).map((m) => (
                  <option key={m} value={m}>
                    {MODES_PAIEMENT[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 block">
              <span className="label">Taux du prélèvement à la source</span>
              <select className="input" value={typeTauxPas} onChange={(e) => setTypeTauxPas(e.target.value as TypeTauxPas | "")}>
                <option value="">Automatique ({tauxPas === "" ? "non personnalisé : aucun taux au profil" : "personnalisé : taux du profil"})</option>
                <option value="personnalise" disabled={tauxPas === ""}>
                  {LIBELLE_TYPE_TAUX_PAS.personnalise} (taux du profil)
                </option>
                <option value="non_personnalise">{LIBELLE_TYPE_TAUX_PAS.non_personnalise} (grille du taux neutre)</option>
              </select>
            </label>
          </div>
          <p className="label !mb-0">Frais de déplacement</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Paniers repas (${eur(tauxRepasMois === "" ? (tauxRepasProfil === "" ? entreprise.frais.repas : tauxRepasProfil) : tauxRepasMois)} €)`} value={repas} onChange={setRepas} step="1" hint="Nombre de jours" />
            <Field label="Taux du panier ce mois" value={tauxRepasMois} onChange={setTauxRepasMois} suffix="€" hint="Vide = profil ou réglage" />
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
              <select
                className="input w-auto !py-1.5 text-xs"
                value={p.nature ?? ""}
                onChange={(e) => setPrimes(primes.map((x, j) => (j === i ? marquerPrime(x, (e.target.value || undefined) as NaturePrime | undefined) : x)))}
                aria-label="Nature de la prime : récurrente ou ponctuelle"
              >
                <option value="">{p.recopiee ? "Recopiée : à préciser" : "Nature non précisée"}</option>
                <option value="recurrente">{LIBELLE_NATURE_PRIME.recurrente}</option>
                <option value="ponctuelle">{LIBELLE_NATURE_PRIME.ponctuelle}</option>
              </select>
              {primeRecopieeSansMarqueur(p) && (
                <span className="w-full text-xs" style={{ color: "#d62718" }}>
                  Prime recopiée du mois précédent : précisez si elle est récurrente ou ponctuelle (sinon elle sera reprise le mois suivant).
                </span>
              )}
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-orange-ink" onClick={() => setPrimes(primes.filter((_, j) => j !== i))}>
                Retirer
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" onClick={() => setPrimes([...primes, { libelle: "", montant: 0, soumise: true }])}>
            + Prime ou retenue
          </button>
          <p className="label !mb-0">Acomptes et saisies (après le net)</p>
          <p className="-mt-1 text-xs text-navy/55">
            Acompte déjà versé, saisie sur salaire, ATD / saisie administrative, pension alimentaire, remboursement de prêt. Les retenues
            récurrentes sont reprises le mois suivant.
          </p>
          {avertissementsAcomptes.map((a) => (
            <p key={a} role="note" className="rounded-lg bg-gold/20 px-3 py-2 text-xs text-navy">
              {a}
            </p>
          ))}
          {retenues.map((r, i) => {
            const maj = (champ: Partial<Retenue>) => setRetenues(retenues.map((x, j) => (j === i ? { ...x, ...champ } : x)));
            if (r.demandeId) {
              // Acompte d'une demande acceptée : ajouté et recalculé par le serveur, non modifiable ici.
              return (
                <div key={r.demandeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{r.libelle}</span>
                    <span className="ml-1 text-xs text-navy/60">demande acceptée, ajoutée automatiquement</span>
                  </span>
                  <span className="tabular-nums">− {eur(r.montant)} €</span>
                </div>
              );
            }
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className="input w-auto !py-1.5" value={r.type} onChange={(e) => maj({ type: e.target.value as TypeRetenue })} aria-label="Type de retenue">
                  {(Object.keys(LIBELLE_RETENUE) as TypeRetenue[]).map((t) => (
                    <option key={t} value={t}>
                      {LIBELLE_RETENUE[t]}
                    </option>
                  ))}
                </select>
                <input className="input min-w-0 flex-1 !py-1.5" placeholder="Précision (créancier…)" value={r.libelle} onChange={(e) => maj({ libelle: e.target.value })} aria-label="Précision" />
                <input className="input w-32 !py-1.5" placeholder="Réf. dossier" value={r.reference ?? ""} onChange={(e) => maj({ reference: e.target.value })} aria-label="Référence" />
                <input
                  className="input w-28 !py-1.5 tabular-nums"
                  type="number"
                  step="0.01"
                  min="0"
                  value={r.montant || ""}
                  onChange={(e) => maj({ montant: Math.max(0, Number(e.target.value)) })}
                  aria-label="Montant"
                />
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-orange-ink" onClick={() => setRetenues(retenues.filter((_, j) => j !== i))}>
                  Retirer
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" onClick={() => setRetenues([...retenues, { type: "acompte", libelle: "", montant: 0 }])}>
              + Acompte ou saisie
            </button>
            {retenues.some((r) => r.type === "saisie" || r.type === "atd") && (
              <div className="w-48">
                <Field label="Personnes à charge" value={personnesACharge} onChange={setPersonnesACharge} step="1" />
              </div>
            )}
          </div>
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
                ...(bulletin.totalRetenues > 0 ? [["Acomptes et saisies", -bulletin.totalRetenues] as [string, number]] : []),
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
                          <td>
                            {l.libelle}
                            {l.mention && <span className="ml-1 text-xs text-navy/55">· {l.mention}</span>}
                          </td>
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
                ["Total dû (net + indemnités)", bulletin.totalDu ?? 0],
                ["Assiette CSG/CRDS", bulletin.assietteCsg ?? 0],
                ["Réintégration fiscale santé", bulletin.reintegrationSante ?? 0],
                ["Net imposable", bulletin.netImposable],
                [`Impôt sur le revenu prélevé à la source (${bulletin.typeTauxPas ? `${LIBELLE_TYPE_TAUX_PAS[bulletin.typeTauxPas].toLowerCase()}, ` : ""}${eur(bulletin.tauxPas)} %)`, bulletin.montantPas],
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
              Heures décomptées au mois. Arrêts, congés payés (maintien ou dixième) et sortie calculés selon des règles simplifiées documentées ;
              entrée en cours de mois ou décompte trimestriel : à ajuster en prime ou retenue. L&apos;employeur reste responsable du bulletin.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
