import { EffectComposer, N8AO, SMAA, ToneMapping, HueSaturation, BrightnessContrast, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * Image processing for the High graphics setting.
 *  - N8AO ambient occlusion: soft contact darkening where trees, houses and
 *    vehicles meet the ground and each other. This is what removes the flat,
 *    "toy" look more than anything else.
 *  - Slight desaturation and contrast for a muted, overcast Baltic palette.
 *  - ACES tone mapping (with post-processing on, the renderer's own tone
 *    mapping is bypassed, so it is applied here), SMAA edge smoothing and a
 *    light vignette.
 * If this file ever fails to build (package problems), remove its one usage
 * in Scene3D.tsx; nothing else depends on it.
 */
export default function PostEffects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={1.4} distanceFalloff={0.6} intensity={2.4} quality="medium" halfRes color="#1d2418" />
      <HueSaturation saturation={-0.07} />
      <BrightnessContrast brightness={0.0} contrast={0.07} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}
