/* 3D skills "totem" — a stack of slabs, one per skill.
 *
 * Loaded lazily by main.js, and only on desktop with WebGL and motion allowed.
 * The active skill's slab turns to face the camera and lifts forward; the
 * others drift around their axis as you scroll. All tunables live in the
 * constants below; the math helpers are exported so they can be unit-tested
 * without a browser.
 */
import * as THREE from 'three';

const ACCENT = 0xc8602a;

export const SEGMENT_WIDTH = 2.6;
export const SEGMENT_HEIGHT = 0.86;
export const SEGMENT_GAP = 0.14;

// Motion envelope. cameraDistance() frames the worst case of all of these, so
// change them here rather than inline in update().
export const ACTIVE_LIFT = 0.45;    // the active slab moves this far toward the camera
export const ACTIVE_SCALE = 1.05;
const BOB = 0.025;                  // idle vertical drift
export const TILT_BASE = 0.06;      // the stack leans back slightly (radians about x)
export const TILT_POINTER = 0.12;   // plus or minus this much following the pointer
const POINTER_TURN = 0.3;           // radians about y following the pointer

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = Math.round((TEXTURE_WIDTH * SEGMENT_HEIGHT) / SEGMENT_WIDTH);

/* ---------------------------------------------------------------------- */
/* Pure helpers                                                            */
/* ---------------------------------------------------------------------- */

// Frame-rate independent easing toward a target.
export const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

// Vertical position of a segment; index 0 is the top of the stack, centred on y = 0.
export function layoutY(index, count) {
  const total = count * SEGMENT_HEIGHT + (count - 1) * SEGMENT_GAP;
  return total / 2 - SEGMENT_HEIGHT / 2 - index * (SEGMENT_HEIGHT + SEGMENT_GAP);
}

// The active slab faces the camera (0). The others turn in alternating
// directions and keep turning as scroll progress (0..1) advances.
export function targetRotation(index, active, progress) {
  if (index === active) return 0;
  const direction = index % 2 === 0 ? 1 : -1;
  return direction * (Math.PI / 2 + progress * Math.PI);
}

export function stackHeight(count) {
  return count * SEGMENT_HEIGHT + (count - 1) * SEGMENT_GAP;
}

// Camera distance at which no slab leaves the frame. Slabs are SEGMENT_WIDTH
// deep, so their faces sit nearer the camera than the stack's centre plane;
// the active slab also lifts and grows, and the group tilts toward the pointer.
// Framing only the centre plane let the active bottom slab's label spill off
// the canvas. Every slab fits in a vertical cylinder of radius `reach`; its rim
// is checked at both tilt extremes.
export function cameraDistance(count, aspect, fovDegrees, margin = 0.1) {
  const tanY = Math.tan((fovDegrees * Math.PI) / 360);
  const tanX = tanY * aspect;
  const half = (SEGMENT_WIDTH / 2) * ACTIVE_SCALE;
  const reach = Math.max(Math.SQRT2 * half, Math.hypot(half, half + ACTIVE_LIFT));
  const top = (stackHeight(count) / 2) * ACTIVE_SCALE + BOB + margin;

  let distance = 0;
  for (const tilt of [TILT_BASE - TILT_POINTER, TILT_BASE + TILT_POINTER]) {
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    for (const y of [top, -top]) {
      for (const z of [reach, -reach]) {
        distance = Math.max(distance, Math.abs(y * cos - z * sin) / tanY + (y * sin + z * cos));
      }
      distance = Math.max(distance, (reach + margin) / tanX + Math.abs(y * sin));
    }
  }
  return distance;
}

/* ---------------------------------------------------------------------- */
/* Face artwork (2D canvas -> texture)                                     */
/* ---------------------------------------------------------------------- */

// kind: 'front' | 'frontActive' | 'side'
export function paintFace(ctx, kind, skill, index) {
  const w = TEXTURE_WIDTH;
  const h = TEXTURE_HEIGHT;
  const active = kind === 'frontActive';
  const side = kind === 'side';
  const number = String(index + 1).padStart(2, '0');
  const tag = skill.tag.toUpperCase();

  ctx.fillStyle = active ? '#c8602a' : side ? '#101010' : '#171717';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = active ? 'rgba(15, 15, 15, 0.35)' : 'rgba(245, 242, 236, 0.1)';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, w - 56, h - 56);
  ctx.textBaseline = 'alphabetic';

  if (side) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8602a';
    ctx.font = 'italic 34px "DM Serif Display", serif';
    ctx.fillText(number, w / 2, 104);
    ctx.fillStyle = '#3d3d3a';
    ctx.font = 'italic 96px "DM Serif Display", serif';
    ctx.fillText(tag, w / 2, h / 2 + 64);
    return;
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = active ? '#0f0f0f' : '#c8602a';
  ctx.font = 'italic 34px "DM Serif Display", serif';
  ctx.fillText(number, 72, 104);

  ctx.textAlign = 'right';
  ctx.fillStyle = active ? 'rgba(15, 15, 15, 0.75)' : '#9a9890';
  ctx.font = '500 24px "DM Sans", sans-serif';
  ctx.fillText(tag.split('').join('\u200A'), w - 72, 104); // hair spaces fake letter-spacing

  // Skill name, shrunk until it fits the face.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f5f2ec';
  const maxWidth = w - 144;
  let size = 84;
  do {
    ctx.font = `${size}px "DM Serif Display", serif`;
    size -= 4;
  } while (ctx.measureText(skill.name).width > maxWidth && size > 32);
  ctx.fillText(skill.name, 72, h - 84);
}

