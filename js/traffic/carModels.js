import * as THREE from 'three';

// ── Shared wheel geometry (reused across all models) ──────────────────────────
const _wheelGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.028, 8);
const _wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });

function _addWheels(group, bodyLen, bodyWidth) {
  const wx = bodyLen * 0.32;   // wheel X offset from center (front/rear)
  const wz = bodyWidth * 0.5 + 0.006; // wheel Z offset (sides)
  const wy = 0.022;            // wheel center Y
  for (const [sx, sz] of [[wx, wz],[wx,-wz],[-wx, wz],[-wx,-wz]]) {
    const w = new THREE.Mesh(_wheelGeo, _wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, wy, sz);
    group.add(w);
  }
}

function _addLights(group, bodyLen, bodyY, bodyH) {
  const lightY = bodyY + bodyH * 0.4;
  const headGeo = new THREE.BoxGeometry(0.018, 0.018, 0.028);
  const tailGeo = new THREE.BoxGeometry(0.018, 0.018, 0.028);
  const headMats = [], tailMats = [];
  for (const sz of [0.04, -0.04]) {
    const hMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 0, roughness: 0.3 });
    const h = new THREE.Mesh(headGeo, hMat);
    h.position.set(bodyLen * 0.5 + 0.009, lightY, sz);
    group.add(h);
    headMats.push(hMat);

    const tMat = new THREE.MeshStandardMaterial({ color: 0xff1100, emissive: 0xff1100, emissiveIntensity: 0, roughness: 0.3 });
    const t = new THREE.Mesh(tailGeo, tMat);
    t.position.set(-bodyLen * 0.5 - 0.009, lightY, sz);
    group.add(t);
    tailMats.push(tMat);
  }
  group.userData.headlights = headMats;
  group.userData.taillights = tailMats;
}

/**
 * Random realistic car color (HSL).
 */
export function randomCarColor() {
  const palettes = [
    // Common car colors
    0xcc2222, // red
    0x1133cc, // blue
    0x222222, // black
    0xdddddd, // silver
    0xffffff, // white
    0x116611, // dark green
    0xcc8800, // orange/gold
    0x884422, // brown
    0x557799, // steel blue
    0xaaaaaa, // grey
  ];
  return palettes[Math.floor(Math.random() * palettes.length)];
}

export function createSedan(color) {
  const group = new THREE.Group();
  const bL = 0.30, bW = 0.14, bH = 0.058;
  const bodyY = 0.044 + bH / 2;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.55 });

  // Main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(bL, bH, bW), mat);
  body.position.y = bodyY;
  group.add(body);

  // Cabin — narrower, slightly forward of center
  const cL = 0.155, cW = 0.11, cH = 0.052;
  const cabMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cL, cH, cW), cabMat);
  cab.position.set(0.008, bodyY + bH/2 + cH/2 - 0.002, 0);
  group.add(cab);

  _addWheels(group, bL, bW);
  _addLights(group, bL, bodyY, bH);
  return group;
}

export function createHatchback(color) {
  const group = new THREE.Group();
  const bL = 0.27, bW = 0.14, bH = 0.058;
  const bodyY = 0.044 + bH / 2;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(bL, bH, bW), mat);
  body.position.y = bodyY;
  group.add(body);

  // Wider / taller cabin that extends toward the rear
  const cL = 0.17, cW = 0.115, cH = 0.055;
  const cabMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cL, cH, cW), cabMat);
  cab.position.set(-0.01, bodyY + bH/2 + cH/2 - 0.002, 0);
  group.add(cab);

  _addWheels(group, bL, bW);
  _addLights(group, bL, bodyY, bH);
  return group;
}

export function createPickup(color) {
  const group = new THREE.Group();
  const bL = 0.34, bW = 0.15, bH = 0.056;
  const bodyY = 0.044 + bH / 2;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.65 });

  // Full chassis
  const body = new THREE.Mesh(new THREE.BoxGeometry(bL, bH, bW), mat);
  body.position.y = bodyY;
  group.add(body);

  // Cabin (front half only)
  const cL = 0.14, cW = 0.13, cH = 0.058;
  const cabMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.35 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cL, cH, cW), cabMat);
  cab.position.set(0.085, bodyY + bH/2 + cH/2 - 0.002, 0);
  group.add(cab);

  // Flatbed walls (low rails)
  const railMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
  for (const sz of [cW/2 + 0.005, -(cW/2 + 0.005)]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.022, 0.012), railMat);
    rail.position.set(-0.085, bodyY + bH/2 + 0.011, sz);
    group.add(rail);
  }

  _addWheels(group, bL, bW);
  _addLights(group, bL, bodyY, bH);
  return group;
}

