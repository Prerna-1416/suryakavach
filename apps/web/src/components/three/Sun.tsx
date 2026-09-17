import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';

/* ------------------------------------------------------------------ */
/* Shaders                                                            */
/* ------------------------------------------------------------------ */

const SUN_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* Radial solar gradient: near-black yellow-mixed limb -> orange -> amber
   -> yellow -> a single soft hotspot at the centre. The edge dims into a
   burnt dark tone instead of a bright ring, so the sphere reads as a
   dimensional body, not a flat glowing circle. */
const SUN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  varying vec3 vNormal;
  varying vec3 vPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vPos);
    // 1 at the visible disk centre -> 0 at the limb.
    float r = 1.0 - clamp(vNormal.z, 0.0, 1.0);

    // Crisp granulation, coarse mottling and occasional dark pores.
    float t = uTime;
    float gran  = fbm(dir * 13.0 + vec3(0.0, -t * 0.016, t * 0.013));
    float mottle = fbm(dir * 3.1 + vec3(t * 0.010, 0.0, t * 0.006));
    float pores = smoothstep(0.60, 0.82, mottle);
    float cells = smoothstep(0.38, 0.50, gran) * (0.7 + 0.3 * gran);
    float rough = mix(mottle, cells, 0.82) * (1.0 - pores * 0.5);
    float activity = clamp(rough + (rough - 0.5) * 0.5 * uEnergy, 0.0, 1.4);

    vec3 burnt  = vec3(0.045, 0.035, 0.008); /* black mixed with yellow */
    vec3 rim    = vec3(0.30, 0.16, 0.02);
    vec3 orange = vec3(1.00, 0.46, 0.05);
    vec3 amber  = vec3(1.00, 0.66, 0.13);
    vec3 yellow = vec3(1.00, 0.84, 0.32);
    vec3 white  = vec3(1.00, 0.95, 0.66);

    // Radial banding: dark limb -> orange -> amber -> yellow -> white core.
    vec3 col = mix(rim, orange, 1.0 - smoothstep(0.45, 0.9, r));
    col = mix(col, amber, 1.0 - smoothstep(0.20, 0.50, r));
    col = mix(col, yellow, 1.0 - smoothstep(0.05, 0.27, r));
    col = mix(col, white, (1.0 - smoothstep(0.0, 0.13, r)) * 0.88);

    // Rough plasma granulation across the surface.
    col *= 0.68 + 0.5 * activity;

    // Dimensional limb: bright surface fades into a burnt black-yellow
    // edge — volume, not a hard border.
    float limb = smoothstep(0.55, 1.0, r);
    col *= 1.0 - 0.62 * limb;
    col = mix(col, burnt, limb * 0.72);

    col *= 1.5;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const CORONA_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CORONA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uProximity;
  uniform float uEnergy;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = max(dot(normalize(vNormal), V), 0.0);
    // Smooth exponential falloff: a soft haze, never a crisp ring.
    float soft = exp(-SOFT * ndv);
    float alpha = soft * (BASE + 0.5 * uProximity + 0.35 * uEnergy);
    float pulse = 1.0 + 0.07 * sin(uTime * PULSE_SPEED);
    gl_FragColor = vec4(COLOR, 1.0) * alpha * pulse;
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (95.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d2 = dot(p, p);
    if (d2 > 0.25) discard;
    float a = (1.0 - smoothstep(0.0, 0.5, sqrt(d2) * 2.0)) * vAlpha;
    gl_FragColor = vec4(1.0, 0.62, 0.18, 1.0) * a * 0.9;
  }
