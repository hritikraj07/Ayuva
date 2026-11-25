import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { latLngToVector3 } from "./shaders";
import { useSceneCapabilities, useVisibilityPause, WebGLErrorBoundary } from "./useSceneCapabilities";

export interface GlobeRegionNode {
  region_id: number;
  region_name: string;
  state: string;
  latitude: number;
  longitude: number;
  risk_level: string;
  risk_score: number | null;
  observed_cases_recent: number;
  observed_deaths_recent: number;
}

const RISK_HEX: Record<string, string> = {
  low: "#10b981",
  moderate: "#f59e0b",
  high: "#f97316",
  critical: "#f43f5e",
  insufficient_data: "#64748b",
};

function GlobeMesh({
  nodes,
  selectedRegionId,
  onSelectRegion,
  hoveredId,
  setHoveredId,
  simulationActive,
}: {
  nodes: GlobeRegionNode[];
  selectedRegionId: number | null;
  onSelectRegion?: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
  simulationActive?: boolean;
}) {
  const globeRef = useRef<THREE.Group>(null);
  const radius = 1.65;

  const points = useMemo(
    () =>
      nodes
        .filter((n) => typeof n.latitude === "number" && typeof n.longitude === "number")
        .map((n) => ({
          ...n,
          pos: latLngToVector3(n.latitude, n.longitude, radius + 0.03),
          color: RISK_HEX[n.risk_level] || RISK_HEX.insufficient_data,
        })),
    [nodes]
  );

  const arcGeometries = useMemo(() => {
    const active = points.filter((p) => p.observed_cases_recent > 0).slice(0, 8);
    const arcs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < active.length - 1; i++) {
      const a = active[i].pos;
      const b = active[i + 1].pos;
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).normalize().multiplyScalar(radius + 0.34);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      arcs.push(new THREE.TubeGeometry(curve, 24, 0.009, 6, false));
    }
    return arcs;
  }, [points]);

  useEffect(() => {
    return () => {
      arcGeometries.forEach((g) => g.dispose());
    };
  }, [arcGeometries]);

  useFrame((_, delta) => {
    if (globeRef.current && hoveredId === null) {
      globeRef.current.rotation.y += delta * (simulationActive ? 0.18 : 0.08);
    }
  });

  return (
    <group ref={globeRef} rotation={[0.35, -1.35, 0]}>
      <mesh>
        <sphereGeometry args={[radius - 0.02, 42, 42]} />
        <meshStandardMaterial color="#1e293b" roughness={0.55} />
      </mesh>

      <mesh>
        <sphereGeometry args={[radius, 30, 30]} />
        <meshBasicMaterial color="#66a9ec" wireframe transparent opacity={0.42} />
      </mesh>

      <mesh>
        <sphereGeometry args={[radius + 0.08, 32, 32]} />
        <meshBasicMaterial color={simulationActive ? "#4f46e5" : "#0284c7"} transparent opacity={0.08} side={THREE.BackSide} />
      </mesh>

      <mesh rotation={[Math.PI / 2.3, 0.2, 0]}>
        <torusGeometry args={[radius + 0.32, 0.01, 8, 96]} />
        <meshBasicMaterial color="#323a4d" transparent opacity={0.45} />
      </mesh>

      {arcGeometries.map((geo, idx) => (
        <mesh key={idx} geometry={geo}>
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} />
        </mesh>
      ))}

      {points.map((pt) => {
        const isSelected = pt.region_id === selectedRegionId;
        const isHovered = pt.region_id === hoveredId;
        const size = isSelected ? 0.068 : isHovered ? 0.056 : pt.observed_cases_recent > 0 ? 0.046 : 0.032;
        return (
          <mesh
            key={pt.region_id}
            position={pt.pos}
            onClick={(e) => {
              e.stopPropagation();
              onSelectRegion?.(pt.region_id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoveredId(pt.region_id);
            }}
            onPointerOut={() => setHoveredId(null)}
          >
            <sphereGeometry args={[size, 14, 14]} />
            <meshStandardMaterial
              color={pt.color}
              emissive={pt.color}
              emissiveIntensity={isSelected ? 1.6 : 0.9}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export function OutbreakGlobe3D({
  regions,
  selectedRegionId,
  onSelectRegion,
  heightClass = "h-[360px]",
  simulationActive = false,
}: {
  regions: GlobeRegionNode[];
  selectedRegionId: number | null;
  onSelectRegion?: (id: number) => void;
  heightClass?: string;
  simulationActive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const caps = useSceneCapabilities();
  const isVisible = useVisibilityPause(containerRef);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const hoveredNode = useMemo(
    () => regions.find((r) => r.region_id === hoveredId) || null,
    [regions, hoveredId]
  );

  if (!caps.hasWebGL) {
    return (
      <div className={`neo-glass flex items-center justify-center rounded-xl p-6 text-center text-xs text-muted-foreground ${heightClass}`}>
        Interactive 3D globe requires WebGL; use the 2D Geospatial Risk Map and district table below for full regional analytics.
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative w-full overflow-hidden rounded-xl border border-slate-300 bg-gradient-to-br from-white via-[#d9eef3] to-[#b9d3ec] ${heightClass}`}>
      <WebGLErrorBoundary
        fallback={
          <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
            3D WebGL view unavailable on this GPU; switch to 2D Leaflet Map view.
          </div>
        }
      >
        <Canvas
          dpr={caps.dpr}
          frameloop={isVisible && !caps.reducedMotion ? "always" : "demand"}
          camera={{ position: [0, 0.4, 4.3], fov: 42 }}
          gl={{ antialias: !caps.isLowPower, alpha: true }}
        >
          <ambientLight intensity={0.95} />
          <directionalLight position={[4, 5, 4]} intensity={1.3} color="#ffffff" />
          <pointLight position={[-4, -3, -2]} intensity={0.8} color="#66a9ec" />
          <GlobeMesh
            nodes={regions}
            selectedRegionId={selectedRegionId}
            onSelectRegion={onSelectRegion}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            simulationActive={simulationActive}
          />
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={0.6} enableDamping />
        </Canvas>
      </WebGLErrorBoundary>

      <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-md border border-slate-300 bg-white/90 px-2.5 py-1 font-mono text-primary backdrop-blur-md">
          {regions.length > 0 ? `${regions.length} Synced District Marker(s)` : "Awaiting Official Surveillance Sync"}
        </span>
      </div>

      {hoveredNode && (
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-xs rounded-lg border border-slate-300 bg-white/95 p-3 text-xs shadow-md backdrop-blur-md">
          <div className="font-semibold text-primary">
            {hoveredNode.region_name}, {hoveredNode.state}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-700">
            Observed Cases: {hoveredNode.observed_cases_recent} | Deaths: {hoveredNode.observed_deaths_recent}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Risk: {hoveredNode.risk_score !== null ? `${hoveredNode.risk_score}/100 (${hoveredNode.risk_level})` : "Insufficient Data"}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 hidden sm:block text-[11px] font-medium text-primary/80">
        Drag to rotate globe · Click marker to inspect
      </div>
    </div>
  );
}
