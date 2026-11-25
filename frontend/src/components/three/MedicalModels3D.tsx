import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneCapabilities, WebGLErrorBoundary } from "./useSceneCapabilities";

export type PageScrollRef = React.MutableRefObject<number>;

function smoothWeight(sp: number, center: number, halfSpan: number): number {
  const d = Math.abs(sp - center) / halfSpan;
  if (d >= 1) return 0;
  const t = 1 - d;
  return t * t * (3 - 2 * t);
}

function applyGroupFade(group: THREE.Group, weight: number) {
  group.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (m.userData.baseOpacity === undefined) {
        m.userData.baseOpacity = m.opacity;
      }
      m.opacity = (m.userData.baseOpacity as number) * weight;
      if (!m.transparent) m.transparent = true;
    }
  });
}

/* ============================================================================
 * 1. HERO MODEL: DETAILED HALF-BODY RESPIRATORY SYSTEM (HEAD/NECK -> DIAPHRAGM)
 * ============================================================================ */
function HalfBodyRespiratorySystem({
  spRef,
  isDesktopRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  isDesktopRef: React.MutableRefObject<boolean>;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const lungsExpandRef = useRef<THREE.Group>(null);
  const ribcageRef = useRef<THREE.Group>(null);
  const diaphragmRef = useRef<THREE.Mesh>(null);
  const flowDotsRef = useRef<THREE.Group>(null);

  const {
    torsoShellGeo,
    neckHeadGeo,
    tracheaGeo,
    larynxGeo,
    bronchialGeos,
    ribGeos,
    sternumGeo,
    clavicleGeos,
    spineGeos,
    alveoliPositions,
    flowCurves,
  } = useMemo(() => {
    // Half-body upper-torso contour clipping cleanly at the diaphragm/waist
    const torsoPts = [
      new THREE.Vector2(0.01, -1.08),
      new THREE.Vector2(0.84, -1.06),
      new THREE.Vector2(0.92, -0.75),
      new THREE.Vector2(1.06, -0.25),
      new THREE.Vector2(1.18, 0.25),
      new THREE.Vector2(1.24, 0.56),
      new THREE.Vector2(0.95, 0.72),
      new THREE.Vector2(0.32, 0.8),
      new THREE.Vector2(0.28, 1.08),
    ];
    const torsoGeo = new THREE.LatheGeometry(torsoPts, 36);

    const headPts = [
      new THREE.Vector2(0.26, 1.06),
      new THREE.Vector2(0.24, 1.24),
      new THREE.Vector2(0.36, 1.38),
      new THREE.Vector2(0.41, 1.62),
      new THREE.Vector2(0.36, 1.88),
      new THREE.Vector2(0.18, 2.02),
      new THREE.Vector2(0.01, 2.05),
    ];
    const headGeo = new THREE.LatheGeometry(headPts, 28);

    const trachea = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.48, 0.04),
        new THREE.Vector3(0, 1.02, 0.03),
        new THREE.Vector3(0, 0.42, 0.02),
        new THREE.Vector3(0, 0.16, 0.02),
      ]),
      32,
      0.068,
      14,
      false
    );

    const larynx = new THREE.CylinderGeometry(0.105, 0.085, 0.19, 16);

    const branches: Array<{ curve: THREE.CatmullRomCurve3; radius: number }> = [
      // Right Lung bronchial tree (3 lobes)
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.18, 0.02),
          new THREE.Vector3(-0.22, 0.04, 0.03),
          new THREE.Vector3(-0.46, -0.08, 0.02),
        ]),
        radius: 0.048,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.34, 0.0, 0.03),
          new THREE.Vector3(-0.56, 0.22, 0.05),
          new THREE.Vector3(-0.74, 0.36, -0.02),
        ]),
        radius: 0.028,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.46, -0.08, 0.02),
          new THREE.Vector3(-0.68, -0.14, 0.12),
          new THREE.Vector3(-0.84, -0.24, 0.08),
        ]),
        radius: 0.025,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.4, -0.04, 0.02),
          new THREE.Vector3(-0.52, -0.34, -0.04),
          new THREE.Vector3(-0.66, -0.62, 0.02),
        ]),
        radius: 0.027,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.56, 0.22, 0.05),
          new THREE.Vector3(-0.46, 0.44, 0.02),
        ]),
        radius: 0.018,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.52, -0.34, -0.04),
          new THREE.Vector3(-0.8, -0.5, -0.06),
        ]),
        radius: 0.017,
      },
      // Left Lung bronchial tree (2 lobes around cardiac notch)
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.18, 0.02),
          new THREE.Vector3(0.24, 0.03, 0.03),
          new THREE.Vector3(0.5, -0.06, 0.02),
        ]),
        radius: 0.045,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.38, -0.01, 0.03),
          new THREE.Vector3(0.58, 0.22, 0.04),
          new THREE.Vector3(0.74, 0.38, -0.02),
        ]),
        radius: 0.027,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.5, -0.06, 0.02),
          new THREE.Vector3(0.72, -0.18, 0.1),
          new THREE.Vector3(0.84, -0.32, 0.05),
        ]),
        radius: 0.024,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.45, -0.04, 0.02),
          new THREE.Vector3(0.58, -0.36, -0.04),
          new THREE.Vector3(0.7, -0.62, 0.02),
        ]),
        radius: 0.025,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.58, 0.22, 0.04),
          new THREE.Vector3(0.45, 0.43, 0.02),
        ]),
        radius: 0.018,
      },
    ];

    const bronGeos = branches.map((b) => new THREE.TubeGeometry(b.curve, 20, b.radius, 10, false));
    const alvPos = branches.slice(1).map((b) => b.curve.getPointAt(1));

    const fCurves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.04),
        new THREE.Vector3(0, 0.8, 0.03),
        new THREE.Vector3(0, 0.2, 0.02),
        new THREE.Vector3(-0.34, 0.0, 0.03),
        new THREE.Vector3(-0.68, -0.14, 0.12),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.04),
        new THREE.Vector3(0, 0.8, 0.03),
        new THREE.Vector3(0, 0.2, 0.02),
        new THREE.Vector3(0.38, -0.01, 0.03),
        new THREE.Vector3(0.72, -0.18, 0.1),
      ]),
    ];

    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const y = 0.48 - i * 0.155;
      const w = 0.72 + Math.sin((i / 7) * Math.PI * 0.88) * 0.34;
      const d = 0.42 + Math.sin((i / 7) * Math.PI * 0.85) * 0.16;
      const sternalGap = i < 5 ? 0.1 : 0.24 + (i - 5) * 0.14;
      for (const side of [-1, 1]) {
        const ribCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.1, y + 0.08, -d * 0.92),
          new THREE.Vector3(side * (w * 0.78), y + 0.04, -d * 0.55),
          new THREE.Vector3(side * w, y - 0.03, 0.02),
          new THREE.Vector3(side * (w * 0.68), y - 0.08, d * 0.74),
          new THREE.Vector3(side * sternalGap, y - 0.04, d * 0.88),
        ]);
        ribs.push(new THREE.TubeGeometry(ribCurve, 24, 0.017, 7, false));
      }
    }

    const sternum = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.56, 0.44),
        new THREE.Vector3(0, 0.24, 0.5),
        new THREE.Vector3(0, -0.22, 0.48),
      ]),
      14,
      0.042,
      8,
      false
    );

    const clavicles = [-1, 1].map((side) =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.08, 0.62, 0.41),
          new THREE.Vector3(side * 0.52, 0.7, 0.32),
          new THREE.Vector3(side * 1.04, 0.62, 0.06),
        ]),
        16,
        0.024,
        8,
        false
      )
    );

    const spineVerts = Array.from({ length: 11 }, (_, idx) => new THREE.Vector3(0, 0.78 - idx * 0.16, -0.44));

    return {
      torsoShellGeo: torsoGeo,
      neckHeadGeo: headGeo,
      tracheaGeo: trachea,
      larynxGeo: larynx,
      bronchialGeos: bronGeos,
      ribGeos: ribs,
      sternumGeo: sternum,
      clavicleGeos: clavicles,
      spineGeos: spineVerts,
      alveoliPositions: alvPos,
      flowCurves: fCurves,
    };
  }, []);

  useEffect(() => {
    return () => {
      torsoShellGeo.dispose();
      neckHeadGeo.dispose();
      tracheaGeo.dispose();
      larynxGeo.dispose();
      bronchialGeos.forEach((g) => g.dispose());
      ribGeos.forEach((g) => g.dispose());
      sternumGeo.dispose();
      clavicleGeos.forEach((g) => g.dispose());
    };
  }, [torsoShellGeo, neckHeadGeo, tracheaGeo, larynxGeo, bronchialGeos, ribGeos, sternumGeo, clavicleGeos]);

  useFrame(({ clock }) => {
    const grp = groupRef.current;
    if (!grp) return;
    const sp = spRef.current;
    const weight = smoothWeight(sp, 0.05, 0.18);
    grp.visible = weight > 0.015;
    if (!grp.visible) return;

    const t = clock.getElapsedTime();
    const isDesktop = isDesktopRef.current;
    const breathe = reducedMotion ? 0 : Math.sin(t * 1.45);
    const inhale = (breathe + 1) * 0.5;

    if (lungsExpandRef.current) {
      lungsExpandRef.current.scale.set(1 + inhale * 0.055, 1 + inhale * 0.04, 1 + inhale * 0.065);
    }
    if (ribcageRef.current) {
      ribcageRef.current.scale.set(1 + inhale * 0.035, 1 + inhale * 0.015, 1 + inhale * 0.04);
    }
    if (diaphragmRef.current) {
      diaphragmRef.current.position.y = -0.82 - inhale * 0.075;
    }

    if (flowDotsRef.current && !reducedMotion) {
      flowDotsRef.current.children.forEach((child, idx) => {
        const curve = flowCurves[idx % flowCurves.length];
        const phase = (t * 0.42 + idx * 0.16) % 1;
        child.position.copy(curve.getPointAt(phase));
        child.scale.setScalar(Math.max(0.25, Math.sin(phase * Math.PI) * 1.1));
      });
    }

    const slideProgress = THREE.MathUtils.clamp(sp / 0.2, 0, 1.5);
    const baseX = isDesktop ? 1.85 : 0.0;
    const baseY = isDesktop ? -0.18 : 0.12;
    grp.position.set(
      baseX - slideProgress * (isDesktop ? 0.95 : 0),
      baseY + (sp - 0.02) * 5.2,
      (1 - weight) * -4.2
    );
    grp.rotation.y = -0.26 + (reducedMotion ? 0 : Math.sin(t * 0.35) * 0.14) + sp * Math.PI * 2.4;
    grp.rotation.x = 0.05 + slideProgress * 0.22;
    grp.scale.setScalar((isDesktop ? 0.98 : 0.72) * (0.68 + 0.32 * weight));
    applyGroupFade(grp, weight);
  });

  const cartilageRingYs = [0.96, 0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32, 0.24];

  return (
    <group ref={groupRef} position={[1.85, -0.18, 0]}>
      <mesh geometry={torsoShellGeo} scale={[1, 1, 0.56]}>
        <meshPhysicalMaterial color="#66a9ec" roughness={0.2} metalness={0.05} transparent opacity={0.14} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={neckHeadGeo} scale={[1, 1, 0.82]}>
        <meshPhysicalMaterial color="#93c5fd" roughness={0.25} transparent opacity={0.13} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, -1.06, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.6, 1]}>
        <torusGeometry args={[0.85, 0.015, 10, 56]} />
        <meshStandardMaterial color="#0284c7" transparent opacity={0.62} />
      </mesh>
      <mesh position={[0, 1.54, 0.24]}>
        <sphereGeometry args={[0.05, 14, 14]} />
        <meshStandardMaterial color="#0284c7" emissive="#0ea5e9" emissiveIntensity={0.6} transparent opacity={0.78} />
      </mesh>

      <mesh geometry={larynxGeo} position={[0, 1.06, 0.03]}>
        <meshPhysicalMaterial color="#94a3b8" roughness={0.3} clearcoat={0.5} transparent opacity={0.86} />
      </mesh>
      <mesh geometry={tracheaGeo}>
        <meshPhysicalMaterial color="#cbd5e1" roughness={0.28} clearcoat={0.55} transparent opacity={0.84} />
      </mesh>
      {cartilageRingYs.map((ry) => (
        <mesh key={ry} position={[0, ry, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.075, 0.013, 8, 22]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.25} transparent opacity={0.94} />
        </mesh>
      ))}

      <group>
        {bronchialGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshPhysicalMaterial color={idx < 2 ? "#0ea5e9" : "#38bdf8"} emissive="#0284c7" emissiveIntensity={0.25} roughness={0.25} transparent opacity={0.9} />
          </mesh>
        ))}
        {alveoliPositions.map((pos, idx) => (
          <group key={idx} position={pos}>
            <mesh>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshStandardMaterial color="#0284c7" emissive="#38bdf8" emissiveIntensity={0.45} transparent opacity={0.88} />
            </mesh>
            <mesh position={[0.04, -0.03, 0.02]}>
              <sphereGeometry args={[0.032, 10, 10]} />
              <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.4} transparent opacity={0.82} />
            </mesh>
          </group>
        ))}
      </group>

      <group ref={lungsExpandRef}>
        <mesh position={[-0.54, 0.24, 0.02]} rotation={[0.05, 0, -0.2]} scale={[0.42, 0.5, 0.38]}>
          <sphereGeometry args={[0.78, 28, 28]} />
          <meshPhysicalMaterial color="#fb7185" roughness={0.28} clearcoat={0.65} transparent opacity={0.48} depthWrite={false} />
        </mesh>
        <mesh position={[-0.64, -0.14, 0.08]} rotation={[0.1, 0, -0.1]} scale={[0.44, 0.42, 0.4]}>
          <sphereGeometry args={[0.76, 26, 26]} />
          <meshPhysicalMaterial color="#f43f5e" roughness={0.3} clearcoat={0.6} transparent opacity={0.48} depthWrite={false} />
        </mesh>
        <mesh position={[-0.6, -0.48, -0.04]} rotation={[-0.08, 0, -0.12]} scale={[0.48, 0.42, 0.42]}>
          <sphereGeometry args={[0.78, 26, 26]} />
          <meshPhysicalMaterial color="#e11d48" roughness={0.32} clearcoat={0.55} transparent opacity={0.45} depthWrite={false} />
        </mesh>

        <mesh position={[0.56, 0.22, 0.02]} rotation={[0.05, 0, 0.22]} scale={[0.4, 0.5, 0.38]}>
          <sphereGeometry args={[0.76, 28, 28]} />
          <meshPhysicalMaterial color="#fb7185" roughness={0.28} clearcoat={0.65} transparent opacity={0.48} depthWrite={false} />
        </mesh>
        <mesh position={[0.64, -0.36, 0.01]} rotation={[-0.06, 0, 0.14]} scale={[0.46, 0.54, 0.42]}>
          <sphereGeometry args={[0.76, 26, 26]} />
          <meshPhysicalMaterial color="#e11d48" roughness={0.32} clearcoat={0.58} transparent opacity={0.45} depthWrite={false} />
        </mesh>

        <mesh position={[0.18, -0.22, 0.12]} rotation={[0.1, 0, -0.28]} scale={[0.85, 1.1, 0.8]}>
          <sphereGeometry args={[0.2, 20, 20]} />
          <meshPhysicalMaterial color="#be123c" roughness={0.25} clearcoat={0.7} transparent opacity={0.85} />
        </mesh>
      </group>

      <group ref={ribcageRef}>
        {ribGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshStandardMaterial color="#e2e8f0" roughness={0.32} metalness={0.12} transparent opacity={0.74} />
          </mesh>
        ))}
        <mesh geometry={sternumGeo}>
          <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.15} transparent opacity={0.8} />
        </mesh>
        {clavicleGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshStandardMaterial color="#f1f5f9" roughness={0.28} transparent opacity={0.84} />
          </mesh>
        ))}
        {spineGeos.map((pos, idx) => (
          <mesh key={idx} position={pos}>
            <cylinderGeometry args={[0.065, 0.068, 0.11, 12]} />
            <meshStandardMaterial color="#94a3b8" roughness={0.4} transparent opacity={0.64} />
          </mesh>
        ))}
      </group>

      <mesh ref={diaphragmRef} position={[0, -0.82, 0.02]} scale={[0.92, 0.28, 0.48]}>
        <sphereGeometry args={[0.88, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshPhysicalMaterial color="#be123c" roughness={0.35} clearcoat={0.4} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>

      <group ref={flowDotsRef}>
        {Array.from({ length: 8 }).map((_, idx) => (
          <mesh key={idx}>
            <sphereGeometry args={[0.028, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ============================================================================
 * 2. MEDICAL VAULT MODEL: FANNED GLASS CLINICAL DOSSIER + BIOMARKERS + ECG
 * ============================================================================ */
function DetailedVaultModel({
  spRef,
  isDesktopRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  isDesktopRef: React.MutableRefObject<boolean>;
  reducedMotion: boolean;
}) {
  const grpRef = useRef<THREE.Group>(null);
  const backSheetRef = useRef<THREE.Mesh>(null);
  const midSheetRef = useRef<THREE.Mesh>(null);
  const pulseDotRef = useRef<THREE.Mesh>(null);

  const ecgCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.78, -0.02, 0.12),
        new THREE.Vector3(-0.48, -0.02, 0.12),
        new THREE.Vector3(-0.36, 0.11, 0.12),
        new THREE.Vector3(-0.24, -0.05, 0.12),
        new THREE.Vector3(-0.14, -0.2, 0.12),
        new THREE.Vector3(-0.02, 0.54, 0.12),
        new THREE.Vector3(0.11, -0.3, 0.12),
        new THREE.Vector3(0.24, -0.02, 0.12),
        new THREE.Vector3(0.45, 0.14, 0.12),
        new THREE.Vector3(0.64, -0.02, 0.12),
        new THREE.Vector3(0.82, -0.02, 0.12),
      ]),
    []
  );
  const ecgGeo = useMemo(() => new THREE.TubeGeometry(ecgCurve, 64, 0.024, 8, false), [ecgCurve]);
  useEffect(() => () => ecgGeo.dispose(), [ecgGeo]);

  useFrame(({ clock }) => {
    const grp = grpRef.current;
    if (!grp) return;
    const sp = spRef.current;
    const weight = smoothWeight(sp, 0.25, 0.16);
    grp.visible = weight > 0.015;
    if (!grp.visible) return;

    const t = clock.getElapsedTime();
    const isDesktop = isDesktopRef.current;
    const local = THREE.MathUtils.clamp((sp - 0.12) / 0.26, 0, 1);
    const fan = Math.sin(local * Math.PI);

    const baseX = isDesktop ? -1.78 : 0.0;
    grp.position.set(
      baseX + (1 - weight) * (isDesktop ? -0.85 : 0),
      (0.25 - sp) * 6.0,
      (1 - weight) * -4.5
    );
    grp.rotation.y = 0.24 + (sp - 0.25) * 3.0 + (reducedMotion ? 0 : Math.sin(t * 0.45) * 0.12);
    grp.rotation.x = (sp - 0.25) * 0.4;
    grp.scale.setScalar((isDesktop ? 0.94 : 0.72) * (0.65 + 0.35 * weight));

    if (backSheetRef.current) {
      backSheetRef.current.position.set(-0.18 - fan * 0.52, 0.08 + fan * 0.16, -0.22 - fan * 0.25);
      backSheetRef.current.rotation.z = 0.07 + fan * 0.18;
    }
    if (midSheetRef.current) {
      midSheetRef.current.position.set(0.14 + fan * 0.46, -0.05 - fan * 0.1, -0.12);
      midSheetRef.current.rotation.z = -0.05 - fan * 0.15;
    }
    if (pulseDotRef.current && !reducedMotion) {
      pulseDotRef.current.position.copy(ecgCurve.getPointAt((t * 0.48) % 1));
    }
    applyGroupFade(grp, weight);
  });

  const barHeights = [0.32, 0.52, 0.4, 0.62, 0.46];

  return (
    <group ref={grpRef} visible={false}>
      <mesh ref={backSheetRef} position={[-0.18, 0.08, -0.22]} rotation={[0, 0.08, 0.07]}>
        <boxGeometry args={[1.62, 2.05, 0.05]} />
        <meshStandardMaterial color="#b7d4f2" roughness={0.35} transparent opacity={0.88} />
      </mesh>
      <mesh ref={midSheetRef} position={[0.14, -0.05, -0.12]} rotation={[0, -0.06, -0.05]}>
        <boxGeometry args={[1.62, 2.05, 0.05]} />
        <meshStandardMaterial color="#93c5fd" roughness={0.32} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.74, 2.15, 0.08]} />
        <meshPhysicalMaterial color="#f9fafb" roughness={0.18} clearcoat={0.55} transparent opacity={0.96} />
      </mesh>
      <mesh position={[0, 0.94, 0.06]}>
        <boxGeometry args={[0.96, 0.22, 0.1]} />
        <meshStandardMaterial color="#323a4d" metalness={0.45} roughness={0.28} transparent opacity={1} />
      </mesh>
      <group position={[-0.55, 0.6, 0.07]}>
        <mesh>
          <boxGeometry args={[0.28, 0.09, 0.035]} />
          <meshStandardMaterial color="#e11d48" transparent opacity={1} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.09, 0.28, 0.035]} />
          <meshStandardMaterial color="#e11d48" transparent opacity={1} />
        </mesh>
      </group>
      <mesh position={[0.48, 0.6, 0.07]}>
        <torusGeometry args={[0.13, 0.025, 10, 28]} />
        <meshStandardMaterial color="#0284c7" transparent opacity={1} />
      </mesh>
      <mesh geometry={ecgGeo}>
        <meshStandardMaterial color="#0284c7" emissive="#0ea5e9" emissiveIntensity={0.4} transparent opacity={1} />
      </mesh>
      <mesh ref={pulseDotRef} position={[0, 0.1, 0.12]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshBasicMaterial color="#e11d48" transparent opacity={1} />
      </mesh>
      {barHeights.map((h, i) => (
        <mesh key={i} position={[-0.44 + i * 0.22, -0.78 + h * 0.35, 0.06]}>
          <boxGeometry args={[0.12, h * 0.7, 0.04]} />
          <meshStandardMaterial color={i === 3 ? "#0284c7" : "#66a9ec"} transparent opacity={1} />
        </mesh>
      ))}
    </group>
  );
}

