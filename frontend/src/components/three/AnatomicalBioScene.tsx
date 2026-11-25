import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createHologramShaderMaterial } from "./shaders";
import { SceneCapabilities, WebGLErrorBoundary } from "./useSceneCapabilities";

interface AnatomicalBioSceneProps {
  scrollProgressRef: React.MutableRefObject<number>;
  pointerRef: React.MutableRefObject<{ x: number; y: number }>;
  capabilities: SceneCapabilities;
}

function AnatomicalFigureAndVascular({
  scrollProgressRef,
}: {
  scrollProgressRef: React.MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const heartRef = useRef<THREE.Mesh>(null);
  const pulseDot1Ref = useRef<THREE.Mesh>(null);
  const pulseDot2Ref = useRef<THREE.Mesh>(null);

  const torsoShader = useMemo(
    () =>
      createHologramShaderMaterial({
        baseColor: "#0ea5e9",
        rimColor: "#67e8f9",
        opacity: 0.42,
        scanSpeed: 1.6,
      }),
    []
  );

  // Sculpted anatomical torso + neck + cranium silhouette via LatheGeometry
  const torsoGeo = useMemo(() => {
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.01, -1.65),
      new THREE.Vector2(0.46, -1.55), // pelvis lower
      new THREE.Vector2(0.54, -1.25), // iliac crest
      new THREE.Vector2(0.42, -0.78), // waist
      new THREE.Vector2(0.58, -0.25), // lower ribcage
      new THREE.Vector2(0.68, 0.35), // chest / pectoral
      new THREE.Vector2(0.76, 0.72), // deltoid/shoulder breadth
      new THREE.Vector2(0.24, 0.96), // neck base
      new THREE.Vector2(0.18, 1.24), // upper neck
      new THREE.Vector2(0.32, 1.44), // jaw / chin
      new THREE.Vector2(0.35, 1.72), // cranium mid
      new THREE.Vector2(0.24, 1.98), // crown
      new THREE.Vector2(0.01, 2.06),
    ];
    return new THREE.LatheGeometry(pts, 40);
  }, []);

  // Cardiovascular tube paths: ascending aorta, carotids, subclavian branches
  const vascularCurves = useMemo(() => {
    const aorta = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.08, 0.32, 0.14),
      new THREE.Vector3(0.04, 0.62, 0.08),
      new THREE.Vector3(-0.04, 0.74, -0.02),
      new THREE.Vector3(-0.04, 0.15, -0.08),
      new THREE.Vector3(0.0, -0.85, -0.04),
      new THREE.Vector3(-0.18, -1.45, 0.04),
    ]);
    const rightIliac = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, -0.85, -0.04),
      new THREE.Vector3(0.2, -1.45, 0.04),
    ]);
    const carotidLeft = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, 0.65, 0.06),
      new THREE.Vector3(-0.1, 1.15, 0.06),
      new THREE.Vector3(-0.12, 1.65, 0.04),
    ]);
    const carotidRight = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, 0.64, 0.07),
      new THREE.Vector3(0.11, 1.15, 0.06),
      new THREE.Vector3(0.12, 1.65, 0.04),
    ]);
    const armLeft = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.02, 0.68, 0.04),
      new THREE.Vector3(-0.42, 0.62, 0.02),
      new THREE.Vector3(-0.68, 0.1, 0.06),
    ]);
    const armRight = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.04, 0.68, 0.05),
      new THREE.Vector3(0.44, 0.62, 0.02),
      new THREE.Vector3(0.7, 0.1, 0.06),
    ]);
    return { aorta, rightIliac, carotidLeft, carotidRight, armLeft, armRight };
  }, []);

  const vascularTubes = useMemo(() => {
    return Object.values(vascularCurves).map(
      (curve) => new THREE.TubeGeometry(curve, 36, 0.022, 8, false)
    );
  }, [vascularCurves]);

  useEffect(() => {
    return () => {
      torsoShader.dispose();
      torsoGeo.dispose();
      vascularTubes.forEach((g) => g.dispose());
    };
  }, [torsoShader, torsoGeo, vascularTubes]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    torsoShader.uniforms.uTime.value = t;
    const sp = scrollProgressRef.current;

    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.25) * 0.18 + sp * 1.4;
      groupRef.current.position.y = Math.sin(t * 0.8) * 0.06;
    }

    if (heartRef.current) {
      // Rhythmic 72 BPM systolic pulse
      const beat = 1.0 + Math.pow(Math.max(0, Math.sin(t * 3.8)), 4) * 0.22;
      heartRef.current.scale.setScalar(beat);
    }

    if (pulseDot1Ref.current) {
      const p1 = (t * 0.35) % 1;
      pulseDot1Ref.current.position.copy(vascularCurves.aorta.getPointAt(p1));
    }
    if (pulseDot2Ref.current) {
      const p2 = (t * 0.45 + 0.4) % 1;
      pulseDot2Ref.current.position.copy(vascularCurves.carotidLeft.getPointAt(p2));
    }
  });

  return (
    <group ref={groupRef} position={[0.4, -0.1, 0]}>
      {/* Outer sculpted anatomical glass silhouette */}
      <mesh geometry={torsoGeo} material={torsoShader} scale={[1, 1, 0.62]} />

      {/* Precision wireframe ribcage / MRI axial scan rings */}
      {[-0.45, -0.1, 0.25, 0.58, 1.58].map((yPos, idx) => (
        <mesh key={idx} position={[0, yPos, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.64, 1]}>
          <torusGeometry args={[idx === 4 ? 0.34 : 0.66 - Math.abs(idx - 2) * 0.07, 0.006, 8, 48]} />
          <meshBasicMaterial color={idx === 4 ? "#a78bfa" : "#38bdf8"} transparent opacity={0.42} />
        </mesh>
      ))}

      {/* Glowing cardiovascular vessel network */}
      {vascularTubes.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial
            color="#22d3ee"
            emissive="#06b6d4"
            emissiveIntensity={1.6}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}

      {/* Pulsing cardiac core */}
      <mesh ref={heartRef} position={[0.08, 0.32, 0.14]}>
        <icosahedronGeometry args={[0.14, 2]} />
        <meshStandardMaterial
          color="#f43f5e"
          emissive="#fb7185"
          emissiveIntensity={2.4}
          roughness={0.2}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Arterial pulse tracers */}
      <mesh ref={pulseDot1Ref}>
        <sphereGeometry args={[0.042, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh ref={pulseDot2Ref}>
        <sphereGeometry args={[0.034, 12, 12]} />
        <meshBasicMaterial color="#a78bfa" />
      </mesh>
    </group>
  );
}

