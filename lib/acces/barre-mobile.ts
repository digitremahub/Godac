// Barre d'actions mobile des personnes qui conduisent (chauffeur, manager
// avec « conduit aussi »),
// sous `lg` : 4 boutons fixes + « Plus » qui ouvre le tiroir du menu
// (Mon espace, Communication, Aide…). Section 3.3 du plan. Pur, testé.

import type { UserRole } from "@/lib/types/domain";
import { MARQUEUR_GO_NAVIGATION, urlDe } from "@/lib/acces/catalogue";

export type IconeBarre = "depart" | "retour" | "plein" | "colis" | "planning" | "messages" | "signaler";

export interface BoutonBarre {
  href: string;
  libelle: string;
  icone: IconeBarre;
}

export function boutonsBarreMobile(role: UserRole, modules: ReadonlySet<string>, tourneeEnCours: boolean, conduit: boolean = role === "chauffeur"): BoutonBarre[] {
  if (!conduit) return [];
  // Essai GO Navigation : Tournée colis et navigation seulement.
  if (modules.has(MARQUEUR_GO_NAVIGATION)) {
    return modules.has("route_optimizer")
      ? [
          { href: urlDe("exploitation.colis"), libelle: "Tournée", icone: "colis" },
          { href: "/livreur/navigation", libelle: "GO Nav", icone: "depart" },
        ]
      : [];
  }
  const b: BoutonBarre[] = [];
  if (modules.has("planning")) {
    b.push(
      tourneeEnCours
        ? { href: urlDe("moi.tournee_retour"), libelle: "Retour", icone: "retour" }
        : { href: urlDe("moi.tournee_depart"), libelle: "Tournée", icone: "depart" },
    );
  }
  b.push({ href: `${urlDe("carburant.pleins")}?new=1`, libelle: "Plein", icone: "plein" });
  if (modules.has("route_optimizer")) b.push({ href: "/livreur", libelle: "Colis", icone: "colis" });
  else if (modules.has("planning")) b.push({ href: urlDe("moi.planning"), libelle: "Planning", icone: "planning" });
  if (modules.has("messenger")) b.push({ href: urlDe("communication.messenger"), libelle: "Messages", icone: "messages" });
  else if (modules.has("maintenance_requests")) b.push({ href: urlDe("flotte.entretien"), libelle: "Signaler", icone: "signaler" });
  return b.slice(0, 4);
}