export function createSports(color) {
  const group = new THREE.Group();
  const bL = 0.33, bW = 0.155, bH = 0.048; // lower, wider
  const bodyY = 0.040 + bH / 2;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(bL, bH, bW), mat);
  body.position.y = bodyY;
  group.add(body);

  // Short, low, raked cabin
  const cL = 0.13, cW = 0.12, cH = 0.042;
  const cabMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cL, cH, cW), cabMat);
  cab.position.set(0.015, bodyY + bH/2 + cH/2 - 0.002, 0);
  group.add(cab);

  _addWheels(group, bL, bW);
  _addLights(group, bL, bodyY, bH);
  return group;
}

export function createTruck() {
  const group = new THREE.Group();
  const bW = 0.16;
  const bodyY = 0.044;

  // Chassis base
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, bW), chassisMat);
  chassis.position.y = bodyY;
  group.add(chassis);

  // Cab (front)
  const cabColor = 0xcc4400;
  const cabMat = new THREE.MeshStandardMaterial({ color: cabColor, metalness: 0.3, roughness: 0.65 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, bW), cabMat);
  cab.position.set(0.155, bodyY + 0.02 + 0.05, 0);
  group.add(cab);

  // Windshield (dark)
  const windMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.3, metalness: 0.3 });
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.055, bW * 0.75), windMat);
  wind.position.set(0.088, bodyY + 0.02 + 0.07, 0);
  group.add(wind);

  // Cargo box (rear) — white
  const cargoMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 });
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, bW + 0.01), cargoMat);
  cargo.position.set(-0.085, bodyY + 0.02 + 0.065, 0);
  group.add(cargo);

  // Wheels (6 — truck has dual rear)
  const wGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.030, 8);
  const positions = [
    [ 0.155, 0.026,  bW/2 + 0.010], [ 0.155, 0.026, -(bW/2 + 0.010)],
    [-0.085, 0.026,  bW/2 + 0.012], [-0.085, 0.026, -(bW/2 + 0.012)],
    [-0.120, 0.026,  bW/2 + 0.012], [-0.120, 0.026, -(bW/2 + 0.012)],
  ];
  for (const [wx, wy, wz] of positions) {
    const w = new THREE.Mesh(wGeo, _wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wy, wz);
    group.add(w);
  }

  // Lights
  const headGeo = new THREE.BoxGeometry(0.018, 0.018, 0.028);
  const headMats = [], tailMats = [];
  for (const sz of [0.05, -0.05]) {
    const hMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 0 });
    const h = new THREE.Mesh(headGeo, hMat);
    h.position.set(0.22, bodyY + 0.06, sz);
    group.add(h);
    headMats.push(hMat);

    const tMat = new THREE.MeshStandardMaterial({ color: 0xff1100, emissive: 0xff1100, emissiveIntensity: 0 });
    const t = new THREE.Mesh(headGeo, tMat);
    t.position.set(-0.22, bodyY + 0.06, sz);
    group.add(t);
    tailMats.push(tMat);
  }
  group.userData.headlights = headMats;
  group.userData.taillights = tailMats;

  return group;
}

export function createPoliceCar() {
  // Base: sedan shape in black/white livery
  const group = new THREE.Group();
  const bL = 0.30, bW = 0.14, bH = 0.058;
  const bodyY = 0.044 + bH / 2;

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bL, bH, bW), bodyMat);
  body.position.y = bodyY;
  group.add(body);

  // Black hood and trunk stripes
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
  const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, bH + 0.001, bW + 0.001), stripeMat);
  hoodStripe.position.set(0.10, bodyY, 0);
  group.add(hoodStripe);
  const trunkStripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, bH + 0.001, bW + 0.001), stripeMat);
  trunkStripe.position.set(-0.10, bodyY, 0);
  group.add(trunkStripe);

  // Cabin
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.4, metalness: 0.3 });
  const cL = 0.155, cW = 0.11, cH = 0.052;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cL, cH, cW), cabMat);
  cab.position.set(0.008, bodyY + bH/2 + cH/2 - 0.002, 0);
  group.add(cab);

  // Light bar on roof
  const barBaseMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.014, 0.055), barBaseMat);
  barBase.position.set(0.008, bodyY + bH/2 + cH + 0.007, 0);
  group.add(barBase);

  // Red light (front half of bar)
  const redMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.0, roughness: 0.3 });
  const redLight = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.016, 0.040), redMat);
  redLight.position.set(0.028, bodyY + bH/2 + cH + 0.015, 0);
  group.add(redLight);

  // Blue light (rear half of bar)
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x0044ff, emissiveIntensity: 0.0, roughness: 0.3 });
  const blueLight = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.016, 0.040), blueMat);
  blueLight.position.set(-0.012, bodyY + bH/2 + cH + 0.015, 0);
  group.add(blueLight);

  group.userData.lightBarRed  = redMat;
  group.userData.lightBarBlue = blueMat;

  _addWheels(group, bL, bW);
  _addLights(group, bL, bodyY, bH);
  return group;
}

