"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DndContext, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import {
  affectationsParCase,
  AUCUN_CHAUFFEUR,
  chauffeursAffiches,
  cleCase,
  congeDuJour,
  estCopiable,
  estModifiable,
  heureDe,
  jourDe,
  JOURS_LONGS,
  libelleJour,
  rangJour,
  STATUTS_AFFECTATION,
  statutAffectation,
} from "@/lib/planning/semaine";
import {
  AjoutAffectation,
  annoncerCopie,
  DupliquerJournee,
  DupliquerSemaine,
  dupliquerAffectations,
  EditionAffectation,
  type DonneesPlanning,
  type EntreeAffichee,
  type Ton,
} from "@/components/planning/FenetresPlanning";
import { DriverWeekSheet } from "@/components/planning/DriverWeekSheet";
import { PlanningTemplatesPanel } from "@/components/planning/PlanningTemplatesPanel";
import { IconAlertTriangle, IconCheck, IconCopy, IconX } from "@/components/layout/icons";

const CLE_AIDE = "godac.planning.aide-fermee";

type Fenetre =
  | { type: "ajout"; chauffeur: { id: string; full_name: string }; date: string }
  | { type: "edition"; entree: EntreeAffichee }
  | { type: "jour"; date: string; chauffeur: { id: string; full_name: string } | null }
  | { type: "semaine" }
  | null;

/**
 * Planning : lignes = chauffeurs, colonnes = jours (7 en semaine, 1 en
 * vue jour). Le geste principal tient en un clic :
 * - case vide → « Ajouter » (chauffeur et jour remplis) ;
 * - pastille → modifier, supprimer, dupliquer vers d'autres jours ;
 * - glisser une pastille → autre jour et/ou autre chauffeur ;
 * - Maj+clic → sélection, « Copier », puis clic sur une case → coller.
 * Sur téléphone : un jour à la fois, une carte par chauffeur, gros boutons.
 */
