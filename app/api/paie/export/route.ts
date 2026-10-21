import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { moisValide } from "@/lib/paie/donnees";
import { csvComplet, csvVariables } from "@/lib/paie/export-comptable";
import { donneesMois, variablesDuMois } from "@/lib/paie/export-serveur";
import { genererJournalPdf } from "@/lib/paie/pdf-registres";
import { organisationPdf } from "@/lib/registre/serveur";
import { creerZip } from "@/lib/paie/zip";
import { nomFichier } from "@/lib/paie/csv";

export const maxDuration = 60;

const FORMATS = ["complet", "variables", "journal"] as const;
type Format = (typeof FORMATS)[number];

function fichier(contenu: Uint8Array | string, nom: string, type: string) {
  return new NextResponse(typeof contenu === "string" ? contenu : new Uint8Array(contenu), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${nomFichier(nom)}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Export du mois pour le comptable (direction, comptable) :
 *  - format=complet : CSV des bulletins (une ligne par salarié) ;
 *  - format=variables : CSV des éléments variables (entrées brutes) ;
 *  - format=journal : journal de paie en PDF ;
 *  - pdf=1 avec un CSV : archive ZIP du CSV et du journal PDF.
 * Les contrôles (bulletins non validés, salariés sans bulletin, écarts)
 * sont affichés sur l'écran d'export ; ils ne bloquent pas le fichier.
 */
export async function GET(req: Request) {
  const g = await garderApi({ ecran: "equipe.paie_export" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const url = new URL(req.url);
  const mois = url.searchParams.get("mois") ?? "";
  const format = (url.searchParams.get("format") ?? "complet") as Format;
  if (!moisValide(mois) || !FORMATS.includes(format)) return NextResponse.json({ error: "Mois ou format invalide." }, { status: 400 });
  const avecPdf = url.searchParams.get("pdf") === "1" || format === "journal";

  const d = await donneesMois(supabase, mois);
  const base = format === "variables" ? `Elements variables ${mois}` : `Paie ${mois}`;
  const csv = format === "complet" ? csvComplet(mois, d.salaries, d.bulletins) : format === "variables" ? csvVariables(mois, await variablesDuMois(supabase, appUser.organization_id, d)) : null;

  let pdf: Buffer | null = null;
  if (avecPdf) {
    try {
      pdf = await genererJournalPdf({
        libelleMois: d.libelle,
        organisation: await organisationPdf(supabase, appUser.organization_id),
        lignes: d.journal,
        totaux: d.totaux,
        dateEdition: new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
      });
    } catch (e) {
      console.error("paie: journal PDF impossible", e);
      return NextResponse.json({ error: "Échec de la génération du journal de paie." }, { status: 500 });
    }
  }

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_export_comptable",
    details: { mois, format, pdf: Boolean(pdf), bulletins: d.bulletins.length, controles: d.controles.filter((c) => c.niveau === "avertissement").length },
  });

  if (!csv) return fichier(pdf!, `Journal de paie ${mois}.pdf`, "application/pdf");
  if (!pdf) return fichier(csv, `${base}.csv`, "text/csv; charset=utf-8");
  const zip = creerZip([
    { nom: `${base}.csv`, contenu: csv },
    { nom: `Journal de paie ${mois}.pdf`, contenu: pdf },
  ]);
  return fichier(zip, `${base}.zip`, "application/zip");
}
