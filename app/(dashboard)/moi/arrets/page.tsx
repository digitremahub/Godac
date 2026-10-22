import { garderPage } from "@/lib/acces/garde-page";
import { Card, PageHeader } from "@/components/ui";
import { DeclarerArret } from "@/components/arrets/DeclarerArret";
import { ListeMesArrets } from "@/components/arrets/ListeMesArrets";
import { arretsProlongeables } from "@/lib/arrets/declaration";
import { liensDocuments, lireArrets } from "@/lib/arrets/serveur";
import { parisDay } from "@/lib/utils/paris-time";

/** Mon espace › Mes demandes › Arrêts : déclarer un arrêt de travail, suivre son statut. */
export default async function MesArretsPage({ searchParams }: { searchParams: Promise<{ nouveau?: string }> }) {
  const g = await garderPage("moi.arrets");
  if (!g.ok) return g.ecran;
  const { appUser, supabase, modules } = g;
  const sp = await searchParams;
  const { lignes, declarationActive } = await lireArrets(supabase, { userId: appUser.id, limite: 50 });
  const liens = await liensDocuments(supabase, lignes.flatMap((a) => a.documents));
  const prolongeables = arretsProlongeables(lignes, parisDay()).map((a) => ({ id: a.id, userId: a.userId, type: a.type, du: a.du, au: a.au }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Mes arrêts de travail" description="Vous êtes en arrêt ? Envoyez la photo de votre avis : votre responsable et le planning sont prévenus, vos heures et votre bulletin en tiennent compte." />
      {declarationActive ? (
        <DeclarerArret organizationId={appUser.organization_id} moi={appUser.id} prolongeables={prolongeables} lectureAuto={modules.has("ocr")} ouvert={sp.nouveau === "1"} />
      ) : (
        <Card className="text-sm text-navy/70">La déclaration en ligne arrive bientôt : en attendant, remettez votre avis d&apos;arrêt à votre responsable.</Card>
      )}
      <section>
        <h2 className="mb-2 text-base">Mes arrêts</h2>
        <ListeMesArrets arrets={lignes} liens={liens} />
      </section>
    </div>
  );
}
