// Mon compte → Affichage. Stored per device (localStorage) and applied
// as attributes on <html> — app/globals.css reads data-theme and
// data-text-size. The inline script below runs before first paint so a
// dark-mode user never sees a white flash.

export type ThemePreference = "system" | "light" | "dark";
export type TextSizePreference = "md" | "lg" | "xl";

export const THEME_KEY = "godac-theme";
export const TEXT_SIZE_KEY = "godac-text-size";

export function applyDisplayPreferences(theme: ThemePreference, textSize: TextSizePreference) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  if (textSize === "md") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", textSize);
}

export const DISPLAY_PREFERENCES_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var s=localStorage.getItem("${TEXT_SIZE_KEY}");var r=document.documentElement;if(t==="light"||t==="dark")r.setAttribute("data-theme",t);if(s==="lg"||s==="xl")r.setAttribute("data-text-size",s);}catch(e){}})();`;
