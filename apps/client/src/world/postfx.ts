import * as THREE from "three";
import {
  BlendFunction,
  BrightnessContrastEffect,
  DepthDownsamplingPass,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  KernelSize,
  NormalPass,
  OutlineEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  SSAOEffect,
  SelectiveBloomEffect,
  TiltShiftEffect,
  VignetteEffect,
} from "postprocessing";
import type { CameraMode } from "../state/store";

/**
 * The "charming miniature" post stack: contact AO, a tilt-shift band that
 * is strong in the overview modes and almost off up close, a dark warm
 * outline on characters only, a light bloom for the few emissive props,
 * a soft vignette, a touch of saturation and contrast, and SMAA.
 *
 * Everything the scene draws still comes from events; this file only
 * changes how the final image is composed.
 */

export type FxMode = CameraMode;
export type FxQuality = "high" | "medium" | "low";

export interface PostFX {
  composer: EffectComposer;
  setMode(mode: FxMode): void;
  setQuality(q: FxQuality): void;
  quality(): FxQuality;
  resize(w: number, h: number): void;
  render(dt: number): void;
  /** Objects whose meshes get the character outline. Groups are traversed. */
  setOutlineSelection(objects: THREE.Object3D[]): void;
  /** Meshes allowed to bloom (monitors, alarm, LEDs). Nothing else blooms, however bright. */
  setBloomSelection(objects: THREE.Object3D[]): void;
  dispose(): void;
}

/** Per-mode look targets; `render` lerps toward them. */
interface Look {
  /** Tilt-shift blur opacity, 0 = off. */
  tilt: number;
  /** Relative height of the sharp band (0..1). */
  focusArea: number;
  feather: number;
  /** Vertical offset of the band (-1..1); slightly positive keeps the far edge blurrier. */
  offset: number;
  ao: number;
  vignette: number;
}

const LOOKS: Record<FxMode, Look> = {
  valley: { tilt: 1, focusArea: 0.34, feather: 0.42, offset: -0.04, ao: 1.0, vignette: 0.38 },
  office: { tilt: 0.4, focusArea: 0.6, feather: 0.35, offset: 0.0, ao: 1.2, vignette: 0.33 },
  meeting: { tilt: 0.22, focusArea: 0.6, feather: 0.45, offset: 0.0, ao: 1.1, vignette: 0.32 },
  follow: { tilt: 0.08, focusArea: 0.7, feather: 0.45, offset: 0.0, ao: 1.1, vignette: 0.3 },
  firstperson: { tilt: 0, focusArea: 0.8, feather: 0.5, offset: 0.0, ao: 1.0, vignette: 0.28 },
};

interface QualityPreset {
  ssaoSamples: number;
  ssaoRings: number;
  ssaoScale: number;
  normalScale: number;
  tilt: boolean;
  tiltKernel: KernelSize;
  outlineScale: number;
  smaa: SMAAPreset;
}

const QUALITY: Record<FxQuality, QualityPreset> = {
  high: { ssaoSamples: 16, ssaoRings: 7, ssaoScale: 0.75, normalScale: 1, tilt: true, tiltKernel: KernelSize.MEDIUM, outlineScale: 1, smaa: SMAAPreset.HIGH },
  medium: { ssaoSamples: 10, ssaoRings: 7, ssaoScale: 0.5, normalScale: 0.75, tilt: true, tiltKernel: KernelSize.SMALL, outlineScale: 0.5, smaa: SMAAPreset.MEDIUM },
  low: { ssaoSamples: 6, ssaoRings: 5, ssaoScale: 0.5, normalScale: 0.5, tilt: false, tiltKernel: KernelSize.SMALL, outlineScale: 0.5, smaa: SMAAPreset.LOW },
};

const OUTLINE_COLOR = 0x3b3a4f;
const OUTLINE_OPACITY = 0.7;
/** Warm plum so occluded corners read as shade in the pastel palette, not soot. */
const AO_COLOR = 0x6b4a5a;

