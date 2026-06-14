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
  loot: "$",
};

// ---- Flavor data: names / barks / broadcasts -----------------------------
// Used by the chatter system and gunner recruitment. Keep these small lists
// punchy — they're cycled randomly so repetition gets old fast.
const GUNNER_FIRST = ["Vex","Rho","Mira","Kael","Zara","Brun","Tessa","Doxx","Niri","Otho","Pell","Quill","Sable","Yara"];
const GUNNER_LAST  = ["Mara","Vant","Sool","Krev","Iyo","Drax","Phane","Wist","Orbit","Tann","Holt","Reyne"];
const GUNNER_BARKS_HOSTILE  = ["On him!","Got the lock — firing!","He's dust!","Eat plasma!","Burn, raider!"];
const GUNNER_BARKS_MINE     = ["Nice vein.","Chewing rock.","Mining now, hold steady."];
const GUNNER_BARKS_DOCK     = ["Suggest we dock here, Cmdr.","That station looks safe. Dock?","Could use a stretch — dock?"];
const GUNNER_BARKS_HIT      = ["We're taking fire!","Shields buckling!","Hold her steady!"];
const GUNNER_BARKS_IDLE     = ["Quiet out here.","Strange stars this sector.","I'd kill for hot coffee.","You ever miss dirtside?"];
const HOSTILE_TAUNTS        = ["You're cargo now.","Should've stayed dirtside.","Drift well, scum.","I see you, little ship."];
const FRIENDLY_GREETS       = ["Safe vectors, Cmdr.","Federation thanks you.","Fly true out there."];
const NEUTRAL_CHATTER       = ["Guild traffic, hold lanes.","Got rocks to sell, push off.","Mind your wake, pilot."];
const STATION_BROADCASTS    = ["...automated beacon: dock fees waived this cycle.","Approach vector clear. Welcome.","Maintenance bay open for refits."];
const PLANET_HAILS          = ["Surface comms crackle faintly.","Atmospheric thermals reported.","Tradehouse requests manifests."];

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
  | "bullet"
  | "loot";

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
  // Loot canister payload (kind === "loot"). Picked up on fly-through.
  loot?: { credits?: number; ore?: number };
  // Cosmetic: which palette slot ship variants use for chatter line tagging.
  lastChatterAt?: number;
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

// A hired gunner who can auto-fire on hostiles, auto-mine asteroids,
// and suggest docking via chatter. See "Smart with rules" autopilot in
// updateGunner(). Persisted on PlayerState so saves keep the crew.
interface Gunner {
  name: string;
  species: string;
  gender: string;
  enabled: boolean;           // toggled by G key
  hiredAt: number;            // ms timestamp, mostly cosmetic
  cooldown: number;           // independent fire cadence
  share: number;              // 0..1 — fraction of credits skimmed at docks
  nextBarkAt: number;         // throttle idle barks
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
  // New since 0.2: optional hired gunner, faction reputation, lifetime kill count.
  gunner?: Gunner;
  reputation?: Record<string, number>;
  kills?: number;
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

// Per-station market state. Generated deterministically from the station id
// so prices and stock are stable between visits within a single session, but
// vary station-to-station (a refinery sells cheap fuel, a frontier outpost
// charges double). Persisted lazily in Voidwake.stationStocks at runtime.
interface StationStock {
  fuelPrice: number;          // cr per unit
  orePrice: number;           // cr per unit sold to station
  weapons: { id: string; price: number }[];
  modules: { id: string; name: string; price: number; desc: string }[];
  gunnerFee: number;          // one-time hiring cost
  rumor: string;              // flavor line for the station screen
}

// One line in the comms / chatter feed. "who" is the speaker label
// (e.g. "Gunner Mira", "Raider Drak", "Beacon"), "color" tints the source.
interface ChatterLine {
  t: number;                  // performance.now() / 1000 when posted
  who: string;
  msg: string;
  color: string;
}

interface Options {
  difficulty: typeof DIFFICULTIES[number];
  peaceful: boolean;
  cheat: boolean;
  mouseSteer: boolean;
  mouseSensitivity: number;
  showFps: boolean;
  autosave: boolean;
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
  mission: "u",
  boost: "shift",        // afterburner: extra speed while held, burns fuel fast
  jettison: "j",         // drop one unit of the highest-volume cargo type
  pause: "p",            // toggle pause while in flight
  menu: "escape",
  toggleGunner: "g",     // toggle hired gunner's autopilot rules
};


function defaultOptions(): Options {
  return {
    difficulty: "Normal",
    peaceful: false,
    cheat: false,
    mouseSteer: true,
    mouseSensitivity: 1.0,
    showFps: false,
    autosave: true,

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
  if (e.kind === "station" || e.kind === "planet" || e.kind === "star" || e.kind === "asteroid" || e.kind === "bullet" || e.kind === "loot") return;
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
    reputation: { federation: 0, guild: 0, pirate: 0 },
    kills: 0,
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

// ---- Faction reputation helpers ------------------------------------------
// Reputation is a simple integer per faction. Killing a pirate raises
// Federation/Guild standing slightly; killing a friendly/neutral tanks it.
function adjustRep(p: PlayerState, faction: string, delta: number) {
  if (!p.reputation) p.reputation = { federation: 0, guild: 0, pirate: 0 };
  p.reputation[faction] = (p.reputation[faction] ?? 0) + delta;
}
function repLabel(v: number): string {
  if (v >= 50) return "Allied";
  if (v >= 20) return "Friendly";
  if (v >= 5) return "Liked";
  if (v <= -50) return "KOS";
  if (v <= -20) return "Hostile";
  if (v <= -5) return "Wary";
  return "Neutral";
}

// ---- Gunner factory -------------------------------------------------------
function generateGunner(rng: () => number): Gunner {
  const first = GUNNER_FIRST[Math.floor(rng() * GUNNER_FIRST.length)];
  const last  = GUNNER_LAST[Math.floor(rng() * GUNNER_LAST.length)];
  const gender = ["Female","Male","Nonbinary"][Math.floor(rng() * 3)];
  const species = SPECIES[Math.floor(rng() * SPECIES.length)];
  return {
    name: `${first} ${last}`,
    species,
    gender,
    enabled: true,
    hiredAt: Date.now(),
    cooldown: 0,
    share: 0.0,    // currently cosmetic; reserved for future "wages"
    nextBarkAt: 0,
  };
}

// ---- Station market generation -------------------------------------------
// Deterministic per station id so revisiting a station shows the same
// market. Stock variety is intentional — frontier outposts charge more
// for fuel, refineries pay better for ore, etc.
const MODULE_CATALOG = [
  { id: "cargo-expander",  name: "Cargo Expander",  price: 800,  desc: "+12 cargo capacity" },
  { id: "shield-booster",  name: "Shield Booster",  price: 1100, desc: "+25 shield max" },
  { id: "afterburner-od",  name: "Afterburner OD",  price: 650,  desc: "boost +20% (cheap)" },
  { id: "auto-loader",     name: "Auto-Loader",     price: 900,  desc: "weapon cooldown -15%" },
  { id: "loot-magnet",     name: "Loot Magnet",     price: 500,  desc: "pickup range 3x" },
];

function generateStationStock(stationId: number): StationStock {
  const rng = mulberry32(stationId * 9176 + 7);
  const fuelPrice = 4 + Math.floor(rng() * 5);      // 4..8
  const orePrice  = 7 + Math.floor(rng() * 8);      // 7..14
  // Each station carries 1-3 weapons and 1-3 modules from the catalog.
  const shuffled = <T,>(arr: T[]) => arr.slice().sort(() => rng() - 0.5);
  const weapons = shuffled(WEAPONS).slice(0, 1 + Math.floor(rng() * 3))
    .map((w) => ({ id: w.id, price: Math.round((w.dmg * 40 + w.range * 0.4) * (0.8 + rng() * 0.5)) }));
  const modules = shuffled(MODULE_CATALOG).slice(0, 1 + Math.floor(rng() * 3))
    .map((m) => ({ ...m, price: Math.round(m.price * (0.85 + rng() * 0.4)) }));
  const gunnerFee = 200 + Math.floor(rng() * 400);
  const rumors = [
    "Trader gossip: pirate wing prowling outer belt.",
    "Surveyors report dense ore in deep field.",
    "Federation patrols thin this rotation.",
    "Bounty board: high-value raider sighted.",
    "Refinery shift change — ore prices spike soon.",
  ];
  return {
    fuelPrice, orePrice, weapons, modules, gunnerFee,
    rumor: rumors[Math.floor(rng() * rumors.length)],
  };
}

// Effective ship caps after module installs.
function effectiveCargoMax(p: PlayerState): number {
  const base = SHIP_HULLS.find((h) => h.id === p.ship.hullId)?.cargo ?? p.ship.cargoMax;
  const expanders = p.ship.modules.filter((m) => m === "cargo-expander").length;
  return base + expanders * 12;
}



// =============================================================================
// 7. Input
// =============================================================================
class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  // Mouse position in normalized canvas coords (-1..1, center is 0,0).
  // mouseInside is true while the cursor hovers the canvas.
  mouseNX = 0;
  mouseNY = 0;
  mouseInside = false;
  attach(el: HTMLElement) {
    el.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (["arrowup", "arrowdown", " ", "tab"].includes(k)) e.preventDefault();
    });
    el.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    el.addEventListener("blur", () => { this.keys.clear(); this.mouseInside = false; });
    el.addEventListener("mousemove", (e) => {
      const r = (el as HTMLCanvasElement).getBoundingClientRect();
      this.mouseNX = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNY = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.mouseInside = true;
    });
    el.addEventListener("mouseleave", () => { this.mouseInside = false; });
    el.addEventListener("mouseenter", () => { this.mouseInside = true; });
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
  | "destroyed"
  | "crashed";


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
    case "loot": return "#ffe066";
  }
}

