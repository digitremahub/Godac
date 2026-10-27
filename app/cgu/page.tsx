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
          contestations clients. C’est un outil d’organisation et de gain de temps, qui ne remplace ni le jugement de
          l’Utilisateur ni les vérifications de l’Entreprise (article 6).
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
          l’Entreprise : dernière position effacée à la clôture, trajet emprunté conservé 1 an pour l’analyse des trajets,
          masquable pendant une pause). Si l’Entreprise utilise le pointage assisté, la position est aussi lue environ
          toutes les minutes, application ouverte et visible (4 heures au plus), pour détecter l’arrivée au dépôt ou la
          sortie : seule l’heure de la dernière présence au dépôt est mémorisée, pas le trajet. En dehors de ces
          moments, GODAC ne suit jamais les déplacements, et l’Entreprise ne doit pas utiliser ces données pour surveiller
          l’Utilisateur hors de son temps de travail.
        </p>
      </Article>

      <Article n={5} titre="Essai GO Navigation : statistiques d’usage">
        <ul className={listeLegale}>
          <li>
            Pendant l’essai, l’Éditeur mesure l’usage de manière agrégée et anonyme (nombre de tournées, fonctions utilisées) afin
            d’améliorer le service.
          </li>
          <li>
            Le détail de l’usage (tournées, étapes, horaires) n’est consulté qu’avec l’accord facultatif de l’Utilisateur, donné à
            l’inscription ou depuis « Mon compte », et retirable à tout moment. Le refus ou le retrait n’a aucune incidence sur
            l’essai.
          </li>
          <li>Les noms et adresses des clients finaux de l’Utilisateur ne sont pas consultés par ce biais.</li>
        </ul>
        <p>
          Voir la <Link href="/confidentialite" className={lien}>politique de confidentialité</Link> pour les durées de conservation.
        </p>
      </Article>

      <Article n={6} titre="Résultats et vérification">
        <p>
          Les calculs et documents produits par GODAC (bulletins de paie, heures, congés, TICPE, consommations de carburant)
          sont établis à titre indicatif à partir des paramètres de l’Entreprise, qui reste responsable de les vérifier avec
          son expert-comptable ou son responsable paie avant tout usage déclaratif. Un Utilisateur qui constate une
          anomalie la signale à l’Entreprise ou à l’Éditeur ; GODAC fournit des paramètres par défaut sans valeur de conseil
          juridique, fiscal, comptable ou social. Voir l’article 13 des{" "}
          <Link href="/cgv#article-13" className={lien}>conditions générales de vente</Link>.
        </p>
      </Article>

      <Article n={7} titre="Disponibilité">
        <p>
          L’Éditeur s’efforce de rendre le service accessible en permanence, sous réserve des opérations de maintenance et
          des aléas des réseaux, dans les conditions de l’<Link href="/sla" className={lien}>engagement de service</Link>{" "}
          souscrit par l’Entreprise.
        </p>
      </Article>

      <Article n={8} titre="Propriété intellectuelle">
        <p>
          L’application, la marque GODAC et leurs contenus sont protégés. L’Utilisateur bénéficie d’un droit d’usage limité à
          son activité pour l’Entreprise, pendant la durée de son accès.
        </p>
      </Article>

      <Article n={9} titre="Contact et droit applicable">
        <p>
          Pour toute question : <a href={`mailto:${EDITEUR.email}`} className={lien}>{EDITEUR.email}</a>, ou en priorité
          l’Entreprise. Les présentes CGU sont soumises au droit français.
        </p>
      </Article>
    </LegalPageLayout>
  );
}
