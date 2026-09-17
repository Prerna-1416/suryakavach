import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getRealEarthTextures } from './textures';

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSunPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunPos - vWorld);
    vec3 dayCol = texture2D(uDay, vUv).rgb;
    vec3 nightCol = texture2D(uNight, vUv).rgb;

    float day = max(dot(N, L), 0.0);
    vec3 lit = dayCol * (0.12 + 1.25 * day);

    float night = smoothstep(0.12, -0.28, dot(N, L));
    vec3 city = pow(nightCol, vec3(1.4)) * 1.1 * night;

    vec3 col = lit + city;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CLOUDS_FRAG = /* glsl */ `
  uniform sampler2D uClouds;
  uniform vec3 uSunPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunPos - vWorld);
    float day = max(dot(N, L), 0.0);
    float c = texture2D(uClouds, vUv).r;
    float alpha = c * (0.5 + 0.5 * day);
    gl_FragColor = vec4(vec3(0.92), alpha * 0.55);
  }
`;

const SHELL_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHELL_FRAG = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    // Proper rim/fresnel term, clamped so it can never invert into a
    // bright spot near the poles — 0 at the disk centre and the far
    // side, peaking only at the grazing silhouette edge.
    float ndotv = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
    float rim = pow(clamp(1.0 - abs(ndotv), 0.0, 1.0), 3.0);
    gl_FragColor = vec4(0.22, 0.58, 1.0, 1.0) * rim * 0.9;
  }
`;

const SUN_POS = new THREE.Vector3(-6.2, -0.8, 1.2);

interface EarthProps {
  position?: [number, number, number];
  scale?: number;
}

/**
 * Rotating Earth: real photographic day/night/cloud textures (public
 * domain-derived, CC BY 4.0), night-side city lights, day/night terminator
 * facing the Sun, a drifting cloud layer, and an additive atmosphere shell.
 */
export default function Earth({ position = [4.9, -2.4, 0.2], scale = 1.25 }: EarthProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const { day, night, clouds: cloudsTex } = useMemo(() => getRealEarthTextures(), []);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 96, 96), []);

  useFrame((_, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.07;
    if (clouds.current) clouds.current.rotation.y += delta * 0.084;
  });

  return (
    <group position={position} scale={scale} rotation={[0.42, 0, 0]}>
      <mesh ref={mesh} geometry={geometry}>
        <shaderMaterial
          vertexShader={EARTH_VERT}
          fragmentShader={EARTH_FRAG}
          uniforms={{
            uDay: { value: day },
            uNight: { value: night },
            uSunPos: { value: SUN_POS },
          }}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={clouds} geometry={geometry} scale={1.012}>
        <shaderMaterial
          vertexShader={EARTH_VERT}
          fragmentShader={CLOUDS_FRAG}
          uniforms={{
            uClouds: { value: cloudsTex },
            uSunPos: { value: SUN_POS },
          }}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={geometry} scale={1.055}>
        <shaderMaterial
          vertexShader={SHELL_VERT}
          fragmentShader={SHELL_FRAG}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}