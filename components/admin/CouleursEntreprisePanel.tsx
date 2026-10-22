"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { BLANC, COULEURS_GODAC, FONDS, PALETTES, calculerTheme, estHex, memesCouleurs, type CouleursEntreprise } from "@/lib/theme/couleurs-entreprise";

const CHAMPS: { cle: keyof CouleursEntreprise; titre: string; aide: string }[] = [
  { cle: "principale", titre: "Couleur principale", aide: "Boutons d'action, liens, éléments actifs." },
  { cle: "secondaire", titre: "Couleur secondaire / d'alerte", aide: "Alertes, badges à traiter, boutons de suppression." },
  { cle: "menu", titre: "Couleur du menu", aide: "Barre latérale et en-têtes sombres." },
];

/**
 * Administration › Organisation (direction) : couleurs de l'interface
 * pour tous les membres. La lisibilité est calculée par
 * lib/theme/couleurs-entreprise.ts ; un ajustement est annoncé ici.
 */
export function CouleursEntreprisePanel({ actuelles }: { actuelles: CouleursEntreprise | null }) {
  const router = useRouter();
  const [couleurs, setCouleurs] = useState<CouleursEntreprise>(actuelles ?? COULEURS_GODAC);
  const [saisies, setSaisies] = useState<CouleursEntreprise>(actuelles ?? COULEURS_GODAC);
  const [sombre, setSombre] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const theme = useMemo(() => calculerTheme(couleurs), [couleurs]);

  function choisir(c: CouleursEntreprise) {
    setCouleurs(c);
    setSaisies(c);
    setMessage(null);
  }

  function changer(cle: keyof CouleursEntreprise, valeur: string) {
    setSaisies((s) => ({ ...s, [cle]: valeur }));
    const v = valeur.startsWith("#") ? valeur : `#${valeur}`;
    if (estHex(v)) setCouleurs((c) => ({ ...c, [cle]: v.toUpperCase() }));
    setMessage(null);
  }

  async function enregistrer(valeur: CouleursEntreprise | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Les couleurs GODAC d'origine = pas de couleurs propres.
        body: JSON.stringify({ brand_colors: valeur && !memesCouleurs(valeur, COULEURS_GODAC) ? valeur : null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible.");
      if (!valeur) choisir(COULEURS_GODAC);
      setMessage({ ok: true, texte: valeur ? "Couleurs enregistrées pour toute l'équipe." : "Couleurs GODAC rétablies." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : "Erreur inattendue" });
    } finally {
      setBusy(false);
    }
  }

  const p = theme.principale;
  const s = theme.secondaire;
  const fond = sombre ? FONDS.papierSombre : FONDS.papierClair;
  const surface = sombre ? FONDS.surfaceSombre : FONDS.surfaceClaire;
  const encre = sombre ? "#E6EBF5" : "#0A0F1E";
  const inkP = sombre ? p.inkSombre : p.inkClair;
  const inkS = sombre ? s.inkSombre : s.inkClair;

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-bold">Couleurs de l&apos;entreprise</h2>
        <p className="text-sm text-navy/65">
          Personnalisez l&apos;interface à vos couleurs, pour toute l&apos;équipe. Chacun garde son affichage clair ou sombre ; les thèmes Orange GODAC restent un choix
          personnel. Les PDF (bulletins, exports) ne changent pas.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PALETTES.map((pal) => (
          <button
            key={pal.nom}
            type="button"
            onClick={() => choisir(pal.couleurs)}
            aria-pressed={memesCouleurs(pal.couleurs, couleurs)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${memesCouleurs(pal.couleurs, couleurs) ? "border-teal-ink bg-teal/10" : "border-navy/15 hover:bg-navy/[0.04]"}`}
          >
            <span aria-hidden="true" className="flex">
              {[pal.couleurs.menu, pal.couleurs.principale, pal.couleurs.secondaire].map((c) => (
                <span key={c} className="-ml-1 h-4 w-4 rounded-full border border-white first:ml-0" style={{ backgroundColor: c }} />
              ))}
            </span>
            {pal.nom}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {CHAMPS.map((ch) => (
            <div key={ch.cle}>
              <label className="label" htmlFor={`couleur-${ch.cle}`}>
                {ch.titre}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label={`${ch.titre} (sélecteur)`}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-navy/15 bg-transparent"
                  value={couleurs[ch.cle].toLowerCase()}
                  onChange={(e) => changer(ch.cle, e.target.value)}
                />
                <input
                  id={`couleur-${ch.cle}`}
                  className="input w-32 font-mono uppercase"
                  value={saisies[ch.cle]}
                  maxLength={7}
                  spellCheck={false}
                  onChange={(e) => changer(ch.cle, e.target.value.trim())}
                  aria-invalid={!estHex(saisies[ch.cle].startsWith("#") ? saisies[ch.cle] : `#${saisies[ch.cle]}`)}
                />
              </div>
              <p className="mt-1 text-xs text-navy/60">{ch.aide}</p>
            </div>
          ))}
          {theme.ajustements.length > 0 && (
            <div role="status" className="rounded-xl bg-gold/15 p-3 text-sm">
              <p className="font-semibold">Ajusté pour rester lisible</p>
              <ul className="mt-1 list-disc pl-5 text-navy/75">
                {theme.ajustements.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-navy/60">
            Lisibilité garantie : le texte des boutons passe en blanc ou en foncé selon votre couleur, et les textes colorés sont assombris (fond clair) ou éclaircis
            (fond sombre) pour respecter le contraste WCAG AA (4,5:1).
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Aperçu</p>
            <div className="flex gap-1 text-xs" role="group" aria-label="Fond de l'aperçu">
              {[false, true].map((v) => (
                <button key={String(v)} type="button" onClick={() => setSombre(v)} aria-pressed={sombre === v} className={`rounded-lg px-2 py-1 ${sombre === v ? "bg-navy/10 font-semibold" : "text-navy/65"}`}>
                  {v ? "Sombre" : "Clair"}
                </button>
              ))}
            </div>
          </div>
          <div aria-hidden="true" className="flex overflow-hidden rounded-2xl border border-navy/10 text-[13px]" style={{ backgroundColor: fond, color: encre }}>
            <div className="flex w-32 shrink-0 flex-col gap-1 p-3" style={{ backgroundColor: theme.menu.fond, color: BLANC }}>
              <span className="mb-2 font-display font-bold">Mon entreprise</span>
              <span className="relative font-semibold" style={{ color: theme.menu.accent }}>
                <span className="absolute -left-3 top-0.5 h-4 w-1 rounded-r-full" style={{ backgroundColor: theme.menu.accent }} />
                Tableau de bord
              </span>
              <span style={{ opacity: 0.6 }}>Planning</span>
              <span style={{ opacity: 0.6 }}>Flotte</span>
            </div>
            <div className="flex flex-1 flex-col gap-3 p-3">
              <div className="rounded-xl p-3 shadow-card" style={{ backgroundColor: surface }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Tournée du jour</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: s.fond, color: s.texte }}>
                    2 alertes
                  </span>
                </div>
                <p className="mt-1" style={{ opacity: 0.7 }}>
                  12 arrêts ·{" "}
                  <span className="font-semibold underline" style={{ color: inkP }}>
                    voir le détail
                  </span>
                </p>
                <p className="mt-1 font-semibold" style={{ color: inkS }}>
                  Contrôle technique à prévoir
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-xl px-3 py-1.5 font-semibold" style={{ backgroundColor: p.fond, color: p.texte }}>
                  Démarrer
                </span>
                <span className="rounded-xl px-3 py-1.5 font-semibold" style={{ backgroundColor: theme.menu.fond, color: BLANC }}>
                  En-tête
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => enregistrer(couleurs)}>
          {busy ? "Enregistrement…" : "Enregistrer les couleurs"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => enregistrer(null)}>
          Revenir aux couleurs GODAC
        </button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
            {message.texte}
          </p>
        )}
      </div>
    </Card>
  );
}
