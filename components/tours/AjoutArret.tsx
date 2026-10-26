"use client";

import { useRef, useState } from "react";
import { IconBuilding, IconMapPin } from "@/components/layout/icons";
import { ChampSuggestions } from "@/components/tours/ChampSuggestions";
import { completerSuggestions, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { arretDepuisSuggestion, arretManuelValide, type ArretDepuisSuggestion, type Biais } from "@/lib/tours/ajout-arret";

const nouveauJeton = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(16, "0"));

/**
 * « Nom du professionnel ou adresse » d'une ramasse ou d'un point relais.
 * Mêmes sources que le champ adresse de la tournée colis (annuaire de
 * l'équipe, Google Places si configuré, sinon BAN puis OpenStreetMap),
 * biaisées autour du village. Choisir une suggestion remplit nom, adresse,
 * code postal, commune et coordonnées. Repli « Saisir à la main ».
 */
export function AjoutArret({
  type,
  biais,
  onAjouter,
  onAnnuler,
}: {
  type: "ramasse" | "point_relais";
  biais: Biais | null;
  onAjouter: (a: ArretDepuisSuggestion) => void;
  onAnnuler: () => void;
}) {
  const jeton = useRef<string>(nouveauJeton());
  const [manuel, setManuel] = useState(false);
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");

  async function chercher(texte: string, signal: AbortSignal, maj: (items: SuggestionAdresse[]) => void) {
    const p = new URLSearchParams({ q: texte.trim(), session: jeton.current });
    if (biais) (p.set("lat", String(biais.lat)), p.set("lng", String(biais.lng)));
    const lire = async (phase: "rapide" | "complement") => {
      p.set("phase", phase);
      const res = await fetch(`/api/tour-routes/etablissements?${p.toString()}`, { signal });
      if (!res.ok) throw new Error("indisponible");
      return (await res.json()) as { resultats?: SuggestionAdresse[]; complement?: boolean };
    };
    const premiere = await lire("rapide");
    let liste = (premiere.resultats ?? []).slice(0, 6);
    if (!premiere.complement) return { items: liste };
    maj(liste);
    try {
      const suite = await lire("complement");
      liste = completerSuggestions(liste, suite.resultats ?? [], 6);
    } catch {
      /* la source lente n'a pas répondu : on garde les premiers résultats */
    }
    return { items: liste };
  }

  async function choisir(s: SuggestionAdresse): Promise<string | null> {
    let choix = s;
    if (s.lat === null && s.placeId) {
      // Suggestion Google : coordonnées demandées seulement au choix (Place Details).
      try {
        const res = await fetch(`/api/tour-routes/etablissements?place_id=${encodeURIComponent(s.placeId)}&session=${jeton.current}`, { signal: AbortSignal.timeout(3500) });
        const data = res.ok ? ((await res.json()) as { lieu?: { lat: number; lng: number } | null }) : null;
        if (data?.lieu) choix = { ...s, lat: data.lieu.lat, lng: data.lieu.lng };
      } catch {
        /* repli : l'adresse sera géocodée plus tard */
      }
    }
    jeton.current = nouveauJeton();
    onAjouter(arretDepuisSuggestion(choix, type));
    return null;
  }

  const titre = type === "ramasse" ? "ramasse" : "point relais";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-teal-ink/30 bg-surface p-2.5">
      <ChampSuggestions<SuggestionAdresse>
        libelle={`Nom du professionnel ou adresse (${titre})`}
        placeholder="Ex. Boulangerie Martin, Pharmacie du Centre…"
        autoFocus
        aide={biais ? "Les établissements proches du village sont proposés en premier." : "Tapez au moins 3 lettres."}
        peutChercher={(t) => t.trim().length >= 3}
        chercher={chercher}
        cleCache={`${type}|${biais ? `${biais.lat.toFixed(2)},${biais.lng.toFixed(2)}` : "-"}`}
        cle={(s) => `${s.source}-${s.nom ?? ""}-${s.adresse}`}
        rendu={(s) => (
          <>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${s.type === "etablissement" ? "bg-teal/15 text-teal-ink" : "bg-navy/[0.06] text-navy/55"}`} aria-hidden="true">
              {s.type === "etablissement" ? <IconBuilding className="h-4 w-4" /> : <IconMapPin className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{s.type === "etablissement" ? "Établissement : " : "Adresse : "}</span>
              {s.nom && <span className="block truncate font-semibold">{s.nom}</span>}
              <span className={`block truncate ${s.nom ? "text-xs text-navy/65" : "font-medium"}`}>{s.adresse}</span>
            </span>
          </>
        )}
        onChoisir={choisir}
        vide="Rien trouvé. Précisez le nom ou la commune, ou saisissez à la main."
        indisponible="Recherche indisponible. Saisissez à la main."
        pied={({ indisponible, aucunResultat }) =>
          manuel ? null : (
            <button type="button" className={indisponible || aucunResultat ? "btn-secondary w-fit !py-2 text-sm" : "w-fit min-h-[44px] rounded-lg px-1 text-xs font-semibold text-navy/60 hover:text-navy hover:underline sm:min-h-0"} onClick={() => setManuel(true)}>
              Saisir à la main
            </button>
          )
        }
      />
      {manuel && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (arretManuelValide(nom, adresse)) onAjouter({ type, name: nom.trim(), address: adresse.trim() });
          }}
        >
          <label className="block"><span className="label">Nom du professionnel</span><input className="input" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus autoComplete="off" /></label>
          <label className="block"><span className="label">Adresse complète</span><input className="input" value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="12 rue des Lilas, 66300 Thuir" autoComplete="off" /></label>
          <div className="flex gap-2"><button type="submit" className="btn-primary" disabled={!arretManuelValide(nom, adresse)}>Ajouter</button></div>
        </form>
      )}
      <button type="button" className="btn-ghost w-fit !py-2 text-sm" onClick={onAnnuler}>Fermer</button>
    </div>
  );
}
