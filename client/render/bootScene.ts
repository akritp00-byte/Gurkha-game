import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

const SKY_COLOR = 0x9bd8ff;
const FOG = { near: 40, far: 110 };
const CAMERA_ORBIT = { radius: 48, height: 22, radiansPerSecond: 0.1 };
/** Portrait screens see less horizontally, so the camera pulls back (up to this factor) to fit the island. */
const MAX_PORTRAIT_ZOOM_OUT = 2.4;
const TREE_SPOTS: readonly (readonly [x: number, z: number])[] = [
  [12, 4],
  [-10, 9],
  [8, -12],
  [-14, -6],
  [15, -3],
  [-4, 15],
  [3, -16],
];

/**
 * Milestone 0 placeholder: a tiny low-poly island under an orbiting camera, proving the
 * WebGL pipeline works end to end. Milestone 1 replaces it with the real island and player camera.
 */
export function startBootScene(canvas: HTMLCanvasElement): void {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  const fog = new Fog(SKY_COLOR, FOG.near, FOG.far);
  scene.fog = fog;
  scene.add(new HemisphereLight(0xdff4ff, 0x4a6b3a, 1.6));
  const sun = new DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(30, 50, 20);
  scene.add(sun, createIsland());

  const camera = new PerspectiveCamera(45, 1, 0.1, 300);
  let zoomOut = 1;
  const resize = (): void => {
    const { clientWidth: width, clientHeight: height } = canvas;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    zoomOut = Math.min(MAX_PORTRAIT_ZOOM_OUT, Math.max(1, 1.25 / camera.aspect));
    fog.near = FOG.near * zoomOut;
    fog.far = FOG.far * zoomOut;
  };
  window.addEventListener('resize', resize);
  resize();

  let firstFrame = true;
  renderer.setAnimationLoop((timeMs) => {
    const angle = (timeMs / 1000) * CAMERA_ORBIT.radiansPerSecond;
    const radius = CAMERA_ORBIT.radius * zoomOut;
    camera.position.set(
      Math.cos(angle) * radius,
      CAMERA_ORBIT.height * zoomOut,
      Math.sin(angle) * radius,
    );
    camera.lookAt(0, 3, 0);
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      canvas.dataset.ready = 'true'; // lets smoke tests wait for the first rendered frame
    }
  });
}

function createIsland(): Group {
  const flat = (color: number): MeshLambertMaterial =>
    new MeshLambertMaterial({ color, flatShading: true });
  const island = new Group();

  const sea = new Mesh(new CircleGeometry(200, 48), flat(0x2f9fd8));
  sea.rotation.x = -Math.PI / 2;

  const beach = new Mesh(new CylinderGeometry(24, 27, 2, 9), flat(0xf0d991));
  beach.position.y = 0.5;
  const grass = new Mesh(new CylinderGeometry(21, 23.5, 2, 9), flat(0x6cbf4a));
  grass.position.y = 1.5;
  const volcano = new Mesh(new CylinderGeometry(3, 9, 9, 8), flat(0x6b5448));
  volcano.position.y = 7;
  const lava = new Mesh(
    new CylinderGeometry(2.6, 2.6, 0.4, 8),
    new MeshBasicMaterial({ color: 0xff7a2f }),
  );
  lava.position.y = 11.4;
  island.add(sea, beach, grass, volcano, lava);

  const trunkGeometry = new CylinderGeometry(0.3, 0.45, 2, 5);
  const crownGeometry = new ConeGeometry(1.8, 4, 6);
  const trunkMaterial = flat(0x7a5232);
  const crownMaterial = flat(0x2f8f46);
  for (const [x, z] of TREE_SPOTS) {
    const trunk = new Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(x, 3.5, z);
    const crown = new Mesh(crownGeometry, crownMaterial);
    crown.position.set(x, 6.3, z);
    island.add(trunk, crown);
  }
  return island;
}
