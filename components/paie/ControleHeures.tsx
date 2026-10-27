import { Card } from "@/components/ui";
import { LIBELLE_ORIGINE, LIBELLE_SOURCE_HEURES, type HeuresDuMois } from "@/lib/paie/heures";
import { MENTION_A_VALIDER } from "@/lib/pays/temps-travail";
import { LIBELLE_CONTROLE_REPOS, type AvertissementRepos } from "@/lib/time-clock/repos";

const jourLong = (j: string) => new Date(`${j}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const heure = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "—");
const hm = (h: number) => `${Math.floor(h)} h ${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, "0")}`;

/**
 * Contrôle des heures préremplies sur le bulletin : par jour, l'heure de
 * début et de fin retenues et leur source (pointage, planning prévu,
 * départ / retour de tournée), la pause déduite, puis les alertes. Le
 * total reste modifiable dans le formulaire du bulletin.
 */
export function ControleHeures({ controle, repos = [] }: { controle: HeuresDuMois; repos?: AvertissementRepos[] }) {
  const alertesParJour = new Map<string, string[]>();
  for (const a of controle.alertes) alertesParJour.set(a.jour, [...(alertesParJour.get(a.jour) ?? []), a.message]);
  const jours = new Set([...controle.jours.map((j) => j.jour), ...controle.alertes.map((a) => a.jour)]);
  const lignes = [...jours].sort();
  const parJour = new Map(controle.jours.map((j) => [j.jour, j]));
  return (
    <Card className="mb-5 !p-0">
      <details open={controle.alertes.length > 0 || repos.length > 0}>
        <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          <span className="font-semibold">Contrôle des heures</span>
          <span className="text-navy/70">
            {hm(controle.total)} sur {controle.joursTravailles} jour{controle.joursTravailles > 1 ? "s" : ""}
          </span>
          {repos.length > 0 && (
            <span className="badge-orange">
              {repos.length} avertissement{repos.length > 1 ? "s" : ""} de repos
            </span>
          )}
          {controle.alertes.length > 0 ? (
            <span className="badge-orange">
              {controle.alertes.length} point{controle.alertes.length > 1 ? "s" : ""} à vérifier
            </span>
          ) : (
            <span className="badge-teal">Aucune anomalie</span>
          )}
        </summary>
        <div className="border-t border-navy/5 px-4 pb-4 pt-2">
          <p className="mb-2 text-xs text-navy/60">Règle : {LIBELLE_SOURCE_HEURES[controle.source]} (Équipe › Paie › Réglages). Le total prérempli reste modifiable ci-dessous.</p>
          {repos.length > 0 && (
            <div className="mb-3 rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink" role="note">
              <p className="font-semibold">Repos et durée du travail : à vérifier</p>
              <ul className="mt-1 list-disc pl-5">
                {repos.map((a, i) => (
                  <li key={`${a.code}-${a.jour}-${i}`}>
                    <span className="font-medium">{LIBELLE_CONTROLE_REPOS[a.code]}.</span> {a.message}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Avertissements non bloquants, {MENTION_A_VALIDER}.</p>
            </div>
          )}
          {lignes.length === 0 ? (
            <p className="text-sm text-navy/60">Aucune heure ni absence ce mois-ci.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-navy/55">
                  <tr>
                    <th className="pb-1">Jour</th>
                    <th className="pb-1">Début</th>
                    <th className="pb-1">Fin</th>
                    <th className="pb-1 text-right">Pause</th>
                    <th className="pb-1 text-right">Heures</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lignes.map((j) => {
                    const l = parJour.get(j);
                    return (
                      <tr key={j} className="border-t border-navy/5 align-top">
                        <td className="py-1.5 pr-2">{jourLong(j)}</td>
                        {l?.absence && !l.heures ? (
                          <td colSpan={4} className="py-1.5 text-navy/60">
                            {l.absence === "arret" ? "Arrêt de travail" : "Congé"} : aucune heure attendue
                          </td>
                        ) : (
                          <>
                            <td className="py-1.5 pr-2">
                              {heure(l?.debut ?? null)} {l?.origineDebut && <span className="text-xs text-navy/55">({LIBELLE_ORIGINE[l.origineDebut]})</span>}
                            </td>
                            <td className="py-1.5 pr-2">
                              {heure(l?.fin ?? null)} {l?.origineFin && <span className="text-xs text-navy/55">({LIBELLE_ORIGINE[l.origineFin]})</span>}
                            </td>
                            <td className="py-1.5 text-right">{l?.pauseMinutes ? `${l.pauseMinutes} min` : "—"}</td>
                            <td className="py-1.5 text-right font-medium">{l ? hm(l.heures) : "0 h 00"}</td>
                          </>
                        )}
                      </tr>
                    );
                  }).flatMap((ligne, i) => {
                    const alertes = alertesParJour.get(lignes[i]!) ?? [];
                    return alertes.length
                      ? [
                          ligne,
                          <tr key={`${lignes[i]}-a`}>
                            <td colSpan={5} className="pb-2 text-xs text-orange-ink">
                              {alertes.join(" ")}
                            </td>
                          </tr>,
                        ]
                      : [ligne];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
