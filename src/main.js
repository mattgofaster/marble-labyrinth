import './style.css';
import { LEVELS, COLS, ROWS } from './levels.js';
import { Sound } from './audio.js';

// ---------- Tuning (distances are in board cells) ----------
const BALL_R = 0.34;
const HOLE_R = 0.4;
const FALL_AT = HOLE_R - BALL_R * 0.3; // ball centre this close to a pit centre = it drops
const LIP = HOLE_R + BALL_R * 0.25; // inside this range the pit edge pulls the ball in
// Tilt speed setting: cells/s² of acceleration at a full 90° tilt.
const SPEEDS = { gentle: 100, normal: 145, fast: 210 };
const MAX_SPEED = 24; // cells/s; at 240 physics steps/s that's still < 0.12 cells per step
const DAMPING = 0.45; // rolling resistance, per second
const BOUNCE = 0.4;
const MAX_TILT_DEG = 22; // tilting further than this doesn't go any faster
const DEADZONE_DEG = 1.2;
const KEY_TILT = 0.42;
const STEP = 1 / 240;
const COUNTDOWN = 1.6;

const COLORS = {
  floor: '#9fb88d',
  floorDark: '#86a275',
  wall: '#3d5a47',
  wallTop: '#4e705a',
  wallLight: 'rgba(214, 235, 205, 0.55)',
  wallDark: 'rgba(10, 22, 15, 0.55)',
  pit: '#050a07',
  pitEdge: '#26382c',
  label: 'rgba(36, 56, 42, 0.7)',
  gold: '#e4b54c',
  goldDeep: '#7a5a14',
};

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const boardLayer = document.createElement('canvas');
const bctx = boardLayer.getContext('2d');
const sound = new Sound();

// ---------- Saved progress ----------
const SAVE_KEY = 'marble-labyrinth-v1';
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.best) return s;
  } catch {}
  return { best: {}, unlocked: 1, muted: false };
}
const save = loadSave();
if (!SPEEDS[save.speed]) save.speed = 'normal';
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {}
}

// ---------- Level ----------
let level = null;
let levelIndex = 0;

function parseLevel(i) {
  const def = LEVELS[i];
  const walls = new Uint8Array(COLS * ROWS);
  const holes = [];
  const checkpoints = [];
  let start;
  let goal;
  def.map.forEach((row, y) => {
    for (let x = 0; x < COLS; x++) {
      const c = row[x];
      const p = { x: x + 0.5, y: y + 0.5, cx: x, cy: y };
      if (c === '#') walls[y * COLS + x] = 1;
      else if (c === 'O') holes.push(p);
      else if (c === 'S') start = p;
      else if (c === 'G') goal = p;
      else if (c === 'C') checkpoints.push({ ...p, hit: false });
    }
  });

  // Number the pits in the order you meet them along the route, like the
  // printed numbers on a wooden labyrinth board.
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  const queue = [start.cy * COLS + start.cx];
  dist[queue[0]] = 0;
  while (queue.length) {
    const k = queue.shift();
    const x = k % COLS;
    const y = (k / COLS) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const nk = ny * COLS + nx;
      if (walls[nk] || dist[nk] >= 0) continue;
      dist[nk] = dist[k] + 1;
      queue.push(nk);
    }
  }
  holes.sort((a, b) => dist[a.cy * COLS + a.cx] - dist[b.cy * COLS + b.cx]);
  holes.forEach((h, n) => (h.n = n + 1));

  return { ...def, walls, holes, checkpoints, start, goal };
}

function isWall(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
  return level.walls[y * COLS + x] === 1;
}

// ---------- Game state ----------
const ball = { x: 0, y: 0, vx: 0, vy: 0, scale: 1 };
let phase = 'title'; // title | countdown | play | falling | spawning | won | paused
let phaseT = 0;
let pausedFrom = null;
let runTime = 0;
let falls = 0;
let respawn = null;
let animFrom = null;
let animTo = null;
let frameImpact = 0;
let warnedNoTilt = false;

