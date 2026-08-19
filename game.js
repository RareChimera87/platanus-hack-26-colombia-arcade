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

const BALL_COLORS = [COL.ballA, COL.ballB, COL.ballC, 0xf6f0e2, 0xff8ad4, 0x5ce1e6, 0x9dff5c];

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

// Difficulty curve. The red light never changes length — the street around it
// does. More balls, faster cascade, richer but pickier cars, then motorbikes.
function roundSpec(r) {
  return {
    balls: Math.min(7, 3 + Math.floor((r - 1) / 2)),
    beatMs: Math.max(230, 540 - (r - 1) * 26),
    motos: r < 3 ? 0 : Math.min(4, 1 + Math.floor((r - 3) / 2)),
    rain: r >= 5,
    tipMul: 1 + (r - 1) * 0.18,
    carCount: Math.min(11, 7 + Math.floor(r / 2)),
    // Late rounds bias toward cars that only open for a very good show.
    rich: Math.min(0.75, 0.15 + (r - 1) * 0.1),
  };
}

function buildCars(spec, rng) {
  const cars = [];
  const span = SAFE_R - SAFE_L - 120;
  const slot = span / spec.carCount;
  for (let i = 0; i < spec.carCount; i++) {
    const wantRich = rng() < spec.rich;
    const pool = wantRich ? CAR_TYPES.slice(2) : CAR_TYPES.slice(0, 3);
    const type = pool[Math.floor(rng() * pool.length)];
    const x = SAFE_L + 60 + slot * i + slot * 0.5;
    cars.push({
      type,
      x,
      tip: Math.round(type.tip * spec.tipMul),
      open: false,
      openAmt: 0,       // animated 0..1
      given: false,
      bob: rng() * 6.28,
      plate: 1 + Math.floor(rng() * 899),
    });
  }
  return cars;
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

// --- Game state -----------------------------------------------------------
const S = {
  mode: 'boot',          // boot | menu | howto | scores | play | tally | shop | over | name
  scores: [],
  scoresLoaded: false,

  round: 1,
  lives: 3,
  cash: 0,
  roundCash: 0,
  bestCombo: 0,
  totalPerfect: 0,
  spec: roundSpec(1),

  light: 'red',
  lightT: RED_MS,

  beatMs: 540,
  nextBeat: 0,
  beatNum: 0,
  judge: '',
  judgeT: 0,
  beatDone: false,
  show: 0,
  combo: 0,
  missStreak: 0,

  nBalls: 3,
  cascadeT: 0,
  wobble: 0,
  dropT: 0,

  px: WORLD_W / 2,
  pvx: 0,
  face: 1,
  walkT: 0,
  collectT: 0,
  stunT: 0,
  armT: 0,

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
  upg: { shoes: 0, hat: 0, guante: 0 },
  tallyT: 0,
  overT: 0,
  collectDir: 1,
};

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

  // Idle street running behind the menu.
  resetRun();
  S.mode = 'menu';
  S.camX = WORLD_W / 2 - W / 2;
}

function resetRun() {
  S.round = 1;
  S.lives = 3;
  S.cash = 0;
  S.bestCombo = 0;
  S.totalPerfect = 0;
  S.upg = { shoes: 0, hat: 0, guante: 0 };
  startRound(1);
}

function startRound(r) {
  const spec = roundSpec(r);
  S.round = r;
  S.spec = spec;
  S.light = 'red';
  S.lightT = RED_MS;
  S.beatMs = spec.beatMs;
  S.nextBeat = 0;             // set on first update tick
  S.beatNum = 0;
  S.show = 0;
  S.combo = 0;
  S.missStreak = 0;
  S.nBalls = spec.balls;
  S.cascadeT = 0;
  S.wobble = 0;
  S.dropT = 0;
  S.roundCash = 0;
  S.px = WORLD_W / 2;
  S.pvx = 0;
  S.collectT = 0;
  S.stunT = 0;
  S.armT = 0;
  S.cars = buildCars(spec, makeRng(0x9e37 + r * 2654435761));
  S.motos = [];
  const rng = makeRng(0x51ed + r * 40503);
  for (let i = 0; i < spec.motos; i++) {
    S.motos.push({
      x: SAFE_L + rng() * (SAFE_R - SAFE_L),
      dir: rng() < 0.5 ? -1 : 1,
      speed: 130 + rng() * 90 + r * 6,
      hornT: 1200 + rng() * 2600,
      color: [0xff5c3d, 0x4ad2ff, 0xe8e845][Math.floor(rng() * 3)],
    });
  }
  S.parts = [];
  S.floats = [];
}

