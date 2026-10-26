// Petites icônes de l'éditeur de villages (traits 24x24, couleur du texte).
type P = { className?: string };
const Svg = ({ className = "h-5 w-5", children }: { className?: string; children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>{children}</svg>
);
export const IconHaut = (p: P) => <Svg {...p}><path d="m6 15 6-6 6 6" /></Svg>;
export const IconBas = (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconPlusieurs = (p: P) => (
  <Svg {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Svg>
);
export function IconPoignee({ className = "h-5 w-3" }: P) {
  return (
    <svg viewBox="0 0 12 20" aria-hidden="true" className={`${className} fill-current`}>
      <circle cx="3" cy="4" r="1.6" /><circle cx="9" cy="4" r="1.6" /><circle cx="3" cy="10" r="1.6" /><circle cx="9" cy="10" r="1.6" /><circle cx="3" cy="16" r="1.6" /><circle cx="9" cy="16" r="1.6" />
    </svg>
  );
}