/* ============================================================================
 * 3. PHARMACOLOGY MODEL: OPENING CAPSULE + MICRO-GRANULES + AROMATIC MOLECULE + DNA
 * ============================================================================ */
function DetailedPharmacologyModel({
  spRef,
  isDesktopRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  isDesktopRef: React.MutableRefObject<boolean>;
  reducedMotion: boolean;
}) {
  const grpRef = useRef<THREE.Group>(null);
  const capRef = useRef<THREE.Group>(null);
  const capTopRef = useRef<THREE.Mesh>(null);
  const capBotRef = useRef<THREE.Mesh>(null);
  const molRef = useRef<THREE.Group>(null);
  const dnaRef = useRef<THREE.Group>(null);

  const { atoms, bondGeos, granules, dnaStrandA, dnaStrandB, dnaRungs } = useMemo(() => {
    const ringAtoms = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return {
        pos: [Math.cos(a) * 0.42, Math.sin(a) * 0.42, i % 2 === 0 ? 0.06 : -0.06] as [number, number, number],
        r: i % 3 === 0 ? 0.14 : 0.11,
        color: i === 0 ? "#0284c7" : i === 3 ? "#e11d48" : "#323a4d",
      };
    });
    const extraAtoms = [
      { pos: [0.82, 0.25, 0.16] as [number, number, number], r: 0.12, color: "#0d9488" },
      { pos: [-0.82, -0.22, -0.14] as [number, number, number], r: 0.13, color: "#66a9ec" },
      { pos: [0.0, 0.82, 0.18] as [number, number, number], r: 0.1, color: "#e11d48" },
    ];
    const allAtoms = [...ringAtoms, ...extraAtoms];

    const pairs: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
      [0, 6], [3, 7], [1, 8],
    ];
    const bGeos = pairs.map(([a, b]) =>
      new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(...allAtoms[a].pos), new THREE.Vector3(...allAtoms[b].pos)),
        4,
        0.024,
        8,
        false
      )
    );

    const gran = Array.from({ length: 12 }, (_, i) => ({
      offset: [
        Math.cos(i * 1.4) * 0.16,
        ((i % 5) - 2) * 0.08,
        Math.sin(i * 1.9) * 0.16,
      ] as [number, number, number],
      r: 0.045 + (i % 3) * 0.012,
      color: i % 3 === 0 ? "#0284c7" : i % 3 === 1 ? "#e11d48" : "#38bdf8",
    }));

    const ptsA: THREE.Vector3[] = [];
    const ptsB: THREE.Vector3[] = [];
    const rungs: Array<{ mid: THREE.Vector3; rotY: number }> = [];
    for (let i = 0; i <= 26; i++) {
      const y = (i / 26) * 2.2 - 1.1;
      const a = (i / 26) * Math.PI * 3.4;
      const r = 0.2;
      const pA = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const pB = new THREE.Vector3(Math.cos(a + Math.PI) * r, y, Math.sin(a + Math.PI) * r);
      ptsA.push(pA);
      ptsB.push(pB);
      if (i % 3 === 0) {
        rungs.push({ mid: new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5), rotY: -a });
      }
    }

    return {
      atoms: allAtoms,
      bondGeos: bGeos,
      granules: gran,
      dnaStrandA: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsA), 34, 0.018, 8, false),
      dnaStrandB: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsB), 34, 0.018, 8, false),
      dnaRungs: rungs,
    };
  }, []);

  useEffect(() => {
    return () => {
      bondGeos.forEach((g) => g.dispose());
      dnaStrandA.dispose();
      dnaStrandB.dispose();
    };
  }, [bondGeos, dnaStrandA, dnaStrandB]);

  useFrame(({ clock }) => {
    const grp = grpRef.current;
    if (!grp) return;
    const sp = spRef.current;
    const weight = smoothWeight(sp, 0.45, 0.16);
    grp.visible = weight > 0.015;
    if (!grp.visible) return;

    const t = clock.getElapsedTime();
    const isDesktop = isDesktopRef.current;
    const local = THREE.MathUtils.clamp((sp - 0.32) / 0.25, 0, 1);
    const open = Math.sin(local * Math.PI) * 0.24;

    const baseX = isDesktop ? 1.75 : 0.0;
    grp.position.set(
      baseX + (1 - weight) * (isDesktop ? 0.85 : 0),
      (0.45 - sp) * 6.0,
      (1 - weight) * -4.5
    );
    grp.rotation.y = (sp - 0.45) * 2.6;
    grp.scale.setScalar((isDesktop ? 0.96 : 0.7) * (0.65 + 0.35 * weight));

    if (capRef.current) {
      capRef.current.rotation.z = 0.48 + local * 0.4;
      capRef.current.rotation.y = reducedMotion ? 0 : t * 0.55;
    }
    if (capTopRef.current && capBotRef.current) {
      capTopRef.current.position.y = 0.27 + open;
      capBotRef.current.position.y = -0.27 - open;
    }
    if (molRef.current && !reducedMotion) {
      molRef.current.rotation.y = -t * 0.45;
      molRef.current.rotation.x = Math.sin(t * 0.6) * 0.25;
    }
    if (dnaRef.current && !reducedMotion) {
      dnaRef.current.rotation.y = t * 0.6;
    }
    applyGroupFade(grp, weight);
  });

  return (
    <group ref={grpRef} visible={false}>
      <group ref={capRef} position={[-0.78, 0.05, 0.18]}>
        <mesh ref={capTopRef} position={[0, 0.27, 0]}>
          <capsuleGeometry args={[0.26, 0.42, 16, 24]} />
          <meshPhysicalMaterial color="#0284c7" roughness={0.16} clearcoat={0.85} transparent opacity={1} />
        </mesh>
        <mesh ref={capBotRef} position={[0, -0.27, 0]}>
          <capsuleGeometry args={[0.255, 0.42, 16, 24]} />
          <meshPhysicalMaterial color="#f9fafb" roughness={0.18} clearcoat={0.85} transparent opacity={1} />
        </mesh>
        {granules.map((g, i) => (
          <mesh key={i} position={g.offset}>
            <sphereGeometry args={[g.r, 12, 12]} />
            <meshPhysicalMaterial color={g.color} roughness={0.2} clearcoat={0.6} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      <group ref={molRef} position={[0.42, 0.15, 0]}>
        {atoms.map((a, idx) => (
          <mesh key={idx} position={a.pos}>
            <sphereGeometry args={[a.r, 20, 20]} />
            <meshPhysicalMaterial color={a.color} roughness={0.22} clearcoat={0.7} transparent opacity={1} />
          </mesh>
        ))}
        {bondGeos.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshStandardMaterial color="#64748b" metalness={0.35} roughness={0.35} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      <group ref={dnaRef} position={[1.18, -0.05, -0.22]} rotation={[0, 0, -0.14]}>
        <mesh geometry={dnaStrandA}>
          <meshStandardMaterial color="#0284c7" roughness={0.25} transparent opacity={0.92} />
        </mesh>
        <mesh geometry={dnaStrandB}>
          <meshStandardMaterial color="#323a4d" roughness={0.25} transparent opacity={0.92} />
        </mesh>
        {dnaRungs.map((r, i) => (
          <mesh key={i} position={r.mid} rotation={[0, r.rotY, Math.PI / 2]}>
            <cylinderGeometry args={[0.011, 0.011, 0.4, 8]} />
            <meshStandardMaterial color="#66a9ec" transparent opacity={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ============================================================================
 * 4. OUTBREAK GLOBE MODEL: TECTONIC DOT MATRIX + HOTSPOT BEACONS + SATELLITES
 * ============================================================================ */
function DetailedParallaxGlobeModel({
  spRef,
  isDesktopRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  isDesktopRef: React.MutableRefObject<boolean>;
  reducedMotion: boolean;
}) {
  const grpRef = useRef<THREE.Group>(null);
  const globeSpinRef = useRef<THREE.Group>(null);
  const satRingRef = useRef<THREE.Group>(null);
  const radius = 1.42;

  const { dotGeo, arcGeos, beacons } = useMemo(() => {
    const dotPositions: number[] = [];
    const total = 650;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < total; i++) {
      const y = 1 - (i / (total - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const mask = Math.sin(x * 3.1 + 0.5) * Math.cos(y * 3.4 - 0.3) + Math.sin(z * 2.8 - x * 1.7);
      if (mask > 0.12) {
        dotPositions.push(x * (radius + 0.025), y * (radius + 0.025), z * (radius + 0.025));
      }
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));

    const beaconCoords = [
      { lat: 20.5, lng: 78.9, color: "#0284c7" },
      { lat: 28.6, lng: 77.2, color: "#f59e0b" },
      { lat: 19.0, lng: 72.8, color: "#f97316" },
      { lat: 51.5, lng: -0.1, color: "#10b981" },
      { lat: 35.6, lng: 139.7, color: "#38bdf8" },
      { lat: 40.7, lng: -74.0, color: "#66a9ec" },
    ];
    const pts = beaconCoords.map((b) => {
      const phi = (90 - b.lat) * (Math.PI / 180);
      const theta = (b.lng + 180) * (Math.PI / 180);
      const pos = new THREE.Vector3(
        -(radius + 0.04) * Math.sin(phi) * Math.cos(theta),
        (radius + 0.04) * Math.cos(phi),
        (radius + 0.04) * Math.sin(phi) * Math.sin(theta)
      );
      return { ...b, pos };
    });

    const arcs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = new THREE.Vector3().addVectors(pts[i].pos, pts[i + 1].pos).multiplyScalar(0.5).normalize().multiplyScalar(radius + 0.36);
      arcs.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pts[i].pos, mid, pts[i + 1].pos), 24, 0.011, 6, false));
    }

    return { dotGeo: pointsGeo, arcGeos: arcs, beacons: pts };
  }, []);

  useEffect(() => {
    return () => {
      dotGeo.dispose();
      arcGeos.forEach((g) => g.dispose());
    };
  }, [dotGeo, arcGeos]);

  useFrame(({ clock }) => {
    const grp = grpRef.current;
    if (!grp) return;
    const sp = spRef.current;
    const weight = smoothWeight(sp, 0.64, 0.16);
    grp.visible = weight > 0.015;
    if (!grp.visible) return;

    const t = clock.getElapsedTime();
    const isDesktop = isDesktopRef.current;
    const baseX = isDesktop ? -1.65 : 0.0;
    grp.position.set(
      baseX + (1 - weight) * (isDesktop ? -0.9 : 0),
      (0.64 - sp) * 6.0,
      (1 - weight) * -4.5
    );
    grp.scale.setScalar((isDesktop ? 0.96 : 0.72) * (0.65 + 0.35 * weight));

    if (globeSpinRef.current) {
      globeSpinRef.current.rotation.y = -1.4 + sp * Math.PI * 3.2 + (reducedMotion ? 0 : t * 0.18);
      globeSpinRef.current.rotation.x = 0.28 + (sp - 0.64) * 0.6;
    }
    if (satRingRef.current && !reducedMotion) {
      satRingRef.current.rotation.z = t * 0.45;
    }
    applyGroupFade(grp, weight);
  });

  return (
    <group ref={grpRef} visible={false}>
      <group ref={globeSpinRef}>
        <mesh>
          <sphereGeometry args={[radius - 0.02, 36, 36]} />
          <meshStandardMaterial color="#1e293b" roughness={0.5} transparent opacity={0.94} />
        </mesh>
        <mesh>
          <sphereGeometry args={[radius, 28, 28]} />
          <meshBasicMaterial color="#66a9ec" wireframe transparent opacity={0.36} />
        </mesh>
        <points geometry={dotGeo}>
          <pointsMaterial color="#7dd3fc" size={0.042} sizeAttenuation transparent opacity={0.94} />
        </points>
        {arcGeos.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.75} />
          </mesh>
        ))}
        {beacons.map((b, i) => (
          <mesh key={i} position={b.pos}>
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshBasicMaterial color={b.color} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      <group ref={satRingRef} rotation={[Math.PI / 2.4, 0.25, 0]}>
        <mesh>
          <torusGeometry args={[radius + 0.34, 0.012, 8, 90]} />
          <meshBasicMaterial color="#323a4d" transparent opacity={0.48} />
        </mesh>
        <mesh position={[radius + 0.34, 0, 0]}>
          <octahedronGeometry args={[0.065, 0]} />
          <meshStandardMaterial color="#0284c7" transparent opacity={1} />
        </mesh>
        <mesh position={[-(radius + 0.34), 0, 0]}>
          <octahedronGeometry args={[0.065, 0]} />
          <meshStandardMaterial color="#e11d48" transparent opacity={1} />
        </mesh>
      </group>
    </group>
  );
}

/* ============================================================================
 * 5. SECURITY MODEL: BEVELED GLASS SHIELD + GYROSCOPIC LOCK RINGS + KEY NODES
 * ============================================================================ */
function DetailedSecurityShieldModel({
  spRef,
  isDesktopRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  isDesktopRef: React.MutableRefObject<boolean>;
  reducedMotion: boolean;
}) {
  const grpRef = useRef<THREE.Group>(null);
  const outerRingRef = useRef<THREE.Group>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);

  const shieldGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 1.15);
    s.lineTo(0.88, 0.78);
    s.quadraticCurveTo(0.88, -0.38, 0, -1.15);
    s.quadraticCurveTo(-0.88, -0.38, -0.88, 0.78);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.045,
      bevelSegments: 3,
    });
  }, []);

  useEffect(() => () => shieldGeo.dispose(), [shieldGeo]);

  useFrame(({ clock }) => {
    const grp = grpRef.current;
    if (!grp) return;
    const sp = spRef.current;
    const weight = smoothWeight(sp, 0.92, 0.18);
    grp.visible = weight > 0.015;
    if (!grp.visible) return;

    const t = clock.getElapsedTime();
    const isDesktop = isDesktopRef.current;
    const baseX = isDesktop ? 1.8 : 0.0;
    grp.position.set(
      baseX + (1 - weight) * (isDesktop ? 0.85 : 0),
      (0.92 - sp) * 5.0,
      (1 - weight) * -4.2
    );
    grp.rotation.y = (sp - 0.92) * 2.4 + (reducedMotion ? 0 : Math.sin(t * 0.5) * 0.18);
    grp.scale.setScalar((isDesktop ? 0.94 : 0.7) * (0.65 + 0.35 * weight));

    if (outerRingRef.current && !reducedMotion) {
      outerRingRef.current.rotation.z = t * 0.4;
      outerRingRef.current.rotation.x = Math.PI / 2.2 + Math.sin(t * 0.4) * 0.2;
    }
    if (innerRingRef.current && !reducedMotion) {
      innerRingRef.current.rotation.z = -t * 0.55;
      innerRingRef.current.rotation.y = t * 0.35;
    }
    applyGroupFade(grp, weight);
  });

  return (
    <group ref={grpRef} visible={false}>
      <mesh geometry={shieldGeo} position={[0, 0, -0.14]} scale={[0.92, 0.92, 0.5]}>
        <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.45} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={shieldGeo} position={[0, 0, -0.04]}>
        <meshPhysicalMaterial color="#66a9ec" roughness={0.18} metalness={0.1} clearcoat={0.75} transparent opacity={0.74} />
      </mesh>
      <mesh position={[0, 0.1, 0.16]}>
        <boxGeometry args={[0.66, 0.2, 0.08]} />
        <meshStandardMaterial color="#323a4d" roughness={0.25} transparent opacity={1} />
      </mesh>
      <mesh position={[0, 0.1, 0.16]}>
        <boxGeometry args={[0.2, 0.66, 0.08]} />
        <meshStandardMaterial color="#323a4d" roughness={0.25} transparent opacity={1} />
      </mesh>
      <group ref={outerRingRef}>
        <mesh>
          <torusGeometry args={[1.38, 0.018, 8, 72]} />
          <meshStandardMaterial color="#0284c7" transparent opacity={0.85} />
        </mesh>
        {[0, 1, 2, 3].map((k) => {
          const angle = (k / 4) * Math.PI * 2;
          return (
            <mesh key={k} position={[Math.cos(angle) * 1.38, Math.sin(angle) * 1.38, 0]}>
              <octahedronGeometry args={[0.065, 0]} />
              <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.35} transparent opacity={1} />
            </mesh>
          );
        })}
      </group>
      <mesh ref={innerRingRef}>
        <torusGeometry args={[1.15, 0.012, 8, 64]} />
        <meshStandardMaterial color="#323a4d" transparent opacity={0.68} />
      </mesh>
    </group>
  );
}

