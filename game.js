// EL REBUSQUE — Platanus Hack 26: Bogota Arcade Challenge
//
// You are a traffic-light juggler on a Bogota avenue. The red light lasts a
// fixed time. Inside that window you must keep the show alive AND collect the
// tips before the light turns green and the avenue runs you over.
//
// The whole game is one tension: catches happen on the beat, and collecting a
// tip costs you a beat. You have to learn to collect on the OFF-beat.

const W = 800;
const H = 600;

const STORAGE_KEY = 'el-rebusque-highscores-v1';
const MAX_SCORES = 6;
const NAME_LEN = 3;

// --- Vertical layout of the street ---------------------------------------
const SKY_BOTTOM = 196;      // sky / cerros orientales
const BLOCK_TOP = 188;       // background buildings
const FAR_WALK = 296;        // far sidewalk line
const ROAD_TOP = 302;
const ROAD_BOTTOM = 524;
const CAR_BASE = 436;        // cars rest their wheels here
const FEET_Y = 502;          // juggler's feet
const HAND_Y = 446;          // where balls are caught
const ARC_TOP = 312;         // apex of the juggling cascade
const BEAT_Y = 566;          // rhythm bar

// Safe zones: the corners. Everything between is the avenue.
const CURB_L = 74;
const CURB_R = W - 74;

const COL = {
  skyTop: 0x1b1740,
  skyMid: 0x59306b,
  skyLow: 0xc4613f,
  cerros: 0x140f2c,
  blockFar: 0x1d1838,
  blockNear: 0x2a2145,
  window: 0xffd98a,
  road: 0x25242b,
  roadDark: 0x1c1b21,
  lane: 0xd8cf55,
  walk: 0x4a4652,
  walkTop: 0x5d5866,
  curb: 0x6e6878,
  skin: 0x8c5a3c,
  shirt: 0xe8483f,
  pants: 0x2f3a63,
  hat: 0x1d2340,
  // The three balls are the Colombian flag.
  ballA: 0xffd400,
  ballB: 0x0033a0,
  ballC: 0xce1126,
  cash: 0x7de07d,
  show: 0xffd400,
  warn: 0xff7a3d,
  danger: 0xff3b30,
  ink: 0x0d0b16,
  paper: 0xf6f0e2,
  dim: 0x8e88a0,
  accent: 0xe1ff00,
};

// One palette per player. P1 juggles the flag, P2 gets neon so two cascades
// never read as one.
const P_BALLS = [
  [COL.ballA, COL.ballB, COL.ballC, 0xf6f0e2, 0xff8ad4, 0x5ce1e6, 0x9dff5c],
  [0xff8ad4, 0x5ce1e6, 0x9dff5c, 0xffd400, 0xf6f0e2, 0xff5c3d, 0xb18cff],
];

// --- Arcade cabinet wiring ------------------------------------------------
// DO NOT replace existing keys — they match the physical arcade cabinet.
// Extra keys are appended only as local testing shortcuts.
const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u', ' '],
  P1_2: ['i', 'Shift'],
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'],
  P2_2: ['t'],
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

// Single-player game, but P2's inputs are accepted as aliases so the arrow
// keys work for local testing without touching the cabinet mapping above.
const KEY_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) KEY_TO_ARCADE[normKey(key)] = code;
}

function normKey(key) {
  return key.length === 1 ? key.toLowerCase() : key;
}

const held = Object.create(null);
const pressQueue = [];

window.addEventListener('keydown', (e) => {
  const code = KEY_TO_ARCADE[normKey(e.key)];
  if (!code) return;
  if (!held[code]) pressQueue.push({ code, at: performance.now() });
  held[code] = true;
  if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  const code = KEY_TO_ARCADE[normKey(e.key)];
  if (code) held[code] = false;
});

// Pull every press that happened since the last frame, timestamped. Timestamps
// matter: a rhythm game judged on frame boundaries feels mushy at 60fps.
function takePresses() {
  const out = pressQueue.slice();
  pressQueue.length = 0;
  return out;
}

function pressedOnce(presses, ...codes) {
  return presses.some((p) => codes.includes(p.code));
}

// --- Storage --------------------------------------------------------------
function getStorage() {
  if (window.platanusArcadeStorage) return window.platanusArcadeStorage;
  return {
    async get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? { found: false, value: null } : { found: true, value: JSON.parse(raw) };
      } catch (_) {
        return { found: false, value: null };
      }
    },
    async set(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    },
  };
}

function isScoreEntry(v) {
  return v && typeof v === 'object' &&
    typeof v.name === 'string' && typeof v.score === 'number' && typeof v.round === 'number';
}

async function loadScores() {
  try {
    const res = await getStorage().get(STORAGE_KEY);
    if (!res || !res.found || !Array.isArray(res.value)) return [];
    return res.value.filter(isScoreEntry).sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
  } catch (_) {
    return [];
  }
}

async function saveScore(entry) {
  const all = (await loadScores()).concat(entry)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SCORES);
  try { await getStorage().set(STORAGE_KEY, all); } catch (_) {}
  return all;
}

// --- Audio ----------------------------------------------------------------
// Everything is synthesised: no samples, no files. A small cumbia-flavoured
// bed plus one-shot blips keyed to what the player just did.
const AUDIO = { ctx: null, master: null, nextNote: 0, step: 0, on: true };

function initAudio(scene) {
  try {
    AUDIO.ctx = scene.sound && scene.sound.context ? scene.sound.context : new AudioContext();
    AUDIO.master = AUDIO.ctx.createGain();
    AUDIO.master.gain.value = 0.55;
    AUDIO.master.connect(AUDIO.ctx.destination);
  } catch (_) {
    AUDIO.on = false;
  }
}

function blip(type, freq, dur, vol, wave) {
  if (!AUDIO.on || !AUDIO.ctx) return;
  try {
    const ctx = AUDIO.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave || 'square';
    osc.connect(gain);
    gain.connect(AUDIO.master);
    if (type === 'down') {
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.35), now + dur);
    } else if (type === 'up') {
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 2.4, now + dur);
    } else {
      osc.frequency.setValueAtTime(freq, now);
    }
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch (_) {}
}

function noise(dur, vol, freq) {
  if (!AUDIO.on || !AUDIO.ctx) return;
  try {
    const ctx = AUDIO.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq || 1400;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filt); filt.connect(gain); gain.connect(AUDIO.master);
    src.start();
  } catch (_) {}
}

const SFX = {
  perfect: () => { blip('up', 880, 0.09, 0.16, 'square'); blip('up', 1320, 0.07, 0.08, 'triangle'); },
  good: () => blip('flat', 660, 0.06, 0.11, 'square'),
  miss: () => blip('down', 220, 0.18, 0.15, 'sawtooth'),
  drop: () => { blip('down', 180, 0.4, 0.22, 'sawtooth'); noise(0.25, 0.12, 500); },
  coin: (n) => blip('up', 900 + Math.min(8, n) * 90, 0.1, 0.18, 'square'),
  bigcoin: () => { blip('up', 700, 0.16, 0.2, 'square'); setTimeout(() => blip('up', 1100, 0.16, 0.16, 'square'), 70); },
  horn: () => { blip('flat', 300, 0.28, 0.16, 'sawtooth'); blip('flat', 402, 0.28, 0.12, 'sawtooth'); },
  hit: () => { noise(0.5, 0.3, 300); blip('down', 320, 0.5, 0.25, 'sawtooth'); },
  step: () => noise(0.04, 0.03, 2600),
  select: () => blip('up', 620, 0.07, 0.12, 'square'),
  move: () => blip('flat', 440, 0.04, 0.07, 'square'),
  start: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip('flat', f, 0.12, 0.16, 'square'), i * 80)); },
  cash: () => { [660, 880, 1100].forEach((f, i) => setTimeout(() => blip('flat', f, 0.1, 0.14, 'triangle'), i * 60)); },
  trick: () => { blip('up', 420, 0.26, 0.15, 'triangle'); noise(0.1, 0.05, 3200); },
  shut: () => { blip('down', 380, 0.12, 0.09, 'triangle'); noise(0.07, 0.05, 900); },
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => blip('flat', f, 0.16, 0.17, 'square'), i * 110)); },
};

// A 16-step bass+percussion bed. Tempo follows the round so the music and the
// juggling beat stay locked together.
const BASS_LINE = [0, 0, 7, 0, 5, 0, 7, 3, 0, 0, 7, 0, 10, 7, 5, 3];

function pumpMusic(time, bpmInterval) {
  if (!AUDIO.on || !AUDIO.ctx) return;
  const stepMs = bpmInterval / 2;
  if (time < AUDIO.nextNote) return;
  AUDIO.nextNote = time + stepMs;
  const s = AUDIO.step++ % 16;
  const root = 55;
  if (s % 2 === 0) {
    blip('flat', root * Math.pow(2, BASS_LINE[s] / 12), 0.16, 0.1, 'triangle');
  }
  if (s % 4 === 0) noise(0.05, 0.05, 220);       // bombo
  if (s % 4 === 2) noise(0.04, 0.035, 3200);     // guacharaca
  if (s % 8 === 6) noise(0.08, 0.03, 5200);
}

// --- World ----------------------------------------------------------------
// The avenue is wider than the screen. The camera follows the juggler, so
// running back to a corner before the light turns is a real sprint and the
// "one more car" decision has teeth.
const WORLD_W = 1560;
const SAFE_L = 96;              // left corner sidewalk ends here
const SAFE_R = WORLD_W - 96;

// Versus is played on a single screen. Two jugglers who both have to reach a
// corner cannot share a scrolling avenue: whoever runs the other way drags the
// first one out of reach of safety. So the versus street is exactly one screen
// wide, both corners on it, no camera scroll and nothing tying them together.
const VS_W = W;
const VS_SAFE_L = 84;
const VS_SAFE_R = W - 84;

// Live arena bounds, swapped by setArena() at the top of every round.
let WW = WORLD_W;
let SL = SAFE_L;
let SR = SAFE_R;

function setArena() {
  WW = S.vs ? VS_W : WORLD_W;
  SL = S.vs ? VS_SAFE_L : SAFE_L;
  SR = S.vs ? VS_SAFE_R : SAFE_R;
}

const RED_MS = 45000;           // the fixed red. This is the whole premise.
const YELLOW_MS = 4000;
const GREEN_MS = 2600;

const CAR_TYPES = [
  { id: 'taxi', w: 120, h: 50, body: 0xe8b81c, roof: 0xf5d45a, tip: 700, need: 12, says: 'TAXI' },
  { id: 'carro', w: 128, h: 52, body: 0x9c2f34, roof: 0xc25055, tip: 1400, need: 34, says: '' },
  { id: 'campero', w: 140, h: 62, body: 0x2f5f4a, roof: 0x47836a, tip: 2400, need: 52, says: '' },
  { id: 'buseta', w: 196, h: 82, body: 0x2b6ca8, roof: 0x4a92cf, tip: 3600, need: 66, says: 'SITP' },
  { id: 'camioneta', w: 152, h: 68, body: 0x1a1c24, roof: 0x33363f, tip: 7000, need: 88, says: '' },
];

// One named thing goes wrong per light, so no two semaforos feel the same.
// Each event only nudges the spec — the red is still 45 seconds.
const EVENTS = {
  trancon: { name: 'TRANCON', desc: 'la via llena. mas plata, menos espacio.' },
  lluvia: { name: 'LLOVIZNA', desc: 'piso mojado. cuesta mas frenar.' },
  aguacero: { name: 'AGUACERO', desc: 'no se ve nada y todos pitan.' },
  motorizados: { name: 'MOTORIZADOS', desc: 'los domiciliarios no frenan por nadie.' },
};

const EV_ORDER = [null, null, null, 'trancon', null, 'lluvia', 'trancon', 'motorizados', 'aguacero'];
const EV_CYCLE = ['trancon', 'lluvia', 'motorizados', 'aguacero'];

