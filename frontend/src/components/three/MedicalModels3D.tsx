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
 * 1. HERO MODEL: MEDICAL-ATLAS HALF-BODY RESPIRATORY & THORACIC ANATOMY
 * ============================================================================ */
function createLungTissueTextures(): { colorMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
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
    // Rich warm rosy-terracotta pleura base
    cCtx.fillStyle = "#b55d4f";
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = "#888888";
    bCtx.fillRect(0, 0, size, size);

    // Deterministic pulmonary secondary lobules + mottled organic depth
    for (let i = 0; i < 240; i++) {
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233) * 24634.6345;
      const s3 = Math.sin(i * 41.123) * 19283.4123;
      const x = (s1 - Math.floor(s1)) * size;
      const y = (s2 - Math.floor(s2)) * size;
      const r = 6 + (s3 - Math.floor(s3)) * 16;

      const grad = cCtx.createRadialGradient(x, y, 1, x, y, r);
      const isHighlight = i % 3 === 0;
      grad.addColorStop(0, isHighlight ? "rgba(218, 134, 118, 0.55)" : "rgba(128, 52, 46, 0.5)");
      grad.addColorStop(0.75, "rgba(165, 76, 66, 0.28)");
      grad.addColorStop(1, "rgba(104, 40, 38, 0.0)");
      cCtx.fillStyle = grad;
      cCtx.beginPath();
      cCtx.arc(x, y, r, 0, Math.PI * 2);
      cCtx.fill();

      const bGrad = bCtx.createRadialGradient(x, y, 1, x, y, r);
      bGrad.addColorStop(0, "rgba(225, 225, 225, 0.55)");
      bGrad.addColorStop(0.8, "rgba(130, 130, 130, 0.3)");
      bGrad.addColorStop(1, "rgba(55, 55, 55, 0.0)");
      bCtx.fillStyle = bGrad;
      bCtx.beginPath();
      bCtx.arc(x, y, r, 0, Math.PI * 2);
      bCtx.fill();
    }

    // Subtle delicate capillary septa lines
    cCtx.strokeStyle = "rgba(88, 34, 34, 0.28)";
    cCtx.lineWidth = 1.1;
    bCtx.strokeStyle = "rgba(45, 45, 45, 0.45)";
    bCtx.lineWidth = 1.3;
    for (let k = 0; k < 64; k++) {
      const a = (k * 2.3999) % (Math.PI * 2);
      const sx = ((Math.sin(k * 9.1) * 0.5 + 0.5) * size);
      const sy = ((Math.cos(k * 7.3) * 0.5 + 0.5) * size);
      const ex = sx + Math.cos(a) * 28;
      const ey = sy + Math.sin(a) * 28;
      cCtx.beginPath();
      cCtx.moveTo(sx, sy);
      cCtx.lineTo(ex, ey);
      cCtx.stroke();

      bCtx.beginPath();
      bCtx.moveTo(sx, sy);
      bCtx.lineTo(ex, ey);
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

function buildSculptedLungGeometry(side: -1 | 1): THREE.BufferGeometry {
  const uSteps = 46;
  const vSteps = 54;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= uSteps; i++) {
    const u = (i / uSteps) * Math.PI;
    const sinU = Math.sin(u);
    const ny = Math.cos(u);
    const radialScale = Math.pow(Math.max(sinU, 0.0001), 0.72) * (0.78 + (1 - ny) * 0.22);

    for (let j = 0; j <= vSteps; j++) {
      const v = (j / vSteps) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);

      let rx = 0.45 * radialScale;
      let rz = 0.42 * radialScale;

      const medialness = Math.max(0, -side * cosV);
      rx *= 1 - medialness * 0.48;

      if (side === 1 && ny < 0.18 && cosV < 0.05 && sinV > -0.25) {
        const notchFactor =
          Math.max(0, (0.18 - ny) / 1.18) *
          Math.max(0, (-cosV + 0.05) / 1.05) *
          Math.max(0, (sinV + 0.25) / 1.25);
        rx *= 1 - notchFactor * 0.56;
        rz *= 1 - notchFactor * 0.24;
      }

      const obliqueDist = Math.abs(ny - 0.28 * sinV + 0.06);
      const horizontalDist = side === -1 ? Math.abs(ny - 0.24) : 1.0;
      const crease =
        (obliqueDist < 0.08 ? (1 - obliqueDist / 0.08) * 0.058 : 0) +
        (horizontalDist < 0.06 && sinV > -0.2 ? (1 - horizontalDist / 0.06) * 0.048 : 0);

      // Subtle organic lobular surface undulation
      const micro = Math.sin(ny * 18 + cosV * 9) * Math.cos(sinV * 11) * 0.009;

      let x = cosV * rx * (1 - crease + micro);
      let z = sinV * rz * (1 - crease + micro);
      let y = ny * 0.68;

      if (ny < -0.45) {
        const baseArch = (Math.abs(ny) - 0.45) / 0.55;
        y += baseArch * 0.22 * (1 - sinU * 0.35);
        y -= sinV * 0.065 * baseArch;
      }

      x -= side * Math.max(0, ny) * 0.13;
      positions.push(x, y, z);
      uvs.push((j / vSteps) * 1.4, (i / uSteps) * 1.4);
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

function buildSculptedHumanBustGeometry(): THREE.BufferGeometry {
  // Smooth studio mannequin bust (closed rounded waist base -> chest/shoulders -> neck -> sculpted head/face -> closed crown)
  const ySteps = 96;
  const rSteps = 72;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= ySteps; i++) {
    const tAll = i / ySteps;
    const y = THREE.MathUtils.lerp(-0.88, 2.04, tAll);

    // Base profile rx, rz, zShift across torso, shoulders, neck, and head
    let rx = 0.62;
    let rz = 0.36;
    let zShift = 0.0;

    if (y < -0.58) {
      // Smooth rounded sculptural bust base closure (clean rounded waist cut)
      const bt = THREE.MathUtils.clamp((y + 0.88) / 0.3, 0, 1);
      const ease = Math.sin(bt * Math.PI * 0.5);
      rx = Math.max(0.003, ease * 0.68);
      rz = Math.max(0.003, ease * 0.38);
      zShift = -0.02;
    } else if (y < 0.42) {
      // Ribcage -> chest -> broad shoulders
      const tt = (y + 0.58) / 1.0;
      const smooth = tt * tt * (3 - 2 * tt);
      rx = THREE.MathUtils.lerp(0.68, 0.94, smooth) + Math.sin(tt * Math.PI) * 0.025;
      rz = THREE.MathUtils.lerp(0.38, 0.43, Math.sin(tt * Math.PI * 0.78));
      zShift = -0.02;
    } else if (y < 0.82) {
      // Natural trapezius slope from shoulders into neck
      const tt = (y - 0.42) / 0.4;
      const smooth = tt * tt * (3 - 2 * tt);
      rx = THREE.MathUtils.lerp(0.94, 0.195, smooth);
      rz = THREE.MathUtils.lerp(0.41, 0.195, smooth);
      zShift = THREE.MathUtils.lerp(-0.02, -0.015, smooth);
    } else if (y < 1.18) {
      // Slender human neck
      const tt = (y - 0.82) / 0.36;
      rx = THREE.MathUtils.lerp(0.195, 0.175, tt);
      rz = THREE.MathUtils.lerp(0.195, 0.185, tt);
      zShift = -0.015;
    } else {
      // Human head: chin/jawline -> cheeks/temples -> smooth oval cranium dome -> closed crown
      const ht = THREE.MathUtils.clamp((y - 1.18) / 0.86, 0, 1);
      const crownCap = ht > 0.78 ? Math.cos(((ht - 0.78) / 0.22) * (Math.PI * 0.5)) : 1.0;
      const headCurve = Math.sin(Math.min(1, ht / 0.86) * Math.PI * 0.74);
      const jawFlare = Math.exp(-Math.pow((ht - 0.26) / 0.2, 2)) * 0.042;
      rx = Math.max(0.002, (0.168 + headCurve * 0.088 + jawFlare) * crownCap);
      rz = Math.max(0.002, (0.18 + headCurve * 0.125 + jawFlare * 0.7) * crownCap);
      zShift = -0.015 + Math.sin(ht * Math.PI) * 0.025;
    }

    for (let j = 0; j <= rSteps; j++) {
      const theta = (j / rSteps) * Math.PI * 2;
      const cosT = Math.cos(theta); // +X/-X lateral
      const sinT = Math.sin(theta); // +Z front, -Z back

      let x = cosT * rx;
      let z = sinT * rz + zShift;
      let yOut = y;

      // Subtle anterior chest pectoral contour & sternum valley
      if (y > 0.05 && y < 0.52 && sinT > 0.1) {
        const chestBand = Math.exp(-Math.pow((y - 0.3) / 0.18, 2));
        const pecLobes = Math.exp(-Math.pow((Math.abs(x) - 0.32) / 0.22, 2));
        const sternumDip = Math.exp(-Math.pow(x / 0.09, 2)) * 0.02;
        z += chestBand * (pecLobes * 0.036 - sternumDip) * sinT;
      }

      // Sculpted human face relief on head anterior (y = 1.18..1.98, sinT > 0.1)
      if (y > 1.18 && y < 1.98 && sinT > 0.08) {
        const frontMask = THREE.MathUtils.smoothstep(sinT, 0.15, 0.92);

        // Defined jawline + tapered chin under mouth (y ~ 1.24..1.38)
        const chinMask =
          Math.exp(-Math.pow((y - 1.28) / 0.055, 2)) *
          Math.exp(-Math.pow(x / 0.095, 2)) *
          THREE.MathUtils.smoothstep(sinT, 0.45, 0.96);
        z += chinMask * 0.048;

        // Brow ridge (y ~ 1.66)
        const browMask =
          Math.exp(-Math.pow((y - 1.665) / 0.032, 2)) *
          Math.exp(-Math.pow(x / 0.14, 2)) *
          THREE.MathUtils.smoothstep(sinT, 0.5, 0.95);
        z += browMask * 0.028;

        // Soft recessed human eye sockets (no hollow zombie cavities)
        for (const side of [-1, 1]) {
          const ex = (x - side * 0.072) / 0.042;
          const ey = (y - 1.6) / 0.03;
          const ed = Math.sqrt(ex * ex + ey * ey);
          if (ed < 1.15 && sinT > 0.48) {
            const depth = Math.pow(Math.max(0, 1 - ed / 1.15), 1.2) * 0.028;
            z -= depth * frontMask;
          }
        }

        // Sculpted human nose bridge + tip + alar wings (y = 1.47..1.65)
        const noseVertical = THREE.MathUtils.smoothstep(y, 1.46, 1.52) * (1 - THREE.MathUtils.smoothstep(y, 1.62, 1.67));
        const noseWidth = 0.022 + (1 - THREE.MathUtils.clamp((y - 1.48) / 0.16, 0, 1)) * 0.014;
        const noseMask = Math.exp(-Math.pow(x / noseWidth, 2)) * noseVertical * THREE.MathUtils.smoothstep(sinT, 0.72, 0.98);
        const noseTipBoost = Math.exp(-Math.pow((y - 1.505) / 0.028, 2));
        z += noseMask * (0.042 + noseTipBoost * 0.032);

        // Cheekbones
        const cheekMask =
          Math.exp(-Math.pow((Math.abs(x) - 0.125) / 0.045, 2)) *
          Math.exp(-Math.pow((y - 1.52) / 0.055, 2)) *
          frontMask;
        z += cheekMask * 0.022;
        x += Math.sign(x || 1) * cheekMask * 0.012;

        // Upper & lower lips + subtle mouth line (y = 1.37..1.44)
        const lipsMask =
          Math.exp(-Math.pow((y - 1.4) / 0.028, 2)) *
          Math.exp(-Math.pow(x / 0.058, 2)) *
          THREE.MathUtils.smoothstep(sinT, 0.65, 0.97);
        const mouthCrease = Math.exp(-Math.pow((y - 1.398) / 0.006, 2)) * 0.012;
        z += lipsMask * 0.024 - mouthCrease * Math.exp(-Math.pow(x / 0.048, 2));

        // Slight crown rounding
        yOut = y;
      }

      positions.push(x, yOut, z);
      uvs.push(j / rSteps, tAll);
    }
  }

  for (let i = 0; i < ySteps; i++) {
    for (let j = 0; j < rSteps; j++) {
      const a = i * (rSteps + 1) + j;
      const b = a + rSteps + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildSculptedArmGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Smooth tapering upper arm from rounded deltoid cap down to beveled mid-arm cuff (closed at both ends)
  const ySteps = 32;
  const rSteps = 28;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= ySteps; i++) {
    const t = i / ySteps; // 0 = deltoid top, 1 = mid-arm bottom cuff
    const y = THREE.MathUtils.lerp(0.56, -0.58, t);
    const centerX = side * THREE.MathUtils.lerp(0.76, 1.12, Math.pow(t, 0.88));
    const centerZ = THREE.MathUtils.lerp(-0.02, 0.01, t);

    let rBase = THREE.MathUtils.lerp(0.205, 0.142, t);
    if (t < 0.14) {
      rBase *= Math.sin((t / 0.14) * (Math.PI * 0.5));
    } else if (t > 0.92) {
      rBase *= Math.cos(((t - 0.92) / 0.08) * (Math.PI * 0.5));
    }
    rBase = Math.max(0.002, rBase);

    for (let j = 0; j <= rSteps; j++) {
      const a = (j / rSteps) * Math.PI * 2;
      positions.push(
        centerX + Math.cos(a) * rBase * 0.94,
        y,
        centerZ + Math.sin(a) * rBase * 1.02
      );
    }
  }

  for (let i = 0; i < ySteps; i++) {
    for (let j = 0; j < rSteps; j++) {
      const a = i * (rSteps + 1) + j;
      const b = a + rSteps + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildSculptedDiaphragmGeometry(): THREE.BufferGeometry {
  // Smooth arched diaphragmatic dome beneath lungs + sculpted anterior scalloped muscular crura
  const uSteps = 32;
  const vSteps = 44;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= uSteps; i++) {
    const u = (i / uSteps) * Math.PI * 0.54;
    const sinU = Math.sin(u);
    const cosU = Math.cos(u);

    for (let j = 0; j <= vSteps; j++) {
      const v = (j / vSteps) * Math.PI * 2;
      const cosV = Math.cos(v); // -1 left (viewer right), +1 right (viewer left)
      const sinV = Math.sin(v); // +1 front, -1 back

      const rx = 0.72 * sinU;
      const rz = 0.31 * sinU;
      const x = cosV * rx;
      const z = sinV * rz;

      // Double dome shape: slightly higher anatomical right (viewer left -x), central cardiac dip
      const doubleDome =
        Math.exp(-Math.pow((x + 0.34) / 0.28, 2)) * 0.08 +
        Math.exp(-Math.pow((x - 0.34) / 0.28, 2)) * 0.065;
      const anteriorCrus =
        sinV > 0.2 && sinU > 0.55
          ? (Math.exp(-Math.pow((x + 0.18) / 0.14, 2)) + Math.exp(-Math.pow((x - 0.18) / 0.14, 2))) *
            (sinU - 0.55) *
            0.62
          : 0;

      const y = -0.58 + cosU * 0.26 + doubleDome - anteriorCrus;
      positions.push(x, y, z);
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
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

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
  const heartBeatRef = useRef<THREE.Group>(null);
  const diaphragmRef = useRef<THREE.Group>(null);
  const flowDotsRef = useRef<THREE.Group>(null);

  const {
    lungTextures,
    bustGeo,
    armGeos,
    diaphragmGeo,
    nasalCavityGeos,
    pharynxGeo,
    tracheaGeo,
    bronchialGeos,
    leftBronchialTreeGeos,
    rightLungGeo,
    leftLungGeo,
    aortaGeo,
    pulmonaryGeo,
    venaCavaGeo,
    flowCurves,
  } = useMemo(() => {
    const lTex = createLungTissueTextures();
    const bust = buildSculptedHumanBustGeometry();
    const arms = [buildSculptedArmGeometry(-1), buildSculptedArmGeometry(1)];
    const diaph = buildSculptedDiaphragmGeometry();
    const rLung = buildSculptedLungGeometry(-1);
    const lLung = buildSculptedLungGeometry(1);

    // Internal nasal cavity turbinates & palate curving back to pharynx inside sculpted head
    const nasalCavities = [
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 1.50, 0.29),
          new THREE.Vector3(0, 1.57, 0.21),
          new THREE.Vector3(0, 1.56, 0.08),
          new THREE.Vector3(0, 1.43, 0.02),
        ]),
        20,
        0.044,
        14,
        false
      ),
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 1.42, 0.22),
          new THREE.Vector3(0, 1.43, 0.11),
          new THREE.Vector3(0, 1.38, 0.03),
        ]),
        14,
        0.036,
        12,
        false
      ),
    ];

    const pharynx = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.52, 0.04),
        new THREE.Vector3(0, 1.32, 0.02),
        new THREE.Vector3(0, 1.12, 0.02),
      ]),
      18,
      0.046,
      14,
      false
    );

    const trachea = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.12, 0.02),
        new THREE.Vector3(0, 0.72, 0.02),
        new THREE.Vector3(0, 0.34, 0.015),
        new THREE.Vector3(0, 0.16, 0.015),
      ]),
      32,
      0.048,
      16,
      false
    );

    // Mainstem right & left bronchi splitting from carina
    const mainBronchi = [
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.18, 0.015),
          new THREE.Vector3(-0.14, 0.12, 0.02),
          new THREE.Vector3(-0.32, 0.06, 0.02),
        ]),
        16,
        0.034,
        12,
        false
      ),
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.18, 0.015),
          new THREE.Vector3(0.16, 0.11, 0.02),
          new THREE.Vector3(0.36, 0.05, 0.02),
        ]),
        16,
        0.033,
        12,
        false
      ),
    ];

    // Detailed pale ivory-rose bronchial & bronchiolar arborization visible inside translucent Left Lung (viewer right)
    const leftBranchSpecs: Array<{ pts: [number, number, number][]; r: number }> = [
      // Superior lobar bronchus + apical/anterior sub-branches
      { pts: [[0.34, 0.05, 0.02], [0.46, 0.22, 0.04], [0.5, 0.44, 0.02]], r: 0.021 },
      { pts: [[0.46, 0.22, 0.04], [0.64, 0.34, 0.05], [0.74, 0.46, 0.01]], r: 0.013 },
      { pts: [[0.46, 0.22, 0.04], [0.62, 0.2, 0.14], [0.72, 0.26, 0.16]], r: 0.012 },
      { pts: [[0.5, 0.44, 0.02], [0.42, 0.56, 0.01]], r: 0.009 },
      { pts: [[0.5, 0.44, 0.02], [0.59, 0.54, -0.02]], r: 0.009 },
      // Lingular divisions
      { pts: [[0.34, 0.05, 0.02], [0.52, -0.04, 0.08], [0.68, -0.1, 0.14]], r: 0.017 },
      { pts: [[0.52, -0.04, 0.08], [0.66, 0.06, 0.12], [0.78, 0.04, 0.1]], r: 0.011 },
      { pts: [[0.68, -0.1, 0.14], [0.77, -0.22, 0.14]], r: 0.009 },
      // Inferior lobar trunk + basal segmental/subsegmental tree
      { pts: [[0.34, 0.05, 0.02], [0.46, -0.14, 0.0], [0.54, -0.36, -0.02]], r: 0.02 },
      { pts: [[0.46, -0.14, 0.0], [0.66, -0.24, -0.04], [0.78, -0.36, -0.06]], r: 0.012 },
      { pts: [[0.54, -0.36, -0.02], [0.44, -0.5, 0.06], [0.38, -0.58, 0.08]], r: 0.011 },
      { pts: [[0.54, -0.36, -0.02], [0.64, -0.5, 0.02], [0.72, -0.58, 0.02]], r: 0.011 },
      { pts: [[0.66, -0.24, -0.04], [0.76, -0.16, -0.08]], r: 0.008 },
      { pts: [[0.64, -0.5, 0.02], [0.74, -0.46, 0.1]], r: 0.008 },
    ];
    const leftTreeGeos = leftBranchSpecs.map(
      (b) =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(b.pts.map(([px, py, pz]) => new THREE.Vector3(px, py, pz))),
          14,
          b.r,
          8,
          false
        )
    );

    const aorta = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.02, 0.04, 0.03),
        new THREE.Vector3(0.04, 0.2, 0.02),
        new THREE.Vector3(-0.04, 0.28, -0.02),
        new THREE.Vector3(-0.1, 0.16, -0.06),
      ]),
      24,
      0.034,
      10,
      false
    );
    const pulm = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.05, 0.01, 0.08),
        new THREE.Vector3(-0.02, 0.14, 0.05),
        new THREE.Vector3(0.16, 0.15, -0.01),
      ]),
      18,
      0.028,
      10,
      false
    );
    const vena = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.12, 0.03, -0.01),
        new THREE.Vector3(-0.12, 0.24, -0.02),
      ]),
      12,
      0.028,
      10,
      false
    );

    const fCurves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.54, 0.24),
        new THREE.Vector3(0, 1.38, 0.03),
        new THREE.Vector3(0, 0.72, 0.02),
        new THREE.Vector3(0, 0.18, 0.015),
        new THREE.Vector3(-0.34, 0.06, 0.02),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.54, 0.24),
        new THREE.Vector3(0, 1.38, 0.03),
        new THREE.Vector3(0, 0.72, 0.02),
        new THREE.Vector3(0, 0.18, 0.015),
        new THREE.Vector3(0.46, 0.22, 0.04),
        new THREE.Vector3(0.74, 0.46, 0.01),
      ]),
    ];

    return {
      lungTextures: lTex,
      bustGeo: bust,
      armGeos: arms,
      diaphragmGeo: diaph,
      nasalCavityGeos: nasalCavities,
      pharynxGeo: pharynx,
      tracheaGeo: trachea,
      bronchialGeos: mainBronchi,
      leftBronchialTreeGeos: leftTreeGeos,
      rightLungGeo: rLung,
      leftLungGeo: lLung,
      aortaGeo: aorta,
      pulmonaryGeo: pulm,
      venaCavaGeo: vena,
      flowCurves: fCurves,
    };
  }, []);

  useEffect(() => {
    return () => {
      lungTextures.colorMap.dispose();
      lungTextures.bumpMap.dispose();
      bustGeo.dispose();
      armGeos.forEach((g) => g.dispose());
      diaphragmGeo.dispose();
      nasalCavityGeos.forEach((g) => g.dispose());
      pharynxGeo.dispose();
      tracheaGeo.dispose();
      bronchialGeos.forEach((g) => g.dispose());
      leftBronchialTreeGeos.forEach((g) => g.dispose());
      rightLungGeo.dispose();
      leftLungGeo.dispose();
      aortaGeo.dispose();
      pulmonaryGeo.dispose();
      venaCavaGeo.dispose();
    };
  }, [
    lungTextures,
    bustGeo,
    armGeos,
    diaphragmGeo,
    nasalCavityGeos,
    pharynxGeo,
    tracheaGeo,
    bronchialGeos,
    leftBronchialTreeGeos,
    rightLungGeo,
    leftLungGeo,
    aortaGeo,
    pulmonaryGeo,
    venaCavaGeo,
  ]);

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
      lungsExpandRef.current.scale.set(1 + inhale * 0.045, 1 + inhale * 0.032, 1 + inhale * 0.05);
    }
    if (diaphragmRef.current) {
      diaphragmRef.current.position.y = -inhale * 0.055;
    }
    if (heartBeatRef.current && !reducedMotion) {
      const phase = (t * 1.2) % 1;
      const lub = Math.exp(-Math.pow((phase - 0.16) * 14, 2)) * 0.07;
      const dub = Math.exp(-Math.pow((phase - 0.34) * 16, 2)) * 0.04;
      heartBeatRef.current.scale.setScalar(1.0 + lub + dub);
    }

    if (flowDotsRef.current && !reducedMotion) {
      flowDotsRef.current.children.forEach((child, idx) => {
        const curve = flowCurves[idx % flowCurves.length];
        const phase = (t * 0.44 + idx * 0.16) % 1;
        child.position.copy(curve.getPointAt(phase));
        child.scale.setScalar(Math.max(0.25, Math.sin(phase * Math.PI) * 0.95));
      });
    }

    const slideProgress = THREE.MathUtils.clamp(sp / 0.2, 0, 1.5);
    const baseX = isDesktop ? 1.82 : 0.0;
    const baseY = isDesktop ? -0.18 : 0.08;
    grp.position.set(
      baseX - slideProgress * (isDesktop ? 0.95 : 0),
      baseY + (sp - 0.02) * 5.2,
      (1 - weight) * -4.2
    );
    grp.rotation.y = -0.16 + (reducedMotion ? 0 : Math.sin(t * 0.35) * 0.12) + sp * Math.PI * 2.4;
    grp.rotation.x = 0.03 + slideProgress * 0.22;
    grp.scale.setScalar((isDesktop ? 1.06 : 0.78) * (0.68 + 0.32 * weight));
    applyGroupFade(grp, weight);
  });

  const cartilageRingYs = Array.from({ length: 18 }, (_, idx) => 1.04 - idx * 0.05);

  return (
    <group ref={groupRef} position={[1.82, -0.18, 0]}>
      {/* Smooth semi-translucent human bust, ears, and tapered upper arms (matching clean studio aesthetic) */}
      <mesh geometry={bustGeo}>
        <meshPhysicalMaterial
          color="#dea28a"
          roughness={0.32}
          clearcoat={0.42}
          clearcoatRoughness={0.28}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>
      {armGeos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshPhysicalMaterial
            color="#dea28a"
            roughness={0.32}
            clearcoat={0.42}
            clearcoatRoughness={0.28}
            transparent
            opacity={0.33}
            depthWrite={false}
            side={THREE.FrontSide}
          />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`ear-${side}`} position={[side * 0.238, 1.55, -0.025]} rotation={[0.08, side * 0.18, side * -0.08]} scale={[0.45, 1.1, 0.75]}>
          <sphereGeometry args={[0.052, 14, 14]} />
          <meshPhysicalMaterial color="#dba088" roughness={0.34} transparent opacity={0.36} depthWrite={false} side={THREE.FrontSide} />
        </mesh>
      ))}

      {/* Internal Upper Airway: Nasal cavity, palate, pharynx, larynx & ringed trachea */}
      {nasalCavityGeos.map((g, i) => (
        <mesh key={`nas-${i}`} geometry={g}>
          <meshPhysicalMaterial color="#b93e44" roughness={0.36} clearcoat={0.5} transparent opacity={0.94} />
        </mesh>
      ))}
      {/* Nasal septal wing & anterior nostril flare */}
      <mesh position={[0, 1.51, 0.28]} scale={[0.68, 0.76, 0.9]}>
        <sphereGeometry args={[0.044, 16, 14]} />
        <meshPhysicalMaterial color="#be4348" roughness={0.38} clearcoat={0.45} transparent opacity={0.95} />
      </mesh>
      {/* Palate arch */}
      <mesh position={[0, 1.445, 0.16]} rotation={[0.12, 0, 0]} scale={[1.1, 0.42, 1.4]}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshStandardMaterial color="#e09e96" roughness={0.42} transparent opacity={0.94} />
      </mesh>
      <mesh geometry={pharynxGeo}>
        <meshPhysicalMaterial color="#b43d44" roughness={0.36} clearcoat={0.45} transparent opacity={0.93} />
      </mesh>
      {/* Hyoid arch & Larynx thyroid cartilage shield */}
      <mesh position={[0, 1.24, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.062, 0.011, 10, 24, Math.PI * 1.45]} />
        <meshStandardMaterial color="#e9ccc4" roughness={0.3} transparent opacity={0.96} />
      </mesh>
      <mesh position={[0, 1.15, 0.04]} scale={[1.08, 1.0, 0.96]}>
        <cylinderGeometry args={[0.068, 0.056, 0.125, 22]} />
        <meshPhysicalMaterial color="#cc6f69" roughness={0.34} clearcoat={0.45} transparent opacity={0.96} />
      </mesh>
      {/* Cricoid cartilage ring */}
      <mesh position={[0, 1.075, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.056, 0.011, 10, 24]} />
        <meshStandardMaterial color="#eed3cb" roughness={0.28} transparent opacity={0.98} />
      </mesh>

      {/* Ringed trachea + primary bronchi */}
      <mesh geometry={tracheaGeo}>
        <meshPhysicalMaterial color="#b33b3f" roughness={0.34} clearcoat={0.5} transparent opacity={0.96} />
      </mesh>
      {cartilageRingYs.map((ry) => (
        <mesh key={ry} position={[0, ry, 0.018]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.049, 0.0085, 9, 24]} />
          <meshStandardMaterial color="#edd5ce" roughness={0.28} transparent opacity={0.97} />
        </mesh>
      ))}
      {bronchialGeos.map((g, idx) => (
        <mesh key={`br-${idx}`} geometry={g}>
          <meshPhysicalMaterial color="#d89d94" roughness={0.32} clearcoat={0.4} transparent opacity={0.95} />
        </mesh>
      ))}

      {/* Dual-Contrast Lungs: Opaque Glossy Right Lung (viewer left) vs Translucent Left Lung with Crisp Bronchial Tree (viewer right) */}
      <group ref={lungsExpandRef}>
        <mesh geometry={rightLungGeo} position={[-0.45, -0.02, 0.01]} scale={0.86}>
          <meshPhysicalMaterial
            map={lungTextures.colorMap}
            bumpMap={lungTextures.bumpMap}
            bumpScale={0.028}
            color="#d85b4c"
            roughness={0.28}
            clearcoat={0.72}
            clearcoatRoughness={0.22}
            transparent
            opacity={0.97}
          />
        </mesh>

        {/* Crisp ivory-pink multi-generation bronchial tree inside the translucent Left Lung */}
        {leftBronchialTreeGeos.map((g, idx) => (
          <mesh key={`ltree-${idx}`} geometry={g}>
            <meshPhysicalMaterial color="#f6e9e4" roughness={0.25} clearcoat={0.35} transparent opacity={0.98} />
          </mesh>
        ))}

        {/* Translucent left lung pleural lobe shell wrapping the bronchial tree */}
        <mesh geometry={leftLungGeo} position={[0.45, -0.02, 0.01]} scale={0.86}>
          <meshPhysicalMaterial
            color="#ef9c84"
            roughness={0.22}
            clearcoat={0.62}
            clearcoatRoughness={0.2}
            transparent
            opacity={0.38}
            depthWrite={false}
            side={THREE.FrontSide}
          />
        </mesh>
      </group>

      {/* Subtle beating heart tucked behind left cardiac notch */}
      <group ref={heartBeatRef} position={[0.07, -0.18, 0.05]} scale={0.68}>
        <mesh position={[0.02, -0.06, 0.01]} rotation={[0.14, 0, -0.26]} scale={[0.88, 1.24, 0.82]}>
          <sphereGeometry args={[0.16, 24, 24]} />
          <meshPhysicalMaterial color="#b42d37" roughness={0.32} clearcoat={0.6} transparent opacity={0.88} />
        </mesh>
        <mesh geometry={aortaGeo}>
          <meshPhysicalMaterial color="#a62226" roughness={0.32} clearcoat={0.5} transparent opacity={0.86} />
        </mesh>
        <mesh geometry={pulmonaryGeo}>
          <meshPhysicalMaterial color="#4e6a8d" roughness={0.34} clearcoat={0.45} transparent opacity={0.84} />
        </mesh>
        <mesh geometry={venaCavaGeo}>
          <meshPhysicalMaterial color="#4e6a8d" roughness={0.34} clearcoat={0.45} transparent opacity={0.84} />
        </mesh>
      </group>

      {/* Sculpted muscular diaphragm dome + scalloped anterior costal crura */}
      <group ref={diaphragmRef}>
        <mesh geometry={diaphragmGeo}>
          <meshPhysicalMaterial
            color="#d88562"
            roughness={0.34}
            clearcoat={0.42}
            clearcoatRoughness={0.28}
            transparent
            opacity={0.95}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      <group ref={flowDotsRef}>
        {Array.from({ length: 5 }).map((_, idx) => (
          <mesh key={idx}>
            <sphereGeometry args={[0.016, 10, 10]} />
            <meshBasicMaterial color="#0066ff" transparent opacity={0.82} />
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
