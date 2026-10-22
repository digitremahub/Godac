import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PAYS, type CodePays } from "@/lib/pays/pays";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getModulePlanPrices, priceFor, type PlanId } from "@/lib/organization/catalog";
import { estEnEssai } from "@/lib/organization/facturation-modules";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB");

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  ocr_enabled: z.boolean().optional(),
  logo_url: z.string().url().nullable().optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  require_odometer_photo: z.boolean().optional(),
  auto_clock_enabled: z.boolean().optional(),
  emergency_phone: z.string().trim().min(1).nullable().optional(),
  consumption_anomaly_threshold_percent: z.coerce.number().int().min(1).max(200).optional(),
  depot_address: z.string().trim().min(1).nullable().optional(),
  siret: z.string().trim().min(1).nullable().optional(),
  legal_address: z.string().trim().min(1).nullable().optional(),
  legal_form: z.string().trim().min(1).nullable().optional(),
  ape_code: z.string().trim().min(1).nullable().optional(),
  convention_collective: z.string().trim().min(1).nullable().optional(),
  urssaf_number: z.string().trim().min(1).nullable().optional(),
  country: z.enum(PAYS.map((p) => p.code) as [CodePays, ...CodePays[]]).optional(),
  // Couleurs de l'interface (lib/theme/couleurs-entreprise.ts) ; null =
  // retour aux couleurs GODAC. Les PDF gardent accent_color.
  brand_colors: z.object({ principale: hex, secondaire: hex, menu: hex }).strict().nullable().optional(),
});

/** Module 9: org profile settings — réservé à la direction (RLS + contrôle explicite, audit F2). */
export async function PATCH(req: Request) {
  const g = await garderApi({ roles: ["direction"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut modifier l'organisation." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const {
    name,
    ocr_enabled,
    logo_url,
    accent_color,
    require_odometer_photo,
    auto_clock_enabled,
    emergency_phone,
    consumption_anomaly_threshold_percent,
    depot_address,
    siret,
    legal_address,
    legal_form,
    ape_code,
    convention_collective,
    urssaf_number,
    country,
    brand_colors,
  } = parsed.data;

  const supabase = await createServerSupabaseClient();

  const profileFields: Record<string, string | null | boolean | number> = {};
  if (name !== undefined) profileFields.name = name;
  if (logo_url !== undefined) profileFields.logo_url = logo_url;
  if (accent_color !== undefined) profileFields.accent_color = accent_color;
  if (require_odometer_photo !== undefined) profileFields.require_odometer_photo = require_odometer_photo;
  if (auto_clock_enabled !== undefined) profileFields.auto_clock_enabled = auto_clock_enabled;
  if (emergency_phone !== undefined) profileFields.emergency_phone = emergency_phone;
  if (consumption_anomaly_threshold_percent !== undefined)
    profileFields.consumption_anomaly_threshold_percent = consumption_anomaly_threshold_percent;
  if (depot_address !== undefined) {
    const geocoded = depot_address ? await geocodeAddress(depot_address, country ?? (await codePays(appUser.organization_id))) : null;
    profileFields.depot_address = depot_address;
    profileFields.depot_lat = geocoded?.lat ?? null;
    profileFields.depot_lng = geocoded?.lng ?? null;
  }
  if (siret !== undefined) profileFields.siret = siret;
  if (legal_address !== undefined) profileFields.legal_address = legal_address;
  if (legal_form !== undefined) profileFields.legal_form = legal_form;
  if (ape_code !== undefined) profileFields.ape_code = ape_code;
  if (convention_collective !== undefined) profileFields.convention_collective = convention_collective;
  if (urssaf_number !== undefined) profileFields.urssaf_number = urssaf_number;
  if (country !== undefined) profileFields.country = country;

  if (Object.keys(profileFields).length > 0) {
    const { data: modifiees, error } = await supabase
      .from("organizations")
      .update(profileFields)
      .eq("id", appUser.organization_id)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!modifiees || modifiees.length === 0) {
      return NextResponse.json({ error: "Modification refusée." }, { status: 403 });
    }
  }

  if (brand_colors !== undefined) {
    const { data: modifiees, error } = await supabase
      .from("organizations")
      .update({ brand_colors })
      .eq("id", appUser.organization_id)
      .select("id");
    if (estSchemaManquant(error)) {
      return NextResponse.json({ error: "Les couleurs de l'entreprise seront disponibles après la prochaine mise à jour de GODAC." }, { status: 409 });
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!modifiees || modifiees.length === 0) {
      return NextResponse.json({ error: "Modification refusée." }, { status: 403 });
    }
  }

  if (ocr_enabled !== undefined) {
    // Module OCR : prix et mode de facturation tirés de la grille, jamais
    // du client ; écriture par le client admin (audit C4).
    const admin = createAdminSupabaseClient();
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("plan, subscription_status, stripe_subscription_id")
      .eq("id", appUser.organization_id)
      .single();
    if (orgError || !org) return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
    const prix = priceFor(await getModulePlanPrices(admin), "ocr", org.plan as PlanId);
    const included = prix?.included ?? false;
    const mensuel = ocr_enabled ? Number(prix?.monthly_price ?? 0) : 0;
    const miseEnService = ocr_enabled && !included ? Number(prix?.setup_price ?? 0) : 0;
    if (ocr_enabled && !included && (mensuel > 0 || miseEnService > 0) && !estEnEssai(org)) {
      const { data: actuel } = await admin
        .from("organization_modules")
        .select("enabled")
        .eq("organization_id", appUser.organization_id)
        .eq("module_key", "ocr")
        .maybeSingle();
      if (!actuel?.enabled) {
        return NextResponse.json({ error: "Module payant à ajouter à votre abonnement : contactez GODAC." }, { status: 402 });
      }
    }
    const { error } = await admin.from("organization_modules").upsert(
      {
        organization_id: appUser.organization_id,
        module_key: "ocr",
        enabled: ocr_enabled,
        pricing_mode: included ? "included" : "a_la_carte",
        effective_monthly_price: mensuel,
        effective_setup_price: miseEnService,
      },
      { onConflict: "organization_id,module_key" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, name, logo_url, accent_color, require_odometer_photo, auto_clock_enabled, emergency_phone, consumption_anomaly_threshold_percent, depot_address, siret, legal_address, legal_form, ape_code, convention_collective, urssaf_number",
    )
    .eq("id", appUser.organization_id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ organization: data });
}