function setPhase(p) {
  phase = p;
  phaseT = 0;
}

function placeBall(p) {
  ball.x = p.x;
  ball.y = p.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.scale = 1;
}

function startLevel(i) {
  levelIndex = i;
  level = parseLevel(i);
  respawn = level.start;
  placeBall(respawn);
  runTime = 0;
  falls = 0;
  renderBoard();
  updateHud();
  $('menu').hidden = true;
  $('complete').hidden = true;
  setPhase('countdown');
  sound.blip();
}

// ---------- Input ----------
const input = {
  raw: null, // smoothed device tilt in degrees, already mapped to screen axes
  neutral: null,
  motionAt: 0,
  keys: { left: false, right: false, up: false, down: false },
  keyTilt: { x: 0, y: 0 },
  drag: null,
  tilt: { x: 0, y: 0 },
};

function screenAngle() {
  // iOS keeps the old window.orientation (0, 90, -90) and it's the most
  // dependable source there; fall back to the newer Screen Orientation API.
  let a = typeof window.orientation === 'number' ? window.orientation : null;
  if (a == null && screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
  a = (((a || 0) % 360) + 360) % 360;
  // If the viewport is clearly landscape but no angle was reported, assume
  // the usual direction rather than leaving the game sideways.
  if ((a === 0 || a === 180) && window.innerWidth > window.innerHeight * 1.15) a = 90;
  return a;
}

// The game is always drawn upright in the phone's portrait orientation (see
// applyPortraitLock), so device axes map straight onto the board.
window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  const x = e.gamma;
  const y = e.beta;
  if (!input.raw) input.raw = { x, y };
  else {
    input.raw.x += (x - input.raw.x) * 0.5;
    input.raw.y += (y - input.raw.y) * 0.5;
  }
  input.motionAt = performance.now();
});

function motionLive() {
  return !!input.raw && performance.now() - input.motionAt < 600;
}

function degToTilt(d) {
  const a = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, d));
  const mag = Math.max(0, Math.abs(a) - DEADZONE_DEG);
  return Math.sign(a) * Math.sin((mag * Math.PI) / 180);
}

function updateTilt(dt) {
  const k = input.keys;
  const kx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const ky = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  const ease = Math.min(1, dt * 8);
  input.keyTilt.x += (kx * KEY_TILT - input.keyTilt.x) * ease;
  input.keyTilt.y += (ky * KEY_TILT - input.keyTilt.y) * ease;

  let tx;
  let ty;
  let showOnScreen = true;
  // Tilt data can start arriving after the countdown (e.g. the permission
  // prompt was still open). Take the first reading as level instead of
  // ignoring the sensor forever.
  if (motionLive() && !input.neutral) input.neutral = { ...input.raw };

  if (input.drag) {
    tx = input.drag.tx;
    ty = input.drag.ty;
  } else if (motionLive() && input.neutral) {
    tx = degToTilt(input.raw.x - input.neutral.x);
    ty = degToTilt(input.raw.y - input.neutral.y);
    showOnScreen = false; // the phone itself is tilting, so don't tilt the picture too
  } else {
    tx = input.keyTilt.x;
    ty = input.keyTilt.y;
  }
  input.tilt.x = tx;
  input.tilt.y = ty;

  const rx = showOnScreen ? -ty * 14 : 0;
  const ry = showOnScreen ? tx * 14 : 0;
  canvas.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
}

const KEYMAP = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
};
window.addEventListener('keydown', (e) => {
  const dir = KEYMAP[e.key];
  if (dir) {
    input.keys[dir] = true;
    e.preventDefault();
  } else if (e.key === 'Escape' || e.key === 'p') {
    togglePause();
  } else if (e.key === 'r' && level && phase !== 'title') {
    startLevel(levelIndex);
  }
});
window.addEventListener('keyup', (e) => {
  const dir = KEYMAP[e.key];
  if (dir) input.keys[dir] = false;
});
window.addEventListener('blur', () => {
  for (const k in input.keys) input.keys[k] = false;
});

