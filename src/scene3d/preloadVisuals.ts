import { preloadGroundTextures } from './groundTextures';

// Critical resources are fetched and decoded while the mission remains in its
// briefing/loading screen. Browser cache is then reused by Three's loaders.
// Optional files can fail without preventing combat; local 3D trees still render.
const imagePaths = [
  'assets/buildings/wood_siding.jpg',
  'assets/buildings/wood_weathered.jpg',
  'assets/buildings/brick_red.jpg',
  'assets/buildings/concrete.jpg',
  'assets/buildings/roof_clay.jpg',
  'assets/buildings/roof_slate.jpg',
  'assets/buildings/roof_corrugated.jpg',
  'assets/nature/shrub/Textures/shrub_foliage.png',
  'assets/nature/grass/Textures/grass_blades.png',
  // These species-specific leaf and bark maps are also consumed by useLoader
  // in VolumetricTrees. Decode them before entering combat.
  'assets/nature/pine/Textures/pine_bark.png',
  'assets/nature/trees/pine_foliage.svg',
  'assets/nature/trees/spruce_foliage.svg',
  'assets/nature/trees/spruce_bark.svg',
  'assets/nature/trees/birch_foliage.svg',
  'assets/nature/trees/birch_bark.svg',
  'assets/nature/trees/oak_foliage.svg',
  'assets/nature/trees/oak_bark.svg',
  'assets/nature/trees/alder_foliage.svg',
  'assets/nature/trees/alder_bark.svg',
  'assets/nature/trees/pine_sprig.svg',
  'assets/nature/trees/spruce_sprig.svg',
  'assets/nature/trees/birch_sprig.svg',
  'assets/nature/trees/oak_sprig.svg',
  'assets/nature/trees/alder_sprig.svg',
];
const modelPaths = [
  'assets/nature/shrub/shrub.obj',
  'assets/nature/grass/grass.obj',
  'assets/nature/fern_02/fern_02_1k.gltf',
  'assets/nature/fern_02/fern_02.bin',
  'assets/factions/aster-rifleman-detailed.glb',
  'assets/factions/union-rifleman.glb',
  'assets/factions/tank-hull.glb',
];
const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;
function decodeImage(path: string): Promise<void> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => { console.warn('Optional map texture unavailable:', path); resolve(); };
    image.src = url(path);
  });
}
async function cacheModel(path: string): Promise<void> {
  try {
    const response = await fetch(url(path));
    if (!response.ok) console.warn('Optional game model unavailable:', path);
    // Consume the body so the browser cache has the complete resource.
    else await response.arrayBuffer();
  } catch (error) {
    console.warn('Optional game model could not be preloaded:', path, error);
  }
}
let preparation: Promise<void> | null = null;
export function preloadFirstBattleVisuals(): Promise<void> {
  if (!preparation) {
    preparation = Promise.all([
      preloadGroundTextures(),
      ...imagePaths.map(decodeImage),
      ...modelPaths.map(cacheModel),
    ]).then(() => undefined).catch(error => {
      // Avoid a permanently blocked start on a broken optional download.
      console.warn('Map preload failed; renderer will keep local fallbacks.', error);
    });
  }
  return preparation;
}
