import Image from "next/image";

/**
 * Photographies d'illustration de la vitrine publique (public/photos/*.webp,
 * 1600×900). Le ratio est réservé par le conteneur (aucun saut de mise en
 * page) ; les images sont chargées en différé, aucune n'est au-dessus de la
 * ligne de flottaison. Aucun texte n'est superposé : pas de voile nécessaire,
 * le contraste du texte voisin reste celui du thème. Aucune animation.
 */
export const PHOTOS = {
  equipe: "/photos/equipe.webp",
  bureauPlanning: "/photos/bureau-planning.webp",
  exploitationTablette: "/photos/exploitation-tablette.webp",
  carburant: "/photos/carburant.webp",
  depotTri: "/photos/depot-tri.webp",
  remiseColis: "/photos/remise-colis.webp",
  fourgonAube: "/photos/fourgon-aube.webp",
  goChauffeur: "/photos/go-chauffeur.webp",
  exploitationEcrans: "/photos/exploitation-ecrans.webp",
} as const;

export function PhotoVitrine({
  src,
  alt,
  sizes,
  ratio = "aspect-[16/9]",
  className = "",
}: {
  src: (typeof PHOTOS)[keyof typeof PHOTOS];
  alt: string;
  /** Largeur affichée selon le point de rupture (évite de télécharger 1600 px sur mobile). */
  sizes: string;
  /** Classe de ratio Tailwind réservant la hauteur (16/9 par défaut, recadrage possible). */
  ratio?: string;
  className?: string;
}) {
  return (
    <figure className={`relative w-full overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-navy/10 ${ratio} ${className}`}>
      <Image src={src} alt={alt} fill sizes={sizes} loading="lazy" className="object-cover" />
    </figure>
  );
}
