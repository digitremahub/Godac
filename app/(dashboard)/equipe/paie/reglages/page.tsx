import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";
import { ReglagesPaieForm, type Reglages } from "@/components/paie/ReglagesPaieForm";
import { FRAIS_CONVENTIONNELS, parametresLegauxAu } from "@/lib/paie/parametres";

export default async function ReglagesPaiePage() {
  const g = await garderPage("equipe.paie_reglages");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return <EmptyState title={`Paie : ${pays.drapeau} ${pays.nom}`} description={paieIndisponible(pays)} />;
  const { data: r } = await supabase.from("payroll_settings").select("*").eq("organization_id", appUser.organization_id).maybeSingle();
  const legal = parametresLegauxAu(new Date().toISOString().slice(0, 10));

  const initial: Reglages = {
    headcount: r?.headcount ?? 1,
    accident_rate: Number(r?.accident_rate ?? 0),
    mobility_rate: Number(r?.mobility_rate ?? 0),
    prevoyance_salarial_rate: Number(r?.prevoyance_salarial_rate ?? 0),
    prevoyance_patronal_rate: Number(r?.prevoyance_patronal_rate ?? 0),
    mutuelle_salarial_amount: Number(r?.mutuelle_salarial_amount ?? 0),
    mutuelle_patronal_amount: Number(r?.mutuelle_patronal_amount ?? 0),
    meal_allowance: r?.meal_allowance ?? null,
    single_meal_allowance: r?.single_meal_allowance ?? null,
    snack_allowance: r?.snack_allowance ?? null,
    overnight_allowance: r?.overnight_allowance ?? null,
  };

  return (
    <div>
      <PageHeader
        title="Paie & salaires"
        description={`Ce qui est propre à votre entreprise. Les taux légaux (SMIC ${legal.smicHoraire.toFixed(2).replace(".", ",")} €, plafond de la Sécurité sociale ${legal.pmss.toLocaleString("fr-FR")} €, cotisations) sont tenus à jour par GODAC.`}
      />
      <h2 className="mb-3 text-lg">Réglages de paie</h2>
      <ReglagesPaieForm
        initial={initial}
        defauts={{
          meal_allowance: FRAIS_CONVENTIONNELS.repas,
          single_meal_allowance: FRAIS_CONVENTIONNELS.repasUnique,
          snack_allowance: FRAIS_CONVENTIONNELS.cassecroute,
          overnight_allowance: FRAIS_CONVENTIONNELS.grandDeplacement,
        }}
      />
    </div>
  );
}
