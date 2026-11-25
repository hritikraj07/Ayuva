import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useSceneCapabilities, useVisibilityPause, WebGLErrorBoundary } from "./useSceneCapabilities";

function MedicalViewportShell({
  label,
  sublabel,
  heightClass = "h-[360px]",
  fallbackText,
  children,
}: {
  label: string;
  sublabel: string;
  heightClass?: string;
  fallbackText: string;
  children: (visible: boolean, dpr: [number, number], reducedMotion: boolean, lowPower: boolean) => React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const caps = useSceneCapabilities();
  const visible = useVisibilityPause(containerRef);

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-2xl border border-slate-300/90 bg-gradient-to-br from-white via-[#d9eef3] to-[#b9d3ec] shadow-[0_14px_38px_-14px_rgba(20,28,46,0.22)] ${heightClass}`}
    >
      {!caps.hasWebGL ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
          {fallbackText}
        </div>
      ) : (
        <WebGLErrorBoundary
          fallback={
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {fallbackText}
            </div>
          }
        >
          {children(visible, caps.dpr, caps.reducedMotion, caps.isLowPower)}
        </WebGLErrorBoundary>
      )}

      <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-0.5 rounded-lg border border-slate-300/80 bg-white/88 px-3 py-1.5 backdrop-blur-md">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#0284C7]">{label}</span>
        <span className="text-[11px] font-medium text-primary">{sublabel}</span>
      </div>

      <div className="pointer-events-none absolute right-3 bottom-2.5 hidden text-[11px] font-medium text-primary/70 sm:block">
        Drag to rotate 3D model
      </div>
    </div>
  );
}

