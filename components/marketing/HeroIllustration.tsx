/**
 * Purely decorative hero illustration — hand-drawn line art matching
 * the sidebar icon set (navy stroke, teal/orange/gold accents), no
 * external image asset needed. The three floating badges gently bob
 * (paused for prefers-reduced-motion via the .float-* keyframes in
 * globals.css) to give the homepage some life without being a real
 * animation/video.
 */
export function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 420 320"
      className="w-full max-w-md"
      fill="none"
      role="img"
      aria-label="Illustration d'un camion sur une route, entouré d'icônes carburant, alerte et document"
    >
      <circle cx="110" cy="110" r="95" className="fill-teal/10" />
      <circle cx="320" cy="90" r="70" className="fill-gold/10" />
      <circle cx="300" cy="230" r="80" className="fill-orange/10" />

      {/* road */}
      <path d="M20 250 H400" stroke="#0A0F1E" strokeOpacity="0.12" strokeWidth="14" strokeLinecap="round" />
      <path
        d="M30 250 H390"
        stroke="#0A0F1E"
        strokeOpacity="0.25"
        strokeWidth="3"
        strokeDasharray="14 12"
        strokeLinecap="round"
      />

      {/* truck */}
      <g stroke="#0A0F1E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="70" y="165" width="130" height="60" rx="6" className="fill-white" />
        <path d="M200 185h48l28 26v14h-76Z" className="fill-teal/15" />
        <circle cx="120" cy="235" r="16" className="fill-white" />
        <circle cx="120" cy="235" r="5" fill="#0A0F1E" stroke="none" />
        <circle cx="245" cy="235" r="16" className="fill-white" />
        <circle cx="245" cy="235" r="5" fill="#0A0F1E" stroke="none" />
        <path d="M212 195h20v18h-20Z" className="fill-white" />
      </g>

      {/* floating badges */}
      <g className="float-slow">
        <circle cx="95" cy="55" r="26" className="fill-white stroke-teal/40" strokeWidth="1.5" />
        <path
          d="M95 42s10 10.5 10 17.5a10 10 0 1 1-20 0C85 52.5 95 42 95 42Z"
          className="fill-teal/20 stroke-teal-ink"
          strokeWidth="1.75"
        />
      </g>

      <g className="float-medium">
        <circle cx="340" cy="140" r="24" className="fill-white stroke-orange/40" strokeWidth="1.5" />
        <path
          d="M340 128a12 12 0 0 1 12 12v8l4 5h-32l4-5v-8a12 12 0 0 1 12-12Z"
          className="fill-orange/20 stroke-orange-ink"
          strokeWidth="1.75"
        />
      </g>

      <g className="float-fast">
        <circle cx="250" cy="55" r="22" className="fill-white stroke-gold/40" strokeWidth="1.5" />
        <rect x="239" y="43" width="22" height="26" rx="2" className="fill-gold/20 stroke-gold-ink" strokeWidth="1.75" />
        <path d="M244 51h12M244 57h12M244 63h7" className="stroke-gold-ink" strokeWidth="1.75" />
      </g>
    </svg>
  );
}
