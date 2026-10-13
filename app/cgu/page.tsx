import Link from "next/link";
import { Article, LegalPageLayout, listeLegale } from "@/components/legal/LegalPageLayout";
import { EDITEUR, designationEditeur } from "@/lib/legal/editeur";

export const metadata = { title: "Conditions générales d'utilisation — GODAC" };

const lien = "text-teal-ink hover:underline";

/** CGU : s'imposent à chaque utilisateur (direction, encadrement, chauffeurs). Le contrat commercial relève des CGV. */
export default function CguPage() {
  return (
    <LegalPageLayout title="Conditions d'utilisation" contractuel>
      <p>
        Les présentes conditions générales d’utilisation (« CGU ») s’appliquent à toute personne qui utilise
        l’application GODAC ou l’application mobile GODAC Livreur (« l’Utilisateur »), éditées par {designationEditeur()}{" "}
        (« l’Éditeur »). L’accès est fourni par l’entreprise qui a souscrit l’abonnement (« l’Entreprise »), employeur ou
        donneur d’ordre de l’Utilisateur ; le contrat entre l’Éditeur et l’Entreprise relève des{" "}
        <Link href="/cgv" className={lien}>conditions générales de vente</Link>.
      </p>

      <Article n={1} titre="Objet">
        <p>
          GODAC est un logiciel de gestion pour les entreprises de transport routier : carburant, flotte, planning et
          tournées, pointage, congés, messagerie, tournées colis et, selon l’abonnement de l’Entreprise, paie, amendes et
          contestations clients.
        </p>
      </Article>

      <Article n={2} titre="Compte">
        <ul className={listeLegale}>
          <li>Le compte est nominatif et créé ou validé par l’Entreprise, qui attribue le rôle de chaque Utilisateur.</li>
          <li>L’Utilisateur garde ses identifiants (code PIN, lien de connexion, clé d’accès) confidentiels et signale toute utilisation anormale.</li>
          <li>L’Entreprise peut désactiver un compte à tout moment, notamment au départ du salarié : l’accès est alors coupé immédiatement.</li>
        </ul>
      </Article>

      <Article n={3} titre="Bon usage">
        <ul className={listeLegale}>
          <li>Saisir des informations exactes (pleins, kilométrages, pointages, livraisons) et ne pas usurper l’identité d’un autre Utilisateur.</li>
          <li>Ne publier dans la messagerie aucun contenu illicite, injurieux ou contraire à la confidentialité de l’Entreprise.</li>
          <li>Ne pas utiliser l’application au volant, véhicule en mouvement : les actions se font à l’arrêt.</li>
          <li>Ne pas tenter d’accéder aux données d’autres Utilisateurs ou d’autres entreprises, ni perturber le service.</li>
        </ul>
      </Article>

      <Article n={4} titre="Données personnelles">
        <p>
          Les données de l’Utilisateur sont traitées pour le compte de l’Entreprise, responsable de traitement ; l’Éditeur agit
          comme sous-traitant. Le détail figure dans la{" "}
          <Link href="/confidentialite" className={lien}>politique de confidentialité</Link>. La position GPS n’est relevée
          qu’au moment du pointage et, pour les chauffeurs, pendant une tournée colis en cours (suivi de la livraison par
          l’Entreprise, dernière position seulement, effacée à la clôture, masquable pendant une pause). En dehors de ces
          moments, GODAC ne suit jamais les déplacements.
        </p>
      </Article>

      <Article n={5} titre="Disponibilité">
        <p>
          L’Éditeur s’efforce de rendre le service accessible en permanence, sous réserve des opérations de maintenance et
          des aléas des réseaux, dans les conditions de l’<Link href="/sla" className={lien}>engagement de service</Link>{" "}
          souscrit par l’Entreprise.
        </p>
      </Article>

      <Article n={6} titre="Propriété intellectuelle">
        <p>
          L’application, la marque GODAC et leurs contenus sont protégés. L’Utilisateur bénéficie d’un droit d’usage limité à
          son activité pour l’Entreprise, pendant la durée de son accès.
        </p>
      </Article>

      <Article n={7} titre="Contact et droit applicable">
        <p>
          Pour toute question : <a href={`mailto:${EDITEUR.email}`} className={lien}>{EDITEUR.email}</a>, ou en priorité
          l’Entreprise. Les présentes CGU sont soumises au droit français.
        </p>
      </Article>
    </LegalPageLayout>
  );
}
