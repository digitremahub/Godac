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
  const [paused, setPaused] = useState(false);

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
      className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-[0_20px_60px_-25px_rgba(10,15,30,0.25)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
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

      <div className="flex items-center justify-center gap-2 border-t border-navy/10 py-4">
        {slides.map((s, i) => (
          <button
            key={s.src}
            type="button"
            aria-label={`Voir : ${s.alt}`}
            onClick={() => setActive(i)}
            className={`h-1.5 rounded-full transition-[width,background-color] ${i === active ? "w-6 bg-teal" : "w-1.5 bg-navy/15 hover:bg-navy/25"}`}
          />
        ))}
      </div>
    </div>
  );
}
