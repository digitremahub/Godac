import Link from "next/link";
import type { UserRole } from "@/lib/types/domain";
import { libelleModule, libelleRoles, titreReserve, type FormuleMin } from "@/lib/acces/catalogue";

const FORMULES: Record<FormuleMin, string> = { essentiel: "Essentiel", starter: "Starter", pro: "Pro", business: "Business" };

/** Lien vers l'onglet Modules de l'administration, ancré sur le module. */
export function lienActivationModule(cle: string): string {
  return `/admin/abonnement?vue=modules#module-${cle}`;
}

type Props =
  | { motif: "role"; ecran?: string; rolesAutorises: readonly UserRole[] }
  | { motif: "module"; ecran?: string; modules: readonly string[]; direction: boolean; formuleMin?: FormuleMin }
  | { motif: "limite"; titre?: string; utilise: number; inclus: number; unite: string; formule?: string; direction: boolean }
  | { motif: "pays"; ecran?: string; texte?: string };

/**
 * Message unique pour tout refus d'accès de l'espace connecté : module
 * non activé, écran réservé à certains rôles, limite de formule, pays.
 * Remplace les EmptyState « Accès réservé » et redirections silencieuses.
 */
export function EtatAcces(props: Props) {
  let titre: string;
  let texte: React.ReactNode;
  let action: React.ReactNode = (
    <Link href="/dashboard" className="btn-secondary !py-2 text-sm">
      Retour à l&apos;accueil
    </Link>
  );

  switch (props.motif) {
    case "role":
      titre = titreReserve(props.rolesAutorises);
      texte = (
        <>
          {props.ecran ? <>« {props.ecran} » est accessible aux profils : </> : <>Accessible aux profils : </>}
          <strong>{libelleRoles(props.rolesAutorises)}</strong>. Si vous pensez devoir y accéder, demandez à la direction de modifier votre rôle.
        </>
      );
      break;
    case "module": {
      const noms = props.modules.map(libelleModule);
      titre = noms.length === 1 ? `Module ${noms[0]} non activé` : `Modules non activés : ${noms.join(" ou ")}`;
      const inclus = props.formuleMin ? ` Inclus à partir de la formule ${FORMULES[props.formuleMin]}.` : "";
      if (props.direction) {
        texte = `Activez-le depuis l'onglet Modules de votre abonnement : l'activation est immédiate pendant l'essai.${inclus}`;
        action = (
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={lienActivationModule(props.modules[0] ?? "")} className="btn-primary !py-2 text-sm">
              Activer ce module
            </Link>
            <Link href="/dashboard" className="btn-secondary !py-2 text-sm">
              Retour à l&apos;accueil
            </Link>
          </div>
        );
      } else {
        texte = `Demandez à la direction de l'activer.${inclus}`;
      }
      break;
    }
    case "limite":
      titre = props.titre ?? "Limite de votre formule atteinte";
      texte = (
        <>
          {props.utilise} {props.unite} utilisés pour {props.inclus} inclus{props.formule ? ` dans la formule ${props.formule}` : ""}.
          {props.direction ? " Passez à la formule supérieure pour continuer." : " Prévenez la direction."}
        </>
      );
      if (props.direction) {
        action = (
          <Link href="/admin/abonnement" className="btn-primary !py-2 text-sm">
            Changer de formule
          </Link>
        );
      }
      break;
    case "pays":
      titre = "Non disponible dans votre pays";
      texte = props.texte ?? (props.ecran ? `« ${props.ecran} » ne s'applique pas au pays de votre entreprise.` : undefined);
      break;
  }

  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-navy/15 bg-surface/60 px-6 py-14 text-center">
      <div aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy/[0.05] text-navy/40">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <p className="font-semibold text-navy">{titre}</p>
      {texte && <p className="max-w-md text-pretty text-sm text-navy/65">{texte}</p>}
      {action}
    </div>
  );
}
