// =============================================================================
// VOIDWAKE — ASCII Space Simulation Engine
// -----------------------------------------------------------------------------
// A single-file, heavily-commented engine. Sections are clearly delimited so
// you can navigate and extend it without ceremony. See ./README.md for the
// extension guide.
//
// Sections:
//   1. RNG
//   2. Constants / Glyphs / Tunables
//   3. Types
//   4. Universe generation
//   5. AI state machines
//   6. Player systems (combat / mining / trading / missions / progression)
//   7. Input handling
//   8. Menus (main, character creation, ship customization, options, station)
//   9. Save / Load (unencrypted JSON)
//  10. Renderer (ASCII grid + cockpit HUD + 3D radar)
//  11. Main loop
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

// =============================================================================
// 1. RNG  — seeded mulberry32 so universes are reproducible
// =============================================================================
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// =============================================================================
// 2. Constants / Glyphs / Tunables
// =============================================================================
const SAVE_PREFIX = "voidwake.save.";
const VERSION = "0.1.0";

// Glyphs used for each entity kind. Extend here when adding a new EntityKind.
const GLYPHS: Record<string, string> = {
  star: "*",
  planet: "O",
  asteroid: "%",
  station: "#",
  friendly: "F",
  neutral: "n",
  hostile: "H",
  bullet: "·",
  player: "^",
};

const SPECIES = ["Human", "Android", "Reptilian", "Aquilan", "Drift-born"];

// Ship hull catalog. Add entries to expose new hulls to character creation.
const SHIP_HULLS = [
  { id: "scout", name: "Sparrow Scout", hull: 60, shield: 40, cargo: 12, speed: 90 },
  { id: "trader", name: "Mule Freighter", hull: 110, shield: 60, cargo: 64, speed: 55 },
  { id: "fighter", name: "Wasp Interceptor", hull: 80, shield: 90, cargo: 8, speed: 110 },
  { id: "miner", name: "Pickaxe Industrial", hull: 130, shield: 50, cargo: 40, speed: 50 },
];

const WEAPONS = [
  { id: "pulse", name: "Pulse Laser", dmg: 6, cooldown: 0.25, range: 350 },
  { id: "rail", name: "Railgun", dmg: 22, cooldown: 1.1, range: 600 },
  { id: "miner", name: "Mining Laser", dmg: 3, cooldown: 0.15, range: 220 },
];

const DIFFICULTIES = ["Easy", "Normal", "Hard", "Brutal", "Nightmare"] as const;

// =============================================================================
// 3. Types
// =============================================================================
type EntityKind =
  | "star"
  | "planet"
  | "asteroid"
  | "station"
  | "friendly"
  | "neutral"
  | "hostile"
  | "bullet";

interface Vec3 { x: number; y: number; z: number }

interface Entity {
  id: number;
  kind: EntityKind;
  name: string;
  pos: Vec3;
  vel: Vec3;
  faction: string;
  hull?: number;
  shield?: number;
  cargo?: Record<string, number>;
  state?: string;            // AI state
  targetId?: number;
  cooldown?: number;
  weaponId?: string;
  ore?: number;              // for asteroids
  ownerId?: number;          // for bullets
  ttl?: number;              // for bullets
  ttlAt?: number;
}

interface PlayerChar {
  name: string;
  gender: string;
  height: number;
  weight: number;
  skin: string;
  eyes: string;
  species: string;
}

interface PlayerShip {
  hullId: string;
  hull: number; hullMax: number;
  shield: number; shieldMax: number;
  fuel: number; fuelMax: number;
  cargoMax: number;
  speed: number;
  weaponId: string;
  modules: string[];
}

interface PlayerState {
  char: PlayerChar;
  ship: PlayerShip;
  credits: number;
  xp: number;
  rank: string;
  cargo: Record<string, number>;
  pos: Vec3;
  heading: { yaw: number; pitch: number };
  throttle: number;          // 0..1
  cooldown: number;
  mission?: Mission;
  lastSaveAt: number;
}

type MissionKind = "deliver" | "destroy" | "scan";
interface Mission {
  id: number;
  kind: MissionKind;
  description: string;
  targetId?: number;
  cargoItem?: string;
  cargoQty?: number;
  reward: number;
  done: boolean;
}

interface Options {
  difficulty: typeof DIFFICULTIES[number];
  peaceful: boolean;
  cheat: boolean;
  volumeMaster: number;
  volumeSfx: number;
  volumeMusic: number;
  unsavedWarnMinutes: number;
  keybinds: Record<string, string>;
}

interface SaveBlob {
  version: string;
  seed: number;
  player: PlayerState;
  entities: Entity[];
  options: Options;
  savedAt: number;
}

// =============================================================================
// Default options + keybinds
// =============================================================================
const DEFAULT_KEYBINDS: Record<string, string> = {
  throttleUp: "w",
  throttleDown: "s",
  yawLeft: "a",
  yawRight: "d",
  pitchUp: "q",
  pitchDown: "e",
  fire: " ",
  mine: "m",
  cycleTarget: "t",
  dock: "f",
  station: "b",
  mission: "j",
  menu: "escape",
};

function defaultOptions(): Options {
  return {
    difficulty: "Normal",
    peaceful: false,
    cheat: false,
    volumeMaster: 0.8,
    volumeSfx: 0.8,
    volumeMusic: 0.6,
    unsavedWarnMinutes: 10,
    keybinds: { ...DEFAULT_KEYBINDS },
  };
}

// =============================================================================
// 4. Universe Generation
// -----------------------------------------------------------------------------
// We seed a PRNG with the chosen world seed and scatter entities across a
// cube. Coordinates are in arbitrary units; the cockpit radar is sized to a
// fixed range so distant entities just appear faint.
// =============================================================================
const WORLD_RADIUS = 4000;

function randPos(rng: () => number, radius = WORLD_RADIUS): Vec3 {
  return {
    x: (rng() * 2 - 1) * radius,
    y: (rng() * 2 - 1) * radius,
    z: (rng() * 2 - 1) * radius,
  };
}

function nameFrom(rng: () => number, prefix: string): string {
  const syl = ["xa", "vor", "lun", "ter", "kai", "zo", "mira", "neb", "drak", "el", "ar", "ius"];
  let n = prefix + " ";
  const parts = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < parts; i++) n += syl[Math.floor(rng() * syl.length)];
  return n.replace(/\b\w/g, (c) => c.toUpperCase());
}

let _entityIdSeq = 1;
function nextId() { return _entityIdSeq++; }

