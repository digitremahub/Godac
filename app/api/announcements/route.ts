import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  service_id: z.string().uuid().nullable().optional(),
  requires_acknowledgement: z.boolean().default(false),
});

/**
 * Module "Intranet & Convocations": a note/convocation targeted at
 * one service (service_id set) or the whole org (null) — RLS
 * ("announcements: manager-like writes") is the real gate, this route
 * just gives a clearer error.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["intranet"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour publier une annonce" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      organization_id: appUser.organization_id,
      service_id: parsed.data.service_id || null,
      title: parsed.data.title,
      body: parsed.data.body,
      requires_acknowledgement: parsed.data.requires_acknowledgement,
      created_by: appUser.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ announcement: data });
}
