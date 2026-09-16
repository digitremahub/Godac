import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  ocr_enabled: z.boolean().optional(),
});

/** Module 9: org profile settings — RLS restricts this to `direction` regardless of what's sent here. */
export async function PATCH(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, ocr_enabled } = parsed.data;

  const supabase = await createServerSupabaseClient();

  if (name !== undefined) {
    const { error } = await supabase.from("organizations").update({ name }).eq("id", appUser.organization_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (ocr_enabled !== undefined) {
    const { error } = await supabase.from("organization_modules").upsert(
      {
        organization_id: appUser.organization_id,
        module_key: "ocr",
        enabled: ocr_enabled,
      },
      { onConflict: "organization_id,module_key" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", appUser.organization_id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ organization: data });
}
