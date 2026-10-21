// Mon compte → Affichage. Stored per device (localStorage) and applied
// as attributes on <html> — app/globals.css reads data-theme and
// data-text-size. The inline script below runs before first paint so a
// dark-mode user never sees a white flash.

export type ThemePreference = "system" | "light" | "dark" | "orange" | "orange-dark";
export type TextSizePreference = "md" | "lg" | "xl";

export const THEME_KEY = "godac-theme";
export const TEXT_SIZE_KEY = "godac-text-size";

/** Thèmes posés explicitement en data-theme (« system » n'en pose aucun). */
export const EXPLICIT_THEMES = ["light", "dark", "orange", "orange-dark"] as const;

/** Lit une valeur stockée : tout ce qui n'est pas un thème connu → « system ». */
export function parseThemePreference(value: string | null): ThemePreference {
  return (EXPLICIT_THEMES as readonly string[]).includes(value ?? "") ? (value as ThemePreference) : "system";
}

export function applyDisplayPreferences(theme: ThemePreference, textSize: TextSizePreference) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  if (textSize === "md") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", textSize);
}

export const DISPLAY_PREFERENCES_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var s=localStorage.getItem("${TEXT_SIZE_KEY}");var r=document.documentElement;if(${JSON.stringify(EXPLICIT_THEMES)}.indexOf(t)>=0)r.setAttribute("data-theme",t);if(s==="lg"||s==="xl")r.setAttribute("data-text-size",s);}catch(e){}})();`;