// Difficulty curve. The red light never changes length — the street around it
// does. More balls, faster cascade, richer but pickier cars, then motorbikes.
function roundSpec(r) {
  const spec = {
    balls: Math.min(7, 3 + Math.floor((r - 1) / 2)),
    beatMs: Math.max(230, 540 - (r - 1) * 26),
    motos: r < 3 ? 0 : Math.min(4, 1 + Math.floor((r - 3) / 2)),
    rain: r >= 5,
    tipMul: 1 + (r - 1) * 0.18,
    carCount: Math.min(11, 7 + Math.floor(r / 2)),
    // Late rounds bias toward cars that only open for a very good show.
    rich: Math.min(0.75, 0.15 + (r - 1) * 0.1),
    grip: 1,
    event: r < EV_ORDER.length ? EV_ORDER[r] : EV_CYCLE[r % EV_CYCLE.length],
  };
  if (spec.event === 'trancon') { spec.carCount += 3; spec.tipMul += 0.12; }
  if (spec.event === 'lluvia') { spec.rain = true; spec.grip = 0.82; }
  if (spec.event === 'aguacero') { spec.rain = true; spec.grip = 0.7; spec.motos += 1; }
  if (spec.event === 'motorizados') spec.motos += 2;
  spec.carCount = Math.min(14, spec.carCount);
  spec.motos = Math.min(6, spec.motos);
  return spec;
}

function buildCars(spec, rng) {
  const cars = [];
  const n = carCount(spec);
  const span = SR - SL - 120;
  const slot = span / n;
  for (let i = 0; i < n; i++) {
    const wantRich = rng() < spec.rich;
    const pool = wantRich ? richPool() : CAR_TYPES.slice(0, 3);
    const type = pool[Math.floor(rng() * pool.length)];
    const x = SL + 60 + slot * i + slot * 0.5;
    cars.push({
      type,
      x,
      tip: Math.round(type.tip * spec.tipMul),
      openAmt: 0,       // animated 0..1
      given: false,
      // A window that has been down a while goes back up for good: the driver
      // got bored. Richer cars are the least patient of all.
      gone: false,
      patMax: 7 - type.need / 28,
      pat: 7 - type.need / 28,
      bob: rng() * 6.28,
      plate: 1 + Math.floor(rng() * 899),
      reT: 0,
      slide: 0,
    });
  }
  return cars;
}

// Four cars is all that fits on the versus street without them overlapping, so
// they get restocked instead — a used-up window is replaced by a fresh car.
function carCount(spec) {
  return S.vs ? 4 : spec.carCount;
}

// The buseta is 196px wide and simply does not fit the short street.
function richPool() {
  return S.vs ? CAR_TYPES.slice(2, 4) : CAR_TYPES.slice(2);
}

const CAR_RESTOCK = 2.6;

function restockCar(c) {
  const pool = Math.random() < S.spec.rich ? richPool() : CAR_TYPES.slice(0, 3);
  const t = pool[Math.floor(Math.random() * pool.length)];
  c.type = t;
  c.tip = Math.round(t.tip * S.spec.tipMul);
  c.given = false;
  c.gone = false;
  c.by = undefined;
  c.openAmt = 0;
  c.patMax = 7 - t.need / 28;
  c.pat = c.patMax;
  c.plate = 1 + Math.floor(Math.random() * 899);
  c.reT = 0;
  c.slide = 1;          // rolls in from the right
}

// Small deterministic RNG so a round can be rebuilt identically if needed.
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// --- Players --------------------------------------------------------------
// Everything a juggler owns lives on a player object. Solo runs one, versus
// runs two, and the attract-mode demo runs one steered by aiStep instead of a
// joystick. Nothing downstream needs to know which kind it is looking at.
const P_SKIN = [
  { shirt: 0xe8483f, hat: 0x1d2340, mark: COL.accent, tag: 'P1' },
  { shirt: 0x2f8fd8, hat: 0x14243a, mark: 0xff8ad4, tag: 'P2' },
];

// Which arcade codes a player answers to. A solo player also answers to P2's
// stick so the arrow keys keep working for local testing.
const CTL_SOLO = { L: ['P1_L', 'P2_L'], R: ['P1_R', 'P2_R'], B1: ['P1_1', 'P2_1'], B2: ['P1_2', 'P2_2'], B3: ['P1_3', 'P2_3'] };
const CTL_P1 = { L: ['P1_L'], R: ['P1_R'], B1: ['P1_1'], B2: ['P1_2'], B3: ['P1_3'] };
const CTL_P2 = { L: ['P2_L'], R: ['P2_R'], B1: ['P2_1'], B2: ['P2_2'], B3: ['P2_3'] };

function mkPlayer(i, ctl) {
  return {
    i,
    ctl,
    skin: P_SKIN[i],
    balls: P_BALLS[i],
    ai: false,
    aiDir: 0,
    aiTarget: null,
    px: WORLD_W / 2,
    pvx: 0,
    face: 1,
    walkT: 0,
    collectT: 0,
    collectDir: 1,
    stunT: 0,
    armT: 0,
    dropT: 0,
    show: 0,
    combo: 0,
    bestCombo: 0,
    missStreak: 0,
    wobble: 0,
    judge: '',
    judgeT: 0,
    beatDone: false,
    nBalls: 3,
    cash: 0,
    roundCash: 0,
    totalPerfect: 0,
    // Floreo: the balls go up for a few beats and the hands come free.
    trickEnd: -1,        // beat the throw lands on; -1 when not tricking
    trickHot: false,     // the landing beat is live and pays double
    trickOk: 0,
    upg: { shoes: 0, hat: 0, guante: 0 },
  };
}

function heldCtl(p, side) {
  const codes = p.ctl[side];
  for (let i = 0; i < codes.length; i++) if (held[codes[i]]) return true;
  return false;
}

function pressedCtl(p, presses, side) {
  return presses.filter((q) => p.ctl[side].indexOf(q.code) >= 0);
}

// --- Game state -----------------------------------------------------------
const S = {
  mode: 'boot',          // boot|menu|howto|scores|play|pause|tally|shop|over|name|result
  scores: [],
  scoresLoaded: false,
  vs: false,             // two-player versus
  demo: false,           // the menu runs a real round with an AI juggler
  idleT: 0,              // seconds since the cabinet last saw a button

  round: 1,
  lives: 3,
  spec: roundSpec(1),
  event: null,
  eventT: 0,

  light: 'red',
  lightT: RED_MS,

  beatMs: 540,
  nextBeat: 0,
  beatNum: 0,
  cascadeT: 0,

  players: [],
  cars: [],
  motos: [],
  parts: [],
  floats: [],

  camX: 0,
  flash: 0,
  flashCol: 0xffffff,
  shake: 0,
  rainDrops: [],

  menuIdx: 0,
  nameIdx: 0,
  nameChars: [0, 0, 0],
  shopIdx: 0,
  shopOffer: [],
  pauseIdx: 0,
  tallyT: 0,
  overT: 0,
};

// Versus is short on purpose: three lights, most cash wins, no lives to grind.
const VS_ROUNDS = 3;

function P1P() { return S.players[0]; }

function midX() {
  let s = 0;
  for (const p of S.players) s += p.px;
  return s / Math.max(1, S.players.length);
}

function maxShow() {
  let m = 0;
  for (const p of S.players) if (p.show > m) m = p.show;
  return m;
}

const NAME_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-';

// --- Phaser bootstrap -----------------------------------------------------
const config = {
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'game-root',
  backgroundColor: '#0d0b16',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  scene: { create, update },
};

new Phaser.Game(config);

let g = {};   // graphics layers, keyed by name

function create() {
  initAudio(this);

  // Parallax layers. Background layers scroll slower than the road.
  g.sky = this.add.graphics().setScrollFactor(0).setDepth(0);
  g.cerros = this.add.graphics().setScrollFactor(0.12).setDepth(1);
  g.blocks = this.add.graphics().setScrollFactor(0.42).setDepth(2);
  g.world = this.add.graphics().setScrollFactor(1).setDepth(3);
  g.front = this.add.graphics().setScrollFactor(1).setDepth(6);
  g.hud = this.add.graphics().setScrollFactor(0).setDepth(10);

  S.rainDrops = [];
  for (let i = 0; i < 90; i++) {
    S.rainDrops.push({ x: Math.random() * (W + 200), y: Math.random() * H, v: 380 + Math.random() * 260, l: 8 + Math.random() * 12 });
  }

  loadScores().then((list) => { S.scores = list; S.scoresLoaded = true; });

  startDemo();
}

// Attract mode. A cabinet showing a still title screen sells nothing, so the
// menu sits on top of a real round being played by an AI juggler.
function startDemo() {
  S.vs = false;
  S.demo = true;
  S.lives = 3;
  S.players = [mkPlayer(0, CTL_SOLO)];
  S.players[0].ai = true;
  startRound(1);
  S.mode = 'menu';
  S.menuIdx = 0;
  S.idleT = 0;
}

function resetRun(vs) {
  S.vs = !!vs;
  S.demo = false;
  S.round = 1;
  S.lives = 3;
  S.players = vs
    ? [mkPlayer(0, CTL_P1), mkPlayer(1, CTL_P2)]
    : [mkPlayer(0, CTL_SOLO)];
  startRound(1);
}

function startRound(r) {
  const spec = roundSpec(r);
  S.round = r;
  S.spec = spec;
  S.event = spec.event;
  S.eventT = spec.event ? 3.2 : 0;
  S.light = 'red';
  S.lightT = RED_MS;
  S.beatMs = spec.beatMs;
  S.nextBeat = 0;             // set on first update tick
  S.beatNum = 0;
  S.cascadeT = 0;
  setArena();
  S.cars = buildCars(spec, makeRng(0x9e37 + r * 2654435761));
  S.motos = [];
  const rng = makeRng(0x51ed + r * 40503);
  for (let i = 0; i < spec.motos; i++) {
    S.motos.push({
      x: SL + rng() * (SR - SL),
      dir: rng() < 0.5 ? -1 : 1,
      speed: 130 + rng() * 90 + r * 6,
      hornT: 1200 + rng() * 2600,
      color: [0xff5c3d, 0x4ad2ff, 0xe8e845][Math.floor(rng() * 3)],
    });
  }
  S.parts = [];
  S.floats = [];

  const n = S.players.length;
  for (let i = 0; i < n; i++) {
    const p = S.players[i];
    p.show = 0;
    p.combo = 0;
    p.missStreak = 0;
    p.nBalls = spec.balls;
    p.wobble = 0;
    p.dropT = 0;
    p.roundCash = 0;
    // Two jugglers start apart so the first scramble is not a collision.
    p.px = WW / 2 + (n > 1 ? (i === 0 ? -150 : 150) : 0);
    p.pvx = 0;
    p.collectT = 0;
    p.stunT = 0;
    p.armT = 0;
    p.judge = '';
    p.judgeT = 0;
    p.beatDone = false;
    p.trickEnd = -1;
    p.trickHot = false;
  }
  S.camX = Phaser.Math.Clamp(midX() - W / 2, 0, Math.max(0, WW - W));
}

function playerSpeed(p) {
  return (236 + p.upg.shoes * 46) * S.spec.grip;
}

function inSafeZone(x) {
  return x < SL || x > SR;
}

// --- Main loop ------------------------------------------------------------
function update(time, delta) {
  const dt = Math.min(48, delta) / 1000;
  const presses = takePresses();

  // The demo drives itself without touching the key queue, so this really is
  // "has a human done anything", which is what the attract timeout needs.
  if (presses.length || anyHeld()) S.idleT = 0;
  else S.idleT += dt;
  stepIdle();

  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 3.4);
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 5);

  switch (S.mode) {
    case 'menu': stepMenu(this, presses, dt, time); break;
    case 'howto': stepPanel(this, presses, 'menu'); break;
    case 'scores': stepPanel(this, presses, 'menu'); break;
    case 'play': stepPlay(this, presses, dt, time); break;
    case 'pause': stepPause(this, presses, dt); break;
    case 'tally': stepTally(this, presses, dt); break;
    case 'shop': stepShop(this, presses, dt); break;
    case 'over': stepOver(this, presses, dt); break;
    case 'name': stepName(this, presses, dt); break;
    case 'result': stepResult(this, presses, dt); break;
  }

  updateParticles(dt);
  render(this, time, dt);
}

function anyHeld() {
  for (const k in held) if (held[k]) return true;
  return false;
}

// Nobody walks up to a cabinet frozen on someone else's game-over screen.
// Every screen but the menu finds its own way back to attract mode.
const IDLE_LIMIT = { play: 75, pause: 45, howto: 45, scores: 35, tally: 45, shop: 60, over: 30, name: 60, result: 40 };

function stepIdle() {
  if (S.mode === 'menu') return;
  const limit = IDLE_LIMIT[S.mode];
  if (limit && S.idleT > limit) startDemo();
}

// --- Rhythm judging -------------------------------------------------------
const W_PERFECT = 58;    // ms
const W_GOOD = 132;