// Drag-to-tilt: the fallback when there's no tilt sensor (desktop mouse,
// or an iPhone where motion access was declined).
const stage = $('stage');
const stick = $('stick');
const knob = $('stick-knob');
stage.addEventListener('pointerdown', (e) => {
  if (motionLive() || phase === 'title') return;
  const r = stage.getBoundingClientRect();
  input.drag = { id: e.pointerId, ox: e.clientX, oy: e.clientY, tx: 0, ty: 0 };
  stage.setPointerCapture(e.pointerId);
  stick.style.left = `${e.clientX - r.left}px`;
  stick.style.top = `${e.clientY - r.top}px`;
  knob.style.transform = '';
  stick.hidden = !!lockAngle; // its position would be off while counter-rotated
});
stage.addEventListener('pointermove', (e) => {
  const d = input.drag;
  if (!d || d.id !== e.pointerId) return;
  let dx = e.clientX - d.ox;
  let dy = e.clientY - d.oy;
  if (lockAngle) {
    // Screen-space drag → board-space drag while the app is counter-rotated.
    const r = (lockAngle * Math.PI) / 180;
    [dx, dy] = [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
  }
  const len = Math.hypot(dx, dy);
  const max = 48;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  d.tx = (dx / max) * 0.5;
  d.ty = (dy / max) * 0.5;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
});
function endDrag(e) {
  if (input.drag && input.drag.id === e.pointerId) {
    input.drag = null;
    stick.hidden = true;
  }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// iOS asks permission for motion data, and only from inside a tap.
// Resolves once the viewer has answered, so the countdown starts after the prompt.
let motionGranted = false;
const DENIED_MSG =
  'Motion access was denied. Swipe Safari closed, reopen this page and tap Allow. Until then, drag on the board to tilt.';
function requestMotion() {
  const DOE = window.DeviceOrientationEvent;
  if (motionGranted || !DOE) return Promise.resolve();
  if (!window.isSecureContext) {
    toast('Tilt needs an https:// address. Drag on the board to play for now.', 4500);
    return Promise.resolve();
  }
  if (typeof DOE.requestPermission !== 'function') {
    motionGranted = true; // Android and older iOS: no prompt needed
    return Promise.resolve();
  }
  return DOE.requestPermission()
    .then((r) => {
      motionGranted = r === 'granted';
      if (!motionGranted) toast(DENIED_MSG, 6000);
    })
    .catch(() => toast(DENIED_MSG, 6000));
}

// ---------- Portrait lock ----------
// iOS Safari can't lock orientation, so when the phone turns sideways we
// rotate the whole app back so it stays upright relative to the phone.
let lockAngle = 0;
function applyPortraitLock() {
  try {
    screen.orientation?.lock?.('portrait').catch(() => {});
  } catch {}
  const a = screenAngle();
  const app = $('app');
  lockAngle = a === 90 || a === 270 || a === 180 ? a : 0;
  // Only counter-rotate on touch devices: a wide desktop window isn't "landscape".
  const isPhone = matchMedia('(pointer: coarse)').matches;
  if (!isPhone || lockAngle === 0) {
    lockAngle = 0;
    app.classList.remove('rotated');
    app.style.width = app.style.height = app.style.transform = '';
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sideways = lockAngle !== 180;
  app.classList.add('rotated');
  app.style.width = `${sideways ? h : w}px`;
  app.style.height = `${sideways ? w : h}px`;
  app.style.transform = `translate(-50%, -50%) rotate(${-lockAngle}deg)`;
  stick.hidden = true;
  if (!rotateTipShown) {
    rotateTipShown = true;
    toast('Tip: turn on Portrait Orientation Lock in Control Center to stop the screen from spinning while you tilt.', 6000);
  }
}
let rotateTipShown = false;

function recenter() {
  if (motionLive()) {
    input.neutral = { ...input.raw };
    toast('Level set to how you are holding the phone now.');
  } else {
    toast('Recenter works when you play by tilting the phone.');
  }
}

// ---------- Physics ----------
function collideWalls() {
  const cx = Math.floor(ball.x);
  const cy = Math.floor(ball.y);
  for (let j = cy - 1; j <= cy + 1; j++) {
    for (let i = cx - 1; i <= cx + 1; i++) {
      if (!isWall(i, j)) continue;
      const px = Math.max(i, Math.min(ball.x, i + 1));
      const py = Math.max(j, Math.min(ball.y, j + 1));
      let dx = ball.x - px;
      let dy = ball.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= BALL_R * BALL_R) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        // Centre ended up inside a wall cell: push out the shortest way.
        const opts = [
          [ball.x - i, -1, 0],
          [i + 1 - ball.x, 1, 0],
          [ball.y - j, 0, -1],
          [j + 1 - ball.y, 0, 1],
        ].sort((a, b) => a[0] - b[0]);
        dx = opts[0][1];
        dy = opts[0][2];
        d = -opts[0][0];
      } else {
        dx /= d;
        dy /= d;
      }
      const pen = BALL_R - d;
      ball.x += dx * pen;
      ball.y += dy * pen;
      const vn = ball.vx * dx + ball.vy * dy;
      if (vn < 0) {
        const e = -vn > 1 ? BOUNCE : 0; // no micro-bounces while resting on a wall
        ball.vx -= (1 + e) * vn * dx;
        ball.vy -= (1 + e) * vn * dy;
        // a little scrub along the wall
        ball.vx *= 0.995;
        ball.vy *= 0.995;
        frameImpact = Math.max(frameImpact, -vn);
      }
    }
  }
}

// Returns false when the ball dropped or finished, ending this frame's steps.
function physicsStep(dt) {
  const gravity = SPEEDS[save.speed] || SPEEDS.normal;
  ball.vx += input.tilt.x * gravity * dt;
  ball.vy += input.tilt.y * gravity * dt;

  const targets = level.holes.concat([level.goal]);
  for (const h of targets) {
    const dx = h.x - ball.x;
    const dy = h.y - ball.y;
    const d = Math.hypot(dx, dy);
    if (d < FALL_AT) {
      if (h === level.goal) finish();
      else drop(h);
      return false;
    }
    if (d < LIP && d > 1e-4) {
      const pull = 30 * (1 - d / LIP);
      ball.vx += (dx / d) * pull * dt;
      ball.vy += (dy / d) * pull * dt;
    }
  }

  const damp = Math.exp(-DAMPING * dt);
  ball.vx *= damp;
  ball.vy *= damp;
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > MAX_SPEED) {
    ball.vx *= MAX_SPEED / sp;
    ball.vy *= MAX_SPEED / sp;
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  collideWalls();

  for (const c of level.checkpoints) {
    if (!c.hit && Math.hypot(c.x - ball.x, c.y - ball.y) < 0.45) {
      c.hit = true;
      respawn = c;
      sound.flag();
      toast('Flag reached. Falls now restart here.');
    }
  }
  return true;
}

function drop(h) {
  animFrom = { x: ball.x, y: ball.y };
  animTo = h;
  setPhase('falling');
  sound.drop();
}

function finish() {
  animFrom = { x: ball.x, y: ball.y };
  animTo = level.goal;
  setPhase('won');
  sound.win();
}

// ---------- Main loop ----------
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateTilt(dt);
  frameImpact = 0;

  if (phase === 'play') {
    runTime += dt;
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      if (!physicsStep(STEP)) {
        acc = 0;
        break;
      }
    }
    sound.knock(frameImpact);
    sound.setRoll(phase === 'play' ? Math.hypot(ball.vx, ball.vy) : 0);
  } else {
    sound.setRoll(0);
    acc = 0;
  }

  if (phase === 'countdown') {
    const before = phaseT;
    phaseT += dt;
    if (before < 0.8 && phaseT >= 0.8) sound.blip();
    if (phaseT >= COUNTDOWN) {
      if (motionLive()) input.neutral = { ...input.raw };
      setPhase('play');
      sound.blip(true);
      if (motionGranted && !motionLive() && matchMedia('(pointer: coarse)').matches && !warnedNoTilt) {
        warnedNoTilt = true;
        toast('No tilt readings yet. Drag on the board to play, or reload the page and allow motion access.', 5000);
      }
    }
  } else if (phase === 'falling') {
    runTime += dt;
    phaseT += dt;
    const t = Math.min(1, phaseT / 0.45);
    const e = t * t;
    ball.x = animFrom.x + (animTo.x - animFrom.x) * Math.min(1, t * 2);
    ball.y = animFrom.y + (animTo.y - animFrom.y) * Math.min(1, t * 2);
    ball.scale = 1 - 0.7 * e;
    if (t >= 1) {
      falls++;
      updateHud();
      placeBall(respawn);
      ball.scale = 0;
      setPhase('spawning');
    }
  } else if (phase === 'spawning') {
    runTime += dt;
    phaseT += dt;
    const t = Math.min(1, phaseT / 0.35);
    ball.scale = 1 - (1 - t) * (1 - t);
    if (t >= 1) {
      ball.scale = 1;
      setPhase('play');
    }
  } else if (phase === 'won') {
    phaseT += dt;
    const t = Math.min(1, phaseT / 0.5);
    ball.x = animFrom.x + (animTo.x - animFrom.x) * Math.min(1, t * 1.6);
    ball.y = animFrom.y + (animTo.y - animFrom.y) * Math.min(1, t * 1.6);
    ball.scale = 1 - 0.4 * t;
    if (phaseT >= 0.7 && $('complete').hidden) showComplete();
  }

  draw(now);
  updateTimer();
  requestAnimationFrame(frame);
}

