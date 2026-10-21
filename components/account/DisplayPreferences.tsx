"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import {
  applyDisplayPreferences,
  parseThemePreference,
  TEXT_SIZE_KEY,
  THEME_KEY,
  type TextSizePreference,
  type ThemePreference,
} from "@/lib/display/preferences";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "orange", label: "Orange GODAC" },
  { value: "orange-dark", label: "Orange sombre" },
  { value: "system", label: "Système" },
];
const SIZES: { value: TextSizePreference; label: string; sample: string }[] = [
  { value: "md", label: "Normale", sample: "text-sm" },
  { value: "lg", label: "Grande", sample: "text-base" },
  { value: "xl", label: "Très grande", sample: "text-lg" },
];

function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = "grid-cols-3",
  itemClassName = "",
}: {
  legend: string;
  /** Classes de grille : 3 colonnes par défaut, plus pour le thème. */
  columns?: string;
  itemClassName?: string;
  options: { value: T; label: string; sample?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className={`grid ${columns} gap-1 rounded-xl bg-navy/[0.05] p-1`}>
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg px-2 text-center font-semibold transition-colors ${itemClassName} ${
              o.sample ?? "text-sm"
            } ${value === o.value ? "bg-surface text-navy shadow-card" : "text-navy/65 hover:text-navy"}`}
          >
            <input
              type="radio"
              name={legend}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Mon compte → Affichage: theme + text size, saved on this device and applied instantly. */
export function DisplayPreferences() {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [size, setSize] = useState<TextSizePreference>("md");

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      const s = localStorage.getItem(TEXT_SIZE_KEY);
      setTheme(parseThemePreference(t));
      if (s === "lg" || s === "xl") setSize(s);
    } catch {
      // storage blocked — defaults stay
    }
  }, []);

  function update(nextTheme: ThemePreference, nextSize: TextSizePreference) {
    setTheme(nextTheme);
    setSize(nextSize);
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
      localStorage.setItem(TEXT_SIZE_KEY, nextSize);
    } catch {
      // still applied for this visit
    }
    applyDisplayPreferences(nextTheme, nextSize);
  }

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2>Affichage</h2>
        <p className="mt-1 text-sm text-navy/65">Réglé pour cet appareil. « Orange GODAC » met l’orange de la marque en couleur principale. « Système » suit le mode clair ou sombre de votre téléphone.</p>
      </div>
      {/* 5 choix : sur mobile, « Système » prend toute la dernière ligne. */}
      <Segmented
        legend="Thème"
        options={THEMES}
        columns="grid-cols-2 sm:grid-cols-5"
        itemClassName="last:col-span-2 sm:last:col-span-1"
        value={theme}
        onChange={(t) => update(t, size)}
      />
      <Segmented legend="Taille du texte" options={SIZES} value={size} onChange={(s) => update(theme, s)} />
    </Card>
  );
}
