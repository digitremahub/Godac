"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

interface Slide {
  src: string;
  alt: string;
}

const SLIDE_DURATION_MS = 5500;

/**
 * Homepage "how it works" gallery — real branded renders (public/home)
 * standing in for a product demo video, cycled the same way
 * ExplainerAnimation used to (autoplay, pause on hover, dot nav).
 */
export function ImageCarousel({ slides }: { slides: Slide[] }) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Explicit stop control: autoplay running longer than 5 s next to
  // other content needs one (WCAG 2.2.2), hover alone isn't reachable
  // by keyboard or touch.
  const [stopped, setStopped] = useState(false);
  const paused = hovered || focused || stopped;

  useEffect(() => {
    if (paused) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const id = setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  return (
    <div
      className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-navy/10 bg-surface shadow-[0_20px_60px_-25px_rgba(10,15,30,0.25)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div key={active} className="relative aspect-[1672/941] w-full animate-[explainer-in_0.5s_ease-out]">
        <Image
          src={slides[active]!.src}
          alt={slides[active]!.alt}
          fill
          sizes="(min-width: 1024px) 896px, 100vw"
          priority={active === 0}
          className="object-cover"
        />
      </div>

      <div className="flex items-center justify-center gap-1 border-t border-navy/10 py-2">
        <button
          type="button"
          onClick={() => setStopped((s) => !s)}
          className="mr-2 rounded-md px-2 py-1 text-xs font-semibold text-navy/70 hover:bg-navy/[0.05] hover:text-navy"
        >
          {stopped ? "Lecture" : "Pause"}
        </button>
        {slides.map((s, i) => (
          <button
            key={s.src}
            type="button"
            aria-label={`Voir : ${s.alt}`}
            aria-current={i === active ? "true" : undefined}
            onClick={() => setActive(i)}
            className="group flex h-8 items-center px-1"
          >
            <span
              className={`h-1.5 rounded-full transition-[width,background-color] ${i === active ? "w-6 bg-teal" : "w-1.5 bg-navy/25 group-hover:bg-marine/40"}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
