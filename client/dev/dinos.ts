// Dev tool (not part of the game build): shows each tier's placeholder dinosaur side by side.
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
  WebGLRenderer,
} from 'three';
import { DinoView } from '../render/dino/DinoView.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#viewer');
if (!canvas) throw new Error('missing #viewer canvas');
const params = new URLSearchParams(window.location.search);
const animate = !params.has('static');
const staticHeading = Number(params.get('heading') ?? 0.6);

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

const dinos = TIERS.map((tier, index) => {
  const view = new DinoView(tier.minMass);
  view.root.position.x = (index - 2) * 1.4;
  scene.add(view.root);
  return { view, tier, x: (index - 2) * 1.4 };
});

const camera = new PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 1.6, 7.5);
camera.lookAt(0, 0.4, 0);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  for (const { view, tier, x } of dinos) {
    // Unit scale for every species, so proportions can be compared directly.
    view.update(
      dt,
      {
        x,
        z: 0,
        heading: animate ? now / 2000 : staticHeading,
        speed: animate ? speedForMass(tier.minMass) * 0.8 : 0,
        mass: tier.minMass,
      },
      flat,
    );
    view.root.scale.setScalar(1);
  }
  renderer.render(scene, camera);
});
