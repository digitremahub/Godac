import { APP_URL } from "@/lib/domaines/routage";

/** Rend le lien d'une notification absolu sur le domaine de l'application (les liens déjà absolus sont conservés). */
export function lienAbsolu(url: string | null | undefined): string {
  const lien = url || "/dashboard";
  if (/^https?:\/\//i.test(lien)) return lien;
  return `${APP_URL}${lien.startsWith("/") ? "" : "/"}${lien}`;
}
