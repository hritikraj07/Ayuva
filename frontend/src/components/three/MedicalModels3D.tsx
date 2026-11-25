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
 * 1. HERO MODEL: STUDIO GLOSSY ANATOMICAL HEART & CORONARY VASCULATURE
 * ============================================================================ */
function createMyocardiumTextures(): { colorMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 256;
  const colCanvas = document.createElement("canvas");
  colCanvas.width = size;
  colCanvas.height = size;
  const cCtx = colCanvas.getContext("2d");

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext("2d");

  if (cCtx && bCtx) {
    // Rich studio coral-crimson myocardium base
    const baseGrad = cCtx.createLinearGradient(0, 0, size, size);
    baseGrad.addColorStop(0, "#f24854");
    baseGrad.addColorStop(0.55, "#e02438");
    baseGrad.addColorStop(1, "#c41628");
    cCtx.fillStyle = baseGrad;
    cCtx.fillRect(0, 0, size, size);

    bCtx.fillStyle = "#888888";
    bCtx.fillRect(0, 0, size, size);

    // Soft organic epicardial warmth & velvet mottling
    for (let i = 0; i < 160; i++) {
      const s1 = Math.sin(i * 17.31) * 43758.5453;
      const s2 = Math.sin(i * 63.89) * 24634.6345;
      const s3 = Math.sin(i * 39.47) * 19283.4123;
      const x = (s1 - Math.floor(s1)) * size;
      const y = (s2 - Math.floor(s2)) * size;
      const r = 10 + (s3 - Math.floor(s3)) * 22;

      const grad = cCtx.createRadialGradient(x, y, 1, x, y, r);
      const warm = i % 2 === 0;
      grad.addColorStop(0, warm ? "rgba(255, 130, 140, 0.22)" : "rgba(155, 18, 32, 0.18)");
      grad.addColorStop(1, "rgba(220, 38, 56, 0)");
      cCtx.fillStyle = grad;
      cCtx.beginPath();
      cCtx.arc(x, y, r, 0, Math.PI * 2);
      cCtx.fill();

      const bGrad = bCtx.createRadialGradient(x, y, 1, x, y, r);
      bGrad.addColorStop(0, warm ? "rgba(210, 210, 210, 0.25)" : "rgba(70, 70, 70, 0.25)");
      bGrad.addColorStop(1, "rgba(136, 136, 136, 0)");
      bCtx.fillStyle = bGrad;
      bCtx.beginPath();
      bCtx.arc(x, y, r, 0, Math.PI * 2);
      bCtx.fill();
    }

    // Subtle helical myocardial fiber striations + microvascular blush
    cCtx.strokeStyle = "rgba(140, 16, 30, 0.14)";
    cCtx.lineWidth = 1.0;
    bCtx.strokeStyle = "rgba(65, 65, 65, 0.28)";
    bCtx.lineWidth = 1.1;
    for (let k = 0; k < 56; k++) {
      const y0 = (k / 56) * size;
      cCtx.beginPath();
      cCtx.moveTo(0, y0);
      cCtx.bezierCurveTo(size * 0.35, y0 + 18, size * 0.65, y0 - 12, size, y0 + 24);
      cCtx.stroke();

      bCtx.beginPath();
      bCtx.moveTo(0, y0);
      bCtx.bezierCurveTo(size * 0.35, y0 + 18, size * 0.65, y0 - 12, size, y0 + 24);
      bCtx.stroke();
    }
  }

  const colorMap = new THREE.CanvasTexture(colCanvas);
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  return { colorMap, bumpMap };
}

