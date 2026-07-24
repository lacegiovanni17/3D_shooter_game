import * as THREE from 'three';

// ── Constants ──────────────────────────────────────────────────────────────
const ARENA_SIZE = 40;
const WALL_HEIGHT = 6;
const PLAYER_SPEED = 14;
const TURN_SPEED = 2.2;
const BULLET_SPEED = 55;
const BULLET_DAMAGE = 12;
const FIRE_COOLDOWN = 0.35;
const BOT_FIRE_COOLDOWN = 0.7;
const MAX_HP = 100;
const BOT_SPEED = 7;
const BOT_AIM_ERROR = 0.08;

// ── State ──────────────────────────────────────────────────────────────────
const keys = {};
let running = false;
let kills = 0;

const player = {
  hp: MAX_HP,
  yaw: 0,
  x: 0,
  z: 12,
  fireTimer: 0,
};

const bot = {
  hp: MAX_HP,
  x: 0,
  z: -12,
  yaw: Math.PI,
  fireTimer: 0,
  strafeDir: 1,
  strafeTimer: 0,
  mesh: null,
  head: null,
  glowParts: [],
  animTime: 0,
};

const bullets = [];

// ── DOM ────────────────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const playerHpBar = document.getElementById('player-hp');
const playerHpText = document.getElementById('player-hp-text');
const botHpBar = document.getElementById('bot-hp');
const botHpText = document.getElementById('bot-hp-text');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');
const messageEl = document.getElementById('message');

// ── Three.js setup ─────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1018);
scene.fog = new THREE.Fog(0x0c1018, 20, 55);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const ambient = new THREE.AmbientLight(0x445566, 0.6);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffeedd, 1.1);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
scene.add(sun);

const rim = new THREE.PointLight(0x4466ff, 0.8, 50);
rim.position.set(-10, 8, -10);
scene.add(rim);

const rim2 = new THREE.PointLight(0xff4466, 0.6, 50);
rim2.position.set(10, 8, 10);
scene.add(rim2);

