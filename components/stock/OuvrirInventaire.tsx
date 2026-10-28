"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { appeler, Champ, Message } from "@/components/stock/commun";
import { arborescence, type EmplacementLu } from "@/lib/stock/emplacements";
import type { SiteLu } from "@/lib/stock/chargement-serveur";
import { nouvelleCle } from "@/lib/stock/mouvements";

/** Ouvre un comptage pour un dépôt entier ou une zone. La clé d'idempotence évite d'ouvrir deux fois le même inventaire sur un double appui. */
export function OuvrirInventaire({ sites, emplacements }: { sites: SiteLu[]; emplacements: EmplacementLu[] }) {
  const router = useRouter();
  const actifs = sites.filter((s) => s.actif);
  const [site, setSite] = useState(actifs[0]?.id ?? "");
  const [zone, setZone] = useState("");
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const cle = useRef(nouvelleCle("inv"));
  const zones = arborescence(site, emplacements).map((a) => a.zone);

  async function ouvrir(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const r = await appeler<{ inventaire_id: string | null }>("/api/stock/inventaires", { corps: { cle: cle.current, site_id: site, zone_id: zone || null, note: note.trim() || null } });
    setEnCours(false);
    if (!r.ok) {
      setErreur(r.erreur);
      return;
    }
    cle.current = nouvelleCle("inv");
    if (r.data.inventaire_id) router.push(`/exploitation/stock/inventaire?inventaire=${r.data.inventaire_id}`);
    else router.refresh();
  }

  if (actifs.length === 0) return <Message message="Créez d'abord un dépôt dans les paramètres du stock." />;
  return (
    <form onSubmit={ouvrir} className="card flex flex-col gap-4 !p-4 sm:!p-5">
      <h2 className="text-lg font-bold">Nouvel inventaire</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Dépôt">
          {(id) => (
            <select id={id} className="input" value={site} onChange={(e) => { setSite(e.target.value); setZone(""); }}>
              {actifs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
          )}
        </Champ>
        <Champ libelle="Zone à compter" aide="Une zone à la fois est plus rapide et plus fiable que tout le dépôt.">
          {(id, aide) => (
            <select id={id} aria-describedby={aide} className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">Tout le dépôt</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.libelle ? `${z.code} (${z.libelle})` : z.code}
                </option>
              ))}
            </select>
          )}
        </Champ>
      </div>
      <Champ libelle="Note (facultatif)">{(id) => <input id={id} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. inventaire de fin de mois" />}</Champ>
      <Message message={erreur} erreur />
      <div>
        <button type="submit" className="btn-primary min-h-11 w-full sm:w-auto" disabled={enCours || !site}>
          {enCours ? "Ouverture…" : "Ouvrir l'inventaire"}
        </button>
      </div>
    </form>
  );
}