function buildSculptedVentriclesGeometry(): THREE.BufferGeometry {
  // Anatomical biventricular heart cone: broader rounded base curving gracefully to an oblique right-inferior apex
  const uSteps = 56;
  const vSteps = 64;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= uSteps; i++) {
    const u = (i / uSteps) * Math.PI; // 0 = base top, PI = apex bottom
    const sinU = Math.sin(u);
    const cosU = Math.cos(u);
    const tDown = (1 - cosU) * 0.5; // 0 top .. 1 apex

    // Broader asymmetric base tapering cleanly to cardiac apex
    const taper = Math.pow(Math.max(sinU, 0.0005), 0.72) * (0.95 - tDown * 0.32);

    for (let j = 0; j <= vSteps; j++) {
      const v = (j / vSteps) * Math.PI * 2;
      const cosV = Math.cos(v); // +X viewer right (left ventricle), -X viewer left (right ventricle)
      const sinV = Math.sin(v); // +Z anterior, -Z posterior/diaphragmatic

      let rx = 0.64 * taper;
      let rz = 0.5 * taper;
      const ry = cosU * 0.74;

      // Left ventricle fullness (viewer's right, cosV > 0) vs gentler RV convexity
      if (cosV > 0) {
        rx *= 1 + cosV * 0.14 * (1 - tDown * 0.4);
      }

      // Subtle anterior & inferior interventricular sulcus groove (indentation where LAD courses)
      const sulcusCenter = 0.05 + tDown * 0.14;
      const sulcusDist = Math.abs(cosV - sulcusCenter);
      if (sinV > 0.15 && sulcusDist < 0.24 && tDown > 0.08 && tDown < 0.92) {
        const g = (1 - sulcusDist / 0.24) * 0.036 * THREE.MathUtils.smoothstep(sinV, 0.15, 0.65);
        rz *= 1 - g;
      }

      // Flatten posterior/diaphragmatic surface slightly
      if (sinV < 0) {
        rz *= 1 + sinV * 0.12;
      }

      let x = cosV * rx;
      let y = ry;
      let z = sinV * rz;

      // Sweeping anatomical axis tilt toward the apex (down & viewer's right)
      x += tDown * tDown * 0.24;
      z += tDown * (1 - tDown) * 0.12 + tDown * tDown * 0.12;
      // Slight elevation on upper-left conus arteriosus outflow shoulder
      y += Math.max(0, cosU) * Math.max(0, -cosV) * 0.08;

      positions.push(x, y, z);
      uvs.push(j / vSteps, i / uSteps);
    }
  }

  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const a = i * (vSteps + 1) + j;
      const b = a + vSteps + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function StudioAnatomicalHeartModel({
  spRef,
  isDesktopRef,
  reducedMotion,
}: {
  spRef: React.MutableRefObject<number>;
  isDesktopRef: React.MutableRefObject<boolean>;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pulseHeartRef = useRef<THREE.Group>(null);
  const greatVesselsRef = useRef<THREE.Group>(null);
  const haloRingRef = useRef<THREE.Mesh>(null);
  const pinGroupRef = useRef<THREE.Group>(null);

  const {
    myocardiumTextures,
    ventriclesGeo,
    aortaArchGeo,
    aortaBranchGeos,
    pulmTrunkGeo,
    pulmLeftGeo,
    pulmRightGeo,
    svcGeo,
    ivcGeo,
    pulmVeinGeos,
    coronaryMainGeos,
    coronaryFineGeos,
    vesselCollars,
    diagnosticPins,
  } = useMemo(() => {
    const mTex = createMyocardiumTextures();
    const ventGeo = buildSculptedVentriclesGeometry();

    // 1. Ascending Aorta & smooth sweeping Aortic Arch
    const aortaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.02, 0.24, 0.02),
      new THREE.Vector3(-0.08, 0.56, 0.05),
      new THREE.Vector3(-0.02, 0.92, 0.02),
      new THREE.Vector3(0.14, 1.0, -0.05),
      new THREE.Vector3(0.24, 0.72, -0.18),
      new THREE.Vector3(0.14, 0.16, -0.26),
    ]);
    const aorta = new THREE.TubeGeometry(aortaCurve, 40, 0.125, 22, false);

    // 3 Supra-aortic branches rising cleanly off top of arch (Brachiocephalic, L Common Carotid, L Subclavian)
    const branchDefs: Array<{ pts: [number, number, number][]; r: number }> = [
      { pts: [[-0.04, 0.88, 0.03], [-0.08, 1.18, 0.04], [-0.11, 1.38, 0.03]], r: 0.052 },
      { pts: [[0.06, 0.94, 0.0], [0.06, 1.24, -0.01], [0.06, 1.42, -0.02]], r: 0.042 },
      { pts: [[0.15, 0.95, -0.05], [0.18, 1.2, -0.07], [0.22, 1.35, -0.09]], r: 0.04 },
    ];
    const aBranches = branchDefs.map(
      (b) =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(b.pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
          16,
          b.r,
          14,
          false
        )
    );

    // 2. Pulmonary Trunk arching up & left anteriorly, splitting into horizontal L/R Pulmonary Arteries
    const pTrunk = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.02, 0.28, 0.2),
        new THREE.Vector3(0.08, 0.52, 0.17),
        new THREE.Vector3(0.14, 0.68, 0.06),
      ]),
      24,
      0.118,
      20,
      false
    );
    const pLeft = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.12, 0.66, 0.06),
        new THREE.Vector3(0.36, 0.68, -0.02),
        new THREE.Vector3(0.6, 0.62, -0.08),
      ]),
      18,
      0.082,
      16,
      false
    );
    const pRight = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.12, 0.66, 0.05),
        new THREE.Vector3(-0.18, 0.64, -0.04),
        new THREE.Vector3(-0.56, 0.58, -0.1),
      ]),
      20,
      0.078,
      16,
      false
    );

    // 3. Superior & Inferior Vena Cava on viewer's left (anatomical right)
    const svc = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.38, 0.26, -0.02),
        new THREE.Vector3(-0.36, 0.68, -0.02),
        new THREE.Vector3(-0.34, 1.06, -0.01),
        new THREE.Vector3(-0.38, 1.24, 0.0),
      ]),
      24,
      0.115,
      20,
      false
    );
    const ivc = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.34, -0.18, -0.16),
        new THREE.Vector3(-0.36, -0.44, -0.2),
      ]),
      12,
      0.105,
      16,
      false
    );

    // 4. Pulmonary Veins (lateral stubs behind atria matching the horizontal vessel silhouettes in reference)
    const pvDefs: Array<[number, number, number][]> = [
      [[0.3, 0.36, -0.1], [0.58, 0.36, -0.12]],
      [[0.32, 0.2, -0.12], [0.56, 0.16, -0.14]],
      [[-0.36, 0.36, -0.12], [-0.66, 0.38, -0.12]],
    ];
    const pVeins = pvDefs.map(
      (pts) =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
          12,
          0.054,
          14,
          false
        )
    );

    // Dark crimson lumen cuffs at vessel openings for crisp anatomical realism
    const collars: Array<{ pos: [number, number, number]; rot: [number, number, number]; r: number }> = [
      { pos: [-0.38, 1.24, 0.0], rot: [Math.PI / 2, -0.15, 0], r: 0.112 },
      { pos: [-0.11, 1.38, 0.03], rot: [Math.PI / 2, -0.14, 0], r: 0.05 },
      { pos: [0.06, 1.42, -0.02], rot: [Math.PI / 2, 0, 0], r: 0.04 },
      { pos: [0.22, 1.35, -0.09], rot: [Math.PI / 2, 0.2, 0], r: 0.038 },
      { pos: [0.6, 0.62, -0.08], rot: [0, Math.PI / 2, 0.22], r: 0.078 },
      { pos: [-0.56, 0.58, -0.1], rot: [0, Math.PI / 2, -0.15], r: 0.074 },
      { pos: [0.58, 0.36, -0.12], rot: [0, Math.PI / 2, 0], r: 0.05 },
      { pos: [0.56, 0.16, -0.14], rot: [0, Math.PI / 2, -0.1], r: 0.05 },
      { pos: [-0.66, 0.38, -0.12], rot: [0, Math.PI / 2, 0], r: 0.05 },
    ];

    // 5. Delicate organic Coronary Arterial Tree tracing smoothly over anterior ventricles
    const mainCoronaryPaths: Array<{ pts: [number, number, number][]; r: number }> = [
      // Left Anterior Descending (LAD) sweeping diagonally toward apex
      {
        pts: [
          [0.02, 0.26, 0.44],
          [0.06, 0.08, 0.52],
          [0.12, -0.16, 0.51],
          [0.19, -0.44, 0.41],
          [0.25, -0.66, 0.25],
        ],
        r: 0.015,
      },
      // Left Circumflex / Obtuse Marginal hugging right-anterior convexity
      {
        pts: [
          [0.04, 0.26, 0.42],
          [0.32, 0.18, 0.43],
          [0.54, -0.02, 0.36],
          [0.56, -0.32, 0.25],
          [0.44, -0.58, 0.17],
        ],
        r: 0.014,
      },
      // Right Coronary Artery descending down anterior-left border
      {
        pts: [
          [-0.22, 0.22, 0.36],
          [-0.4, 0.0, 0.38],
          [-0.44, -0.26, 0.32],
          [-0.28, -0.54, 0.24],
        ],
        r: 0.013,
      },
    ];

    const fineCoronaryPaths: Array<{ pts: [number, number, number][]; r: number }> = [
      // Diagonal branches off LAD
      { pts: [[0.06, 0.08, 0.52], [0.24, -0.04, 0.51], [0.38, -0.22, 0.43]], r: 0.0085 },
      { pts: [[0.24, -0.04, 0.51], [0.32, -0.18, 0.46]], r: 0.006 },
      { pts: [[0.12, -0.16, 0.51], [0.28, -0.32, 0.45], [0.38, -0.48, 0.32]], r: 0.008 },
      { pts: [[0.19, -0.44, 0.41], [0.31, -0.54, 0.31]], r: 0.006 },
      { pts: [[0.12, -0.16, 0.51], [-0.04, -0.34, 0.44], [-0.14, -0.5, 0.34]], r: 0.008 },
      { pts: [[0.06, 0.08, 0.52], [-0.12, -0.08, 0.49], [-0.24, -0.24, 0.43]], r: 0.0075 },
      // Marginal twigs off LCx & RCA
      { pts: [[0.32, 0.18, 0.43], [0.46, 0.02, 0.42], [0.48, -0.18, 0.38]], r: 0.0075 },
      { pts: [[0.54, -0.02, 0.36], [0.64, -0.18, 0.24]], r: 0.0065 },
      { pts: [[-0.4, 0.0, 0.38], [-0.26, -0.18, 0.41], [-0.18, -0.34, 0.38]], r: 0.0075 },
      { pts: [[-0.44, -0.26, 0.32], [-0.36, -0.42, 0.26]], r: 0.006 },
    ];

    const cMainGeos = mainCoronaryPaths.map(
      (b) =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(b.pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
          22,
          b.r,
          8,
          false
        )
    );
    const cFineGeos = fineCoronaryPaths.map(
      (b) =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(b.pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
          14,
          b.r,
          7,
          false
        )
    );

    // Subtle glowing white telemetry hotspot pins matching reference aesthetic
    const pins: [number, number, number][] = [
      [0.24, 0.78, 0.18],
      [0.05, 0.22, 0.54],
      [-0.48, -0.24, 0.44],
      [0.54, -0.32, 0.4],
    ];

    return {
      myocardiumTextures: mTex,
      ventriclesGeo: ventGeo,
      aortaArchGeo: aorta,
      aortaBranchGeos: aBranches,
      pulmTrunkGeo: pTrunk,
      pulmLeftGeo: pLeft,
      pulmRightGeo: pRight,
      svcGeo: svc,
      ivcGeo: ivc,
      pulmVeinGeos: pVeins,
      coronaryMainGeos: cMainGeos,
      coronaryFineGeos: cFineGeos,
      vesselCollars: collars,
      diagnosticPins: pins,
    };
  }, []);

  useEffect(() => {
    return () => {
      myocardiumTextures.colorMap.dispose();
      myocardiumTextures.bumpMap.dispose();
      ventriclesGeo.dispose();
      aortaArchGeo.dispose();
      aortaBranchGeos.forEach((g) => g.dispose());
      pulmTrunkGeo.dispose();
      pulmLeftGeo.dispose();
      pulmRightGeo.dispose();
      svcGeo.dispose();
      ivcGeo.dispose();
      pulmVeinGeos.forEach((g) => g.dispose());
      coronaryMainGeos.forEach((g) => g.dispose());
      coronaryFineGeos.forEach((g) => g.dispose());
    };
  }, [
    myocardiumTextures,
    ventriclesGeo,
    aortaArchGeo,
    aortaBranchGeos,
    pulmTrunkGeo,
    pulmLeftGeo,
    pulmRightGeo,
    svcGeo,
    ivcGeo,
    pulmVeinGeos,
    coronaryMainGeos,
    coronaryFineGeos,
  ]);

  useFrame(({ clock, viewport }) => {
    const grp = groupRef.current;
    if (!grp) return;
    const sp = spRef.current;
    const weight = smoothWeight(sp, 0.05, 0.18);
    grp.visible = weight > 0.015;
    if (!grp.visible) return;

    const t = clock.getElapsedTime();
    const isDesktop = isDesktopRef.current;

    // Realistic physiological lub-dub cardiac contraction cycle
    if (!reducedMotion) {
      const phase = (t * 1.15) % 1;
      const lub = Math.exp(-Math.pow((phase - 0.16) * 14, 2)) * 0.065;
      const dub = Math.exp(-Math.pow((phase - 0.34) * 16, 2)) * 0.038;
      if (pulseHeartRef.current) {
        pulseHeartRef.current.scale.set(1 + lub + dub, 1 + (lub + dub) * 0.72, 1 + lub + dub);
      }
      if (greatVesselsRef.current) {
        greatVesselsRef.current.scale.setScalar(1 + lub * 0.35 + dub * 0.25);
      }
      if (haloRingRef.current) {
        haloRingRef.current.scale.setScalar(1 + lub * 0.28);
      }
      if (pinGroupRef.current) {
        pinGroupRef.current.children.forEach((pin, idx) => {
          const p = 0.9 + Math.sin(t * 2.4 + idx * 1.4) * 0.12;
          pin.scale.setScalar(p);
        });
      }
    }

    const slideProgress = THREE.MathUtils.clamp(sp / 0.2, 0, 1.5);
    const baseX = isDesktop ? Math.min(viewport.width * 0.32, viewport.width * 0.5 - 1.48) : 0.0;
    const baseY = isDesktop ? -0.04 : 0.16;
    grp.position.set(
      baseX - slideProgress * (isDesktop ? 1.15 : 0),
      baseY + (sp - 0.02) * 5.0 + (reducedMotion ? 0 : Math.sin(t * 1.1) * 0.03),
      (1 - weight) * -4.2
    );
    grp.rotation.y = -0.14 + (reducedMotion ? 0 : Math.sin(t * 0.45) * 0.16) + sp * Math.PI * 2.5;
    grp.rotation.x = 0.05 + slideProgress * 0.22;
    grp.scale.setScalar((isDesktop ? 1.24 : 0.94) * (0.68 + 0.32 * weight));
    applyGroupFade(grp, weight * (isDesktop ? 1 : 0.32));
  });

  return (
    <group ref={groupRef} position={[2.6, -0.04, 0]}>
      {/* Clean translucent white circular halo disc & concentric ring behind the heart */}
      <mesh position={[0.02, 0.12, -0.68]}>
        <circleGeometry args={[1.18, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.42} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={haloRingRef} position={[0.02, 0.12, -0.66]}>
        <ringGeometry args={[1.18, 1.36, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>

      <group ref={pulseHeartRef}>
        {/* Sculpted Left & Right Ventricular Mass */}
        <mesh geometry={ventriclesGeo} position={[0.02, -0.12, 0.06]}>
          <meshPhysicalMaterial
            map={myocardiumTextures.colorMap}
            bumpMap={myocardiumTextures.bumpMap}
            bumpScale={0.015}
            color="#f43f50"
            roughness={0.26}
            clearcoat={0.76}
            clearcoatRoughness={0.18}
            transparent
            opacity={0.99}
          />
        </mesh>

        {/* Right Atrium & Right Auricle (viewer's left, soft rose-coral highlight) */}
        <mesh position={[-0.4, 0.02, 0.04]} rotation={[0.1, 0.2, 0.22]} scale={[0.72, 1.12, 0.78]}>
          <sphereGeometry args={[0.32, 28, 24]} />
          <meshPhysicalMaterial
            color="#f26671"
            roughness={0.28}
            clearcoat={0.68}
            clearcoatRoughness={0.2}
            transparent
            opacity={0.99}
          />
        </mesh>

        {/* Left Auricular Appendage (tucked neatly upper-right beside pulmonary trunk) */}
        <mesh position={[0.42, 0.3, 0.08]} rotation={[0.15, -0.3, -0.45]} scale={[0.92, 0.65, 0.72]}>
          <sphereGeometry args={[0.18, 22, 18]} />
          <meshPhysicalMaterial
            color="#ec4856"
            roughness={0.28}
            clearcoat={0.7}
            clearcoatRoughness={0.2}
            transparent
            opacity={0.99}
          />
        </mesh>

        {/* Fine Branching Surface Coronary Arteries */}
        {coronaryMainGeos.map((g, idx) => (
          <mesh key={`cm-${idx}`} geometry={g}>
            <meshPhysicalMaterial color="#fca5ad" roughness={0.25} clearcoat={0.6} transparent opacity={0.97} />
          </mesh>
        ))}
        {coronaryFineGeos.map((g, idx) => (
          <mesh key={`cf-${idx}`} geometry={g}>
            <meshPhysicalMaterial color="#fecdd3" roughness={0.28} clearcoat={0.5} transparent opacity={0.95} />
          </mesh>
        ))}
      </group>

      {/* Great Vessels: Aorta + 3 Supra-aortic branches, Pulmonary Trunk + L/R Arteries, SVC/IVC, Pulmonary Veins */}
      <group ref={greatVesselsRef}>
        <mesh geometry={aortaArchGeo}>
          <meshPhysicalMaterial color="#ea3546" roughness={0.26} clearcoat={0.72} clearcoatRoughness={0.18} transparent opacity={0.99} />
        </mesh>
        {aortaBranchGeos.map((g, idx) => (
          <mesh key={`ab-${idx}`} geometry={g}>
            <meshPhysicalMaterial color="#ef4454" roughness={0.26} clearcoat={0.68} clearcoatRoughness={0.18} transparent opacity={0.99} />
          </mesh>
        ))}
        <mesh geometry={pulmTrunkGeo}>
          <meshPhysicalMaterial color="#f25764" roughness={0.26} clearcoat={0.68} clearcoatRoughness={0.2} transparent opacity={0.99} />
        </mesh>
        <mesh geometry={pulmLeftGeo}>
          <meshPhysicalMaterial color="#ed4554" roughness={0.28} clearcoat={0.65} transparent opacity={0.99} />
        </mesh>
        <mesh geometry={pulmRightGeo}>
          <meshPhysicalMaterial color="#ed4554" roughness={0.28} clearcoat={0.65} transparent opacity={0.99} />
        </mesh>
        <mesh geometry={svcGeo}>
          <meshPhysicalMaterial color="#f26b76" roughness={0.28} clearcoat={0.65} clearcoatRoughness={0.2} transparent opacity={0.99} />
        </mesh>
        <mesh geometry={ivcGeo}>
          <meshPhysicalMaterial color="#df3a49" roughness={0.3} clearcoat={0.55} transparent opacity={0.98} />
        </mesh>
        {pulmVeinGeos.map((g, idx) => (
          <mesh key={`pv-${idx}`} geometry={g}>
            <meshPhysicalMaterial color="#eb4857" roughness={0.28} clearcoat={0.62} transparent opacity={0.99} />
          </mesh>
        ))}

        {/* Flared vessel lumen openings with deep interior core */}
        {vesselCollars.map((c, idx) => (
          <group key={`vc-${idx}`} position={c.pos} rotation={c.rot}>
            <mesh>
              <torusGeometry args={[c.r, c.r * 0.22, 12, 24]} />
              <meshPhysicalMaterial color="#f46c77" roughness={0.28} clearcoat={0.55} transparent opacity={0.98} />
            </mesh>
            <mesh>
              <circleGeometry args={[c.r * 0.88, 20]} />
              <meshStandardMaterial color="#6b1019" roughness={0.75} side={THREE.DoubleSide} transparent opacity={0.98} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Subtle Floating White Telemetry Ring Hotspots */}
      <group ref={pinGroupRef}>
        {diagnosticPins.map((pos, idx) => (
          <group key={`pin-${idx}`} position={pos}>
            <mesh>
              <sphereGeometry args={[0.042, 16, 16]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.95} />
            </mesh>
            <mesh>
              <ringGeometry args={[0.065, 0.115, 28]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.42} side={THREE.DoubleSide} />
            </mesh>
          </group>
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
      <mesh position={[0, 0, -0.55]}>
        <ringGeometry args={[1.05, 1.55, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={backSheetRef} position={[-0.18, 0.08, -0.22]} rotation={[0, 0.08, 0.07]}>
        <boxGeometry args={[1.62, 2.05, 0.05]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.3} transparent opacity={0.9} />
      </mesh>
      <mesh ref={midSheetRef} position={[0.14, -0.05, -0.12]} rotation={[0, -0.06, -0.05]}>
        <boxGeometry args={[1.62, 2.05, 0.05]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.28} transparent opacity={0.94} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.74, 2.15, 0.08]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.16} clearcoat={0.6} transparent opacity={0.98} />
      </mesh>
      <mesh position={[0, 0.94, 0.06]}>
        <boxGeometry args={[0.96, 0.22, 0.1]} />
        <meshStandardMaterial color="#111827" metalness={0.35} roughness={0.25} transparent opacity={1} />
      </mesh>
      <group position={[-0.55, 0.6, 0.07]}>
        <mesh>
          <boxGeometry args={[0.28, 0.09, 0.035]} />
          <meshStandardMaterial color="#ef233c" transparent opacity={1} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.09, 0.28, 0.035]} />
          <meshStandardMaterial color="#ef233c" transparent opacity={1} />
        </mesh>
      </group>
      <mesh position={[0.48, 0.6, 0.07]}>
        <torusGeometry args={[0.13, 0.025, 10, 28]} />
        <meshStandardMaterial color="#0066ff" transparent opacity={1} />
      </mesh>
      <mesh geometry={ecgGeo}>
        <meshStandardMaterial color="#0066ff" emissive="#0066ff" emissiveIntensity={0.35} transparent opacity={1} />
      </mesh>
      <mesh ref={pulseDotRef} position={[0, 0.1, 0.12]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshBasicMaterial color="#ef233c" transparent opacity={1} />
      </mesh>
      {barHeights.map((h, i) => (
        <mesh key={i} position={[-0.44 + i * 0.22, -0.78 + h * 0.35, 0.06]}>
          <boxGeometry args={[0.12, h * 0.7, 0.04]} />
          <meshStandardMaterial color={i === 3 ? "#0066ff" : "#cbd5e1"} transparent opacity={1} />
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
      <mesh position={[0.15, 0, -0.58]}>
        <ringGeometry args={[1.0, 1.52, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <group ref={capRef} position={[-0.78, 0.05, 0.18]}>
        <mesh ref={capTopRef} position={[0, 0.27, 0]}>
          <capsuleGeometry args={[0.26, 0.42, 16, 24]} />
          <meshPhysicalMaterial color="#0066ff" roughness={0.14} clearcoat={0.9} transparent opacity={1} />
        </mesh>
        <mesh ref={capBotRef} position={[0, -0.27, 0]}>
          <capsuleGeometry args={[0.255, 0.42, 16, 24]} />
          <meshPhysicalMaterial color="#ffffff" roughness={0.16} clearcoat={0.85} transparent opacity={1} />
        </mesh>
        {granules.map((g, i) => (
          <mesh key={i} position={g.offset}>
            <sphereGeometry args={[g.r, 12, 12]} />
            <meshPhysicalMaterial color={i % 2 === 0 ? "#0066ff" : "#ef233c"} roughness={0.18} clearcoat={0.65} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      <group ref={molRef} position={[0.42, 0.15, 0]}>
        {atoms.map((a, idx) => (
          <mesh key={idx} position={a.pos}>
            <sphereGeometry args={[a.r, 20, 20]} />
            <meshPhysicalMaterial color={idx % 3 === 0 ? "#0066ff" : idx % 3 === 1 ? "#ef233c" : "#cbd5e1"} roughness={0.2} clearcoat={0.7} transparent opacity={1} />
          </mesh>
        ))}
        {bondGeos.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshStandardMaterial color="#94a3b8" metalness={0.25} roughness={0.32} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      <group ref={dnaRef} position={[1.18, -0.05, -0.22]} rotation={[0, 0, -0.14]}>
        <mesh geometry={dnaStrandA}>
          <meshStandardMaterial color="#0066ff" roughness={0.22} transparent opacity={0.95} />
        </mesh>
        <mesh geometry={dnaStrandB}>
          <meshStandardMaterial color="#111827" roughness={0.25} transparent opacity={0.92} />
        </mesh>
        {dnaRungs.map((r, i) => (
          <mesh key={i} position={r.mid} rotation={[0, r.rotY, Math.PI / 2]}>
            <cylinderGeometry args={[0.011, 0.011, 0.4, 8]} />
            <meshStandardMaterial color="#93c5fd" transparent opacity={1} />
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
      <mesh position={[0, 0, -0.5]}>
        <ringGeometry args={[1.45, 1.85, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <group ref={globeSpinRef}>
        <mesh>
          <sphereGeometry args={[radius - 0.02, 36, 36]} />
          <meshPhysicalMaterial color="#f8fafc" roughness={0.35} clearcoat={0.4} transparent opacity={0.96} />
        </mesh>
        <mesh>
          <sphereGeometry args={[radius, 28, 28]} />
          <meshBasicMaterial color="#cbd5e1" wireframe transparent opacity={0.55} />
        </mesh>
        <points geometry={dotGeo}>
          <pointsMaterial color="#0066ff" size={0.044} sizeAttenuation transparent opacity={0.92} />
        </points>
        {arcGeos.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshBasicMaterial color="#0066ff" transparent opacity={0.75} />
          </mesh>
        ))}
        {beacons.map((b, i) => (
          <mesh key={i} position={b.pos}>
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshBasicMaterial color={i % 2 === 0 ? "#ef233c" : "#0066ff"} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      <group ref={satRingRef} rotation={[Math.PI / 2.4, 0.25, 0]}>
        <mesh>
          <torusGeometry args={[radius + 0.34, 0.012, 8, 90]} />
          <meshBasicMaterial color="#0066ff" transparent opacity={0.45} />
        </mesh>
        <mesh position={[radius + 0.34, 0, 0]}>
          <octahedronGeometry args={[0.065, 0]} />
          <meshStandardMaterial color="#0066ff" transparent opacity={1} />
        </mesh>
        <mesh position={[-(radius + 0.34), 0, 0]}>
          <octahedronGeometry args={[0.065, 0]} />
          <meshStandardMaterial color="#ef233c" transparent opacity={1} />
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
      <mesh position={[0, 0, -0.55]}>
        <ringGeometry args={[1.05, 1.5, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={shieldGeo} position={[0, 0, -0.14]} scale={[0.92, 0.92, 0.5]}>
        <meshStandardMaterial color="#111827" roughness={0.28} metalness={0.35} transparent opacity={0.92} />
      </mesh>
      <mesh geometry={shieldGeo} position={[0, 0, -0.04]}>
        <meshPhysicalMaterial color="#ffffff" roughness={0.15} metalness={0.05} clearcoat={0.85} transparent opacity={0.82} />
      </mesh>
      <mesh position={[0, 0.1, 0.16]}>
        <boxGeometry args={[0.66, 0.2, 0.08]} />
        <meshStandardMaterial color="#0066ff" roughness={0.22} transparent opacity={1} />
      </mesh>
      <mesh position={[0, 0.1, 0.16]}>
        <boxGeometry args={[0.2, 0.66, 0.08]} />
        <meshStandardMaterial color="#0066ff" roughness={0.22} transparent opacity={1} />
      </mesh>
      <group ref={outerRingRef}>
        <mesh>
          <torusGeometry args={[1.38, 0.018, 8, 72]} />
          <meshStandardMaterial color="#0066ff" transparent opacity={0.85} />
        </mesh>
        {[0, 1, 2, 3].map((k) => {
          const angle = (k / 4) * Math.PI * 2;
          return (
            <mesh key={k} position={[Math.cos(angle) * 1.38, Math.sin(angle) * 1.38, 0]}>
              <octahedronGeometry args={[0.065, 0]} />
              <meshStandardMaterial color={k % 2 === 0 ? "#0066ff" : "#ef233c"} transparent opacity={1} />
            </mesh>
          );
        })}
      </group>
      <mesh ref={innerRingRef}>
        <torusGeometry args={[1.15, 0.012, 8, 64]} />
        <meshStandardMaterial color="#cbd5e1" transparent opacity={0.85} />
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
      <pointsMaterial color="#0066ff" size={0.048} sizeAttenuation transparent opacity={0.22} />
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
      <StudioAnatomicalHeartModel spRef={smoothedSpRef} isDesktopRef={isDesktopRef} reducedMotion={reducedMotion} />
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
          <ambientLight intensity={0.98} />
          <directionalLight position={[4, 7, 6]} intensity={1.45} color="#ffffff" />
          <pointLight position={[2, 2.5, 5]} intensity={0.72} color="#fff1f2" />
          <pointLight position={[-5, -2, 4]} intensity={0.78} color="#93c5fd" />
          <pointLight position={[3, -4, 3]} intensity={0.5} color="#38bdf8" />
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