// ---------- Rendering ----------
let cellPx = 30;
let dpr = 1;

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  cellPx = Math.max(10, Math.floor(Math.min(w / COLS, h / ROWS)));
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const cw = cellPx * COLS;
  const ch = cellPx * ROWS;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.width = boardLayer.width = Math.round(cw * dpr);
  canvas.height = boardLayer.height = Math.round(ch * dpr);
  if (level) renderBoard();
}

function seededRandom(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function renderBoard() {
  const c = bctx;
  const S = cellPx * dpr;
  c.setTransform(S, 0, 0, S, 0, 0);
  c.clearRect(0, 0, COLS, ROWS);

  // Painted plywood floor with faint grain.
  c.fillStyle = COLORS.floor;
  c.fillRect(0, 0, COLS, ROWS);
  const rnd = seededRandom(levelIndex + 3);
  c.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const y = rnd() * ROWS;
    c.strokeStyle = rnd() < 0.5 ? 'rgba(60, 90, 55, 0.07)' : 'rgba(255, 255, 240, 0.07)';
    c.lineWidth = 0.02 + rnd() * 0.06;
    c.beginPath();
    c.moveTo(0, y);
    const amp = 0.05 + rnd() * 0.15;
    for (let x = 0; x <= COLS; x += 0.5) c.lineTo(x, y + Math.sin(x * 0.7 + i) * amp);
    c.stroke();
  }
  const vig = c.createRadialGradient(COLS / 2, ROWS / 2, 2, COLS / 2, ROWS / 2, ROWS * 0.7);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(20, 40, 25, 0.28)');
  c.fillStyle = vig;
  c.fillRect(0, 0, COLS, ROWS);

  // Start marker.
  c.strokeStyle = 'rgba(40, 62, 46, 0.45)';
  c.lineWidth = 0.05;
  c.setLineDash([0.1, 0.08]);
  c.beginPath();
  c.arc(level.start.x, level.start.y, BALL_R + 0.06, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);

  // Pits.
  for (const h of level.holes) {
    c.fillStyle = 'rgba(255, 255, 240, 0.18)';
    c.beginPath();
    c.arc(h.x + 0.02, h.y + 0.03, HOLE_R + 0.05, 0, Math.PI * 2);
    c.fill();
    const g = c.createRadialGradient(h.x + 0.08, h.y + 0.1, 0.02, h.x, h.y, HOLE_R);
    g.addColorStop(0, COLORS.pit);
    g.addColorStop(0.7, '#0d1610');
    g.addColorStop(1, COLORS.pitEdge);
    c.fillStyle = g;
    c.beginPath();
    c.arc(h.x, h.y, HOLE_R, 0, Math.PI * 2);
    c.fill();
  }

  // Goal cup.
  const gl = level.goal;
  c.fillStyle = COLORS.gold;
  c.beginPath();
  c.arc(gl.x, gl.y, HOLE_R + 0.09, 0, Math.PI * 2);
  c.fill();
  const gg = c.createRadialGradient(gl.x + 0.08, gl.y + 0.1, 0.02, gl.x, gl.y, HOLE_R - 0.02);
  gg.addColorStop(0, '#120c02');
  gg.addColorStop(0.75, '#3a2a08');
  gg.addColorStop(1, COLORS.goldDeep);
  c.fillStyle = gg;
  c.beginPath();
  c.arc(gl.x, gl.y, HOLE_R - 0.02, 0, Math.PI * 2);
  c.fill();

  // Pit numbers, drawn in device pixels so they stay crisp.
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = COLORS.label;
  c.font = `500 ${Math.round(0.28 * S)}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const h of level.holes) c.fillText(String(h.n), (h.x + 0.38) * S, (h.y + 0.38) * S);
  c.restore();

  // Walls: soft shadow first, then the raised top with bevelled edges.
  const walls = new Path2D();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (isWall(x, y)) walls.rect(x, y, 1, 1);
  c.save();
  c.shadowColor = 'rgba(8, 18, 12, 0.55)';
  c.shadowBlur = 0.22 * S;
  c.shadowOffsetX = 0.06 * S;
  c.shadowOffsetY = 0.12 * S;
  c.fillStyle = COLORS.wall;
  c.fill(walls);
  c.restore();
  const wg = c.createLinearGradient(0, 0, COLS, ROWS);
  wg.addColorStop(0, COLORS.wallTop);
  wg.addColorStop(1, COLORS.wall);
  c.fillStyle = wg;
  c.fill(walls);
  c.lineWidth = 0.07;
  c.lineCap = 'butt';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!isWall(x, y)) continue;
      const o = 0.035;
      c.strokeStyle = COLORS.wallLight;
      if (!isWall(x, y - 1)) line(c, x, y + o, x + 1, y + o);
      if (!isWall(x - 1, y)) line(c, x + o, y, x + o, y + 1);
      c.strokeStyle = COLORS.wallDark;
      if (!isWall(x, y + 1)) line(c, x, y + 1 - o, x + 1, y + 1 - o);
      if (!isWall(x + 1, y)) line(c, x + 1 - o, y, x + 1 - o, y + 1);
    }
  }
}

function line(c, x1, y1, x2, y2) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function draw(now) {
  const S = cellPx * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!level) return;
  ctx.drawImage(boardLayer, 0, 0);
  ctx.setTransform(S, 0, 0, S, 0, 0);

  // Goal glow.
  const pulse = 0.5 + 0.5 * Math.sin(now / 350);
  ctx.strokeStyle = `rgba(255, 220, 130, ${0.25 + pulse * 0.35})`;
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.arc(level.goal.x, level.goal.y, HOLE_R + 0.18 + pulse * 0.06, 0, Math.PI * 2);
  ctx.stroke();

  // Checkpoint flags.
  for (const cp of level.checkpoints) drawFlag(cp);

  // Marble.
  if (ball.scale > 0.01) {
    const r = BALL_R * ball.scale;
    const sinking = phase === 'falling' || phase === 'won';
    if (!sinking) {
      ctx.fillStyle = 'rgba(10, 25, 15, 0.35)';
      ctx.beginPath();
      ctx.ellipse(ball.x + 0.07, ball.y + 0.1, r * 1.02, r * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(ball.x - r * 0.35, ball.y - r * 0.4, r * 0.05, ball.x, ball.y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, '#dfe4ea');
    g.addColorStop(0.55, '#8d96a1');
    g.addColorStop(0.85, '#454c55');
    g.addColorStop(1, '#2a2f36');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
    ctx.fill();
    // floor colour reflected along the bottom edge
    ctx.strokeStyle = 'rgba(160, 190, 140, 0.35)';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, r * 0.88, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    if (sinking) {
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.75, phaseT * 1.6)})`;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (phase === 'countdown') {
    const label = phaseT < 0.8 ? 'Hold steady' : 'Ready';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(12, 24, 17, 0.55)';
    const bw = 5.6 * S;
    const bh = 1.3 * S;
    const bx = (COLS * S - bw) / 2;
    const by = (ROWS * S - bh) / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 0.3 * S);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#e9f0e4';
    ctx.font = `800 ${Math.round(0.6 * S)}px ${getComputedStyle(document.documentElement).getPropertyValue('--display')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, (COLS * S) / 2, (ROWS * S) / 2);
  }
}

function drawFlag(cp) {
  const x = cp.x;
  const y = cp.y;
  ctx.fillStyle = cp.hit ? 'rgba(228, 181, 76, 0.35)' : 'rgba(255, 255, 240, 0.25)';
  ctx.beginPath();
  ctx.arc(x, y, 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a3b2f';
  ctx.lineWidth = 0.06;
  line(ctx, x - 0.12, y + 0.28, x - 0.12, y - 0.3);
  ctx.fillStyle = cp.hit ? COLORS.gold : '#f2f5ee';
  ctx.beginPath();
  ctx.moveTo(x - 0.12, y - 0.3);
  ctx.lineTo(x + 0.26, y - 0.18);
  ctx.lineTo(x - 0.12, y - 0.04);
  ctx.closePath();
  ctx.fill();
}

// ---------- HUD & overlays ----------
function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

let shownTime = '';
function updateTimer() {
  const s = fmt(runTime);
  if (s !== shownTime) {
    shownTime = s;
    $('hud-timer').textContent = s;
  }
}

function updateHud() {
  if (!level) return;
  $('hud-num').textContent = `Board ${levelIndex + 1} of ${LEVELS.length}`;
  $('hud-name').textContent = level.name;
  const best = save.best[levelIndex];
  $('hud-sub').textContent = `Best ${best != null ? fmt(best) : '–'} · Falls ${falls}`;
}

function buildLevelList() {
  const list = $('level-list');
  list.textContent = '';
  LEVELS.forEach((L, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const locked = i >= save.unlocked;
    b.disabled = locked;
    if (level && i === levelIndex) b.classList.add('current');
    const name = document.createElement('span');
    name.className = 'lv-name';
    name.textContent = `${i + 1}. ${L.name}`;
    const best = document.createElement('span');
    best.className = 'lv-best';
    best.textContent = locked ? 'Locked' : save.best[i] != null ? `Best ${fmt(save.best[i])}` : 'Not cleared';
    b.append(name, best);
    b.addEventListener('click', () => beginSession().then(() => startLevel(i)));
    li.append(b);
    list.append(li);
  });
}

function openMenu() {
  const midRun = level && phase === 'paused';
  $('btn-play').textContent = midRun ? 'Resume' : 'Play';
  $('btn-restart').hidden = !midRun;
  $('menu-eyebrow').textContent = midRun ? 'Paused' : `Tilt maze · ${LEVELS.length} boards`;
  buildLevelList();
  $('menu').hidden = false;
}

function togglePause() {
  if (['countdown', 'play', 'falling', 'spawning'].includes(phase)) {
    pausedFrom = phase;
    setPhase('paused');
    openMenu();
  } else if (phase === 'paused') {
    resume();
  }
}

function resume() {
  $('menu').hidden = true;
  phase = pausedFrom || 'play';
  pausedFrom = null;
}

function showComplete() {
  const t = runTime;
  const prev = save.best[levelIndex];
  const isBest = prev == null || t < prev;
  if (isBest) save.best[levelIndex] = t;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIndex + 2));
  persist();
  updateHud();

  const last = levelIndex === LEVELS.length - 1;
  $('done-eyebrow').textContent = last ? 'All boards cleared' : `Board ${levelIndex + 1} cleared`;
  $('done-time').textContent = fmt(t);
  const fallText = falls === 0 ? 'no falls' : falls === 1 ? '1 fall' : `${falls} falls`;
  let detail = isBest ? (prev == null ? `First clear, ${fallText}.` : `New best, ${fallText}. Old best was ${fmt(prev)}.`) : `${fallText}. Best is ${fmt(prev)}.`;
  if (last) {
    const total = LEVELS.reduce((sum, _, i) => sum + (save.best[i] ?? 0), 0);
    detail += ` Your best times add up to ${fmt(total)}.`;
  }
  $('done-detail').textContent = detail;
  $('btn-next').hidden = last;
  $('complete').hidden = false;
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// ---------- Session setup ----------
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {}
}

// Everything that needs a tap: motion permission, audio, wake lock.
// The motion prompt must be the first thing the tap does on iOS.
function beginSession() {
  const asked = requestMotion();
  sound.init();
  keepAwake();
  return asked;
}

$('btn-play').addEventListener('click', () => {
  const asked = beginSession();
  if (phase === 'paused') {
    resume();
    return;
  }
  const next = Math.min(save.unlocked - 1, LEVELS.length - 1);
  asked.then(() => startLevel(next));
});
$('btn-restart').addEventListener('click', () => startLevel(levelIndex));
$('btn-next').addEventListener('click', () => startLevel(levelIndex + 1));
$('btn-replay').addEventListener('click', () => startLevel(levelIndex));
$('btn-done-menu').addEventListener('click', () => {
  $('complete').hidden = true;
  setPhase('title');
  openMenu();
});
$('btn-menu').addEventListener('click', () => {
  if (phase === 'title' || phase === 'won') return;
  togglePause();
});
$('btn-recenter').addEventListener('click', recenter);

function applySpeed() {
  document.querySelectorAll('#speed-picker button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.speed === save.speed));
  });
}
document.querySelectorAll('#speed-picker button').forEach((b) => {
  b.addEventListener('click', () => {
    save.speed = b.dataset.speed;
    persist();
    applySpeed();
  });
});
applySpeed();

function applySound() {
  sound.setMuted(save.muted);
  const b = $('btn-sound');
  b.textContent = save.muted ? 'Sound off' : 'Sound on';
  b.setAttribute('aria-pressed', String(!save.muted));
}
$('btn-sound').addEventListener('click', () => {
  save.muted = !save.muted;
  persist();
  sound.init();
  applySound();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (['countdown', 'play', 'falling', 'spawning'].includes(phase)) togglePause();
  } else {
    keepAwake();
  }
});

function relayout() {
  applyPortraitLock();
  resize();
}
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => setTimeout(relayout, 50));
screen.orientation?.addEventListener?.('change', relayout);
applyPortraitLock();

// Show board 1 behind the title card so the first screen isn't empty.
level = parseLevel(Math.min(save.unlocked - 1, LEVELS.length - 1));
levelIndex = Math.min(save.unlocked - 1, LEVELS.length - 1);
placeBall(level.start);
applySound();
resize();
updateHud();
openMenu();
document.fonts?.ready.then(() => level && renderBoard());
requestAnimationFrame(frame);