/* 1. HERO MODEL: Sculpted Anatomical Heart + Aortic Arch/Coronary Vessels + Flanking DNA Helix */
function AnatomicalHeartAndDnaMesh() {
  const rootRef = useRef<THREE.Group>(null);
  const heartRef = useRef<THREE.Group>(null);
  const dnaRef = useRef<THREE.Group>(null);

  const {
    aortaGeo,
    pulmonaryGeo,
    coronaryLeftGeo,
    coronaryRightGeo,
    superiorVenaGeo,
    dnaStrandA,
    dnaStrandB,
    dnaRungs,
  } = useMemo(() => {
    const aorta = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.05, 0.28, 0.05),
        new THREE.Vector3(0.12, 0.85, 0.04),
        new THREE.Vector3(-0.08, 1.12, -0.04),
        new THREE.Vector3(-0.32, 0.86, -0.18),
        new THREE.Vector3(-0.22, -0.45, -0.22),
      ]),
      42,
      0.11,
      14,
      false
    );

    const pulmonary = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.18, 0.25, 0.22),
        new THREE.Vector3(-0.12, 0.72, 0.14),
        new THREE.Vector3(0.28, 0.82, -0.02),
      ]),
      28,
      0.085,
      12,
      false
    );

    const vena = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.42, 0.22, -0.04),
        new THREE.Vector3(-0.42, 0.98, -0.06),
      ]),
      18,
      0.09,
      12,
      false
    );

    const corL = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.06, 0.36, 0.36),
        new THREE.Vector3(0.28, 0.08, 0.56),
        new THREE.Vector3(0.14, -0.42, 0.45),
        new THREE.Vector3(-0.04, -0.78, 0.22),
      ]),
      28,
      0.024,
      8,
      false
    );

    const corR = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.08, 0.3, 0.38),
        new THREE.Vector3(-0.34, 0.02, 0.48),
        new THREE.Vector3(-0.28, -0.48, 0.32),
      ]),
      24,
      0.02,
      8,
      false
    );

    // Precision DNA strand beside the heart
    const ptsA: THREE.Vector3[] = [];
    const ptsB: THREE.Vector3[] = [];
    const rungs: Array<{ mid: THREE.Vector3; rotY: number }> = [];
    for (let i = 0; i <= 32; i++) {
      const y = (i / 32) * 2.5 - 1.25;
      const a = (i / 32) * Math.PI * 3.8;
      const r = 0.22;
      const pA = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const pB = new THREE.Vector3(Math.cos(a + Math.PI) * r, y, Math.sin(a + Math.PI) * r);
      ptsA.push(pA);
      ptsB.push(pB);
      if (i % 3 === 0) {
        rungs.push({
          mid: new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5),
          rotY: -a,
        });
      }
    }

    return {
      aortaGeo: aorta,
      pulmonaryGeo: pulmonary,
      coronaryLeftGeo: corL,
      coronaryRightGeo: corR,
      superiorVenaGeo: vena,
      dnaStrandA: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsA), 40, 0.018, 8, false),
      dnaStrandB: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsB), 40, 0.018, 8, false),
      dnaRungs: rungs,
    };
  }, []);

  useEffect(() => {
    return () => {
      aortaGeo.dispose();
      pulmonaryGeo.dispose();
      coronaryLeftGeo.dispose();
      coronaryRightGeo.dispose();
      superiorVenaGeo.dispose();
      dnaStrandA.dispose();
      dnaStrandB.dispose();
    };
  }, [aortaGeo, pulmonaryGeo, coronaryLeftGeo, coronaryRightGeo, superiorVenaGeo, dnaStrandA, dnaStrandB]);

  useFrame(({ clock, pointer }) => {
    const t = clock.getElapsedTime();
    if (rootRef.current) {
      rootRef.current.rotation.y = Math.sin(t * 0.35) * 0.24 + pointer.x * 0.25;
      rootRef.current.rotation.x = pointer.y * 0.12;
    }
    if (heartRef.current) {
      // Realistic lub-dub double cardiac beat (~72 BPM)
      const phase = (t * 1.2) % 1;
      const lub = Math.exp(-Math.pow((phase - 0.16) * 14, 2)) * 0.065;
      const dub = Math.exp(-Math.pow((phase - 0.34) * 16, 2)) * 0.04;
      heartRef.current.scale.setScalar(1.0 + lub + dub);
    }
    if (dnaRef.current) {
      dnaRef.current.rotation.y = t * 0.55;
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.08, 0]}>
      {/* Sculpted Anatomical Heart */}
      <group ref={heartRef} position={[-0.35, 0.0, 0]}>
        {/* Left & Right Ventricular Mass */}
        <mesh position={[0.04, -0.22, 0.02]} rotation={[0.15, 0, -0.24]} scale={[0.92, 1.28, 0.85]}>
          <sphereGeometry args={[0.56, 32, 32]} />
          <meshPhysicalMaterial
            color="#e11d48"
            roughness={0.32}
            metalness={0.05}
            clearcoat={0.55}
            clearcoatRoughness={0.22}
          />
        </mesh>
        {/* Right Ventricle bulge */}
        <mesh position={[-0.24, -0.14, 0.12]} rotation={[0.1, 0.2, 0.18]} scale={[0.76, 1.05, 0.72]}>
          <sphereGeometry args={[0.45, 28, 28]} />
          <meshPhysicalMaterial color="#be123c" roughness={0.36} clearcoat={0.45} />
        </mesh>
        {/* Left Atrium */}
        <mesh position={[0.3, 0.28, -0.05]} scale={[0.9, 0.85, 0.8]}>
          <sphereGeometry args={[0.28, 24, 24]} />
          <meshPhysicalMaterial color="#f43f5e" roughness={0.35} clearcoat={0.4} />
        </mesh>
        {/* Right Atrium */}
        <mesh position={[-0.38, 0.24, 0.05]} scale={[0.88, 0.9, 0.8]}>
          <sphereGeometry args={[0.27, 24, 24]} />
          <meshPhysicalMaterial color="#9f1239" roughness={0.38} clearcoat={0.35} />
        </mesh>

        {/* Major Great Vessels */}
        <mesh geometry={aortaGeo}>
          <meshPhysicalMaterial color="#e11d48" roughness={0.3} clearcoat={0.5} />
        </mesh>
        <mesh geometry={pulmonaryGeo}>
          <meshPhysicalMaterial color="#0284c7" roughness={0.32} clearcoat={0.45} />
        </mesh>
        <mesh geometry={superiorVenaGeo}>
          <meshPhysicalMaterial color="#1d4ed8" roughness={0.35} clearcoat={0.4} />
        </mesh>

        {/* Surface Coronary Arteries */}
        <mesh geometry={coronaryLeftGeo}>
          <meshStandardMaterial color="#fda4af" emissive="#be123c" emissiveIntensity={0.25} roughness={0.3} />
        </mesh>
        <mesh geometry={coronaryRightGeo}>
          <meshStandardMaterial color="#fda4af" emissive="#be123c" emissiveIntensity={0.2} roughness={0.3} />
        </mesh>
      </group>

      {/* Flanking Medical DNA Helix */}
      <group ref={dnaRef} position={[1.18, 0.05, -0.15]} rotation={[0, 0, -0.12]}>
        <mesh geometry={dnaStrandA}>
          <meshStandardMaterial color="#0284c7" roughness={0.28} metalness={0.15} />
        </mesh>
        <mesh geometry={dnaStrandB}>
          <meshStandardMaterial color="#323a4d" roughness={0.28} metalness={0.2} />
        </mesh>
        {dnaRungs.map((r, i) => (
          <mesh key={i} position={r.mid} rotation={[0, r.rotY, Math.PI / 2]}>
            <cylinderGeometry args={[0.011, 0.011, 0.43, 8]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#66a9ec" : "#0ea5e9"} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function HeroMedicalHeartAndDna3D({ heightClass = "h-[380px]" }: { heightClass?: string }) {
  return (
    <MedicalViewportShell
      label="3D Biomedical Anatomy"
      sublabel="Cardiac Vascular System & Genomic Helix"
      heightClass={heightClass}
      fallbackText="Interactive 3D Cardiac & Genomic Anatomy visualization requires WebGL."
    >
      {(visible, dpr, reducedMotion, lowPower) => (
        <Canvas
          dpr={dpr}
          frameloop={visible && !reducedMotion ? "always" : "demand"}
          camera={{ position: [0.15, 0.25, 4.15], fov: 42 }}
          gl={{ antialias: !lowPower, alpha: true }}
        >
          <ambientLight intensity={0.85} />
          <directionalLight position={[4, 6, 5]} intensity={1.35} color="#ffffff" />
          <pointLight position={[-4, -2, 3]} intensity={0.8} color="#66a9ec" />
          <AnatomicalHeartAndDnaMesh />
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={0.65} enableDamping />
        </Canvas>
      )}
    </MedicalViewportShell>
  );
}

/* 2. SECTION 2 MODEL: Medical Record Archive Tablet + Stethoscope Cross + Live ECG Waveform */
function MedicalVaultRecordMesh() {
  const grpRef = useRef<THREE.Group>(null);
  const pulseDotRef = useRef<THREE.Mesh>(null);

  const ecgCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.78, -0.05, 0.1),
        new THREE.Vector3(-0.48, -0.05, 0.1),
        new THREE.Vector3(-0.36, 0.08, 0.1),
        new THREE.Vector3(-0.24, -0.06, 0.1),
        new THREE.Vector3(-0.14, -0.18, 0.1),
        new THREE.Vector3(-0.02, 0.48, 0.1),
        new THREE.Vector3(0.1, -0.28, 0.1),
        new THREE.Vector3(0.22, -0.05, 0.1),
        new THREE.Vector3(0.42, 0.1, 0.1),
        new THREE.Vector3(0.6, -0.05, 0.1),
        new THREE.Vector3(0.8, -0.05, 0.1),
      ]),
    []
  );

  const ecgGeo = useMemo(() => new THREE.TubeGeometry(ecgCurve, 56, 0.022, 8, false), [ecgCurve]);
  useEffect(() => () => ecgGeo.dispose(), [ecgGeo]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (grpRef.current) {
      grpRef.current.rotation.y = Math.sin(t * 0.4) * 0.25;
      grpRef.current.position.y = Math.sin(t * 0.9) * 0.05;
    }
    if (pulseDotRef.current) {
      pulseDotRef.current.position.copy(ecgCurve.getPointAt((t * 0.45) % 1));
    }
  });

  return (
    <group ref={grpRef}>
      {/* Layered Clinical Record Sheets */}
      <mesh position={[-0.14, 0.06, -0.18]} rotation={[0, 0.08, 0.05]}>
        <boxGeometry args={[1.55, 1.95, 0.05]} />
        <meshStandardMaterial color="#b7d4f2" roughness={0.4} />
      </mesh>
      <mesh position={[0.02, 0, 0]}>
        <boxGeometry args={[1.65, 2.05, 0.07]} />
        <meshPhysicalMaterial color="#f9fafb" roughness={0.22} clearcoat={0.45} />
      </mesh>
      {/* Top Medical Clipboard / Vault Header Bar */}
      <mesh position={[0.02, 0.88, 0.05]}>
        <boxGeometry args={[0.92, 0.22, 0.09]} />
        <meshStandardMaterial color="#323a4d" metalness={0.35} roughness={0.35} />
      </mesh>
      {/* Medical Cross Emblem */}
      <group position={[-0.5, 0.56, 0.07]}>
        <mesh>
          <boxGeometry args={[0.24, 0.08, 0.03]} />
          <meshStandardMaterial color="#e11d48" />
        </mesh>
        <mesh>
          <boxGeometry args={[0.08, 0.24, 0.03]} />
          <meshStandardMaterial color="#e11d48" />
        </mesh>
      </group>
      {/* ECG Telemetry Waveform */}
      <mesh geometry={ecgGeo}>
        <meshStandardMaterial color="#0284c7" emissive="#0369a1" emissiveIntensity={0.35} />
      </mesh>
      <mesh ref={pulseDotRef}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshBasicMaterial color="#e11d48" />
      </mesh>
      {/* Record Line Placeholders representing verified structured fields */}
      {[-0.45, -0.64, -0.83].map((yPos, i) => (
        <mesh key={i} position={[0.02, yPos, 0.05]}>
          <boxGeometry args={[1.15 - i * 0.18, 0.06, 0.02]} />
          <meshStandardMaterial color={i === 0 ? "#66a9ec" : "#94a3b8"} />
        </mesh>
      ))}
    </group>
  );
}