function playerSpeed() {
  return 236 + S.upg.shoes * 46;
}

function inSafeZone(x) {
  return x < SAFE_L || x > SAFE_R;
}

// --- Main loop ------------------------------------------------------------
function update(time, delta) {
  const dt = Math.min(48, delta) / 1000;
  const presses = takePresses();

  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 3.4);
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 5);

  switch (S.mode) {
    case 'menu': stepMenu(this, presses, dt, time); break;
    case 'howto': stepPanel(this, presses, 'menu'); break;
    case 'scores': stepPanel(this, presses, 'menu'); break;
    case 'play': stepPlay(this, presses, dt, time); break;
    case 'tally': stepTally(this, presses, dt); break;
    case 'shop': stepShop(this, presses, dt); break;
    case 'over': stepOver(this, presses, dt); break;
    case 'name': stepName(this, presses, dt); break;
  }

  updateParticles(dt);
  render(this, time, dt);
}

// --- Rhythm judging -------------------------------------------------------
const W_PERFECT = 58;    // ms
const W_GOOD = 132;

function collectDur() {
  return Math.max(0.13, 0.34 - S.upg.guante * 0.07);
}

function collectRange() {
  return 88 + S.upg.hat * 34;
}

function registerJudge(kind, time) {
  S.judge = kind;
  S.judgeT = 0.7;
  if (kind === 'PERFECTO') {
    S.show = Math.min(100, S.show + 3.2);
    S.combo++;
    S.totalPerfect++;
    SFX.perfect();
    S.missStreak = 0;
  } else if (kind === 'BIEN') {
    S.show = Math.min(100, S.show + 1.4);
    S.combo++;
    SFX.good();
    S.missStreak = 0;
  } else {
    S.show = Math.max(0, S.show - 14);
    S.combo = 0;
    S.missStreak++;
    S.wobble = Math.min(1, S.wobble + 0.45);
    SFX.miss();
    // Three fumbles in a row and the balls hit the asphalt. Picking them back
    // up costs time, and time is the only currency the red light gives you.
    if (S.missStreak >= 3) {
      S.missStreak = 0;
      S.dropT = 1.0;
      S.show = 0;
      S.wobble = 0;
      SFX.drop();
      S.shake = 0.6;
      addFloat(S.px, HAND_Y - 40, 'SE CAYERON', COL.danger);
      for (let i = 0; i < S.nBalls; i++) {
        burst(S.px + (Math.random() - 0.5) * 40, HAND_Y, BALL_COLORS[i % BALL_COLORS.length], 6);
      }
    }
  }
  if (S.combo > S.bestCombo) S.bestCombo = S.combo;
}

function stepRhythm(time, dt) {
  // The cascade freezes while the juggler is on the ground or mid-reach: no
  // beat should be judged when there is nothing in the air to catch.
  if (S.dropT > 0 || S.stunT > 0) {
    S.nextBeat += dt * 1000;
    return;
  }

  let guard = 0;
  while (time > S.nextBeat + W_GOOD && guard++ < 8) {
    if (!S.beatDone) registerJudge('UY', time);
    S.nextBeat += S.beatMs;
    S.beatDone = false;
    S.beatNum++;
  }
}

function tryCatch(at) {
  if (S.dropT > 0 || S.stunT > 0) return;
  // Reaching into a car window ties up the hand: the beat is simply gone.
  if (S.collectT > 0) return;
  if (S.beatDone) return;

  const d = at - S.nextBeat;
  if (d < -W_GOOD) {
    // Way too early — a flustered grab. Costs show but does not eat the beat.
    S.show = Math.max(0, S.show - 4);
    S.wobble = Math.min(1, S.wobble + 0.2);
    SFX.miss();
    return;
  }
  S.beatDone = true;
  const ad = Math.abs(d);
  if (ad <= W_PERFECT) registerJudge('PERFECTO', at);
  else registerJudge('BIEN', at);
}

