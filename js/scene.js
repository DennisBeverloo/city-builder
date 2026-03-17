/**
 * @module scene
 * Three.js scene, OrthographicCamera, renderer, and OrbitControls.
 * No game logic lives here.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GRID_SIZE    = 40;
const GRID_CENTER  = new THREE.Vector3(GRID_SIZE / 2, 0, GRID_SIZE / 2);
const BASE_FRUSTUM = 35; // world units visible vertically at zoom=1

let _scene, _camera, _renderer, _controls;
let _container;

/**
 * Initialise the Three.js scene and attach the canvas to `container`.
 * @param {HTMLElement} container
 * @returns {{ scene, camera, renderer, controls }}
 */
export function initScene(container) {
  _container = container;

  // ── Scene ────────────────────────────────────────────────────────
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x87ceeb);
  _scene.fog = new THREE.Fog(0x87ceeb, 90, 130);

  // ── Camera ───────────────────────────────────────────────────────
  const aspect = container.clientWidth / container.clientHeight;
  _camera = new THREE.OrthographicCamera(
    -BASE_FRUSTUM * aspect / 2,
     BASE_FRUSTUM * aspect / 2,
     BASE_FRUSTUM / 2,
    -BASE_FRUSTUM / 2,
    0.1, 600,
  );

  // Isometric angle: 45° in XZ plane, ~35° elevation
  _camera.position.set(GRID_CENTER.x + 30, 30, GRID_CENTER.z + 30);
  _camera.lookAt(GRID_CENTER);
  _camera.updateProjectionMatrix();

  // ── Renderer ─────────────────────────────────────────────────────
  _renderer = new THREE.WebGLRenderer({ antialias: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.setSize(container.clientWidth, container.clientHeight);
  _renderer.shadowMap.enabled = true;
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(_renderer.domElement);

  // ── Lights ───────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  _scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(45, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { near: 1, far: 200, left: -55, right: 55, top: 55, bottom: -55 });
  _scene.add(sun);

  // Secondary fill light from opposite side
  const fill = new THREE.DirectionalLight(0xc8d8ff, 0.35);
  fill.position.set(-30, 20, -30);
  _scene.add(fill);

  // ── OrbitControls ────────────────────────────────────────────────
  // Middle/right drag = pan, wheel = zoom. Left handled by main.js.
  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableRotate = false;
  _controls.enableZoom   = true;
  _controls.enablePan    = true;
  _controls.zoomSpeed    = 1.2;
  _controls.panSpeed     = 0.7;
  _controls.minZoom      = 0.3;
  _controls.maxZoom      = 4.0;
  _controls.mouseButtons = {
    LEFT:   null,               // we handle left click ourselves
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT:  THREE.MOUSE.PAN,
  };
  _controls.target.copy(GRID_CENTER);
  _controls.update();

  // ── Resize ───────────────────────────────────────────────────────
  window.addEventListener('resize', _onResize);

  return { scene: _scene, camera: _camera, renderer: _renderer, controls: _controls };
}

function _onResize() {
  const w = _container.clientWidth;
  const h = _container.clientHeight;
  const aspect = w / h;
  const zoom   = _camera.zoom;  // preserve current zoom level

  _camera.left   = -BASE_FRUSTUM * aspect / 2;
  _camera.right  =  BASE_FRUSTUM * aspect / 2;
  _camera.top    =  BASE_FRUSTUM / 2;
  _camera.bottom = -BASE_FRUSTUM / 2;
  _camera.zoom   = zoom;
  _camera.updateProjectionMatrix();

  _renderer.setSize(w, h);
}

/** Render one frame (call each RAF). */
export function render() {
  _controls.update();
  _renderer.render(_scene, _camera);
}

export function getScene()    { return _scene;    }
export function getCamera()   { return _camera;   }
export function getRenderer() { return _renderer; }
export function getControls() { return _controls; }

/**
 * Update mesh colours for C and I buildings based on their laborState.
 * Call this whenever 'laborStateChanged' is emitted by the City.
 * @param {object[]} buildings  Array of building instances with .mesh, .laborState, .baseColor
 */
export function applyLaborStateColors(buildings) {
  for (const b of buildings) {
    if (!b.mesh) continue;
    const zt = b.def?.zoneType;
    if (zt !== 'C' && zt !== 'I') continue;

    const base = new THREE.Color(b.baseColor ?? b.def?.color ?? 0xffffff);
    let target;

    if (b.recovering) {
      target = new THREE.Color(0x222222);
      target.lerp(base, 0.4);
    } else if (b.laborState === 'abandoned') {
      target = new THREE.Color(0x222222);
    } else if (b.laborState === 'struggling') {
      target = base.clone().multiplyScalar(0.6);
      target.lerp(new THREE.Color(0xff6600), 0.2);
    } else {
      target = base.clone();
    }

    b.mesh.traverse(child => {
      if (child.isMesh) child.material.color.copy(target);
    });
  }
}