// ── Arena ──────────────────────────────────────────────────────────────────
function buildArena() {
  const half = ARENA_SIZE / 2;
  const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE, 20, 20);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1a2030,
    roughness: 0.85,
    metalness: 0.15,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid lines on floor
  const grid = new THREE.GridHelper(ARENA_SIZE, 20, 0x334466, 0x222a3a);
  grid.position.y = 0.02;
  scene.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x2a3048,
    roughness: 0.7,
    metalness: 0.2,
  });

  const wallGeo = new THREE.BoxGeometry(ARENA_SIZE, WALL_HEIGHT, 1);
  const walls = [
    [0, WALL_HEIGHT / 2, -half],
    [0, WALL_HEIGHT / 2, half],
    [-half, WALL_HEIGHT / 2, 0],
    [half, WALL_HEIGHT / 2, 0],
  ];
  const rotations = [0, 0, Math.PI / 2, Math.PI / 2];

  walls.forEach(([x, y, z], i) => {
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.position.set(x, y, z);
    w.rotation.y = rotations[i];
    w.castShadow = true;
    w.receiveShadow = true;
    scene.add(w);
  });

  // Cover pillars
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a4460, roughness: 0.6 });
  const pillarPositions = [
    [-8, 0, -5], [8, 0, -5], [-8, 0, 5], [8, 0, 5], [0, 0, 0],
  ];
  pillarPositions.forEach(([x, , z]) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 2.5), pillarMat);
    p.position.set(x, 1.5, z);
    p.castShadow = true;
    p.receiveShadow = true;
    scene.add(p);
  });

  // Ceiling glow strip
  const ceilGeo = new THREE.PlaneGeometry(ARENA_SIZE - 2, ARENA_SIZE - 2);
  const ceilMat = new THREE.MeshBasicMaterial({
    color: 0x112244,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_HEIGHT - 0.5;
  scene.add(ceil);
}

// ── Bot mesh ───────────────────────────────────────────────────────────────
function addPart(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function createBot() {
  const group = new THREE.Group();
  const glowParts = [];

  const armorDark = new THREE.MeshStandardMaterial({
    color: 0x1c1c24,
    roughness: 0.45,
    metalness: 0.75,
  });
  const armorMid = new THREE.MeshStandardMaterial({
    color: 0x3a2030,
    roughness: 0.5,
    metalness: 0.55,
  });
  const armorRed = new THREE.MeshStandardMaterial({
    color: 0x8b1a1a,
    roughness: 0.35,
    metalness: 0.65,
    emissive: 0x330000,
    emissiveIntensity: 0.25,
  });
  const jointMat = new THREE.MeshStandardMaterial({
    color: 0x111118,
    roughness: 0.6,
    metalness: 0.4,
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
  const visorGlow = new THREE.MeshBasicMaterial({ color: 0xff0011 });
  const gunMat = new THREE.MeshStandardMaterial({
    color: 0x151515,
    roughness: 0.25,
    metalness: 0.85,
  });

  // Legs
  [-0.28, 0.28].forEach((x) => {
    addPart(group, new THREE.BoxGeometry(0.32, 0.85, 0.36), armorDark, x, 0.42, 0.02);
    addPart(group, new THREE.BoxGeometry(0.36, 0.22, 0.42), armorRed, x, 0.92, -0.04);
    addPart(group, new THREE.BoxGeometry(0.38, 0.14, 0.48), jointMat, x, 0.07, 0.04);
  });

  // Waist & lower torso
  addPart(group, new THREE.BoxGeometry(1.0, 0.35, 0.65), armorMid, 0, 1.08, 0);
  addPart(group, new THREE.BoxGeometry(0.85, 0.12, 0.55), armorRed, 0, 1.28, -0.02);

  // Chest plate — angular, menacing silhouette
  addPart(group, new THREE.BoxGeometry(1.15, 0.75, 0.55), armorDark, 0, 1.62, -0.04);
  addPart(group, new THREE.BoxGeometry(0.7, 0.55, 0.12), armorRed, 0, 1.65, -0.32);
  addPart(group, new THREE.BoxGeometry(0.18, 0.5, 0.08), armorRed, -0.38, 1.62, -0.28, 0, 0.25, 0);
  addPart(group, new THREE.BoxGeometry(0.18, 0.5, 0.08), armorRed, 0.38, 1.62, -0.28, 0, -0.25, 0);

  // Glowing core on chest
  const core = addPart(group, new THREE.OctahedronGeometry(0.14, 0), glowMat, 0, 1.62, -0.36);
  glowParts.push(core);

  // Shoulder pauldrons with spikes
  [-0.72, 0.72].forEach((x) => {
    addPart(group, new THREE.BoxGeometry(0.45, 0.28, 0.5), armorDark, x, 1.88, -0.02);
    addPart(group, new THREE.BoxGeometry(0.35, 0.18, 0.38), armorRed, x, 1.98, -0.06);
    addPart(group, new THREE.ConeGeometry(0.08, 0.35, 4), armorRed, x, 2.18, -0.08, 0.3, 0, 0);
  });

  // Arms
  [-0.72, 0.72].forEach((x, i) => {
    const side = i === 0 ? -1 : 1;
    addPart(group, new THREE.BoxGeometry(0.22, 0.55, 0.28), jointMat, x + side * 0.08, 1.45, -0.1);
    addPart(group, new THREE.BoxGeometry(0.2, 0.45, 0.24), armorDark, x + side * 0.22, 1.05, -0.18, 0.5, 0, side * 0.15);
  });

  // Rifle — held across body
  const rifle = new THREE.Group();
  addPart(rifle, new THREE.BoxGeometry(0.12, 0.16, 0.75), gunMat, 0.35, 0, 0);
  addPart(rifle, new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8), gunMat, 0.35, 0.04, -0.55, Math.PI / 2, 0, 0);
  addPart(rifle, new THREE.BoxGeometry(0.08, 0.22, 0.12), gunMat, 0.35, -0.08, 0.18);
  const muzzleFlash = addPart(rifle, new THREE.SphereGeometry(0.06, 6, 6), glowMat, 0.35, 0.04, -0.86);
  muzzleFlash.visible = false;
  rifle.position.set(0.15, 1.42, -0.35);
  rifle.rotation.y = -0.15;
  group.add(rifle);

  // Head / helmet
  const headGroup = new THREE.Group();
  headGroup.position.y = 2.15;

  addPart(headGroup, new THREE.BoxGeometry(0.72, 0.62, 0.72), armorDark, 0, 0.18, 0);
  addPart(headGroup, new THREE.BoxGeometry(0.78, 0.18, 0.78), armorRed, 0, 0.48, -0.02);
  addPart(headGroup, new THREE.BoxGeometry(0.5, 0.12, 0.15), armorDark, 0, 0.08, -0.38);

  // Visor slit with glowing eyes
  addPart(headGroup, new THREE.BoxGeometry(0.48, 0.1, 0.06), new THREE.MeshStandardMaterial({
    color: 0x0a0000,
    roughness: 0.2,
    metalness: 0.9,
  }), 0, 0.14, -0.37);

  [-0.14, 0.14].forEach((x) => {
    const eye = addPart(headGroup, new THREE.SphereGeometry(0.055, 8, 8), visorGlow, x, 0.14, -0.4);
    glowParts.push(eye);
  });

  // Helmet crest / horns
  addPart(headGroup, new THREE.ConeGeometry(0.1, 0.45, 4), armorRed, 0, 0.62, -0.05);
  [-0.22, 0.22].forEach((x) => {
    addPart(headGroup, new THREE.ConeGeometry(0.07, 0.3, 4), armorRed, x, 0.52, -0.12, -0.4, 0, x > 0 ? 0.35 : -0.35);
  });

  // Antenna
  addPart(headGroup, new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6), jointMat, 0.28, 0.72, 0.12, 0.25, 0, 0.2);
  const antennaTip = addPart(headGroup, new THREE.SphereGeometry(0.06, 6, 6), glowMat, 0.32, 0.98, 0.18);
  glowParts.push(antennaTip);

  group.add(headGroup);

  // Backpack reactor
  addPart(group, new THREE.BoxGeometry(0.55, 0.65, 0.3), armorDark, 0, 1.55, 0.38);
  const reactor = addPart(group, new THREE.TorusGeometry(0.14, 0.04, 8, 12), glowMat, 0, 1.55, 0.52, Math.PI / 2, 0, 0);
  glowParts.push(reactor);

  // Side armor plates
  [-0.58, 0.58].forEach((x) => {
    addPart(group, new THREE.BoxGeometry(0.1, 0.6, 0.45), armorRed, x, 1.45, 0.08, 0, 0, x > 0 ? -0.2 : 0.2);
  });

  scene.add(group);
  bot.mesh = group;
  bot.head = headGroup;
  bot.glowParts = glowParts;
  bot.rifle = rifle;
  bot.muzzleFlash = muzzleFlash;
  return group;
}

function updateBotVisuals(dt) {
  bot.animTime += dt;
  const pulse = 0.55 + Math.sin(bot.animTime * 5) * 0.45;
  bot.glowParts.forEach((part) => {
    part.material.color.setRGB(1, pulse * 0.18, pulse * 0.04);
  });
}

// ── Weapon view (simple gun model attached to camera) ──────────────────────
function createGun() {
  const gun = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.6), mat);
  body.position.set(0.25, -0.2, -0.45);
  gun.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), mat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.25, -0.15, -0.75);
  gun.add(barrel);

  camera.add(gun);
  scene.add(camera);
  return gun;
}

