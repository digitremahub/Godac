/**
 * GODAC brand lockup: preserve the official road-and-drop G symbol and
 * original teal/orange brand colors, while making the GO / DAC split clear.
 */
export function Wordmark({
  inverted = false,
  height = 28,
  symbol = true,
  className = "",
}: {
  inverted?: boolean;
  height?: number;
  symbol?: boolean;
  className?: string;
}) {
  const textSize = Math.round(height * 0.66);
  const ink = inverted ? "#FFFFFF" : "#203342";
  return (
    <span translate="no" className={`inline-flex shrink-0 items-center ${className}`} style={{ gap: Math.round(height * 0.22) }}>
      {symbol && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/godac-symbol.svg" alt="" width={Math.round(height * 1.2)} height={height} />
      )}
      <span aria-label="GODAC" className="inline-flex items-baseline font-display font-extrabold tracking-[-0.065em]" style={{ fontSize: textSize, lineHeight: 1 }}>
        <span style={{ color: "#1BE4C1" }}>GO</span><span style={{ color: ink }}>DA</span><span style={{ color: "#1BE4C1" }}>C</span>
      </span>
    </span>
  );
}
