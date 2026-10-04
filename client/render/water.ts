import { type Heightfield, heightAt, TERRAIN, WATER_LEVEL } from '@extinct/shared';
import {
  BufferAttribute,
  Color,
  type IUniform,
  Mesh,
  MeshPhongMaterial,
  PlaneGeometry,
  RingGeometry,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Grid spacing of the water near the island, where depth changes; the open sea is one ring. */
const WATER_CELL = 3.5;
/** The open sea reaches this far, past the fog. */
const SEA_RADIUS = 1500;
/** Depth the colour gradient runs over, and the depth the open sea counts as. */
const DEEP = 5;
/** Water this far below the ground can't show through anywhere. */
const BURIED = 1.5;

const SHALLOW_COLOR = new Color(0x3fd0c9);
const DEEP_COLOR = new Color(0x1a6fa8);
const FOAM_COLOR = new Color(0xf4fbff);

/**
 * The sea, rivers and lagoons: one stylised water surface (BUILD_PROMPT.md §6). Each vertex
 * knows how deep the water is under it, so the shallows glow turquoise and fade to deep blue,
 * surf foams along the shore, and small waves roll across it.
 */
export class Water {
  readonly mesh: Mesh;
  private readonly time: IUniform<number> = { value: 0 };

  constructor(field: Heightfield) {
    const extent = TERRAIN.halfExtent;
    const cells = Math.round((2 * extent) / WATER_CELL);
    const near = new PlaneGeometry(2 * extent, 2 * extent, cells, cells).rotateX(-Math.PI / 2);
    const far = new RingGeometry(extent * Math.SQRT2, SEA_RADIUS, 48, 1).rotateX(-Math.PI / 2);
    near.deleteAttribute('uv');
    far.deleteAttribute('uv');
    const geometry = mergeGeometries([near, far]);
    near.dispose();
    far.dispose();
    const positions = geometry.getAttribute('position');
    const depth = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const inside = Math.abs(x) <= extent && Math.abs(z) <= extent;
      depth[i] = inside ? WATER_LEVEL - heightAt(field, x, z) : DEEP * 2;
    }
    geometry.setAttribute('depth', new BufferAttribute(depth, 1));
    // Drop the triangles that are buried well under dry land: they'd never be seen.
    const index = geometry.getIndex();
    if (index) {
      const kept: number[] = [];
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        if (Math.max(depth[a], depth[b], depth[c]) > -BURIED) kept.push(a, b, c);
      }
      geometry.setIndex(kept);
    }

    const material = new MeshPhongMaterial({
      color: 0xffffff,
      specular: 0xd8f4ff,
      shininess: 80,
      transparent: true,
      depthWrite: false,
    });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.waterTime = this.time;
      shader.uniforms.shallowColor = { value: SHALLOW_COLOR };
      shader.uniforms.deepColor = { value: DEEP_COLOR };
      shader.uniforms.foamColor = { value: FOAM_COLOR };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float depth;
          uniform float waterTime;
          varying float vDepth;
          varying vec2 vSpot;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vDepth = depth;
          vSpot = position.xz;
          float swell = clamp(depth / 2.0, 0.0, 1.0);
          transformed.y += swell * 0.12 * (sin(position.x * 0.21 + waterTime * 1.3) + sin(position.z * 0.17 - waterTime * 1.1));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float waterTime;
          uniform vec3 shallowColor;
          uniform vec3 deepColor;
          uniform vec3 foamColor;
          varying float vDepth;
          varying vec2 vSpot;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float deep = smoothstep(0.0, ${DEEP.toFixed(1)}, vDepth);
          diffuseColor.rgb = mix(shallowColor, deepColor, deep);
          float ripple = 0.5 + 0.5 * sin(vSpot.x * 0.9 + vSpot.y * 0.6 + waterTime * 2.2);
          float surf = 1.0 - smoothstep(0.0, 0.32 + 0.18 * ripple, vDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb, foamColor, surf * 0.85);
          diffuseColor.a = mix(0.62, 0.9, deep) + surf * 0.1;`,
        );
    };
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'water';
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 1;
  }

  update(timeSeconds: number): void {
    this.time.value = timeSeconds;
  }
}
