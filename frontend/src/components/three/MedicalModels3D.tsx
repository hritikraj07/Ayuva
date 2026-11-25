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
function buildSculptedLungGeometry(side: -1 | 1): THREE.BufferGeometry {
  // side === -1 (anatomical right lung, 3 lobes); side === 1 (anatomical left lung, cardiac notch)
  const uSteps = 44;
  const vSteps = 52;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= uSteps; i++) {
    const u = (i / uSteps) * Math.PI;
    const sinU = Math.sin(u);
    const ny = Math.cos(u); // +1 apex -> -1 base

    // Organic vertical taper: rounded apex -> broad middle -> flared lower thoracic lobe
    const radialScale = Math.pow(Math.max(sinU, 0.0001), 0.72) * (0.76 + (1 - ny) * 0.2);

    for (let j = 0; j <= vSteps; j++) {
      const v = (j / vSteps) * Math.PI * 2;
      const cosV = Math.cos(v); // lateral (+side) vs medial (-side)
      const sinV = Math.sin(v); // anterior (+z) vs posterior (-z)

      let rx = 0.44 * radialScale;
      let rz = 0.42 * radialScale;

      // Flatten medial mediastinal surface cleanly so both lungs flank trachea & heart
      const medialness = Math.max(0, -side * cosV);
      rx *= 1 - medialness * 0.48;

      // Carve deep anatomical cardiac notch on lower anterior medial Left Lung (side === 1)
      if (side === 1 && ny < 0.18 && cosV < 0.05 && sinV > -0.25) {
        const notchFactor =
          Math.max(0, (0.18 - ny) / 1.18) *
          Math.max(0, (-cosV + 0.05) / 1.05) *
          Math.max(0, (sinV + 0.25) / 1.25);
        rx *= 1 - notchFactor * 0.58;
        rz *= 1 - notchFactor * 0.25;
      }

      // Subtle anatomical oblique & horizontal fissure creases
      const obliqueDist = Math.abs(ny - 0.28 * sinV + 0.06);
      const horizontalDist = side === -1 ? Math.abs(ny - 0.24) : 1.0;
      const crease =
        (obliqueDist < 0.08 ? (1 - obliqueDist / 0.08) * 0.055 : 0) +
        (horizontalDist < 0.06 && sinV > -0.2 ? (1 - horizontalDist / 0.06) * 0.045 : 0);

      let x = cosV * rx * (1 - crease);
      let z = sinV * rz * (1 - crease);
      let y = ny * 0.66;

      // Posteriorly slope base lower & cup diaphragmatic underside smoothly
      if (ny < -0.45) {
        const baseArch = (Math.abs(ny) - 0.45) / 0.55;
        y += baseArch * 0.22 * (1 - sinU * 0.35);
        y -= sinV * 0.06 * baseArch; // costophrenic posterior recess dips lower
      }

      // Gently tilt apex medially under 1st rib
      x -= side * Math.max(0, ny) * 0.12;
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

function buildSmoothHalfTorsoGeometry(): THREE.BufferGeometry {
  const ySteps = 56;
  const rSteps = 64;
  const positions: number[] = [];
  const indices: number[] = [];

  const profileAt = (y: number): { rx: number; rz: number } => {
    // y runs smoothly from -1.08 (diaphragm waist) -> +2.02 (cranium top)
    if (y < 0.55) {
      // Smooth curved waist -> ribcage -> broad shoulders
      const t = THREE.MathUtils.clamp((y + 1.08) / 1.63, 0, 1);
      const smooth = t * t * (3 - 2 * t);
      return {
        rx: THREE.MathUtils.lerp(0.84, 1.24, smooth) + Math.sin(t * Math.PI) * 0.04,
        rz: THREE.MathUtils.lerp(0.46, 0.58, Math.sin(t * Math.PI * 0.85)),
      };
    }
    if (y < 0.94) {
      // Curved shoulder cap -> trapezius slope -> base of neck
      const t = (y - 0.55) / 0.39;
      const smooth = t * t * (3 - 2 * t);
      return {
        rx: THREE.MathUtils.lerp(1.24, 0.25, smooth),
        rz: THREE.MathUtils.lerp(0.54, 0.23, smooth),
      };
    }
    if (y < 1.3) {
      // Slender sculpted neck
      const t = (y - 0.94) / 0.36;
      return {
        rx: THREE.MathUtils.lerp(0.25, 0.22, t),
        rz: THREE.MathUtils.lerp(0.23, 0.21, t),
      };
    }
    // Smooth oval cranium & jaw contour (no harsh octagonal edges)
    const t = THREE.MathUtils.clamp((y - 1.3) / 0.72, 0, 1);
    const dome = Math.sin(t * Math.PI * 0.92);
    return {
      rx: 0.2 + dome * 0.21,
      rz: 0.2 + dome * 0.25,
    };
  };

  for (let i = 0; i <= ySteps; i++) {
    const y = THREE.MathUtils.lerp(-1.08, 2.02, i / ySteps);
    const { rx, rz } = profileAt(y);
    for (let j = 0; j <= rSteps; j++) {
      const theta = (j / rSteps) * Math.PI * 2;
      positions.push(Math.cos(theta) * rx, y, Math.sin(theta) * rz);
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
  const ribcageRef = useRef<THREE.Group>(null);
  const diaphragmRef = useRef<THREE.Group>(null);
  const flowDotsRef = useRef<THREE.Group>(null);

  const {
    torsoShellGeo,
    rightLungGeo,
    leftLungGeo,
    tracheaGeo,
    bronchialGeos,
    aortaGeo,
    pulmonaryGeo,
    venaCavaGeo,
    coronaryLGeo,
    coronaryRGeo,
    ribGeos,
    costalCartilageGeos,
    sternumGeo,
    clavicleGeos,
    spineGeos,
    alveoliClusters,
    flowCurves,
  } = useMemo(() => {
    const torsoGeo = buildSmoothHalfTorsoGeometry();
    const rLung = buildSculptedLungGeometry(-1);
    const lLung = buildSculptedLungGeometry(1);

    const trachea = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.05),
        new THREE.Vector3(0, 1.06, 0.03),
        new THREE.Vector3(0, 0.48, 0.02),
        new THREE.Vector3(0, 0.16, 0.02),
      ]),
      36,
      0.062,
      18,
      false
    );

    // 4-generation anatomically branching bronchial tree reaching apex -> lateral -> basal lung segments
    const branches: Array<{ curve: THREE.CatmullRomCurve3; radius: number }> = [
      // Right Mainstem + Superior/Middle/Inferior Lobar + Segmental Twigs
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.18, 0.02),
          new THREE.Vector3(-0.22, 0.05, 0.02),
          new THREE.Vector3(-0.46, -0.05, 0.02),
        ]),
        radius: 0.044,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.32, 0.01, 0.02),
          new THREE.Vector3(-0.5, 0.22, 0.04),
          new THREE.Vector3(-0.62, 0.44, 0.0),
        ]),
        radius: 0.024,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.46, 0.18, 0.03),
          new THREE.Vector3(-0.72, 0.28, -0.04),
        ]),
        radius: 0.015,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.5, 0.22, 0.04),
          new THREE.Vector3(-0.46, 0.48, 0.06),
        ]),
        radius: 0.012,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.46, -0.05, 0.02),
          new THREE.Vector3(-0.66, -0.1, 0.14),
          new THREE.Vector3(-0.8, -0.22, 0.16),
        ]),
        radius: 0.022,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.66, -0.1, 0.14),
          new THREE.Vector3(-0.84, 0.02, 0.04),
        ]),
        radius: 0.014,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.42, -0.04, 0.02),
          new THREE.Vector3(-0.54, -0.34, -0.04),
          new THREE.Vector3(-0.66, -0.58, 0.02),
        ]),
        radius: 0.024,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.54, -0.34, -0.04),
          new THREE.Vector3(-0.82, -0.45, -0.08),
        ]),
        radius: 0.014,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.58, -0.44, -0.02),
          new THREE.Vector3(-0.44, -0.6, 0.08),
        ]),
        radius: 0.012,
      },
      // Left Mainstem + Superior/Lingular/Inferior Lobar + Segmental Twigs
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.18, 0.02),
          new THREE.Vector3(0.24, 0.04, 0.02),
          new THREE.Vector3(0.48, -0.05, 0.02),
        ]),
        radius: 0.042,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.36, 0.0, 0.02),
          new THREE.Vector3(0.54, 0.22, 0.04),
          new THREE.Vector3(0.64, 0.44, 0.0),
        ]),
        radius: 0.023,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.54, 0.22, 0.04),
          new THREE.Vector3(0.76, 0.28, -0.04),
        ]),
        radius: 0.014,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.5, 0.18, 0.04),
          new THREE.Vector3(0.48, 0.48, 0.06),
        ]),
        radius: 0.012,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.48, -0.05, 0.02),
          new THREE.Vector3(0.68, -0.14, 0.14),
          new THREE.Vector3(0.8, -0.26, 0.15),
        ]),
        radius: 0.021,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.68, -0.14, 0.14),
          new THREE.Vector3(0.84, -0.02, 0.04),
        ]),
        radius: 0.014,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.44, -0.04, 0.02),
          new THREE.Vector3(0.58, -0.34, -0.04),
          new THREE.Vector3(0.7, -0.58, 0.0),
        ]),
        radius: 0.022,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.58, -0.34, -0.04),
          new THREE.Vector3(0.82, -0.46, -0.08),
        ]),
        radius: 0.014,
      },
    ];

    const bronGeos = branches.map((b) => new THREE.TubeGeometry(b.curve, 20, b.radius, 10, false));
    const alvPos = branches.slice(1).map((b) => b.curve.getPointAt(1));

    // Detailed Anatomical Heart tucked inside Left Mediastinal Cardiac Notch
    const aorta = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.02, 0.04, 0.04),
        new THREE.Vector3(0.05, 0.24, 0.03),
        new THREE.Vector3(-0.04, 0.34, -0.02),
        new THREE.Vector3(-0.12, 0.22, -0.08),
        new THREE.Vector3(-0.08, -0.24, -0.1),
      ]),
      30,
      0.042,
      12,
      false
    );
    const pulm = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.06, 0.02, 0.1),
        new THREE.Vector3(-0.02, 0.18, 0.06),
        new THREE.Vector3(0.2, 0.2, -0.02),
      ]),
      20,
      0.034,
      10,
      false
    );
    const vena = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.15, 0.04, -0.01),
        new THREE.Vector3(-0.15, 0.3, -0.02),
      ]),
      14,
      0.035,
      10,
      false
    );
    const corL = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.02, 0.08, 0.15),
        new THREE.Vector3(0.11, -0.02, 0.21),
        new THREE.Vector3(0.06, -0.18, 0.17),
      ]),
      18,
      0.01,
      8,
      false
    );
    const corR = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.04, 0.06, 0.15),
        new THREE.Vector3(-0.13, -0.04, 0.18),
        new THREE.Vector3(-0.1, -0.18, 0.12),
      ]),
      16,
      0.009,
      8,
      false
    );

    const fCurves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.05),
        new THREE.Vector3(0, 0.85, 0.03),
        new THREE.Vector3(0, 0.18, 0.02),
        new THREE.Vector3(-0.32, 0.01, 0.02),
        new THREE.Vector3(-0.62, 0.44, 0.0),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.05),
        new THREE.Vector3(0, 0.85, 0.03),
        new THREE.Vector3(0, 0.18, 0.02),
        new THREE.Vector3(-0.42, -0.04, 0.02),
        new THREE.Vector3(-0.66, -0.58, 0.02),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.05),
        new THREE.Vector3(0, 0.85, 0.03),
        new THREE.Vector3(0, 0.18, 0.02),
        new THREE.Vector3(0.36, 0.0, 0.02),
        new THREE.Vector3(0.64, 0.44, 0.0),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, 0.05),
        new THREE.Vector3(0, 0.85, 0.03),
        new THREE.Vector3(0, 0.18, 0.02),
        new THREE.Vector3(0.44, -0.04, 0.02),
        new THREE.Vector3(0.7, -0.58, 0.0),
      ]),
    ];

    // 9 Pairs of Smooth Costal-Arch Ribs + Ivory Costal Cartilage Tips
    const ribs: THREE.BufferGeometry[] = [];
    const cartilages: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const y = 0.52 - i * 0.145;
      const w = 0.72 + Math.sin((i / 8) * Math.PI * 0.9) * 0.38;
      const d = 0.43 + Math.sin((i / 8) * Math.PI * 0.85) * 0.17;
      const sternalGap = i < 6 ? 0.08 : 0.2 + (i - 6) * 0.15;
      const cartY = i < 6 ? y - 0.1 : y - 0.04;
      for (const side of [-1, 1]) {
        const boneEnd = new THREE.Vector3(side * (w * 0.56), y - 0.11, d * 0.8);
        const ribCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.09, y + 0.09, -d * 0.94),
          new THREE.Vector3(side * (w * 0.82), y + 0.03, -d * 0.52),
          new THREE.Vector3(side * w, y - 0.05, 0.02),
          boneEnd,
        ]);
        ribs.push(new THREE.TubeGeometry(ribCurve, 24, 0.017, 8, false));

        if (i < 8) {
          const cartCurve = new THREE.CatmullRomCurve3([
            boneEnd,
            new THREE.Vector3(side * sternalGap, cartY, d * 0.9),
          ]);
          cartilages.push(new THREE.TubeGeometry(cartCurve, 8, 0.014, 7, false));
        }
      }
    }

    const sternum = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.58, 0.43),
        new THREE.Vector3(0, 0.34, 0.49),
        new THREE.Vector3(0, -0.24, 0.48),
        new THREE.Vector3(0, -0.36, 0.44),
      ]),
      18,
      0.044,
      10,
      false
    );

    const clavicles = [-1, 1].map((side) =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.07, 0.62, 0.41),
          new THREE.Vector3(side * 0.38, 0.72, 0.36),
          new THREE.Vector3(side * 0.72, 0.68, 0.22),
          new THREE.Vector3(side * 1.06, 0.63, 0.05),
        ]),
        20,
        0.025,
        10,
        false
      )
    );

    const spineVerts = Array.from({ length: 12 }, (_, idx) => new THREE.Vector3(0, 0.82 - idx * 0.15, -0.44));

    return {
      torsoShellGeo: torsoGeo,
      rightLungGeo: rLung,
      leftLungGeo: lLung,
      tracheaGeo: trachea,
      bronchialGeos: bronGeos,
      aortaGeo: aorta,
      pulmonaryGeo: pulm,
      venaCavaGeo: vena,
      coronaryLGeo: corL,
      coronaryRGeo: corR,
      ribGeos: ribs,
      costalCartilageGeos: cartilages,
      sternumGeo: sternum,
      clavicleGeos: clavicles,
      spineGeos: spineVerts,
      alveoliClusters: alvPos,
      flowCurves: fCurves,
    };
  }, []);

  useEffect(() => {
    return () => {
      torsoShellGeo.dispose();
      rightLungGeo.dispose();
      leftLungGeo.dispose();
      tracheaGeo.dispose();
      bronchialGeos.forEach((g) => g.dispose());
      aortaGeo.dispose();
      pulmonaryGeo.dispose();
      venaCavaGeo.dispose();
      coronaryLGeo.dispose();
      coronaryRGeo.dispose();
      ribGeos.forEach((g) => g.dispose());
      costalCartilageGeos.forEach((g) => g.dispose());
      sternumGeo.dispose();
      clavicleGeos.forEach((g) => g.dispose());
    };
  }, [
    torsoShellGeo,
    rightLungGeo,
    leftLungGeo,
    tracheaGeo,
    bronchialGeos,
    aortaGeo,
    pulmonaryGeo,
    venaCavaGeo,
    coronaryLGeo,
    coronaryRGeo,
    ribGeos,
    costalCartilageGeos,
    sternumGeo,
    clavicleGeos,
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
      lungsExpandRef.current.scale.set(1 + inhale * 0.05, 1 + inhale * 0.038, 1 + inhale * 0.06);
    }
    if (ribcageRef.current) {
      ribcageRef.current.scale.set(1 + inhale * 0.03, 1 + inhale * 0.015, 1 + inhale * 0.036);
    }
    if (diaphragmRef.current) {
      diaphragmRef.current.position.y = -0.82 - inhale * 0.07;
    }
    if (heartBeatRef.current && !reducedMotion) {
      const phase = (t * 1.2) % 1;
      const lub = Math.exp(-Math.pow((phase - 0.16) * 14, 2)) * 0.075;
      const dub = Math.exp(-Math.pow((phase - 0.34) * 16, 2)) * 0.045;
      heartBeatRef.current.scale.setScalar(1.0 + lub + dub);
    }

    if (flowDotsRef.current && !reducedMotion) {
      flowDotsRef.current.children.forEach((child, idx) => {
        const curve = flowCurves[idx % flowCurves.length];
        const phase = (t * 0.44 + idx * 0.14) % 1;
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
    grp.scale.setScalar((isDesktop ? 1.0 : 0.72) * (0.68 + 0.32 * weight));
    applyGroupFade(grp, weight);
  });

  const cartilageRingYs = Array.from({ length: 14 }, (_, idx) => 0.98 - idx * 0.058);

  return (
    <group ref={groupRef} position={[1.85, -0.18, 0]}>
      {/* Studio Porcelain Halo Rings behind the Half-Body Respiratory Model */}
      <mesh position={[0, 0.1, -0.58]}>
        <ringGeometry args={[0.98, 1.52, 72]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.58} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.1, -0.62]}>
        <ringGeometry args={[1.58, 1.86, 72]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.32} side={THREE.DoubleSide} />
      </mesh>

      {/* Smooth Contoured Half-Body Glass Silhouette (No Low-Poly Facets) */}
      <mesh geometry={torsoShellGeo}>
        <meshPhysicalMaterial
          color="#e2e8f0"
          roughness={0.18}
          clearcoat={0.65}
          transparent
          opacity={0.13}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Clean Diaphragm / Waist Half-Body Section Ring */}
      <mesh position={[0, -1.07, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.55, 1]}>
        <torusGeometry args={[0.84, 0.013, 12, 64]} />
        <meshStandardMaterial color="#0066ff" transparent opacity={0.72} />
      </mesh>

      {/* Nasal / Pharyngeal Airway Entry Beacon */}
      <mesh position={[0, 1.54, 0.24]}>
        <sphereGeometry args={[0.042, 16, 16]} />
        <meshStandardMaterial color="#0066ff" emissive="#0066ff" emissiveIntensity={0.4} transparent opacity={0.85} />
      </mesh>

      {/* Sculpted Thyroid Cartilage Shield + Cricoid Larynx + 14 Hyaline C-Rings */}
      <mesh position={[0, 1.11, 0.04]} scale={[1.15, 1, 0.95]}>
        <cylinderGeometry args={[0.095, 0.075, 0.16, 24]} />
        <meshPhysicalMaterial color="#cbd5e1" roughness={0.26} clearcoat={0.55} transparent opacity={0.94} />
      </mesh>
      <mesh position={[0, 1.02, 0.035]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.076, 0.018, 10, 28]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.22} transparent opacity={0.96} />
      </mesh>
      <mesh geometry={tracheaGeo}>
        <meshPhysicalMaterial color="#e2e8f0" roughness={0.22} clearcoat={0.55} transparent opacity={0.9} />
      </mesh>
      {cartilageRingYs.map((ry) => (
        <mesh key={ry} position={[0, ry, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.068, 0.012, 10, 28]} />
          <meshStandardMaterial color="#ffffff" roughness={0.2} transparent opacity={0.98} />
        </mesh>
      ))}

      {/* 4-Generation Branching Bronchial Tree & Multi-Berry Alveolar Acini Clusters */}
      <group>
        {bronchialGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshPhysicalMaterial
              color={idx < 2 || idx === 9 ? "#0066ff" : "#3b82f6"}
              emissive="#0066ff"
              emissiveIntensity={0.18}
              roughness={0.22}
              clearcoat={0.45}
              transparent
              opacity={0.95}
            />
          </mesh>
        ))}
        {alveoliClusters.map((pos, idx) => (
          <group key={idx} position={pos}>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.034, 12, 12]} />
              <meshStandardMaterial color="#0066ff" emissive="#2563eb" emissiveIntensity={0.35} transparent opacity={0.92} />
            </mesh>
            <mesh position={[0.032, -0.022, 0.016]}>
              <sphereGeometry args={[0.026, 10, 10]} />
              <meshStandardMaterial color="#60a5fa" emissive="#0066ff" emissiveIntensity={0.3} transparent opacity={0.88} />
            </mesh>
            <mesh position={[-0.026, -0.02, -0.014]}>
              <sphereGeometry args={[0.024, 10, 10]} />
              <meshStandardMaterial color="#93c5fd" transparent opacity={0.86} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Seamless Anatomically Sculpted Lungs (3-Lobe Right & 2-Lobe Left w/ Cardiac Notch) */}
      <group ref={lungsExpandRef}>
        <mesh geometry={rightLungGeo} position={[-0.56, -0.06, 0.02]}>
          <meshPhysicalMaterial
            color="#ff3b5c"
            roughness={0.26}
            clearcoat={0.82}
            clearcoatRoughness={0.2}
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
        <mesh geometry={leftLungGeo} position={[0.56, -0.06, 0.02]}>
          <meshPhysicalMaterial
            color="#ff3b5c"
            roughness={0.26}
            clearcoat={0.82}
            clearcoatRoughness={0.2}
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* Anatomically Sculpted Multi-Vessel Beating Heart tucked inside the Left Cardiac Notch */}
      <group ref={heartBeatRef} position={[0.12, -0.22, 0.14]} scale={0.94}>
        <mesh position={[0.02, -0.07, 0.01]} rotation={[0.14, 0, -0.26]} scale={[0.88, 1.24, 0.82]}>
          <sphereGeometry args={[0.18, 28, 28]} />
          <meshPhysicalMaterial color="#ef233c" roughness={0.26} clearcoat={0.72} transparent opacity={0.96} />
        </mesh>
        <mesh position={[-0.08, -0.04, 0.04]} rotation={[0.1, 0.2, 0.16]} scale={[0.74, 1.02, 0.7]}>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshPhysicalMaterial color="#d90429" roughness={0.3} clearcoat={0.62} transparent opacity={0.95} />
        </mesh>
        <mesh position={[0.09, 0.09, -0.01]} scale={[0.88, 0.84, 0.8]}>
          <sphereGeometry args={[0.09, 20, 20]} />
          <meshPhysicalMaterial color="#ff4d6d" roughness={0.3} clearcoat={0.55} transparent opacity={0.95} />
        </mesh>
        <mesh geometry={aortaGeo}>
          <meshPhysicalMaterial color="#ef233c" roughness={0.26} clearcoat={0.65} transparent opacity={0.96} />
        </mesh>
        <mesh geometry={pulmonaryGeo}>
          <meshPhysicalMaterial color="#0066ff" roughness={0.28} clearcoat={0.55} transparent opacity={0.96} />
        </mesh>
        <mesh geometry={venaCavaGeo}>
          <meshPhysicalMaterial color="#2563eb" roughness={0.3} clearcoat={0.5} transparent opacity={0.94} />
        </mesh>
        <mesh geometry={coronaryLGeo}>
          <meshStandardMaterial color="#fda4af" roughness={0.28} transparent opacity={0.98} />
        </mesh>
        <mesh geometry={coronaryRGeo}>
          <meshStandardMaterial color="#fda4af" roughness={0.28} transparent opacity={0.98} />
        </mesh>
      </group>

      {/* Breathing Costal-Arch Ribcage, Hyaline Costal Cartilage, Sternum, Clavicles & Thoracic Spine */}
      <group ref={ribcageRef}>
        {ribGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshStandardMaterial color="#ffffff" roughness={0.26} metalness={0.05} transparent opacity={0.9} />
          </mesh>
        ))}
        {costalCartilageGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshStandardMaterial color="#dbeafe" roughness={0.3} transparent opacity={0.85} />
          </mesh>
        ))}
        <mesh geometry={sternumGeo}>
          <meshStandardMaterial color="#f1f5f9" roughness={0.26} metalness={0.08} transparent opacity={0.94} />
        </mesh>
        {clavicleGeos.map((g, idx) => (
          <mesh key={idx} geometry={g}>
            <meshStandardMaterial color="#ffffff" roughness={0.24} transparent opacity={0.95} />
          </mesh>
        ))}
        {spineGeos.map((pos, idx) => (
          <mesh key={idx} position={pos}>
            <cylinderGeometry args={[0.06, 0.064, 0.1, 16]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.35} transparent opacity={0.8} />
          </mesh>
        ))}
      </group>

      {/* Dual-Dome Muscular Diaphragm */}
      <group ref={diaphragmRef} position={[0, -0.82, 0.02]}>
        <mesh position={[-0.36, 0.03, 0]} scale={[0.56, 0.24, 0.45]}>
          <sphereGeometry args={[0.88, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshPhysicalMaterial color="#ef233c" roughness={0.28} clearcoat={0.55} transparent opacity={0.78} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.36, 0, 0]} scale={[0.54, 0.22, 0.45]}>
          <sphereGeometry args={[0.88, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshPhysicalMaterial color="#d90429" roughness={0.28} clearcoat={0.55} transparent opacity={0.78} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Animated Oxygen Flow Particles along Upper Airway -> Terminal Bronchioles */}
      <group ref={flowDotsRef}>
        {Array.from({ length: 10 }).map((_, idx) => (
          <mesh key={idx}>
            <sphereGeometry args={[0.025, 10, 10]} />
            <meshBasicMaterial color="#0066ff" transparent opacity={0.95} />
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