const gunMesh = createGun();
let gunRecoil = 0;

// ── Bullets ────────────────────────────────────────────────────────────────
function spawnBullet(fromX, fromY, fromZ, dirX, dirZ, isPlayer) {
  const geo = new THREE.SphereGeometry(0.12, 6, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: isPlayer ? 0x44aaff : 0xff4444,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(fromX, fromY, fromZ);
  scene.add(mesh);

  bullets.push({
    mesh,
    vx: dirX * BULLET_SPEED,
    vz: dirZ * BULLET_SPEED,
    life: 2,
    isPlayer,
  });
}

function shoot(fromPlayer) {
  let x, y, z, yaw;

  if (fromPlayer) {
    x = player.x;
    y = 1.5;
    z = player.z;
    yaw = player.yaw;
  } else {
    x = bot.x;
    y = 2.0;
    z = bot.z;
    yaw = bot.yaw + (Math.random() - 0.5) * BOT_AIM_ERROR * 2;
  }

  const dirX = -Math.sin(yaw);
  const dirZ = -Math.cos(yaw);
  spawnBullet(x, y, z, dirX, dirZ, fromPlayer);

  if (fromPlayer) {
    gunRecoil = 0.08;
    flashCrosshair();
  } else if (bot.muzzleFlash) {
    bot.muzzleFlash.visible = true;
    setTimeout(() => { bot.muzzleFlash.visible = false; }, 80);
  }
}

function flashCrosshair() {
  const ch = document.getElementById('crosshair');
  ch.style.color = '#88ccff';
  ch.style.transform = 'translate(-50%, -50%) scale(1.3)';
  setTimeout(() => {
    ch.style.color = 'rgba(255,255,255,0.85)';
    ch.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 80);
}

// ── Collision ──────────────────────────────────────────────────────────────
function clampToArena(x, z, radius = 0.5) {
  const limit = ARENA_SIZE / 2 - radius - 0.5;
  return [
    Math.max(-limit, Math.min(limit, x)),
    Math.max(-limit, Math.min(limit, z)),
  ];
}

function hitsPillar(x, z, radius = 0.6) {
  const pillars = [
    [-8, -5], [8, -5], [-8, 5], [8, 5], [0, 0],
  ];
  return pillars.some(([px, pz]) => {
    const dx = x - px;
    const dz = z - pz;
    return Math.abs(dx) < 1.25 + radius && Math.abs(dz) < 1.25 + radius;
  });
}

function resolveMovement(x, z, radius = 0.5) {
  let [nx, nz] = clampToArena(x, z, radius);
  if (hitsPillar(nx, nz, radius)) {
    if (!hitsPillar(x, nz, radius)) nx = x;
    else if (!hitsPillar(nx, z, radius)) nz = z;
    else { nx = x; nz = z; }
  }
  return [nx, nz];
}

// ── Bot AI ─────────────────────────────────────────────────────────────────
function updateBotAI(dt) {
  const dx = player.x - bot.x;
  const dz = player.z - bot.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  bot.yaw = Math.atan2(-dx, -dz);

  bot.strafeTimer -= dt;
  if (bot.strafeTimer <= 0) {
    bot.strafeDir *= -1;
    bot.strafeTimer = 1.5 + Math.random() * 2;
  }

  const perpX = Math.cos(bot.yaw) * bot.strafeDir;
  const perpZ = -Math.sin(bot.yaw) * bot.strafeDir;

  let moveX = 0;
  let moveZ = 0;

  if (dist > 10) {
    moveX = -Math.sin(bot.yaw) * BOT_SPEED * dt;
    moveZ = -Math.cos(bot.yaw) * BOT_SPEED * dt;
  } else if (dist < 6) {
    moveX = Math.sin(bot.yaw) * BOT_SPEED * 0.7 * dt;
    moveZ = Math.cos(bot.yaw) * BOT_SPEED * 0.7 * dt;
  }

  moveX += perpX * BOT_SPEED * 0.5 * dt;
  moveZ += perpZ * BOT_SPEED * 0.5 * dt;

  [bot.x, bot.z] = resolveMovement(bot.x + moveX, bot.z + moveZ, 0.6);

  bot.mesh.position.set(bot.x, 0, bot.z);
  bot.mesh.rotation.y = bot.yaw;

  bot.fireTimer -= dt;
  if (bot.fireTimer <= 0 && dist < 30) {
    shoot(false);
    bot.fireTimer = BOT_FIRE_COOLDOWN;
  }
}

// ── Update bullets ─────────────────────────────────────────────────────────
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.z += b.vz * dt;
    b.life -= dt;

    const bx = b.mesh.position.x;
    const bz = b.mesh.position.z;
    let hit = false;

    if (Math.abs(bx) > ARENA_SIZE / 2 || Math.abs(bz) > ARENA_SIZE / 2) hit = true;
    if (hitsPillar(bx, bz, 0.1)) hit = true;

    if (!hit && b.isPlayer) {
      const dx = bx - bot.x;
      const dz = bz - bot.z;
      if (Math.sqrt(dx * dx + dz * dz) < 1.0) {
        bot.hp = Math.max(0, bot.hp - BULLET_DAMAGE);
        hit = true;
        showMessage('Hit!');
      }
    }

    if (!hit && !b.isPlayer) {
      const dx = bx - player.x;
      const dz = bz - player.z;
      if (Math.sqrt(dx * dx + dz * dz) < 0.8) {
        player.hp = Math.max(0, player.hp - BULLET_DAMAGE);
        hit = true;
        showMessage('You took damage!');
        flashDamage();
      }
    }

    if (hit || b.life <= 0) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      bullets.splice(i, 1);
    }
  }
}

