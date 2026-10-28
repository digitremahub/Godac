"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EtiquetteApercu } from "@/components/stock/EtiquetteApercu";
import { appeler, Champ, Message } from "@/components/stock/commun";
import { AVERTISSEMENT_DONNEES_SANTE, MENTION_SUIVI_LOGISTIQUE } from "@/lib/stock/attributs";
import { etiquetteVierge } from "@/lib/stock/etiquettes";
import { arborescence, LIBELLES_TYPE_ZONE, TYPES_ZONE, type EmplacementLu, type TypeZone } from "@/lib/stock/emplacements";
import type { ArticleLu, SiteLu } from "@/lib/stock/chargement-serveur";
import { DEFINITION_FORMATS, FORMATS_ETIQUETTE, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";
import { prefixeValide } from "@/lib/stock/codes";
import {
  CHAMPS_ETIQUETTE,
  CHAMPS_OUI_NON,
  CHAMPS_STOCK,
  DEFINITION_PROFILS,
  LIBELLES_CHAMP,
  LIBELLES_CHAMP_ETIQUETTE,
  LIBELLES_UNITES_ARTICLE,
  PROFILS,
  UNITES_ARTICLE,
  differencesProfil,
  profilsArticles,
  resoudreProfil,
  type ChampEtiquette,
  type ChampStock,
  type CleProfil,
  type ModeChamp,
  type Profil,
  type ProfilsConfig,
} from "@/lib/stock/profils";
import { formaterQuantite } from "@/lib/stock/soldes";
import { confirmer } from "@/lib/ui/confirmation";

interface Props {
  profils: CleProfil[];
  config: ProfilsConfig;
  sites: SiteLu[];
  emplacements: EmplacementLu[];
  articles: ArticleLu[];
  services: { id: string; name: string }[];
  prefixe: string | null;
  prefixeParDefaut: string;
  formatEtiquette: CleFormatEtiquette | null;
  codesInstalles: boolean;
  codesGeneres: boolean;
  entreprise: string;
  annee: number;
}

/**
 * Paramètres du stock (exploitation et direction) : profils d'activité adaptables, codes et étiquettes,
 * dépôts, zones et emplacements, articles et seuils. Désactiver ne supprime rien : l'historique et les
 * quantités restent consultables.
 */
export function ParametresStock({ profils, config, sites, emplacements, articles, services, prefixe, prefixeParDefaut, formatEtiquette, codesInstalles, codesGeneres, entreprise, annee }: Props) {
  const router = useRouter();
  const [, demarrer] = useTransition();
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [actifs, setActifs] = useState<CleProfil[]>(profils);

  async function agir(url: string, methode: "POST" | "PATCH" | "PUT", corps: unknown, succes: string): Promise<boolean> {
    const r = await appeler(url, { method: methode, corps });
    if (!r.ok) {
      setMessage({ texte: r.erreur, erreur: true });
      return false;
    }
    setMessage({ texte: succes, erreur: false });
    demarrer(() => router.refresh());
    return true;
  }

  const bascule = (p: CleProfil) => setActifs((a) => (a.includes(p) ? a.filter((x) => x !== p) : PROFILS.filter((x) => x === p || a.includes(x))));

  return (
    <div className="flex flex-col gap-6">
      <Message message={message?.texte ?? null} erreur={message?.erreur} />
      <p className="rounded-xl bg-navy/[0.04] px-3.5 py-2.5 text-sm text-navy/80" role="note">
        {MENTION_SUIVI_LOGISTIQUE}
      </p>

      <section aria-labelledby="p-profils" className="card flex flex-col gap-4 !p-4 sm:!p-5">
        <div>
          <h2 id="p-profils" className="text-lg font-bold">
            Profils d&apos;activité
          </h2>
          <p className="mt-1 text-sm text-navy/65">
            Activez ce que vous suivez : plusieurs profils peuvent être actifs ensemble. Chaque profil apporte des réglages sensés que vous pouvez ajuster sans code (vocabulaire, champs obligatoires, alertes, étiquette). Désactiver un profil ne supprime rien : il n&apos;accepte simplement plus de nouveaux mouvements.
          </p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Profils actifs</legend>
          {PROFILS.map((p) => {
            const nouveau = !["messagerie", "palettes", "vrac"].includes(p);
            return (
              <label key={p} className="flex cursor-pointer items-start gap-3 rounded-xl border border-navy/[0.1] p-3.5 has-[:checked]:border-teal-ink has-[:checked]:bg-teal/[0.06]">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-teal-ink" checked={actifs.includes(p)} onChange={() => bascule(p)} disabled={nouveau && !codesInstalles} />
                <span>
                  <span className="block font-semibold">{DEFINITION_PROFILS[p].libelle}</span>
                  <span className="block text-sm text-navy/65">{DEFINITION_PROFILS[p].description}</span>
                  {nouveau && !codesInstalles && <span className="block text-xs text-orange-ink">Disponible après la mise à jour de la base.</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div>
          <button type="button" className="btn-primary min-h-11" onClick={() => void agir("/api/stock/parametres", "PUT", { profils: actifs }, "Profils enregistrés.")}>
            Enregistrer les profils
          </button>
        </div>
      </section>

      {codesInstalles &&
        profils.map((p) => (
          <EditeurProfil key={p} cle={p} profil={resoudreProfil(p, config)} agir={agir} />
        ))}

      {codesInstalles && <CodesEtiquettes prefixe={prefixe} prefixeParDefaut={prefixeParDefaut} formatEtiquette={formatEtiquette} codesGeneres={codesGeneres} entreprise={entreprise} annee={annee} agir={agir} profils={profils} config={config} />}

      <Depots sites={sites} services={services} agir={agir} />
      {sites.length > 0 && <Emplacements sites={sites} emplacements={emplacements} agir={agir} />}
      <Articles articles={articles} actifs={profils} config={config} codesInstalles={codesInstalles} agir={agir} />
    </div>
  );
}

type Agir = (url: string, methode: "POST" | "PATCH" | "PUT", corps: unknown, succes: string) => Promise<boolean>;

const LIBELLES_MODE: Record<ModeChamp, string> = { masque: "Masqué", affiche: "Affiché", requis: "Obligatoire" };

/** Ajustement d'un profil actif : vocabulaire, champs affichés ou obligatoires, alertes, étiquette. Seules les différences avec le catalogue sont enregistrées. */
function EditeurProfil({ cle, profil, agir }: { cle: CleProfil; profil: Profil; agir: Agir }) {
  const [p, setP] = useState<Profil>(profil);
  const base = DEFINITION_PROFILS[cle];
  const personnalise = cle === "personnalise";
  const articles = p.suivi === "articles";
  const maj = (f: (x: Profil) => Profil) => setP((x) => f(x));
  const basculeChampEtiquette = (c: ChampEtiquette) =>
    maj((x) => ({ ...x, etiquette: { ...x.etiquette, champs: x.etiquette.champs.includes(c) ? x.etiquette.champs.filter((y) => y !== c) : CHAMPS_ETIQUETTE.filter((y) => y === c || x.etiquette.champs.includes(y)) } }));
  const diff = differencesProfil(cle, p);
  const modifie = Object.keys(diff).length > 0;
  return (
    <section aria-labelledby={`ep-${cle}`} className="card flex flex-col gap-4 !p-4 sm:!p-5">
      <div>
        <h2 id={`ep-${cle}`} className="text-lg font-bold">
          Ajuster le profil : {base.libelle}
        </h2>
        <p className="mt-1 text-sm text-navy/65">Valeurs du catalogue au départ. Vos ajustements s&apos;appliquent aux écrans d&apos;entrée, de recherche, d&apos;export, aux alertes et aux étiquettes.</p>
        {base.avertissement && <p className="mt-2 rounded-xl bg-navy/[0.04] px-3 py-2 text-xs text-navy/75">{base.avertissement}</p>}
      </div>

      {personnalise && (
        <label className="text-sm">
          <span className="label">Ce profil suit</span>
          <select className="input !w-auto" value={p.suivi} onChange={(e) => maj((x) => ({ ...x, suivi: e.target.value as Profil["suivi"] }))}>
            <option value="unites">Des unités individuelles (un code = une unité)</option>
            <option value="articles">Des articles en quantité (références, lots)</option>
          </select>
        </label>
      )}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="label">Vocabulaire</legend>
        <Champ libelle="Nom d'une unité (singulier)">{(id) => <input id={id} className="input" maxLength={30} value={p.vocabulaire.un} onChange={(e) => maj((x) => ({ ...x, vocabulaire: { ...x.vocabulaire, un: e.target.value } }))} placeholder="colis, palette, poche, échantillon, boîte, bac…" />}</Champ>
        <Champ libelle="Pluriel">{(id) => <input id={id} className="input" maxLength={30} value={p.vocabulaire.plusieurs} onChange={(e) => maj((x) => ({ ...x, vocabulaire: { ...x.vocabulaire, plusieurs: e.target.value } }))} />}</Champ>
      </fieldset>

      <fieldset>
        <legend className="label">Champs de l&apos;entrée</legend>
        <p className="mb-2 text-xs text-navy/65">Un champ « obligatoire » est exigé à chaque entrée, par l&apos;application et par la base. Fragile et urgent sont de simples cases.</p>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {CHAMPS_STOCK.filter((c) => !articles || c === "lot" || c === "dlc" || c === "temperature" || c === "nature" || c === "consigne").map((c: ChampStock) => (
            <label key={c} className="flex items-center justify-between gap-3 text-sm">
              <span>{LIBELLES_CHAMP[c]}</span>
              <select
                className="input !w-auto"
                value={p.champs[c]}
                aria-label={`${LIBELLES_CHAMP[c]} : affichage`}
                onChange={(e) => maj((x) => ({ ...x, champs: { ...x.champs, [c]: e.target.value as ModeChamp } }))}
              >
                {(CHAMPS_OUI_NON.includes(c) ? (["masque", "affiche"] as const) : (["masque", "affiche", "requis"] as const)).map((m) => (
                  <option key={m} value={m}>
                    {LIBELLES_MODE[m]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="label">Alertes</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={p.alertes.dlcJours !== null} onChange={(e) => maj((x) => ({ ...x, alertes: { ...x.alertes, dlcJours: e.target.checked ? (base.alertes.dlcJours ?? 30) : null } }))} />
            Alerte « DLC proche » à J-
          </label>
          <input
            className="input !w-24"
            type="number"
            min={1}
            max={365}
            aria-label="Nombre de jours avant la date limite"
            disabled={p.alertes.dlcJours === null}
            value={p.alertes.dlcJours ?? ""}
            onChange={(e) => maj((x) => ({ ...x, alertes: { ...x.alertes, dlcJours: Math.max(1, Math.min(365, Math.floor(Number(e.target.value)) || 1)) } }))}
          />
          <span className="pb-3 text-sm text-navy/65">jours</span>
        </div>
        {articles && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={p.alertes.seuilMini} onChange={(e) => maj((x) => ({ ...x, alertes: { ...x.alertes, seuilMini: e.target.checked } }))} />
            Seuil mini des articles
          </label>
        )}
        {!articles && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={p.alertes.nonRentre} onChange={(e) => maj((x) => ({ ...x, alertes: { ...x.alertes, nonRentre: e.target.checked } }))} />
            Unités chargées en tournée non rentrées
          </label>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={p.alertes.ecartInventaire} onChange={(e) => maj((x) => ({ ...x, alertes: { ...x.alertes, ecartInventaire: e.target.checked } }))} />
          Écart à la validation d&apos;un inventaire
        </label>
        {articles && (
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-ink" checked={p.fefo} onChange={(e) => maj((x) => ({ ...x, fefo: e.target.checked }))} />
            <span>
              Suggestion FEFO à la sortie
              <span className="block text-xs text-navy/65">Le lot dont la date limite est la plus proche est proposé en premier (aide : vous gardez le choix).</span>
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="label">Étiquette</legend>
        <p className="text-xs text-navy/65">Le QR code et le code-barres (Code 128) portent toujours le code seul : aucune donnée personnelle. Choisissez ce qui s&apos;imprime autour.</p>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {CHAMPS_ETIQUETTE.map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={p.etiquette.champs.includes(c)} onChange={() => basculeChampEtiquette(c)} />
              {LIBELLES_CHAMP_ETIQUETTE[c]}
            </label>
          ))}
        </div>
        <label className="text-sm">
          <span className="label">Format par défaut de ce profil</span>
          <select className="input !w-auto" value={p.etiquette.format} onChange={(e) => maj((x) => ({ ...x, etiquette: { ...x.etiquette, format: e.target.value as CleFormatEtiquette } }))}>
            {FORMATS_ETIQUETTE.map((f) => (
              <option key={f} value={f}>
                {DEFINITION_FORMATS[f].libelle}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <p className="text-xs text-navy/65">{AVERTISSEMENT_DONNEES_SANTE}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11" onClick={() => void agir("/api/stock/parametres", "PUT", { config: { [cle]: diff } }, `Profil « ${base.libelle} » enregistré.`)}>
          Enregistrer ce profil
        </button>
        <button type="button" className="btn-secondary min-h-11" disabled={!modifie} onClick={() => setP(base)}>
          Revenir aux valeurs du catalogue
        </button>
      </div>
    </section>
  );
}

/** Préfixe des codes internes (PREFIXE-AAAA-NNNNNN) et format d'étiquette par défaut de l'organisation. */
function CodesEtiquettes({
  prefixe,
  prefixeParDefaut,
  formatEtiquette,
  codesGeneres,
  entreprise,
  annee,
  agir,
  profils,
  config,
}: {
  prefixe: string | null;
  prefixeParDefaut: string;
  formatEtiquette: CleFormatEtiquette | null;
  codesGeneres: boolean;
  entreprise: string;
  annee: number;
  agir: Agir;
  profils: CleProfil[];
  config: ProfilsConfig;
}) {
  const [valeur, setValeur] = useState(prefixe ?? prefixeParDefaut);
  const [format, setFormat] = useState<CleFormatEtiquette>(formatEtiquette ?? "a4_3x7");
  const propre = valeur.trim().toUpperCase().replace(/[\s-]/g, "");
  const valide = prefixeValide(propre);
  const profilApercu = resoudreProfil(profils[0] ?? "personnalise", config);
  return (
    <section aria-labelledby="p-codes" className="card flex flex-col gap-4 !p-4 sm:!p-5">
      <div>
        <h2 id="p-codes" className="text-lg font-bold">
          Codes internes et étiquettes
        </h2>
        <p className="mt-1 text-sm text-navy/65">
          Une unité qui arrive avec un code (transporteur, client, SSCC, bordereau) GARDE ce code. Pour les autres, ou si vous le demandez, GODAC génère un code propre à votre entreprise au format <strong>PRÉFIXE-AAAA-NNNNNN</strong>.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ
          libelle="Préfixe des codes (2 à 6 lettres ou chiffres)"
          aide={
            prefixe
              ? codesGeneres
                ? "Des codes ont déjà été générés : changer le préfixe est possible, les anciens codes restent valides et continuent de se scanner."
                : "Modifiable tant qu'aucun code n'a été généré."
              : `Proposé d'après le nom de l'entreprise (${prefixeParDefaut}). Il sera enregistré à la première génération de code.`
          }
        >
          {(id, aide) => <input id={id} aria-describedby={aide} className="input uppercase" maxLength={6} value={valeur} onChange={(e) => setValeur(e.target.value)} autoCapitalize="characters" spellCheck={false} />}
        </Champ>
        <div>
          <span className="label">Exemple</span>
          <p className="rounded-xl bg-navy/[0.04] px-3.5 py-2.5 font-mono text-sm">{valide ? `${propre}-${annee}-000001` : "Préfixe invalide"}</p>
        </div>
      </div>
      <div>
        <button type="button" className="btn-primary min-h-11" disabled={!valide || propre === prefixe} onClick={() => void agir("/api/stock/parametres", "PUT", { prefixe_code: propre }, "Préfixe enregistré.")}>
          Enregistrer le préfixe
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Format d'étiquette de l'entreprise" aide={DEFINITION_FORMATS[format].aide}>
          {(id, aide) => (
            <select id={id} aria-describedby={aide} className="input" value={format} onChange={(e) => setFormat(e.target.value as CleFormatEtiquette)}>
              {FORMATS_ETIQUETTE.map((f) => (
                <option key={f} value={f}>
                  {DEFINITION_FORMATS[f].libelle}
                </option>
              ))}
            </select>
          )}
        </Champ>
        <EtiquetteApercu donnees={etiquetteVierge(`${valide ? propre : "TRA"}-${annee}-000001`, { entreprise, date: "JJ/MM/AAAA" }, profilApercu.etiquette.champs)} format={format} titre="Aperçu d'une étiquette numérotée" />
      </div>
      <div>
        <button type="button" className="btn-secondary min-h-11" disabled={format === formatEtiquette} onClick={() => void agir("/api/stock/parametres", "PUT", { format_etiquette: format }, "Format d'étiquette enregistré.")}>
          Enregistrer le format
        </button>
      </div>
    </section>
  );
}

function Depots({ sites, services, agir }: { sites: SiteLu[]; services: { id: string; name: string }[]; agir: Agir }) {
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [service, setService] = useState("");
  return (
    <section aria-labelledby="p-depots" className="card flex flex-col gap-4 !p-4 sm:!p-5">
      <div>
        <h2 id="p-depots" className="text-lg font-bold">
          Dépôts
        </h2>
        <p className="mt-1 text-sm text-navy/65">Un dépôt rattaché à un service n&apos;est visible que des managers de ce service (l&apos;exploitation et la direction voient tout).</p>
      </div>
      {sites.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sites.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy/[0.08] px-3.5 py-2.5 ${s.actif ? "" : "opacity-60"}`}>
              <span className="min-w-0 break-words">
                <span className="font-semibold">{s.nom}</span>
                <span className="block text-xs text-navy/65">
                  {[s.adresse, services.find((x) => x.id === s.service_id)?.name, s.actif ? null : "désactivé"].filter(Boolean).join(" · ") || "Sans service"}
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary !py-2 text-xs"
                onClick={async () => {
                  if (s.actif && !(await confirmer({ titre: `Désactiver le dépôt « ${s.nom} » ?`, message: "Il n'accepte plus de mouvements. Son historique et ses quantités restent consultables.", action: "Désactiver" }))) return;
                  await agir(`/api/stock/sites/${s.id}`, "PATCH", { actif: !s.actif }, s.actif ? "Dépôt désactivé." : "Dépôt réactivé.");
                }}
              >
                {s.actif ? "Désactiver" : "Réactiver"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await agir("/api/stock/sites", "POST", { nom, adresse: adresse || null, service_id: service || null }, "Dépôt créé.")) {
            setNom("");
            setAdresse("");
            setService("");
          }
        }}
      >
        <Champ libelle="Nom du dépôt">{(id) => <input id={id} className="input" required maxLength={80} value={nom} onChange={(e) => setNom(e.target.value)} />}</Champ>
        <Champ libelle="Adresse (facultatif)">{(id) => <input id={id} className="input" maxLength={200} value={adresse} onChange={(e) => setAdresse(e.target.value)} />}</Champ>
        <Champ libelle="Service (facultatif)">
          {(id) => (
            <select id={id} className="input" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Tous les services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Champ>
        <div className="sm:col-span-3">
          <button type="submit" className="btn-primary min-h-11">
            Ajouter le dépôt
          </button>
        </div>
      </form>
    </section>
  );
}

function Emplacements({ sites, emplacements, agir }: { sites: SiteLu[]; emplacements: EmplacementLu[]; agir: Agir }) {
  const [siteId, setSiteId] = useState(sites.find((s) => s.actif)?.id ?? sites[0]?.id ?? "");
  const [codeZone, setCodeZone] = useState("");
  const [typeZone, setTypeZone] = useState<TypeZone>("zone");
  const [zoneParent, setZoneParent] = useState("");
  const [codeEmp, setCodeEmp] = useState("");
  const arbre = arborescence(siteId, emplacements, true);
  const bascule = (e: EmplacementLu) => agir(`/api/stock/emplacements/${e.id}`, "PATCH", { actif: !e.actif }, e.actif ? "Désactivé." : "Réactivé.");
  return (
    <section aria-labelledby="p-emp" className="card flex flex-col gap-4 !p-4 sm:!p-5">
      <div>
        <h2 id="p-emp" className="text-lg font-bold">
          Zones et emplacements
        </h2>
        <p className="mt-1 text-sm text-navy/65">Un dépôt contient des zones (quai, zone, allée, rayonnage, retours), qui contiennent des emplacements. Exemple : quai 3 › Q3-01.</p>
      </div>
      {sites.length > 1 && (
        <Champ libelle="Dépôt">
          {(id) => (
            <select id={id} className="input sm:!w-72" value={siteId} onChange={(e) => { setSiteId(e.target.value); setZoneParent(""); }}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
          )}
        </Champ>
      )}
      {arbre.length === 0 ? (
        <p className="text-sm text-navy/65">Aucune zone dans ce dépôt.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {arbre.map(({ zone, emplacements: liste }) => (
            <li key={zone.id} className={`rounded-xl border border-navy/[0.08] p-3.5 ${zone.actif ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {zone.code} <span className="font-normal text-navy/65">· {LIBELLES_TYPE_ZONE[(zone.type_zone ?? "zone") as TypeZone]}{zone.actif ? "" : " · désactivée"}</span>
                </span>
                <button type="button" className="btn-secondary !py-2 text-xs" onClick={() => void bascule(zone)}>
                  {zone.actif ? "Désactiver" : "Réactiver"}
                </button>
              </div>
              {liste.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {liste.map((e) => (
                    <li key={e.id} className={`flex items-center gap-1.5 rounded-lg bg-navy/[0.05] py-1 pl-2.5 pr-1 text-sm ${e.actif ? "" : "opacity-60"}`}>
                      <span>{e.code}</span>
                      <button type="button" className="rounded-md px-2 py-1 text-xs font-semibold text-teal-ink hover:bg-navy/[0.06]" aria-label={`${e.actif ? "Désactiver" : "Réactiver"} l'emplacement ${e.code}`} onClick={() => void bascule(e)}>
                        {e.actif ? "Retirer" : "Rétablir"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await agir("/api/stock/emplacements", "POST", { site_id: siteId, genre: "zone", code: codeZone, type_zone: typeZone }, "Zone créée.")) setCodeZone("");
          }}
        >
          <h3 className="font-semibold">Ajouter une zone</h3>
          <Champ libelle="Code de la zone">{(id) => <input id={id} className="input" required maxLength={40} value={codeZone} onChange={(e) => setCodeZone(e.target.value)} placeholder="Ex. Quai 3, Allée B" />}</Champ>
          <Champ libelle="Type">
            {(id) => (
              <select id={id} className="input" value={typeZone} onChange={(e) => setTypeZone(e.target.value as TypeZone)}>
                {TYPES_ZONE.map((t) => (
                  <option key={t} value={t}>
                    {LIBELLES_TYPE_ZONE[t]}
                  </option>
                ))}
              </select>
            )}
          </Champ>
          <div>
            <button type="submit" className="btn-primary min-h-11" disabled={!siteId}>
              Ajouter la zone
            </button>
          </div>
        </form>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await agir("/api/stock/emplacements", "POST", { site_id: siteId, genre: "emplacement", parent_id: zoneParent, code: codeEmp }, "Emplacement créé.")) setCodeEmp("");
          }}
        >
          <h3 className="font-semibold">Ajouter un emplacement</h3>
          <Champ libelle="Zone">
            {(id) => (
              <select id={id} className="input" required value={zoneParent} onChange={(e) => setZoneParent(e.target.value)}>
                <option value="">Choisir une zone</option>
                {arbre.filter((a) => a.zone.actif).map((a) => (
                  <option key={a.zone.id} value={a.zone.id}>
                    {a.zone.code}
                  </option>
                ))}
              </select>
            )}
          </Champ>
          <Champ libelle="Code de l'emplacement">{(id) => <input id={id} className="input" required maxLength={40} value={codeEmp} onChange={(e) => setCodeEmp(e.target.value)} placeholder="Ex. Q3-01" />}</Champ>
          <div>
            <button type="submit" className="btn-primary min-h-11" disabled={!zoneParent}>
              Ajouter l&apos;emplacement
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function Articles({ articles, actifs, config, codesInstalles, agir }: { articles: ArticleLu[]; actifs: CleProfil[]; config: ProfilsConfig; codesInstalles: boolean; agir: Agir }) {
  const [code, setCode] = useState("");
  const [nom, setNom] = useState("");
  const [unite, setUnite] = useState<(typeof UNITES_ARTICLE)[number]>("piece");
  const [seuil, setSeuil] = useState("");
  const [lots, setLots] = useState(false);
  const [dlc, setDlc] = useState(false);
  const profilsRef = profilsArticles(actifs, config);
  const vrac = profilsRef.length > 0;
  const [profil, setProfil] = useState<CleProfil | "">(profilsRef.length === 1 ? profilsRef[0]! : "");
  return (
    <section aria-labelledby="p-articles" className="card flex flex-col gap-4 !p-4 sm:!p-5">
      <div>
        <h2 id="p-articles" className="text-lg font-bold">
          Articles et seuils
        </h2>
        <p className="mt-1 text-sm text-navy/65">Pour les profils de références (vrac, alimentaire, médicaments et pharmacie…). Sous le seuil mini, une alerte est adressée à la direction et à l&apos;exploitation. Un seuil à 0 désactive l&apos;alerte.</p>
      </div>
      {articles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {articles.map((a) => (
            <LigneArticle key={a.id} a={a} agir={agir} />
          ))}
        </ul>
      )}
      {!vrac ? (
        <p className="text-sm text-navy/65">Cochez et enregistrez un profil de références (références en vrac, alimentaire, médicaments et pharmacie ou personnalisé) pour créer des articles.</p>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const s = Number(seuil.replace(",", ".") || "0");
            if (await agir("/api/stock/articles", "POST", { code, nom, unite, seuil_mini: Number.isFinite(s) ? s : 0, suivi_lots: lots, suivi_dlc: dlc, ...(profil && codesInstalles ? { profil } : {}) }, "Article créé.")) {
              setCode("");
              setNom("");
              setSeuil("");
              setLots(false);
              setDlc(false);
            }
          }}
        >
          {profilsRef.length > 1 && codesInstalles && (
            <Champ libelle="Profil de l'article">
              {(id) => (
                <select id={id} className="input" value={profil} required onChange={(e) => setProfil(e.target.value as CleProfil)}>
                  <option value="">Choisir</option>
                  {profilsRef.map((p) => (
                    <option key={p} value={p}>
                      {DEFINITION_PROFILS[p].libelle}
                    </option>
                  ))}
                </select>
              )}
            </Champ>
          )}
          <Champ libelle="Référence">{(id) => <input id={id} className="input" required maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />}</Champ>
          <Champ libelle="Nom">{(id) => <input id={id} className="input" required maxLength={120} value={nom} onChange={(e) => setNom(e.target.value)} />}</Champ>
          <Champ libelle="Unité">
            {(id) => (
              <select id={id} className="input" value={unite} onChange={(e) => setUnite(e.target.value as typeof unite)}>
                {UNITES_ARTICLE.map((u) => (
                  <option key={u} value={u}>
                    {LIBELLES_UNITES_ARTICLE[u]}
                  </option>
                ))}
              </select>
            )}
          </Champ>
          <Champ libelle="Seuil mini">{(id) => <input id={id} className="input" inputMode="decimal" value={seuil} onChange={(e) => setSeuil(e.target.value)} placeholder="0" />}</Champ>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={lots} onChange={(e) => setLots(e.target.checked)} />
            Suivi par lot
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-teal-ink" checked={dlc} onChange={(e) => setDlc(e.target.checked)} />
            Date limite (DLC)
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="btn-primary min-h-11">
              Ajouter l&apos;article
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function LigneArticle({ a, agir }: { a: ArticleLu; agir: Agir }) {
  const [seuil, setSeuil] = useState(String(a.seuil_mini));
  const modifie = Number(seuil.replace(",", ".")) !== a.seuil_mini;
  return (
    <li className={`flex flex-wrap items-end justify-between gap-3 rounded-xl border border-navy/[0.08] px-3.5 py-2.5 ${a.actif ? "" : "opacity-60"}`}>
      <span className="min-w-0 break-words">
        <span className="font-semibold">{a.nom}</span> <span className="text-navy/65">({a.code})</span>
        <span className="block text-xs text-navy/65">
          {LIBELLES_UNITES_ARTICLE[a.unite as keyof typeof LIBELLES_UNITES_ARTICLE] ?? a.unite}
          {a.suivi_lots ? " · lots" : ""}
          {a.suivi_dlc ? " · DLC" : ""}
          {a.profil && a.profil in DEFINITION_PROFILS ? ` · ${DEFINITION_PROFILS[a.profil as CleProfil].libelle}` : ""}
          {a.actif ? "" : " · désactivé"}
        </span>
      </span>
      <span className="flex flex-wrap items-end gap-2">
        <span>
          <label htmlFor={`seuil-${a.id}`} className="label !mb-1">
            Seuil mini
          </label>
          <input id={`seuil-${a.id}`} className="input !w-28" inputMode="decimal" value={seuil} onChange={(e) => setSeuil(e.target.value)} />
        </span>
        <button
          type="button"
          className="btn-secondary min-h-11"
          disabled={!modifie || !Number.isFinite(Number(seuil.replace(",", ".")))}
          onClick={() => void agir(`/api/stock/articles/${a.id}`, "PATCH", { seuil_mini: Number(seuil.replace(",", ".")) }, `Seuil de ${a.nom} : ${formaterQuantite(Number(seuil.replace(",", ".")))}.`)}
        >
          Enregistrer
        </button>
        <button
          type="button"
          className="btn-secondary min-h-11"
          onClick={async () => {
            if (a.actif && !(await confirmer({ titre: `Désactiver l'article « ${a.nom} » ?`, message: "Il n'accepte plus de mouvements. Son historique et ses quantités restent consultables.", action: "Désactiver" }))) return;
            await agir(`/api/stock/articles/${a.id}`, "PATCH", { actif: !a.actif }, a.actif ? "Article désactivé." : "Article réactivé.");
          }}
        >
          {a.actif ? "Désactiver" : "Réactiver"}
        </button>
      </span>
    </li>
  );
}