// The floreo: throw the whole cascade high, buy this many beats of free hands,
// then catch the lot on one beat. Miss that beat and everything hits the road.
const TRICK_BEATS = 3;
const TRICK_MIN_SHOW = 22;

function collectDur(p) {
  return Math.max(0.13, 0.34 - p.upg.guante * 0.07);
}

function collectRange(p) {
  return 88 + p.upg.hat * 34;
}

function dropBalls(p) {
  p.missStreak = 0;
  p.dropT = 1.0;
  p.show = 0;
  p.wobble = 0;
  p.trickEnd = -1;
  p.trickHot = false;
  SFX.drop();
  S.shake = 0.6;
  addFloat(p.px, HAND_Y - 40, 'SE CAYERON', COL.danger);
  for (let i = 0; i < p.nBalls; i++) {
    burst(p.px + (Math.random() - 0.5) * 40, HAND_Y, p.balls[i % p.balls.length], 6);
  }
}

function registerJudge(p, kind) {
  p.judge = kind;
  p.judgeT = 0.7;
  const hot = p.trickHot;
  p.trickHot = false;

  if (kind === 'PERFECTO' || kind === 'BIEN') {
    // A caught floreo is worth a run of ordinary catches, which is the whole
    // reason to take the risk.
    p.show = Math.min(100, p.show + (kind === 'PERFECTO' ? 3.2 : 1.4) * (hot ? 3.6 : 1));
    p.combo++;
    p.missStreak = 0;
    if (kind === 'PERFECTO') { p.totalPerfect++; SFX.perfect(); } else SFX.good();
    if (hot) {
      const bonus = Math.round(1100 * S.spec.tipMul * (1 + p.combo * 0.02));
      p.cash += bonus;
      p.roundCash += bonus;
      addFloat(p.px, HAND_Y - 78, 'iFLOREO!  +' + money(bonus), p.skin.mark);
      burst(p.px, HAND_Y - 40, p.skin.mark, 18);
      SFX.bigcoin();
      S.flash = 0.45;
      S.flashCol = p.skin.mark;
    }
  } else {
    p.show = Math.max(0, p.show - (hot ? 26 : 14));
    p.combo = 0;
    p.wobble = Math.min(1, p.wobble + 0.45);
    SFX.miss();
    // Three fumbles in a row and the balls hit the asphalt. Picking them back
    // up costs time, and time is the only currency the red light gives you.
    // A dropped floreo skips straight to the floor — that was the bet.
    p.missStreak = hot ? 3 : p.missStreak + 1;
    if (p.missStreak >= 3) dropBalls(p);
  }
  if (p.combo > p.bestCombo) p.bestCombo = p.combo;
}

function stepBeat(time, dt) {
  // Solo keeps the original feel: the cascade waits while the juggler is on
  // the ground. Versus never waits — your fumble is the other one's opening.
  if (!S.vs) {
    const p = S.players[0];
    if (p.dropT > 0 || p.stunT > 0) { S.nextBeat += dt * 1000; return; }
  }

  let guard = 0;
  while (time > S.nextBeat + W_GOOD && guard++ < 8) {
    for (const p of S.players) {
      const frozen = p.dropT > 0 || p.stunT > 0;
      // Mid-floreo there is nothing in the hands, so there is nothing to miss.
      if (!frozen && p.trickEnd < 0 && !p.beatDone) registerJudge(p, 'UY');
      p.beatDone = false;
    }
    S.nextBeat += S.beatMs;
    S.beatNum++;
    // The beat the throw comes down on is armed as the landing.
    for (const p of S.players) {
      if (p.trickEnd >= 0 && S.beatNum >= p.trickEnd) { p.trickEnd = -1; p.trickHot = true; }
    }
  }
}

function tryCatch(p, at) {
  if (p.dropT > 0 || p.stunT > 0) return;
  if (p.trickEnd >= 0) return;      // still up in the air
  // Reaching into a car window ties up the hand: the beat is simply gone.
  if (p.collectT > 0) return;
  if (p.beatDone) return;

  const d = at - S.nextBeat;
  if (d < -W_GOOD) {
    // Way too early — a flustered grab. Costs show but does not eat the beat.
    p.show = Math.max(0, p.show - 4);
    p.wobble = Math.min(1, p.wobble + 0.2);
    SFX.miss();
    return;
  }
  p.beatDone = true;
  registerJudge(p, Math.abs(d) <= W_PERFECT ? 'PERFECTO' : 'BIEN');
}

function tryTrick(p) {
  if (p.dropT > 0 || p.stunT > 0 || p.collectT > 0) return;
  if (p.trickEnd >= 0 || p.trickHot) return;
  if (p.show < TRICK_MIN_SHOW) {
    addFloat(p.px, HAND_Y - 60, 'SIN SHOW', COL.dim);
    SFX.miss();
    return;
  }
  p.trickEnd = S.beatNum + TRICK_BEATS;
  p.beatDone = true;                // this beat is spent on the throw itself
  SFX.trick();
  addFloat(p.px, HAND_Y - 66, 'iARRIBA!', p.skin.mark);
}

// --- Collecting -----------------------------------------------------------
function nearestOpenCar(p) {
  let best = null;
  let bestD = collectRange(p);
  for (const c of S.cars) {
    if (c.given || c.gone || c.openAmt < 0.55) continue;
    const d = Math.abs(c.x - p.px);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function tryCollect(p) {
  if (p.dropT > 0 || p.stunT > 0 || p.collectT > 0) return;
  const car = nearestOpenCar(p);
  if (!car) return;
  car.given = true;
  car.by = p.i;
  car.reT = CAR_RESTOCK;
  p.collectDir = Math.sign(car.x - p.px) || p.face;
  // Mid-floreo the hands are empty, so reaching in barely costs anything.
  p.collectT = collectDur(p) * (p.trickEnd >= 0 ? 0.45 : 1);
  const amount = Math.round(car.tip * (1 + p.combo * 0.015));
  p.roundCash += amount;
  p.cash += amount;
  addFloat(car.x, CAR_BASE - car.type.h - 26, '+$' + amount.toLocaleString('es-CO'), COL.cash);
  burst(car.x, CAR_BASE - car.type.h - 10, COL.cash, 10);
  if (amount >= 4000) { SFX.bigcoin(); S.flash = 0.5; S.flashCol = 0x7de07d; }
  else SFX.coin(p.combo);
}

// --- Round flow -----------------------------------------------------------
function stepPlay(scene, presses, dt, time) {
  // START is the only way off the machine that does not mean waiting out the
  // attract timeout.
  if (!S.demo && pressedOnce(presses, 'START1', 'START2')) {
    S.mode = 'pause';
    S.pauseIdx = 0;
    SFX.select();
    return;
  }

  if (S.nextBeat === 0) {
    S.nextBeat = time + 1500;   // short lead-in so the first beat is fair
    for (const p of S.players) p.beatDone = false;
  }

  if (S.eventT > 0) S.eventT = Math.max(0, S.eventT - dt);

  // Light cycle. Red is always RED_MS — the street escalates, never the clock.
  S.lightT -= dt * 1000;
  if (S.lightT <= 0) {
    if (S.light === 'red') {
      S.light = 'yellow';
      S.lightT = YELLOW_MS;
      SFX.horn();
      addFloat(midX(), HAND_Y - 70, 'AMARILLO', COL.warn);
    } else if (S.light === 'yellow') {
      S.light = 'green';
      S.lightT = GREEN_MS;
      resolveGreen(scene);
    } else {
      finishRound();
      return;
    }
  }

  if (S.light === 'green') S.nextBeat += dt * 1000;
  else stepBeat(time, dt);

  for (const p of S.players) stepPlayer(p, presses, dt, time);
  stepCars(dt);
  stepMotos(dt, time);
  updateCamera(scene, dt);
}

function stepPlayer(p, presses, dt, time) {
  const frozen = p.dropT > 0 || p.stunT > 0;
  if (p.dropT > 0) p.dropT = Math.max(0, p.dropT - dt);
  if (p.stunT > 0) p.stunT = Math.max(0, p.stunT - dt);
  if (p.collectT > 0) p.collectT = Math.max(0, p.collectT - dt);
  if (p.armT > 0) p.armT = Math.max(0, p.armT - dt);
  if (p.judgeT > 0) p.judgeT = Math.max(0, p.judgeT - dt);
  p.wobble = Math.max(0, p.wobble - dt * 0.55);

  let dir = 0;
  if (p.ai) {
    aiStep(p, dt, time);
    dir = p.aiDir;
  } else {
    for (const q of pressedCtl(p, presses, 'B1')) tryCatch(p, q.at);
    if (pressedCtl(p, presses, 'B2').length) { tryCollect(p); p.armT = 0.3; }
    if (pressedCtl(p, presses, 'B3').length) tryTrick(p);
    if (heldCtl(p, 'L')) dir -= 1;
    if (heldCtl(p, 'R')) dir += 1;
  }
  if (S.light === 'green') dir = 0;

  const spd = playerSpeed(p) * (frozen ? 0 : 1) * (p.collectT > 0 ? 0.35 : 1);
  p.pvx = dir * spd;
  p.px = Phaser.Math.Clamp(p.px + p.pvx * dt, 24, WW - 24);
  if (dir !== 0) {
    p.face = dir;
    const prev = p.walkT;
    p.walkT += dt * (frozen ? 0 : 9);
    if (Math.floor(prev / 3.14) !== Math.floor(p.walkT / 3.14)) SFX.step();
  }

  // Show decays: standing still is not a show.
  if (!frozen && S.light !== 'green') {
    p.show = Math.max(0, p.show - dt * 1.7);
    // The crowd tips passively while the show is hot.
    if (p.show > 40) {
      const t = (p.show - 40) * dt * 1.2 * S.spec.tipMul;
      p.cash += t;
      p.roundCash += t;
    }
  }
}

// Windows open and close with the quality of the best show on the street, and
// a window that stays down too long goes back up for good.
function stepCars(dt) {
  const hot = maxShow();
  for (let i = 0; i < S.cars.length; i++) {
    const c = S.cars[i];
    // On green the whole avenue pulls away and leaves you standing there.
    if (S.light === 'green') c.x += (210 + (i % 4) * 55) * dt * Math.min(1, (GREEN_MS / 1000 - S.lightT / 1000) * 2.2);
    const want = !c.given && !c.gone && hot >= c.type.need && S.light !== 'green' ? 1 : 0;
    const before = c.openAmt;
    c.openAmt = Phaser.Math.Linear(c.openAmt, want, Math.min(1, dt * 7));
    if (before < 0.55 && c.openAmt >= 0.55) SFX.move();
    if (c.openAmt > 0.55 && !c.given && !c.gone && S.light !== 'green') {
      c.pat -= dt;
      if (c.pat <= 0) {
        c.gone = true;
        c.reT = CAR_RESTOCK;
        addFloat(c.x, CAR_BASE - c.type.h - 26, 'SE CANSO', COL.dim);
        SFX.shut();
      }
    }
    // The versus street is short, so a spent car pulls off and another takes
    // the spot. Otherwise the avenue would run dry halfway through the red.
    if (S.vs && S.light === 'red' && c.reT > 0) {
      c.reT -= dt;
      if (c.reT <= 0) restockCar(c);
    }
    if (c.slide > 0) c.slide = Math.max(0, c.slide - dt * 2.4);
    c.bob += dt * 1.6;
  }
}

function stepMotos(dt, time) {
  for (const m of S.motos) {
    if (S.light === 'green') { m.x += m.dir * m.speed * 2.4 * dt; continue; }
    m.x += m.dir * m.speed * dt;
    if (m.x < SL - 40) { m.x = SL - 40; m.dir = 1; }
    if (m.x > SR + 40) { m.x = SR + 40; m.dir = -1; }
    m.hornT -= dt * 1000;
    if (m.hornT <= 0) { m.hornT = 2600 + Math.random() * 3200; if (Math.abs(m.x - midX()) < 340) SFX.horn(); }

    // A weaving motorbike knocks the whole cascade down, but never costs a
    // life: only the green light kills.
    for (const p of S.players) {
      if (p.stunT <= 0 && p.dropT <= 0 && Math.abs(m.x - p.px) < 24 && !inSafeZone(p.px)) {
        p.stunT = 1.15;
        p.show = 0;
        p.combo = 0;
        p.missStreak = 0;
        p.trickEnd = -1;
        p.trickHot = false;
        S.shake = 0.8;
        S.flash = 0.6;
        S.flashCol = 0xff3b30;
        SFX.hit();
        addFloat(p.px, HAND_Y - 50, 'iiiUY!', COL.danger);
        burst(p.px, HAND_Y, COL.danger, 14);
      }
    }
  }
}

function resolveGreen(scene) {
  let hit = false;
  for (const p of S.players) {
    if (inSafeZone(p.px)) {
      addFloat(p.px, HAND_Y - 60, 'iSALVO!', COL.cash);
      continue;
    }
    hit = true;
    p.stunT = 2.2;
    p.show = 0;
    p.combo = 0;
    p.trickEnd = -1;
    p.trickHot = false;
    if (S.vs) {
      // A versus run is only three lights long, so a life would end it
      // outright. It costs a cut of the take instead.
      const lost = Math.round(p.cash * 0.35);
      p.cash -= lost;
      addFloat(p.px, HAND_Y - 60, 'iLO COGIO!  -' + money(lost), COL.danger);
    } else {
      S.lives--;
      addFloat(p.px, HAND_Y - 60, 'iTE COGIO EL VERDE!', COL.danger);
    }
    burst(p.px, HAND_Y, COL.danger, 22);
  }
  if (hit) {
    S.shake = 1.2;
    S.flash = 1;
    S.flashCol = 0xff3b30;
    SFX.hit();
  } else {
    SFX.cash();
  }
}

function finishRound() {
  // Attract mode never ends; it just rolls into the next light.
  if (S.demo) {
    startRound(S.round >= 5 ? 1 : S.round + 1);
    return;
  }
  if (S.vs) {
    if (S.round >= VS_ROUNDS) { S.mode = 'result'; S.overT = 0; return; }
    S.mode = 'tally';
    S.tallyT = 0;
    return;
  }
  if (S.lives <= 0) {
    S.mode = 'over';
    S.overT = 0;
    return;
  }
  S.mode = 'tally';
  S.tallyT = 0;
  rollShopOffer();
}

function updateCamera(scene, dt) {
  const target = Phaser.Math.Clamp(midX() - W / 2, 0, Math.max(0, WW - W));
  S.camX = Phaser.Math.Linear(S.camX, target, Math.min(1, dt * 5.2));
  scene.cameras.main.setScroll(S.camX, 0);
}

// --- Attract-mode juggler -------------------------------------------------
// Deliberately good but not perfect: it catches on the beat, hunts the richest
// open window, floreos to cross the avenue, and runs for the corner on amber.
function aiStep(p, dt, time) {
  // Catch: aim for the beat with just enough jitter to look human.
  if (p.trickEnd < 0 && !p.beatDone && p.collectT <= 0 && time >= S.nextBeat - 22) {
    tryCatch(p, S.nextBeat + (Math.random() * 40 - 20));
  }

  if (S.light !== 'red') {
    // Amber: forget the money, take the nearest corner.
    const goLeft = Math.abs(p.px - SL) < Math.abs(p.px - SR);
    const goal = goLeft ? SL - 30 : SR + 30;
    p.aiDir = Math.abs(p.px - goal) < 8 ? 0 : Math.sign(goal - p.px);
    return;
  }

  // Get out of the way of anything closing in. A juggler flat on the asphalt
  // is the worst thing an attract screen can be showing.
  for (const m of S.motos) {
    const d = m.x - p.px;
    if (Math.abs(d) < 130 && m.dir * d < 0) {
      p.aiDir = -Math.sign(d) || 1;
      return;
    }
  }

  // Pick the fattest window in reach of a short walk.
  let best = null;
  let bestScore = -1;
  for (const c of S.cars) {
    if (c.given || c.gone) continue;
    const reach = p.show >= c.type.need ? 1 : 0.25;
    const score = (c.tip * reach) / (60 + Math.abs(c.x - p.px));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  p.aiTarget = best;

  if (!best) { p.aiDir = 0; return; }
  const d = best.x - p.px;
  p.aiDir = Math.abs(d) < 26 ? 0 : Math.sign(d);

  // A long walk is what the floreo is for.
  if (Math.abs(d) > 240 && p.show > TRICK_MIN_SHOW + 12 && p.trickEnd < 0) tryTrick(p);

  // Only reach into a window when the whole reach fits before the next beat.
  // Measuring "distance to the beat" instead of "room left" is what made it
  // drop the cascade over and over.
  const room = S.nextBeat - time;
  if (p.trickEnd >= 0 || room > collectDur(p) * 1000 + 90) {
    if (nearestOpenCar(p)) tryCollect(p);
  }
}

// --- Particles and floating text -----------------------------------------
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 190;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.4, max: 0.9, color, r: 2 + Math.random() * 3 });
  }
}

