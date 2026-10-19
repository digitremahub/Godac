// Minimal hand-drawn stroke icons (24x24, currentColor) — no icon
// library dependency, just enough glyphs for the sidebar's nav items.

type IconProps = { className?: string };

const base = "h-[18px] w-[18px] shrink-0";

function Svg({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className ?? base}>
      {children}
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function IconDroplet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z" />
    </Svg>
  );
}

export function IconPlusCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </Svg>
  );
}

export function IconCylinder(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-13" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5.5-5.5L4 21" />
    </Svg>
  );
}

export function IconTruck(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="7" width="12" height="9" rx="1" />
      <path d="M13.5 10h3.5l3.5 3.5V16h-7" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="16.5" cy="18" r="1.8" />
    </Svg>
  );
}

export function IconWrench(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 4.9L3 17.5 6.5 21l6.3-6.3a4 4 0 0 0 4.9-5.4l-2.6 2.6-2.3-2.3 2.6-2.6Z" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

export function IconMegaphone(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10v4a1 1 0 0 0 1 1h2l9 5V4l-9 5H4a1 1 0 0 0-1 1Z" />
      <path d="M17 9.5a4 4 0 0 1 0 5" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconFileText(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h6M9 16h6M14 3v5h5" />
    </Svg>
  );
}

export function IconBuilding(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="3" width="12" height="18" rx="1" />
      <path d="M16 8h4v13h-4M7.5 7h1M11.5 7h1M7.5 11h1M11.5 11h1M7.5 15h1M11.5 15h1" />
    </Svg>
  );
}

export function IconCreditCard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
    </Svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6" />
      <path d="M16 8.2a3 3 0 1 1 3.6 4M21.5 20c0-2.6-1.7-4.7-4-5.6" />
    </Svg>
  );
}

export function IconUserCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6 19c1-2.5 3.3-4 6-4s5 1.5 6 4" />
    </Svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

export function IconShieldCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6Z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function IconChartBar(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </Svg>
  );
}

export function IconFlag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3v18" />
      <path d="M5 4h11l-2.5 3.5L16 11H5" />
    </Svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconWashing(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="13" r="7" />
      <path d="M9 13a3 3 0 0 1 6 0M12 6V3M8 4.5l1 2M16 4.5l-1 2" />
    </Svg>
  );
}

export function IconQrCode(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2" />
    </Svg>
  );
}

export function IconLifeBuoy(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M5.5 5.5l3.3 3.3M18.5 5.5l-3.3 3.3M5.5 18.5l3.3-3.3M18.5 18.5l-3.3-3.3" />
    </Svg>
  );
}

export function IconCoins(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="9" cy="8" rx="6" ry="3.5" />
      <path d="M3 8v5c0 1.93 2.69 3.5 6 3.5s6-1.57 6-3.5V8" />
      <path d="M12.5 12.3c3.4.3 5.5 1.7 5.5 3.2 0 1.93-2.69 3.5-6 3.5-2.5 0-4.64-.88-5.55-2.12" />
    </Svg>
  );
}

export function IconChatBubble(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.5 4V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

export function IconLogOut(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12 5 5L20 7" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 5v14l11-7Z" />
    </Svg>
  );
}

export function IconFingerprint(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 11v3a8 8 0 0 1-1.5 4.7" />
      <path d="M8.5 13.5V11a3.5 3.5 0 0 1 7 0v1.5" />
      <path d="M15.5 16a14 14 0 0 1-.9 4" />
      <path d="M5 15.5V11a7 7 0 0 1 12.5-4.3" />
      <path d="M19 11v1.5" />
    </Svg>
  );
}

export function IconPaperclip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8L13.3 3a3.7 3.7 0 0 1 5.2 5.2l-8.7 8.7a1.8 1.8 0 0 1-2.6-2.6l8-8" />
    </Svg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Svg>
  );
}

export function IconMapPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

export function IconNavigation(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 11 19-9-9 19-2-8Z" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" />
    </Svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    </Svg>
  );
}

export function IconMessage(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Z" />
    </Svg>
  );
}

/** Ramasse (enlèvement de colis) : colis soulevé, flèche vers le haut. */
export function IconRamasse(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Z" />
      <path d="M10 15h4" />
      <path d="M12 8V2M9 5l3-3 3 3" />
    </Svg>
  );
}

/** Point relais : devanture de commerce avec store. */
export function IconPointRelais(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12v8h14v-8" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  );
}
