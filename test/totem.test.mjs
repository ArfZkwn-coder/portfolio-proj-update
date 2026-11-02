import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  damp, layoutY, targetRotation, stackHeight, paintFace, buildTotem, cameraDistance,
  SEGMENT_WIDTH, SEGMENT_HEIGHT, SEGMENT_GAP, ACTIVE_LIFT, ACTIVE_SCALE, TILT_BASE, TILT_POINTER,
} from '../js/totem.js';

const skills = ['Python', 'SQL & Data Analytics', 'AI & Machine Learning', 'CRM Tools', 'Marketing Automation', 'Linux System Administration']
  .map((name, i) => ({ name, tag: ['Language', 'Data', 'AI', 'CRM', 'Automation', 'Web'][i] }));

test('layout: symmetric around y=0, evenly spaced, index 0 on top', () => {
  const n = 6;
  const ys = Array.from({ length: n }, (_, i) => layoutY(i, n));
  assert.ok(Math.abs(ys[0] + ys[n - 1]) < 1e-9, 'top and bottom mirror each other');
  for (let i = 1; i < n; i++) assert.ok(Math.abs((ys[i - 1] - ys[i]) - (SEGMENT_HEIGHT + SEGMENT_GAP)) < 1e-9);
  assert.ok(ys[0] > ys[n - 1]);
  assert.ok(Math.abs(stackHeight(n) - (ys[0] - ys[n - 1] + SEGMENT_HEIGHT)) < 1e-9, 'stackHeight matches layout');
});

test('rotation: active faces camera; others alternate direction and advance with progress', () => {
  assert.equal(targetRotation(3, 3, 0.7), 0);
  assert.ok(targetRotation(0, 2, 0) > 0 && targetRotation(1, 2, 0) < 0, 'alternating sign');
  assert.ok(targetRotation(0, 2, 1) > targetRotation(0, 2, 0), 'keeps turning with scroll progress');
});

test('framing: every slab corner stays in frame through the full motion range', () => {
  // Brute force, independent of cameraDistance's own reasoning: project the box
  // corners of each slab, active (lifted, scaled, facing) or turned at any
  // angle, under every tilt the pointer can produce, for tall and wide stages.
  const fov = 32;
  const n = 6;
  const half = SEGMENT_WIDTH / 2;
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx, sy, sz]);

  for (const aspect of [0.6, 0.8, 1.4]) {
    const distance = cameraDistance(n, aspect, fov);
    const tanY = Math.tan((fov * Math.PI) / 360);
    const tanX = tanY * aspect;
    for (let step = 0; step <= 8; step++) {
      const tilt = TILT_BASE - TILT_POINTER + (2 * TILT_POINTER * step) / 8;
      for (let index = 0; index < n; index++) {
        for (const active of [true, false]) {
          for (const turn of active ? [0] : [0, Math.PI / 8, Math.PI / 4, Math.PI / 3]) {
            const scale = active ? ACTIVE_SCALE : 1;
            for (const [sx, sy, sz] of corners) {
              const point = new THREE.Vector3(sx * half * scale, sy * (SEGMENT_HEIGHT / 2) * scale, sz * half * scale)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), turn)
                .add(new THREE.Vector3(0, layoutY(index, n), active ? ACTIVE_LIFT : 0))
                .applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
              const depth = distance - point.z;
              assert.ok(depth > 0, 'every corner is in front of the camera');
              assert.ok(Math.abs(point.y) / depth <= tanY,
                `slab ${index + 1} (${active ? 'active' : 'turned'}) leaves the frame vertically at tilt ${tilt.toFixed(2)}, aspect ${aspect}`);
              assert.ok(Math.abs(point.x) / depth <= tanX,
                `slab ${index + 1} (${active ? 'active' : 'turned'}) leaves the frame sideways at aspect ${aspect}`);
            }
          }
        }
      }
    }
  }
});

test('damp: converges monotonically, never overshoots, frame-rate independent', () => {
  let v = 0;
  for (let i = 0; i < 300; i++) { const next = damp(v, 1, 5, 1 / 60); assert.ok(next >= v && next <= 1); v = next; }
  assert.ok(v > 0.999);
  // one 1/30s step == two 1/60s steps
  const a = damp(0, 1, 5, 1 / 30);
  const b = damp(damp(0, 1, 5, 1 / 60), 1, 5, 1 / 60);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.equal(damp(0.4, 0.4, 5, 0.016), 0.4);
});

test('paintFace: all three kinds render; long names shrink and the loop terminates', () => {
  for (const kind of ['front', 'frontActive', 'side']) {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, key) => key === 'measureText'
        ? (text) => ({ width: text.length * parseInt(String(ctx.font).match(/(\d+)px/)?.[1] ?? '10', 10) * 0.5 })
        : (...args) => calls.push([String(key), ...args]),
      set: (_, key, value) => { calls.push(['set', String(key), value]); Object.defineProperty(ctx, key, { value, writable: true, configurable: true }); return true; },
    });
    assert.doesNotThrow(() => paintFace(ctx, kind, { name: 'An extremely long skill name that cannot possibly fit on one face', tag: 'Tag' }, 4));
    assert.ok(calls.some((c) => c[0] === 'fillText'), `${kind} draws text`);
  }
});

test('buildTotem: 6 slabs, 6 materials each, positions from layout, fonts/textures injected', () => {
  const made = [];
  const totem = buildTotem(skills, (kind, skill, index) => { const t = new THREE.Texture(); made.push([kind, index]); return t; });
  assert.equal(totem.segments.length, 6);
  assert.equal(made.length, 18, '3 textures per slab');
  totem.segments.forEach((s, i) => {
    assert.equal(s.mesh.material.length, 6);
    assert.ok(Math.abs(s.mesh.position.y - layoutY(i, 6)) < 1e-9);
    assert.equal(s.mesh.material[4], s.frontMaterial, 'front face is +z (material index 4)');
    assert.equal(s.frontMaterial.map, s.idleTexture);
  });
  totem.setActiveFace(2);
  assert.equal(totem.segments[2].frontMaterial.map, totem.segments[2].activeTexture);
  assert.equal(totem.segments[3].frontMaterial.map, totem.segments[3].idleTexture);
  assert.equal(totem.segments[2].frontMaterial.emissiveMap, totem.segments[2].activeTexture);
  totem.setActiveFace(3);
  assert.equal(totem.segments[2].frontMaterial.map, totem.segments[2].idleTexture, 'previous slab reverts');
  assert.doesNotThrow(() => totem.dispose());
});
