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
        baseColor: "#66a9ec",
        rimColor: "#1e3a8a",
        opacity: 0.44,
        scanSpeed: 1.5,
      }),
    []
  );

  const torsoGeo = useMemo(() => {
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.01, -1.65),
      new THREE.Vector2(0.46, -1.55),
      new THREE.Vector2(0.54, -1.25),
      new THREE.Vector2(0.42, -0.78),
      new THREE.Vector2(0.58, -0.25),
      new THREE.Vector2(0.68, 0.35),
      new THREE.Vector2(0.76, 0.72),
      new THREE.Vector2(0.24, 0.96),
      new THREE.Vector2(0.18, 1.24),
      new THREE.Vector2(0.32, 1.44),
      new THREE.Vector2(0.35, 1.72),
      new THREE.Vector2(0.24, 1.98),
      new THREE.Vector2(0.01, 2.06),
    ];
    return new THREE.LatheGeometry(pts, 40);
  }, []);

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
      groupRef.current.position.y = Math.sin(t * 0.8) * 0.05;
    }

    if (heartRef.current) {
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
    <group ref={groupRef} position={[0.45, -0.05, 0]}>
      <mesh geometry={torsoGeo} material={torsoShader} scale={[1, 1, 0.62]} />

      {[-0.45, -0.1, 0.25, 0.58, 1.58].map((yPos, idx) => (
        <mesh key={idx} position={[0, yPos, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.64, 1]}>
          <torusGeometry args={[idx === 4 ? 0.34 : 0.66 - Math.abs(idx - 2) * 0.07, 0.007, 8, 48]} />
          <meshBasicMaterial color={idx === 4 ? "#4f46e5" : "#0284c7"} transparent opacity={0.45} />
        </mesh>
      ))}

      {vascularTubes.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial
            color="#0284c7"
            emissive="#0369a1"
            emissiveIntensity={0.85}
            transparent
            opacity={0.88}
          />
        </mesh>
      ))}

      <mesh ref={heartRef} position={[0.08, 0.32, 0.14]}>
        <icosahedronGeometry args={[0.14, 2]} />
        <meshStandardMaterial
          color="#e11d48"
          emissive="#be123c"
          emissiveIntensity={0.95}
          roughness={0.25}
          transparent
          opacity={0.94}
        />
      </mesh>

      <mesh ref={pulseDot1Ref}>
        <sphereGeometry args={[0.042, 12, 12]} />
        <meshBasicMaterial color="#141c2e" />
      </mesh>
      <mesh ref={pulseDot2Ref}>
        <sphereGeometry args={[0.034, 12, 12]} />
        <meshBasicMaterial color="#e11d48" />
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
          <meshStandardMaterial color="#0284c7" emissive="#0369a1" emissiveIntensity={0.6} />
        </mesh>
        <mesh geometry={strandB}>
          <meshStandardMaterial color="#323a4d" emissive="#1e293b" emissiveIntensity={0.4} />
        </mesh>
        {rungs.map((r, idx) => (
          <mesh key={idx} position={r.mid} rotation={[0, r.rotY, Math.PI / 2]}>
            <cylinderGeometry args={[0.011, 0.011, 0.62, 6]} />
            <meshBasicMaterial color={idx % 2 === 0 ? "#0ea5e9" : "#4f46e5"} transparent opacity={0.7} />
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
    <group position={[6.5, -5.8, -5.5]}>
      <group ref={vaultRef}>
        <mesh>
          <octahedronGeometry args={[0.78, 0]} />
          <meshStandardMaterial color="#323a4d" wireframe />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.45, 1]} />
          <meshStandardMaterial color="#0284c7" transparent opacity={0.55} />
        </mesh>
      </group>
      <group ref={cardsRef}>
        {[0, 1, 2, 3, 4, 5].map((idx) => (
          <mesh key={idx}>
            <boxGeometry args={[0.48, 0.32, 0.025]} />
            <meshStandardMaterial
              color={idx % 2 === 0 ? "#66a9ec" : "#323a4d"}
              transparent
              opacity={0.75}
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
        baseColor: "#66a9ec",
        rimColor: "#1e3a8a",
        opacity: 0.72,
        scanSpeed: 2.0,
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
    <group ref={orbRef} position={[-6.0, -10.8, -9.0]}>
      <mesh material={orbShader}>
        <sphereGeometry args={[0.92, 36, 36]} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.1, 1]} />
        <meshBasicMaterial color="#323a4d" wireframe transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[Math.PI / 3, 0.4, 0]}>
        <torusGeometry args={[1.5, 0.015, 8, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.65} />
      </mesh>
      <mesh rotation={[-Math.PI / 4, -0.5, 0.2]}>
        <torusGeometry args={[1.76, 0.011, 8, 64]} />
        <meshBasicMaterial color="#4f46e5" transparent opacity={0.5} />
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
      <group ref={globeRef} position={[5.2, -16.0, -13.0]}>
        <mesh>
          <sphereGeometry args={[1.32, 32, 32]} />
          <meshStandardMaterial color="#323a4d" roughness={0.55} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.345, 24, 24]} />
          <meshBasicMaterial color="#66a9ec" wireframe transparent opacity={0.45} />
        </mesh>
        <mesh rotation={[Math.PI / 2.2, 0.25, 0]}>
          <torusGeometry args={[1.68, 0.014, 8, 72]} />
          <meshBasicMaterial color="#0284c7" transparent opacity={0.65} />
        </mesh>
      </group>

      <group ref={shieldRef} position={[0, -21.5, -17.0]}>
        <mesh>
          <dodecahedronGeometry args={[0.96, 0]} />
          <meshStandardMaterial color="#323a4d" wireframe />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.56, 0]} />
          <meshStandardMaterial color="#0284c7" transparent opacity={0.7} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.42, 0.016, 8, 64]} />
          <meshBasicMaterial color="#323a4d" transparent opacity={0.55} />
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
        y: ((i * 41) % 100) / 4.0 - 20.0,
        z: -((i * 29) % 100) / 5.5 + 1.5,
        speed: 0.2 + ((i * 17) % 10) * 0.03,
        scale: 0.016 + ((i * 13) % 8) * 0.004,
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
      <meshBasicMaterial color="#0284c7" transparent opacity={0.45} />
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
  const lookTarget = useMemo(() => new THREE.Vector3(0.45, 0.2, 0), []);
  const desiredCam = useMemo(() => new THREE.Vector3(0, 0.35, 5.4), []);
  const desiredLook = useMemo(() => new THREE.Vector3(0.45, 0.2, 0), []);

  useFrame(({ camera }) => {
    const sp = THREE.MathUtils.clamp(scrollProgressRef.current, 0, 1);
    const px = pointerRef.current.x * 0.35;
    const py = pointerRef.current.y * 0.25;

    if (sp < 0.24) {
      const k = sp / 0.24;
      desiredCam.set(THREE.MathUtils.lerp(0.0, 3.6, k) + px, THREE.MathUtils.lerp(0.35, -4.8, k) + py, THREE.MathUtils.lerp(5.4, -0.5, k));
      desiredLook.set(THREE.MathUtils.lerp(0.45, 5.5, k), THREE.MathUtils.lerp(0.2, -5.6, k), THREE.MathUtils.lerp(0, -5.5, k));
    } else if (sp < 0.5) {
      const k = (sp - 0.24) / 0.26;
      desiredCam.set(THREE.MathUtils.lerp(3.6, -3.2, k) + px, THREE.MathUtils.lerp(-4.8, -10.0, k) + py, THREE.MathUtils.lerp(-0.5, -4.5, k));
      desiredLook.set(THREE.MathUtils.lerp(5.5, -5.5, k), THREE.MathUtils.lerp(-5.6, -10.8, k), THREE.MathUtils.lerp(-5.5, -9.0, k));
    } else if (sp < 0.76) {
      const k = (sp - 0.5) / 0.26;
      desiredCam.set(THREE.MathUtils.lerp(-3.2, 2.5, k) + px, THREE.MathUtils.lerp(-10.0, -15.2, k) + py, THREE.MathUtils.lerp(-4.5, -8.5, k));
      desiredLook.set(THREE.MathUtils.lerp(-5.5, 4.8, k), THREE.MathUtils.lerp(-10.8, -16.0, k), THREE.MathUtils.lerp(-9.0, -13.0, k));
    } else {
      const k = (sp - 0.76) / 0.24;
      desiredCam.set(THREE.MathUtils.lerp(2.5, 0.0, k) + px, THREE.MathUtils.lerp(-15.2, -20.5, k) + py, THREE.MathUtils.lerp(-8.5, -12.5, k));
      desiredLook.set(THREE.MathUtils.lerp(4.8, 0.0, k), THREE.MathUtils.lerp(-16.0, -21.5, k), THREE.MathUtils.lerp(-13.0, -17.0, k));
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
          camera={{ position: [0, 0.35, 5.4], fov: 45, near: 0.1, far: 50 }}
          gl={{ antialias: !capabilities.isLowPower, alpha: true, powerPreference: "high-performance" }}
        >
          <fog attach="fog" args={["#c3dcf0", 7, 24]} />
          <ambientLight intensity={0.95} />
          <directionalLight position={[4, 6, 5]} intensity={1.25} color="#ffffff" />
          <pointLight position={[-4, 2, 3]} intensity={1.1} color="#66a9ec" />

          <AnatomicalFigureAndVascular scrollProgressRef={scrollProgressRef} />
          <DNAHelix position={[-2.05, 0.1, -0.9]} rotationZ={0.22} scrollProgressRef={scrollProgressRef} />
          <DNAHelix position={[2.4, -0.25, -1.4]} rotationZ={-0.18} scrollProgressRef={scrollProgressRef} />
          <VaultStage scrollProgressRef={scrollProgressRef} />
          <IntelligenceOrbStage pointerRef={pointerRef} />
          <SurveillanceGlobeAndShieldStage />
          <InstancedBioParticles count={capabilities.isLowPower ? 70 : 140} />
          <CameraChoreographer scrollProgressRef={scrollProgressRef} pointerRef={pointerRef} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