function addFloat(x, y, text, color) {
  S.floats.push({ x, y, text, color, life: 1.1, max: 1.1 });
}

function updateParticles(dt) {
  for (let i = S.parts.length - 1; i >= 0; i--) {
    const p = S.parts[i];
    p.life -= dt;
    if (p.life <= 0) { S.parts.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 620 * dt;
  }
  for (let i = S.floats.length - 1; i >= 0; i--) {
    const f = S.floats[i];
    f.life -= dt;
    if (f.life <= 0) { S.floats.splice(i, 1); continue; }
    f.y -= dt * 34;
  }
}

// --- Menu -----------------------------------------------------------------
const MENU_ITEMS = ['UN JUGADOR', 'DOS JUGADORES', 'COMO SE JUEGA', 'LOS MAS BERRACOS'];

function beginRun(vs) {
  resetRun(vs);
  S.mode = 'play';
  S.nextBeat = 0;
  S.idleT = 0;
  SFX.start();
}

function stepMenu(scene, presses, dt, time) {
  // The demo is a real round, so the menu sits on top of actual gameplay.
  stepPlay(scene, [], dt, time);

  if (pressedOnce(presses, 'P1_U', 'P2_U')) { S.menuIdx = (S.menuIdx + MENU_ITEMS.length - 1) % MENU_ITEMS.length; SFX.move(); }
  if (pressedOnce(presses, 'P1_D', 'P2_D')) { S.menuIdx = (S.menuIdx + 1) % MENU_ITEMS.length; SFX.move(); }

  // START2 drops straight into versus, the way a cabinet should behave.
  if (pressedOnce(presses, 'START2', 'P2_1')) { SFX.select(); beginRun(true); return; }

  if (pressedOnce(presses, 'P1_1', 'START1')) {
    SFX.select();
    if (S.menuIdx === 0) beginRun(false);
    else if (S.menuIdx === 1) beginRun(true);
    else if (S.menuIdx === 2) S.mode = 'howto';
    else {
      S.mode = 'scores';
      loadScores().then((l) => { S.scores = l; });
    }
  }
}

function stepPanel(scene, presses, back) {
  S.cascadeT += 0.02;
  if (pressedOnce(presses, 'P1_1', 'P1_2', 'P2_1', 'P2_2', 'START1', 'START2')) {
    SFX.select();
    S.mode = back;
  }
}

// --- Pause ----------------------------------------------------------------
// A cabinet has no back button. START opens this, and it is the only way to
// give the machine back without waiting out the attract timeout.
const PAUSE_ITEMS = ['SEGUIR JUGANDO', 'DEJARLO ASI'];

function stepPause(scene, presses, dt) {
  S.cascadeT += dt * 1.6;
  if (pressedOnce(presses, 'P1_U', 'P2_U', 'P1_D', 'P2_D')) {
    S.pauseIdx = 1 - S.pauseIdx;
    SFX.move();
  }
  if (pressedOnce(presses, 'START1', 'START2')) { SFX.select(); S.mode = 'play'; S.nextBeat = 0; return; }
  if (pressedOnce(presses, 'P1_1', 'P2_1')) {
    SFX.select();
    if (S.pauseIdx === 0) { S.mode = 'play'; S.nextBeat = 0; }
    else startDemo();
  }
}

// --- Between lights -------------------------------------------------------
function stepTally(scene, presses, dt) {
  S.tallyT += dt;
  S.cascadeT += dt * 1.6;
  if (S.tallyT > 0.6 && pressedOnce(presses, 'P1_1', 'P1_2', 'P2_1', 'P2_2', 'START1', 'START2')) {
    SFX.select();
    // Versus has no shop: both jugglers go straight back to the street.
    if (S.vs) {
      startRound(S.round + 1);
      S.mode = 'play';
      S.nextBeat = 0;
    } else {
      S.mode = 'shop';
      S.shopIdx = 0;
    }
  }
}

// --- Versus result --------------------------------------------------------
function stepResult(scene, presses, dt) {
  S.overT += dt;
  if (S.overT > 1 && pressedOnce(presses, 'P1_1', 'P2_1', 'START1', 'START2')) {
    SFX.select();
    startDemo();
  }
}

// Upgrades are paid for out of the money you just made, and that money is your
// score. Reinvest or keep it — that is the actual rebusque.
function upgradeCost(kind) {
  const owned = P1P().upg[kind];
  const base = kind === 'shoes' ? 9000 : kind === 'guante' ? 14000 : 11000;
  return Math.round(base * Math.pow(1.85, owned));
}

const UPGRADES = {
  shoes: { name: 'TENIS NUEVOS', desc: 'Caminas mas rapido por la avenida', max: 3 },
  guante: { name: 'GUANTES', desc: 'Cobras mas rapido, pierdes menos tiempos', max: 3 },
  hat: { name: 'SOMBRERO', desc: 'Alcanzas ventanas desde mas lejos', max: 3 },
};

function rollShopOffer() {
  const p = P1P();
  S.shopOffer = Object.keys(UPGRADES).filter((k) => p.upg[k] < UPGRADES[k].max);
  S.shopOffer.push('seguir');
}

function stepShop(scene, presses, dt) {
  S.cascadeT += dt * 1.6;
  const n = S.shopOffer.length;
  if (pressedOnce(presses, 'P1_L', 'P2_L')) { S.shopIdx = (S.shopIdx + n - 1) % n; SFX.move(); }
  if (pressedOnce(presses, 'P1_R', 'P2_R')) { S.shopIdx = (S.shopIdx + 1) % n; SFX.move(); }

  if (pressedOnce(presses, 'P1_1', 'P2_1', 'START1', 'START2')) {
    const pick = S.shopOffer[S.shopIdx];
    if (pick === 'seguir') {
      SFX.select();
      startRound(S.round + 1);
      S.mode = 'play';
      S.nextBeat = 0;
      return;
    }
    const cost = upgradeCost(pick);
    const p = P1P();
    if (p.cash >= cost) {
      p.cash -= cost;
      p.upg[pick]++;
      SFX.cash();
      S.flash = 0.4;
      S.flashCol = 0xffd400;
      rollShopOffer();
      S.shopIdx = Math.min(S.shopIdx, S.shopOffer.length - 1);
    } else {
      SFX.miss();
    }
  }
}

// --- Game over and name entry --------------------------------------------
function stepOver(scene, presses, dt) {
  S.overT += dt;
  S.cascadeT += dt * 1.6;
  if (S.overT > 0.8 && pressedOnce(presses, 'P1_1', 'P1_2', 'P2_1', 'P2_2', 'START1', 'START2')) {
    SFX.select();
    const score = Math.round(P1P().cash);
    const worthy = S.scores.length < MAX_SCORES || score > (S.scores[S.scores.length - 1] || { score: 0 }).score;
    if (worthy && score > 0) {
      S.mode = 'name';
      S.nameIdx = 0;
      S.nameChars = [0, 0, 0];
    } else {
      startDemo();
    }
  }
}

function stepName(scene, presses, dt) {
  if (pressedOnce(presses, 'P1_U', 'P2_U')) {
    S.nameChars[S.nameIdx] = (S.nameChars[S.nameIdx] + NAME_ALPHABET.length - 1) % NAME_ALPHABET.length;
    SFX.move();
  }
  if (pressedOnce(presses, 'P1_D', 'P2_D')) {
    S.nameChars[S.nameIdx] = (S.nameChars[S.nameIdx] + 1) % NAME_ALPHABET.length;
    SFX.move();
  }
  if (pressedOnce(presses, 'P1_L', 'P2_L')) { S.nameIdx = Math.max(0, S.nameIdx - 1); SFX.move(); }
  if (pressedOnce(presses, 'P1_R', 'P2_R')) { S.nameIdx = Math.min(NAME_LEN - 1, S.nameIdx + 1); SFX.move(); }

  if (pressedOnce(presses, 'P1_1', 'P2_1', 'START1', 'START2')) {
    if (S.nameIdx < NAME_LEN - 1) {
      S.nameIdx++;
      SFX.select();
      return;
    }
    const name = S.nameChars.map((i) => NAME_ALPHABET[i]).join('');
    SFX.cash();
    const p = P1P();
    const entry = {
      name,
      score: Math.round(p.cash),
      round: S.round,
      combo: p.bestCombo,
      savedAt: new Date().toISOString(),
    };
    saveScore(entry).then((list) => { S.scores = list; });
    S.scores = S.scores.concat(entry).sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
    startDemo();
    S.mode = 'scores';
  }
}

// --- Text pool ------------------------------------------------------------
// Phaser text objects are expensive to rebuild, so they are pooled and only
// touched when their content or style actually changes.
const textPool = [];
let textIdx = 0;
let textScene = null;

function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

function beginText(scene) {
  textScene = scene;
  textIdx = 0;
}

function txt(x, y, str, size, color, ox, oy, scrollF, depth) {
  let t = textPool[textIdx];
  if (!t) {
    t = textScene.add.text(0, 0, '', { fontFamily: 'monospace', fontStyle: 'bold' });
    textPool.push(t);
  }
  textIdx++;
  const key = size + '|' + color + '|' + (ox === undefined ? 0.5 : ox) + '|' + (oy === undefined ? 0.5 : oy);
  if (t._k !== key) {
    t._k = key;
    t.setStyle({ fontFamily: 'monospace', fontStyle: 'bold', fontSize: size + 'px', color: hex(color) });
    t.setOrigin(ox === undefined ? 0.5 : ox, oy === undefined ? 0.5 : oy);
  }
  if (t.text !== str) t.setText(str);
  t.setPosition(x, y);
  t.setScrollFactor(scrollF === undefined ? 0 : scrollF);
  t.setDepth(depth === undefined ? 12 : depth);
  t.setAlpha(1);
  if (!t.visible) t.setVisible(true);
  return t;
}

function endText() {
  for (let i = textIdx; i < textPool.length; i++) {
    if (textPool[i].visible) textPool[i].setVisible(false);
  }
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('es-CO');
}

// --- Static background geometry, generated once --------------------------
let BG = null;

function buildBackground() {
  const rng = makeRng(0xb0607a);
  const cerros = [];
  for (let x = -40; x <= 1000; x += 20) {
    const y = 176
      - Math.sin(x * 0.0062) * 34
      - Math.sin(x * 0.0141 + 1.3) * 18
      - Math.sin(x * 0.031 + 0.7) * 7;
    cerros.push({ x, y });
  }
  const blocks = [];
  let bx = -60;
  while (bx < 1240) {
    const bw = 46 + rng() * 74;
    const bh = 52 + rng() * 96;
    const wins = [];
    const cols = Math.max(1, Math.floor(bw / 16));
    const rows = Math.max(1, Math.floor(bh / 18));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rng() < 0.52) wins.push({ x: bx + 7 + c * 16, y: FAR_WALK - bh + 9 + r * 18, lit: rng() < 0.7 });
      }
    }
    blocks.push({ x: bx, w: bw, h: bh, wins, shade: rng() });
    bx += bw + 3 + rng() * 8;
  }
  const stars = [];
  for (let i = 0; i < 60; i++) stars.push({ x: rng() * 1000, y: rng() * 130, r: rng() * 1.3 + 0.3 });

  const lamps = [];
  for (let x = 150; x < WORLD_W; x += 355) lamps.push({ x, side: x % 710 < 355 ? 1 : -1 });

  // Onlookers on the far pavement. Small, so they read as distance.
  const crowd = [];
  const palette = [0xd94f3d, 0x3d7fd9, 0x4cc27a, 0xe0b33d, 0xd96bb0, 0x8f6bd6];
  for (let i = 0; i < 16; i++) {
    crowd.push({
      x: 90 + rng() * (WORLD_W - 180),
      shirt: palette[Math.floor(rng() * palette.length)],
      phase: rng() * 6.28,
      rate: 3.2 + rng() * 2.4,
      tall: 22 + rng() * 6,
    });
  }
  BG = { cerros, blocks, stars, lamps, crowd };
}