/**
 * School bus — yellow, wider and longer than a car, with rounded cab.
 */
export function createSchoolBus() {
  const group = new THREE.Group();
  const bL = 0.46, bW = 0.16, bH = 0.075;
  const bodyY = 0.044 + bH / 2;

  // Main body — bright yellow
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffc200, metalness: 0.2, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bL, bH, bW), bodyMat);
  body.position.y = bodyY;
  group.add(body);

  // Cabin (front, slightly narrower, same colour)
  const cabL = 0.12, cabW = bW * 0.88, cabH = 0.064;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cabL, cabH, cabW), bodyMat);
  cab.position.set(bL * 0.5 - cabL * 0.5 - 0.01, bodyY + bH / 2 + cabH / 2 - 0.004, 0);
  group.add(cab);

  // Black stripe along the side
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(bL + 0.002, 0.018, bW + 0.002), stripeMat);
  stripe.position.set(0, bodyY + bH * 0.20, 0);
  group.add(stripe);

  // Windows: 3 along the body sides (on +Z and -Z faces — but we'll do top boxes)
  const winMat = new THREE.MeshStandardMaterial({ color: 0x88bbee, roughness: 0.3, transparent: true, opacity: 0.7 });
  for (let i = -1; i <= 1; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.032, 0.006), winMat);
    win.position.set(i * 0.09, bodyY + bH * 0.45, bW / 2 + 0.002);
    group.add(win);
    const win2 = win.clone();
    win2.position.z = -bW / 2 - 0.002;
    group.add(win2);
  }

  // 6 wheels (3 axles)
  const wheelGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.030, 8);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [sx, sz] of [
    [bL * 0.36, bW * 0.5 + 0.006], [bL * 0.36, -(bW * 0.5 + 0.006)],
    [0,          bW * 0.5 + 0.006], [0,         -(bW * 0.5 + 0.006)],
    [-bL * 0.36, bW * 0.5 + 0.006],[-bL * 0.36,-(bW * 0.5 + 0.006)],
  ]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.025, sz);
    group.add(w);
  }

  // Headlights and taillights
  const headGeo = new THREE.BoxGeometry(0.018, 0.018, 0.028);
  const headMats = [], tailMats = [];
  for (const sz of [0.05, -0.05]) {
    const hMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 0 });
    const h = new THREE.Mesh(headGeo, hMat);
    h.position.set(bL * 0.5 + 0.009, bodyY + bH * 0.4, sz);
    group.add(h);
    headMats.push(hMat);
    const tMat = new THREE.MeshStandardMaterial({ color: 0xff1100, emissive: 0xff1100, emissiveIntensity: 0 });
    const t = new THREE.Mesh(headGeo, tMat);
    t.position.set(-bL * 0.5 - 0.009, bodyY + bH * 0.4, sz);
    group.add(t);
    tailMats.push(tMat);
  }
  group.userData.headlights = headMats;
  group.userData.taillights = tailMats;

  return group;
}

/**
 * Set headlight/taillight emissive intensity based on time of day.
 * @param {THREE.Group} carGroup
 * @param {boolean} isNight
 */
export function updateCarLights(carGroup, isNight) {
  const intensity = isNight ? 1.0 : 0.0;
  for (const mat of (carGroup.userData.headlights ?? [])) {
    mat.emissiveIntensity = intensity;
  }
  for (const mat of (carGroup.userData.taillights ?? [])) {
    mat.emissiveIntensity = isNight ? 0.7 : 0.0;
  }
}

/**
 * Animate police light bar (call each frame with elapsed time in ms).
 * @param {THREE.Group} carGroup
 * @param {number} elapsedMs
 */
export function updatePoliceBar(carGroup, elapsedMs) {
  if (!carGroup.userData.lightBarRed) return;
  const phase = (elapsedMs % 500) < 250; // 2 Hz flash
  carGroup.userData.lightBarRed.emissiveIntensity  = phase ? 1.0 : 0.0;
  carGroup.userData.lightBarBlue.emissiveIntensity = phase ? 0.0 : 1.0;
}
