import { NextResponse } from "next/server";

/**
 * Rapports de la politique de contenu (mode « rapport seul ») : consignés
 * dans les journaux Vercel pour ajuster la politique avant de la rendre
 * bloquante. Public par nature (envoyé par le navigateur), borné en taille.
 */
export async function POST(req: Request) {
  const texte = (await req.text().catch(() => "")).slice(0, 4000);
  if (texte) console.warn("csp-report", texte);
  return new NextResponse(null, { status: 204 });
}