// --- World rendering ------------------------------------------------------
function drawSky(time) {
  const k = g.sky;
  k.clear();
  k.fillGradientStyle(COL.skyTop, COL.skyTop, COL.skyMid, COL.skyMid, 1);
  k.fillRect(0, 0, W, 132);
  k.fillGradientStyle(COL.skyMid, COL.skyMid, COL.skyLow, COL.skyLow, 1);
  k.fillRect(0, 130, W, SKY_BOTTOM - 130);
  for (const s of BG.stars) {
    const tw = 0.45 + 0.55 * Math.sin(time * 0.002 + s.x);
    k.fillStyle(0xffffff, 0.5 * tw);
    k.fillCircle(s.x % W, s.y, s.r);
  }
}

function drawCerros() {
  const k = g.cerros;
  k.clear();
  k.fillStyle(COL.cerros, 1);
  k.beginPath();
  k.moveTo(BG.cerros[0].x, BG.cerros[0].y);
  for (const p of BG.cerros) k.lineTo(p.x, p.y);
  k.lineTo(1000, SKY_BOTTOM + 40);
  k.lineTo(-40, SKY_BOTTOM + 40);
  k.closePath();
  k.fillPath();
  // Monserrate: the one silhouette every bogotano reads instantly.
  k.fillStyle(0x241a3f, 1);
  k.fillTriangle(300, 140, 262, 176, 338, 176);
  k.fillStyle(COL.window, 0.85);
  k.fillRect(298, 128, 4, 14);
  k.fillRect(292, 132, 16, 3);
}

function drawBlocks(time) {
  const k = g.blocks;
  k.clear();
  for (const b of BG.blocks) {
    k.fillStyle(b.shade > 0.5 ? COL.blockNear : COL.blockFar, 1);
    k.fillRect(b.x, FAR_WALK - b.h, b.w, b.h);
    for (const wn of b.wins) {
      const on = wn.lit && (Math.sin(time * 0.0004 + wn.x * 0.3) > -0.85);
      k.fillStyle(on ? COL.window : 0x151228, on ? 0.9 : 1);
      k.fillRect(wn.x, wn.y, 7, 9);
    }
  }
}

function drawRoad(time) {
  const k = g.world;
  k.clear();

  // Far sidewalk strip and the asphalt.
  k.fillStyle(COL.walk, 1);
  k.fillRect(0, FAR_WALK, WORLD_W, ROAD_TOP - FAR_WALK + 6);
  k.fillGradientStyle(COL.roadDark, COL.roadDark, COL.road, COL.road, 1);
  k.fillRect(0, ROAD_TOP, WORLD_W, ROAD_BOTTOM - ROAD_TOP);

  // Lane dashes.
  k.fillStyle(COL.lane, 0.5);
  for (let x = 20; x < WORLD_W; x += 96) k.fillRect(x, 392, 52, 5);
  k.fillStyle(COL.lane, 0.28);
  for (let x = 60; x < WORLD_W; x += 96) k.fillRect(x, 492, 52, 4);

  // The two corners: the only safe ground when the light turns.
  drawCorner(k, 0, SL, time, 1);
  drawCorner(k, SR, Math.max(WW, W), time, -1);

  // Near curb.
  k.fillStyle(COL.curb, 1);
  k.fillRect(0, ROAD_BOTTOM, WORLD_W, 8);
  k.fillStyle(COL.walk, 1);
  k.fillRect(0, ROAD_BOTTOM + 8, WORLD_W, H - ROAD_BOTTOM);
}

function drawCorner(k, x0, x1, time, side) {
  const w = x1 - x0;
  k.fillStyle(COL.walkTop, 1);
  k.fillRect(x0, ROAD_TOP - 6, w, ROAD_BOTTOM - ROAD_TOP + 14);
  k.fillStyle(COL.curb, 1);
  k.fillRect(side > 0 ? x1 - 7 : x0, ROAD_TOP - 6, 7, ROAD_BOTTOM - ROAD_TOP + 14);
  // Zebra crossing paint, worn.
  k.fillStyle(COL.paper, 0.30);
  for (let i = 0; i < 5; i++) {
    k.fillRect(x0 + 8, ROAD_TOP + 12 + i * 42, w - 18, 20);
  }
  // Safe-zone marker so the player can always see where home is.
  const pulse = 0.28 + 0.22 * Math.sin(time * 0.005);
  k.fillStyle(COL.cash, pulse);
  k.fillRect(side > 0 ? x1 - 4 : x0 + 1, ROAD_TOP - 6, 4, ROAD_BOTTOM - ROAD_TOP + 14);
}

// Lamp posts and the crowd, drawn behind the traffic so the depth reads.
function drawStreet(k, time) {
  for (const l of BG.lamps) {
    k.fillStyle(0x241f33, 1);
    k.fillRect(l.x - 3, 186, 7, 122);
    k.fillRect(l.x + (l.side > 0 ? 4 : -34), 188, 30, 5);
    const hx = l.x + l.side * 32;
    k.fillStyle(0x3a3450, 1);
    k.fillTriangle(hx - 11, 192, hx + 11, 192, hx, 204);
    k.fillStyle(0xffe9a8, 0.85);
    k.fillCircle(hx, 200, 5);
    k.fillStyle(0xffe9a8, 0.10);
    k.fillCircle(hx, 200, 20);
    // Pool of light on the asphalt.
    k.fillStyle(0xffe9a8, 0.05);
    k.fillEllipse(hx, 372, 190, 62);
  }

  // The better the show, the harder the crowd bounces.
  const hype = Math.min(1, maxShow() / 70);
  for (const p of BG.crowd) {
    const bob = Math.sin(time * 0.001 * p.rate + p.phase) * (1.2 + hype * 5);
    const y = 306 + bob;
    k.fillStyle(0x1a1730, 1);
    k.fillRect(p.x - 4, y - p.tall * 0.42, 9, p.tall * 0.42);
    k.fillStyle(p.shirt, 0.92);
    k.fillRoundedRect(p.x - 5, y - p.tall, 11, p.tall * 0.62, 3);
    k.fillStyle(0x8c5a3c, 1);
    k.fillCircle(p.x, y - p.tall - 4, 5);
    // Arms go up when the show is genuinely hot.
    if (hype > 0.72) {
      const clap = Math.sin(time * 0.012 + p.phase) * 3;
      k.fillStyle(0x8c5a3c, 1);
      k.fillRect(p.x - 9, y - p.tall - 6 + clap, 4, 10);
      k.fillRect(p.x + 5, y - p.tall - 6 - clap, 4, 10);
    }
  }
}

function drawCar(k, c, time) {
  const t = c.type;
  const bob = Math.sin(c.bob) * 1.2;
  const cx = c.x + c.slide * 300;
  const x = cx - t.w / 2;
  const y = CAR_BASE - t.h + bob;

  // Wheels.
  k.fillStyle(0x14141a, 1);
  k.fillCircle(x + t.w * 0.22, CAR_BASE + bob, 13);
  k.fillCircle(x + t.w * 0.78, CAR_BASE + bob, 13);
  k.fillStyle(0x3a3a44, 1);
  k.fillCircle(x + t.w * 0.22, CAR_BASE + bob, 5);
  k.fillCircle(x + t.w * 0.78, CAR_BASE + bob, 5);

  // Body and cabin.
  k.fillStyle(t.body, 1);
  k.fillRoundedRect(x, y + t.h * 0.38, t.w, t.h * 0.62, 7);
  k.fillStyle(t.roof, 1);
  k.fillRoundedRect(x + t.w * 0.16, y, t.w * 0.66, t.h * 0.52, 6);

  // Glass. The near window is the one that opens.
  const glassY = y + 6;
  const glassH = t.h * 0.34;
  k.fillStyle(0x0e1c2a, 0.92);
  k.fillRect(x + t.w * 0.2, glassY, t.w * 0.26, glassH);
  const openW = t.w * 0.28;
  const openX = x + t.w * 0.5;
  k.fillStyle(0x0e1c2a, 0.92);
  k.fillRect(openX, glassY, openW, glassH * (1 - c.openAmt));
  if (c.openAmt > 0.05) {
    k.fillStyle(0x05070c, 1);
    k.fillRect(openX, glassY + glassH * (1 - c.openAmt), openW, glassH * c.openAmt);
  }

  // Headlights and plate.
  k.fillStyle(0xffe9a8, 0.85);
  k.fillRect(x + t.w - 5, y + t.h * 0.5, 5, 7);
  k.fillStyle(0xd8d8d8, 0.7);
  k.fillRect(x + 4, y + t.h * 0.78, 22, 8);

  // An arm with a coin comes out once the window is down and nothing is taken.
  if (c.openAmt > 0.5 && !c.given) {
    const reach = (c.openAmt - 0.5) * 2;
    const ax = openX + openW * 0.5;
    const ay = glassY + glassH * 0.72;
    k.fillStyle(COL.skin, 1);
    k.fillRoundedRect(ax - 4, ay, 8, 16 + 12 * reach, 4);
    const cy = ay + 26 + 12 * reach + Math.sin(time * 0.006 + c.bob) * 2;
    k.fillStyle(0xffd400, 1);
    k.fillCircle(ax, cy, 6);
    k.fillStyle(0xc9a300, 1);
    k.fillCircle(ax, cy, 3);
  }

  if (t.says) {
    txt(cx, y - 12, t.says, 11, 0xf6f0e2, 0.5, 0.5, 1, 7);
  }
  if (c.given) {
    txt(cx, y - 12, 'GRACIAS', 11, COL.cash, 0.5, 0.5, 1, 7);
  }
}