export function MedicalVaultRecords3D({ heightClass = "h-[340px]" }: { heightClass?: string }) {
  return (
    <MedicalViewportShell
      label="3D Medical Vault"
      sublabel="Structured Records, ECG Vitals & Chronology"
      heightClass={heightClass}
      fallbackText="3D Medical Record Vault preview requires WebGL."
    >
      {(visible, dpr, reducedMotion, lowPower) => (
        <Canvas
          dpr={dpr}
          frameloop={visible && !reducedMotion ? "always" : "demand"}
          camera={{ position: [0.3, 0.15, 3.6], fov: 42 }}
          gl={{ antialias: !lowPower, alpha: true }}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[4, 5, 4]} intensity={1.25} color="#ffffff" />
          <MedicalVaultRecordMesh />
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={0.65} enableDamping />
        </Canvas>
      )}
    </MedicalViewportShell>
  );
}

/* 3. SECTION 3 MODEL: Pharmaceutical Capsule & Active Bio-Molecule */
function MedicalCapsuleAndMoleculeMesh() {
  const grpRef = useRef<THREE.Group>(null);
  const capRef = useRef<THREE.Group>(null);
  const molRef = useRef<THREE.Group>(null);

  const atoms = useMemo(
    () => [
      { pos: [0, 0, 0] as [number, number, number], r: 0.18, color: "#323a4d" },
      { pos: [0.46, 0.28, 0.12] as [number, number, number], r: 0.14, color: "#0284c7" },
      { pos: [-0.48, 0.24, -0.1] as [number, number, number], r: 0.15, color: "#e11d48" },
      { pos: [0.38, -0.42, -0.18] as [number, number, number], r: 0.13, color: "#66a9ec" },
      { pos: [-0.36, -0.38, 0.28] as [number, number, number], r: 0.14, color: "#0d9488" },
      { pos: [0, 0.56, -0.25] as [number, number, number], r: 0.12, color: "#66a9ec" },
    ],
    []
  );

  const bondGeos = useMemo(() => {
    const center = new THREE.Vector3(0, 0, 0);
    return atoms.slice(1).map((a) => {
      const target = new THREE.Vector3(...a.pos);
      return new THREE.TubeGeometry(new THREE.LineCurve3(center, target), 4, 0.025, 8, false);
    });
  }, [atoms]);

  useEffect(() => () => bondGeos.forEach((g) => g.dispose()), [bondGeos]);

  useFrame(({ clock, pointer }) => {
    const t = clock.getElapsedTime();
    if (grpRef.current) {
      grpRef.current.rotation.y = pointer.x * 0.28;
      grpRef.current.rotation.x = pointer.y * 0.18;
    }
    if (capRef.current) {
      capRef.current.rotation.z = 0.55 + Math.sin(t * 0.7) * 0.12;
      capRef.current.rotation.y = t * 0.45;
      capRef.current.position.y = Math.sin(t * 1.1) * 0.08;
    }
    if (molRef.current) {
      molRef.current.rotation.y = -t * 0.35;
      molRef.current.rotation.x = Math.cos(t * 0.5) * 0.2;
    }
  });

  return (
    <group ref={grpRef}>
      {/* Two-Tone Medical Capsule */}
      <group ref={capRef} position={[-0.72, 0.05, 0.15]}>
        <mesh position={[0, 0.28, 0]}>
          <capsuleGeometry args={[0.28, 0.45, 16, 24]} />
          <meshPhysicalMaterial color="#0284c7" roughness={0.18} clearcoat={0.85} />
        </mesh>
        <mesh position={[0, -0.28, 0]}>
          <capsuleGeometry args={[0.275, 0.45, 16, 24]} />
          <meshPhysicalMaterial color="#f9fafb" roughness={0.18} clearcoat={0.85} />
        </mesh>
      </group>

      {/* Active Pharmaceutical Molecular Structure */}
      <group ref={molRef} position={[0.68, 0, -0.1]}>
        {atoms.map((a, idx) => (
          <mesh key={idx} position={a.pos}>
            <sphereGeometry args={[a.r, 24, 24]} />
            <meshPhysicalMaterial color={a.color} roughness={0.22} clearcoat={0.65} />
          </mesh>
        ))}
        {bondGeos.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshStandardMaterial color="#64748b" metalness={0.3} roughness={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function MedicalPharmacology3D({ heightClass = "h-[340px]" }: { heightClass?: string }) {
  return (
    <MedicalViewportShell
      label="3D Clinical Pharmacology"
      sublabel="Medication Capsule & Molecular Structure"
      heightClass={heightClass}
      fallbackText="3D Pharmacology & Molecular structure preview requires WebGL."
    >
      {(visible, dpr, reducedMotion, lowPower) => (
        <Canvas
          dpr={dpr}
          frameloop={visible && !reducedMotion ? "always" : "demand"}
          camera={{ position: [0, 0.2, 3.6], fov: 42 }}
          gl={{ antialias: !lowPower, alpha: true }}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[4, 6, 5]} intensity={1.3} color="#ffffff" />
          <pointLight position={[-3, -2, 3]} intensity={0.7} color="#66a9ec" />
          <MedicalCapsuleAndMoleculeMesh />
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={0.65} enableDamping />
        </Canvas>
      )}
    </MedicalViewportShell>
  );
}

/* 4. SECTION 6 MODEL: Medical Security Cross & Protective Shield */
function MedicalShieldMesh() {
  const ref = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const shieldShape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 1.05);
    s.lineTo(0.82, 0.72);
    s.quadraticCurveTo(0.82, -0.35, 0, -1.05);
    s.quadraticCurveTo(-0.82, -0.35, -0.82, 0.72);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 3,
    });
  }, []);

  useEffect(() => () => shieldShape.dispose(), [shieldShape]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) {
      ref.current.rotation.y = Math.sin(t * 0.45) * 0.35;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.3;
    }
  });

  return (
    <group ref={ref} position={[0, 0, 0]}>
      <mesh geometry={shieldShape} position={[0, 0, -0.07]}>
        <meshPhysicalMaterial
          color="#66a9ec"
          roughness={0.22}
          metalness={0.12}
          clearcoat={0.7}
          transparent
          opacity={0.78}
        />
      </mesh>
      {/* 3D Medical Cross anchored on the Shield */}
      <mesh position={[0, 0.08, 0.16]}>
        <boxGeometry args={[0.62, 0.2, 0.08]} />
        <meshStandardMaterial color="#323a4d" roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.08, 0.16]}>
        <boxGeometry args={[0.2, 0.62, 0.08]} />
        <meshStandardMaterial color="#323a4d" roughness={0.25} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[1.3, 0.018, 8, 72]} />
        <meshStandardMaterial color="#0284c7" />
      </mesh>
    </group>
  );
}

export function MedicalSecurityShield3D({ heightClass = "h-[320px]" }: { heightClass?: string }) {
  return (
    <MedicalViewportShell
      label="3D Privacy & Access Shield"
      sublabel="Patient-Controlled Encrypted Record Vault"
      heightClass={heightClass}
      fallbackText="3D Medical Privacy Shield preview requires WebGL."
    >
      {(visible, dpr, reducedMotion, lowPower) => (
        <Canvas
          dpr={dpr}
          frameloop={visible && !reducedMotion ? "always" : "demand"}
          camera={{ position: [0, 0.1, 3.6], fov: 42 }}
          gl={{ antialias: !lowPower, alpha: true }}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[4, 5, 5]} intensity={1.3} color="#ffffff" />
          <MedicalShieldMesh />
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={0.65} enableDamping />
        </Canvas>
      )}
    </MedicalViewportShell>
  );
}
