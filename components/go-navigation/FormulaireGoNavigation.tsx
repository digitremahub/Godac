"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { DUREE_ESSAI_JOURS } from "@/lib/go-navigation/offre";

/**
 * Formulaire de la page /go-navigation/[jeton] : prénom, nom, e-mail, mot
 * de passe, CGU. Le compte est créé et connecté côté serveur, puis la
 * personne arrive sur Tournée colis (accueil GO Navigation).
 */
export function FormulaireGoNavigation({ jeton }: { jeton: string }) {
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [cgu, setCgu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErreur(null);
    const r = await fetchGodac<{ redirection: string }>("/api/public/go-navigation/inscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jeton, prenom, nom, email, motDePasse, cgu }),
    });
    if (!r.ok) {
      setErreur(r.refus.message);
      setBusy(false);
      return;
    }
    window.location.href = r.data.redirection;
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <h1 className="text-xl">Essayer GO Navigation</h1>
        <p className="mt-1 text-sm text-navy/65">
          La navigation chauffeur avec votre tournée colis intégrée. Essai gratuit de {DUREE_ESSAI_JOURS} jours, sans carte bancaire.
        </p>
      </div>
      <form onSubmit={envoyer} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Prénom</span>
            <input className="input" autoComplete="given-name" required maxLength={80} value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Nom</span>
            <input className="input" autoComplete="family-name" required maxLength={80} value={nom} onChange={(e) => setNom(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="label">E-mail</span>
          <input className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Mot de passe</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <span className="mt-1 block text-xs text-navy/55">10 caractères minimum.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={cgu} onChange={(e) => setCgu(e.target.checked)} required />
          <span>
            J&apos;accepte les{" "}
            <Link href="/cgu" target="_blank" className="font-semibold text-teal-ink hover:underline">
              conditions générales d&apos;utilisation
            </Link>{" "}
            et la{" "}
            <Link href="/confidentialite" target="_blank" className="font-semibold text-teal-ink hover:underline">
              politique de confidentialité
            </Link>
            .
          </span>
        </label>
        {erreur && (
          <p role="alert" className="text-sm text-red-700">
            {erreur}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={busy || !prenom || !nom || !email || motDePasse.length < 10 || !cgu}>
          {busy ? "Création du compte…" : "Créer mon compte et commencer"}
        </button>
      </form>
    </Card>
  );
}
