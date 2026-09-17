import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import type { MotionValue } from 'framer-motion';
import Sun from './Sun';
import SolarWind from './SolarWind';
import Earth from './Earth';
import ParallaxCamera from './ParallaxCamera';

interface SolarSceneProps {
  mx: MotionValue<number>;
  my: MotionValue<number>;
  reduced?: boolean;
  inside?: MotionValue<number>;
}

export default function SolarScene({ mx, my, reduced = false, inside }: SolarSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.8]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 10], fov: 42, near: 0.1, far: 220 }}
      frameloop={reduced ? 'demand' : 'always'}
    >
      <Stars radius={150} depth={80} count={3200} factor={4} saturation={0} fade speed={reduced ? 0 : 0.45} />

      <ambientLight intensity={0.35} />
      <pointLight position={[-6, 1.4, 2]} intensity={4.2} color="#ffb46a" decay={0} distance={0} />
      <pointLight position={[5, -2.5, 3]} intensity={0.9} color="#4f9dff" decay={0} distance={0} />

      <Sun inside={inside} reduced={reduced} />
      <SolarWind count={950} color="#ffb45e" />
      <SolarWind count={360} color="#5ec8ff" size={0.034} speed={0.2} />
      <Earth />

      {!reduced && (
        <EffectComposer>
          {/* Restrained bloom so the photographic surface detail still
              reads through the corona glow instead of washing out flat. */}
          <Bloom intensity={0.6} luminanceThreshold={0.78} luminanceSmoothing={0.3} mipmapBlur radius={0.6} />
          <Vignette eskil={false} offset={0.24} darkness={0.72} />
        </EffectComposer>
      )}

      <ParallaxCamera mx={mx} my={my} />
    </Canvas>
  );
}