/* ============================================================================
 * FLOATING AMBIENT BIOMEDICAL PARTICLES (BACKGROUND DEPTH)
 * ============================================================================ */
function AmbientBioParticles({
  spRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const ptsRef = useRef<THREE.Points>(null);

  const geo = useMemo(() => {
    const count = 95;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233) * 24634.6345;
      const s3 = Math.sin(i * 39.425) * 15973.1234;
      pos[i * 3] = (s1 - Math.floor(s1) - 0.5) * 11.5;
      pos[i * 3 + 1] = (s2 - Math.floor(s2) - 0.5) * 8.0;
      pos[i * 3 + 2] = -2.2 - (s3 - Math.floor(s3)) * 5.0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useEffect(() => () => geo.dispose(), [geo]);

  useFrame(({ clock }) => {
    if (!ptsRef.current) return;
    const t = clock.getElapsedTime();
    const sp = spRef.current;
    ptsRef.current.rotation.y = sp * Math.PI * 0.65 + (reducedMotion ? 0 : t * 0.02);
    ptsRef.current.position.y = (sp - 0.5) * 1.8;
  });

  return (
    <points ref={ptsRef} geometry={geo}>
      <pointsMaterial color="#0284c7" size={0.055} sizeAttenuation transparent opacity={0.35} />
    </points>
  );
}

/* ============================================================================
 * UNIFIED FULL-VIEWPORT BORDERLESS PARALLAX STAGE
 * ============================================================================ */
function ParallaxChoreography({
  scrollProgressRef,
  pointerRef,
  reducedMotion,
}: {
  scrollProgressRef: PageScrollRef;
  pointerRef: React.MutableRefObject<{ x: number; y: number }>;
  reducedMotion: boolean;
}) {
  const { viewport, camera } = useThree();
  const isDesktopRef = useRef(viewport.width >= 5.6);
  const smoothedSpRef = useRef(0);
  const smoothedPtrRef = useRef({ x: 0, y: 0 });

  useFrame(() => {
    isDesktopRef.current = viewport.width >= 5.6;
    const targetSp = THREE.MathUtils.clamp(scrollProgressRef.current ?? 0, 0, 1);
    smoothedSpRef.current = THREE.MathUtils.lerp(smoothedSpRef.current, targetSp, 0.12);

    smoothedPtrRef.current.x = THREE.MathUtils.lerp(smoothedPtrRef.current.x, pointerRef.current.x, 0.06);
    smoothedPtrRef.current.y = THREE.MathUtils.lerp(smoothedPtrRef.current.y, pointerRef.current.y, 0.06);

    camera.position.x = smoothedPtrRef.current.x * 0.38;
    camera.position.y = 0.12 - smoothedPtrRef.current.y * 0.22;
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <AmbientBioParticles spRef={smoothedSpRef} reducedMotion={reducedMotion} />
      <HalfBodyRespiratorySystem spRef={smoothedSpRef} isDesktopRef={isDesktopRef} reducedMotion={reducedMotion} />
      <DetailedVaultModel spRef={smoothedSpRef} isDesktopRef={isDesktopRef} reducedMotion={reducedMotion} />
      <DetailedPharmacologyModel spRef={smoothedSpRef} isDesktopRef={isDesktopRef} reducedMotion={reducedMotion} />
      <DetailedParallaxGlobeModel spRef={smoothedSpRef} isDesktopRef={isDesktopRef} reducedMotion={reducedMotion} />
      <DetailedSecurityShieldModel spRef={smoothedSpRef} isDesktopRef={isDesktopRef} reducedMotion={reducedMotion} />
    </>
  );
}

export function LandingParallaxStage3D({
  scrollProgressRef,
}: {
  scrollProgressRef: PageScrollRef;
}) {
  const caps = useSceneCapabilities();
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      pointerRef.current.y = (e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  if (!caps.hasWebGL) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      <WebGLErrorBoundary fallback={null}>
        <Canvas
          dpr={caps.dpr}
          frameloop="always"
          camera={{ position: [0, 0.12, 6.2], fov: 40 }}
          gl={{ antialias: !caps.isLowPower, alpha: true }}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[5, 7, 6]} intensity={1.35} color="#ffffff" />
          <pointLight position={[-5, -2, 4]} intensity={0.85} color="#66a9ec" />
          <pointLight position={[3, -4, 3]} intensity={0.55} color="#38bdf8" />
          <ParallaxChoreography
            scrollProgressRef={scrollProgressRef}
            pointerRef={pointerRef}
            reducedMotion={caps.reducedMotion}
          />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
