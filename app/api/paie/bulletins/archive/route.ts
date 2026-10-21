import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { creerZip, type FichierZip } from "@/lib/paie/zip";
import { nomFichier } from "@/lib/paie/csv";

export const maxDuration = 60;

/**
 * Archive ZIP des bulletins VALIDÉS :
 *  - par défaut, les siens (tout salarié) : ses bulletins restent à lui
 *    quoi qu'il advienne de l'abonnement de l'entreprise ;
 *  - portee=tous : tous les bulletins de l'entreprise (direction,
 *    archivage), éventuellement limités à une année (annee=2026).
 * Les PDF sont relus avec le client de l'utilisateur : la RLS du bucket
 * « payslips » reste l'autorité.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tous = url.searchParams.get("portee") === "tous";
  const g = await garderApi({ roles: tous ? ["direction"] : "tous", modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const annee = url.searchParams.get("annee");
  if (annee && !/^\d{4}$/.test(annee)) return NextResponse.json({ error: "Année invalide." }, { status: 400 });

  let requete = supabase
    .from("payslips")
    .select("id, user_id, period_start, file_path, users!payslips_user_id_fkey(full_name)")
    .eq("validation_status", "valide")
    .not("file_path", "is", null)
    .order("period_start", { ascending: true });
  if (!tous) requete = requete.eq("user_id", appUser.id);
  if (annee) requete = requete.gte("period_start", `${annee}-01-01`).lte("period_start", `${annee}-12-31`);
  const { data: bulletins, error } = await requete;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bulletins?.length) return NextResponse.json({ error: "Aucun bulletin validé à archiver." }, { status: 404 });

  const fichiers: { nom: string; blob: Blob; date: Date }[] = [];
  const manquants: string[] = [];
  // Téléchargements par lots de 5 : assez rapide sans saturer le stockage.
  for (let i = 0; i < bulletins.length; i += 5) {
    const lot = bulletins.slice(i, i + 5);
    const resultats = await Promise.all(lot.map((b) => supabase.storage.from("payslips").download(b.file_path as string)));
    resultats.forEach(({ data }, j) => {
      const b = lot[j]!;
      const nom = (b.users as unknown as { full_name?: string } | null)?.full_name ?? "Salarie";
      const mois = String(b.period_start).slice(0, 7);
      const chemin = tous ? `${nomFichier(nom)}/Bulletin ${mois} - ${nomFichier(nom)}.pdf` : `Bulletin ${mois} - ${nomFichier(nom)}.pdf`;
      if (data) fichiers.push({ nom: chemin, blob: data, date: new Date(`${b.period_start}T12:00:00Z`) });
      else manquants.push(`${nom} ${mois}`);
    });
  }
  // Les Blob deviennent des octets avant l'assemblage.
  const contenus: FichierZip[] = await Promise.all(fichiers.map(async (f) => ({ nom: f.nom, date: f.date, contenu: new Uint8Array(await f.blob.arrayBuffer()) })));
  if (manquants.length) contenus.push({ nom: "LISEZ-MOI - fichiers manquants.txt", contenu: `PDF introuvables dans le stockage :\r\n${manquants.join("\r\n")}\r\n`, date: new Date() });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_bulletins_archive",
    details: { portee: tous ? "tous" : "moi", annee: annee ?? null, bulletins: fichiers.length, manquants: manquants.length },
  });

  const zip = creerZip(contenus);
  const nom = tous ? `Bulletins de paie ${annee ?? "tous"}.zip` : `Mes bulletins de paie.zip`;
  return new NextResponse(zip, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${nom}"`, "Cache-Control": "no-store" },
  });
}
