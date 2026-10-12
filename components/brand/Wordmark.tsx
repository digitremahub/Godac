/**
 * GODAC wordmark per the brand guide (Notion — Naming & Identité de
 * Marque V2): Syne ExtraBold, final dot in electric teal. Navy on light
 * surfaces, white on navy.
 */
export function Wordmark({ inverted = false, className = "" }: { inverted?: boolean; className?: string }) {
  return (
    <span
      translate="no"
      className={`font-display font-extrabold leading-none tracking-tight ${inverted ? "text-white" : "text-navy"} ${className}`}
    >
      GODAC<span className="text-teal">.</span>
    </span>
  );
}