function drawMoto(k, m, time) {
  const y = CAR_BASE + 26;
  const lean = Math.sin(time * 0.012 + m.x) * 2;
  k.fillStyle(0x14141a, 1);
  k.fillCircle(m.x - 16 * m.dir, y, 9);
  k.fillCircle(m.x + 16 * m.dir, y, 9);
  k.fillStyle(m.color, 1);
  k.fillRoundedRect(m.x - 16, y - 16 + lean, 32, 14, 5);
  // Rider.
  k.fillStyle(0x1f2233, 1);
  k.fillRoundedRect(m.x - 6, y - 40 + lean, 14, 26, 6);
  k.fillStyle(0xe8e8f0, 1);
  k.fillCircle(m.x + 1, y - 46 + lean, 9);
  k.fillStyle(0x0e1c2a, 1);
  k.fillRect(m.x + 1 + 3 * m.dir, y - 49 + lean, 6, 6);
  // Headlight cone as a warning that it is coming.
  k.fillStyle(0xffe9a8, 0.14);
  k.fillTriangle(m.x + 20 * m.dir, y - 8, m.x + 90 * m.dir, y - 26, m.x + 90 * m.dir, y + 12);
}

// The juggler. Everything is drawn from primitives — no sprites anywhere.
function drawJuggler(k, time, p) {
  const x = p.px;
  const skin = p.skin;
  const down = p.dropT > 0;
  const knocked = p.stunT > 0;
  const step = Math.sin(p.walkT);
  const moving = Math.abs(p.pvx) > 1;

  // In versus each juggler wears a coloured ring so nobody loses their own.
  if (S.vs) {
    k.fillStyle(skin.mark, 0.22);
    k.fillEllipse(x, FEET_Y + 2, 62, 16);
    k.fillStyle(skin.mark, 0.5);
    k.fillEllipse(x, FEET_Y + 2, 40, 10);
  }

  if (knocked) {
    // Flat on the asphalt.
    k.fillStyle(COL.pants, 1);
    k.fillRoundedRect(x - 30, FEET_Y - 14, 40, 12, 5);
    k.fillStyle(skin.shirt, 1);
    k.fillRoundedRect(x - 2, FEET_Y - 18, 34, 16, 6);
    k.fillStyle(COL.skin, 1);
    k.fillCircle(x + 38, FEET_Y - 14, 11);
    k.fillStyle(skin.hat, 1);
    k.fillRoundedRect(x + 26, FEET_Y - 26, 24, 6, 3);
    return;
  }

  const crouch = down ? 12 : 0;
  const bodyY = FEET_Y - 52 + crouch;

  // Legs.
  k.fillStyle(COL.pants, 1);
  const l1 = moving ? step * 7 : 2;
  const l2 = moving ? -step * 7 : -2;
  k.fillRoundedRect(x - 11 + l1, bodyY + 26 - crouch, 9, 28 - crouch, 4);
  k.fillRoundedRect(x + 2 + l2, bodyY + 26 - crouch, 9, 28 - crouch, 4);
  k.fillStyle(0x2a2118, 1);
  k.fillRect(x - 13 + l1, FEET_Y - 5, 13, 5);
  k.fillRect(x + 0 + l2, FEET_Y - 5, 13, 5);

  // Torso, with a stripe so he reads against the traffic.
  k.fillStyle(skin.shirt, 1);
  k.fillRoundedRect(x - 13, bodyY, 26, 30, 7);
  k.fillStyle(COL.paper, 0.85);
  k.fillRect(x - 13, bodyY + 13, 26, 4);

  // Arms: reaching to a window, thrown up on a floreo, or in the cascade.
  k.fillStyle(COL.skin, 1);
  if (p.collectT > 0) {
    const dir = p.collectDir;
    k.fillRoundedRect(x + (dir > 0 ? 8 : -30), bodyY + 4, 22, 8, 4);
    k.fillRoundedRect(x - 12 + (dir > 0 ? -8 : 12), bodyY + 2, 8, 18, 4);
  } else if (down) {
    k.fillRoundedRect(x - 20, bodyY + 20, 10, 18, 5);
    k.fillRoundedRect(x + 10, bodyY + 20, 10, 18, 5);
  } else if (p.trickEnd >= 0) {
    k.fillRoundedRect(x - 24, bodyY - 20, 10, 28, 5);
    k.fillRoundedRect(x + 14, bodyY - 20, 10, 28, 5);
  } else {
    const reach = Math.sin(time * 0.004) * 3;
    k.fillRoundedRect(x - 22, bodyY - 8 + reach, 10, 24, 5);
    k.fillRoundedRect(x + 12, bodyY - 8 - reach, 10, 24, 5);
  }

  // Head and hat.
  k.fillStyle(COL.skin, 1);
  k.fillCircle(x, bodyY - 12, 12);
  k.fillStyle(skin.hat, 1);
  k.fillRoundedRect(x - 17, bodyY - 22, 34, 6, 3);
  k.fillRoundedRect(x - 11, bodyY - 32, 22, 12, 5);
  if (p.upg.hat > 0) {
    k.fillStyle(COL.accent, 1);
    k.fillRect(x - 17, bodyY - 23, 34, 3);
  }
  if (S.vs) {
    txt(x, bodyY - 48, skin.tag, 13, skin.mark, 0.5, 0.5, 1, 8);
  }
}

// The cascade, derived from the beat counter rather than its own clock, so a
// ball touches a hand on every single beat and the markers on the rhythm bar
// are telling the literal truth.
//
// The ball landing on beat B is ball (B mod n); it was thrown on beat B-n, so
// its flight lasts exactly n beats. Hands alternate with B, which means odd
// ball counts cross into a cascade and even ones stack into a fountain —
// the same thing real juggling does.
function liveRound() {
  return S.mode === 'play' || S.demo;
}

function beatClock(time) {
  if (liveRound()) return S.beatNum - (S.nextBeat - time) / S.beatMs;
  return S.cascadeT;
}

function drawBalls(k, time, p) {
  const n = p.nBalls;
  const hands = [p.px - 17, p.px + 17];
  const arcH = (HAND_Y - ARC_TOP) * (0.55 + p.show / 220);

  if (p.dropT > 0 || p.stunT > 0) {
    for (let i = 0; i < n; i++) {
      const off = ((i * 61) % 100) / 100 - 0.5;
      k.fillStyle(p.balls[i % p.balls.length], 1);
      k.fillCircle(p.px + off * 90, FEET_Y - 4, 8);
      k.fillStyle(0x000000, 0.18);
      k.fillEllipse(p.px + off * 90, FEET_Y + 5, 18, 5);
    }
    return;
  }

  const bc = beatClock(time);
  const wob = p.wobble * 16;

  // Floreo: the whole cascade leaves on one arc and comes back on one beat.
  if (p.trickEnd >= 0) {
    const u = Phaser.Math.Clamp(1 - (p.trickEnd - bc) / TRICK_BEATS, 0, 1);
    const lift = (HAND_Y - 64) * Math.sin(Math.PI * u);
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 24;
      const x = p.px + spread * (0.35 + Math.sin(Math.PI * u) * 0.9);
      const y = HAND_Y - lift + Math.sin(time * 0.02 + i) * 2;
      const col = p.balls[i % p.balls.length];
      k.fillStyle(col, 0.2);
      k.fillCircle(x, y + 12, 9);
      k.fillStyle(col, 1);
      k.fillCircle(x, y, 9);
      k.fillStyle(0xffffff, 0.45);
      k.fillCircle(x - 3, y - 3, 3);
    }
    if (u > 0.66) {
      const tight = (u - 0.66) / 0.34;
      k.lineStyle(3, p.skin.mark, 0.3 + tight * 0.6);
      k.strokeCircle(p.px, HAND_Y, 16 + (1 - tight) * 60);
    }
    return;
  }

  for (let i = 0; i < n; i++) {
    const land = i + n * Math.ceil((bc - i) / n);   // next beat this ball lands on
    const thrown = land - n;
    const u = Phaser.Math.Clamp((bc - thrown) / n, 0, 1);
    const fromX = hands[((thrown % 2) + 2) % 2];
    const toX = hands[((land % 2) + 2) % 2];

    const x = fromX + (toX - fromX) * u + Math.sin(time * 0.019 + i * 2) * wob;
    const y = HAND_Y - arcH * Math.sin(Math.PI * u) + Math.cos(time * 0.023 + i) * wob * 0.6;
    const col = p.balls[i % p.balls.length];

    // The ball about to land is the one the player must react to, so it gets a
    // ring that tightens as it arrives.
    if (u > 0.72 && liveRound()) {
      const tight = (u - 0.72) / 0.28;
      k.lineStyle(2, p.trickHot ? p.skin.mark : COL.accent, 0.25 + tight * 0.55);
      k.strokeCircle(x, y, 9 + (1 - tight) * 13);
    }

    if (p.show > 25) {
      k.fillStyle(col, 0.16 * (p.show / 100));
      k.fillCircle(x, y + 9, 9);
      k.fillCircle(x, y + 18, 7);
    }
    k.fillStyle(col, 1);
    k.fillCircle(x, y, 9);
    k.fillStyle(0xffffff, 0.45);
    k.fillCircle(x - 3, y - 3, 3);
  }
}

function drawParticles(k) {
  for (const p of S.parts) {
    k.fillStyle(p.color, Math.max(0, p.life / p.max));
    k.fillCircle(p.x, p.y, p.r);
  }
}

function drawFloats() {
  for (const f of S.floats) {
    const a = Math.max(0, f.life / f.max);
    txt(f.x, f.y, f.text, 15, f.color, 0.5, 0.5, 1, 8).setAlpha(a);
  }
}

// --- HUD ------------------------------------------------------------------
function drawTrafficLight(k, time) {
  const bx = S.vs ? W / 2 - 32 : W - 92;
  const by = 14;
  k.fillStyle(0x0a0910, 0.9);
  k.fillRoundedRect(bx - 4, by - 4, 72, 168, 10);
  k.fillStyle(0x2b2838, 1);
  k.fillRoundedRect(bx, by, 64, 160, 8);
  k.fillStyle(0x171525, 1);
  k.fillRoundedRect(bx + 4, by + 4, 56, 152, 6);

  const lamps = [
    { c: COL.danger, on: S.light === 'red', y: by + 30 },
    { c: 0xffb43d, on: S.light === 'yellow', y: by + 80 },
    { c: 0x3ddc6b, on: S.light === 'green', y: by + 130 },
  ];
  for (const l of lamps) {
    if (l.on) {
      const pulse = S.light === 'yellow' ? 0.5 + 0.5 * Math.sin(time * 0.02) : 1;
      k.fillStyle(l.c, 0.20 * pulse);
      k.fillCircle(bx + 32, l.y, 30);
      k.fillStyle(l.c, pulse);
    } else {
      k.fillStyle(l.c, 0.13);
    }
    k.fillCircle(bx + 32, l.y, 20);
  }

  // The countdown lives inside the lit lamp: the light IS the clock.
  const secs = Math.max(0, Math.ceil(S.lightT / 1000));
  const lit = lamps.find((l) => l.on);
  if (lit && liveRound()) {
    txt(bx + 32, lit.y, String(secs), secs < 10 ? 26 : 20, 0x141020, 0.5, 0.5, 0, 13);
  }
}

