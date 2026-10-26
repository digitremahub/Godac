"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconPencil, IconPointRelais, IconRamasse } from "@/components/layout/icons";
import { AddressQrScanner } from "@/components/tours/AddressQrScanner";
import { AjoutArret } from "@/components/tours/AjoutArret";
import { IconBas, IconHaut, IconPlus, IconPlusieurs, IconPoignee } from "@/components/tours/icones-village";
import { resumeArrets, type SuggestionCommune } from "@/lib/tours/ajout-village";
import type { ArretDepuisSuggestion } from "@/lib/tours/ajout-arret";
import type { PlannedStop, Village } from "@/components/tours/TourRoutesBoard";

/** Bouton-icône de 44 px (zone tactile), survol et focus nets. */
const BTN_ICONE = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-navy/60 transition-colors hover:bg-navy/[0.06] hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";
const BTN_DISCRET = "inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-teal-ink transition-colors hover:bg-teal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-ink sm:min-h-9";

const CRENEAUX = ["08:00-11:00", "10:00-13:00", "12:00-15:00", "14:00-17:00"];

/** Menu « ⋯ » : s'ouvre au clic, se ferme à Échap ou en cliquant ailleurs. */
function MenuPlus({ libelle, children }: { libelle: string; children: (fermer: () => void) => ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => !racine.current?.contains(e.target as Node) && setOuvert(false);
    const touche = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", touche);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", touche);
    };
  }, [ouvert]);
  return (
    <div ref={racine} className="relative">
      <button type="button" className={BTN_ICONE} aria-label={libelle} aria-haspopup="menu" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
        <IconPlusieurs />
      </button>
      {ouvert && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 flex min-w-[15rem] flex-col rounded-xl border border-navy/10 bg-surface p-1 shadow-pop">
          {children(() => setOuvert(false))}
        </div>
      )}
    </div>
  );
}

const itemMenu = "flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-navy/[0.05] focus-visible:bg-navy/[0.05] disabled:opacity-45";