export function PlanningSemaine({
  mode,
  jours,
  lundi,
  selectedService,
  serviceIds,
  donnees,
  rattachements,
  peutModifier,
  canValidate,
  validatedAt,
  modeles,
}: {
  mode: "semaine" | "jour";
  jours: string[];
  lundi: string;
  selectedService: string;
  /** Services affichés (filtre en haut, ou tous ceux de la personne). */
  serviceIds: string[];
  donnees: DonneesPlanning;
  rattachements: { user_id: string; service_id: string }[];
  peutModifier: boolean;
  canValidate: boolean;
  validatedAt: string | null;
  modeles: { routes: { id: string; tourNumber: string; serviceId: string | null }[]; vehicles: { id: string; registration: string; serviceId: string | null }[] };
}) {
  const router = useRouter();
  const [fenetre, setFenetre] = useState<Fenetre>(null);
  const [message, setMessage] = useState<{ texte: string; ton: Ton } | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [modeSelection, setModeSelection] = useState(false);
  const [pressePapiers, setPressePapiers] = useState<EntreeAffichee[] | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [deplacements, setDeplacements] = useState<Record<string, { driver_id: string; start_at: string }>>({});
  const [ficheChauffeur, setFicheChauffeur] = useState<{ id: string; full_name: string } | null>(null);
  const [modelesOuverts, setModelesOuverts] = useState(false);
  const [aideFermee, setAideFermee] = useState(true);
  const [validation, setValidation] = useState(false);
  const aujourdhui = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const [jourMobile, setJourMobile] = useState(jours.includes(aujourdhui) ? aujourdhui : jours[0]!);
  const petitEcran = usePetitEcran();

  useEffect(() => {
    try {
      setAideFermee(window.localStorage.getItem(CLE_AIDE) === "1");
    } catch {
      setAideFermee(false);
    }
  }, []);
  useEffect(() => {
    setJourMobile(jours.includes(aujourdhui) ? aujourdhui : jours[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jours.join()]);
  // Données fraîches du serveur : les déplacements optimistes sont absorbés.
  useEffect(() => setDeplacements({}), [donnees.affectations]);

  function fermerAide() {
    setAideFermee(true);
    try {
      window.localStorage.setItem(CLE_AIDE, "1");
    } catch {
      /* stockage indisponible : l'aide reviendra au prochain chargement */
    }
  }

  function resultat(texte: string, ton: Ton) {
    setMessage({ texte, ton });
    router.refresh();
  }

  // Affectations affichées : services filtrés, jours visibles, déplacements en cours.
  const services = new Set(serviceIds);
  const visibles = new Set(jours);
  const affichees = useMemo(
    () =>
      donnees.affectations
        .map((a) => (deplacements[a.id] ? { ...a, ...deplacements[a.id]! } : a))
        .filter((a) => services.has(a.service_id) && visibles.has(jourDe(a.start_at))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [donnees.affectations, deplacements, serviceIds.join(), jours.join()],
  );
  const parCase = useMemo(() => affectationsParCase(affichees), [affichees]);
  const chauffeurs = useMemo(() => chauffeursAffiches(donnees.chauffeurs, rattachements, serviceIds, affichees), [donnees.chauffeurs, rattachements, serviceIds, affichees]);
  const sansChauffeur = affichees.filter((a) => !a.driver_id);
  const lignes: { id: string | null; full_name: string }[] = [...(sansChauffeur.length ? [{ id: null, full_name: "À attribuer" }] : []), ...chauffeurs];

  function serviceParDefaut(chauffeurId: string): string {
    if (selectedService) return selectedService;
    return rattachements.find((r) => r.user_id === chauffeurId && services.has(r.service_id))?.service_id ?? serviceIds[0] ?? "";
  }

  // --- Navigation -------------------------------------------------------
  function aller(params: Record<string, string>) {
    const qs = new URLSearchParams({ view: mode === "jour" ? "day" : "week", ...params });
    if (selectedService) qs.set("service", selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }
  const precedent = () => (mode === "jour" ? aller({ day: addDays(jours[0]!, -1) }) : aller({ week: addDays(lundi, -7) }));
  const suivant = () => (mode === "jour" ? aller({ day: addDays(jours[0]!, 1) }) : aller({ week: addDays(lundi, 7) }));
  const maintenant = () => (mode === "jour" ? aller({ day: aujourdhui }) : aller({ week: aujourdhui }));
  const titrePeriode =
    mode === "jour"
      ? `${JOURS_LONGS[rangJour(jours[0]!)]} ${new Date(`${jours[0]}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}`
      : `Semaine du ${new Date(`${lundi}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })} au ${new Date(`${addDays(lundi, 6)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}`;
  const estMaintenant = jours.includes(aujourdhui);

  // --- Déplacer (glisser-déposer) --------------------------------------
  const capteurs = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));

  async function deposer(e: DragEndEvent) {
    const id = String(e.active.id);
    const cible = e.over ? String(e.over.id) : null;
    const entree = affichees.find((a) => a.id === id);
    if (!cible || !entree) return;
    const [chauffeurCible, dateCible] = cible.split("|") as [string, string];
    if (cleCase(entree.driver_id, jourDe(entree.start_at)) === cible) return;
    if (chauffeurCible === AUCUN_CHAUFFEUR) {
      setMessage({ texte: "Déposez la tournée sur la ligne d'un chauffeur.", ton: "attention" });
      return;
    }
    const startAt = parisWallTimeToUtcISOString(dateCible, heureDe(entree.start_at));
    setDeplacements((d) => ({ ...d, [id]: { driver_id: chauffeurCible, start_at: startAt } }));
    setOccupe(id);
    const r = await fetchGodac<{ warning?: string | null }>(`/api/planning/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_at: startAt, ...(chauffeurCible !== entree.driver_id ? { driver_id: chauffeurCible } : {}) }),
    });
    setOccupe(null);
    if (!r.ok) {
      setDeplacements((d) => {
        const { [id]: _annule, ...reste } = d;
        return reste;
      });
      setMessage({ texte: r.refus.message, ton: "erreur" });
      return;
    }
    const nom = donnees.chauffeurs.find((c) => c.id === chauffeurCible)?.full_name ?? "";
    resultat(`Tournée n°${entree.tour_number} déplacée : ${nom}, ${libelleJour(dateCible)}.${r.data.warning ? ` ${r.data.warning}` : ""}`, r.data.warning ? "attention" : "ok");
  }

  // --- Sélection, copier / coller --------------------------------------
  function basculerSelection(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function copier() {
    const copiees = affichees.filter((a) => selection.has(a.id) && estCopiable(a));
    if (!copiees.length) {
      setMessage({ texte: "Rien à copier : sélectionnez des tournées avec chauffeur et véhicule.", ton: "attention" });
      return;
    }
    setPressePapiers(copiees);
    setSelection(new Set());
    setModeSelection(false);
    setMessage(null);
  }
  async function coller(chauffeurId: string | null, date: string) {
    if (!pressePapiers) return;
    const vehiculeAttribue = chauffeurId ? donnees.vehicules.find((v) => v.assigned_driver_id === chauffeurId)?.id : undefined;
    setOccupe(cleCase(chauffeurId, date));
    const r = await dupliquerAffectations(
      pressePapiers.map((a) => {
        const autreChauffeur = chauffeurId && chauffeurId !== a.driver_id;
        return { id: a.id, target_dates: [date], ...(autreChauffeur ? { driver_id: chauffeurId!, ...(vehiculeAttribue ? { vehicle_id: vehiculeAttribue } : {}) } : {}) };
      }),
    );
    setOccupe(null);
    annoncerCopie(r, resultat);
  }

  useEffect(() => {
    function touche(e: KeyboardEvent) {
      if (e.key === "Escape" && !fenetre) {
        setSelection(new Set());
        setPressePapiers(null);
        setModeSelection(false);
      }
    }
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [fenetre]);

  // --- Clics ----------------------------------------------------------
  function clicPastille(entree: EntreeAffichee, maj: boolean) {
    if (peutModifier && (maj || modeSelection)) return basculerSelection(entree.id);
    setFenetre({ type: "edition", entree });
  }
  function clicCase(chauffeur: { id: string | null; full_name: string }, date: string) {
    if (!peutModifier) return;
    if (pressePapiers) return void coller(chauffeur.id, date);
    if (!chauffeur.id) return;
    setFenetre({ type: "ajout", chauffeur: { id: chauffeur.id, full_name: chauffeur.full_name }, date });
  }

  async function valider() {
    if (!selectedService) return;
    setValidation(true);
    const r = await fetchGodac("/api/planning/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service_id: selectedService, week_start: lundi }) });
    setValidation(false);
    if (!r.ok) return setMessage({ texte: r.refus.message, ton: "erreur" });
    resultat("Planning validé et envoyé aux chauffeurs.", "ok");
  }

  async function dupliquerSemainePrecedente() {
    setOccupe("semaine");
    const r = await fetchGodac<{ created: number; skipped: number; conflicts: number; source_count: number; warning?: string | null }>("/api/planning/duplicate-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_week_start: addDays(lundi, -7), target_week_start: lundi, service_id: selectedService || undefined }),
    });
    setOccupe(null);
    if (!r.ok) return setMessage({ texte: r.refus.message, ton: "erreur" });
    if (!r.data.source_count) return setMessage({ texte: "La semaine précédente est vide : rien à recopier.", ton: "attention" });
    resultat(`Semaine précédente recopiée : ${r.data.created} créée${r.data.created > 1 ? "s" : ""}, ${r.data.skipped} ignorée${r.data.skipped > 1 ? "s" : ""} (déjà occupée${r.data.skipped > 1 ? "s" : ""}), ${r.data.conflicts} en conflit.`, r.data.conflicts ? "attention" : "ok");
  }

  const nomService = selectedService ? (donnees.services.find((s) => s.id === selectedService)?.name ?? null) : null;
  const vide = affichees.length === 0;

  // --- Rendu d'une case (grille et vue téléphone) ----------------------
  function contenuCase(ligne: { id: string | null; full_name: string }, date: string, grand: boolean): ReactNode {
    const liste = parCase.get(cleCase(ligne.id, date)) ?? [];
    const conge = ligne.id ? congeDuJour(ligne.id, date, donnees.conges) : null;
    const libelleCase = `${ligne.full_name}, ${JOURS_LONGS[rangJour(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
    return (
      <>
        {conge && (
          <span className={`mb-1 inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${conge === "approved" ? "bg-orange/15 text-orange-ink" : "border border-dashed border-orange/50 text-orange-ink"}`}>
            {conge === "approved" ? "Congé" : "Congé demandé"}
          </span>
        )}
        <div className="flex flex-col gap-1">
          {liste.map((a) => (
            <Pastille
              key={a.id}
              entree={a}
              grand={grand}
              plusieursServices={serviceIds.length > 1}
              nomService={donnees.services.find((s) => s.id === a.service_id)?.name}
              deplacable={peutModifier && estModifiable(a) && !pressePapiers && !modeSelection}
              selectionnee={selection.has(a.id)}
              modeSelection={modeSelection}
              occupee={occupe === a.id}
              onClic={(maj) => clicPastille(a, maj)}
            />
          ))}
        </div>
        {peutModifier && (
          <div className="mt-auto flex gap-1 pt-1">
            {(ligne.id || pressePapiers) && (
              <button
                type="button"
                onClick={() => clicCase(ligne, date)}
                disabled={occupe === cleCase(ligne.id, date)}
                aria-label={pressePapiers ? `Coller ici : ${libelleCase}` : `Ajouter une tournée : ${libelleCase}`}
                className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-dashed text-sm transition-colors focus-visible:opacity-100 ${
                  pressePapiers
                    ? "border-teal bg-teal/10 text-teal-ink"
                    : grand
                      ? "border-navy/20 text-navy/70 hover:border-teal hover:text-teal-ink"
                      : `border-transparent text-navy/40 hover:border-teal/60 hover:text-teal-ink ${liste.length ? "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100" : ""}`
                }`}
              >
                {pressePapiers ? "Coller ici" : grand ? "+ Ajouter une tournée" : "+"}
              </button>
            )}
            {liste.some(estCopiable) && !pressePapiers && (
              <button
                type="button"
                onClick={() => setFenetre({ type: "jour", date, chauffeur: ligne.id ? { id: ligne.id, full_name: ligne.full_name } : null })}
                aria-label={`Dupliquer la journée : ${libelleCase}`}
                title="Dupliquer cette journée vers d'autres jours"
                className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-transparent text-navy/45 hover:border-teal/60 hover:text-teal-ink focus-visible:opacity-100 ${grand ? "border-navy/15 px-3 text-sm" : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"}`}
              >
                <IconCopy className="h-4 w-4" aria-hidden="true" />
                {grand && <span className="ml-1.5">Dupliquer la journée</span>}
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      {/* Navigation et actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary min-h-[44px] !px-3" onClick={precedent} aria-label={mode === "jour" ? "Jour précédent" : "Semaine précédente"}>
            ←
          </button>
          <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" onClick={maintenant} disabled={estMaintenant}>
            {mode === "jour" ? "Aujourd'hui" : "Cette semaine"}
          </button>
          <button type="button" className="btn-secondary min-h-[44px] !px-3" onClick={suivant} aria-label={mode === "jour" ? "Jour suivant" : "Semaine suivante"}>
            →
          </button>
        </div>
        <h2 className="font-display text-base font-semibold first-letter:uppercase">{titrePeriode}</h2>
        {peutModifier && (
          <div className="ml-auto flex flex-wrap gap-2">
            {mode === "semaine" && (
              <button type="button" className="btn-primary min-h-[44px] !px-3 text-sm" onClick={() => setFenetre({ type: "semaine" })}>
                <IconCopy className="inline-block h-4 w-4 align-[-0.2em]" aria-hidden="true" /> Dupliquer la semaine
              </button>
            )}
            <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" aria-expanded={modelesOuverts} onClick={() => setModelesOuverts((v) => !v)}>
              Modèles
            </button>
            <button
              type="button"
              className={`btn-secondary min-h-[44px] !px-3 text-sm ${modeSelection ? "!border-teal !bg-teal/15" : ""}`}
              aria-pressed={modeSelection}
              onClick={() => {
                setModeSelection((v) => !v);
                setSelection(new Set());
                setPressePapiers(null);
              }}
            >
              Sélectionner
            </button>
            {canValidate && mode === "semaine" && selectedService && (
              <button
                type="button"
                className="btn-secondary min-h-[44px] !px-3 text-sm"
                disabled={validation}
                onClick={valider}
                title={validatedAt ? `Déjà envoyé le ${new Date(validatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} — cliquez pour renvoyer avec les changements` : "Envoyer le planning de la semaine aux chauffeurs du service"}
              >
                <IconCheck className="inline-block h-4 w-4 align-[-0.2em]" aria-hidden="true" /> {validation ? "Envoi…" : validatedAt ? "Envoyé — renvoyer" : "Valider et envoyer"}
              </button>
            )}
          </div>
        )}
      </div>

      {canValidate && mode === "semaine" && !selectedService && peutModifier && <p className="text-xs text-navy/60">Pour valider et envoyer le planning aux chauffeurs, choisissez d&apos;abord un service dans le filtre.</p>}

      {!aideFermee && peutModifier && (
        <div className="flex items-start gap-3 rounded-xl border border-teal/30 bg-teal/[0.08] p-3 text-sm">
          <p className="flex-1 text-navy/80">
            <strong>Cliquez sur une case</strong> pour ajouter une tournée, <strong>sur une pastille</strong> pour la modifier ou la dupliquer.
            <br />
            <strong>Glissez une pastille</strong> vers un autre jour ou un autre chauffeur pour la déplacer ; <strong>Maj+clic</strong> pour en sélectionner plusieurs et les copier.
          </p>
          <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-navy/60 hover:bg-navy/[0.05]" onClick={fermerAide} aria-label="Fermer l'aide">
            <IconX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {modelesOuverts && peutModifier && (
        <PlanningTemplatesPanel services={donnees.services} selectedService={selectedService} weekStart={lundi} routes={modeles.routes} vehicles={modeles.vehicles} />
      )}

      {message && (
        <div
          role={message.ton === "erreur" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-lg p-2.5 text-sm ${message.ton === "erreur" ? "bg-orange/10 text-orange-ink" : message.ton === "attention" ? "bg-gold/15 text-gold-ink" : "bg-teal/10 text-teal-ink"}`}
        >
          {message.ton !== "ok" && <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="flex-1">{message.texte}</span>
          <button type="button" className="-my-1 shrink-0 rounded px-2 text-navy/50 hover:text-navy" onClick={() => setMessage(null)} aria-label="Masquer le message">
            ×
          </button>
        </div>
      )}

      {vide && peutModifier && mode === "semaine" && (
        <div className="rounded-xl border border-dashed border-navy/20 bg-surface p-4 text-sm">
          <p className="font-medium">Aucune affectation cette semaine.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-[44px] text-sm" disabled={occupe === "semaine"} onClick={dupliquerSemainePrecedente}>
              {occupe === "semaine" ? "Copie…" : "Dupliquer la semaine précédente"}
            </button>
            <button type="button" className="btn-secondary min-h-[44px] text-sm" onClick={() => setModelesOuverts(true)}>
              Générer depuis les modèles
            </button>
          </div>
          <p className="mt-2 text-xs text-navy/60">Ou cliquez sur une case ci-dessous pour ajouter une première tournée.</p>
        </div>
      )}
      {vide && (!peutModifier || mode === "jour") && <p className="rounded-xl bg-navy/[0.035] p-3 text-sm text-navy/70">Aucune affectation {mode === "jour" ? "ce jour-là" : "cette semaine"}.</p>}

      <Legende />

      <DndContext sensors={capteurs} onDragEnd={(e) => void deposer(e)}>
        {/* Tablette et ordinateur : grille, colonne chauffeurs figée.
            Une seule des deux présentations est montée : chaque pastille et
            chaque case ne s'inscrivent qu'une fois auprès du glisser-déposer. */}
        {!petitEcran && (
        <div className="overflow-x-auto rounded-xl border border-navy/10 bg-surface">
          <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: mode === "jour" ? 480 : 1040 }}>
            <caption className="sr-only">Planning {titrePeriode} : une ligne par chauffeur, une colonne par jour.</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-20 w-44 border-b border-r border-navy/10 bg-surface px-3 py-2 text-left text-xs font-semibold text-navy/60">
                  Chauffeur
                </th>
                {jours.map((d) => (
                  <th key={d} scope="col" className={`border-b border-navy/10 px-2 py-2 text-left text-xs font-semibold ${d === aujourdhui ? "bg-teal/10 text-teal-ink" : "text-navy/60"}`}>
                    <span className="first-letter:uppercase">{libelleJour(d)}</span>
                    {peutModifier && affichees.some((a) => jourDe(a.start_at) === d && estCopiable(a)) && (
                      <button type="button" className="ml-1 rounded px-1 font-normal text-navy/50 underline-offset-2 hover:text-teal-ink hover:underline" onClick={() => setFenetre({ type: "jour", date: d, chauffeur: null })} aria-label={`Dupliquer toute la journée du ${libelleJour(d)}`}>
                        dupliquer
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.length === 0 && (
                <tr>
                  <td colSpan={jours.length + 1} className="p-4 text-sm text-navy/60">
                    Aucun chauffeur rattaché à ce service (voir Organisation › Utilisateurs).
                  </td>
                </tr>
              )}
              {lignes.map((ligne) => (
                <tr key={ligne.id ?? AUCUN_CHAUFFEUR}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-navy/10 bg-surface px-3 py-2 text-left align-top font-medium">
                    {ligne.id ? (
                      <button type="button" className="min-h-[44px] text-left underline-offset-2 hover:text-teal-ink hover:underline" onClick={() => setFicheChauffeur({ id: ligne.id!, full_name: ligne.full_name })} title="Voir la semaine de ce chauffeur">
                        {ligne.full_name}
                      </button>
                    ) : (
                      <span className="inline-flex min-h-[44px] items-center text-orange-ink">{ligne.full_name}</span>
                    )}
                  </th>
                  {jours.map((d) => (
                    <Case key={d} id={cleCase(ligne.id, d)} aujourdhui={d === aujourdhui} actif={peutModifier}>
                      {contenuCase(ligne, d, false)}
                    </Case>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* Téléphone : un jour, une carte par chauffeur */}
        {petitEcran && (
        <div>
          {jours.length > 1 && (
            <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Jour affiché">
              {jours.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={d === jourMobile}
                  onClick={() => setJourMobile(d)}
                  className={`flex min-h-[52px] min-w-[52px] flex-1 flex-col items-center justify-center rounded-lg border text-sm ${d === jourMobile ? "border-teal bg-teal/20 font-semibold text-teal-ink" : "border-navy/15 text-navy/70"}`}
                >
                  <span className="text-xs">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][rangJour(d)]}</span>
                  {Number(d.slice(8, 10))}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {lignes.map((ligne) => (
              <section key={ligne.id ?? AUCUN_CHAUFFEUR} className="rounded-xl border border-navy/10 bg-surface p-3" aria-label={ligne.full_name}>
                <h3 className="mb-2 font-medium">
                  {ligne.id ? (
                    <button type="button" className="min-h-[44px] text-left underline-offset-2 hover:underline" onClick={() => setFicheChauffeur({ id: ligne.id!, full_name: ligne.full_name })}>
                      {ligne.full_name}
                    </button>
                  ) : (
                    <span className="text-orange-ink">{ligne.full_name}</span>
                  )}
                </h3>
                <Case id={cleCase(ligne.id, jourMobile)} aujourdhui={false} actif={peutModifier} carte>
                  {contenuCase(ligne, jourMobile, true)}
                </Case>
              </section>
            ))}
          </div>
        </div>
        )}
      </DndContext>

      {/* Barre de sélection / collage */}
      {peutModifier && (selection.size > 0 || pressePapiers) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-navy/10 bg-surface/95 p-3 shadow-pop backdrop-blur" role="region" aria-label="Sélection">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
            {pressePapiers ? (
              <>
                <span className="flex-1">
                  <strong>
                    {pressePapiers.length} tournée{pressePapiers.length > 1 ? "s" : ""} copiée{pressePapiers.length > 1 ? "s" : ""}
                  </strong>{" "}
                  — cliquez sur « Coller ici » dans une case : même heure, jour et chauffeur de la case.
                </span>
                <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setPressePapiers(null)}>
                  Terminer
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">
                  <strong>
                    {selection.size} sélectionnée{selection.size > 1 ? "s" : ""}
                  </strong>
                </span>
                <button type="button" className="btn-primary min-h-[44px]" onClick={copier}>
                  <IconCopy className="inline-block h-4 w-4 align-[-0.2em]" aria-hidden="true" /> Copier
                </button>
                <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setSelection(new Set())}>
                  Tout désélectionner
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {fenetre?.type === "ajout" && (
        <AjoutAffectation chauffeur={fenetre.chauffeur} date={fenetre.date} serviceIds={serviceIds} serviceParDefaut={serviceParDefaut(fenetre.chauffeur.id)} donnees={donnees} onFermer={() => setFenetre(null)} onResultat={resultat} />
      )}
      {fenetre?.type === "edition" && <EditionAffectation entree={fenetre.entree} peutModifier={peutModifier} donnees={donnees} onFermer={() => setFenetre(null)} onResultat={resultat} />}
      {fenetre?.type === "jour" && (
        <DupliquerJournee
          date={fenetre.date}
          chauffeur={fenetre.chauffeur}
          entrees={affichees.filter((a) => jourDe(a.start_at) === fenetre.date && (!fenetre.chauffeur || a.driver_id === fenetre.chauffeur.id))}
          onFermer={() => setFenetre(null)}
          onResultat={resultat}
        />
      )}
      {fenetre?.type === "semaine" && <DupliquerSemaine lundi={lundi} serviceId={selectedService} nomService={nomService} onFermer={() => setFenetre(null)} onResultat={resultat} />}

      {ficheChauffeur && (
        <DriverWeekSheet driver={ficheChauffeur} weekStart={lundi} services={donnees.services} vehicles={donnees.vehicules} entries={donnees.affectations.filter((a) => a.driver_id === ficheChauffeur.id)} onClose={() => setFicheChauffeur(null)} />
      )}
    </div>
  );
}

/** Téléphone (< 768 px) : vue jour en cartes. Rendu serveur : grille. */
function usePetitEcran(): boolean {
  const [petit, setPetit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const maj = () => setPetit(mq.matches);
    maj();
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);
  return petit;
}

function Legende() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy/65" aria-label="Légende">
      {Object.entries(STATUTS_AFFECTATION).map(([cle, s]) => (
        <li key={cle} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${s.point}`} aria-hidden="true" />
          {s.libelle}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="rounded bg-orange/15 px-1 text-[10px] font-semibold text-orange-ink">Congé</span>
        absence validée
      </li>
    </ul>
  );
}

function Case({ id, aujourdhui, actif, carte = false, children }: { id: string; aujourdhui: boolean; actif: boolean; carte?: boolean; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled: !actif });
  if (carte) {
    return (
      <div ref={setNodeRef} className={`flex flex-col rounded-lg ${isOver ? "bg-teal/10 ring-2 ring-teal" : ""}`}>
        {children}
      </div>
    );
  }
  return (
    <td ref={setNodeRef} className={`group h-px border-b border-navy/10 p-1 align-top ${aujourdhui ? "bg-teal/[0.04]" : ""} ${isOver ? "bg-teal/10 outline outline-2 -outline-offset-2 outline-teal" : ""}`} style={{ minWidth: 128 }}>
      <div className="flex h-full min-h-[52px] flex-col">{children}</div>
    </td>
  );
}

function Pastille({
  entree,
  grand,
  plusieursServices,
  nomService,
  deplacable,
  selectionnee,
  modeSelection,
  occupee,
  onClic,
}: {
  entree: EntreeAffichee;
  grand: boolean;
  plusieursServices: boolean;
  nomService?: string;
  deplacable: boolean;
  selectionnee: boolean;
  modeSelection: boolean;
  occupee: boolean;
  onClic: (maj: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: entree.id, disabled: !deplacable });
  const statut = statutAffectation(entree.status);
  const heure = heureDe(entree.start_at);
  const verrou = !estModifiable(entree) ? ` — ${statut.libelle.toLowerCase()}, ne se déplace plus` : "";
  const libelle = `Tournée n°${entree.tour_number} à ${heure}${entree.vehicles ? `, ${entree.vehicles.registration}` : ""}, ${statut.libelle.toLowerCase()}${nomService && plusieursServices ? `, ${nomService}` : ""}${verrou}`;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      // Les attributs de glisser posent role="button" + aria-roledescription : on garde un bouton simple.
      role={undefined}
      aria-roledescription={undefined}
      aria-disabled={undefined}
      aria-pressed={modeSelection || selectionnee ? selectionnee : undefined}
      aria-label={libelle}
      title={libelle}
      onClick={(e) => onClic(e.shiftKey)}
      style={{ transform: CSS.Translate.toString(transform), zIndex: isDragging ? 30 : undefined }}
      className={`relative flex w-full items-center gap-1.5 rounded-md border px-1.5 text-left text-xs shadow-sm transition-shadow ${grand ? "min-h-[48px] text-sm" : "min-h-[44px]"} ${statut.pastille} ${
        deplacable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${selectionnee ? "ring-2 ring-teal ring-offset-1" : ""} ${isDragging ? "shadow-raised" : ""} ${occupee ? "opacity-50" : ""}`}
    >
      {(modeSelection || selectionnee) && (
        <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectionnee ? "border-teal bg-teal text-marine" : "border-navy/30 bg-surface"}`}>
          {selectionnee && <IconCheck className="h-3 w-3" />}
        </span>
      )}
      <span className={`h-2 w-2 shrink-0 rounded-full ${statut.point}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-semibold">
          n°{entree.tour_number} <span className="font-normal tabular-nums text-navy/70">{heure}</span>
        </span>
        <span className="block truncate text-[11px] text-navy/60">
          {entree.vehicles?.registration ?? "Sans véhicule"}
          {plusieursServices && nomService ? ` · ${nomService}` : ""}
        </span>
      </span>
    </button>
  );
}
