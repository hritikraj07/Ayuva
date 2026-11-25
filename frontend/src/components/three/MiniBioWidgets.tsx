import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createHologramShaderMaterial } from "./shaders";
import { useSceneCapabilities, useVisibilityPause, WebGLErrorBoundary } from "./useSceneCapabilities";

function BioCoreMesh({ pulseBoost = false }: { pulseBoost?: boolean }) {
  const grpRef = useRef<THREE.Group>(null);
  const shader = useMemo(
    () =>
      createHologramShaderMaterial({
        baseColor: "#14b8a6",
        rimColor: "#22d3ee",
        opacity: 0.72,
        scanSpeed: 1.8,
      }),
    []
  );

  useEffect(() => () => shader.dispose(), [shader]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    shader.uniforms.uTime.value = t;
    if (grpRef.current) {
      grpRef.current.rotation.y = t * (pulseBoost ? 0.6 : 0.35);
      grpRef.current.rotation.x = Math.sin(t * 0.5) * 0.15;
    }
  });

  return (
    <group ref={grpRef}>
      <mesh material={shader}>
        <icosahedronGeometry args={[0.92, 2]} />
      </mesh>
      <mesh rotation={[Math.PI / 3, 0.3, 0]}>
        <torusGeometry args={[1.32, 0.018, 8, 64]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.65} />
      </mesh>
      <mesh rotation={[-Math.PI / 3, -0.4, 0]}>
        <torusGeometry args={[1.52, 0.014, 8, 64]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

export function PatientBioCore3D({ className = "h-40 w-40" }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const caps = useSceneCapabilities();
  const visible = useVisibilityPause(ref);

  if (!caps.hasWebGL || caps.reducedMotion || caps.isMobile) {
    return (
      <div
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full border border-cyan-400/30 bg-radial from-cyan-500/20 via-violet-500/10 to-transparent ${className}`}
      >
        <div className="size-16 rounded-full border border-cyan-400/50 bg-cyan-400/15 shadow-[0_0_24px_rgba(34,211,238,0.45)]" />
      </div>
    );
  }

  return (
    <div ref={ref} aria-hidden="true" className={className}>
      <WebGLErrorBoundary fallback={<div className="h-full w-full rounded-full border border-cyan-400/30 bg-cyan-500/10" />}>
        <Canvas
          dpr={caps.dpr}
          frameloop={visible ? "always" : "demand"}
          camera={{ position: [0, 0, 3.8], fov: 40 }}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.6} />
          <pointLight position={[3, 3, 3]} intensity={1.4} color="#22d3ee" />
          <BioCoreMesh />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}

function OrbMesh({ thinking }: { thinking: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      createHologramShaderMaterial({
        baseColor: "#8b5cf6",
        rimColor: "#22d3ee",
        opacity: thinking ? 0.92 : 0.72,
        scanSpeed: thinking ? 4.2 : 1.8,
      }),
    [thinking]
  );

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ clock, pointer }) => {
    const t = clock.getElapsedTime();
    mat.uniforms.uTime.value = t;
    if (ref.current) {
      const speed = thinking ? 0.9 : 0.35;
      ref.current.rotation.y = t * speed + pointer.x * 0.4;
      ref.current.rotation.x = Math.sin(t * 0.6) * 0.2 + pointer.y * 0.25;
      const scale = thinking ? 1.0 + Math.sin(t * 6) * 0.05 : 1.0;
      ref.current.scale.setScalar(scale);
    }
  });

  return (
    <group ref={ref}>
      <mesh material={mat}>
        <sphereGeometry args={[0.92, 32, 32]} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.12, 1]} />
        <meshBasicMaterial color="#a78bfa" wireframe transparent opacity={thinking ? 0.55 : 0.32} />
      </mesh>
      <mesh rotation={[Math.PI / 2.6, 0.3, 0]}>
        <torusGeometry args={[1.45, 0.016, 8, 64]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.65} />
      </mesh>
    </group>
  );
}

export function IntelligenceOrb3D({
  thinking = false,
  className = "h-28 w-28",
}: {
  thinking?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const caps = useSceneCapabilities();
  const visible = useVisibilityPause(ref);

  if (!caps.hasWebGL || caps.reducedMotion || caps.isMobile) {
    return (
      <div
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full border border-violet-400/40 bg-radial from-violet-500/25 via-cyan-500/15 to-transparent ${className}`}
      >
        <div className="size-12 rounded-full border border-cyan-300/60 bg-violet-500/25 shadow-[0_0_24px_rgba(139,92,246,0.5)]" />
      </div>
    );
  }

  return (
    <div ref={ref} aria-hidden="true" className={className}>
      <WebGLErrorBoundary fallback={<div className="h-full w-full rounded-full border border-violet-400/40 bg-violet-500/15" />}>
        <Canvas
          dpr={caps.dpr}
          frameloop={visible ? "always" : "demand"}
          camera={{ position: [0, 0, 3.8], fov: 42 }}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.6} />
          <pointLight position={[3, 3, 4]} intensity={1.6} color="#22d3ee" />
          <pointLight position={[-3, -2, 2]} intensity={1.3} color="#d946ef" />
          <OrbMesh thinking={thinking} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
