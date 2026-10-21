import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { csvRegistre } from "@/lib/registre/personnel";
import { lireRegistre, organisationPdf } from "@/lib/registre/serveur";
import { genererRegistrePdf } from "@/lib/paie/pdf-registres";

export const maxDuration = 60;

/** Registre unique du personnel, en CSV ou en PDF (direction seulement). */
export async function GET(req: Request) {
  const g = await garderApi({ ecran: "equipe.registre" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const { entrees } = await lireRegistre(supabase);
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "registre_personnel_export", details: { format, salaries: entrees.length } });

  const entetes = (nom: string, type: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${nom}"`,
    "Cache-Control": "no-store",
  });
  if (format === "csv") return new NextResponse(csvRegistre(entrees), { headers: entetes(`Registre du personnel ${jour}.csv`, "text/csv; charset=utf-8") });
  try {
    const pdf = await genererRegistrePdf({
      organisation: await organisationPdf(supabase, appUser.organization_id),
      entrees,
      dateEdition: new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
    });
    return new NextResponse(new Uint8Array(pdf), { headers: entetes(`Registre du personnel ${jour}.pdf`, "application/pdf") });
  } catch (e) {
    console.error("registre: PDF impossible", e);
    return NextResponse.json({ error: "Échec de la génération du PDF." }, { status: 500 });
  }
}
