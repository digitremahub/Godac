import "server-only";
import { NextResponse } from "next/server";
import type { ErreurStock } from "@/lib/stock/erreurs";

/** Réponse d'erreur homogène des routes du stock : `error` en français, `code` stable. */
export function reponseErreur(e: Pick<ErreurStock, "code" | "message" | "status">): NextResponse {
  return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
}

export async function lireCorps(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const REQUETE_INVALIDE = { code: "stock_requete_invalide", message: "Requête invalide.", status: 400 } as const;
export const SCHEMA_ABSENT = { code: "stock_schema_absent", message: "Le module Stock n'est pas encore installé sur la base (mise à jour en attente).", status: 503 } as const;
