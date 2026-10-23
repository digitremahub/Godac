import { Card } from "@/components/ui";
import type { ResumeApporteurStaff } from "@/lib/partage-go/staff";

/**
 * Staff GODAC : synthèse par apporteur (inscrits, essais en cours, passés
 * clients payants). Suivi seulement : aucun calcul de commission.
 */
export function ResumeApporteursStaff({ lignes }: { lignes: ResumeApporteurStaff[] }) {
  return (
    <Card className="mt-6 overflow-x-auto">
      <h2 className="mb-1 text-lg">Apporteurs</h2>
      <p className="mb-3 text-sm text-navy/65">Personnes des organisations clientes qui ont fait essayer GO. Clients payants = organisation d&apos;essai avec un abonnement actif.</p>
      {lignes.length === 0 ? (
        <p className="text-sm text-navy/60">Aucun compte d&apos;essai attribué à un apporteur pour l&apos;instant.</p>
      ) : (
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-navy/60">
            <tr>
              <th className="pb-2">Apporteur</th>
              <th className="pb-2">Organisation</th>
              <th className="pb-2">Inscrits</th>
              <th className="pb-2">Essais en cours</th>
              <th className="pb-2">Essais terminés</th>
              <th className="pb-2">Clients payants</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.userId} className="border-t border-navy/5">
                <td className="py-2">{l.nom}</td>
                <td className="py-2">{l.organisation ?? "—"}</td>
                <td className="py-2">{l.inscrits}</td>
                <td className="py-2">{l.enCours}</td>
                <td className="py-2">{l.termines}</td>
                <td className="py-2">{l.clients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
