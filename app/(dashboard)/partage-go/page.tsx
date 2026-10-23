import { garderPage } from "@/lib/acces/garde-page";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader, Card } from "@/components/ui";
import { PartageGo } from "@/components/partage-go/PartageGo";
import { chargerPartageGo } from "@/lib/partage-go/donnees";
import { MESSAGE_MIGRATION_PARTAGE_GO, prenomDe } from "@/lib/partage-go/apporteur";
import { DUREE_ESSAI_JOURS } from "@/lib/go-navigation/offre";

/**
 * « Faire essayer GO » : mon lien personnel (copier, SMS, WhatsApp, QR),
 * mes invitations à usage unique et leur statut. La direction voit en plus
 * la synthèse par apporteur de l'organisation et désigne qui peut faire
 * essayer GO. Les invités n'ont accès qu'à l'interface GO Navigation /
 * Tournée colis (essai de 30 jours, offre existante).
 */
export default async function PartageGoPage() {
  const g = await garderPage("partage.go");
  if (!g.ok) return g.ecran;
  const vue = await chargerPartageGo(createAdminSupabaseClient(), g.appUser);

  return (
    <div>
      <PageHeader
        title="Faire essayer GO"
        description={`Invitez un chauffeur ou un confrère à essayer GO Navigation (Tournée colis) gratuitement pendant ${DUREE_ESSAI_JOURS} jours. Votre lien permet de savoir qui a partagé.`}
      />
      {vue.migrationManquante ? (
        <Card>
          <p className="text-sm text-navy/70">{MESSAGE_MIGRATION_PARTAGE_GO}</p>
        </Card>
      ) : (
        <PartageGo vue={vue} prenom={prenomDe(g.appUser.full_name)} />
      )}
    </div>
  );
}
