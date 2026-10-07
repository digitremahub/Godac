import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const bodySchema = z.object({ contentType: z.string().optional() });

/**
 * Storage-path issuer for a tour report upload (handheld stats screen
 * at departure, printed compte-rendu at return, or a PDF scan
 * téléversé depuis un PC — see app/api/ocr/tour-report/process).
 * Reuses the tour-photos bucket, same convention as
 * app/api/ocr/odometer/init — the extension matches the uploaded
 * file's real type so lib/ocr/tour-report.ts picks the right Claude
 * content block (image vs document) later.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const contentType = parsed.success ? parsed.data.contentType : undefined;
  const ext = (contentType && EXTENSION_BY_CONTENT_TYPE[contentType]) || "jpg";
  const storagePath = `${appUser.organization_id}/tour-report/${randomUUID()}.${ext}`;
  return NextResponse.json({ storagePath });
}
