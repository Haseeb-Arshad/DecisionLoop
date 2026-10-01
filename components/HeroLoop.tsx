"use client";
import { useEffect, useRef } from "react";

/**
 * The landing page's silent loop. Plays automatically and muted; stays on its
 * poster for anyone who has asked their system for reduced motion.
 */
export function HeroLoop({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (query.matches) video.pause();
      else void video.play().catch(() => undefined);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return <video ref={ref} className="landing-video" src={src} poster={poster} muted loop playsInline preload="metadata" aria-label={label} />;
}