export function VillageEditeur({
  id,
  domId,
  village: v,
  index,
  total,
  autresTournees,
  busy,
  copie,
  candidatsCp,
  onChange,
  onMove,
  onRemove,
  onCopier,
  onChoisirCp,
}: {
  id: string;
  domId: string;
  village: Village;
  index: number;
  total: number;
  autresTournees: { id: string; libelle: string }[];
  busy: boolean;
  copie: boolean;
  candidatsCp?: SuggestionCommune[];
  onChange: (patch: Partial<Village>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onCopier: (routeId: string) => void;
  onChoisirCp: (s: SuggestionCommune) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [infosOuvert, setInfosOuvert] = useState(false);
  const [arretsOuvert, setArretsOuvert] = useState(false);
  const [ajout, setAjout] = useState<"ramasse" | "point_relais" | null>(null);
  const [modif, setModif] = useState<number | null>(null);
  const [copierOuvert, setCopierOuvert] = useState(false);
  const [scanner, setScanner] = useState<number | null>(null);
  const arrets = v.planned_stops ?? [];
  const resume = resumeArrets(arrets);
  const biais = typeof v.lat === "number" && typeof v.lng === "number" ? { lat: v.lat, lng: v.lng } : null;
  const nom = v.name || `village ${index + 1}`;

  const majArret = (j: number, patch: Partial<PlannedStop>) => onChange({ planned_stops: arrets.map((s, k) => (k === j ? { ...s, ...patch } : s)) });
  function ajouterArret(a: ArretDepuisSuggestion) {
    onChange({ planned_stops: [...arrets, a] });
    setAjout(null);
    setArretsOuvert(true);
  }

  return (
    <li
      ref={setNodeRef}
      id={domId}
      tabIndex={-1}
      style={{ transform: CSS.Translate.toString(transform), transition, boxShadow: isDragging ? "0 8px 24px rgba(10,15,30,0.18)" : undefined, position: isDragging ? "relative" : undefined, zIndex: isDragging ? 20 : undefined }}
      className="rounded-2xl border border-navy/10 bg-surface shadow-[0_1px_2px_rgba(10,15,30,0.04)] outline-none transition-colors focus-within:border-navy/20 focus:ring-2 focus:ring-teal-ink/50"
    >
      <div className="flex items-center gap-1 px-1.5 py-1 sm:px-2">
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Déplacer ${nom} (appui long ou glisser)`} className="flex h-11 w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-navy/40 hover:bg-navy/[0.05] hover:text-navy/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-ink active:cursor-grabbing">
          <IconPoignee />
        </button>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal-sur-menu">{index + 1}</span>
        <p className="ml-1.5 min-w-0 flex-1 truncate font-semibold">{v.name}</p>
        {v.postal_code ? (
          <span className="shrink-0 rounded-full bg-navy/[0.06] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-navy/75">{v.postal_code}</span>
        ) : (
          <span className="shrink-0 rounded-full bg-orange/[0.12] px-2.5 py-0.5 text-xs font-semibold text-orange-ink">Code postal ?</span>
        )}
        <button type="button" className={`${BTN_ICONE} hidden sm:flex`} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Monter ${nom}`}><IconHaut /></button>
        <button type="button" className={`${BTN_ICONE} hidden sm:flex`} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Descendre ${nom}`}><IconBas /></button>
        <MenuPlus libelle={`Actions pour ${nom}`}>
          {(fermer) => (
            <>
              <button type="button" role="menuitem" className={`${itemMenu} sm:hidden`} disabled={index === 0} onClick={() => { onMove(-1); fermer(); }}>Monter</button>
              <button type="button" role="menuitem" className={`${itemMenu} sm:hidden`} disabled={index === total - 1} onClick={() => { onMove(1); fermer(); }}>Descendre</button>
              <button type="button" role="menuitem" className={itemMenu} aria-expanded={copierOuvert} disabled={busy || !v.name.trim() || autresTournees.length === 0} onClick={() => setCopierOuvert(!copierOuvert)}>
                {copie ? "Copie…" : "Copier vers une autre tournée…"}
              </button>
              {copierOuvert && autresTournees.map((t) => (
                <button key={t.id} type="button" role="menuitem" className={`${itemMenu} pl-6 text-navy/80`} disabled={busy} onClick={() => { fermer(); setCopierOuvert(false); onCopier(t.id); }}>{t.libelle}</button>
              ))}
              <button type="button" role="menuitem" className={`${itemMenu} font-semibold text-orange-ink`} onClick={() => { fermer(); onRemove(); }}>Retirer de la fiche</button>
            </>
          )}
        </MenuPlus>
      </div>

      {!v.postal_code && candidatsCp && candidatsCp.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2" role="group" aria-label={`Code postal de ${nom}`}>
          <span className="text-xs text-navy/60">Quel code postal ?</span>
          {candidatsCp.map((s) => (
            <button key={`${s.insee_code}-${s.postal_code}`} type="button" className="min-h-[44px] rounded-full border border-navy/15 px-3 text-xs font-semibold hover:border-teal-ink hover:bg-teal/10 sm:min-h-8" onClick={() => onChoisirCp(s)}>
              {s.postal_code} · {s.name}{s.departement_code ? ` (${s.departement_code})` : ""}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-navy/[0.07] px-3 py-1.5">
        {infosOuvert ? (
          <label className="block py-1">
            <span className="sr-only">Infos du village {nom}</span>
            <textarea className="input min-h-[60px] text-sm" autoFocus value={v.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} onBlur={() => !(v.notes ?? "").trim() && setInfosOuvert(false)} placeholder="Accès, horaires, code portail, contact sur place…" />
          </label>
        ) : (v.notes ?? "").trim() ? (
          <button type="button" className="flex min-h-[44px] items-center gap-2 rounded-lg text-left text-sm text-navy/75 hover:text-navy sm:min-h-9" onClick={() => setInfosOuvert(true)} aria-label={`Modifier les infos de ${nom}`}>
            <IconPencil className="h-4 w-4 shrink-0 text-navy/45" />
            <span className="truncate">{(v.notes ?? "").replace(/\s+/g, " ")}</span>
          </button>
        ) : (
          <button type="button" className="flex min-h-[44px] w-fit items-center gap-1.5 rounded-lg text-sm font-semibold text-teal-ink hover:underline sm:min-h-9" onClick={() => setInfosOuvert(true)}>
            <IconPlus className="h-4 w-4" />Ajouter une info
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-navy/[0.07] px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button type="button" className="flex min-h-[44px] items-center gap-1.5 rounded-lg text-sm sm:min-h-9" aria-expanded={arretsOuvert} onClick={() => setArretsOuvert(!arretsOuvert)} disabled={arrets.length === 0}>
            <span className={arrets.length ? "font-semibold" : "text-navy/55"}>{resume || "Aucune ramasse ni point relais"}</span>
            {arrets.length > 0 && <IconBas className={`h-4 w-4 text-navy/50 transition-transform ${arretsOuvert ? "rotate-180" : ""}`} />}
          </button>
          <span className="ml-auto flex gap-1">
            <button type="button" className={BTN_DISCRET} onClick={() => { setAjout(ajout === "ramasse" ? null : "ramasse"); }}><IconPlus className="h-4 w-4" />Ramasse</button>
            <button type="button" className={BTN_DISCRET} onClick={() => { setAjout(ajout === "point_relais" ? null : "point_relais"); }}><IconPlus className="h-4 w-4" />Point relais</button>
          </span>
        </div>

        {ajout && <AjoutArret key={ajout} type={ajout} biais={biais} onAjouter={ajouterArret} onAnnuler={() => setAjout(null)} />}

        {arretsOuvert && arrets.length > 0 && (
          <ul className="flex flex-col gap-1.5 pb-1.5">
            {arrets.map((stop, j) => (
              <li key={stop.id ?? j} className="rounded-xl border border-navy/10 bg-paper">
                <div className="flex items-center gap-2 px-2.5 py-1">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stop.type === "ramasse" ? "bg-teal/15 text-teal-ink" : "bg-navy/[0.07] text-navy/70"}`} title={stop.type === "ramasse" ? "Ramasse" : "Point relais"}>
                    {stop.type === "ramasse" ? <IconRamasse className="h-4 w-4" /> : <IconPointRelais className="h-4 w-4" />}
                    <span className="sr-only">{stop.type === "ramasse" ? "Ramasse" : "Point relais"}</span>
                  </span>
                  <div className="min-w-0 flex-1 py-1">
                    <p className="truncate text-sm font-semibold">{stop.name || stop.address || "Arrêt à compléter"}</p>
                    {stop.name && stop.address && <p className="truncate text-xs text-navy/65">{stop.address}</p>}
                    {stop.time_window && <p className="text-xs tabular-nums text-navy/55">{stop.time_window}</p>}
                  </div>
                  <MenuPlus libelle={`Actions pour ${stop.name || "l'arrêt"} ${j + 1}`}>
                    {(fermer) => (
                      <>
                        <button type="button" role="menuitem" className={itemMenu} onClick={() => { fermer(); setModif(modif === j ? null : j); }}>Modifier</button>
                        <button type="button" role="menuitem" className={`${itemMenu} font-semibold text-orange-ink`} onClick={() => { fermer(); setModif(null); onChange({ planned_stops: arrets.filter((_, k) => k !== j) }); }}>Retirer</button>
                      </>
                    )}
                  </MenuPlus>
                </div>
                {modif === j && (
                  <div className="flex flex-col gap-2 border-t border-navy/[0.07] p-2.5">
                    <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                      <label className="block"><span className="label">Type</span>
                        <select className="input" value={stop.type} onChange={(e) => majArret(j, { type: e.target.value as PlannedStop["type"] })}>
                          <option value="ramasse">Ramasse</option><option value="point_relais">Point relais</option>
                        </select>
                      </label>
                      <label className="block"><span className="label">Nom du professionnel / point relais</span>
                        <input className="input" value={stop.name ?? ""} onChange={(e) => majArret(j, { name: e.target.value })} placeholder="Ex. Boulangerie Martin" />
                      </label>
                    </div>
                    <label className="block"><span className="label">Adresse</span>
                      <input className="input" value={stop.address} onChange={(e) => majArret(j, { address: e.target.value, lat: undefined, lng: undefined })} />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => setScanner(scanner === j ? null : j)}>Scanner un QR code</button>
                      <span className="text-xs text-navy/55">Pour une autre adresse, retirez l&apos;arrêt et recherchez-le à nouveau.</span>
                    </div>
                    {scanner === j && <AddressQrScanner onClose={() => setScanner(null)} onScan={(value) => { majArret(j, { address: value, lat: undefined, lng: undefined }); setScanner(null); }} />}
                    <label className="block"><span className="label">{stop.type === "ramasse" ? "Tranche horaire prévue au contrat" : "Horaires d'ouverture du point relais"}</span>
                      <select className="input" value={CRENEAUX.includes(stop.time_window ?? "") ? stop.time_window : stop.time_window ? "custom" : ""} onChange={(e) => majArret(j, { time_window: e.target.value === "custom" ? stop.time_window ?? "" : e.target.value })}>
                        <option value="">Choisir un créneau…</option>
                        {CRENEAUX.map((c) => <option key={c} value={c}>{c.replace("-", "–")}</option>)}
                        <option value="custom">Autre créneau / horaires détaillés</option>
                      </select>
                      {!CRENEAUX.includes(stop.time_window ?? "") && <input className="input mt-1" value={stop.time_window ?? ""} onChange={(e) => majArret(j, { time_window: e.target.value })} placeholder={stop.type === "ramasse" ? "Ex. 09:30-10:00" : "Ex. lun-ven 09:00-12:00, 14:00-18:00"} />}
                    </label>
                    <label className="block"><span className="label">Consignes (facultatif)</span>
                      <textarea className="input min-h-[52px]" value={stop.notes ?? ""} onChange={(e) => majArret(j, { notes: e.target.value })} placeholder="Contact, accès, code portail, nombre de colis…" />
                    </label>
                    <button type="button" className="btn-secondary w-fit !py-2 text-sm" onClick={() => setModif(null)}>Terminé</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
