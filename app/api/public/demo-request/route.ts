import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { limiterParIp } from "@/lib/http/limiteur-serveur";
import { REGLES_LIMITE } from "@/lib/http/limite-debit";
import { EDITEUR } from "@/lib/legal/editeur";

const bodySchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  vehicles: z.coerce.number().int().min(1).max(5000).optional().nullable(),
  activity: z.string().trim().max(120).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  plan_interest: z.string().trim().max(40).optional().nullable(),
  modules_interest: z.array(z.string().max(60)).max(40).optional().nullable(),
  /** Champ piège invisible : rempli uniquement par les robots. */
  site_web: z.string().max(200).optional().nullable(),
});

const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Demande de démonstration depuis le site public (/contact). Public par
 * nature : protégé par un champ piège et une limite de 5 demandes par
 * heure et par adresse IP (stockée hachée, jamais en clair).
 */
export async function POST(req: Request) {
  const limite = await limiterParIp(req, REGLES_LIMITE.demandeDemo);
  if (limite) return limite;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez les champs du formulaire." }, { status: 400 });
  const d = parsed.data;
  if (d.site_web) return NextResponse.json({ ok: true });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "inconnue";
  const ipHash = createHash("sha256").update(`godac-demo:${ip}`).digest("hex").slice(0, 32);
  const admin = createAdminSupabaseClient();
  const { count } = await admin
    .from("demo_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "Trop de demandes, réessayez plus tard ou écrivez-nous." }, { status: 429 });

  const { error } = await admin.from("demo_requests").insert({
    full_name: d.full_name,
    company: d.company,
    email: d.email,
    phone: d.phone || null,
    vehicles: d.vehicles ?? null,
    activity: d.activity || null,
    message: d.message || null,
    plan_interest: d.plan_interest || null,
    modules_interest: d.modules_interest?.length ? d.modules_interest : null,
    ip_hash: ipHash,
  });
  if (error) return NextResponse.json({ error: "Envoi impossible, écrivez-nous à " + EDITEUR.email }, { status: 500 });

  const lignes = [
    ["Nom", d.full_name],
    ["Entreprise", d.company],
    ["E-mail", d.email],
    ["Téléphone", d.phone],
    ["Véhicules", d.vehicles?.toString()],
    ["Activité", d.activity],
    ["Formule envisagée", d.plan_interest],
    ["Modules", d.modules_interest?.join(", ")],
    ["Message", d.message],
  ].filter(([, v]) => v);
  await sendTransactionalEmail({
    to: [process.env.SALES_EMAIL ?? EDITEUR.email],
    subject: `Demande de démo GODAC — ${d.company}`,
    html: `<h2>Nouvelle demande de démo</h2><table>${lignes.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${echapper(String(v))}</td></tr>`).join("")}</table>`,
  });
  return NextResponse.json({ ok: true });
}
