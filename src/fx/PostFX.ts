import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Display-space grade pass: wide-angle barrel distortion, chromatic
 * aberration, desaturation + crushed blacks, vignette, animated film
 * grain (stronger in shadows), digital glitch/dropout rows and a red
 * hurt vignette driven by the game.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDamage: { value: 0 },
    uLowHp: { value: 0 },
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uDamage;
    uniform float uLowHp;
    uniform float uGlitch;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 41.3) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // digital dropout: horizontal row displacement + luminance flicker
      if (uGlitch > 0.004) {
        float row = floor(uv.y * 36.0);
        float rowRnd = hash(vec2(row, floor(uTime * 24.0)));
        if (rowRnd > 1.0 - uGlitch * 0.55) {
          uv.x += (hash(vec2(row + 7.3, floor(uTime * 24.0))) - 0.5) * 0.22 * uGlitch;
        }
        uv.y += (hash(vec2(floor(uTime * 18.0), 3.7)) - 0.5) * 0.006 * uGlitch;
      }

      // wide-angle lens: edges compressed toward the center (fisheye)
      float k = 0.52;
      float zoom = 1.035;
      uv = 0.5 + c * zoom * (1.0 - k * r2);

      // chromatic aberration grows toward the edges
      float ca = (0.004 + 0.01 * uGlitch) * smoothstep(0.05, 0.45, r2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;

      // grade: desaturate, crush blacks, cool the shadows
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, 0.78);
      col = col * 1.07 - 0.016;
      col.b += 0.016 * (1.0 - luma);
      col.r += 0.005 * (1.0 - luma);

      // vignette — deep, the night eats the frame edges
      float vig = smoothstep(1.0, 0.2, r2 * 1.55);
      col *= mix(0.34, 1.0, vig);

      // hurt / low-health red vignette
      float hurt = max(uDamage, uLowHp);
      float hvig = smoothstep(0.7, 0.12, r2);
      col = mix(col, vec3(0.42, 0.02, 0.02), hvig * hurt * 0.8);

      // animated grain, heavier in the shadows
      float g = hash(uv * uResolution * 0.4) - 0.5;
      col += g * (0.065 + 0.07 * (1.0 - luma));

      // glitch brightness slam
      col *= 1.0 - 0.25 * uGlitch * hash(vec2(floor(uTime * 24.0), 9.1));
      // lens border
      if (uv.x < 0.001 || uv.x > 0.999 || uv.y < 0.001 || uv.y > 0.999) {
        col = vec3(0.0);
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  private composer: EffectComposer;
  private grade: ShaderPass;
  private time = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    this.grade.uniforms.uResolution.value.set(width * dpr, height * dpr);
  }

  update(dt: number, damage: number, lowHp: number, glitch: number): void {
    this.time += dt;
    this.grade.uniforms.uTime.value = this.time;
    this.grade.uniforms.uDamage.value = damage;
    this.grade.uniforms.uLowHp.value = lowHp;
    this.grade.uniforms.uGlitch.value = glitch;
  }

  render(): void {
    this.composer.render();
  }
}
