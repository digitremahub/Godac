import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { ROLES_GENERATION } from "@/lib/paie/validation";
import { contextePaie } from "@/lib/paie/donnees";
import { calculerBulletin } from "@/lib/paie/calcul";
import { genererDocumentSortie, type DonneesDocumentSortie, type TypeDocumentSortie } from "@/lib/paie/documents-sortie";
import { LIBELLE_MOTIF } from "@/lib/paie/sortie";
import type { Bulletin } from "@/lib/paie/types";

export const maxDuration = 60;

const TYPES: TypeDocumentSortie[] = ["certificat", "solde", "france-travail"];
const PREAVIS: Record<string, string> = { effectue: "Effectué", paye: "Non effectué, payé (indemnité compensatrice)", non_paye: "Dispensé, non payé", sans: "Sans préavis" };
const fr = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : null);

/**
 * Documents de sortie en PDF : ?doc=certificat | solde | france-travail.
 * Le solde de tout compte reprend le bulletin du mois de sortie s'il est
 * généré, sinon une estimation calculée à partir des données du mois.
 */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const g = await garderApi({ roles: ROLES_GENERATION, modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { userId } = await params;
  const type = new URL(req.url).searchParams.get("doc") as TypeDocumentSortie | null;
  if (!type || !TYPES.includes(type)) return NextResponse.json({ error: "Document inconnu." }, { status: 400 });

  const { data: sortie, error: erreurSortie } = await supabase.from("employee_exits").select("*").eq("user_id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (erreurSortie || !sortie) return NextResponse.json({ error: "Enregistrez d'abord la sortie du salarié." }, { status: 404 });
  const dateSortie = String(sortie.exit_date);
  const mois = dateSortie.slice(0, 7);

  const [{ data: employe }, { data: organisation }, { data: dossier }, { data: historique }] = await Promise.all([
    supabase.from("users").select("id, full_name, role_title, address").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle(),
    supabase.from("organizations").select("name, siret, legal_address, ape_code, convention_collective, urssaf_number, logo_url, accent_color").eq("id", appUser.organization_id).single(),
    supabase.from("employee_files").select("matricule, social_security_number, hire_date, contract_type").eq("user_id", userId).maybeSingle(),
    supabase
      .from("payslips")
      .select("period_start, gross_amount, details")
      .eq("user_id", userId)
      .eq("validation_status", "valide")
      .lte("period_start", `${mois}-01`)
      .order("period_start", { ascending: false })
      .limit(12),
  ]);
  if (!employe) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });

  // Bulletin du mois de sortie : celui généré, sinon une estimation.
  const ctx = await contextePaie(supabase, appUser.organization_id, userId, mois);
  let bulletin: Bulletin | null = null;
  let estimation = false;
  if (ctx.bulletinExistant) {
    const { data } = await supabase.from("payslips").select("details").eq("id", ctx.bulletinExistant.id).maybeSingle();
    bulletin = (data?.details as Bulletin | null) ?? null;
  }
  if (!bulletin && ctx.profilComplet) {
    const { joursTravailles: _j, ...variables } = ctx.prefill;
    bulletin = calculerBulletin({ legal: ctx.legal, entreprise: ctx.entreprise, salarie: ctx.salarie, variables, periode: { debut: ctx.debut, fin: ctx.fin } });
    estimation = true;
  }

  const sommes = bulletin
    ? [
        { libelle: "Salaire brut du mois de sortie (dont indemnités soumises)", montant: bulletin.brut },
        { libelle: "Cotisations et contributions salariales", montant: -bulletin.totalSalarial },
        ...bulletin.lignes.filter((l) => l.section === "net" && l.gain && (l.montantSalarial ?? 0) > 0).map((l) => ({ libelle: l.libelle, montant: l.montantSalarial ?? 0 })),
        { libelle: "Impôt sur le revenu prélevé à la source", montant: -bulletin.montantPas },
        ...(bulletin.totalRetenues > 0 ? [{ libelle: "Acomptes et saisies", montant: -bulletin.totalRetenues }] : []),
      ]
    : [];
  const indemnites = bulletin
    ? bulletin.lignes
        .filter((l) => /^Indemnité (compensatrice|de licenciement|spécifique)/.test(l.libelle) && (l.montantSalarial ?? 0) > 0)
        .map((l) => ({ libelle: l.libelle, montant: l.montantSalarial ?? 0 }))
    : [];

  const d: DonneesDocumentSortie = {
    employeur: {
      nom: organisation?.name ?? "Employeur",
      adresse: organisation?.legal_address ?? null,
      siret: organisation?.siret ?? null,
      ape: organisation?.ape_code ?? null,
      urssaf: organisation?.urssaf_number ?? null,
      convention: organisation?.convention_collective ?? null,
      logoUrl: organisation?.logo_url ?? null,
      accent: organisation?.accent_color ?? null,
    },
    salarie: {
      nom: employe.full_name,
      adresse: employe.address ?? null,
      secu: dossier?.social_security_number ?? null,
      matricule: dossier?.matricule ?? null,
      emploi: employe.role_title ?? null,
      contrat: dossier?.contract_type ? String(dossier.contract_type).toUpperCase() : null,
    },
    entree: fr(dossier?.hire_date),
    sortie: fr(dateSortie)!,
    motif: LIBELLE_MOTIF[sortie.reason as keyof typeof LIBELLE_MOTIF] ?? String(sortie.reason),
    emplois: String(sortie.jobs_held ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    preavis: `${PREAVIS[String(sortie.notice_type)] ?? "—"}${sortie.notice_days ? ` (${Number(sortie.notice_days)} jours)` : ""}`,
    sommes,
    netVerse: bulletin?.netAPayer ?? 0,
    estimation,
    salaires: (historique ?? [])
      .slice()
      .reverse()
      .map((p) => {
        const det = p.details as Bulletin | null;
        return {
          mois: new Date(`${p.period_start}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
          brut: Math.round((Number(p.gross_amount ?? 0) - Number(det?.ijssBrutes ?? 0)) * 100) / 100,
          heures: det?.heures ? Math.round((det.heures.base + det.heures.sup25 + det.heures.sup50) * 100) / 100 : null,
        };
      }),
    indemnites,
    dateEdition: new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
    lieu: null,
  };

  try {
    const pdf = await genererDocumentSortie(type, d);
    const nom = { certificat: "certificat-de-travail", solde: "solde-de-tout-compte", "france-travail": "donnees-attestation-france-travail" }[type];
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nom}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("paie: document de sortie impossible", e);
    return NextResponse.json({ error: "Échec de la génération du PDF." }, { status: 500 });
  }
}