function generateUniverse(seed: number): Entity[] {
  _entityIdSeq = 1;
  const rng = mulberry32(seed);
  const out: Entity[] = [];

  // Central star
  out.push({ id: nextId(), kind: "star", name: nameFrom(rng, "Sol"), pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, faction: "nature" });

  // Planets
  for (let i = 0; i < 5; i++) {
    out.push({ id: nextId(), kind: "planet", name: nameFrom(rng, "P-"), pos: randPos(rng, 2500), vel: { x: 0, y: 0, z: 0 }, faction: "nature" });
  }
  // Asteroid field
  for (let i = 0; i < 60; i++) {
    out.push({
      id: nextId(), kind: "asteroid", name: "Rock", pos: randPos(rng, 1800),
      vel: { x: (rng() - 0.5) * 2, y: (rng() - 0.5) * 2, z: (rng() - 0.5) * 2 },
      faction: "nature", ore: 5 + Math.floor(rng() * 20),
    });
  }
  // Stations
  for (let i = 0; i < 3; i++) {
    out.push({
      id: nextId(), kind: "station", name: nameFrom(rng, "Station"),
      pos: randPos(rng, 2200), vel: { x: 0, y: 0, z: 0 }, faction: "federation",
      hull: 500, shield: 300, state: "idle",
    });
  }
  // Ships
  const factions = ["federation", "guild", "pirate"];
  for (let i = 0; i < 18; i++) {
    const roll = rng();
    const kind: EntityKind = roll < 0.4 ? "friendly" : roll < 0.75 ? "neutral" : "hostile";
    const fac = kind === "friendly" ? "federation" : kind === "neutral" ? "guild" : "pirate";
    out.push({
      id: nextId(), kind, name: nameFrom(rng, kind === "hostile" ? "Raider" : "Ship"),
      pos: randPos(rng, 3000),
      vel: { x: (rng() - 0.5) * 10, y: (rng() - 0.5) * 10, z: (rng() - 0.5) * 10 },
      faction: factions.includes(fac) ? fac : "guild",
      hull: kind === "hostile" ? 50 : 40, shield: 30,
      state: "wander", cooldown: 0, weaponId: kind === "hostile" ? "pulse" : "pulse",
    });
  }

  return out;
}

// =============================================================================
// Vector helpers
// =============================================================================
const V = {
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  len: (a: Vec3) => Math.hypot(a.x, a.y, a.z),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
};

// =============================================================================
// 5. AI — minimal state machines
// -----------------------------------------------------------------------------
// Each ship kind has a tiny decision routine. Keep these small — they run
// every tick for every NPC. Add new behaviors by branching on `e.kind`.
// =============================================================================
function tickAI(e: Entity, dt: number, player: PlayerState, ents: Entity[], rng: () => number) {
  if (e.kind === "station" || e.kind === "planet" || e.kind === "star" || e.kind === "asteroid" || e.kind === "bullet") return;
  if (!e.hull || e.hull <= 0) return;

  const distToPlayer = V.len(V.sub(player.pos, e.pos));

  if (e.kind === "hostile") {
    // Chase & shoot
    e.state = distToPlayer < 800 ? "attack" : "patrol";
    if (e.state === "attack") {
      const dir = V.norm(V.sub(player.pos, e.pos));
      e.vel = V.scale(dir, 35);
      e.cooldown = (e.cooldown ?? 0) - dt;
      if (distToPlayer < 400 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 0.8;
        ents.push(makeBullet(e, dir));
      }
    } else {
      // Wander
      if (Math.random() < 0.02) e.vel = V.scale({ x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 }, 15);
    }
  } else if (e.kind === "friendly") {
    // Travel toward nearest station
    const station = ents.find((x) => x.kind === "station");
    if (station) {
      const d = V.sub(station.pos, e.pos);
      if (V.len(d) > 80) e.vel = V.scale(V.norm(d), 20);
      else e.vel = { x: 0, y: 0, z: 0 };
    }
  } else if (e.kind === "neutral") {
    // Mine: drift toward random asteroid
    if (!e.targetId || rng() < 0.005) {
      const rocks = ents.filter((x) => x.kind === "asteroid");
      const t = rocks[Math.floor(rng() * rocks.length)];
      if (t) e.targetId = t.id;
    }
    const target = ents.find((x) => x.id === e.targetId);
    if (target) {
      const d = V.sub(target.pos, e.pos);
      if (V.len(d) > 30) e.vel = V.scale(V.norm(d), 12);
    }
  }
}

function makeBullet(owner: Entity, dir: Vec3): Entity {
  return {
    id: nextId(),
    kind: "bullet",
    name: "shot",
    pos: { ...owner.pos },
    vel: V.scale(dir, 200),
    faction: owner.faction,
    ownerId: owner.id,
    ttl: 3,
    ttlAt: performance.now() / 1000 + 3,
  };
}

// =============================================================================
// 6. Player systems
// =============================================================================
function makePlayer(char: PlayerChar, hullId: string): PlayerState {
  const hull = SHIP_HULLS.find((h) => h.id === hullId) ?? SHIP_HULLS[0];
  return {
    char,
    ship: {
      hullId: hull.id,
      hull: hull.hull, hullMax: hull.hull,
      shield: hull.shield, shieldMax: hull.shield,
      fuel: 100, fuelMax: 100,
      cargoMax: hull.cargo,
      speed: hull.speed,
      weaponId: "pulse",
      modules: ["basic-scanner"],
    },
    credits: 500,
    xp: 0,
    rank: "Harmless",
    cargo: {},
    pos: { x: 0, y: 0, z: 200 },
    heading: { yaw: 0, pitch: 0 },
    throttle: 0,
    cooldown: 0,
    lastSaveAt: Date.now(),
  };
}

function awardXP(p: PlayerState, n: number) {
  p.xp += n;
  const ranks = ["Harmless", "Mostly Harmless", "Novice", "Competent", "Expert", "Master", "Elite"];
  const idx = Math.min(ranks.length - 1, Math.floor(p.xp / 200));
  p.rank = ranks[idx];
}

function cargoTotal(p: PlayerState) {
  return Object.values(p.cargo).reduce((a, b) => a + b, 0);
}

// =============================================================================
// 7. Input
// =============================================================================
class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  attach(el: HTMLElement) {
    el.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (["arrowup", "arrowdown", " ", "tab"].includes(k)) e.preventDefault();
    });
    el.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    el.addEventListener("blur", () => this.keys.clear());
  }
  consume(k: string) {
    const had = this.pressed.has(k);
    this.pressed.delete(k);
    return had;
  }
  endFrame() { this.pressed.clear(); }
}

