import React, { Component, useEffect, useState } from "react";

export interface SceneCapabilities {
  hasWebGL: boolean;
  reducedMotion: boolean;
  isMobile: boolean;
  isLowPower: boolean;
  dpr: [number, number];
}

function detectWebGLSupport(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

export function useSceneCapabilities(): SceneCapabilities {
  const [caps, setCaps] = useState<SceneCapabilities>(() => {
    const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false;
    const reducedMotion =
      typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    return {
      hasWebGL: detectWebGLSupport(),
      reducedMotion,
      isMobile,
      isLowPower: isMobile || cores <= 4,
      dpr: isMobile ? [1, 1.25] : [1, 1.5],
    };
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const isMobile = window.innerWidth < 768;
      const cores = navigator.hardwareConcurrency || 4;
      setCaps({
        hasWebGL: detectWebGLSupport(),
        reducedMotion: mq.matches,
        isMobile,
        isLowPower: isMobile || cores <= 4,
        dpr: isMobile ? [1, 1.25] : [1, 1.5],
      });
    };
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return caps;
}

export function useVisibilityPause(ref: React.RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return visible;
}

export class WebGLErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
