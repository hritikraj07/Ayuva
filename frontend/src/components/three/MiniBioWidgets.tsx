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
        baseColor: "#66a9ec",
        rimColor: "#323a4d",
        opacity: 0.7,
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
        <torusGeometry args={[1.32, 0.02, 8, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 3, -0.4, 0]}>
        <torusGeometry args={[1.52, 0.015, 8, 64]} />
        <meshBasicMaterial color="#323a4d" transparent opacity={0.55} />
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
        className={`flex items-center justify-center rounded-full border border-[#66A9EC]/50 bg-white/80 ${className}`}
      >
        <div className="size-12 rounded-full border border-[#0284C7] bg-[#D9EEF3]" />
      </div>
    );
  }

  return (
    <div ref={ref} aria-hidden="true" className={className}>
      <WebGLErrorBoundary fallback={<div className="h-full w-full rounded-full border border-[#66A9EC] bg-[#D9EEF3]" />}>
        <Canvas
          dpr={caps.dpr}
          frameloop={visible ? "always" : "demand"}
          camera={{ position: [0, 0, 3.8], fov: 40 }}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[3, 3, 3]} intensity={1.2} color="#ffffff" />
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
        baseColor: "#66a9ec",
        rimColor: "#141c2e",
        opacity: thinking ? 0.88 : 0.68,
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
        <meshBasicMaterial color="#323a4d" wireframe transparent opacity={thinking ? 0.55 : 0.35} />
      </mesh>
      <mesh rotation={[Math.PI / 2.6, 0.3, 0]}>
        <torusGeometry args={[1.45, 0.018, 8, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.7} />
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
        className={`flex items-center justify-center rounded-full border border-[#66A9EC] bg-white/80 ${className}`}
      >
        <div className="size-10 rounded-full border border-[#323A4D] bg-[#D9EEF3]" />
      </div>
    );
  }

  return (
    <div ref={ref} aria-hidden="true" className={className}>
      <WebGLErrorBoundary fallback={<div className="h-full w-full rounded-full border border-[#66A9EC] bg-[#D9EEF3]" />}>
        <Canvas
          dpr={caps.dpr}
          frameloop={visible ? "always" : "demand"}
          camera={{ position: [0, 0, 3.8], fov: 42 }}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[3, 3, 4]} intensity={1.25} color="#ffffff" />
          <OrbMesh thinking={thinking} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