function createFaceTexture(kind, skill, index, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  paintFace(canvas.getContext('2d'), kind, skill, index);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/* ---------------------------------------------------------------------- */
/* Scene graph (no DOM / WebGL needed — textures are injected)             */
/* ---------------------------------------------------------------------- */

function faceMaterial(texture, emissiveIntensity) {
  // A little emissive keeps the lettering readable whatever the lights do.
  return new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity,
    roughness: 0.55,
    metalness: 0.15,
  });
}

export function buildTotem(skills, makeTexture) {
  const group = new THREE.Group();
  const boxGeometry = new THREE.BoxGeometry(SEGMENT_WIDTH, SEGMENT_HEIGHT, SEGMENT_WIDTH);
  const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7, metalness: 0.1 });

  const segments = skills.map((skill, index) => {
    const idleTexture = makeTexture('front', skill, index);
    const activeTexture = makeTexture('frontActive', skill, index);
    const sideTexture = makeTexture('side', skill, index);

    const frontMaterial = faceMaterial(idleTexture, 0.4);
    const sideMaterial = faceMaterial(sideTexture, 0.3);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3 });

    // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z
    const mesh = new THREE.Mesh(boxGeometry, [sideMaterial, sideMaterial, capMaterial, capMaterial, frontMaterial, sideMaterial]);
    mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
    mesh.position.y = layoutY(index, skills.length);
    group.add(mesh);

    return { mesh, frontMaterial, sideMaterial, edgeMaterial, idleTexture, activeTexture, sideTexture };
  });

  const setActiveFace = (activeIndex) => {
    segments.forEach((segment, index) => {
      const texture = index === activeIndex ? segment.activeTexture : segment.idleTexture;
      segment.frontMaterial.map = texture;
      segment.frontMaterial.emissiveMap = texture;
      segment.frontMaterial.emissiveIntensity = index === activeIndex ? 0.55 : 0.4;
    });
  };

  const dispose = () => {
    boxGeometry.dispose();
    edgeGeometry.dispose();
    capMaterial.dispose();
    segments.forEach((segment) => {
      segment.frontMaterial.dispose();
      segment.sideMaterial.dispose();
      segment.edgeMaterial.dispose();
      segment.idleTexture.dispose();
      segment.activeTexture.dispose();
      segment.sideTexture.dispose();
    });
  };

  return { group, segments, setActiveFace, dispose };
}

/* ---------------------------------------------------------------------- */
/* Renderer + loop                                                         */
/* ---------------------------------------------------------------------- */

export async function createTotem({ container, skills }) {
  // Canvas text needs the web fonts; don't paint textures with fallbacks.
  if (document.fonts) {
    await Promise.race([
      Promise.all([
        document.fonts.load('italic 34px "DM Serif Display"'),
        document.fonts.load('84px "DM Serif Display"'),
        document.fonts.load('500 24px "DM Sans"'),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => {});
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const totem = buildTotem(skills, (kind, skill, index) => createFaceTexture(kind, skill, index, anisotropy));
  scene.add(totem.group);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffe6d5, 2.4);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.PointLight(ACCENT, 80, 30, 2);
  rim.position.set(-6, 2, -3);
  scene.add(rim);

  const state = { active: 0, progress: 0, time: 0 };
  const pointer = { x: 0, y: 0 };
  totem.setActiveFace(state.active);

  // Frame the whole stack, through its full motion, at any stage aspect.
  const fit = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, cameraDistance(skills.length, camera.aspect, camera.fov));
  };
  fit();

  const update = (dt) => {
    state.time += dt;
    totem.segments.forEach((segment, index) => {
      const isActive = index === state.active;
      const { mesh } = segment;
      mesh.rotation.y = damp(mesh.rotation.y, targetRotation(index, state.active, state.progress), 5, dt);
      mesh.position.z = damp(mesh.position.z, isActive ? ACTIVE_LIFT : 0, 6, dt);
      mesh.position.y = layoutY(index, skills.length) + Math.sin(state.time * 0.9 + index * 0.8) * BOB;
      mesh.scale.setScalar(damp(mesh.scale.x, isActive ? ACTIVE_SCALE : 1, 6, dt));
      segment.edgeMaterial.opacity = damp(segment.edgeMaterial.opacity, isActive ? 0.95 : 0.3, 6, dt);
    });
    totem.group.rotation.y = damp(totem.group.rotation.y, pointer.x * POINTER_TURN, 3, dt);
    totem.group.rotation.x = damp(totem.group.rotation.x, TILT_BASE + pointer.y * TILT_POINTER, 3, dt);
  };

  let running = false;
  let visible = false;
  let frame = 0;
  let last = 0;

  const loop = (now) => {
    if (!running) return;
    frame = requestAnimationFrame(loop);
    update(Math.min(0.05, (now - last) / 1000));
    last = now;
    renderer.render(scene, camera);
  };
  const sync = () => {
    const shouldRun = visible && !document.hidden;
    if (shouldRun && !running) {
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(frame);
    }
  };

  // Only render while on screen and the tab is visible.
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  visibilityObserver.observe(container);
  document.addEventListener('visibilitychange', sync);

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(container);

  const onPointerMove = (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    running = false;
    cancelAnimationFrame(frame);
  });
  renderer.domElement.addEventListener('webglcontextrestored', sync);

  renderer.render(scene, camera); // first frame, even before the loop starts

  return {
    setActive(index) {
      state.active = index;
      totem.setActiveFace(index);
    },
    setProgress(progress) {
      state.progress = progress;
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pointermove', onPointerMove);
      totem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
