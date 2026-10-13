"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

const ACTIVITES = ["Messagerie / colis", "Lots complets / longue distance", "Régional / distribution", "Frigorifique", "Citerne / vrac", "Déménagement", "Autre"];

/** Formulaire « Demander une démo » (page /contact). */
export function DemoRequestForm({ plan, modules }: { plan: string | null; modules: string[] }) {
  const [etat, setEtat] = useState<"saisie" | "envoi" | "envoye">("saisie");
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || null;
    setEtat("envoi");
    setErreur(null);
    try {
      const res = await fetch("/api/public/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: v("full_name"),
          company: v("company"),
          email: v("email"),
          phone: v("phone"),
          vehicles: v("vehicles"),
          activity: v("activity"),
          message: v("message"),
          plan_interest: plan,
          modules_interest: modules,
          site_web: v("site_web"),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Envoi impossible.");
      setEtat("envoye");
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Envoi impossible.");
      setEtat("saisie");
    }
  }

  if (etat === "envoye") {
    return (
      <Card className="flex flex-col gap-2 border-teal/40 text-center">
        <p className="font-display text-xl font-bold">Merci, c’est noté !</p>
        <p className="text-sm text-navy/70">Nous vous rappelons sous 1 jour ouvré pour fixer une démonstration de 30 minutes, en visio ou dans vos locaux.</p>
      </Card>
    );
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={envoyer}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Nom et prénom *</span>
            <input name="full_name" className="input" required minLength={2} autoComplete="name" />
          </label>
          <label className="block">
            <span className="label">Entreprise *</span>
            <input name="company" className="input" required minLength={2} autoComplete="organization" />
          </label>
          <label className="block">
            <span className="label">E-mail professionnel *</span>
            <input name="email" type="email" className="input" required autoComplete="email" />
          </label>
          <label className="block">
            <span className="label">Téléphone</span>
            <input name="phone" type="tel" className="input" autoComplete="tel" />
          </label>
          <label className="block">
            <span className="label">Nombre de véhicules</span>
            <input name="vehicles" type="number" min={1} className="input" inputMode="numeric" />
          </label>
          <label className="block">
            <span className="label">Activité</span>
            <select name="activity" className="input" defaultValue="">
              <option value="">—</option>
              {ACTIVITES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label">Votre besoin</span>
          <textarea name="message" className="input min-h-28" placeholder="Carburant, planning, paie, tournées colis… ce que vous voulez simplifier en premier." />
        </label>
        {/* Champ piège : invisible pour un humain. */}
        <input name="site_web" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
        {(plan || modules.length > 0) && (
          <p className="text-xs text-navy/60">
            Sélection du simulateur jointe à la demande : {[plan && `plan ${plan}`, modules.length && `${modules.length} module(s)`].filter(Boolean).join(", ")}.
          </p>
        )}
        {erreur && (
          <p role="alert" className="text-sm text-orange-ink">
            {erreur}
          </p>
        )}
        <button type="submit" className="btn-primary w-full sm:w-fit" disabled={etat === "envoi"}>
          {etat === "envoi" ? "Envoi…" : "Demander une démo"}
        </button>
        <p className="text-xs text-navy/55">
          Vos coordonnées servent uniquement à vous recontacter au sujet de GODAC. Voir la politique de confidentialité.
        </p>
      </form>
    </Card>
  );
}
