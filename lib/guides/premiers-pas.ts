/**
 * « Premiers pas » : 3 à 5 actions clés du rôle, tirées du guide par rôle
 * (lib/guides/roles.ts), jamais vers un écran qui ne s'ouvre pas pour lui
 * (catalogue des accès). Fichier pur, testé dans
 * lib/guides/__tests__/premiers-pas.test.ts.
 */
import { ECRANS } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { guideDe, guideFiltre } from "@/lib/guides/roles";
import type { UserRole } from "@/lib/types/domain";

export interface PremierPas {
  titre: string;
  href: string;
  label: string;
}

export const PAS_MAX = 5;
export const PAS_MIN = 3;
/** Adresses hors catalogue d'écrans, ouvertes à tous. */
const LIENS_LIBRES = ["/account"];

/** Clé de mémorisation du bandeau refermé (par rôle). */
export const clePremiersPas = (role: string) => `godac.premiers-pas.${role}`;

/** Valeurs mémorisées : « vu » après la première visite, « ferme » après la croix. */
export const PREMIERS_PAS_VU = "vu";
export const PREMIERS_PAS_FERME = "ferme";

/** Le bandeau est replié à l'ouverture : une ligne, jamais un écran de boutons avant le titre. */
export const PREMIERS_PAS_REPLIE_PAR_DEFAUT = true;

/** Affiché seulement à la première visite : rien de mémorisé pour ce rôle sur cet appareil (stockage illisible : on l'affiche, replié). */
export function afficherPremiersPas(memorise: string | null | undefined): boolean {
  return memorise !== PREMIERS_PAS_VU && memorise !== PREMIERS_PAS_FERME;
}

/** Libellé de la ligne repliée : « Premiers pas · 4 actions ». */
export function libellePremiersPas(nb: number): string {
  return `Premiers pas · ${nb} action${nb > 1 ? "s" : ""}`;
}

export function premiersPas(role: UserRole, conduit: boolean, modules: ReadonlySet<string>): PremierPas[] {
  const guide = guideFiltre(guideDe(role, conduit), [...modules]);
  const vus = new Set<string>();
  const pas: PremierPas[] = [];
  for (const section of guide.sections) {
    for (const etape of section.etapes) {
      if (!etape.lien || pas.length >= PAS_MAX) continue;
      const chemin = etape.lien.href.split(/[?#]/)[0]!;
      if (vus.has(chemin) || chemin.startsWith("/aide")) continue;
      const ecran = ECRANS.find((e) => e.href === chemin);
      const permis = ecran ? ecranOuvrable(ecran.id, { role, modules, conduit }) : LIENS_LIBRES.includes(chemin);
      if (!permis) continue;
      vus.add(chemin);
      pas.push({ titre: etape.titre, href: etape.lien.href, label: etape.lien.label });
    }
  }
  return pas.length >= PAS_MIN ? pas : [];
}