function DNAHelix({
  position,
  rotationZ = 0.2,
  scrollProgressRef,
}: {
  position: [number, number, number];
  rotationZ?: number;
  scrollProgressRef: React.MutableRefObject<number>;
}) {
  const dnaRef = useRef<THREE.Group>(null);
  const { strandA, strandB, rungs } = useMemo(() => {
    const ptsA: THREE.Vector3[] = [];
    const ptsB: THREE.Vector3[] = [];
    const rungList: Array<{ mid: THREE.Vector3; rotY: number }> = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const y = (i / steps) * 4.4 - 2.2;
      const angle = (i / steps) * Math.PI * 4.5;
      const r = 0.32;
      const pA = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
      const pB = new THREE.Vector3(Math.cos(angle + Math.PI) * r, y, Math.sin(angle + Math.PI) * r);
      ptsA.push(pA);
      ptsB.push(pB);
      if (i % 3 === 0) {
        rungList.push({
          mid: new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5),
          rotY: -angle,
        });
      }
    }
    return {
      strandA: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsA), 48, 0.022, 8, false),
      strandB: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsB), 48, 0.022, 8, false),
      rungs: rungList,
    };
  }, []);

  useEffect(() => {
    return () => {
      strandA.dispose();
      strandB.dispose();
    };
  }, [strandA, strandB]);

  useFrame(({ clock }) => {
    if (!dnaRef.current) return;
    const t = clock.getElapsedTime();
    dnaRef.current.rotation.y = t * 0.45 + scrollProgressRef.current * Math.PI * 2;
  });

  return (
    <group position={position} rotation={[0, 0, rotationZ]}>
      <group ref={dnaRef}>
        <mesh geometry={strandA}>
          <meshStandardMaterial color="#22d3ee" emissive="#0ea5e9" emissiveIntensity={1.5} />
        </mesh>
        <mesh geometry={strandB}>
          <meshStandardMaterial color="#a78bfa" emissive="#8b5cf6" emissiveIntensity={1.5} />
        </mesh>
        {rungs.map((r, idx) => (
          <mesh key={idx} position={r.mid} rotation={[0, r.rotY, Math.PI / 2]}>
            <cylinderGeometry args={[0.01, 0.01, 0.62, 6]} />
            <meshBasicMaterial color={idx % 2 === 0 ? "#67e8f9" : "#c4b5fd"} transparent opacity={0.75} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function VaultStage({ scrollProgressRef }: { scrollProgressRef: React.MutableRefObject<number> }) {
  const vaultRef = useRef<THREE.Group>(null);
  const cardsRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const sp = scrollProgressRef.current;
    if (vaultRef.current) {
      vaultRef.current.rotation.y = t * 0.28 + sp * 2.1;
    }
    if (cardsRef.current) {
      cardsRef.current.children.forEach((child, i) => {
        const spread = THREE.MathUtils.clamp((sp - 0.14) * 4.5, 0, 1);
        const angle = (i / 6) * Math.PI * 2 + t * 0.22;
        const radius = 0.85 + spread * 0.85;
        child.position.set(
          Math.cos(angle) * radius,
          (i - 2.5) * (0.18 + spread * 0.26),
          Math.sin(angle) * radius
        );
        child.rotation.y = -angle + Math.PI / 2;
      });
    }
  });

  return (
    <group position={[5.6, -1.6, -2.5]}>
      <group ref={vaultRef}>
        <mesh>
          <octahedronGeometry args={[0.72, 0]} />
          <meshStandardMaterial
            color="#0ea5e9"
            emissive="#22d3ee"
            emissiveIntensity={1.1}
            wireframe
          />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.42, 1]} />
          <meshStandardMaterial
            color="#14b8a6"
            emissive="#2dd4bf"
            emissiveIntensity={1.4}
            transparent
            opacity={0.45}
          />
        </mesh>
      </group>
      <group ref={cardsRef}>
        {[0, 1, 2, 3, 4, 5].map((idx) => (
          <mesh key={idx}>
            <boxGeometry args={[0.46, 0.3, 0.025]} />
            <meshStandardMaterial
              color={idx % 2 === 0 ? "#22d3ee" : "#a78bfa"}
              emissive={idx % 2 === 0 ? "#0ea5e9" : "#8b5cf6"}
              emissiveIntensity={0.9}
              transparent
              opacity={0.62}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function IntelligenceOrbStage({
  pointerRef,
}: {
  pointerRef: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const orbRef = useRef<THREE.Group>(null);
  const orbShader = useMemo(
    () =>
      createHologramShaderMaterial({
        baseColor: "#8b5cf6",
        rimColor: "#22d3ee",
        opacity: 0.78,
        scanSpeed: 2.2,
      }),
    []
  );

  useEffect(() => () => orbShader.dispose(), [orbShader]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    orbShader.uniforms.uTime.value = t;
    if (orbRef.current) {
      orbRef.current.rotation.y = t * 0.35 + pointerRef.current.x * 0.45;
      orbRef.current.rotation.x = Math.sin(t * 0.5) * 0.2 + pointerRef.current.y * 0.3;
    }
  });

  return (
    <group ref={orbRef} position={[-4.8, -3.3, -4.4]}>
      <mesh material={orbShader}>
        <sphereGeometry args={[0.88, 36, 36]} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.05, 1]} />
        <meshBasicMaterial color="#a78bfa" wireframe transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[Math.PI / 3, 0.4, 0]}>
        <torusGeometry args={[1.45, 0.014, 8, 64]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 4, -0.5, 0.2]}>
        <torusGeometry args={[1.72, 0.01, 8, 64]} />
        <meshBasicMaterial color="#d946ef" transparent opacity={0.45} />
      </mesh>
    </group>
  );
}

function SurveillanceGlobeAndShieldStage() {
  const globeRef = useRef<THREE.Group>(null);
  const shieldRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (globeRef.current) {
      globeRef.current.rotation.y = t * 0.18;
    }
    if (shieldRef.current) {
      shieldRef.current.rotation.y = -t * 0.32;
      shieldRef.current.rotation.z = Math.sin(t * 0.4) * 0.12;
    }
  });

  return (
    <>
      <group ref={globeRef} position={[3.8, -5.0, -6.4]}>
        <mesh>
          <sphereGeometry args={[1.28, 32, 32]} />
          <meshStandardMaterial color="#071a33" emissive="#082f49" emissiveIntensity={0.65} roughness={0.6} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.305, 24, 24]} />
          <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.28} />
        </mesh>
        <mesh rotation={[Math.PI / 2.2, 0.25, 0]}>
          <torusGeometry args={[1.62, 0.012, 8, 72]} />
          <meshBasicMaterial color="#14b8a6" transparent opacity={0.55} />
        </mesh>
      </group>

      <group ref={shieldRef} position={[0, -6.8, -8.5]}>
        <mesh>
          <dodecahedronGeometry args={[0.92, 0]} />
          <meshStandardMaterial color="#22d3ee" emissive="#0ea5e9" emissiveIntensity={1.2} wireframe />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.52, 0]} />
          <meshStandardMaterial color="#a78bfa" emissive="#8b5cf6" emissiveIntensity={1.8} transparent opacity={0.75} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.38, 0.015, 8, 64]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.5} />
        </mesh>
      </group>
    </>
  );
}

