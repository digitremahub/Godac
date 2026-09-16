import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  ocr_enabled: z.boolean().optional(),
  logo_url: z.string().url().nullable().optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

/** Module 9: org profile settings — RLS restricts this to `direction` regardless of what's sent here. */
export async function PATCH(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, ocr_enabled, logo_url, accent_color } = parsed.data;

  const supabase = await createServerSupabaseClient();

  const profileFields: Record<string, string | null> = {};
  if (name !== undefined) profileFields.name = name;
  if (logo_url !== undefined) profileFields.logo_url = logo_url;
  if (accent_color !== undefined) profileFields.accent_color = accent_color;

  if (Object.keys(profileFields).length > 0) {
    const { error } = await supabase.from("organizations").update(profileFields).eq("id", appUser.organization_id);
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
    .select("id, name, logo_url, accent_color")
    .eq("id", appUser.organization_id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ organization: data });
}
