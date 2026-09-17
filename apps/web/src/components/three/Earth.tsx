import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthTextures } from './textures';

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
  uniform sampler2D uLand;
  uniform sampler2D uLights;
  uniform vec3 uSunPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunPos - vWorld);
    float land = texture2D(uLand, vUv).r;

    vec3 ocean = vec3(0.02, 0.09, 0.24);
    vec3 landC = vec3(0.14, 0.38, 0.25);
    vec3 base = mix(ocean, landC, land);

    float day = max(dot(N, L), 0.0);
    vec3 lit = base * (0.28 + 1.35 * day);

    float night = smoothstep(0.14, -0.3, dot(N, L));
    float lights = texture2D(uLights, vUv).r;
    vec3 city = vec3(1.0, 0.85, 0.42) * pow(lights, 1.4) * night * 2.1;

    vec3 V = vec3(0.0, 0.0, 1.0);
    float fr = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    vec3 atmo = vec3(0.24, 0.62, 1.0) * day * 0.55 * fr;

    vec3 col = lit + city + atmo;
    gl_FragColor = vec4(col, 1.0);
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
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    gl_FragColor = vec4(0.22, 0.58, 1.0, 1.0) * intensity;
  }
`;

interface EarthProps {
  position?: [number, number, number];
  scale?: number;
}

/**
 * Rotating Earth: procedural land mask, emissive night-side city lights,
 * day/night terminator facing the Sun, and an additive atmosphere shell.
 */
export default function Earth({ position = [4.9, -2.4, 0.2], scale = 1.25 }: EarthProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const { land, lights } = useMemo(() => getEarthTextures(), []);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 96, 96), []);

  useFrame((_, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.07;
  });

  return (
    <group position={position} scale={scale} rotation={[0.42, 0, 0]}>
      <mesh ref={mesh} geometry={geometry}>
        <shaderMaterial
          vertexShader={EARTH_VERT}
          fragmentShader={EARTH_FRAG}
          uniforms={{
            uLand: { value: land },
            uLights: { value: lights },
            uSunPos: { value: new THREE.Vector3(-6.2, -0.8, 1.2) },
          }}
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