"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cibleDepuisSurvol, type CibleDepot } from "@/lib/colis/reordonner";

/** Préfixe des zones de dépôt « fin de liste » (listes vides comprises). */
export const PREFIXE_LISTE = "liste:";
const ID_SANS_LISTE = "principale";

export function idZoneListe(listId: string | null): string {
  return `${PREFIXE_LISTE}${listId ?? ID_SANS_LISTE}`;
}

const ActifContexte = createContext(true);

/**
 * Glisser-déposer des arrêts (liste web et app chauffeur) :
 * - souris : on saisit la poignée ⋮⋮ et on glisse ;
 * - tactile : appui long (250 ms) sur la poignée, pour ne pas gêner le
 *   défilement de la liste ;
 * - clavier : Espace sur la poignée, flèches, Espace pour déposer
 *   (les boutons ↑/↓ restent disponibles en repli).
 * `ordre` : arrêts déplaçables dans l'ordre affiché, avec leur liste.
 * Le dépôt calcule la cible (lib/colis/reordonner.ts) et la transmet.
 */
export function ZoneTri({
  ordre,
  onDeposer,
  actif = true,
  children,
}: {
  ordre: readonly { id: string; list_id: string | null }[];
  onDeposer: (id: string, cible: CibleDepot) => void;
  actif?: boolean;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function fin(e: DragEndEvent) {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    if (over.startsWith(PREFIXE_LISTE)) {
      const cle = over.slice(PREFIXE_LISTE.length);
      onDeposer(active, { list_id: cle === ID_SANS_LISTE ? null : cle, avant_id: null });
      return;
    }
    const cible = cibleDepuisSurvol(ordre, active, over);
    if (cible) onDeposer(active, cible);
  }

  return (
    <ActifContexte.Provider value={actif}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={fin}
        accessibility={{
          screenReaderInstructions: {
            draggable: "Pour déplacer cet arrêt : Espace pour le saisir, flèches haut et bas pour le déplacer, Espace pour le déposer, Échap pour annuler.",
          },
          announcements: {
            onDragStart: () => "Arrêt saisi.",
            onDragOver: ({ over }) => (over ? "Arrêt au-dessus d'une nouvelle position." : "Hors de la liste."),
            onDragEnd: ({ over }) => (over ? "Arrêt déposé : nouvel ordre enregistré." : "Déplacement annulé."),
            onDragCancel: () => "Déplacement annulé.",
          },
        }}
      >
        <SortableContext items={ordre.map((o) => o.id)} strategy={verticalListSortingStrategy} disabled={!actif}>
          {children}
        </SortableContext>
      </DndContext>
    </ActifContexte.Provider>
  );
}

export interface Poignee {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (el: HTMLElement | null) => void;
}

/**
 * Élément triable : rend `rendu(props, poignee)` où props va sur l'élément
 * (ref, style) et poignee sur le bouton de saisie.
 */
export function ArretTriable({
  id,
  rendu,
}: {
  id: string;
  rendu: (props: { ref: (el: HTMLElement | null) => void; style: CSSProperties; "data-glisse"?: boolean }, poignee: Poignee | null) => ReactNode;
}) {
  const actif = useContext(ActifContexte);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !actif });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    position: isDragging ? "relative" : undefined,
    boxShadow: isDragging ? "0 8px 24px rgba(10,15,30,0.18)" : undefined,
  };
  return <>{rendu({ ref: setNodeRef, style, "data-glisse": isDragging || undefined }, actif ? { attributes, listeners, setActivatorNodeRef } : null)}</>;
}

/** Poignée de saisie (⋮⋮), cible tactile de 44 px. */
export function BoutonPoignee({ poignee, libelle }: { poignee: Poignee | null; libelle: string }) {
  if (!poignee) return null;
  return (
    <button
      type="button"
      ref={poignee.setActivatorNodeRef}
      {...poignee.attributes}
      {...poignee.listeners}
      aria-label={`Déplacer ${libelle} (appui long ou glisser)`}
      className="flex h-11 w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-navy/40 hover:bg-navy/[0.05] hover:text-navy/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal active:cursor-grabbing"
    >
      <svg viewBox="0 0 12 20" aria-hidden="true" className="h-5 w-3 fill-current">
        <circle cx="3" cy="4" r="1.6" />
        <circle cx="9" cy="4" r="1.6" />
        <circle cx="3" cy="10" r="1.6" />
        <circle cx="9" cy="10" r="1.6" />
        <circle cx="3" cy="16" r="1.6" />
        <circle cx="9" cy="16" r="1.6" />
      </svg>
    </button>
  );
}

/** Zone de dépôt « fin de liste » (utile pour une liste vide ou pour changer de liste). */
export function ZoneFinListe({ listId, children, className }: { listId: string | null; children?: ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: idZoneListe(listId) });
  return (
    <li ref={setNodeRef} className={`${className ?? ""} ${isOver ? "bg-teal/10" : ""}`} aria-hidden={children ? undefined : true}>
      {children}
    </li>
  );
}