function flashDamage() {
  renderer.domElement.style.boxShadow = 'inset 0 0 80px rgba(255,0,0,0.5)';
  setTimeout(() => { renderer.domElement.style.boxShadow = 'none'; }, 150);
}

// ── HUD ────────────────────────────────────────────────────────────────────
function updateHUD() {
  playerHpBar.style.width = `${(player.hp / MAX_HP) * 100}%`;
  playerHpText.textContent = Math.ceil(player.hp);
  botHpBar.style.width = `${(bot.hp / MAX_HP) * 100}%`;
  botHpText.textContent = Math.ceil(bot.hp);
  scoreEl.textContent = `Kills: ${kills}`;
}

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.classList.remove('hidden');
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => messageEl.classList.add('hidden'), 900);
}

// ── Game flow ──────────────────────────────────────────────────────────────
function resetRound() {
  player.hp = MAX_HP;
  player.x = 0;
  player.z = 12;
  player.yaw = Math.PI;
  player.fireTimer = 0;

  bot.hp = MAX_HP;
  bot.x = 0;
  bot.z = -12;
  bot.yaw = 0;
  bot.fireTimer = 1;
  bot.mesh.position.set(bot.x, 0, bot.z);

  bullets.forEach((b) => {
    scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
  });
  bullets.length = 0;

  statusEl.textContent = 'Eliminate the enemy';
  updateHUD();
}

