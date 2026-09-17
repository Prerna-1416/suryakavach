import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

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

/** Quadratic Bezier from the Sun's limb to Earth. */
const P0 = new THREE.Vector3(-3.2, 1.7, 0.4);
const P1 = new THREE.Vector3(-0.3, 2.9, 1.7);
const P2 = new THREE.Vector3(4.4, -2.0, 0.3);

const TMP = new THREE.Vector3();

function pointAt(t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  out.set(
    u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x,
    u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y,
    u * u * P0.z + 2 * u * t * P1.z + t * t * P2.z,
  );
  return out;
}

interface SolarWindProps {
  count?: number;
  color?: string;
  size?: number;
  /** Wrap time multiplier; the two layers move at different speeds. */
  speed?: number;
}

/**
 * Point stream flowing along a Bezier from the Sun toward Earth, with a
 * per-particle lateral jitter that fades in and out along the flow.
 */
export default function SolarWind({
  count = 900,
  color = '#ffb45e',
  size = 0.05,
  speed = 0.11,
}: SolarWindProps) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count]);

  const particles = useMemo(() => {
    const rand = mulberry32(count * 7919 + color.length * 131);
    return Array.from({ length: count }, () => ({
      o: rand(),
      spd: 0.9 + rand() * 0.5,
      jx: rand() - 0.5,
      jy: rand() - 0.5,
      jz: rand() - 0.5,
      amp: 0.1 + rand() * 0.55,
    }));
  }, [count, color]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed * 0.0105;
    const arr = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const cycle = (p.o + t * p.spd) % 1;
      // Stop just short of both endpoints — a full sweep to k=0/1 lets
      // every particle's jitter collapse to the same point on the Sun's
      // limb / Earth's surface, stacking additive blending into a
      // blown-out "star" artifact instead of a soft stream.
      const k = 0.04 + 0.92 * cycle;
      pointAt(k, TMP);
      const w = 0.22 + 0.78 * Math.sin(k * Math.PI);
      arr[i * 3] = TMP.x + p.jx * w * p.amp;
      arr[i * 3 + 1] = TMP.y + p.jy * w * p.amp;
      arr[i * 3 + 2] = TMP.z + p.jz * w * p.amp;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        color={color}
        size={size}
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}