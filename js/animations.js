/**
 * @module animations
 * Lightweight animation system for building demolish and rise animations.
 * No external libraries — just a module-level array ticked each frame.
 */

// Each entry: { mesh, type:'demolish'|'rise', t, duration, data, onComplete }
const _anims = [];
const GROUND_Y = 0.03; // TILE_H/2

/**
 * Start a demolish animation on a mesh.
 * Phase 1 (0–28%): shake
 * Phase 2 (28–100%): sink into ground
 * @param {THREE.Object3D} mesh
 * @param {function} [onComplete]
 */
export function animateDemolish(mesh, onComplete) {
  // Cancel any existing animation on this mesh first
  cancelAnimation(mesh);

  const origX = mesh.position.x;
  const origY = mesh.position.y;
  const origZ = mesh.position.z;

  _anims.push({
    mesh,
    type: 'demolish',
    t: 0,
    duration: 850,
    data: { origX, origY, origZ },
    onComplete: onComplete ?? null,
  });
}

/**
 * Start a rise animation on a mesh.
 * @param {THREE.Object3D} mesh
 * @param {function} [onComplete]
 */
export function animateRise(mesh, onComplete) {
  // Cancel any existing animation on this mesh first
  cancelAnimation(mesh);

  const targetY = mesh.position.y;

  // Immediately snap to start state
  mesh.scale.y = 0.01;
  mesh.position.y = GROUND_Y;

  _anims.push({
    mesh,
    type: 'rise',
    t: 0,
    duration: 1900,
    data: { targetY },
    onComplete: onComplete ?? null,
  });
}

/**
 * Cancel any pending animation on this mesh, snapping to end state.
 * @param {THREE.Object3D} mesh
 */
export function cancelAnimation(mesh) {
  for (let i = _anims.length - 1; i >= 0; i--) {
    const a = _anims[i];
    if (a.mesh !== mesh) continue;

    // Snap to end state
    if (a.type === 'rise') {
      mesh.scale.set(1, 1, 1);
      mesh.position.y = a.data.targetY;
    } else if (a.type === 'demolish') {
      mesh.scale.set(1, 0.001, 1);
      mesh.position.x = a.data.origX;
      mesh.position.y = a.data.origY - 1.8;
      mesh.position.z = a.data.origZ;
    }

    _anims.splice(i, 1);
  }
}

/**
 * Piecewise easeInOut between two keyframe segments.
 * keyframes: array of [p, v] pairs sorted by p ascending.
 * @param {number} p  Progress [0,1]
 * @param {Array<[number,number]>} kf
 * @returns {number}
 */
function _kfEase(p, kf) {
  // Find which segment p is in
  for (let i = 0; i < kf.length - 1; i++) {
    const [p0, v0] = kf[i];
    const [p1, v1] = kf[i + 1];
    if (p >= p0 && p <= p1) {
      const segP = (p - p0) / (p1 - p0); // 0..1 within segment
      // easeInOut within the segment
      const eased = segP < 0.5
        ? 2 * segP * segP
        : 1 - Math.pow(-2 * segP + 2, 2) / 2;
      return v0 + (v1 - v0) * eased;
    }
  }
  return kf[kf.length - 1][1];
}

// Rise keyframes — "construction crew pausing between floors" feel
const RISE_KF = [
  [0.00, 0.000],
  [0.30, 0.420],
  [0.42, 0.420],
  [0.65, 0.740],
  [0.74, 0.740],
  [0.90, 0.970],
  [1.00, 1.000],
];

/**
 * Advance all active animations by dt milliseconds.
 * Iterate backwards so splice is safe.
 * @param {number} dt  milliseconds
 */
export function tickAnimations(dt) {
  for (let i = _anims.length - 1; i >= 0; i--) {
    const a = _anims[i];
    a.t += dt;

    const p = Math.min(1, a.t / a.duration);

    if (a.type === 'demolish') {
      const { origX, origY, origZ } = a.data;
      const shakeEnd = 0.28;

      if (p <= shakeEnd) {
        // Shake phase
        const shakeProgress = p / shakeEnd;
        a.mesh.position.x = origX + Math.sin(shakeProgress * 22 * Math.PI) * 0.10 * (1 - shakeProgress);
        a.mesh.position.z = origZ + Math.sin(shakeProgress * 22 * Math.PI) * 0.04 * (1 - shakeProgress);
        a.mesh.position.y = origY;
        a.mesh.scale.y    = 1;
      } else {
        // Sink phase
        const sinkProgress = (p - shakeEnd) / (1 - shakeEnd);
        const sinkEase = sinkProgress * sinkProgress;
        const scaleY = Math.max(0.001, 1 - sinkEase);
        a.mesh.scale.y    = scaleY;
        a.mesh.position.y = origY - sinkEase * 1.8;
        a.mesh.position.x = origX;
        a.mesh.position.z = origZ;
      }
    } else if (a.type === 'rise') {
      const { targetY } = a.data;
      const scaleY = _kfEase(p, RISE_KF);
      a.mesh.scale.y    = Math.max(0.01, scaleY);
      a.mesh.position.y = GROUND_Y + (targetY - GROUND_Y) * scaleY;
    }

    if (p >= 1) {
      // Snap to final state
      if (a.type === 'rise') {
        a.mesh.scale.set(1, 1, 1);
        a.mesh.position.y = a.data.targetY;
      }
      // For demolish, caller removes from scene in onComplete

      if (a.onComplete) a.onComplete();
      _anims.splice(i, 1);
    }
  }
}