// --- Collecting -----------------------------------------------------------
function nearestOpenCar() {
  let best = null;
  let bestD = collectRange();
  for (const c of S.cars) {
    if (c.given || c.openAmt < 0.55) continue;
    const d = Math.abs(c.x - S.px);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function tryCollect() {
  if (S.dropT > 0 || S.stunT > 0 || S.collectT > 0) return;
  const car = nearestOpenCar();
  if (!car) return;
  car.given = true;
  S.collectDir = Math.sign(car.x - S.px) || S.face;
  S.collectT = collectDur();
  const amount = Math.round(car.tip * (1 + S.combo * 0.015));
  S.roundCash += amount;
  S.cash += amount;
  addFloat(car.x, CAR_BASE - car.type.h - 26, '+$' + amount.toLocaleString('es-CO'), COL.cash);
  burst(car.x, CAR_BASE - car.type.h - 10, COL.cash, 10);
  if (amount >= 4000) { SFX.bigcoin(); S.flash = 0.5; S.flashCol = 0x7de07d; }
  else SFX.coin(S.combo);
}

// --- Round flow -----------------------------------------------------------
function stepPlay(scene, presses, dt, time) {
  if (S.nextBeat === 0) {
    S.nextBeat = time + 1500;   // short lead-in so the first beat is fair
    S.beatDone = false;
  }

  // Light cycle. Red is always RED_MS — the street escalates, never the clock.
  S.lightT -= dt * 1000;
  if (S.lightT <= 0) {
    if (S.light === 'red') {
      S.light = 'yellow';
      S.lightT = YELLOW_MS;
      SFX.horn();
      addFloat(S.px, HAND_Y - 70, 'AMARILLO', COL.warn);
    } else if (S.light === 'yellow') {
      S.light = 'green';
      S.lightT = GREEN_MS;
      resolveGreen(scene);
    } else {
      finishRound();
      return;
    }
  }

  const frozen = S.dropT > 0 || S.stunT > 0;
  if (S.dropT > 0) S.dropT = Math.max(0, S.dropT - dt);
  if (S.stunT > 0) S.stunT = Math.max(0, S.stunT - dt);
  if (S.collectT > 0) S.collectT = Math.max(0, S.collectT - dt);
  if (S.armT > 0) S.armT = Math.max(0, S.armT - dt);
  if (S.judgeT > 0) S.judgeT = Math.max(0, S.judgeT - dt);
  S.wobble = Math.max(0, S.wobble - dt * 0.55);

  if (S.light === 'green') S.nextBeat += dt * 1000;
  else stepRhythm(time, dt);

  // Input
  for (const p of presses) {
    if (p.code === 'P1_1' || p.code === 'P2_1') tryCatch(p.at);
    if (p.code === 'P1_2' || p.code === 'P2_2') { tryCollect(); S.armT = 0.3; }
  }

  // Movement
  let dir = 0;
  if (held.P1_L || held.P2_L) dir -= 1;
  if (held.P1_R || held.P2_R) dir += 1;
  if (S.light === 'green') dir = 0;
  const spd = playerSpeed() * (frozen ? 0 : 1) * (S.collectT > 0 ? 0.35 : 1);
  S.pvx = dir * spd;
  S.px = Phaser.Math.Clamp(S.px + S.pvx * dt, 24, WORLD_W - 24);
  if (dir !== 0) {
    S.face = dir;
    const prev = S.walkT;
    S.walkT += dt * (frozen ? 0 : 9);
    if (Math.floor(prev / 3.14) !== Math.floor(S.walkT / 3.14)) SFX.step();
  }

  // Show decays: standing still is not a show.
  if (!frozen && S.light !== 'green') {
    S.show = Math.max(0, S.show - dt * 1.7);
    // The crowd tips passively while the show is hot.
    if (S.show > 40) {
      S.cash += (S.show - 40) * dt * 1.2 * S.spec.tipMul;
      S.roundCash += (S.show - 40) * dt * 1.2 * S.spec.tipMul;
    }
  }

  // Windows open and close with the quality of the show.
  for (let i = 0; i < S.cars.length; i++) {
    const c = S.cars[i];
    // On green the whole avenue pulls away and leaves you standing there.
    if (S.light === 'green') c.x += (210 + (i % 4) * 55) * dt * Math.min(1, (GREEN_MS / 1000 - S.lightT / 1000) * 2.2);
    const want = !c.given && S.show >= c.type.need && S.light !== 'green' ? 1 : 0;
    const before = c.openAmt;
    c.openAmt = Phaser.Math.Linear(c.openAmt, want, Math.min(1, dt * 7));
    if (before < 0.55 && c.openAmt >= 0.55) SFX.move();
    c.bob += dt * 1.6;
  }

  stepMotos(dt, time);
  updateCamera(scene, dt);
}

function stepMotos(dt, time) {
  for (const m of S.motos) {
    if (S.light === 'green') { m.x += m.dir * m.speed * 2.4 * dt; continue; }
    m.x += m.dir * m.speed * dt;
    if (m.x < SAFE_L - 40) { m.x = SAFE_L - 40; m.dir = 1; }
    if (m.x > SAFE_R + 40) { m.x = SAFE_R + 40; m.dir = -1; }
    m.hornT -= dt * 1000;
    if (m.hornT <= 0) { m.hornT = 2600 + Math.random() * 3200; if (Math.abs(m.x - S.px) < 340) SFX.horn(); }

    // A weaving motorbike knocks the whole cascade down, but never costs a
    // life: only the green light kills.
    if (S.stunT <= 0 && S.dropT <= 0 && Math.abs(m.x - S.px) < 24 && !inSafeZone(S.px)) {
      S.stunT = 1.15;
      S.show = 0;
      S.combo = 0;
      S.missStreak = 0;
      S.shake = 0.8;
      S.flash = 0.6;
      S.flashCol = 0xff3b30;
      SFX.hit();
      addFloat(S.px, HAND_Y - 50, 'iiiUY!', COL.danger);
      burst(S.px, HAND_Y, COL.danger, 14);
    }
  }
}

function resolveGreen(scene) {
  if (inSafeZone(S.px)) {
    addFloat(S.px, HAND_Y - 60, 'iSALVO!', COL.cash);
    SFX.cash();
    return;
  }
  // Caught on the avenue.
  S.lives--;
  S.stunT = 2.2;
  S.show = 0;
  S.combo = 0;
  S.shake = 1.2;
  S.flash = 1;
  S.flashCol = 0xff3b30;
  SFX.hit();
  addFloat(S.px, HAND_Y - 60, 'iTE COGIO EL VERDE!', COL.danger);
  burst(S.px, HAND_Y, COL.danger, 22);
}

function finishRound() {
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
  const target = Phaser.Math.Clamp(S.px - W / 2, 0, WORLD_W - W);
  S.camX = Phaser.Math.Linear(S.camX, target, Math.min(1, dt * 5.2));
  scene.cameras.main.setScroll(S.camX, 0);
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
const MENU_ITEMS = ['EMPEZAR EL REBUSQUE', 'COMO SE JUEGA', 'LOS MAS BERRACOS'];

function stepMenu(scene, presses, dt, time) {
  S.cascadeT += dt * 1.6;
  updateCamera(scene, dt);
  for (const c of S.cars) c.openAmt = Phaser.Math.Linear(c.openAmt, 0.8, dt * 2);

  if (pressedOnce(presses, 'P1_U', 'P2_U')) { S.menuIdx = (S.menuIdx + MENU_ITEMS.length - 1) % MENU_ITEMS.length; SFX.move(); }
  if (pressedOnce(presses, 'P1_D', 'P2_D')) { S.menuIdx = (S.menuIdx + 1) % MENU_ITEMS.length; SFX.move(); }

  if (pressedOnce(presses, 'P1_1', 'P2_1', 'START1', 'START2')) {
    SFX.select();
    if (S.menuIdx === 0) {
      resetRun();
      S.mode = 'play';
      S.nextBeat = 0;
      SFX.start();
    } else if (S.menuIdx === 1) {
      S.mode = 'howto';
    } else {
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

// --- Between lights -------------------------------------------------------
function stepTally(scene, presses, dt) {
  S.tallyT += dt;
  if (S.tallyT > 0.6 && pressedOnce(presses, 'P1_1', 'P1_2', 'P2_1', 'P2_2', 'START1', 'START2')) {
    SFX.select();
    S.mode = 'shop';
    S.shopIdx = 0;
  }
}

// Upgrades are paid for out of the money you just made, and that money is your
// score. Reinvest or keep it — that is the actual rebusque.
function upgradeCost(kind) {
  const owned = S.upg[kind];
  const base = kind === 'shoes' ? 9000 : kind === 'guante' ? 14000 : 11000;
  return Math.round(base * Math.pow(1.85, owned));
}

const UPGRADES = {
  shoes: { name: 'TENIS NUEVOS', desc: 'Caminas mas rapido por la avenida', max: 3 },
  guante: { name: 'GUANTES', desc: 'Cobras mas rapido, pierdes menos tiempos', max: 3 },
  hat: { name: 'SOMBRERO', desc: 'Alcanzas ventanas desde mas lejos', max: 3 },
};

function rollShopOffer() {
  S.shopOffer = Object.keys(UPGRADES).filter((k) => S.upg[k] < UPGRADES[k].max);
  S.shopOffer.push('seguir');
}

function stepShop(scene, presses, dt) {
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
    if (S.cash >= cost) {
      S.cash -= cost;
      S.upg[pick]++;
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
  if (S.overT > 0.8 && pressedOnce(presses, 'P1_1', 'P1_2', 'P2_1', 'P2_2', 'START1', 'START2')) {
    SFX.select();
    const score = Math.round(S.cash);
    const worthy = S.scores.length < MAX_SCORES || score > (S.scores[S.scores.length - 1] || { score: 0 }).score;
    if (worthy && score > 0) {
      S.mode = 'name';
      S.nameIdx = 0;
      S.nameChars = [0, 0, 0];
    } else {
      resetRun();
      S.mode = 'menu';
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
    const entry = {
      name,
      score: Math.round(S.cash),
      round: S.round,
      combo: S.bestCombo,
      savedAt: new Date().toISOString(),
    };
    saveScore(entry).then((list) => { S.scores = list; });
    S.scores = S.scores.concat(entry).sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
    resetRun();
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
  BG = { cerros, blocks, stars };
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
  drawCorner(k, 0, SAFE_L, time, 1);
  drawCorner(k, SAFE_R, WORLD_W, time, -1);

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

function drawCar(k, c, time) {
  const t = c.type;
  const bob = Math.sin(c.bob) * 1.2;
  const x = c.x - t.w / 2;
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
    txt(c.x, y - 12, t.says, 11, 0xf6f0e2, 0.5, 0.5, 1, 7);
  }
  if (c.given) {
    txt(c.x, y - 12, 'GRACIAS', 11, COL.cash, 0.5, 0.5, 1, 7);
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
function drawJuggler(k, time) {
  const x = S.px;
  const down = S.dropT > 0;
  const knocked = S.stunT > 0;
  const step = Math.sin(S.walkT);
  const moving = Math.abs(S.pvx) > 1;

  if (knocked) {
    // Flat on the asphalt.
    k.fillStyle(COL.pants, 1);
    k.fillRoundedRect(x - 30, FEET_Y - 14, 40, 12, 5);
    k.fillStyle(COL.shirt, 1);
    k.fillRoundedRect(x - 2, FEET_Y - 18, 34, 16, 6);
    k.fillStyle(COL.skin, 1);
    k.fillCircle(x + 38, FEET_Y - 14, 11);
    k.fillStyle(COL.hat, 1);
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
  k.fillStyle(COL.shirt, 1);
  k.fillRoundedRect(x - 13, bodyY, 26, 30, 7);
  k.fillStyle(COL.paper, 0.85);
  k.fillRect(x - 13, bodyY + 13, 26, 4);

  // Arms: reaching to a window, or up in the cascade.
  k.fillStyle(COL.skin, 1);
  if (S.collectT > 0) {
    const dir = S.collectDir;
    k.fillRoundedRect(x + (dir > 0 ? 8 : -30), bodyY + 4, 22, 8, 4);
    k.fillRoundedRect(x - 12 + (dir > 0 ? -8 : 12), bodyY + 2, 8, 18, 4);
  } else if (down) {
    k.fillRoundedRect(x - 20, bodyY + 20, 10, 18, 5);
    k.fillRoundedRect(x + 10, bodyY + 20, 10, 18, 5);
  } else {
    const reach = Math.sin(time * 0.004) * 3;
    k.fillRoundedRect(x - 22, bodyY - 8 + reach, 10, 24, 5);
    k.fillRoundedRect(x + 12, bodyY - 8 - reach, 10, 24, 5);
  }

  // Head and hat.
  k.fillStyle(COL.skin, 1);
  k.fillCircle(x, bodyY - 12, 12);
  k.fillStyle(COL.hat, 1);
  k.fillRoundedRect(x - 17, bodyY - 22, 34, 6, 3);
  k.fillRoundedRect(x - 11, bodyY - 32, 22, 12, 5);
  if (S.upg.hat > 0) {
    k.fillStyle(COL.accent, 1);
    k.fillRect(x - 17, bodyY - 23, 34, 3);
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
function beatClock(time) {
  if (S.mode === 'play') return S.beatNum - (S.nextBeat - time) / S.beatMs;
  return S.cascadeT;
}

function drawBalls(k, time) {
  const n = S.nBalls;
  const hands = [S.px - 17, S.px + 17];
  const arcH = (HAND_Y - ARC_TOP) * (0.55 + S.show / 220);

  if (S.dropT > 0 || S.stunT > 0) {
    for (let i = 0; i < n; i++) {
      const off = ((i * 61) % 100) / 100 - 0.5;
      k.fillStyle(BALL_COLORS[i % BALL_COLORS.length], 1);
      k.fillCircle(S.px + off * 90, FEET_Y - 4, 8);
      k.fillStyle(0x000000, 0.18);
      k.fillEllipse(S.px + off * 90, FEET_Y + 5, 18, 5);
    }
    return;
  }

  const bc = beatClock(time);
  const wob = S.wobble * 16;

  for (let i = 0; i < n; i++) {
    const land = i + n * Math.ceil((bc - i) / n);   // next beat this ball lands on
    const thrown = land - n;
    const u = Phaser.Math.Clamp((bc - thrown) / n, 0, 1);
    const fromX = hands[((thrown % 2) + 2) % 2];
    const toX = hands[((land % 2) + 2) % 2];

    const x = fromX + (toX - fromX) * u + Math.sin(time * 0.019 + i * 2) * wob;
    const y = HAND_Y - arcH * Math.sin(Math.PI * u) + Math.cos(time * 0.023 + i) * wob * 0.6;
    const col = BALL_COLORS[i % BALL_COLORS.length];

    // The ball about to land is the one the player must react to, so it gets a
    // ring that tightens as it arrives.
    if (u > 0.72 && S.mode === 'play') {
      const tight = (u - 0.72) / 0.28;
      k.lineStyle(2, COL.accent, 0.25 + tight * 0.55);
      k.strokeCircle(x, y, 9 + (1 - tight) * 13);
    }

    if (S.show > 25) {
      k.fillStyle(col, 0.16 * (S.show / 100));
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
  const bx = W - 92;
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
  if (lit && S.mode === 'play') {
    txt(bx + 32, lit.y, String(secs), secs < 10 ? 26 : 20, 0x141020, 0.5, 0.5, 0, 13);
  }
}

function drawShowMeter(k, time) {
  const x = 22;
  const y = 84;
  const w = 236;
  const h = 18;
  k.fillStyle(0x0a0910, 0.75);
  k.fillRoundedRect(x - 4, y - 4, w + 8, h + 8, 5);
  k.fillStyle(0x2a2638, 1);
  k.fillRoundedRect(x, y, w, h, 4);
  const fill = (S.show / 100) * w;
  if (fill > 2) {
    const hot = S.show > 70;
    k.fillStyle(hot ? COL.accent : COL.show, 1);
    k.fillRoundedRect(x, y, fill, h, 4);
    if (hot) {
      k.fillStyle(0xffffff, 0.2 + 0.2 * Math.sin(time * 0.014));
      k.fillRoundedRect(x, y, fill, h, 4);
    }
  }
  // Notches show exactly which kind of car each show level unlocks.
  for (const t of CAR_TYPES) {
    const nx = x + (t.need / 100) * w;
    k.fillStyle(S.show >= t.need ? 0x141020 : COL.paper, S.show >= t.need ? 0.55 : 0.45);
    k.fillRect(nx, y - 3, 2, h + 6);
  }
  txt(x, y - 12, 'SHOW', 12, COL.dim, 0, 0.5, 0, 13);
  if (S.combo > 2) {
    txt(x + w + 12, y + h / 2, 'x' + S.combo, S.combo > 20 ? 22 : 17, S.combo > 20 ? COL.accent : COL.paper, 0, 0.5, 0, 13);
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
  const hitGlow = S.judgeT > 0 && S.judge !== 'UY' ? S.judgeT / 0.7 : 0;
  k.fillStyle(COL.accent, 0.18 + hitGlow * 0.5);
  k.fillRoundedRect(cx - 20, BEAT_Y - 20, 40, 40, 7);
  k.lineStyle(3, COL.accent, 0.9);
  k.strokeRoundedRect(cx - 20, BEAT_Y - 20, 40, 40, 7);

  if (S.mode !== 'play') return;

  const frozen = S.dropT > 0 || S.stunT > 0;
  for (let i = -1; i < 5; i++) {
    const t = S.nextBeat + i * S.beatMs;
    const dtn = t - time;
    if (dtn > look || dtn < -240) continue;
    const px = cx + (dtn / look) * span;
    const near = Math.max(0, 1 - Math.abs(dtn) / look);
    const consumed = i === 0 && S.beatDone;
    const a = frozen ? 0.2 : consumed ? 0.25 : 0.35 + near * 0.65;
    k.fillStyle(consumed ? COL.dim : COL.paper, a);
    k.fillCircle(px, BEAT_Y, 6 + near * 5);
  }

  if (S.judgeT > 0) {
    const a = Math.min(1, S.judgeT / 0.35);
    const col = S.judge === 'PERFECTO' ? COL.accent : S.judge === 'BIEN' ? COL.paper : COL.danger;
    txt(cx, BEAT_Y - 46, S.judge, S.judge === 'PERFECTO' ? 22 : 18, col, 0.5, 0.5, 0, 13).setAlpha(a);
  }

  txt(cx - span - 30, BEAT_Y, 'BOTON 1', 11, COL.dim, 0, 0.5, 0, 13);
}

function drawHud(scene, time) {
  const k = g.hud;
  k.clear();

  if (S.mode === 'play' || S.mode === 'tally') {
    k.fillStyle(0x0a0910, 0.72);
    k.fillRoundedRect(14, 12, 260, 60, 10);
    txt(24, 26, money(S.cash), 26, COL.cash, 0, 0.5, 0, 13);
    txt(24, 54, 'SEMAFORO ' + S.round, 13, COL.dim, 0, 0.5, 0, 13);

    // Lives, drawn as spare hats.
    for (let i = 0; i < 3; i++) {
      const on = i < S.lives;
      k.fillStyle(on ? COL.shirt : 0x3a3446, 1);
      k.fillRoundedRect(196 + i * 26, 46, 20, 5, 2);
      k.fillRoundedRect(200 + i * 26, 38, 12, 9, 4);
    }

    drawTrafficLight(k, time);
    drawShowMeter(k, time);
    drawBeatBar(k, time);

    // Prompt when a window is within reach.
    const car = nearestOpenCar();
    if (car && S.collectT <= 0 && S.dropT <= 0 && S.stunT <= 0) {
      const sx = car.x - S.camX;
      txt(sx, CAR_BASE - car.type.h - 46, 'BOTON 2  ' + money(car.tip), 14, COL.accent, 0.5, 0.5, 0, 13);
    }

    // Warning to run once the light goes amber.
    if (S.light === 'yellow' && !inSafeZone(S.px)) {
      const dl = Math.abs(S.px - SAFE_L);
      const dr = Math.abs(S.px - SAFE_R);
      const arrow = dl < dr ? '<<<<' : '>>>>';
      const a = 0.55 + 0.45 * Math.sin(time * 0.02);
      txt(W / 2, 176, arrow + '  A LA ESQUINA  ' + arrow, 26, COL.warn, 0.5, 0.5, 0, 13).setAlpha(a);
    }
    if (S.dropT > 0) txt(W / 2, 176, 'RECOGIENDO...', 22, COL.danger, 0.5, 0.5, 0, 13);
    if (S.stunT > 0 && S.light !== 'green') txt(W / 2, 176, 'iLEVANTATE!', 22, COL.danger, 0.5, 0.5, 0, 13);
  }

  if (S.spec.rain && (S.mode === 'play')) drawRain(k, time);

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
    k.fillStyle(0x08070f, 0.55);
    k.fillRect(0, 0, W, H);
    drawTitle(k, time);
    panel(k, W / 2 - 230, 208, 460, 150);
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const on = i === S.menuIdx;
      const y = 240 + i * 42;
      if (on) {
        k.fillStyle(COL.accent, 0.16);
        k.fillRoundedRect(W / 2 - 210, y - 17, 420, 34, 6);
      }
      txt(W / 2, y, (on ? '> ' : '  ') + MENU_ITEMS[i] + (on ? ' <' : '  '), on ? 20 : 17, on ? COL.accent : COL.dim, 0.5, 0.5, 0, 13);
    }
    txt(W / 2, 388, 'JOYSTICK para elegir  ·  BOTON 1 para entrar', 13, COL.dim, 0.5, 0.5, 0, 13);
    txt(W / 2, 570, 'el rojo dura 45 segundos. haga el show, cobre, y salgase.', 14, COL.paper, 0.5, 0.5, 0, 13);
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
      ['', ''],
      ['EL SHOW', 'Atajar bien lo sube. Mientras mas alto, mas vidrios bajan.'],
      ['LA TRAMPA', 'Cobrar le ocupa la mano: ese tiempo lo pierde.'],
      ['', 'Aprenda a cobrar en el contratiempo, justo despues de atajar.'],
      ['', ''],
      ['EL VERDE', 'Cuando el semaforo cambia, tiene que estar en una esquina.'],
      ['', 'Si lo coge en la mitad de la via, pierde una vida.'],
    ];
    let y = 124;
    for (const [a, b] of lines) {
      if (a) txt(96, y, a, 15, COL.accent, 0, 0.5, 0, 13);
      if (b) txt(214, y, b, 14, COL.paper, 0, 0.5, 0, 13);
      y += 34;
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
    txt(W / 2, 232, 'lo del semaforo ' + S.round, 14, COL.dim, 0.5, 0.5, 0, 13);
    txt(W / 2, 276, money(S.roundCash), 40, COL.cash, 0.5, 0.5, 0, 13);
    txt(W / 2, 320, 'mejor combo  x' + S.bestCombo, 15, COL.paper, 0.5, 0.5, 0, 13);
    txt(W / 2, 348, 'vidas  ' + S.lives, 15, S.lives > 1 ? COL.paper : COL.danger, 0.5, 0.5, 0, 13);
    if (S.tallyT > 0.6) txt(W / 2, 386, 'BOTON 1 para seguir', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'shop') {
    k.fillStyle(0x08070f, 0.82);
    k.fillRect(0, 0, W, H);
    txt(W / 2, 96, 'ANTES DE QUE SE PONGA EN ROJO', 24, COL.accent, 0.5, 0.5, 0, 13);
    txt(W / 2, 128, 'lo que gaste sale de lo que lleva', 14, COL.dim, 0.5, 0.5, 0, 13);
    txt(W / 2, 162, money(S.cash), 30, COL.cash, 0.5, 0.5, 0, 13);

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
      const afford = isGo || S.cash >= cost;
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
        txt(cx, 272, 'nivel ' + S.upg[key] + '/' + u.max, 12, COL.dim, 0.5, 0.5, 0, 13);
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
    txt(W / 2, 292, money(S.cash), 46, COL.cash, 0.5, 0.5, 0, 13);
    txt(W / 2, 340, 'mejor combo  x' + S.bestCombo + '   ·   ' + S.totalPerfect + ' perfectos', 14, COL.paper, 0.5, 0.5, 0, 13);
    if (S.overT > 0.8) txt(W / 2, 402, 'BOTON 1 para continuar', 14, COL.dim, 0.5, 0.5, 0, 13);
    return;
  }

  if (S.mode === 'name') {
    k.fillStyle(0x08070f, 0.9);
    k.fillRect(0, 0, W, H);
    panel(k, W / 2 - 230, 150, 460, 270);
    txt(W / 2, 196, 'QUEDO EN LA TABLA', 26, COL.accent, 0.5, 0.5, 0, 13);
    txt(W / 2, 228, money(S.cash), 22, COL.cash, 0.5, 0.5, 0, 13);
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
  for (const c of S.cars) drawCar(k, c, time);
  for (const m of S.motos) drawMoto(k, m, time);

  const f = g.front;
  f.clear();
  drawJuggler(f, time);
  drawBalls(f, time);
  drawParticles(f);
  drawFloats();

  drawHud(scene, time);
  drawOverlay(scene, time);
  endText();

  // Camera, with shake folded in.
  const sx = S.shake > 0 ? (Math.random() - 0.5) * S.shake * 24 : 0;
  const sy = S.shake > 0 ? (Math.random() - 0.5) * S.shake * 18 : 0;
  scene.cameras.main.setScroll(S.camX + sx, sy);

  if (S.mode === 'play' && S.light === 'red' && S.dropT <= 0 && S.stunT <= 0) {
    pumpMusic(time, S.beatMs);
  }
}
