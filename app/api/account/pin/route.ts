import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validatePin } from "@/lib/business/driver-pin";
import { motDePassePin } from "@/lib/auth/pin-securise";

const bodySchema = z.object({
  pin: z.string(),
  confirmPin: z.string(),
});

/**
 * Self-service upgrade of Lot 7's QR-badge login: a chauffeur /
 * manager_chauffeur who already has a normal email account can turn
 * their own badge (shown on this same account page) into a working
 * login, same mechanism as the no-email path (lib/auth/driver-pin.ts)
 * but self-triggered from an authenticated session instead of
 * admin-created. The admin client is needed because this both sets
 * the Auth password and flips `public.users.auth_method` in one go —
 * RLS's "users: self update" would allow the users-table write alone,
 * but not the password change.
 */
export async function PATCH(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["chauffeur", "manager_chauffeur"])) {
    return NextResponse.json(
      { error: "Seuls les chauffeurs peuvent activer la connexion par badge." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (parsed.data.pin !== parsed.data.confirmPin) {
    return NextResponse.json({ error: "Les deux codes PIN ne correspondent pas." }, { status: 400 });
  }
  const pinCheck = validatePin(parsed.data.pin);
  if (!pinCheck.ok) {
    return NextResponse.json({ error: pinCheck.message }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { error: passwordError } = await admin.auth.admin.updateUserById(appUser.id, { password: motDePassePin(appUser.id, parsed.data.pin) });
  if (passwordError) {
    return NextResponse.json({ error: passwordError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("users")
    .update({ auth_method: "pin", pin_set_at: new Date().toISOString() })
    .eq("id", appUser.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