`;

/* ------------------------------------------------------------------ */
/* Scene geometry                                                      */
/* ------------------------------------------------------------------ */

const SUN_CENTER = new THREE.Vector3(-5.9, 0.4, 0);
const EARTH_CENTER = new THREE.Vector3(4.9, -2.4, 0.2);
/** Outward bias of emitted radiation: from the Sun toward Earth. */
const BASE_DIR = new THREE.Vector3().subVectors(EARTH_CENTER, SUN_CENTER).normalize();
/** Perpendicular drift axis (toward/away from the viewer) for curved streaks. */
const LATERAL = new THREE.Vector3().crossVectors(BASE_DIR, new THREE.Vector3(0, 1, 0)).normalize();
/** Secondary drift axis (screen-space up/down). */
const VERTICAL = new THREE.Vector3().crossVectors(BASE_DIR, LATERAL).normalize();

const helperV = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

const POOL = 340;
const STREAKS = 150;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SunProps {
  inside?: MotionValue<number>;
  reduced?: boolean;
}

export default function Sun({ inside, reduced = false }: SunProps) {
  const [tiny, setTiny] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setTiny(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const scale = tiny ? 1.55 : 2.7;
  const group = useRef<THREE.Group>(null);
  const sunMat = useRef<THREE.ShaderMaterial>(null);
  const innerCorona = useRef<THREE.ShaderMaterial>(null);
  const outerCorona = useRef<THREE.ShaderMaterial>(null);
  const particleMat = useRef<THREE.ShaderMaterial>(null);
  const streakMat = useRef<THREE.LineBasicMaterial>(null);

  const hovered = useRef(false);
  const motion = useRef({ prox: 0, energy: 0 });
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const project = useMemo(() => new THREE.Vector3(), []);
  const now = useRef({ t: 0 });
  const emitAcc = useRef({ particles: 0, streaks: 0 });

  /* Particle + streak pools (CPU state, positions pushed to GPU). */
  const pools = useMemo(() => {
    const rand = mulberry32(999331);
    const P = Array.from({ length: POOL }, () => ({
      alive: false,
      age: 0,
      life: 1.2 + rand() * 2.4,
      speed: 0.55 + rand() * 0.7,
      size: 0.26 + rand() * 0.5,
      ox: 0, oy: 0, oz: 0,
      dx: 0, dy: 0, dz: 0,
      curl: (rand() - 0.5) * 0.9,
      curl2: (rand() - 0.5) * 0.6,
    }));
    const S = Array.from({ length: STREAKS }, () => ({
      alive: false,
      age: 0,
      life: 0.45 + rand() * 0.6,
      len: 0.35 + rand() * 0.55,
      speed: 2.4 + rand() * 1.4,
      ox: 0, oy: 0, oz: 0,
      dx: 0, dy: 0, dz: 0,
    }));
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL * 3), 3));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(POOL), 1));
    pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(POOL), 1));
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3));
    return { P, S, pGeo, sGeo, rand };
  }, []);

  const spawn = (rand: () => number) => {
    const R = scaleRef.current;
    for (const p of pools.P) {
      if (!p.alive) {
        // Random point on the right-facing hemisphere of the sphere.
        tmpPos.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (tmpPos.x < 0.2) tmpPos.x = 0.2 + rand() * 0.2;
        tmpPos.normalize().multiplyScalar(1.03 + rand() * 0.06);
        tmpDir
          .copy(BASE_DIR)
          .add(helperV.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9))
          .normalize();
        p.alive = true;
        p.age = 0;
        p.life = 1.2 + rand() * 2.4;
        p.speed = (0.55 + rand() * 0.7) * (R / 2.7);
        p.ox = tmpPos.x; p.oy = tmpPos.y; p.oz = tmpPos.z;
        p.dx = tmpDir.x; p.dy = tmpDir.y; p.dz = tmpDir.z;
        p.curl = (rand() - 0.5) * 0.9;
        p.curl2 = (rand() - 0.5) * 0.6;
        return;
      }
    }
  };

  const spawnStreak = (rand: () => number) => {
    for (const s of pools.S) {
      if (!s.alive) {
        tmpPos.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (tmpPos.x < 0.2) tmpPos.x = 0.2 + rand() * 0.2;
        tmpPos.normalize().multiplyScalar(1.06 + rand() * 0.08);
        tmpDir
          .copy(BASE_DIR)
          .add(helperV.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.55))
          .normalize();
        s.alive = true;
        s.age = 0;
        s.life = 0.45 + rand() * 0.6;
        s.len = 0.35 + rand() * 0.55;
        s.speed = 2.4 + rand() * 1.4;
        s.ox = tmpPos.x; s.oy = tmpPos.y; s.oz = tmpPos.z;
        s.dx = tmpDir.x; s.dy = tmpDir.y; s.dz = tmpDir.z;
        return;
      }
    }
  };

  /* ------------------------------------------------------------------ */

  const insideRef = useRef(1);
  insideRef.current = inside?.get() ?? 1;

  useFrame(({ camera, pointer, clock }) => {
    const t = clock.elapsedTime;
    const dt = Math.min(0.05, clock.getDelta());
    now.current.t = t;
    const R = scaleRef.current;

    if (!reduced && insideRef.current > 0) {
      /* Pointer NDC distance from the Sun's projected centre. */
      project.copy(SUN_CENTER).project(camera);
      const dx = pointer.x - project.x;
      const dy = pointer.y - project.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const halfWorld = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) * 0.5) * camera.position.length();
      const radiusNdc = R / halfWorld;
      const targetProx = THREE.MathUtils.clamp(1 - (dist - radiusNdc) / (radiusNdc * 2.0), 0, 1);
      motion.current.prox += (targetProx - motion.current.prox) * 0.08;
    } else {
      motion.current.prox += (0 - motion.current.prox) * 0.07;
    }
    const targetEnergy = hovered.current ? 1 : motion.current.prox * 0.7;
    const e = motion.current.energy + (targetEnergy - motion.current.energy) * 0.06;
    motion.current.energy = e;

    const Rr = R / 2.7;

    /* Emit radiation — always a trickle, richer while the Sun is active. */
    emitAcc.current.particles += dt * (1.4 + e * 22);
    emitAcc.current.streaks += dt * (e * 7);
    let guard = 6;
    while (emitAcc.current.particles >= 1 && guard-- > 0) {
      spawn(pools.rand);
      emitAcc.current.particles -= 1;
    }
    guard = 4;
    while (emitAcc.current.streaks >= 1 && guard-- > 0) {
      spawnStreak(pools.rand);
      emitAcc.current.streaks -= 1;
    }

    /* Update particles. */
    const posArr = pools.pGeo.attributes.position.array as Float32Array;
    const sizeArr = pools.pGeo.attributes.aSize.array as Float32Array;
    const alphaArr = pools.pGeo.attributes.aAlpha.array as Float32Array;
    for (let i = 0; i < POOL; i++) {
      const p = pools.P[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) {
          p.alive = false;
          posArr[i * 3] = posArr[i * 3 + 1] = posArr[i * 3 + 2] = 1e4;
          alphaArr[i] = 0;
          continue;
        }
        const k = Math.min(1, p.age / p.life);
        const s = p.speed * p.age;
        const sort = s * s;
        posArr[i * 3] = p.ox + p.dx * s + LATERAL.x * p.curl * sort + VERTICAL.x * p.curl2 * sort;
        posArr[i * 3 + 1] = p.oy + p.dy * s + LATERAL.y * p.curl * sort + VERTICAL.y * p.curl2 * sort;
        posArr[i * 3 + 2] = p.oz + p.dz * s + LATERAL.z * p.curl * sort + VERTICAL.z * p.curl2 * sort;
        alphaArr[i] = Math.sin(Math.PI * k) * (0.4 + 0.6 * e);
        sizeArr[i] = p.size * Rr;
      } else {
        posArr[i * 3] = posArr[i * 3 + 1] = posArr[i * 3 + 2] = 1e4;
        alphaArr[i] = 0;
        sizeArr[i] = p.size * Rr;
      }
    }
    pools.pGeo.attributes.position.needsUpdate = true;
    pools.pGeo.attributes.aAlpha.needsUpdate = true;
    pools.pGeo.attributes.aSize.needsUpdate = true;

    /* Update streaks. */
    const stArr = pools.sGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < STREAKS; i++) {
      const s = pools.S[i];
      const o = i * 6;
      if (s.alive) {
        s.age += dt;
        if (s.age >= s.life) {
          s.alive = false;
          stArr[o] = stArr[o + 1] = stArr[o + 2] = 1e4;
          stArr[o + 3] = stArr[o + 4] = stArr[o + 5] = 1e4;
          continue;
        }
        const d = s.speed * s.age;
        stArr[o] = s.ox + s.dx * d;
        stArr[o + 1] = s.oy + s.dy * d;
        stArr[o + 2] = s.oz + s.dz * d;
        stArr[o + 3] = s.ox + s.dx * (d - s.len);
        stArr[o + 4] = s.oy + s.dy * (d - s.len);
        stArr[o + 5] = s.oz + s.dz * (d - s.len);
      } else {
        stArr[o] = stArr[o + 1] = stArr[o + 2] = 1e4;
        stArr[o + 3] = stArr[o + 4] = stArr[o + 5] = 1e4;
      }
    }
    pools.sGeo.attributes.position.needsUpdate = true;

    /* Feed uniforms. */
    const p = motion.current.prox;
    if (sunMat.current) {
      sunMat.current.uniforms.uTime.value = t;
      sunMat.current.uniforms.uEnergy.value = e;
    }
    if (innerCorona.current) {
      innerCorona.current.uniforms.uTime.value = t;
      innerCorona.current.uniforms.uProximity.value = p;
      innerCorona.current.uniforms.uEnergy.value = e;
    }
    if (outerCorona.current) {
      outerCorona.current.uniforms.uTime.value = t;
      outerCorona.current.uniforms.uProximity.value = p;
      outerCorona.current.uniforms.uEnergy.value = e;
    }
    if (particleMat.current) particleMat.current.uniforms.uEnergy.value = e;
    if (streakMat.current) {
      streakMat.current.opacity = Math.max(0, e * (0.3 + 0.15 * Math.sin(t * 2.6)));
    }
  });

  const innerFragment = CORONA_FRAG.replace('COLOR', 'vec3(1.0, 0.55, 0.22)')
    .replace('SOFT', '4.0')
    .replace('BASE', '0.33')
    .replace('PULSE_SPEED', '1.7');
  const outerFragment = CORONA_FRAG.replace('COLOR', 'vec3(1.0, 0.48, 0.20)')
    .replace('SOFT', '1.9')
    .replace('BASE', '0.16')
    .replace('PULSE_SPEED', '1.1');

  const sunGeom = useMemo(() => new THREE.SphereGeometry(1, 84, 84), []);

  return (
    <group ref={group} position={tiny ? [-3.5, 0.8, 0] : SUN_CENTER.toArray()} scale={scale}>
      {/* Layer 3 · the dimensional Sun sphere */}
      <mesh
        geometry={sunGeom}
        onPointerOver={(ev) => {
          if (reduced) return;
          ev.stopPropagation();
          hovered.current = true;
        }}
        onPointerOut={() => {
          hovered.current = false;
        }}
      >
        <shaderMaterial
          ref={sunMat}
          vertexShader={SUN_VERT}
          fragmentShader={SUN_FRAG}
          uniforms={{ uTime: { value: 0 }, uEnergy: { value: 0 } }}
          toneMapped={false}
        />
      </mesh>

      {/* Layer 4 · soft atmospheric corona (transparent, fades out) */}
      <mesh geometry={sunGeom} scale={1.1}>
        <shaderMaterial
          ref={innerCorona}
          vertexShader={CORONA_VERT}
          fragmentShader={innerFragment}
          uniforms={{ uTime: { value: 0 }, uProximity: { value: 0 }, uEnergy: { value: 0 } }}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={sunGeom} scale={1.28}>
        <shaderMaterial
          ref={outerCorona}
          vertexShader={CORONA_VERT}
          fragmentShader={outerFragment}
          uniforms={{ uTime: { value: 0 }, uProximity: { value: 0 }, uEnergy: { value: 0 } }}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>

      {/* Layer 5 · solar radiation particles + plasma streaks */}
      <points geometry={pools.pGeo} frustumCulled={false}>
        <shaderMaterial
          ref={particleMat}
          vertexShader={PARTICLE_VERT}
          fragmentShader={PARTICLE_FRAG}
          uniforms={{ uEnergy: { value: 0 } }}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      <lineSegments geometry={pools.sGeo} frustumCulled={false}>
        <lineBasicMaterial
          ref={streakMat}
          color="#ff9040"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}