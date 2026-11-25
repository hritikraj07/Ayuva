import * as THREE from "three";

export function createHologramShaderMaterial(options?: {
  baseColor?: string;
  rimColor?: string;
  opacity?: number;
  scanSpeed?: number;
}): THREE.ShaderMaterial {
  const baseColor = new THREE.Color(options?.baseColor ?? "#0284c7");
  const rimColor = new THREE.Color(options?.rimColor ?? "#323a4d");

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: baseColor },
      uRimColor: { value: rimColor },
      uOpacity: { value: options?.opacity ?? 0.62 },
      uScanSpeed: { value: options?.scanSpeed ?? 1.2 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPos;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uRimColor;
      uniform float uOpacity;
      uniform float uScanSpeed;

      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPos;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.1);
        float scan = 0.78 + 0.22 * sin(vWorldPos.y * 12.0 - uTime * uScanSpeed);
        float fineGrid = 0.92 + 0.08 * sin(vWorldPos.x * 32.0 + vWorldPos.z * 32.0);
        vec3 color = mix(uBaseColor, uRimColor, clamp(fresnel * 1.1, 0.0, 1.0));
        float alpha = clamp((0.22 + fresnel * 0.78) * scan * fineGrid * uOpacity, 0.08, 0.92);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

export function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}
