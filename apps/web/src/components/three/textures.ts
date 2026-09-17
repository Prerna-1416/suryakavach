import * as THREE from 'three';

/** Deterministic PRNG so city lights look stable between reloads. */
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

/** Simplified equirectangular landmass (0–100 × 0–50 in map space). */
const WORLD_PATH =
  'M7 10 L10 6 L14 5 L18 5 L21 7 L20 11 L24 12 L25 15 L21 15 L20 18 L17 16 L14 18 L12 21 L10 18 L8 15 L5 12 Z ' +
  'M12 22 L15 21 L18 22 L19 25 L17 28 L18 31 L16 35 L13 38 L11 34 L9 29 L9 25 Z ' +
  'M16 1 L20 0 L23 2 L22 5 L18 6 Z M14 4 L16 3 L17 5 L15 6 Z ' +
  'M36 8 L39 5 L42 5 L44 7 L43 10 L41 12 L39 13 L36 11 L35 9 Z ' +
  'M37 13 L42 12 L46 14 L44 17 L49 18 L48 22 L52 25 L50 30 L46 33 L43 31 L39 27 L37 22 L35 19 Z ' +
  'M52 28 L53 26 L55 27 L53 30 Z ' +
  'M45 14 L50 12 L55 10 L62 8 L70 6 L80 5 L88 6 L93 9 L92 13 L86 13 L82 16 L78 15 L74 18 L68 15 L64 17 L60 15 L56 16 L53 19 L50 16 Z ' +
  'M60 18 L63 17 L61 22 L58 21 Z M78 18 L81 17 L80 21 L77 20 Z ' +
  'M82 23 L84 22 L86 24 L84 26 Z M88 25 L90 24 L92 26 L89 28 Z M92 22 L95 21 L97 23 L94 25 Z ' +
  'M94 10 L96 8 L97 11 L96 14 Z M92 8 L93 9 L92 10 Z ' +
  'M83 30 L89 28 L95 30 L97 34 L94 38 L87 39 L82 35 Z ' +
  'M90 40 L92 39 L93 41 L91 42 Z M98 36 L99 37 L98 39 Z';

let cached: { land: THREE.CanvasTexture; lights: THREE.CanvasTexture } | null = null;

/**
 * Procedurally generates a land mask and a city-lights mask for the Earth
 * globe. Generated once per browser session — no network assets required.
 */
export function getEarthTextures(): { land: THREE.CanvasTexture; lights: THREE.CanvasTexture } {
  if (cached) return cached;

  const W = 1024;
  const H = 512;

  const landCanvas = document.createElement('canvas');
  landCanvas.width = W;
  landCanvas.height = H;
  const lctx = landCanvas.getContext('2d')!;
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, W, H);
  const d = new Path2D(WORLD_PATH);
  lctx.save();
  lctx.fillStyle = '#fff';
  lctx.scale(10.24, 10.24);
  lctx.fill(d);
  lctx.translate(100, 0);
  lctx.fill(d);
  lctx.restore();

  const lightsCanvas = document.createElement('canvas');
  lightsCanvas.width = W;
  lightsCanvas.height = H;
  const ictx = lightsCanvas.getContext('2d')!;
  const mask = lctx.getImageData(0, 0, W, H).data;
  const rand = mulberry32(20260112);
  for (let i = 0; i < 4600; i++) {
    const x = (rand() * W) | 0;
    const y = (rand() * H) | 0;
    if (mask[(y * W + x) * 4] > 128) {
      const r = 1 + rand() * 1.8;
      ictx.fillStyle = `rgba(255,226,150,${(0.4 + rand() * 0.6).toFixed(2)})`;
      ictx.beginPath();
      ictx.arc(x, y, r, 0, Math.PI * 2);
      ictx.fill();
    }
  }

  const land = new THREE.CanvasTexture(landCanvas);
  land.colorSpace = THREE.SRGBColorSpace;
  land.anisotropy = 4;
  const lights = new THREE.CanvasTexture(lightsCanvas);
  lights.colorSpace = THREE.SRGBColorSpace;

  cached = { land, lights };
  return cached;
}