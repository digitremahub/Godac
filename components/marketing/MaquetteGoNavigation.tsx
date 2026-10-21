import { IconCheck, IconNavigation, IconPointRelais, IconRamasse } from "@/components/layout/icons";

/**
 * Maquette en code de l'écran GO Navigation (site public) : vue conduite
 * aux couleurs GODAC, consigne de direction, carte d'arrêt glissable et
 * arrêts suivants (ramasse en or, point relais en violet, comme dans
 * l'application — components/colis). Purement décorative : le texte
 * équivalent est donné à côté, dans la section « Tournée colis ».
 */
export function MaquetteGoNavigation() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[300px]">
      <div className="relative overflow-hidden rounded-[2.2rem] bg-marine p-2.5 shadow-pop ring-1 ring-white/10">
        <div className="relative flex aspect-[9/18.5] flex-col overflow-hidden rounded-[1.8rem] bg-[#0E1528]">
          {/* Consigne de direction */}
          <div className="relative z-10 m-2.5 flex items-center gap-3 rounded-2xl bg-teal px-3.5 py-3 text-marine shadow-raised">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-marine text-teal">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 20V12a4 4 0 0 1 4-4h8" />
                <path d="m15 4 4 4-4 4" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block font-display text-lg font-extrabold leading-none">300 m</span>
              <span className="block truncate text-xs font-semibold">Tournez à droite · Rue Carnot</span>
            </span>
          </div>

          {/* Vue conduite 3D : route en perspective qui suit la position */}
          <div className="absolute inset-0">
            <svg viewBox="0 0 300 600" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
              <defs>
                <linearGradient id="go-ciel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#0A0F1E" />
                  <stop offset="1" stopColor="#16223F" />
                </linearGradient>
              </defs>
              <rect width="300" height="600" fill="url(#go-ciel)" />
              {/* Îlots et rues secondaires */}
              <path d="M0 260 L120 230 M300 300 L175 250 M0 420 L105 330 M300 470 L190 340" stroke="#22304F" strokeWidth="14" />
              {/* Route principale en perspective */}
              <path d="M95 600 L140 190 L160 190 L205 600 Z" fill="#26375C" />
              {/* Itinéraire */}
              <path d="M150 560 L150 300 Q150 250 190 236 L300 205" fill="none" stroke="#1BE4C1" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
              {/* Prochain arrêt : ramasse */}
              <circle cx="232" cy="222" r="11" fill="#F5C842" stroke="#0A0F1E" strokeWidth="3" />
              {/* Position du chauffeur */}
              <path d="M150 470 l16 34 -16 -8 -16 8 Z" fill="#FF6B35" stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Carte d'arrêt glissable */}
          <div className="relative z-10 mt-auto rounded-t-3xl bg-surface p-3.5 text-navy shadow-pop">
            <span className="mx-auto mb-2.5 block h-1 w-10 rounded-full bg-navy/15" />
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold text-marine">
                <IconRamasse className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-gold-ink">Ramasse · arrêt 3/10</span>
                <span className="block truncate text-sm font-bold">Imprimerie du Rhône</span>
                <span className="block truncate text-xs text-navy/60">14 rue Carnot, Saint-Fons · 14:00–16:00</span>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
              <span className="flex items-center justify-center gap-1.5 rounded-xl bg-teal py-2 text-marine">
                <IconCheck className="h-4 w-4" />
                Valider
              </span>
              <span className="flex items-center justify-center gap-1.5 rounded-xl bg-navy/[0.06] py-2">
                <IconNavigation className="h-4 w-4" />
                Itinéraire
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-navy/[0.08] pt-2.5 text-xs text-navy/65">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-relais text-marine">
                <IconPointRelais className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">Ensuite : point relais · Tabac-Presse du Centre</span>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -right-3 top-24 hidden items-center gap-2 rounded-2xl bg-surface px-3 py-2 text-xs font-semibold text-navy shadow-pop sm:flex">
        <span className="h-2 w-2 rounded-full bg-orange" />
        Colis sans téléphone
      </div>
    </div>
  );
}
