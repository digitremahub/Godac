import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { cheminTicket, cheminTicketValide, extensionTicket, peutJoindreTicket, verifierFichierTicket } from "@/lib/fuel/justificatif";

const BUCKET_TICKETS = process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets";

const initSchema = z.object({ mime: z.string().min(1).max(100), taille: z.coerce.number().positive() });
const enregistrerSchema = z.object({ ticketPhotoPath: z.string().min(1).max(300) });

/** Plein lu sous la RLS de la personne connectée (périmètre) puis droits du rôle ; null : introuvable ou refusé. */
async function lirePleinJoignable(id: string, g: Extract<Awaited<ReturnType<typeof garderApi>>, { ok: true }>) {
  const { appUser, supabase } = g;
  const { data: plein } = await supabase
    .from("fuel_entries")
    .select("id, organization_id, driver_id, created_by, occurred_at, ticket_photo_path")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!plein) return { erreur: NextResponse.json({ error: "Plein introuvable ou hors de votre périmètre." }, { status: 404 }) };
  if (!peutJoindreTicket({ role: appUser.role, userId: appUser.id, plein })) {
    return { erreur: NextResponse.json({ error: "Vous ne pouvez pas modifier le justificatif de ce plein.", code: "ROLE_REFUSE" }, { status: 403 }) };
  }
  return { plein };
}

/**
 * Joindre ou remplacer le justificatif (photo du ticket) d'un plein, après
 * coup ou à la saisie. Deux temps, comme le parcours OCR : la photo part
 * directement dans le stockage (lib/fuel/justificatif.ts), la route ne reçoit
 * que son chemin.
 *  - POST  : type et taille de la photo vérifiés, renvoie le chemin où la poser
 *            (dossier de l'organisation et du plein) ;
 *  - PATCH : le chemin est contrôlé (dossier, nom) ainsi que l'objet réellement
 *            déposé (type d'image, taille), puis rattaché au plein ; l'ancienne
 *            photo est effacée. Journalisé.
 * Chauffeur : son plein. Manager (son service), exploitation, direction et
 * comptable : la correction. Aucune validation hiérarchique n'est donnée par ce
 * droit : seul le justificatif change, jamais les litres ni les montants.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const parsed = initSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Photo invalide." }, { status: 400 });
  const invalide = verifierFichierTicket(parsed.data);
  if (invalide) return NextResponse.json({ error: invalide }, { status: 422 });
  const lu = await lirePleinJoignable(id, g);
  if ("erreur" in lu) return lu.erreur;
  return NextResponse.json({ storagePath: cheminTicket(g.appUser.organization_id, id, extensionTicket(parsed.data.mime)!), bucket: BUCKET_TICKETS });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const { appUser } = g;
  const parsed = enregistrerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Chemin de photo invalide." }, { status: 400 });
  const chemin = parsed.data.ticketPhotoPath;
  if (!cheminTicketValide(chemin, appUser.organization_id, id)) {
    return NextResponse.json({ error: "Chemin de photo refusé : il doit être dans le dossier de votre organisation et de ce plein." }, { status: 422 });
  }
  const lu = await lirePleinJoignable(id, g);
  if ("erreur" in lu) return lu.erreur;

  // L'objet déposé existe-t-il, est-ce une image, de taille raisonnable ? (le client ne décide pas seul)
  const admin = createAdminSupabaseClient();
  const dossier = `${appUser.organization_id}/${id}`;
  const nom = chemin.slice(dossier.length + 1);
  const { data: objets, error: errListe } = await admin.storage.from(BUCKET_TICKETS).list(dossier, { search: nom, limit: 10 });
  const objet = (objets ?? []).find((o) => o.name === nom);
  if (errListe || !objet) return NextResponse.json({ error: "La photo n'a pas été reçue : réessayez l'envoi." }, { status: 422 });
  const meta = (objet.metadata ?? {}) as { mimetype?: string; size?: number };
  const invalide = verifierFichierTicket({ mime: meta.mimetype, taille: meta.size });
  if (invalide) {
    await admin.storage.from(BUCKET_TICKETS).remove([chemin]);
    return NextResponse.json({ error: invalide }, { status: 422 });
  }

  const ancien = lu.plein.ticket_photo_path;
  const { error } = await admin.from("fuel_entries").update({ ticket_photo_path: chemin }).eq("id", id).eq("organization_id", appUser.organization_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Remplacement : l'ancienne photo (même dossier) est effacée, sans bloquer la réponse en cas d'échec.
  if (ancien && ancien !== chemin && cheminTicketValide(ancien, appUser.organization_id, id)) {
    const { error: errEff } = await admin.storage.from(BUCKET_TICKETS).remove([ancien]);
    if (errEff) console.error("ticket : ancienne photo non effacée", errEff.message);
  }
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "plein_ticket_joint",
    targetTable: "fuel_entries",
    targetId: id,
    details: { remplace: Boolean(ancien) },
  });
  return NextResponse.json({ ok: true });
}