function drawShowMeter(k, time, p) {
  const w = S.vs ? 214 : 236;
  const right = p.i === 1;
  const x = right ? W - 22 - w : 22;
  const y = 84;
  const h = 18;
  k.fillStyle(0x0a0910, 0.75);
  k.fillRoundedRect(x - 4, y - 4, w + 8, h + 8, 5);
  k.fillStyle(0x2a2638, 1);
  k.fillRoundedRect(x, y, w, h, 4);
  const fill = (p.show / 100) * w;
  if (fill > 2) {
    const hot = p.show > 70;
    k.fillStyle(hot ? p.skin.mark : COL.show, 1);
    k.fillRoundedRect(x, y, fill, h, 4);
    if (hot) {
      k.fillStyle(0xffffff, 0.2 + 0.2 * Math.sin(time * 0.014));
      k.fillRoundedRect(x, y, fill, h, 4);
    }
  }
  // Notches show exactly which kind of car each show level unlocks.
  for (const t of CAR_TYPES) {
    const nx = x + (t.need / 100) * w;
    k.fillStyle(p.show >= t.need ? 0x141020 : COL.paper, p.show >= t.need ? 0.55 : 0.45);
    k.fillRect(nx, y - 3, 2, h + 6);
  }
  // The floreo threshold is the one mark the player checks before gambling.
  if (p.show >= TRICK_MIN_SHOW) {
    k.fillStyle(p.skin.mark, 0.5 + 0.3 * Math.sin(time * 0.008));
    k.fillRect(x + (TRICK_MIN_SHOW / 100) * w - 1, y - 6, 3, h + 12);
  }
  const label = S.vs ? p.skin.tag + ' SHOW' : 'SHOW';
  txt(right ? x + w : x, y - 12, label, 12, S.vs ? p.skin.mark : COL.dim, right ? 1 : 0, 0.5, 0, 13);
  if (p.combo > 2) {
    const cx = right ? x - 12 : x + w + 12;
    txt(cx, y + h / 2, 'x' + p.combo, p.combo > 20 ? 22 : 17, p.combo > 20 ? COL.accent : COL.paper, right ? 1 : 0, 0.5, 0, 13);
  }
}

function drawBeatBar(k, time) {
  const cx = W / 2;
  const look = 780;
  const span = 300;

  k.fillStyle(0x0a0910, 0.72);
  k.fillRoundedRect(cx - span - 40, BEAT_Y - 26, (span + 40) * 2, 52, 10);

  // Rail.
  k.fillStyle(0x35304a, 1);
  k.fillRect(cx - span, BEAT_Y - 1, span * 2, 3);

  // Target: catch the ball when a marker sits inside these brackets.
  // The target lights up for whoever just hit it.
  let hitGlow = 0;
  for (const pl of S.players) {
    if (pl.judgeT > 0 && pl.judge !== 'UY') hitGlow = Math.max(hitGlow, pl.judgeT / 0.7);
  }
  k.fillStyle(COL.accent, 0.18 + hitGlow * 0.5);
  k.fillRoundedRect(cx - 20, BEAT_Y - 20, 40, 40, 7);
  k.lineStyle(3, COL.accent, 0.9);
  k.strokeRoundedRect(cx - 20, BEAT_Y - 20, 40, 40, 7);

  if (!liveRound()) return;

  let frozen = true;
  let consumedAll = true;
  let tricking = false;
  for (const p of S.players) {
    if (p.dropT <= 0 && p.stunT <= 0) frozen = false;
    if (!p.beatDone) consumedAll = false;
    if (p.trickEnd >= 0) tricking = true;
  }

  for (let i = -1; i < 5; i++) {
    const t = S.nextBeat + i * S.beatMs;
    const dtn = t - time;
    if (dtn > look || dtn < -240) continue;
    const px = cx + (dtn / look) * span;
    const near = Math.max(0, 1 - Math.abs(dtn) / look);
    const consumed = i === 0 && consumedAll;
    const a = frozen ? 0.2 : consumed ? 0.25 : 0.35 + near * 0.65;
    k.fillStyle(consumed ? COL.dim : COL.paper, a);
    k.fillCircle(px, BEAT_Y, 6 + near * 5);
  }

  // Mid-floreo the rail is not asking you for anything, and it should look it.
  if (tricking) {
    k.fillStyle(0x08070f, 0.45);
    k.fillRoundedRect(cx - span - 40, BEAT_Y - 26, (span + 40) * 2, 52, 10);
  }

  for (const p of S.players) {
    if (p.judgeT <= 0) continue;
    const a = Math.min(1, p.judgeT / 0.35);
    const col = p.judge === 'PERFECTO' ? p.skin.mark : p.judge === 'BIEN' ? COL.paper : COL.danger;
    const jx = S.vs ? cx + (p.i === 0 ? -150 : 150) : cx;
    txt(jx, BEAT_Y - 46, p.judge, p.judge === 'PERFECTO' ? 22 : 18, col, 0.5, 0.5, 0, 13).setAlpha(a);
  }

  txt(cx - span - 30, BEAT_Y, 'BOTON 1', 11, COL.dim, 0, 0.5, 0, 13);
}

function drawHud(scene, time) {
  const k = g.hud;
  k.clear();

  const showHud = S.mode === 'play' || S.mode === 'pause' || S.mode === 'tally' || S.mode === 'result';

  if (showHud) {
    if (S.vs) {
      // Two takes, two corners of the screen, nothing in the middle but the
      // clock both of them are racing.
      for (const p of S.players) {
        const right = p.i === 1;
        const bx = right ? W - 246 : 14;
        k.fillStyle(0x0a0910, 0.72);
        k.fillRoundedRect(bx, 12, 232, 60, 10);
        k.fillStyle(p.skin.mark, 0.9);
        k.fillRect(right ? bx + 226 : bx, 12, 6, 60);
        txt(right ? bx + 216 : bx + 12, 30, money(p.cash), 24, COL.cash, right ? 1 : 0, 0.5, 0, 13);
        txt(right ? bx + 216 : bx + 12, 56, p.skin.tag, 13, p.skin.mark, right ? 1 : 0, 0.5, 0, 13);
      }
      txt(W / 2, 190, 'SEMAFORO ' + S.round + '/' + VS_ROUNDS, 13, COL.dim, 0.5, 0.5, 0, 13);
    } else {
      const p = P1P();
      k.fillStyle(0x0a0910, 0.72);
      k.fillRoundedRect(14, 12, 260, 60, 10);
      txt(24, 26, money(p.cash), 26, COL.cash, 0, 0.5, 0, 13);
      txt(24, 54, 'SEMAFORO ' + S.round, 13, COL.dim, 0, 0.5, 0, 13);

      // Lives, drawn as spare hats.
      for (let i = 0; i < 3; i++) {
        const on = i < S.lives;
        k.fillStyle(on ? COL.shirt : 0x3a3446, 1);
        k.fillRoundedRect(196 + i * 26, 46, 20, 5, 2);
        k.fillRoundedRect(200 + i * 26, 38, 12, 9, 4);
      }
    }

    drawTrafficLight(k, time);
    for (const p of S.players) drawShowMeter(k, time, p);
    drawBeatBar(k, time);

    for (const p of S.players) {
      // Prompt when a window is within reach.
      const car = nearestOpenCar(p);
      if (car && p.collectT <= 0 && p.dropT <= 0 && p.stunT <= 0) {
        const sx = car.x - S.camX;
        txt(sx, CAR_BASE - car.type.h - 46, 'BOTON 2  ' + money(car.tip), 14, S.vs ? p.skin.mark : COL.accent, 0.5, 0.5, 0, 13);
      }
      // Warning to run once the light goes amber.
      if (S.light === 'yellow' && !inSafeZone(p.px)) {
        const arrow = Math.abs(p.px - SL) < Math.abs(p.px - SR) ? '<<<<' : '>>>>';
        const a = 0.55 + 0.45 * Math.sin(time * 0.02);
        const wy = S.vs ? 216 + p.i * 28 : 176;
        txt(W / 2, wy, arrow + (S.vs ? '  ' + p.skin.tag + ' A LA ESQUINA  ' : '  A LA ESQUINA  ') + arrow, S.vs ? 20 : 26, S.vs ? p.skin.mark : COL.warn, 0.5, 0.5, 0, 13).setAlpha(a);
      }
      if (!S.vs && p.dropT > 0) txt(W / 2, 176, 'RECOGIENDO...', 22, COL.danger, 0.5, 0.5, 0, 13);
      if (!S.vs && p.stunT > 0 && S.light !== 'green') txt(W / 2, 176, 'iLEVANTATE!', 22, COL.danger, 0.5, 0.5, 0, 13);
    }

    // The event announces itself at the top of the light and then gets out.
    if (S.eventT > 0 && S.event) {
      const ev = EVENTS[S.event];
      const a = Math.min(1, S.eventT / 0.8);
      txt(W / 2, 232, ev.name, 34, COL.warn, 0.5, 0.5, 0, 13).setAlpha(a);
      txt(W / 2, 264, ev.desc, 15, COL.paper, 0.5, 0.5, 0, 13).setAlpha(a);
    }
  }

  if (S.spec.rain && liveRound()) drawRain(k, time);

  if (S.flash > 0) {
    k.fillStyle(S.flashCol, S.flash * 0.4);
    k.fillRect(0, 0, W, H);
  }
}

function drawRain(k, time) {
  k.lineStyle(1, 0x9fd4ff, 0.28);
  for (const d of S.rainDrops) {
    d.y += d.v * 0.016;
    d.x -= 34 * 0.016;
    if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 200); }
    if (d.x < -40) d.x = W + 40;
    k.lineBetween(d.x, d.y, d.x - 4, d.y + d.l);
  }
}

// --- Panels ---------------------------------------------------------------
function panel(k, x, y, w, h, alpha) {
  k.fillStyle(0x08070f, alpha === undefined ? 0.9 : alpha);
  k.fillRoundedRect(x, y, w, h, 12);
  k.lineStyle(3, COL.accent, 0.75);
  k.strokeRoundedRect(x, y, w, h, 12);
}

function drawTitle(k, time) {
  // Colombian flag bar behind the title.
  const bars = [COL.ballA, COL.ballB, COL.ballC];
  for (let i = 0; i < 3; i++) {
    k.fillStyle(bars[i], 0.9);
    k.fillRect(W / 2 - 210, 66 + i * 9, 420, 8);
  }
  txt(W / 2, 122, 'EL REBUSQUE', 58, COL.accent, 0.5, 0.5, 0, 13);
  txt(W / 2, 162, 'malabares en el semaforo de la 26', 15, COL.paper, 0.5, 0.5, 0, 13);
}