function InstancedBioParticles({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: ((i * 73) % 100) / 5.2 - 9.5,
        y: ((i * 41) % 100) / 8.5 - 8.2,
        z: -((i * 29) % 100) / 8.0 + 1.5,
        speed: 0.2 + ((i * 17) % 10) * 0.03,
        scale: 0.015 + ((i * 13) % 8) * 0.004,
      })),
    [count]
  );

  useFrame(({ clock }) => {
    const inst = meshRef.current;
    if (!inst) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      dummy.position.set(
        s.x + Math.sin(t * s.speed + i) * 0.18,
        s.y + Math.cos(t * s.speed + i * 0.5) * 0.22,
        s.z
      );
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color="#67e8f9" transparent opacity={0.55} />
    </instancedMesh>
  );
}

function CameraChoreographer({
  scrollProgressRef,
  pointerRef,
}: {
  scrollProgressRef: React.MutableRefObject<number>;
  pointerRef: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const lookTarget = useMemo(() => new THREE.Vector3(0.4, 0.2, 0), []);
  const desiredCam = useMemo(() => new THREE.Vector3(0, 0.35, 5.2), []);
  const desiredLook = useMemo(() => new THREE.Vector3(0.4, 0.2, 0), []);

  useFrame(({ camera }) => {
    const sp = THREE.MathUtils.clamp(scrollProgressRef.current, 0, 1);
    const px = pointerRef.current.x * 0.35;
    const py = pointerRef.current.y * 0.25;

    // Multi-waypoint spline path matching Landing Page narrative sections
    if (sp < 0.22) {
      const k = sp / 0.22;
      desiredCam.set(THREE.MathUtils.lerp(0.0, 2.8, k) + px, THREE.MathUtils.lerp(0.35, -0.6, k) + py, THREE.MathUtils.lerp(5.2, 3.8, k));
      desiredLook.set(THREE.MathUtils.lerp(0.4, 2.2, k), THREE.MathUtils.lerp(0.2, -0.5, k), THREE.MathUtils.lerp(0, -1.2, k));
    } else if (sp < 0.42) {
      const k = (sp - 0.22) / 0.2;
      desiredCam.set(THREE.MathUtils.lerp(2.8, -1.2, k) + px, THREE.MathUtils.lerp(-0.6, -2.2, k) + py, THREE.MathUtils.lerp(3.8, 0.5, k));
      desiredLook.set(THREE.MathUtils.lerp(2.2, -3.5, k), THREE.MathUtils.lerp(-0.5, -2.8, k), THREE.MathUtils.lerp(-1.2, -3.8, k));
    } else if (sp < 0.65) {
      const k = (sp - 0.42) / 0.23;
      desiredCam.set(THREE.MathUtils.lerp(-1.2, 1.4, k) + px, THREE.MathUtils.lerp(-2.2, -4.0, k) + py, THREE.MathUtils.lerp(0.5, -1.8, k));
      desiredLook.set(THREE.MathUtils.lerp(-3.5, 2.8, k), THREE.MathUtils.lerp(-2.8, -4.8, k), THREE.MathUtils.lerp(-3.8, -6.2, k));
    } else {
      const k = (sp - 0.65) / 0.35;
      desiredCam.set(THREE.MathUtils.lerp(1.4, 0.0, k) + px, THREE.MathUtils.lerp(-4.0, -5.8, k) + py, THREE.MathUtils.lerp(-1.8, -4.2, k));
      desiredLook.set(THREE.MathUtils.lerp(2.8, 0.0, k), THREE.MathUtils.lerp(-4.8, -6.6, k), THREE.MathUtils.lerp(-6.2, -8.4, k));
    }

    camera.position.lerp(desiredCam, 0.06);
    lookTarget.lerp(desiredLook, 0.06);
    camera.lookAt(lookTarget);
  });

  return null;
}

export default function AnatomicalBioScene({
  scrollProgressRef,
  pointerRef,
  capabilities,
}: AnatomicalBioSceneProps) {
  if (!capabilities.hasWebGL || capabilities.reducedMotion) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 neo-grid-overlay opacity-70"
      />
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <WebGLErrorBoundary fallback={<div className="h-full w-full neo-grid-overlay opacity-70" />}>
        <Canvas
          dpr={capabilities.dpr}
          camera={{ position: [0, 0.35, 5.2], fov: 46, near: 0.1, far: 45 }}
          gl={{ antialias: !capabilities.isLowPower, alpha: true, powerPreference: "high-performance" }}
        >
          <fog attach="fog" args={["#05070d", 6, 22]} />
          <ambientLight intensity={0.45} />
          <pointLight position={[3, 4, 5]} intensity={1.8} color="#22d3ee" />
          <pointLight position={[-4, -2, 2]} intensity={1.4} color="#8b5cf6" />

          <AnatomicalFigureAndVascular scrollProgressRef={scrollProgressRef} />
          <DNAHelix position={[-1.95, 0.1, -0.9]} rotationZ={0.22} scrollProgressRef={scrollProgressRef} />
          <DNAHelix position={[2.35, -0.3, -1.4]} rotationZ={-0.18} scrollProgressRef={scrollProgressRef} />
          <VaultStage scrollProgressRef={scrollProgressRef} />
          <IntelligenceOrbStage pointerRef={pointerRef} />
          <SurveillanceGlobeAndShieldStage />
          <InstancedBioParticles count={capabilities.isLowPower ? 75 : 160} />
          <CameraChoreographer scrollProgressRef={scrollProgressRef} pointerRef={pointerRef} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
