import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';

const TARGET = new THREE.Vector3();

interface ParallaxCameraProps {
  mx: MotionValue<number>;
  my: MotionValue<number>;
}

/**
 * Springs the camera toward a mouse-derived offset, looking back at the
 * origin so the whole scene drifts with a soft parallax feel.
 */
export default function ParallaxCamera({ mx, my }: ParallaxCameraProps) {
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    TARGET.set(mx.get() * 2.3, my.get() * 1.5, 10);
    camera.position.lerp(TARGET, 0.055);
    camera.lookAt(0, 0, 0);
  });

  return null;
}