import Link from "next/link";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { EDITEUR } from "@/lib/legal/editeur";
import { MESSAGE_ESSAI_TERMINE } from "@/lib/go-navigation/offre";

/**
 * Écran affiché à la place de l'espace connecté (et de l'appli chauffeur)
 * quand l'essai GO Navigation est terminé. Les données sont conservées :
 * GODAC peut passer le compte sur une vraie offre sans perte.
 */
export function EssaiTermine() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper p-6 text-center">
      <p className="font-display text-xl font-bold">Essai terminé</p>
      <p className="max-w-md text-sm text-navy/70">{MESSAGE_ESSAI_TERMINE} Vos tournées et votre historique sont conservés.</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a href={`mailto:${EDITEUR.email}?subject=${encodeURIComponent("GO Navigation — fin de l'essai")}`} className="btn-primary">
          Contacter GODAC
        </a>
        <Link href="/contact" className="btn-secondary">
          Formulaire de contact
        </Link>
        <SignOutButton />
      </div>
    </main>
  );
}