export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): PostFX {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });

  // ---- scene + G-buffer-ish passes ----
  const renderPass = new RenderPass(scene, camera);
  const normalPass = new NormalPass(scene, camera);
  const depthDownsamplingPass = new DepthDownsamplingPass({ normalBuffer: normalPass.texture, resolutionScale: 0.5 });

  // ---- effects ----
  const ssao = new SSAOEffect(camera, normalPass.texture, {
    blendFunction: BlendFunction.MULTIPLY,
    distanceScaling: true,
    depthAwareUpsampling: true,
    normalDepthBuffer: depthDownsamplingPass.texture,
    samples: QUALITY.medium.ssaoSamples,
    rings: QUALITY.medium.ssaoRings,
    // Keep AO alive across the whole valley (camera ~125 units out) and fade only near the fog.
    worldDistanceThreshold: 190,
    worldDistanceFalloff: 40,
    worldProximityThreshold: 0.25,
    worldProximityFalloff: 0.15,
    luminanceInfluence: 0.55,
    minRadiusScale: 0.2,
    radius: 0.07,
    intensity: 1.1,
    bias: 0.03,
    fade: 0.012,
    color: new THREE.Color(AO_COLOR),
    resolutionScale: QUALITY.medium.ssaoScale,
  });

  const outline = new OutlineEffect(scene, camera, {
    blendFunction: BlendFunction.ALPHA,
    edgeStrength: 1.4,
    pulseSpeed: 0,
    visibleEdgeColor: OUTLINE_COLOR,
    hiddenEdgeColor: OUTLINE_COLOR,
    blur: false,
    xRay: false,
    multisampling: 0,
    resolutionScale: QUALITY.medium.outlineScale,
  });
  outline.blendMode.opacity.value = OUTLINE_OPACITY;

  // Selective: the lit pastel floor is already near 1.0 in the HDR buffer, so a plain
  // luminance threshold would haze the whole office. Only selected meshes feed the bloom.
  const bloom = new SelectiveBloomEffect(scene, camera, {
    blendFunction: BlendFunction.ADD,
    mipmapBlur: true,
    luminanceThreshold: 0.5,
    luminanceSmoothing: 0.2,
    intensity: 0.45,
    radius: 0.6,
    levels: 6,
  });
  bloom.ignoreBackground = true;
  bloom.inverted = false;

  const tilt = new TiltShiftEffect({
    blendFunction: BlendFunction.NORMAL,
    offset: LOOKS.valley.offset,
    rotation: 0,
    focusArea: LOOKS.valley.focusArea,
    feather: LOOKS.valley.feather,
    kernelSize: QUALITY.medium.tiltKernel,
    resolutionScale: 0.5,
  });

  const hueSat = new HueSaturationEffect({ hue: 0, saturation: 0.08 });
  const brightCont = new BrightnessContrastEffect({ brightness: 0, contrast: 0.04 });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.35 });
  const smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });

  // ---- passes ----
  const scenePass = new EffectPass(camera, ssao, outline, bloom);
  const tiltPass = new EffectPass(camera, tilt);
  const gradePass = new EffectPass(camera, hueSat, brightCont, vignette, smaa);

  composer.addPass(renderPass);
  composer.addPass(normalPass);
  composer.addPass(depthDownsamplingPass);
  composer.addPass(scenePass);
  composer.addPass(tiltPass);
  composer.addPass(gradePass);

  // ---- state ----
  let quality: FxQuality = "medium";
  let target: Look = { ...LOOKS.valley };
  const current: Look = { ...LOOKS.valley };
  let tiltAllowed = true;

  const applyLook = (): void => {
    const tiltOn = tiltAllowed && current.tilt > 0.02;
    tiltPass.enabled = tiltOn;
    tilt.blendMode.opacity.value = current.tilt;
    tilt.focusArea = current.focusArea;
    tilt.feather = current.feather;
    tilt.offset = current.offset;
    ssao.intensity = current.ao;
    vignette.darkness = current.vignette;
  };

  const setQuality = (q: FxQuality): void => {
    quality = q;
    const p = QUALITY[q];
    ssao.samples = p.ssaoSamples;
    ssao.rings = p.ssaoRings;
    ssao.resolution.scale = p.ssaoScale;
    normalPass.resolution.scale = p.normalScale;
    tiltAllowed = p.tilt;
    tilt.blurPass.kernelSize = p.tiltKernel;
    outline.resolution.scale = p.outlineScale;
    smaa.applyPreset(p.smaa);
    applyLook();
  };

  const setMode = (mode: FxMode): void => {
    target = { ...LOOKS[mode] };
  };

  const resize = (w: number, h: number): void => {
    composer.setSize(w, h);
  };

  const render = (dt: number): void => {
    // Short lerp between mode presets so a camera switch does not pop the blur.
    const k = 1 - Math.exp(-Math.max(0, dt) * 5);
    current.tilt += (target.tilt - current.tilt) * k;
    current.focusArea += (target.focusArea - current.focusArea) * k;
    current.feather += (target.feather - current.feather) * k;
    current.offset += (target.offset - current.offset) * k;
    current.ao += (target.ao - current.ao) * k;
    current.vignette += (target.vignette - current.vignette) * k;
    applyLook();
    // Post-processed world first (layer 0 only), then the text overlay layer
    // (name tags, bubbles, signs) drawn straight to the screen so the
    // tilt-shift and AO never blur or darken it.
    camera.layers.set(0);
    composer.render(dt);
    const autoClear = renderer.autoClear;
    const background = scene.background;
    const fog = scene.fog;
    renderer.autoClear = false;
    scene.background = null; // a background would repaint over the composed frame
    scene.fog = null;
    camera.layers.set(1);
    renderer.render(scene, camera);
    camera.layers.set(0);
    scene.background = background;
    scene.fog = fog;
    renderer.autoClear = autoClear;
  };

  const setOutlineSelection = (objects: THREE.Object3D[]): void => {
    const meshes: THREE.Object3D[] = [];
    for (const o of objects) {
      o.traverse((c) => {
        // Sprites (name tags, bubbles) must not be outlined; only solid body parts.
        if ((c as THREE.Mesh).isMesh && !(c as THREE.Sprite).isSprite) meshes.push(c);
      });
    }
    outline.selection.set(meshes);
  };

  const setBloomSelection = (objects: THREE.Object3D[]): void => {
    bloom.selection.set(objects);
  };

  const dispose = (): void => {
    composer.dispose();
  };

  setQuality("medium");

  return { composer, setMode, setQuality, quality: () => quality, resize, render, setOutlineSelection, setBloomSelection, dispose };
}
