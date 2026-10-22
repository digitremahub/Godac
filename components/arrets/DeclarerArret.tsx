"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { IconAlertTriangle, IconCamera, IconX } from "@/components/layout/icons";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { TYPES_DECLARABLES, dateCourte, libelleTypeArret, type TypeDeclarable } from "@/lib/arrets/declaration";

const BUCKET = "work-stoppage-docs";
const MAX_DOCUMENTS = 4;
const MAX_OCTETS = 10 * 1024 * 1024;
const TYPES_FICHIERS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

export interface ArretProlongeable {
  id: string;
  userId: string;
  type: string;
  du: string;
  au: string;
}

interface Document {
  chemin: string;
  nom: string;
}

/**
 * Déclaration d'un arrêt de travail — mobile d'abord. Salarié : son
 * arrêt (photo du volet employeur obligatoire). Encadrement / paie :
 * saisie pour un salarié de son périmètre (avis reçu en main propre).
 * La photo est déposée dès qu'elle est choisie ; la lecture automatique
 * (module OCR) propose type et dates, que la personne confirme.
 */
export function DeclarerArret({
  organizationId,
  moi,
  salaries,
  prolongeables,
  lectureAuto,
  ouvert: ouvertInitial = false,
}: {
  organizationId: string;
  moi: string;
  /** Encadrement : salariés de son périmètre. Absent : déclaration pour soi. */
  salaries?: { id: string; nom: string }[];
  prolongeables: ArretProlongeable[];
  lectureAuto: boolean;
  ouvert?: boolean;
}) {
  const router = useRouter();
  const pourAutrui = Boolean(salaries);
  const [ouvert, setOuvert] = useState(ouvertInitial);
  const [cible, setCible] = useState(salaries ? "" : moi);
  const [nature, setNature] = useState<"initial" | "prolongation">("initial");
  const [prolongeId, setProlongeId] = useState("");
  const [type, setType] = useState<TypeDeclarable>("maladie");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [depot, setDepot] = useState(false);
  const [lecture, setLecture] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState<string | null>(null);

  const prolongeablesCible = useMemo(() => prolongeables.filter((a) => a.userId === cible), [prolongeables, cible]);
  const prolonge = prolongeablesCible.find((a) => a.id === prolongeId) ?? null;

  function reinitialiser() {
    setNature("initial");
    setProlongeId("");
    setType("maladie");
    setDu("");
    setAu("");
    setDocuments([]);
    setLecture(null);
  }

  async function lireAutomatiquement(chemin: string) {
    setLecture("Lecture de l'avis…");
    try {
      const res = await fetch("/api/arrets/lecture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: chemin }) });
      const json = (await res.json().catch(() => ({}))) as {
        champs?: { type: TypeDeclarable | null; du: string | null; au: string | null; prolongation: boolean | null } | null;
        info?: string;
        error?: string;
        voletMedical?: boolean;
      };
      if (json.voletMedical) {
        setDocuments((d) => d.filter((x) => x.chemin !== chemin));
        setLecture(null);
        setErreur(json.error ?? "Photo du volet médical retirée.");
        return;
      }
      const c = json.champs;
      if (!c) {
        setLecture(json.info ?? json.error ?? null);
        return;
      }
      if (c.type && nature === "initial") setType(c.type);
      if (c.du) setDu(c.du);
      if (c.au) setAu(c.au);
      if (c.prolongation && prolongeablesCible.length > 0) setNature("prolongation");
      setLecture("Dates et type pré-remplis depuis la photo : vérifiez-les avant d'envoyer.");
    } catch {
      setLecture(null);
    }
  }

  async function ajouterFichiers(fichiers: FileList | null) {
    if (!fichiers || !cible) return;
    setErreur(null);
    const supabase = createBrowserSupabaseClient();
    setDepot(true);
    let n = documents.length;
    try {
      for (const f of Array.from(fichiers)) {
        if (n >= MAX_DOCUMENTS) break;
        if (f.type && !TYPES_FICHIERS.includes(f.type)) {
          setErreur("Formats acceptés : photo (JPEG, PNG, WebP, HEIC) ou PDF.");
          continue;
        }
        if (f.size > MAX_OCTETS) {
          setErreur("Chaque fichier doit faire moins de 10 Mo.");
          continue;
        }
        const ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
        const chemin = `${organizationId}/${cible}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(chemin, f, { contentType: f.type || "image/jpeg" });
        if (error) throw new Error(`Envoi de la photo impossible : ${error.message}`);
        const premier = n === 0;
        n++;
        setDocuments((d) => [...d, { chemin, nom: f.name }]);
        if (premier && lectureAuto && !du && !au) await lireAutomatiquement(chemin);
      }
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setDepot(false);
    }
  }

  async function envoyer() {
    setBusy(true);
    setErreur(null);
    setEnvoye(null);
    try {
      const res = await fetch("/api/arrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(pourAutrui ? { user_id: cible } : {}),
          type: prolonge ? prolonge.type : type,
          du,
          au,
          prolonge_id: nature === "prolongation" ? prolongeId || null : null,
          documents: documents.map((d) => d.chemin),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; tournees?: number };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Envoi impossible");
      setEnvoye(
        pourAutrui
          ? `Arrêt enregistré${json.tournees ? ` : ${json.tournees} tournée${json.tournees > 1 ? "s" : ""} à remplacer au planning` : ""}.`
          : "Arrêt envoyé. Votre responsable est prévenu ; vous serez notifié dès qu'il l'aura enregistré.",
      );
      reinitialiser();
      setOuvert(false);
      router.refresh();
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const pret = Boolean(cible && du && au && au >= du && (nature === "initial" || prolongeId) && (pourAutrui || documents.length > 0));

  if (!ouvert) {
    return (
      <div className="flex flex-col gap-2">
        {envoye && <p role="status" className="rounded-lg bg-teal/10 px-3 py-2 text-sm text-teal-ink">{envoye}</p>}
        <button type="button" className="btn-primary min-h-[48px] w-full sm:w-fit" onClick={() => setOuvert(true)}>
          {pourAutrui ? "Saisir un arrêt pour un salarié" : "Déclarer un arrêt de travail"}
        </button>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg">{pourAutrui ? "Saisir un arrêt de travail" : "Déclarer un arrêt de travail"}</h3>
        <button type="button" className="btn-ghost !p-2" aria-label="Fermer" onClick={() => setOuvert(false)}>
          <IconX className="h-5 w-5" />
        </button>
      </div>

      <p role="note" className="flex gap-2 rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Photographiez <strong>uniquement le volet destiné à l&apos;employeur</strong> (volet 3 de l&apos;avis d&apos;arrêt, volet 4 du certificat
          d&apos;accident du travail). N&apos;envoyez jamais le volet 1 : il contient des informations médicales qui ne concernent que la Sécurité
          sociale.
        </span>
      </p>

      {erreur && <p role="alert" className="text-sm text-orange-ink">{erreur}</p>}

      {salaries && (
        <label className="block">
          <span className="label">Salarié</span>
          <select
            className="input"
            value={cible}
            onChange={(e) => {
              setCible(e.target.value);
              setDocuments([]);
              setProlongeId("");
            }}
          >
            <option value="">Choisir…</option>
            {salaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        </label>
      )}

      <div>
        <span className="label">Photo de l&apos;avis {pourAutrui ? "(facultatif)" : ""}</span>
        <div className="flex flex-wrap gap-2">
          {documents.map((d, i) => (
            <span key={d.chemin} className="badge-teal inline-flex items-center gap-1">
              Volet {i + 1}
              <button type="button" aria-label={`Retirer ${d.nom}`} onClick={() => setDocuments(documents.filter((x) => x.chemin !== d.chemin))}>
                <IconX className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        {documents.length < MAX_DOCUMENTS && (
          <label className={`btn-secondary mt-2 inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 sm:w-fit ${!cible || depot ? "pointer-events-none opacity-60" : ""}`}>
            <IconCamera className="h-5 w-5" />
            {depot ? "Envoi de la photo…" : documents.length ? "Ajouter une photo" : "Prendre en photo l'avis"}
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="sr-only"
              disabled={!cible || depot}
              onChange={(e) => {
                void ajouterFichiers(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {lecture && <p role="status" className="mt-2 text-sm text-teal-ink">{lecture}</p>}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="label">Arrêt</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="radio" name="nature" checked={nature === "initial"} onChange={() => setNature("initial")} /> Arrêt initial
          </label>
          <label className={`flex min-h-[44px] items-center gap-2 ${prolongeablesCible.length === 0 ? "opacity-50" : ""}`}>
            <input type="radio" name="nature" disabled={prolongeablesCible.length === 0} checked={nature === "prolongation"} onChange={() => setNature("prolongation")} /> Prolongation
          </label>
        </div>
        {nature === "prolongation" && (
          <label className="block">
            <span className="label">Arrêt prolongé</span>
            <select className="input" value={prolongeId} onChange={(e) => setProlongeId(e.target.value)}>
              <option value="">Choisir l&apos;arrêt…</option>
              {prolongeablesCible.map((a) => (
                <option key={a.id} value={a.id}>
                  {libelleTypeArret(a.type)} du {dateCourte(a.du)} au {dateCourte(a.au)}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <label className="block">
        <span className="label">Type</span>
        <select className="input" value={prolonge ? prolonge.type : type} disabled={Boolean(prolonge)} onChange={(e) => setType(e.target.value as TypeDeclarable)}>
          {TYPES_DECLARABLES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        {prolonge && <span className="mt-1 block text-xs text-navy/60">Une prolongation garde le type de l&apos;arrêt initial.</span>}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Du</span>
          <input className="input" type="date" value={du} onChange={(e) => setDu(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Au (inclus)</span>
          <input className="input" type="date" value={au} min={du || undefined} onChange={(e) => setAu(e.target.value)} />
        </label>
      </div>

      <button type="button" className="btn-primary min-h-[48px] w-full sm:w-fit" disabled={busy || depot || !pret} onClick={envoyer}>
        {busy ? "Envoi…" : pourAutrui ? "Enregistrer l'arrêt" : "Envoyer mon arrêt"}
      </button>
      {!pourAutrui && (
        <p className="text-xs text-navy/60">
          À savoir : l&apos;avis d&apos;arrêt doit parvenir à l&apos;employeur dans les 48 heures. Les autres volets vont à votre caisse d&apos;assurance
          maladie (souvent transmis directement par le médecin).
        </p>
      )}
    </Card>
  );
}