// ---- Visual decoration helpers --------------------------------------------
// Cheap, deterministic per-id / per-cell hash. Used to give each entity its
// own colour tint, surface texture, and ship variant without needing any
// persisted state — same id always produces the same look.
function hash01(n: number): number {
  let x = ((n | 0) * 2654435761) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

// Per-kind palettes — picked by entity id so each planet / station / sun
// reads as its own distinct body instead of a uniform sphere of the same hue.
const PLANET_FILLS  = ["#7ec8ff", "#9fd29b", "#d9a06a", "#c98aff", "#ffd28a", "#7fe3d1"];
const PLANET_EDGES  = ["#3d6d9b", "#5a8a5a", "#8b6038", "#7a4eb0", "#a98a48", "#3d8a82"];
const PLANET_TEX    = ["O", "Q", "@", "o", "Ø", "0"];
const STATION_FILLS = ["#c2c2ff", "#a8ffd0", "#ffc8a0", "#cfe8ff"];
const STATION_TEX   = ["#", "H", "X", "=", "8"];
const STAR_FILLS    = ["#ffd866", "#ffb27a", "#fff0a0", "#ff9966"];
const ASTEROID_FILLS= ["#a6886a", "#8a7656", "#b89a78", "#7a6650"];
const ASTEROID_TEX  = ["%", "*", "#", ":", "."];

function tintFor(e: Entity): { fill: string; edge: string } {
  const h = hash01(e.id);
  switch (e.kind) {
    case "planet": {
      const i = Math.floor(h * PLANET_FILLS.length);
      return { fill: PLANET_FILLS[i], edge: PLANET_EDGES[i] };
    }
    case "station": {
      const i = Math.floor(h * STATION_FILLS.length);
      return { fill: STATION_FILLS[i], edge: "#8a8ad0" };
    }
    case "star": {
      const i = Math.floor(h * STAR_FILLS.length);
      return { fill: STAR_FILLS[i], edge: "#7a5a20" };
    }
    case "asteroid": {
      const i = Math.floor(h * ASTEROID_FILLS.length);
      return { fill: ASTEROID_FILLS[i], edge: "#5a4838" };
    }
    default:
      return { fill: colorFor(e.kind), edge: colorFor(e.kind) };
  }
}

// Surface character for a given cell on a body. Mixes a few glyphs based on
// world-space hashing so the silhouette shows banding / cratering rather than
// being a flat fill of one character.
function surfaceChar(e: Entity, gx: number, gy: number, onEdge: boolean, edgeCh: string, fillCh: string): string {
  if (onEdge) return edgeCh;
  const palette =
    e.kind === "planet"  ? PLANET_TEX :
    e.kind === "station" ? STATION_TEX :
    e.kind === "asteroid"? ASTEROID_TEX :
    null;
  if (!palette) return fillCh;
  const h = hash01(e.id * 131 + gx * 1009 + gy * 7919);
  return palette[Math.floor(h * palette.length)];
}

// 3x3 ship silhouettes per faction. Multiple variants per faction so different
// hostiles / freighters look like distinct hulls rather than identical dots.
const SHIP_SPRITES: Record<string, string[][]> = {
  hostile: [
    [" ^ ", "<X>", " v "],
    ["/^\\", "<#>", "\\v/"],
    [".^.", "[=}", " v "],
    [" A ", "{x}", " V "],
  ],
  friendly: [
    [" ^ ", "[=>", " v "],
    ["/^\\", "<O>", "\\v/"],
    [" . ", "(=]", " ' "],
  ],
  neutral: [
    [" . ", "(o)", " ' "],
    [" ~ ", "[=]", " ~ "],
    [" ^ ", "<o>", " v "],
    ["___", "[D]", "   "],
  ],
};

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
  // Timestamp (seconds) when the player entered the destroyed screen — used
  // for a short input grace period so the death banner is actually readable.
  destroyedAt = 0;
  // Pause toggle (in-flight). When paused, world ticks halt but render continues.
  paused = false;

  // Why the player died and who (or what) killed them. Surfaced on the
  // destroyed screen so the player understands what happened.
  deathReason: string | null = null;
  deathKiller: string | null = null;
  // Crash diagnostics: when the loop throws we freeze on a crashed screen
  // and show the error here so the user isn't silently kicked to the menu.
  crashError: string | null = null;
  crashStack: string | null = null;
  // Autosave bookkeeping. We rotate into the dedicated "autosave" slot every
  // `autosaveInterval` seconds while in flight.
  autosaveTimer = 0;
  autosaveInterval = 120; // seconds

  // Per-station market state, lazily generated on first dock and cached
  // for the rest of the session. Keyed by station entity id.
  stationStocks = new Map<number, StationStock>();
  // Comms / chatter feed (max ~6 lines kept). See pushChatter / renderChatter.
  chatter: ChatterLine[] = [];
  // Cursor in the multi-page station screen.
  stationPage: "main" | "market" | "weapons" | "modules" | "crew" = "main";
  // Throttle for ambient world chatter (hostile taunts, station beacons, etc).
  private _nextAmbientChatterAt = 0;
  // Simple FPS counter (toggleable in Options).
  fps = 0;
  private _fpsAcc = 0;
  private _fpsFrames = 0;
  // Audio: small WebAudio context for cheap beeps (hit / death / dock).
  audio: AudioContext | null = null;

  // Starfield: world-space points that parallax around the player to give a
  // visceral sense of velocity and heading. Lazily seeded on first render.
  // Each star carries a brightness "tier" so the field has depth.
  private stars: { x: number; y: number; z: number; t: number }[] = [];
  // Title-screen drifting stars (camera-local 2D, no player required).
  private titleStars: { x: number; y: number; z: number; t: number }[] = [];
  private _lastRenderTs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.fit();
    window.addEventListener("resize", () => this.fit());
    this.input.attach(canvas);
    canvas.focus();
    // Global error trap so async/uncaught errors during gameplay show on the
    // crash screen instead of vanishing into the console.
    window.addEventListener("error", (ev) => {
      if (this.screen === "playing") this.crash(ev.error ?? new Error(ev.message));
    });
    window.addEventListener("unhandledrejection", (ev) => {
      if (this.screen === "playing") {
        const r = ev.reason;
        this.crash(r instanceof Error ? r : new Error(String(r)));
      }
    });
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
      // FPS sampling
      this._fpsAcc += dt; this._fpsFrames++;
      if (this._fpsAcc >= 0.5) {
        this.fps = Math.round(this._fpsFrames / this._fpsAcc);
        this._fpsAcc = 0; this._fpsFrames = 0;
      }
      // Wrap update+render so a thrown exception lands on the crash screen
      // with a readable stack instead of silently bouncing back to title.
      try {
        this.update(dt);
        this.render();
      } catch (err) {
        this.crash(err);
      }
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

  // Append a single line to the comms / chatter feed shown in the COMMS box.
  // Newest line floats to the top. Capped at 6 lines so it never crowds the HUD.
  pushChatter(who: string, msg: string, color = "#9fe") {
    this.chatter.unshift({ t: performance.now() / 1000, who, msg, color });
    if (this.chatter.length > 6) this.chatter.pop();
  }

  // Cached station market lookup. Generates on first request.
  getStock(stationId: number): StationStock {
    let s = this.stationStocks.get(stationId);
    if (!s) { s = generateStationStock(stationId); this.stationStocks.set(stationId, s); }
    return s;
  }

  // Centralized death handler. Pass a human reason ("Killed by Hostile Reaver",
  // "Collided with Planet P-42", "Hull breach: fuel detonation").
  die(reason: string, killer?: string) {
    if (this.screen === "destroyed") return;
    this.deathReason = reason;
    this.deathKiller = killer ?? null;
    this.pushLog(`☠ ${reason}`);
    this.screen = "destroyed";
    this.destroyedAt = performance.now() / 1000;
    this.menuCursor = 0;
    this.beep(120, 0.6, "sawtooth");
  }

  // Capture a runtime error from the loop / global handlers and freeze on
  // the crash screen. Keeps the player from being silently kicked to menu.
  crash(err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    this.crashError = e.message || "Unknown error";
    this.crashStack = (e.stack || "").split("\n").slice(0, 8).join("\n");
    // eslint-disable-next-line no-console
    console.error("[Voidwake crash]", e);
    this.screen = "crashed";
    this.menuCursor = 0;
  }

  // Tiny WebAudio beep (no asset dependency). Used for hit/death/dock cues.
  beep(freq = 440, dur = 0.08, type: OscillatorType = "square") {
    try {
      if (!this.audio) this.audio = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ctx = this.audio;
      if (ctx.state === "suspended") void ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const vol = this.options.volumeMaster * this.options.volumeSfx * 0.15;
      o.type = type; o.frequency.value = freq;
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch { /* audio unavailable; non-fatal */ }
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
      case "destroyed": return this.updateDestroyed();
      case "crashed": return this.updateCrashed();
    }
  }

  // --- Crash screen (caught exception) ------------------------------------
  crashedItems = ["Load Last Save", "Return to Main Menu", "Reload Page"];
  updateCrashed() {
    this.menuNav(this.crashedItems.length);
    if (this.input.consume("enter")) {
      const c = this.crashedItems[this.menuCursor];
      if (c === "Reload Page") { window.location.reload(); return; }
      if (c === "Load Last Save") {
        const saves = listSaves();
        if (saves.length > 0) {
          const blob = loadGame(saves[0].slot);
          if (blob) {
            this.seed = blob.seed; this.rng = mulberry32(this.seed);
            this.entities = blob.entities; this.player = blob.player; this.options = blob.options;
            this.crashError = null; this.crashStack = null;
            this.screen = "playing";
            this.pushLog(`Recovered from crash via ${saves[0].slot}.`);
            return;
          }
        }
        this.pushLog("No save available.");
      }
      this.player = null;
      this.crashError = null; this.crashStack = null;
      this.screen = "title";
      this.menuCursor = 0;
    }

  }

  // --- Destroyed (death) screen -------------------------------------------
  destroyedItems = ["Load Last Save", "Return to Main Menu"];
  updateDestroyed() {
    // Brief grace period so the player actually reads the banner rather than
    // dismissing it with a held key from the moment of death.
    const now = performance.now() / 1000;
    const grace = 1.0;
    if (now - this.destroyedAt < grace) {
      // Drain any input that fired during the death frame.
      this.input.consume("enter");
      this.input.consume("arrowup");
      this.input.consume("arrowdown");
      return;
    }
    this.menuNav(this.destroyedItems.length);
    if (this.input.consume("enter")) {

      const c = this.destroyedItems[this.menuCursor];
      if (c === "Load Last Save") {
        const saves = listSaves();
        if (saves.length > 0) {
          const blob = loadGame(saves[0].slot);
          if (blob) {
            this.seed = blob.seed;
            this.rng = mulberry32(this.seed);
            this.entities = blob.entities;
            this.player = blob.player;
            this.options = blob.options;
            this.screen = "playing";
            this.pushLog(`Restored from ${saves[0].slot}.`);
            return;
          }
        }
        this.pushLog("No save available.");
      }
      this.player = null;
      this.screen = "title";
      this.menuCursor = 0;
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
    // Safety net: if hull dropped to 0 by any path, go to destroyed screen.
    if (p.ship.hull <= 0 && !this.options.cheat) {
      this.die(this.deathReason ?? "Catastrophic hull failure");
      return;
    }
    const k = this.options.keybinds;
    const keys = this.input.keys;

    // Pause toggle. While paused, we skip all world updates but still let the
    // player open the menu via ESC and read the HUD.
    if (this.input.consume(k.pause)) {
      this.paused = !this.paused;
      this.pushLog(this.paused ? "‖ Paused" : "▶ Resumed");
    }
    if (this.paused) return;

    // Throttle / steering
    if (keys.has(k.throttleUp)) p.throttle = Math.min(1, p.throttle + dt * 0.7);
    if (keys.has(k.throttleDown)) p.throttle = Math.max(0, p.throttle - dt * 0.7);
    if (keys.has(k.yawLeft)) p.heading.yaw -= dt * 1.2;
    if (keys.has(k.yawRight)) p.heading.yaw += dt * 1.2;
    if (keys.has(k.pitchUp)) p.heading.pitch = Math.max(-Math.PI / 2, p.heading.pitch - dt * 1.0);
    if (keys.has(k.pitchDown)) p.heading.pitch = Math.min(Math.PI / 2, p.heading.pitch + dt * 1.0);

    // Mouse steering: cursor offset from canvas center pulls yaw/pitch.
    if (this.options.mouseSteer && this.input.mouseInside) {
      const sens = this.options.mouseSensitivity;
      const dz = 0.08;
      const mx = this.input.mouseNX;
      const my = this.input.mouseNY;
      const ax = Math.abs(mx) > dz ? (mx - Math.sign(mx) * dz) : 0;
      const ay = Math.abs(my) > dz ? (my - Math.sign(my) * dz) : 0;
      p.heading.yaw += ax * dt * 1.4 * sens;
      p.heading.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p.heading.pitch + ay * dt * 1.1 * sens));
    }

    // Afterburner: hold boost for +60% speed at 4x fuel cost. Disabled when dry.
    const boosting = keys.has(k.boost) && p.ship.fuel > 0;
    const boostMul = boosting ? 1.6 : 1.0;
    const fuelMul = boosting ? 4.0 : 1.0;

    // Forward direction from heading
    const fwd = headingToVec(p.heading.yaw, p.heading.pitch);
    // Out-of-fuel: throttle authority drops to a tiny drift. Player can still
    // turn, but movement coasts at 15% until refueled at a station.
    const fuelFactor = p.ship.fuel > 0 ? 1.0 : 0.15;
    const sp = p.ship.speed * p.throttle * boostMul * fuelFactor;
    p.pos = V.add(p.pos, V.scale(fwd, sp * dt));
    if (p.ship.fuel > 0) {
      p.ship.fuel = Math.max(0, p.ship.fuel - sp * dt * 0.001 * fuelMul);
      if (p.ship.fuel === 0) this.pushLog("⚠ FUEL EXHAUSTED — drift only. Dock to refuel.");
    }

    // Shield regen
    p.ship.shield = Math.min(p.ship.shieldMax, p.ship.shield + dt * 4);

    // Cycle target
    if (this.input.consume(k.cycleTarget)) this.cycleTarget();

    // Jettison: drop one unit of the heaviest cargo item.
    if (this.input.consume(k.jettison)) {
      const items = Object.entries(p.cargo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (items.length) {
        const [name] = items[0];
        p.cargo[name] = (p.cargo[name] ?? 0) - 1;
        if (p.cargo[name] <= 0) delete p.cargo[name];
        this.pushLog(`Jettisoned 1 ${name}.`);
        this.beep(320, 0.05);
      } else {
        this.pushLog("Cargo hold is empty.");
      }
    }

    // Fire
    p.cooldown -= dt;
    if (keys.has(k.fire) && p.cooldown <= 0 && !this.options.peaceful && p.ship.fuel >= 0) {
      const w = WEAPONS.find((x) => x.id === p.ship.weaponId) ?? WEAPONS[0];
      p.cooldown = w.cooldown;
      this.entities.push({
        id: nextId(), kind: "bullet", name: "shot",
        pos: { ...p.pos }, vel: V.scale(fwd, 260),
        faction: "player", ownerId: -1, ttl: 2,
        ttlAt: performance.now() / 1000 + 2,
      });
      this.beep(880, 0.04, "square");
    }

    // Mine
    if (this.input.consume(k.mine)) this.mineTarget();
    // Dock
    if (this.input.consume(k.dock)) this.tryDock();
    // Open station menu shortcut
    if (this.input.consume(k.station)) this.tryDock();
    // Toggle gunner autopilot (if hired).
    if (this.input.consume(k.toggleGunner) && p.gunner) {
      p.gunner.enabled = !p.gunner.enabled;
      const tag = `Gunner ${p.gunner.name.split(" ")[0]}`;
      this.pushChatter(tag, p.gunner.enabled ? "Standing by, weapons hot." : "Standing down.", "#fc6");
    }
    void k.mission;

    // Gunner autopilot + loot pickup + ambient chatter (cheap per-tick work).
    this.updateGunner(dt, fwd);
    this.pickupLoot();
    this.tickAmbientChatter(dt);

    // Autosave on a timer (rotates into the dedicated "autosave" slot).
    this.autosaveTimer += dt;
    if (this.options.autosave && this.autosaveTimer >= this.autosaveInterval) {
      this.autosaveTimer = 0;
      try {
        const blob: SaveBlob = {
          version: VERSION, seed: this.seed,
          player: p, entities: this.entities,
          options: this.options, savedAt: Date.now(),
        };
        saveGame("autosave", blob);
        p.lastSaveAt = Date.now();
        this.pushLog("◉ Autosaved.");
      } catch (err) {
        console.warn("Autosave failed", err);
      }
    }

    // Collision damage vs large bodies (planets / stars / stations / rocks).
    // Stations dock instead of colliding at the dock-range we use elsewhere.
    if (!this.options.cheat) {
      for (const e of this.entities) {
        if (e.kind !== "planet" && e.kind !== "star" && e.kind !== "asteroid" && e.kind !== "station") continue;
        const radius = e.kind === "star" ? 40 : e.kind === "planet" ? 30 : e.kind === "station" ? 18 : 10;
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < radius) {
          // Push the player back to the surface and apply scaled damage.
          const n = V.scale(V.sub(p.pos, e.pos), 1 / Math.max(0.0001, d));
          p.pos = V.add(e.pos, V.scale(n, radius + 0.5));
          if (e.kind === "station") {
            // Stations bump but don't kill; remind the pilot to dock.
            p.throttle = Math.min(p.throttle, 0.1);
            this.pushLog(`Bumped ${e.name} — press F to dock.`);
            this.beep(220, 0.06, "square");
            continue;
          }
          const dmg = (e.kind === "star" ? 120 : 25) * this.dmgScale() * dt * 4;
          if ((p.ship.shield ?? 0) > 0) p.ship.shield = Math.max(0, p.ship.shield - dmg);
          else p.ship.hull = Math.max(0, p.ship.hull - dmg);
          this.beep(180, 0.05, "triangle");
          if (p.ship.hull <= 0) {
            this.die(`Collision with ${e.kind} ${e.name}`, e.name);
            return;
          }
        }
      }
    }

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
          this.beep(220, 0.04, "sawtooth");
          if (p.ship.hull <= 0) {
            const shooter = this.entities.find((x) => x.id === e.ownerId);
            const killer = shooter?.name ?? e.faction;
            this.die(`Killed by ${killer}`, killer);
          }
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
            p.kills = (p.kills ?? 0) + 1;
            // Faction reputation: smiting pirates curries favor with the
            // Federation and Guild; popping civilians sours both.
            if (t.faction === "pirate") {
              adjustRep(p, "federation", 2); adjustRep(p, "guild", 1); adjustRep(p, "pirate", -3);
            } else if (t.faction === "federation") {
              adjustRep(p, "federation", -8); adjustRep(p, "pirate", 2);
            } else if (t.faction === "guild") {
              adjustRep(p, "guild", -5); adjustRep(p, "pirate", 1);
            }
            // Loot canister: small chance of credits + ore drop. Floats on
            // the kill's velocity so the player can chase it down.
            if (Math.random() < 0.85) {
              this.entities.push({
                id: nextId(), kind: "loot", name: "canister",
                pos: { ...t.pos },
                vel: V.scale(t.vel, 0.25),
                faction: "wreck",
                ttlAt: performance.now() / 1000 + 45,
                loot: {
                  credits: 20 + Math.floor(Math.random() * 80),
                  ore: Math.floor(Math.random() * 4),
                },
              });
            }
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
    this.beep(660, 0.08, "sine"); this.beep(990, 0.08, "sine");

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

  // --- Gunner autopilot ---------------------------------------------------
  // "Smart with rules" (selected during character creation discussion):
  //  - Auto-fires only on hostiles that are centered in the reticle and in range.
  //  - Auto-mines an asteroid centered in the reticle if cargo isn't full.
  //  - Never auto-docks; instead, posts a "suggest we dock" chatter line.
  // Targeting uses forward dot-product, not the cycled targetId, so the
  // gunner reacts to whatever you actually point at.
  updateGunner(dt: number, fwd: Vec3) {
    const p = this.player; if (!p || !p.gunner || !p.gunner.enabled) return;
    if (this.options.peaceful) return;
    const g = p.gunner;
    g.cooldown -= dt;
    g.nextBarkAt -= dt;

    // Pick the entity most aligned with forward (smallest angle), within 800u.
    let best: Entity | null = null;
    let bestDot = 0.94;       // cosine threshold (~20° cone)
    let bestDist = Infinity;
    for (const e of this.entities) {
      if (e.kind !== "hostile" && e.kind !== "asteroid" && e.kind !== "station") continue;
      if ((e.hull ?? 1) <= 0 && e.kind === "hostile") continue;
      const rel = V.sub(e.pos, p.pos);
      const d = V.len(rel);
      if (d < 1 || d > 800) continue;
      const dotv = (rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z) / d;
      if (dotv > bestDot) { bestDot = dotv; best = e; bestDist = d; }
    }
    if (!best) return;

    const tag = `Gunner ${g.name.split(" ")[0]}`;
    if (best.kind === "hostile") {
      const w = WEAPONS.find((x) => x.id === p.ship.weaponId) ?? WEAPONS[0];
      if (bestDist > w.range) return;
      if (g.cooldown > 0) return;
      g.cooldown = w.cooldown * 1.15;   // slightly slower than manual fire
      this.entities.push({
        id: nextId(), kind: "bullet", name: "shot",
        pos: { ...p.pos }, vel: V.scale(fwd, 260),
        faction: "player", ownerId: -2, ttl: 2,
        ttlAt: performance.now() / 1000 + 2,
      });
      this.beep(820, 0.04, "square");
      if (g.nextBarkAt <= 0) {
        g.nextBarkAt = 2.5 + Math.random() * 2;
        this.pushChatter(tag, GUNNER_BARKS_HOSTILE[Math.floor(Math.random() * GUNNER_BARKS_HOSTILE.length)], "#ff8a8a");
      }
    } else if (best.kind === "asteroid") {
      if (bestDist > 200) return;
      if (g.cooldown > 0) return;
      if (cargoTotal(p) >= p.ship.cargoMax) return;
      if ((best.ore ?? 0) <= 0) return;
      g.cooldown = 0.35;
      best.ore!--;
      p.cargo.ore = (p.cargo.ore ?? 0) + 1;
      awardXP(p, 1);
      if (g.nextBarkAt <= 0) {
        g.nextBarkAt = 4 + Math.random() * 3;
        this.pushChatter(tag, GUNNER_BARKS_MINE[Math.floor(Math.random() * GUNNER_BARKS_MINE.length)], "#ffd066");
      }
    } else if (best.kind === "station") {
      if (bestDist > 400) return;
      if (g.nextBarkAt > 0) return;
      g.nextBarkAt = 12 + Math.random() * 8;
      this.pushChatter(tag, GUNNER_BARKS_DOCK[Math.floor(Math.random() * GUNNER_BARKS_DOCK.length)], "#9fe");
    }
  }

  // Sweep loot canisters near the player and absorb their contents.
  // Pickup radius widens if a "loot-magnet" module is installed.
  pickupLoot() {
    const p = this.player; if (!p) return;
    const magnet = p.ship.modules.includes("loot-magnet") ? 60 : 20;
    const now = performance.now() / 1000;
    this.entities = this.entities.filter((e) => {
      if (e.kind !== "loot") return true;
      // Expire stale canisters so the world doesn't fill with junk.
      if (e.ttlAt && e.ttlAt < now) return false;
      if (V.len(V.sub(e.pos, p.pos)) > magnet) return true;
      const cr = e.loot?.credits ?? 0;
      const ore = e.loot?.ore ?? 0;
      if (cr) p.credits += cr;
      if (ore && cargoTotal(p) < p.ship.cargoMax) {
        const take = Math.min(ore, p.ship.cargoMax - cargoTotal(p));
        p.cargo.ore = (p.cargo.ore ?? 0) + take;
      }
      this.pushLog(`Salvaged canister: +${cr}cr +${ore} ore`);
      this.beep(540, 0.05, "sine");
      return false;
    });
    void before;
  }

  // Periodically inject a flavor chatter line from nearby NPCs / stations /
  // planets. Cheap timer-gated work, mostly atmospheric.
  tickAmbientChatter(dt: number) {
    const p = this.player; if (!p) return;
    this._nextAmbientChatterAt -= dt;
    if (this._nextAmbientChatterAt > 0) return;
    this._nextAmbientChatterAt = 8 + Math.random() * 10;
    // Find a candidate within 1500u, prefer interesting kinds.
    const near = this.entities
      .filter((e) => e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral" || e.kind === "station" || e.kind === "planet")
      .map((e) => ({ e, d: V.len(V.sub(e.pos, p.pos)) }))
      .filter((x) => x.d < 1500)
      .sort((a, b) => a.d - b.d);
    if (near.length === 0) return;
    const pick = near[Math.floor(Math.random() * Math.min(4, near.length))].e;
    switch (pick.kind) {
      case "hostile":
        this.pushChatter(pick.name, HOSTILE_TAUNTS[Math.floor(Math.random() * HOSTILE_TAUNTS.length)], "#ff8a8a");
        break;
      case "friendly":
        this.pushChatter(pick.name, FRIENDLY_GREETS[Math.floor(Math.random() * FRIENDLY_GREETS.length)], "#aef58a");
        break;
      case "neutral":
        this.pushChatter(pick.name, NEUTRAL_CHATTER[Math.floor(Math.random() * NEUTRAL_CHATTER.length)], "#dddddd");
        break;
      case "station":
        this.pushChatter(`Beacon ${pick.name}`, STATION_BROADCASTS[Math.floor(Math.random() * STATION_BROADCASTS.length)], "#c2c2ff");
        break;
      case "planet":
        this.pushChatter(pick.name, PLANET_HAILS[Math.floor(Math.random() * PLANET_HAILS.length)], "#7ec8ff");
        break;
    }
    // If the gunner is around and bored, occasionally chime in.
    if (p.gunner && Math.random() < 0.35) {
      const tag = `Gunner ${p.gunner.name.split(" ")[0]}`;
      this.pushChatter(tag, GUNNER_BARKS_IDLE[Math.floor(Math.random() * GUNNER_BARKS_IDLE.length)], "#fc6");
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
      `Mouse Steer: ${this.options.mouseSteer ? "ON" : "OFF"}`,
      `Mouse Sensitivity: ${this.options.mouseSensitivity.toFixed(2)}`,
      `Show FPS: ${this.options.showFps ? "ON" : "OFF"}`,
      `Autosave: ${this.options.autosave ? "ON" : "OFF"}`,
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
    if (i === 3 && (left || right)) this.options.mouseSteer = !this.options.mouseSteer;
    if (i === 4) this.options.mouseSensitivity = Math.max(0.1, Math.min(3, this.options.mouseSensitivity + (right ? 0.1 : left ? -0.1 : 0)));
    if (i === 5 && (left || right)) this.options.showFps = !this.options.showFps;
    if (i === 6 && (left || right)) this.options.autosave = !this.options.autosave;
    if (i === 7) this.options.volumeMaster = clamp01(this.options.volumeMaster + (right ? 0.05 : left ? -0.05 : 0));
    if (i === 8) this.options.volumeSfx = clamp01(this.options.volumeSfx + (right ? 0.05 : left ? -0.05 : 0));
    if (i === 9) this.options.volumeMusic = clamp01(this.options.volumeMusic + (right ? 0.05 : left ? -0.05 : 0));
    if (i === 10) this.options.unsavedWarnMinutes = Math.max(1, this.options.unsavedWarnMinutes + (right ? 1 : left ? -1 : 0));
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

    // Frame delta for starfield motion (independent of game tick).
    const now = performance.now() / 1000;
    const sdt = Math.min(0.1, this._lastRenderTs ? now - this._lastRenderTs : 0.016);
    this._lastRenderTs = now;

    // Starfield layer — drawn first so menus/HUD/entities overdraw it.
    if (this.screen === "playing" && this.player) {
      this.drawWorldStarfield(grid, sdt);
    } else if (
      this.screen === "title" || this.screen === "create-char" ||
      this.screen === "create-ship" || this.screen === "load" ||
      this.screen === "options" || this.screen === "destroyed" ||
      this.screen === "crashed" || this.screen === "quit-confirm"
    ) {
      this.drawTitleStarfield(grid, sdt);
    }

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
      case "destroyed": this.renderDestroyed(grid); break;
      case "crashed": this.renderCrashed(grid); break;
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

  // Starfield -----------------------------------------------------------------
  // World-space stars projected through the player's camera. Because the
  // points are fixed in world coordinates, translating (throttle / afterburner)
  // makes them stream outward from the heading vector and yawing/pitching
  // sweeps them across the viewport — exactly the velocity cue requested.
  drawWorldStarfield(g: Cell[][], _dt: number) {
    const p = this.player; if (!p) return;
    const cols = g[0].length, rows = g.length;
    const vpTop = 1, vpLeft = 1, vpRight = cols - 28, vpBottom = rows - 9;
    const vw = vpRight - vpLeft, vh = vpBottom - vpTop;

    // Lazy seed / top-up: keep ~220 stars in a sphere around the player.
    const TARGET = 220;
    const R = 600;
    if (this.stars.length === 0) {
      for (let i = 0; i < TARGET; i++) this.stars.push(this.spawnWorldStar(R, false));
    }

    const cy = Math.cos(p.heading.yaw), sy = Math.sin(p.heading.yaw);
    const cp = Math.cos(p.heading.pitch), sp = Math.sin(p.heading.pitch);
    // Forward vector (inverse camera applied to +Z) — used to respawn stars
    // ahead of the ship so the field never empties out as we fly.
    const fwd = { x: sy * cp, y: sp, z: cy * cp };

    // Three brightness tiers; gray, low-alpha-feeling palette.
    const PAL = ["#1a1f2a", "#2b3346", "#3d4a66"];
    const CH = [".", ".", "·"];

    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const rx = s.x - p.pos.x, ry = s.y - p.pos.y, rz = s.z - p.pos.z;
      const x1 = cy * rx - sy * rz;
      const z1 = sy * rx + cy * rz;
      const y1 = cp * ry - sp * z1;
      const z2 = sp * ry + cp * z1;
      // Cull behind / too-far / off-screen and respawn ahead of the ship.
      const dist2 = rx * rx + ry * ry + rz * rz;
      const offscreen = z2 <= 1 || dist2 > R * R * 2.2;
      let sx = 0, sy2 = 0;
      if (!offscreen) {
        sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
        sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      }
      if (offscreen || sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) {
        // Respawn somewhere in a forward cone so the next frame still has it.
        const ahead = 0.35 * R + Math.random() * R * 0.9;
        const spread = R * 0.9;
        const ox = (Math.random() - 0.5) * spread;
        const oy = (Math.random() - 0.5) * spread;
        const oz = (Math.random() - 0.5) * spread;
        s.x = p.pos.x + fwd.x * ahead + ox;
        s.y = p.pos.y + fwd.y * ahead + oy;
        s.z = p.pos.z + fwd.z * ahead + oz;
        s.t = Math.floor(Math.random() * 3);
        continue;
      }
      // Only paint into empty cells so the starfield never clobbers HUD/entities.
      const cell = g[sy2][sx];
      if (cell.ch === " ") {
        const t = s.t | 0;
        g[sy2][sx] = { ch: CH[t], color: PAL[t] };
      }
    }
  }

  // Pre-flight / menu starfield: a simple 2D parallax that drifts toward the
  // viewer at a calm pace so the title doesn't feel static.
  drawTitleStarfield(g: Cell[][], dt: number) {
    const cols = g[0].length, rows = g.length;
    if (this.titleStars.length === 0) {
      for (let i = 0; i < 180; i++) {
        this.titleStars.push({
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2,
          z: 0.05 + Math.random() * 1.0,
          t: Math.floor(Math.random() * 3),
        });
      }
    }
    const PAL = ["#181d27", "#262d3d", "#39455e"];
    const CH = [".", ".", "·"];
    const cx = cols / 2, cy0 = rows / 2;
    for (const s of this.titleStars) {
      s.z -= dt * 0.25; // drift toward viewer
      if (s.z <= 0.04) {
        s.x = (Math.random() - 0.5) * 2;
        s.y = (Math.random() - 0.5) * 2;
        s.z = 1.0;
        s.t = Math.floor(Math.random() * 3);
      }
      const sx = Math.floor(cx + (s.x / s.z) * cols * 0.5);
      const sy = Math.floor(cy0 + (s.y / s.z) * rows * 0.5);
      if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
      if (g[sy][sx].ch !== " ") continue;
      const t = s.t | 0;
      g[sy][sx] = { ch: CH[t], color: PAL[t] };
    }
  }

  // World-star spawner — uniform-ish points in a sphere around the player.
  private spawnWorldStar(R: number, _ahead: boolean) {
    const p = this.player;
    const px = p?.pos.x ?? 0, py = p?.pos.y ?? 0, pz = p?.pos.z ?? 0;
    // Reject-sample inside a sphere of radius R for an even distribution.
    let x = 0, y = 0, z = 0;
    do {
      x = (Math.random() - 0.5) * 2 * R;
      y = (Math.random() - 0.5) * 2 * R;
      z = (Math.random() - 0.5) * 2 * R;
    } while (x * x + y * y + z * z > R * R);
    return { x: px + x, y: py + y, z: pz + z, t: Math.floor(Math.random() * 3) };
  }

  // Title screen ------------------------------------------------------------
  renderTitle(g: Cell[][]) {
    // Clean block-letter banner. Each glyph is exactly 9 cols wide so the
    // whole word reads as "V O I D W A K E" instead of a tangled diagonal.
    const banner = [
      "██╗   ██╗ ██████╗ ██╗██████╗ ██╗    ██╗ █████╗ ██╗  ██╗███████╗",
      "██║   ██║██╔═══██╗██║██╔══██╗██║    ██║██╔══██╗██║ ██╔╝██╔════╝",
      "██║   ██║██║   ██║██║██║  ██║██║ █╗ ██║███████║█████╔╝ █████╗  ",
      "╚██╗ ██╔╝██║   ██║██║██║  ██║██║███╗██║██╔══██║██╔═██╗ ██╔══╝  ",
      " ╚████╔╝ ╚██████╔╝██║██████╔╝╚███╔███╔╝██║  ██║██║  ██╗███████╗",
      "  ╚═══╝   ╚═════╝ ╚═╝╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝",
    ];
    const cols = g[0].length;
    const bx = Math.max(2, Math.floor((cols - banner[0].length) / 2));
    banner.forEach((line, i) => putText(g, bx, 2 + i, line, "#7CFC00"));
    const tag = "— ASCII SPACE SIMULATION —";
    putText(g, Math.floor((cols - tag.length) / 2), 2 + banner.length, tag, "#5fc");
    putText(g, Math.floor((cols - ("v" + VERSION).length) / 2), 3 + banner.length, "v" + VERSION, "#678");
    const menuTop = 5 + banner.length + 2;
    this.titleItems.forEach((it, i) => {
      const sel = i === this.menuCursor;
      const label = (sel ? "▸ " : "  ") + it;
      putText(g, Math.floor((cols - 16) / 2), menuTop + i * 2, label, sel ? "#fff" : "#9fe");
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
      `Mouse Steer: ${this.options.mouseSteer ? "ON" : "OFF"}`,
      `Mouse Sensitivity: ${this.options.mouseSensitivity.toFixed(2)}`,
      `Show FPS: ${this.options.showFps ? "ON" : "OFF"}`,
      `Autosave: ${this.options.autosave ? "ON" : "OFF"}`,
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
  renderDestroyed(g: Cell[][]) {
    const cols = g[0].length;
    const cx = Math.floor(cols / 2);
    const banner = [
      "  ____  _   _ ___ ____    ____  _____ ____ _____ ____   _____   _______ ____  ",
      " / ___|| | | |_ _|  _ \\  |  _ \\| ____/ ___|_   _|  _ \\ / _ \\ \\ / / ____|  _ \\ ",
      " \\___ \\| |_| || || |_) | | | | |  _| \\___ \\ | | | |_) | | | \\ V /|  _| | | | |",
      "  ___) |  _  || ||  __/  | |_| | |___ ___) || | |  _ <| |_| || | | |___| |_| |",
      " |____/|_| |_|___|_|     |____/|_____|____/ |_| |_| \\_\\___/ |_| |_____|____/ ",
    ];
    banner.forEach((line, i) => putText(g, Math.max(2, cx - Math.floor(line.length / 2)), 3 + i, line, "#ff4d4d"));
    const p = this.player;
    putText(g, cx - 18, 11, "Your ship has been destroyed.", "#fff");
    // Death reason / cause-of-death summary
    if (this.deathReason) {
      putText(g, cx - 18, 12, `Cause: ${this.deathReason}`, "#fc6");
    }
    if (p) {
      putText(g, cx - 18, 14, `Cmdr ${p.char.name} — Rank ${p.rank}  ${p.credits}cr  XP ${p.xp}`, "#9fe");
      putText(g, cx - 18, 15, `Last position  ${p.pos.x.toFixed(0)}, ${p.pos.y.toFixed(0)}, ${p.pos.z.toFixed(0)}`, "#9fe");
    }
    const saves = listSaves();
    const last = saves[0];
    putText(g, cx - 18, 17, last ? `Last save: ${last.slot} (${new Date(last.savedAt).toLocaleString()})` : "No saves on record.", "#888");
    this.destroyedItems.forEach((it, i) => {
      const sel = i === this.menuCursor;
      const disabled = it === "Load Last Save" && !last;
      const color = disabled ? "#555" : (sel ? "#fff" : "#9fe");
      putText(g, cx - 16, 20 + i * 2, (sel ? "▸ " : "  ") + it, color);
    });
    putText(g, cx - 16, g.length - 2, "↑/↓ select   ENTER confirm", "#888");
  }

  // Crash screen: shown when the game loop or a global error handler trips.
  // Mirrors the destroyed-screen layout but uses a yellow banner and includes
  // the error message + a short stack so the player can report what happened.
  renderCrashed(g: Cell[][]) {
    const cols = g[0].length;
    const cx = Math.floor(cols / 2);
    const banner = [
      "  ____ ____      _    ____  _   _ _____ ____  ",
      " / ___|  _ \\    / \\  / ___|| | | | ____|  _ \\ ",
      "| |   | |_) |  / _ \\ \\___ \\| |_| |  _| | | | |",
      "| |___|  _ <  / ___ \\ ___) |  _  | |___| |_| |",
      " \\____|_| \\_\\/_/   \\_\\____/|_| |_|_____|____/ ",
    ];
    banner.forEach((line, i) => putText(g, Math.max(2, cx - Math.floor(line.length / 2)), 2 + i, line, "#ffcc33"));
    putText(g, 4, 9, "The game loop hit an unexpected error.", "#fff");
    putText(g, 4, 10, "Your last save (if any) is unaffected — recover below.", "#9fe");
    putText(g, 4, 12, `error: ${this.crashError ?? "(unknown)"}`, "#ff8a8a");
    const stack = (this.crashStack ?? "").split("\n");
    stack.slice(0, 6).forEach((line, i) => putText(g, 6, 13 + i, line.slice(0, cols - 8), "#888"));
    const saves = listSaves();
    const last = saves[0];
    putText(g, 4, 21, last ? `Last save: ${last.slot} (${new Date(last.savedAt).toLocaleString()})` : "No saves on record.", "#888");
    this.crashedItems.forEach((it, i) => {
      const sel = i === this.menuCursor;
      const disabled = it === "Load Last Save" && !last;
      const color = disabled ? "#555" : (sel ? "#fff" : "#9fe");
      putText(g, 6, 23 + i * 2, (sel ? "▸ " : "  ") + it, color);
    });
    putText(g, 4, g.length - 2, "↑/↓ select   ENTER confirm", "#888");
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
    // World radius per entity kind — used to scale on-screen sprites with
    // distance so big objects (stars, stations, planets) read as solid.
    const worldRadius: Record<string, number> = {
      star: 40, planet: 30, station: 18, asteroid: 8,
      ship: 4, bullet: 0.5,
    };
    // Sort far→near so close objects overdraw distant ones.
    const projected: { e: Entity; sx: number; sy: number; z: number; r: number }[] = [];
    for (const e of this.entities) {
      const r = V.sub(e.pos, p.pos);
      const x1 = cy * r.x - sy * r.z;
      const z1 = sy * r.x + cy * r.z;
      const y1 = cp * r.y - sp * z1;
      const z2 = sp * r.y + cp * z1;
      if (z2 <= 1) continue; // behind camera
      const sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
      const sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      // Apparent radius in grid cells. CELL_H/CELL_W ≈ 1.78 → squash vertically.
      const wr = worldRadius[e.kind] ?? 1;
      const rCells = (wr / z2) * vw * 0.7;
      projected.push({ e, sx, sy: sy2, z: z2, r: rCells });
    }
    projected.sort((a, b) => b.z - a.z);

    // Helper: project a world point into the same camera space as entities.
    // Returns null if behind the camera. Used for ship exhaust trail endpoints.
    const projectPoint = (wx: number, wy: number, wz: number): { sx: number; sy: number; z: number } | null => {
      const rxw = wx - p.pos.x, ryw = wy - p.pos.y, rzw = wz - p.pos.z;
      const x1 = cy * rxw - sy * rzw;
      const z1 = sy * rxw + cy * rzw;
      const y1 = cp * ryw - sp * z1;
      const z2 = sp * ryw + cp * z1;
      if (z2 <= 1) return null;
      return {
        sx: vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7),
        sy: vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7),
        z: z2,
      };
    };

    for (const proj of projected) {
      const { e, sx, sy: sy2, r: rCells } = proj;
      const glyph = GLYPHS[e.kind];
      const tint = tintFor(e);

      // --- Ships (hostile / friendly / neutral): silhouette + exhaust ------
      if (e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral") {
        // Engine exhaust: a fading trail drawn behind the ship along its
        // velocity vector. When the ship is moving away the trail points
        // toward the camera and glows; when moving toward us it tucks behind
        // the hull, which is the natural depth cue we want.
        const vmag = Math.hypot(e.vel.x, e.vel.y, e.vel.z);
        if (vmag > 0.5) {
          const inv = 1 / vmag;
          const ex = e.vel.x * inv, ey = e.vel.y * inv, ez = e.vel.z * inv;
          // Trail length scales with apparent size and speed, capped so it
          // never paints the entire viewport.
          const trailLen = Math.min(60, 6 + vmag * 0.6);
          const segs = 4;
          const palette = e.kind === "hostile"
            ? ["#ffd28a", "#ff8a3a", "#c34a14", "#5a1d08"]
            : e.kind === "friendly"
              ? ["#d8ffe2", "#7CFC00", "#2a8a14", "#0d3a08"]
              : ["#cfe8ff", "#7aa8d8", "#3a5a8a", "#16223a"];
          const trailCh = ["*", "+", ".", "·"];
          for (let i = 1; i <= segs; i++) {
            const t = (i / segs) * trailLen;
            const wp = projectPoint(e.pos.x - ex * t, e.pos.y - ey * t, e.pos.z - ez * t);
            if (!wp) break;
            if (wp.sx <= vpLeft || wp.sx >= vpRight || wp.sy <= vpTop || wp.sy >= vpBottom) continue;
            const cell = g[wp.sy][wp.sx];
            if (cell.ch !== " " && cell.ch !== "." && cell.ch !== "·") continue;
            g[wp.sy][wp.sx] = { ch: trailCh[i - 1], color: palette[i - 1] };
          }
        }

        // Hull. Single glyph when far, 3x3 silhouette when close enough to read.
        if (rCells < 1.0) {
          if (sx > vpLeft && sx < vpRight && sy2 > vpTop && sy2 < vpBottom) {
            g[sy2][sx] = { ch: glyph, color: tint.fill };
          }
        } else {
          const variants = SHIP_SPRITES[e.kind];
          const sprite = variants[Math.floor(hash01(e.id) * variants.length)];
          for (let dy = -1; dy <= 1; dy++) {
            const row = sprite[dy + 1];
            for (let dx = -1; dx <= 1; dx++) {
              const ch = row[dx + 1];
              if (ch === " ") continue;
              const gx = sx + dx, gy = sy2 + dy;
              if (gx <= vpLeft || gx >= vpRight || gy <= vpTop || gy >= vpBottom) continue;
              g[gy][gx] = { ch, color: tint.fill };
            }
          }
        }

        // Label far-enough ships so the player can identify what they see.
        if (rCells >= 1.5 && e.name) {
          const lx = sx - Math.floor(e.name.length / 2);
          const ly = sy2 + 2;
          if (ly < vpBottom) putText(g, Math.max(vpLeft + 1, lx), ly, e.name, "#9fe");
        }
        continue;
      }

      // --- Distant non-ship body: single glyph -----------------------------
      if (rCells < 1.2) {
        if (sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) continue;
        g[sy2][sx] = { ch: glyph, color: tint.fill };
        continue;
      }

      // --- Close non-ship body: textured filled sprite ---------------------
      const rx = Math.max(1, Math.round(rCells));
      const ry = Math.max(1, Math.round(rCells * (CELL_W / CELL_H)));
      const fill =
        e.kind === "star" ? "*" :
        e.kind === "planet" ? "O" :
        e.kind === "station" ? "#" :
        e.kind === "asteroid" ? "%" : glyph;
      const edge =
        e.kind === "station" ? "=" :
        e.kind === "planet" ? "o" :
        e.kind === "star" ? "+" : fill;

      // Star glow halo — a faint outer ring outside the solid disc so the
      // central star reads as a luminous source rather than a flat blob.
      if (e.kind === "star") {
        const haloR = 1.45;
        const haloChars = ["+", "·", "."];
        const haloCol = "#5a4823";
        const hrx = Math.max(2, Math.round(rx * haloR));
        const hry = Math.max(1, Math.round(ry * haloR));
        for (let dy = -hry; dy <= hry; dy++) {
          for (let dx = -hrx; dx <= hrx; dx++) {
            const nx = dx / hrx, ny = dy / hry;
            const d2 = nx * nx + ny * ny;
            if (d2 <= 1.0 || d2 > haloR * haloR) continue;
            const gx = sx + dx, gy = sy2 + dy;
            if (gx <= vpLeft || gx >= vpRight || gy <= vpTop || gy >= vpBottom) continue;
            if (g[gy][gx].ch !== " ") continue;
            const t = Math.min(2, Math.floor((d2 - 1.0) / 0.15));
            g[gy][gx] = { ch: haloChars[t], color: haloCol };
          }
        }
      }

      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const nx = dx / rx, ny = dy / ry;
          const d2 = nx * nx + ny * ny;
          if (d2 > 1) continue;
          const gx = sx + dx, gy = sy2 + dy;
          if (gx <= vpLeft || gx >= vpRight || gy <= vpTop || gy >= vpBottom) continue;
          const onEdge = d2 > 0.7;
          const ch = surfaceChar(e, gx, gy, onEdge, edge, fill);
          g[gy][gx] = { ch, color: onEdge ? tint.edge : tint.fill };
        }
      }

      // Label big objects centered just below the sprite.
      if (rCells >= 3 && e.name) {
        const lx = sx - Math.floor(e.name.length / 2);
        const ly = sy2 + ry + 1;
        if (ly < vpBottom) putText(g, Math.max(vpLeft + 1, lx), ly, e.name, "#9fe");
      }
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

    // --- Controls reminder, anchored to the bottom of the right panel ------
    // Always visible so new pilots aren't stranded looking for the keymap.
    const cTop = vpBottom - 16;
    putText(g, panelX, cTop, "[ CONTROLS ]", "#7CFC00");
    const mouseLine = this.options.mouseSteer ? "Mouse  steer (toggle in Opts)" : "Mouse  off";
    const ctrls: [string, string][] = [
      ["W / S", "throttle ±"],
      ["A / D", "yaw L/R"],
      ["Q / E", "pitch U/D"],
      ["SHIFT", "afterburner"],
      ["SPACE", "fire"],
      ["T", "cycle target"],
      ["M", "mine target"],
      ["F", "dock / station"],
      ["J", "jettison cargo"],
      ["P", "pause"],
      ["ESC", "menu"],
    ];
    ctrls.forEach((row, i) => {
      putText(g, panelX, cTop + 1 + i, row[0].padEnd(7) + row[1], "#9fe");
    });
    putText(g, panelX, cTop + 1 + ctrls.length, mouseLine, "#8cf");



    // --- Bottom: radar + status ---
    const rTop = vpBottom + 1;
    this.renderRadar(g, 2, rTop, 22, 7);
    putText(g, 28, rTop, "[ SYSTEM ]", "#7CFC00");
    putText(g, 28, rTop + 1, `Seed ${this.seed}`, "#9fe");
    putText(g, 28, rTop + 2, `Pos ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)}`, "#9fe");
    putText(g, 28, rTop + 3, `Heading yaw ${(p.heading.yaw).toFixed(2)} pitch ${(p.heading.pitch).toFixed(2)}`, "#9fe");
    putText(g, 28, rTop + 4, `Mission: ${p.mission ? p.mission.description : "(none)"}`, "#fb6");
    if (p.mission?.done) {
      putText(g, 28, rTop + 5, "→ Return to a station to claim reward", "#cf6");
    } else if (p.mission) {
      // Mission guidance: bearing + distance to objective.
      const m = p.mission;
      let mt: Entity | undefined;
      if (m.targetId) mt = this.entities.find((e) => e.id === m.targetId);
      else if (m.kind === "deliver") {
        // nearest station for delivery
        const stations = this.entities.filter((e) => e.kind === "station");
        stations.sort((a, b) => V.len(V.sub(a.pos, p.pos)) - V.len(V.sub(b.pos, p.pos)));
        mt = stations[0];
      }
      if (mt) {
        const rel = V.sub(mt.pos, p.pos);
        const d = V.len(rel);
        // Project into camera space to derive an arrow
        const cy3 = Math.cos(p.heading.yaw), sy3 = Math.sin(p.heading.yaw);
        const cp3 = Math.cos(p.heading.pitch), sp3 = Math.sin(p.heading.pitch);
        const x1 = cy3 * rel.x - sy3 * rel.z;
        const z1 = sy3 * rel.x + cy3 * rel.z;
        const y1 = cp3 * rel.y - sp3 * z1;
        const z2 = sp3 * rel.y + cp3 * z1;
        let arrow: string;
        if (z2 < 0) arrow = "↻ TURN AROUND";
        else {
          const ax = Math.abs(x1), ay = Math.abs(y1);
          if (ax < z2 * 0.1 && ay < z2 * 0.1) arrow = "● AHEAD";
          else if (ax > ay) arrow = x1 > 0 ? "→ RIGHT" : "← LEFT";
          else arrow = y1 > 0 ? "↓ DOWN" : "↑ UP";
        }
        const label = m.kind === "deliver" ? `nearest station ${mt.name}` : mt.name;
        putText(g, 28, rTop + 5, `→ ${label}  ${d.toFixed(0)}u  ${arrow}`, "#cf6");
      } else if (m.kind === "deliver") {
        putText(g, 28, rTop + 5, `→ Collect ${m.cargoQty} ${m.cargoItem} then dock at any station`, "#cf6");
      }
    }
    if (this.warnText) putText(g, 28, rTop + 6, `⚠ ${this.warnText}`, "#fb6");

    // Log
    let ly = rTop;
    for (let i = this.log.length - 1; i >= 0; i--) {
      putText(g, cols - 52, ly++, "» " + this.log[i].msg, "#cfd");
      if (ly > rows - 2) break;
    }

    // Keys hint
    putText(g, 2, rows - 1, "W/S thr  A/D yaw  Q/E pit  SHIFT boost  SPC fire  T tgt  M mine  F dock  J jett  P pause  ESC menu", "#666");

    // FPS overlay (optional)
    if (this.options.showFps) putText(g, cols - 10, 0, `fps ${this.fps}`, "#7CFC00");

    // Boost indicator
    if (this.input.keys.has(this.options.keybinds.boost) && p.ship.fuel > 0) {
      putText(g, vpLeft + Math.floor(vw / 2) - 5, vpBottom - 1, "» AFTERBURNER «", "#fc6");
    }

    // Pause banner (big, centered, obvious)
    if (this.paused) {
      const msg = "‖ PAUSED — press P to resume";
      putText(g, vpLeft + Math.floor(vw / 2 - msg.length / 2), vpTop + Math.floor(vh / 2) - 1, msg, "#ffcc33");
    }

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
  // Forward unit vector matching the camera projection in renderPlaying().
  // The camera transform places "ahead" (reticle center) at world direction
  // (sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)). Previously this
  // returned -sp on Y, which made the ship fly opposite to the reticle
  // whenever the player pitched up or down — the "I'm aimed at him but the
  // distance is growing" bug.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { x: sy * cp, y: sp, z: cy * cp };
}

// Hash function exported for tooling tests; otherwise unused.
export const _internals = { hashString, mulberry32 };
