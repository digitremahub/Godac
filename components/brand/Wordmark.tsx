/**
 * GODAC logo (brand board, oct. 2026): the road-and-drop « G » symbol
 * plus the GODAC wordmark with GO in teal and DAC in orange. Vector files in
 * public/brand/ — the wordmark exists in white (on navy) and ink (on
 * light) versions; without `inverted` it follows the light/dark theme
 * (see .brand-ink / .brand-white in app/globals.css).
 */
export function Wordmark({
  inverted = false,
  height = 28,
  symbol = true,
  className = "",
}: {
  inverted?: boolean;
  /** Height of the symbol in px; the wordmark is sized from it. */
  height?: number;
  symbol?: boolean;
  className?: string;
}) {
  const wordHeight = Math.round(height * 0.5);
  const wordWidth = Math.round(wordHeight * 5.13);
  return (
    <span translate="no" className={`inline-flex shrink-0 items-center ${className}`} style={{ gap: Math.round(height * 0.3) }}>
      {symbol && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/godac-symbol.svg" alt="" width={Math.round(height * 1.2)} height={height} />
      )}
      {inverted ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/godac-wordmark-white.svg" alt="GODAC" width={wordWidth} height={wordHeight} />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/godac-wordmark-ink.svg" alt="GODAC" width={wordWidth} height={wordHeight} className="brand-ink" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/godac-wordmark-white.svg" alt="" aria-hidden="true" width={wordWidth} height={wordHeight} className="brand-white" />
        </>
      )}
    </span>
  );
}
