import { utilisateurCourant } from "@/lib/acces/modules-requete";
import { lireAccuseIndicatif } from "@/lib/legal/accuse-indicatif-serveur";
import { MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";
import { AccuseIndicatif } from "@/components/legal/AccuseIndicatif";

/**
 * Note discrète « document indicatif » en tête des écrans paie, TICPE et
 * carburant. Pour la direction et le comptable, ajoute la case d'accusé de
 * lecture (une fois par organisation, tracée au journal d'audit).
 */
export async function BandeauIndicatif({ accuse = true }: { accuse?: boolean }) {
  const appUser = accuse ? await utilisateurCourant() : null;
  const peutAccuser = !!appUser && (appUser.role === "direction" || appUser.role === "comptable");
  const deja = peutAccuser ? await lireAccuseIndicatif(appUser.organization_id) : null;
  return (
    <div role="note" className="mb-4 rounded-xl border border-navy/10 bg-navy/[0.03] px-4 py-2.5 text-xs text-navy/75 sm:text-sm print:hidden">
      <p>
        <span className="font-semibold">Outil d&apos;aide à l&apos;organisation.</span> {MENTION_INDICATIVE}
      </p>
      {peutAccuser && <AccuseIndicatif accuseInitial={deja} />}
    </div>
  );
}
