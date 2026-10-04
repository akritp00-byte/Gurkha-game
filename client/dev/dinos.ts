// Dev tool (not part of the game build): shows each tier's dinosaur side by side.
// Open http://localhost:5173/dev/dinos.html while `pnpm dev` is running.
import { type Heightfield, speedForMass, TIERS } from '@extinct/shared';
import {
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CorpseView } from '../render/dino/corpse.ts';
import { DinoView } from '../render/dino/DinoView.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#viewer');
if (!canvas) throw new Error('missing #viewer canvas');
const params = new URLSearchParams(window.location.search);
const animate = !params.has('static');
const staticHeading = Number(params.get('heading') ?? 0.6);
const only = Number(params.get('only') ?? 0);
const pose = params.get('pose') ?? 'walk';

/** Flat ground at height 0, so DinoView's terrain lookups have something to stand on. */
const flat: Heightfield = { cells: 1, cellSize: 1000, origin: -500, heights: new Float32Array(4) };

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new Scene();
scene.background = new Color(0xcdeeff);
scene.add(new HemisphereLight(0xd7f0ff, 0x5b7a3a, 1.35));
const sun = new DirectionalLight(0xfff1dc, 2.3);
sun.position.set(-3, 6, 4);
sun.castShadow = true;
scene.add(sun);
const ground = new Mesh(new CircleGeometry(12, 32), new MeshLambertMaterial({ color: 0xa9c95b }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const shown = only > 0 ? TIERS.filter((tier) => tier.tier === only) : TIERS;
const spacing = 2.1;
const dinos = shown.map((tier, index) => {
  const x = (index - (shown.length - 1) / 2) * spacing;
  const view = new DinoView(tier.minMass);
  scene.add(view.root);
  const corpse = pose === 'dead' || pose === 'carry' ? new CorpseView(tier.tier) : undefined;
  if (corpse) {
    view.setVisible(pose === 'carry');
    scene.add(corpse.root);
  }
  return { view, corpse, tier, x };
});

const camera = new PerspectiveCamera(35, 1, 0.1, 100);
if (only > 0) {
  camera.position.set(0, 1.1, 3.4);
  camera.lookAt(0, 0.45, 0);
} else {
  camera.position.set(0, 1.6, 9.5);
  camera.lookAt(0, 0.45, 0);
}

const mouth = new Vector3();
let last = performance.now();
let cycle = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  cycle += dt;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  for (const { view, corpse, tier, x } of dinos) {
    if (cycle > 1.6) {
      if (pose === 'bite') view.bite();
      if (pose === 'roar') view.roar();
    }
    const running = pose === 'run';
    // Unit scale for every species, so proportions can be compared directly.
    view.update(
      dt,
      {
        x,
        z: 0,
        heading: animate ? now / 2000 : staticHeading,
        speed: animate || running ? speedForMass(tier.minMass) * (running ? 1.6 : 0.8) : 0,
        mass: tier.minMass,
        carrying: pose === 'carry',
      },
      flat,
    );
    view.root.scale.setScalar(1);
    if (corpse) {
      view.mouth(mouth);
      const grip = pose === 'carry' ? { mouth, heading: view.root.rotation.y } : undefined;
      corpse.update(
        dt,
        { x, z: 0, heading: staticHeading },
        pose === 'carry' ? 0.5 : 1,
        1,
        grip,
        flat,
      );
    }
  }
  if (cycle > 1.6) cycle = 0;
  renderer.render(scene, camera);
});