// =============================================================================
// 8. Menus — implemented as a state machine inside the Voidwake class.
// =============================================================================
type Screen =
  | "title"
  | "create-char"
  | "create-ship"
  | "playing"
  | "menu"
  | "options"
  | "station"
  | "load"
  | "save"
  | "quit-confirm"
  | "destroyed";

// =============================================================================
// 9. Save / Load — unencrypted JSON in localStorage (plus export/import)
// =============================================================================
function saveGame(slot: string, blob: SaveBlob) {
  localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(blob, null, 2));
}
function loadGame(slot: string): SaveBlob | null {
  const raw = localStorage.getItem(SAVE_PREFIX + slot);
  if (!raw) return null;
  try { return JSON.parse(raw) as SaveBlob; } catch { return null; }
}
function listSaves(): { slot: string; savedAt: number }[] {
  const out: { slot: string; savedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(SAVE_PREFIX)) {
      try {
        const blob = JSON.parse(localStorage.getItem(k) || "{}");
        out.push({ slot: k.slice(SAVE_PREFIX.length), savedAt: blob.savedAt ?? 0 });
      } catch { /* ignore */ }
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

// =============================================================================
// 10. Renderer — ASCII grid drawn to canvas
// -----------------------------------------------------------------------------
// We draw a fixed character grid by computing cell size from canvas size.
// World-to-grid projection uses the player's yaw/pitch as an orientation.
// =============================================================================
const CELL_W = 9;   // px per glyph column
const CELL_H = 16;  // px per glyph row

interface Cell { ch: string; color: string }

function blankGrid(cols: number, rows: number): Cell[][] {
  const g: Cell[][] = [];
  for (let y = 0; y < rows; y++) {
    g.push(Array.from({ length: cols }, () => ({ ch: " ", color: "#0f0" })));
  }
  return g;
}

function putText(g: Cell[][], x: number, y: number, text: string, color = "#9fe"): void {
  if (y < 0 || y >= g.length) return;
  for (let i = 0; i < text.length; i++) {
    const xi = x + i;
    if (xi < 0 || xi >= g[0].length) continue;
    g[y][xi] = { ch: text[i], color };
  }
}

function colorFor(kind: EntityKind): string {
  switch (kind) {
    case "star": return "#ffd866";
    case "planet": return "#7ec8ff";
    case "asteroid": return "#a6886a";
    case "station": return "#c2c2ff";
    case "friendly": return "#7CFC00";
    case "neutral": return "#dddddd";
    case "hostile": return "#ff5555";
    case "bullet": return "#fffa86";
  }
}

// =============================================================================
// 11. Main engine class
// =============================================================================
export class Voidwake {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  input = new Input();

  screen: Screen = "title";
  prevPlayScreen: Screen | null = null;

  seed = 1;
  rng: () => number = mulberry32(1);
  entities: Entity[] = [];
  player: PlayerState | null = null;
  options: Options = defaultOptions();

  // Menu transient state
  menuCursor = 0;
  charDraft: PlayerChar = {
    name: "Cmdr Vex", gender: "Unspecified",
    height: 175, weight: 72, skin: "amber", eyes: "green", species: "Human",
  };
  hullDraftIdx = 0;
  weaponDraftIdx = 0;

  // Quit-warning tracking
  warnText = "";

  // Loop
  running = false;
  lastTs = 0;
  acc = 0;
  rafId = 0;

  // Selected target (entity id)
  targetId: number | null = null;

  // HUD message log
  log: { t: number; msg: string }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.fit();
    window.addEventListener("resize", () => this.fit());
    this.input.attach(canvas);
    canvas.focus();
  }

  fit() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(r.width);
    this.canvas.height = Math.floor(r.height);
  }

  start() {
    this.running = true;
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
      this.lastTs = ts;
      this.update(dt);
      this.render();
      this.input.endFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  pushLog(msg: string) {
    this.log.push({ t: performance.now() / 1000, msg });
    if (this.log.length > 6) this.log.shift();
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  update(dt: number) {
    const kb = this.options.keybinds;
    // Global: ESC toggles main menu while playing
    if (this.input.consume(kb.menu)) {
      if (this.screen === "playing") { this.prevPlayScreen = this.screen; this.screen = "menu"; this.menuCursor = 0; }
      else if (this.screen === "menu" || this.screen === "options" || this.screen === "load" || this.screen === "save" || this.screen === "quit-confirm") {
        this.screen = this.player ? "playing" : "title";
      } else if (this.screen === "station") {
        this.screen = "playing";
      }
    }

    switch (this.screen) {
      case "title": return this.updateTitle();
      case "create-char": return this.updateCharCreate();
      case "create-ship": return this.updateShipCreate();
      case "playing": return this.updatePlaying(dt);
      case "menu": return this.updateMenu();
      case "options": return this.updateOptions();
      case "load": return this.updateLoad();
      case "save": return this.updateSave();
      case "station": return this.updateStation();
      case "quit-confirm": return this.updateQuitConfirm();
    }
  }

  // --- Title --------------------------------------------------------------
  titleItems = ["New Game", "Load Game", "Options", "Quit"];
  updateTitle() {
    this.menuNav(this.titleItems.length);
    if (this.input.consume("enter")) {
      const choice = this.titleItems[this.menuCursor];
      if (choice === "New Game") { this.screen = "create-char"; this.menuCursor = 0; }
      else if (choice === "Load Game") { this.screen = "load"; this.menuCursor = 0; }
      else if (choice === "Options") { this.screen = "options"; this.menuCursor = 0; }
      else if (choice === "Quit") this.tryQuit();
    }
  }

  // --- Character creation --------------------------------------------------
  charFields = ["name", "gender", "species", "height", "weight", "skin", "eyes", "Continue →"];
  updateCharCreate() {
    this.menuNav(this.charFields.length);
    const field = this.charFields[this.menuCursor];
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    if (field === "species") {
      const i = SPECIES.indexOf(this.charDraft.species);
      if (left) this.charDraft.species = SPECIES[(i - 1 + SPECIES.length) % SPECIES.length];
      if (right) this.charDraft.species = SPECIES[(i + 1) % SPECIES.length];
    } else if (field === "gender") {
      const g = ["Female", "Male", "Nonbinary", "Unspecified"];
      const i = g.indexOf(this.charDraft.gender);
      if (left) this.charDraft.gender = g[(i - 1 + g.length) % g.length];
      if (right) this.charDraft.gender = g[(i + 1) % g.length];
    } else if (field === "height") {
      if (left) this.charDraft.height = Math.max(120, this.charDraft.height - 1);
      if (right) this.charDraft.height = Math.min(220, this.charDraft.height + 1);
    } else if (field === "weight") {
      if (left) this.charDraft.weight = Math.max(40, this.charDraft.weight - 1);
      if (right) this.charDraft.weight = Math.min(200, this.charDraft.weight + 1);
    } else if (field === "skin") {
      const arr = ["pale", "fair", "amber", "olive", "umber", "obsidian", "chrome", "jade"];
      const i = arr.indexOf(this.charDraft.skin);
      if (left) this.charDraft.skin = arr[(i - 1 + arr.length) % arr.length];
      if (right) this.charDraft.skin = arr[(i + 1) % arr.length];
    } else if (field === "eyes") {
      const arr = ["green", "blue", "amber", "violet", "silver", "black"];
      const i = arr.indexOf(this.charDraft.eyes);
      if (left) this.charDraft.eyes = arr[(i - 1 + arr.length) % arr.length];
      if (right) this.charDraft.eyes = arr[(i + 1) % arr.length];
    } else if (field === "name") {
      // backspace + key input
      this.handleNameInput();
    } else if (field === "Continue →") {
      if (this.input.consume("enter")) { this.screen = "create-ship"; this.menuCursor = 0; }
    }
  }

  // Capture printable keys into the player name
  handleNameInput() {
    // crude live capture
    for (const k of Array.from(this.input.pressed)) {
      if (k === "backspace") this.charDraft.name = this.charDraft.name.slice(0, -1);
      else if (k.length === 1 && /[\w \-.]/.test(k) && this.charDraft.name.length < 24) {
        this.charDraft.name += k;
      }
    }
  }

  // --- Ship creation -------------------------------------------------------
  updateShipCreate() {
    const items = ["hull", "weapon", "Launch →"];
    this.menuNav(items.length);
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    const f = items[this.menuCursor];
    if (f === "hull") {
      if (left) this.hullDraftIdx = (this.hullDraftIdx - 1 + SHIP_HULLS.length) % SHIP_HULLS.length;
      if (right) this.hullDraftIdx = (this.hullDraftIdx + 1) % SHIP_HULLS.length;
    } else if (f === "weapon") {
      if (left) this.weaponDraftIdx = (this.weaponDraftIdx - 1 + WEAPONS.length) % WEAPONS.length;
      if (right) this.weaponDraftIdx = (this.weaponDraftIdx + 1) % WEAPONS.length;
    } else if (f === "Launch →" && this.input.consume("enter")) {
      this.newGame();
    }
  }

  newGame() {
    this.seed = (Math.random() * 1e9) | 0;
    this.rng = mulberry32(this.seed);
    this.entities = generateUniverse(this.seed);
    this.player = makePlayer(this.charDraft, SHIP_HULLS[this.hullDraftIdx].id);
    this.player.ship.weaponId = WEAPONS[this.weaponDraftIdx].id;
    this.player.mission = this.generateMission();
    this.screen = "playing";
    this.pushLog(`Welcome, ${this.player.char.name}.`);
  }

  // --- Playing -------------------------------------------------------------
  updatePlaying(dt: number) {
    const p = this.player;
    if (!p) { this.screen = "title"; return; }
    const k = this.options.keybinds;
    const keys = this.input.keys;

    // Throttle / steering
    if (keys.has(k.throttleUp)) p.throttle = Math.min(1, p.throttle + dt * 0.7);
    if (keys.has(k.throttleDown)) p.throttle = Math.max(0, p.throttle - dt * 0.7);
    if (keys.has(k.yawLeft)) p.heading.yaw -= dt * 1.2;
    if (keys.has(k.yawRight)) p.heading.yaw += dt * 1.2;
    if (keys.has(k.pitchUp)) p.heading.pitch = Math.max(-Math.PI / 2, p.heading.pitch - dt * 1.0);
    if (keys.has(k.pitchDown)) p.heading.pitch = Math.min(Math.PI / 2, p.heading.pitch + dt * 1.0);

    // Forward direction from heading
    const fwd = headingToVec(p.heading.yaw, p.heading.pitch);
    const sp = p.ship.speed * p.throttle;
    p.pos = V.add(p.pos, V.scale(fwd, sp * dt));
    p.ship.fuel = Math.max(0, p.ship.fuel - sp * dt * 0.001);

    // Shield regen
    p.ship.shield = Math.min(p.ship.shieldMax, p.ship.shield + dt * 4);

    // Cycle target
    if (this.input.consume(k.cycleTarget)) this.cycleTarget();

    // Fire
    p.cooldown -= dt;
    if (keys.has(k.fire) && p.cooldown <= 0 && !this.options.peaceful) {
      const w = WEAPONS.find((x) => x.id === p.ship.weaponId) ?? WEAPONS[0];
      p.cooldown = w.cooldown;
      this.entities.push({
        id: nextId(), kind: "bullet", name: "shot",
        pos: { ...p.pos }, vel: V.scale(fwd, 260),
        faction: "player", ownerId: -1, ttl: 2,
        ttlAt: performance.now() / 1000 + 2,
      });
    }

    // Mine
    if (this.input.consume(k.mine)) this.mineTarget();
    // Dock
    if (this.input.consume(k.dock)) this.tryDock();
    // Open station menu shortcut
    if (this.input.consume(k.station)) this.tryDock();
    // Mission accept already happens when docking
    void k.mission;

    // Move entities
    const now = performance.now() / 1000;
    for (const e of this.entities) {
      if (e.kind !== "bullet") tickAI(e, dt, p, this.entities, this.rng);
      e.pos = V.add(e.pos, V.scale(e.vel, dt));
    }
    // Bullet collisions + TTL
    this.entities = this.entities.filter((e) => {
      if (e.kind !== "bullet") return true;
      if ((e.ttlAt ?? 0) < now) return false;
      // Player hit
      if (e.faction !== "player" && V.len(V.sub(e.pos, p.pos)) < 12) {
        if (!this.options.cheat) {
          const dmg = 6 * this.dmgScale();
          if ((p.ship.shield ?? 0) > 0) p.ship.shield = Math.max(0, p.ship.shield - dmg);
          else p.ship.hull = Math.max(0, p.ship.hull - dmg);
          if (p.ship.hull <= 0) { this.pushLog("Your ship was destroyed."); this.screen = "title"; this.player = null; }
        }
        return false;
      }
      // Enemy hit
      for (const t of this.entities) {
        if (t.kind !== "hostile" && t.kind !== "neutral" && t.kind !== "friendly") continue;
        if (e.ownerId === t.id) continue;
        if (e.faction === t.faction && e.faction !== "player") continue;
        if (V.len(V.sub(e.pos, t.pos)) < 14) {
          const w = WEAPONS.find((x) => x.id === (this.player?.ship.weaponId)) ?? WEAPONS[0];
          if ((t.shield ?? 0) > 0) t.shield = Math.max(0, (t.shield ?? 0) - w.dmg);
          else t.hull = Math.max(0, (t.hull ?? 0) - w.dmg);
          if ((t.hull ?? 0) <= 0) {
            this.pushLog(`Destroyed ${t.name}.`);
            awardXP(p, 25);
            p.credits += 50;
            // Mission progress
            if (p.mission && p.mission.kind === "destroy" && p.mission.targetId === t.id) {
              p.mission.done = true;
              this.pushLog("Bounty completed — return to a station.");
            }
            // remove dead ship next pass
            t.kind = "asteroid"; t.ore = 0; t.name = "debris";
          }
          return false;
        }
      }
      return true;
    });

    // Auto-save warn
    const mins = (Date.now() - p.lastSaveAt) / 60000;
    if (mins > this.options.unsavedWarnMinutes) {
      this.warnText = `Unsaved for ${mins.toFixed(0)} min`;
    } else {
      this.warnText = "";
    }
  }

  dmgScale() {
    return { Easy: 0.5, Normal: 1, Hard: 1.5, Brutal: 2.2, Nightmare: 3 }[this.options.difficulty];
  }

  cycleTarget() {
    const p = this.player; if (!p) return;
    const cand = this.entities
      .filter((e) => e.kind !== "bullet" && e.id !== this.targetId)
      .sort((a, b) => V.len(V.sub(a.pos, p.pos)) - V.len(V.sub(b.pos, p.pos)));
    this.targetId = cand[0]?.id ?? null;
  }

  mineTarget() {
    const p = this.player; if (!p) return;
    const t = this.entities.find((e) => e.id === this.targetId);
    if (!t || t.kind !== "asteroid") { this.pushLog("Target is not minable."); return; }
    const d = V.len(V.sub(t.pos, p.pos));
    if (d > 200) { this.pushLog("Too far to mine."); return; }
    if ((t.ore ?? 0) <= 0) { this.pushLog("Asteroid depleted."); return; }
    if (cargoTotal(p) >= p.ship.cargoMax) { this.pushLog("Cargo full."); return; }
    t.ore!--;
    p.cargo.ore = (p.cargo.ore ?? 0) + 1;
    awardXP(p, 2);
    this.pushLog("Mined 1 ore.");
  }

  tryDock() {
    const p = this.player; if (!p) return;
    const t = this.entities.find((e) => e.id === this.targetId);
    if (!t || t.kind !== "station") { this.pushLog("Target a station with T."); return; }
    const d = V.len(V.sub(t.pos, p.pos));
    if (d > 200) { this.pushLog("Too far to dock."); return; }
    if (p.throttle > 0.05) { this.pushLog("Reduce throttle to dock."); return; }
    this.screen = "station";
    this.menuCursor = 0;
    // Refuel & repair on dock (free)
    p.ship.fuel = p.ship.fuelMax;
    p.ship.hull = p.ship.hullMax;
    this.pushLog(`Docked at ${t.name}. Refueled and repaired.`);
    // Hand in mission
    if (p.mission && p.mission.done) {
      p.credits += p.mission.reward;
      awardXP(p, 80);
      this.pushLog(`Mission paid: +${p.mission.reward}cr`);
      p.mission = this.generateMission();
    }
  }

  // --- Missions ------------------------------------------------------------
  generateMission(): Mission {
    const rng = this.rng;
    const kinds: MissionKind[] = ["deliver", "destroy", "scan"];
    const k = kinds[Math.floor(rng() * kinds.length)];
    const id = nextId();
    if (k === "destroy") {
      const target = this.entities.find((e) => e.kind === "hostile");
      return {
        id, kind: k, targetId: target?.id,
        description: `Destroy hostile ${target?.name ?? "raider"}`,
        reward: 250, done: false,
      };
    }
    if (k === "scan") {
      const target = this.entities.find((e) => e.kind === "planet");
      return {
        id, kind: k, targetId: target?.id,
        description: `Scan anomaly near ${target?.name ?? "planet"} (fly within 200u)`,
        reward: 150, done: false,
      };
    }
    return {
      id, kind: "deliver", cargoItem: "ore", cargoQty: 5,
      description: "Deliver 5 ore to any station",
      reward: 200, done: false,
    };
  }

  tickMissions() {
    const p = this.player; if (!p || !p.mission) return;
    const m = p.mission;
    if (m.done) return;
    if (m.kind === "scan" && m.targetId) {
      const t = this.entities.find((e) => e.id === m.targetId);
      if (t && V.len(V.sub(t.pos, p.pos)) < 200) { m.done = true; this.pushLog("Anomaly scanned."); }
    }
    if (m.kind === "deliver") {
      if ((p.cargo[m.cargoItem!] ?? 0) >= (m.cargoQty ?? 0)) m.done = true;
    }
  }

  // --- Main menu -----------------------------------------------------------
  menuItems = ["Resume", "Save Game", "Load Game", "Options", "Quit"];
  updateMenu() {
    this.menuNav(this.menuItems.length);
    if (this.input.consume("enter")) {
      const c = this.menuItems[this.menuCursor];
      if (c === "Resume") this.screen = "playing";
      else if (c === "Save Game") { this.screen = "save"; this.menuCursor = 0; }
      else if (c === "Load Game") { this.screen = "load"; this.menuCursor = 0; }
      else if (c === "Options") { this.screen = "options"; this.menuCursor = 0; }
      else if (c === "Quit") this.tryQuit();
    }
  }

  tryQuit() {
    if (this.player) {
      const mins = (Date.now() - this.player.lastSaveAt) / 60000;
      if (mins > this.options.unsavedWarnMinutes) {
        this.screen = "quit-confirm";
        return;
      }
    }
    this.player = null;
    this.screen = "title";
  }

  updateQuitConfirm() {
    const items = ["Cancel", "Quit Anyway"];
    this.menuNav(items.length);
    if (this.input.consume("enter")) {
      if (items[this.menuCursor] === "Quit Anyway") { this.player = null; this.screen = "title"; }
      else this.screen = "menu";
    }
  }

  // --- Options -------------------------------------------------------------
  updateOptions() {
    const items = [
      `Difficulty: ${this.options.difficulty}`,
      `Peaceful Mode: ${this.options.peaceful ? "ON" : "OFF"}`,
      `Cheat Mode: ${this.options.cheat ? "ON" : "OFF"}`,
      `Master Volume: ${(this.options.volumeMaster * 100).toFixed(0)}%`,
      `SFX Volume: ${(this.options.volumeSfx * 100).toFixed(0)}%`,
      `Music Volume: ${(this.options.volumeMusic * 100).toFixed(0)}%`,
      `Unsaved Warn: ${this.options.unsavedWarnMinutes} min`,
      `Reset Keybinds (current: ${Object.keys(this.options.keybinds).length})`,
      "Back",
    ];
    this.menuNav(items.length);
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    const i = this.menuCursor;
    if (i === 0 && (left || right)) {
      const idx = DIFFICULTIES.indexOf(this.options.difficulty);
      const n = DIFFICULTIES.length;
      this.options.difficulty = DIFFICULTIES[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 1 && (left || right)) this.options.peaceful = !this.options.peaceful;
    if (i === 2 && (left || right)) this.options.cheat = !this.options.cheat;
    if (i === 3) this.options.volumeMaster = clamp01(this.options.volumeMaster + (right ? 0.05 : left ? -0.05 : 0));
    if (i === 4) this.options.volumeSfx = clamp01(this.options.volumeSfx + (right ? 0.05 : left ? -0.05 : 0));
    if (i === 5) this.options.volumeMusic = clamp01(this.options.volumeMusic + (right ? 0.05 : left ? -0.05 : 0));
    if (i === 6) this.options.unsavedWarnMinutes = Math.max(1, this.options.unsavedWarnMinutes + (right ? 1 : left ? -1 : 0));
    if (this.input.consume("enter")) {
      if (items[i].startsWith("Reset")) this.options.keybinds = { ...DEFAULT_KEYBINDS };
      if (items[i] === "Back") this.screen = this.player ? "menu" : "title";
    }
  }

  // --- Save / Load screens -------------------------------------------------
  updateSave() {
    if (!this.player) { this.screen = "menu"; return; }
    const slots = ["slot-1", "slot-2", "slot-3", "Back"];
    this.menuNav(slots.length);
    if (this.input.consume("enter")) {
      const c = slots[this.menuCursor];
      if (c === "Back") { this.screen = "menu"; return; }
      const blob: SaveBlob = {
        version: VERSION, seed: this.seed,
        player: this.player, entities: this.entities,
        options: this.options, savedAt: Date.now(),
      };
      saveGame(c, blob);
      this.player.lastSaveAt = Date.now();
      this.pushLog(`Saved to ${c}.`);
      this.screen = "menu";
    }
  }
  updateLoad() {
    const slots = listSaves().map((s) => s.slot);
    const items = [...slots, "Back"];
    this.menuNav(items.length);
    if (this.input.consume("enter")) {
      const c = items[this.menuCursor];
      if (c === "Back") { this.screen = this.player ? "menu" : "title"; return; }
      const blob = loadGame(c);
      if (!blob) { this.pushLog("Load failed."); return; }
      this.seed = blob.seed;
      this.rng = mulberry32(this.seed);
      this.entities = blob.entities;
      this.player = blob.player;
      this.options = blob.options;
      this.screen = "playing";
      this.pushLog(`Loaded ${c}.`);
    }
  }

  // --- Station menu --------------------------------------------------------
  stationItems = ["Sell Ore (10cr ea)", "Buy Fuel (5cr/u)", "Refit Weapon", "Undock"];
  updateStation() {
    const p = this.player; if (!p) { this.screen = "title"; return; }
    this.menuNav(this.stationItems.length);
    if (this.input.consume("enter")) {
      const c = this.stationItems[this.menuCursor];
      if (c.startsWith("Sell Ore")) {
        const ore = p.cargo.ore ?? 0;
        if (ore > 0) { p.credits += ore * 10; p.cargo.ore = 0; this.pushLog(`Sold ${ore} ore.`); }
      } else if (c.startsWith("Buy Fuel")) {
        const need = p.ship.fuelMax - p.ship.fuel;
        const cost = Math.ceil(need) * 5;
        if (p.credits >= cost) { p.credits -= cost; p.ship.fuel = p.ship.fuelMax; this.pushLog(`Refueled (${cost}cr).`); }
        else this.pushLog("Not enough credits.");
      } else if (c.startsWith("Refit")) {
        const i = WEAPONS.findIndex((w) => w.id === p.ship.weaponId);
        p.ship.weaponId = WEAPONS[(i + 1) % WEAPONS.length].id;
        this.pushLog(`Equipped ${WEAPONS.find((w) => w.id === p.ship.weaponId)!.name}.`);
      } else if (c === "Undock") {
        this.screen = "playing";
      }
    }
  }

  // --- Common menu nav -----------------------------------------------------
  menuNav(n: number) {
    if (this.input.consume("arrowup")) this.menuCursor = (this.menuCursor - 1 + n) % n;
    if (this.input.consume("arrowdown")) this.menuCursor = (this.menuCursor + 1) % n;
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  render() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const cols = Math.max(40, Math.floor(w / CELL_W));
    const rows = Math.max(20, Math.floor(h / CELL_H));
    const grid = blankGrid(cols, rows);

    switch (this.screen) {
      case "title": this.renderTitle(grid); break;
      case "create-char": this.renderCharCreate(grid); break;
      case "create-ship": this.renderShipCreate(grid); break;
      case "playing": this.renderPlaying(grid); break;
      case "menu": this.renderMenu(grid); break;
      case "options": this.renderOptions(grid); break;
      case "load": this.renderLoad(grid); break;
      case "save": this.renderSave(grid); break;
      case "station": this.renderStation(grid); break;
      case "quit-confirm": this.renderQuitConfirm(grid); break;
    }

    // Paint grid
    ctx.font = `${CELL_H - 2}px ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = "top";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = grid[y][x];
        if (c.ch === " ") continue;
        ctx.fillStyle = c.color;
        ctx.fillText(c.ch, x * CELL_W, y * CELL_H);
      }
    }
  }

  // Title screen ------------------------------------------------------------
  renderTitle(g: Cell[][]) {
    const banner = [
      " __     __   ___   ___   __   __     ___   _  _____ ",
      " \\ \\   / /  / _ \\ |_ _| |  \\ /  \\   / / \\ | |/ / __|",
      "  \\ \\_/ /  | (_) | | |  | |\\ V /\\ \\/ /|  \\| ' <| _| ",
      "   \\___/    \\___/ |___| |_| \\_/  \\__/ |_|\\_|_|\\_\\___|",
    ];
    banner.forEach((line, i) => putText(g, 4, 2 + i, line, "#7CFC00"));
    putText(g, 4, 7, "An ASCII space simulation — v" + VERSION, "#5fc")
    this.titleItems.forEach((it, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 12 + i * 2, (sel ? "▸ " : "  ") + it, sel ? "#fff" : "#9fe");
    });
    putText(g, 4, g.length - 2, "↑/↓ select   ENTER confirm", "#888");
  }

  renderCharCreate(g: Cell[][]) {
    putText(g, 4, 2, "CREATE COMMANDER", "#7CFC00");
    putText(g, 4, 3, "←/→ adjust   ↑/↓ field   ENTER continue", "#888");
    const c = this.charDraft;
    const rows = [
      `name:    ${c.name}_`,
      `gender:  ${c.gender}`,
      `species: ${c.species}`,
      `height:  ${c.height} cm`,
      `weight:  ${c.weight} kg`,
      `skin:    ${c.skin}`,
      `eyes:    ${c.eyes}`,
      `Continue →`,
    ];
    rows.forEach((r, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 6 + i * 2, (sel ? "▸ " : "  ") + r, sel ? "#fff" : "#9fe");
    });
  }

  renderShipCreate(g: Cell[][]) {
    putText(g, 4, 2, "OUTFIT SHIP", "#7CFC00");
    const hull = SHIP_HULLS[this.hullDraftIdx];
    const wep = WEAPONS[this.weaponDraftIdx];
    const rows = [
      `hull:   ${hull.name}   (HP ${hull.hull}, SH ${hull.shield}, cargo ${hull.cargo}, spd ${hull.speed})`,
      `weapon: ${wep.name}   (dmg ${wep.dmg}, cd ${wep.cooldown}s, rng ${wep.range})`,
      `Launch →`,
    ];
    rows.forEach((r, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 6 + i * 2, (sel ? "▸ " : "  ") + r, sel ? "#fff" : "#9fe");
    });
    putText(g, 4, g.length - 2, "←/→ change   ↑/↓ field   ENTER confirm", "#888");
  }

  renderMenu(g: Cell[][]) { this.renderListMenu(g, "MAIN MENU", this.menuItems); }
  renderOptions(g: Cell[][]) {
    const items = [
      `Difficulty: ${this.options.difficulty}`,
      `Peaceful Mode: ${this.options.peaceful ? "ON" : "OFF"}`,
      `Cheat Mode: ${this.options.cheat ? "ON" : "OFF"}`,
      `Master Volume: ${(this.options.volumeMaster * 100).toFixed(0)}%`,
      `SFX Volume: ${(this.options.volumeSfx * 100).toFixed(0)}%`,
      `Music Volume: ${(this.options.volumeMusic * 100).toFixed(0)}%`,
      `Unsaved Warn: ${this.options.unsavedWarnMinutes} min`,
      `Reset Keybinds`,
      "Back",
    ];
    this.renderListMenu(g, "OPTIONS", items);
    putText(g, 4, g.length - 2, "←/→ change   ↑/↓ field   ENTER confirm", "#888");
  }
  renderSave(g: Cell[][]) { this.renderListMenu(g, "SAVE GAME", ["slot-1", "slot-2", "slot-3", "Back"]); }
  renderLoad(g: Cell[][]) {
    const slots = listSaves().map((s) => `${s.slot}  (${new Date(s.savedAt).toLocaleString()})`);
    if (slots.length === 0) slots.push("(no saves)");
    this.renderListMenu(g, "LOAD GAME", [...slots, "Back"]);
  }
  renderStation(g: Cell[][]) {
    const p = this.player!;
    putText(g, 4, 2, "DOCKED — STATION SERVICES", "#7CFC00");
    putText(g, 4, 3, `credits: ${p.credits}   ore: ${p.cargo.ore ?? 0}   fuel: ${p.ship.fuel.toFixed(0)}/${p.ship.fuelMax}`, "#9fe");
    if (p.mission) putText(g, 4, 4, `mission: ${p.mission.description} ${p.mission.done ? "[READY]" : ""}`, "#fb6");
    this.stationItems.forEach((it, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 7 + i * 2, (sel ? "▸ " : "  ") + it, sel ? "#fff" : "#9fe");
    });
  }
  renderQuitConfirm(g: Cell[][]) {
    putText(g, 4, 3, "Unsaved progress — quit anyway?", "#fb6");
    ["Cancel", "Quit Anyway"].forEach((it, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 6 + i * 2, (sel ? "▸ " : "  ") + it, sel ? "#fff" : "#9fe");
    });
  }
  renderListMenu(g: Cell[][], title: string, items: string[]) {
    putText(g, 4, 2, title, "#7CFC00");
    items.forEach((it, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 5 + i * 2, (sel ? "▸ " : "  ") + it, sel ? "#fff" : "#9fe");
    });
    putText(g, 4, g.length - 2, "↑/↓ select   ENTER confirm   ESC back", "#888");
  }

  // Playing: cockpit + world ------------------------------------------------
  renderPlaying(g: Cell[][]) {
    const p = this.player; if (!p) return;
    const cols = g[0].length, rows = g.length;

    // World viewport: top portion of grid
    const vpTop = 1, vpLeft = 1, vpRight = cols - 28, vpBottom = rows - 9;
    const vw = vpRight - vpLeft, vh = vpBottom - vpTop;

    // Frame
    for (let x = vpLeft; x <= vpRight; x++) { g[vpTop][x].ch = "─"; g[vpBottom][x].ch = "─"; g[vpTop][x].color = g[vpBottom][x].color = "#234"; }
    for (let y = vpTop; y <= vpBottom; y++) { g[y][vpLeft].ch = "│"; g[y][vpRight].ch = "│"; g[y][vpLeft].color = g[y][vpRight].color = "#234"; }

    // Project entities onto viewport using player heading as the camera
    const cy = Math.cos(p.heading.yaw), sy = Math.sin(p.heading.yaw);
    const cp = Math.cos(p.heading.pitch), sp = Math.sin(p.heading.pitch);
    for (const e of this.entities) {
      if (e.kind === "bullet" && e.faction === "player") {
        // small flicker
      }
      const r = V.sub(e.pos, p.pos);
      // rotate -yaw around Y, then -pitch around X
      const x1 = cy * r.x - sy * r.z;
      const z1 = sy * r.x + cy * r.z;
      const y1 = cp * r.y - sp * z1;
      const z2 = sp * r.y + cp * z1;
      if (z2 <= 1) continue; // behind camera
      const sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
      const sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      if (sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) continue;
      g[sy2][sx] = { ch: GLYPHS[e.kind], color: colorFor(e.kind) };
    }

    // Crosshair
    const ccx = vpLeft + Math.floor(vw / 2), ccy = vpTop + Math.floor(vh / 2);
    putText(g, ccx - 1, ccy, "-+-", "#3a6");
    g[ccy - 1][ccx].ch = "|"; g[ccy - 1][ccx].color = "#3a6";
    g[ccy + 1][ccx].ch = "|"; g[ccy + 1][ccx].color = "#3a6";

    // --- Right-side cockpit panel ---
    const panelX = vpRight + 2;
    putText(g, panelX, vpTop, "[ COCKPIT ]", "#7CFC00");
    putText(g, panelX, vpTop + 2, `Cmdr ${p.char.name}`, "#fff");
    putText(g, panelX, vpTop + 3, `Rank ${p.rank}  XP ${p.xp}`, "#9fe");
    putText(g, panelX, vpTop + 4, `Credits ${p.credits}`, "#fb6");
    putText(g, panelX, vpTop + 6, `Hull   ${bar(p.ship.hull, p.ship.hullMax)}`, "#f88");
    putText(g, panelX, vpTop + 7, `Shield ${bar(p.ship.shield, p.ship.shieldMax)}`, "#8cf");
    putText(g, panelX, vpTop + 8, `Fuel   ${bar(p.ship.fuel, p.ship.fuelMax)}`, "#fc6");
    putText(g, panelX, vpTop + 9, `Throttle ${(p.throttle * 100).toFixed(0)}%`, "#9fe");
    putText(g, panelX, vpTop + 10, `Speed ${(p.ship.speed * p.throttle).toFixed(0)} u/s`, "#9fe");
    putText(g, panelX, vpTop + 12, `Cargo ${cargoTotal(p)}/${p.ship.cargoMax}`, "#9fe");
    let cy2 = vpTop + 13;
    for (const [k, v] of Object.entries(p.cargo)) putText(g, panelX + 1, cy2++, `· ${k}: ${v}`, "#aea");

    const t = this.entities.find((e) => e.id === this.targetId);
    putText(g, panelX, cy2 + 1, "[ TARGET ]", "#7CFC00");
    if (t) {
      const d = V.len(V.sub(t.pos, p.pos));
      putText(g, panelX, cy2 + 2, `${t.name}`, "#fff");
      putText(g, panelX, cy2 + 3, `${t.kind}  d=${d.toFixed(0)}u`, "#9fe");
      if (t.hull !== undefined) putText(g, panelX, cy2 + 4, `hull ${t.hull}  sh ${t.shield ?? 0}`, "#f88");
    } else {
      putText(g, panelX, cy2 + 2, "press T to cycle", "#888");
    }

    // --- Bottom: radar + status ---
    const rTop = vpBottom + 1;
    this.renderRadar(g, 2, rTop, 22, 7);
    putText(g, 28, rTop, "[ SYSTEM ]", "#7CFC00");
    putText(g, 28, rTop + 1, `Seed ${this.seed}`, "#9fe");
    putText(g, 28, rTop + 2, `Pos ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)}`, "#9fe");
    putText(g, 28, rTop + 3, `Heading yaw ${(p.heading.yaw).toFixed(2)} pitch ${(p.heading.pitch).toFixed(2)}`, "#9fe");
    putText(g, 28, rTop + 4, `Mission: ${p.mission ? p.mission.description : "(none)"}`, "#fb6");
    if (p.mission?.done) putText(g, 28, rTop + 5, "→ Return to a station to claim reward", "#cf6");
    if (this.warnText) putText(g, 28, rTop + 6, `⚠ ${this.warnText}`, "#fb6");

    // Log
    let ly = rTop;
    for (let i = this.log.length - 1; i >= 0; i--) {
      putText(g, cols - 52, ly++, "» " + this.log[i].msg, "#cfd");
      if (ly > rows - 2) break;
    }

    // Keys hint
    putText(g, 2, rows - 1, "W/S throttle  A/D yaw  Q/E pitch  SPC fire  M mine  T target  F dock  ESC menu", "#666");

    this.tickMissions();
  }

  renderRadar(g: Cell[][], x: number, y: number, w: number, h: number) {
    const p = this.player; if (!p) return;
    // Border
    putText(g, x, y, "[ RADAR ]", "#7CFC00");
    for (let yy = 0; yy <= h; yy++) {
      g[y + yy][x].ch = "│"; g[y + yy][x + w].ch = "│";
      g[y + yy][x].color = g[y + yy][x + w].color = "#234";
    }
    for (let xx = 0; xx <= w; xx++) {
      g[y][x + xx].ch = "─"; g[y + h][x + xx].ch = "─";
      g[y][x + xx].color = g[y + h][x + xx].color = "#234";
    }
    const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2);
    g[cy][cx] = { ch: "@", color: "#7CFC00" };

    const radarRange = 1500;
    const cyY = Math.cos(p.heading.yaw), syY = Math.sin(p.heading.yaw);
    for (const e of this.entities) {
      if (e.kind === "bullet") continue;
      const r = V.sub(e.pos, p.pos);
      const d = V.len(r);
      if (d > radarRange) continue;
      const xr = cyY * r.x - syY * r.z;
      const zr = syY * r.x + cyY * r.z;
      const sx = cx + Math.round((xr / radarRange) * (w / 2 - 1));
      const sy2 = cy + Math.round((zr / radarRange) * (h / 2 - 1));
      if (sx <= x || sx >= x + w || sy2 <= y || sy2 >= y + h) continue;
      // vertical offset hint
      let ch = GLYPHS[e.kind];
      if (r.y > 100) ch = ch.toUpperCase();
      else if (r.y < -100) ch = ch.toLowerCase();
      g[sy2][sx] = { ch, color: colorFor(e.kind) };
    }
  }
}

function bar(cur: number, max: number, width = 10): string {
  const n = Math.max(0, Math.min(width, Math.round((cur / max) * width)));
  return "[" + "█".repeat(n) + "·".repeat(width - n) + "] " + cur.toFixed(0) + "/" + max;
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function headingToVec(yaw: number, pitch: number): Vec3 {
  // yaw rotates around Y (xz plane), pitch around X (yz plane)
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { x: sy * cp, y: -sp, z: cy * cp };
}

// Hash function exported for tooling tests; otherwise unused.
export const _internals = { hashString, mulberry32 };