function drawOverlay(scene, time) {
  const k = g.hud;

  if (S.mode === 'menu') {
    // Only a light veil: there is a real round being played underneath and it
    // is the best argument the cabinet has.
    k.fillStyle(0x08070f, 0.38);
    k.fillRect(0, 0, W, H);
    k.fillStyle(0x08070f, 0.55);
    k.fillRect(0, 0, W, 200);
    drawTitle(k, time);
    txt(W - 18, 26, 'DEMO', 13, COL.dim, 1, 0.5, 0, 13);

    panel(k, W / 2 - 236, 388, 472, 184);
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const on = i === S.menuIdx;
      const y = 416 + i * 33;
      if (on) {
        k.fillStyle(COL.accent, 0.16);
        k.fillRoundedRect(W / 2 - 216, y - 14, 432, 28, 6);
      }
      txt(W / 2, y, (on ? '> ' : '  ') + MENU_ITEMS[i] + (on ? ' <' : '  '), on ? 19 : 16, on ? COL.accent : COL.dim, 0.5, 0.5, 0, 13);
    }
    txt(W / 2, 556, 'JOYSTICK elige  ·  BOTON 1 entra  ·  START2 entra de una a dos', 12, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'pause') {
    k.fillStyle(0x08070f, 0.8);
    k.fillRect(0, 0, W, H);
    panel(k, W / 2 - 220, 190, 440, 220);
    txt(W / 2, 234, 'EN PAUSA', 30, COL.accent, 0.5, 0.5, 0, 13);
    for (let i = 0; i < PAUSE_ITEMS.length; i++) {
      const on = i === S.pauseIdx;
      const y = 292 + i * 44;
      if (on) {
        k.fillStyle(COL.accent, 0.16);
        k.fillRoundedRect(W / 2 - 190, y - 18, 380, 36, 6);
      }
      txt(W / 2, y, (on ? '> ' : '  ') + PAUSE_ITEMS[i] + (on ? ' <' : '  '), on ? 20 : 17, on ? COL.accent : COL.dim, 0.5, 0.5, 0, 13);
    }
    txt(W / 2, 388, 'START tambien sigue', 12, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'result') {
    const a = S.players[0];
    const b = S.players[1];
    const win = a.cash === b.cash ? null : (a.cash > b.cash ? a : b);
    k.fillStyle(0x08070f, 0.88);
    k.fillRect(0, 0, W, H);
    panel(k, W / 2 - 280, 110, 560, 360);
    txt(W / 2, 158, win ? 'GANA ' + win.skin.tag : 'EMPATE', 40, win ? win.skin.mark : COL.paper, 0.5, 0.5, 0, 13);
    txt(W / 2, 196, 'tres semaforos, una sola via', 14, COL.dim, 0.5, 0.5, 0, 13);
    for (const pl of S.players) {
      const cx = W / 2 + (pl.i === 0 ? -130 : 130);
      const won = win === pl;
      k.fillStyle(pl.skin.mark, won ? 0.18 : 0.07);
      k.fillRoundedRect(cx - 116, 226, 232, 168, 10);
      k.lineStyle(won ? 3 : 1, pl.skin.mark, won ? 1 : 0.4);
      k.strokeRoundedRect(cx - 116, 226, 232, 168, 10);
      txt(cx, 254, pl.skin.tag, 20, pl.skin.mark, 0.5, 0.5, 0, 13);
      txt(cx, 296, money(pl.cash), 28, COL.cash, 0.5, 0.5, 0, 13);
      txt(cx, 334, 'mejor combo x' + pl.bestCombo, 13, COL.paper, 0.5, 0.5, 0, 13);
      txt(cx, 358, pl.totalPerfect + ' perfectos', 13, COL.dim, 0.5, 0.5, 0, 13);
    }
    if (S.overT > 1) txt(W / 2, 436, 'BOTON 1 para volver', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'howto') {
    k.fillStyle(0x08070f, 0.88);
    k.fillRect(0, 0, W, H);
    panel(k, 60, 40, W - 120, H - 110);
    txt(W / 2, 76, 'COMO SE JUEGA', 30, COL.accent, 0.5, 0.5, 0, 13);
    const lines = [
      ['BOTON 1', 'Atajar. Presione justo cuando la bola llega a la marca.'],
      ['JOYSTICK', 'Camine por la avenida entre los carros parados.'],
      ['BOTON 2', 'Cobrar. Solo funciona si el vidrio ya esta abajo.'],
      ['BOTON 3', 'Floreo: las tira alto y le quedan 3 tiempos con las manos'],
      ['', 'libres. Pero le toca atajarlas todas en un solo tiempo.'],
      ['EL SHOW', 'Atajar bien lo sube. Mientras mas alto, mas vidrios bajan.'],
      ['LA TRAMPA', 'Cobrar le ocupa la mano: ese tiempo lo pierde.'],
      ['', 'Aprenda a cobrar en el contratiempo, o floree para alcanzar.'],
      ['LA PACIENCIA', 'El vidrio abierto se vuelve a subir si usted se demora.'],
      ['EL VERDE', 'Al cambiar el semaforo tiene que estar en una esquina.'],
      ['DOS', 'START2 arranca el reto: tres semaforos, la misma via, y'],
      ['', 'el que cobre primero se lleva la moneda.'],
    ];
    let y = 118;
    for (const [a, b] of lines) {
      if (a) txt(92, y, a, 14, COL.accent, 0, 0.5, 0, 13);
      if (b) txt(218, y, b, 13, COL.paper, 0, 0.5, 0, 13);
      y += 30;
    }
    txt(W / 2, H - 46, 'BOTON 1 para volver', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'scores') {
    k.fillStyle(0x08070f, 0.88);
    k.fillRect(0, 0, W, H);
    panel(k, 130, 60, W - 260, H - 150);
    txt(W / 2, 100, 'LOS MAS BERRACOS', 30, COL.accent, 0.5, 0.5, 0, 13);
    if (!S.scores.length) {
      txt(W / 2, 240, 'todavia nadie se ha rebuscado nada', 16, COL.dim, 0.5, 0.5, 0, 13);
    } else {
      let y = 158;
      for (let i = 0; i < S.scores.length; i++) {
        const s = S.scores[i];
        const c = i === 0 ? COL.accent : COL.paper;
        txt(180, y, String(i + 1).padStart(2, '0'), 18, COL.dim, 0, 0.5, 0, 13);
        txt(228, y, s.name, 20, c, 0, 0.5, 0, 13);
        txt(W - 180, y, money(s.score), 20, COL.cash, 1, 0.5, 0, 13);
        txt(W - 180, y + 19, 'semaforo ' + s.round + '  ·  combo x' + (s.combo || 0), 11, COL.dim, 1, 0.5, 0, 13);
        y += 52;
      }
    }
    txt(W / 2, H - 62, 'BOTON 1 para volver', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'tally') {
    k.fillStyle(0x08070f, 0.72);
    k.fillRect(0, 0, W, H);
    panel(k, W / 2 - 230, 150, 460, 260);
    txt(W / 2, 190, 'SE PUSO EN VERDE', 26, COL.accent, 0.5, 0.5, 0, 13);
    txt(W / 2, 222, 'lo del semaforo ' + S.round, 14, COL.dim, 0.5, 0.5, 0, 13);
    if (S.vs) {
      for (const pl of S.players) {
        const cx = W / 2 + (pl.i === 0 ? -108 : 108);
        txt(cx, 258, pl.skin.tag, 16, pl.skin.mark, 0.5, 0.5, 0, 13);
        txt(cx, 292, money(pl.roundCash), 26, COL.cash, 0.5, 0.5, 0, 13);
        txt(cx, 324, 'total ' + money(pl.cash), 13, COL.paper, 0.5, 0.5, 0, 13);
        txt(cx, 348, 'combo x' + pl.bestCombo, 12, COL.dim, 0.5, 0.5, 0, 13);
      }
    } else {
      const pl = P1P();
      txt(W / 2, 276, money(pl.roundCash), 40, COL.cash, 0.5, 0.5, 0, 13);
      txt(W / 2, 320, 'mejor combo  x' + pl.bestCombo, 15, COL.paper, 0.5, 0.5, 0, 13);
      txt(W / 2, 348, 'vidas  ' + S.lives, 15, S.lives > 1 ? COL.paper : COL.danger, 0.5, 0.5, 0, 13);
    }
    if (S.tallyT > 0.6) txt(W / 2, 386, 'BOTON 1 para seguir', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'shop') {
    k.fillStyle(0x08070f, 0.82);
    k.fillRect(0, 0, W, H);
    txt(W / 2, 96, 'ANTES DE QUE SE PONGA EN ROJO', 24, COL.accent, 0.5, 0.5, 0, 13);
    txt(W / 2, 128, 'lo que gaste sale de lo que lleva', 14, COL.dim, 0.5, 0.5, 0, 13);
    txt(W / 2, 162, money(P1P().cash), 30, COL.cash, 0.5, 0.5, 0, 13);

    const n = S.shopOffer.length;
    const cw = 176;
    const gap = 14;
    const totalW = n * cw + (n - 1) * gap;
    let x = W / 2 - totalW / 2;
    for (let i = 0; i < n; i++) {
      const key = S.shopOffer[i];
      const on = i === S.shopIdx;
      const isGo = key === 'seguir';
      const cost = isGo ? 0 : upgradeCost(key);
      const afford = isGo || P1P().cash >= cost;
      k.fillStyle(0x100e1c, 0.95);
      k.fillRoundedRect(x, 210, cw, 190, 10);
      k.lineStyle(on ? 4 : 2, on ? COL.accent : 0x3a3450, 1);
      k.strokeRoundedRect(x, 210, cw, 190, 10);
      const cx = x + cw / 2;
      if (isGo) {
        txt(cx, 268, 'SEGUIR', 22, COL.cash, 0.5, 0.5, 0, 13);
        txt(cx, 306, 'al siguiente', 13, COL.dim, 0.5, 0.5, 0, 13);
        txt(cx, 326, 'semaforo', 13, COL.dim, 0.5, 0.5, 0, 13);
      } else {
        const u = UPGRADES[key];
        txt(cx, 244, u.name, 17, afford ? COL.paper : 0x615a75, 0.5, 0.5, 0, 13);
        txt(cx, 272, 'nivel ' + P1P().upg[key] + '/' + u.max, 12, COL.dim, 0.5, 0.5, 0, 13);
        wrapText(cx, 306, u.desc, 12, COL.dim, cw - 22);
        txt(cx, 372, money(cost), 18, afford ? COL.cash : COL.danger, 0.5, 0.5, 0, 13);
      }
      x += cw + gap;
    }
    txt(W / 2, 436, 'JOYSTICK izq/der  ·  BOTON 1 para elegir', 13, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'over') {
    k.fillStyle(0x08070f, 0.86);
    k.fillRect(0, 0, W, H);
    panel(k, W / 2 - 240, 140, 480, 300);
    txt(W / 2, 186, 'SE ACABO EL REBUSQUE', 28, COL.danger, 0.5, 0.5, 0, 13);
    txt(W / 2, 232, 'aguanto hasta el semaforo ' + S.round, 15, COL.dim, 0.5, 0.5, 0, 13);
    txt(W / 2, 292, money(P1P().cash), 46, COL.cash, 0.5, 0.5, 0, 13);
    txt(W / 2, 340, 'mejor combo  x' + P1P().bestCombo + '   ·   ' + P1P().totalPerfect + ' perfectos', 14, COL.paper, 0.5, 0.5, 0, 13);
    if (S.overT > 0.8) txt(W / 2, 402, 'BOTON 1 para continuar', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'name') {
    k.fillStyle(0x08070f, 0.9);
    k.fillRect(0, 0, W, H);
    panel(k, W / 2 - 230, 150, 460, 270);
    txt(W / 2, 196, 'QUEDO EN LA TABLA', 26, COL.accent, 0.5, 0.5, 0, 13);
    txt(W / 2, 228, money(P1P().cash), 22, COL.cash, 0.5, 0.5, 0, 13);
    for (let i = 0; i < NAME_LEN; i++) {
      const cx = W / 2 - 70 + i * 70;
      const on = i === S.nameIdx;
      k.fillStyle(on ? COL.accent : 0x2a2638, on ? 0.2 : 1);
      k.fillRoundedRect(cx - 28, 272, 56, 66, 8);
      if (on) {
        k.lineStyle(3, COL.accent, 1);
        k.strokeRoundedRect(cx - 28, 272, 56, 66, 8);
      }
      txt(cx, 305, NAME_ALPHABET[S.nameChars[i]], 36, on ? COL.accent : COL.paper, 0.5, 0.5, 0, 13);
    }
    txt(W / 2, 372, 'JOYSTICK arriba/abajo cambia letra', 13, COL.dim, 0.5, 0.5, 0, 13);
    txt(W / 2, 394, 'BOTON 1 confirma', 13, COL.dim, 0.5, 0.5, 0, 13);
  }
}

// Naive word wrap for the two-line upgrade blurbs.
function wrapText(cx, y, str, size, color, maxW) {
  const perChar = size * 0.62;
  const maxChars = Math.max(6, Math.floor(maxW / perChar));
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  for (let i = 0; i < lines.length; i++) txt(cx, y + i * (size + 4), lines[i], size, color, 0.5, 0.5, 0, 13);
}

// --- Frame ----------------------------------------------------------------
function render(scene, time, dt) {
  if (!BG) buildBackground();
  beginText(scene);

  drawSky(time);
  drawCerros();
  drawBlocks(time);
  drawRoad(time);

  const k = g.world;
  drawStreet(k, time);
  for (const c of S.cars) drawCar(k, c, time);
  for (const m of S.motos) drawMoto(k, m, time);

  const f = g.front;
  f.clear();
  for (const pl of S.players) {
    drawJuggler(f, time, pl);
    drawBalls(f, time, pl);
  }
  drawParticles(f);
  drawFloats();

  drawHud(scene, time);
  drawOverlay(scene, time);
  endText();

  // Camera, with shake folded in.
  const sx = S.shake > 0 ? (Math.random() - 0.5) * S.shake * 24 : 0;
  const sy = S.shake > 0 ? (Math.random() - 0.5) * S.shake * 18 : 0;
  scene.cameras.main.setScroll(S.camX + sx, sy);

  const lead = S.players[0];
  if (liveRound() && S.light === 'red' && lead && lead.dropT <= 0 && lead.stunT <= 0) {
    pumpMusic(time, S.beatMs);
  }
}
