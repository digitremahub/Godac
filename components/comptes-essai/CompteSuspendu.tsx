import Link from "next/link";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { EDITEUR } from "@/lib/legal/editeur";
import { MESSAGE_COMPTE_SUSPENDU } from "@/lib/comptes-essai/regles";

/**
 * Écran affiché à la place de l'espace connecté (et de l'appli chauffeur)
 * quand GODAC a suspendu le compte de l'organisation. Les données sont
 * conservées : rétablir le compte rend l'accès tel qu'il était. Le motif
 * saisi par GODAC reste interne (jamais affiché ici).
 */
export function CompteSuspendu() {
  return (
    <section aria-labelledby="compte-suspendu-titre" role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper p-6 text-center">
      <h1 id="compte-suspendu-titre" className="font-display text-xl font-bold">
        Compte suspendu par GODAC
      </h1>
      <p className="max-w-md text-sm text-navy/70">{MESSAGE_COMPTE_SUSPENDU}</p>
      <p className="max-w-md text-sm text-navy/70">
        Pour en savoir plus ou faire rétablir l&apos;accès, écrivez à GODAC :{" "}
        <a href={`mailto:${EDITEUR.email}`} className="font-semibold text-teal-ink underline">
          {EDITEUR.email}
        </a>
        .
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a href={`mailto:${EDITEUR.email}?subject=${encodeURIComponent("Compte GODAC suspendu")}`} className="btn-primary">
          Contacter GODAC
        </a>
        <Link href="/contact" className="btn-secondary">
          Formulaire de contact
        </Link>
        <SignOutButton />
      </div>
    </section>
  );
}