function checkGameOver() {
  if (bot.hp <= 0) {
    kills++;
    statusEl.textContent = 'Enemy destroyed! Next round...';
    updateHUD();
    setTimeout(resetRound, 2000);
    return true;
  }
  if (player.hp <= 0) {
    statusEl.textContent = 'You were eliminated! Respawning...';
    setTimeout(resetRound, 2000);
    return true;
  }
  return false;
}

// ── Player input ───────────────────────────────────────────────────────────
function updatePlayer(dt) {
  if (keys.ArrowLeft) player.yaw += TURN_SPEED * dt;
  if (keys.ArrowRight) player.yaw -= TURN_SPEED * dt;

  let moveX = 0;
  let moveZ = 0;

  if (keys.ArrowUp) {
    moveX -= Math.sin(player.yaw) * PLAYER_SPEED * dt;
    moveZ -= Math.cos(player.yaw) * PLAYER_SPEED * dt;
  }
  if (keys.ArrowDown) {
    moveX += Math.sin(player.yaw) * PLAYER_SPEED * dt;
    moveZ += Math.cos(player.yaw) * PLAYER_SPEED * dt;
  }

  [player.x, player.z] = resolveMovement(player.x + moveX, player.z + moveZ);

  player.fireTimer -= dt;
  if (keys.Space && player.fireTimer <= 0) {
    shoot(true);
    player.fireTimer = FIRE_COOLDOWN;
  }
}

function updateCamera() {
  camera.position.set(player.x, 1.7, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = 0;

  if (gunRecoil > 0) {
    gunMesh.rotation.x = gunRecoil * 3;
    gunRecoil *= 0.85;
    if (gunRecoil < 0.001) gunRecoil = 0;
  } else {
    gunMesh.rotation.x *= 0.9;
  }
}

// ── Main loop ──────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let gameOverPause = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (running && !gameOverPause) {
    updatePlayer(dt);
    updateBotAI(dt);
    updateBullets(dt);
    updateCamera();
    updateHUD();

    if (checkGameOver()) {
      gameOverPause = true;
      setTimeout(() => { gameOverPause = false; }, 2000);
    }
  }

  updateBotVisuals(dt);
  renderer.render(scene, camera);
}

// ── Events ─────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
    keys[e.code] = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    keys[e.code] = false;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  running = true;
  resetRound();
});

// ── Init ───────────────────────────────────────────────────────────────────
buildArena();
createBot();
animate();
