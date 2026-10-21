import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({ ext: z.string().max(5).optional() });

/**
 * Attaches (or replaces) the supplier invoice on a delivery — separate
 * from the create route since the paper invoice usually arrives after
 * the truck does, not at the moment the delivery is logged. Same
 * up-front-storage-path pattern as tank-photos: the row's invoice_path
 * is set before the browser uploads the actual file.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour joindre une facture" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const ext = (parsed.data.ext || "pdf").replace(/[^a-z0-9]/gi, "").toLowerCase() || "pdf";
  const storagePath = `${appUser.organization_id}/${id}/${randomUUID()}.${ext}`;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tank_deliveries")
    .update({ invoice_path: storagePath })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Approvisionnement introuvable." }, { status: 404 });
  return NextResponse.json({ storagePath });
}
