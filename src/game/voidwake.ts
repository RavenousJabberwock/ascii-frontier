// =============================================================================
// ASCII FRONTIER — ASCII Space Simulation Engine (engine module: voidwake.ts)
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
const TITLE_NOTICE_KEY = "voidwake.titleNotice";
const FLIGHT_RECORDER_KEY = "voidwake.flightRecorder";
const VERSION = "0.1.0";
const SOURCE_URL = "https://github.com/RavenousJabberwock/ascii-frontier";

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
  comet: "~",
  nebula: "▒",
  beacon: "!",
  ufo: "◉",
  thargoid: "Ѫ",
  wormhole: "Ø",
  dyson: "◇",
  derelict: "†",
};

// ---- Flavor data: names + procedural chatter generator -------------------
// Chatter is generated, not selected. pickLine(kind, ctx) chooses a template
// grammar then fills slots from live game state (hull%, current target name,
// sector coords, cargo, kills, etc.) and randomly resolves nested fragments.
// To add variety: extend a TEMPLATES[kind] array or a FRAGMENTS bucket.
const GUNNER_FIRST = ["Vex","Rho","Mira","Kael","Zara","Brun","Tessa","Doxx","Niri","Otho","Pell","Quill","Sable","Yara"];
const GUNNER_LAST  = ["Mara","Vant","Sool","Krev","Iyo","Drax","Phane","Wist","Orbit","Tann","Holt","Reyne"];

type ChatterKind =
  | "hostile" | "friendly" | "neutral" | "station" | "planet"
  | "gunner_idle" | "gunner_hostile" | "gunner_mine" | "gunner_dock" | "gunner_hit"
  | "gunner_greet" | "gunner_farewell_good" | "gunner_farewell_bad"
  | "gunner_kill" | "gunner_docked" | "gunner_cargofull"
  | "pilot_idle" | "pilot_greet" | "pilot_autopilot_on" | "pilot_autopilot_off"
  | "pilot_docking" | "pilot_farewell_good" | "pilot_farewell_bad"
  | "engineer_idle" | "engineer_greet" | "engineer_repair" | "engineer_shields"
  | "engineer_fuel" | "engineer_farewell_good" | "engineer_farewell_bad"
  | "merchant_idle" | "merchant_greet" | "merchant_deal" | "merchant_broke"
  | "merchant_farewell_good" | "merchant_farewell_bad"
  | "banter";

// Reusable fragments. Resolved recursively via {bucket} slots in templates.
const FRAGMENTS: Record<string, string[]> = {
  threat:    ["scrap","cargo","dust","a memory","wreckage","scrap-paint","ghost-mass"],
  curse:     ["void-spit","star-rat","drift-leech","hull-rat","oxy-thief"],
  praise:    ["clean burn","steady hands","fine vector","tight line"],
  weather:   ["solar wind's high","ion storm building coreward","the dark feels thin tonight","mag-flux is jumpy"],
  smalltalk: ["recycled air tastes like {coffee}","my bunk smells like {coffee}","last shore leave was {shore}","I miss {miss}"],
  coffee:    ["copper","ozone","old socks","engine grease","wet rope"],
  shore:     ["three jumps ago","before the war","a lifetime","two refits back"],
  miss:      ["real gravity","blue sky","running water","silence"],
  rumor:     ["a derelict drifting past the {planet} belt","pirates massing near {sector}","a Guild convoy late from {sector}","cheap fuel at {sector}"],
  planet:    ["Karn","Vex Prime","Old Hollow","Theta-9","Brindle","Mott"],
  hailVerb:  ["hails","pings","squawks","raises you"],
  approach:  ["closing","on intercept","in your six","drifting close"],
};

// Templates per chatter kind. Slots: {cmdr} {ship} {hull} {shield} {fuel}
// {cargo} {credits} {kills} {speaker} {short} {target} {nearest} {sector}
// {ore} {fac} {dist} — plus any FRAGMENTS bucket name.
const TEMPLATES: Record<ChatterKind, string[]> = {
  hostile: [
    "{cmdr}, you're {threat} now.",
    "That {ship}? Pretty paint for {threat}.",
    "Drift well, {curse}.",
    "I count {hull}% hull on you, {cmdr}. Not for long.",
    "Wing, mark the {ship} — {approach}.",
    "Should've stayed dirtside, {curse}.",
    "{cmdr} of the {ship}, last words?",
    "Cargo manifest or vacuum — pick.",
    "Your bounty pays my fuel, {cmdr}.",
  ],
  friendly: [
    "Safe vectors, Cmdr {cmdr}.",
    "{ship}, you're clear to pass. {praise}.",
    "{fac} thanks you, {cmdr}. Watch the {sector} lanes.",
    "Heard about your {kills} kills — fly true.",
    "Need anything? Nearest dock pings from {sector}.",
    "Eyes up — {rumor}.",
  ],
  neutral: [
    "{ship}, mind your wake.",
    "Guild traffic, hold lanes near {sector}.",
    "Got rocks to sell, push off.",
    "Heard {rumor}. Probably nothing.",
    "Comms check — read you five-by, {cmdr}.",
    "If you see {curse} types out here, don't engage.",
  ],
  station: [
    "...automated beacon, {sector}: dock fees waived this cycle.",
    "Approach vector clear for {ship}. Welcome, {cmdr}.",
    "Maintenance bay open. Refits at standard rate.",
    "Advisory: {weather}.",
    "Market tick — ore moving well today.",
    "Manifest scan ready when you dock, {cmdr}.",
  ],
  planet: [
    "Surface comms crackle: {weather}.",
    "{speaker} tradehouse requests manifests from the {ship}.",
    "Atmospheric thermals strong over the northern arc.",
    "Local chatter mentions {rumor}.",
    "Orbital relay {hailVerb} you, Cmdr {cmdr}.",
  ],
  gunner_idle: [
    "Quiet out here. {weather}.",
    "{smalltalk}.",
    "Hull's at {hull}%, shields {shield}%. Comfortable.",
    "We've got {credits} credits and {cargo}% cargo. Not bad.",
    "Sector {sector} feels off. Could be nothing.",
    "Kill count's {kills}, Cmdr. You're getting sharp.",
    "Strange stars this sector. {weather}.",
    "Guns are warm and I'm bored. Bad combination.",
    "You ever notice pulsars keep time better than my last chrono?",
    "If we see a †, that's a derelict. Free money, no shooting.",
    "Black holes on the scope. Give them a wide berth, {cmdr}.",
    "That {ship} handles nicer than the last three I've been on.",
  ],
  gunner_hostile: [
    "On {target}! Firing!",
    "{target} in the reticle — burn 'em!",
    "Got the lock — {target}'s {threat}!",
    "Eat plasma, {curse}!",
    "Range good, {target} lit up!",
  ],
  gunner_mine: [
    "Chewing rock — {ore} in the hold.",
    "Nice vein. Cargo at {cargo}%.",
    "Mining {target}, hold her steady.",
    "Ore tally: {ore}. Keep us pointed.",
  ],
  gunner_dock: [
    "Suggest we dock at {target}, Cmdr.",
    "{target} looks safe. Fuel's at {fuel}%.",
    "Could use a stretch — {target}'s right there.",
    "Hull {hull}%, shields {shield}% — dock at {target}?",
  ],
  gunner_hit: [
    "We're taking fire! Hull {hull}%!",
    "Shields buckling — {shield}% left!",
    "Hold her steady, {cmdr}!",
    "That's coming from {nearest}!",
    "Evasive! Hull at {hull}%!",
    "Whoever's shooting us — they'll regret it.",
  ],
  gunner_greet: [
    "On board, Cmdr. Press G to toggle me.",
    "{cmdr}! Heard you needed a trigger finger. Glad to ride.",
    "Permission to stow my kit? Beautiful ship, this {ship}.",
    "Reporting for duty. Coffee tastes like {coffee} here too — perfect.",
    "Cmdr {cmdr}, I'll keep your six warm. Press G to put me to work.",
    "First time aboard a {ship}. Don't let me down and I won't let you.",
    "Last captain owed me three jumps' wage. You won't, right?",
    "{praise}, that's what I want to see. Let's burn some {curse} types.",
    "Quiet bunk, working guns — that's all I ask. G to wake me up.",
  ],
  gunner_farewell_good: [
    "Been an honor, Cmdr. {praise} out there.",
    "Safe vectors, {cmdr}. I'll buy the first round.",
    "Keep the {ship} clean. You're a fine pilot.",
    "If you ever need a gun again, I'm in {sector}.",
    "Cmdr — thanks for the ride. {kills} kills together. Not bad.",
  ],
  gunner_farewell_bad: [
    "Should've signed with the Guild. Good riddance.",
    "Pay's late, hull's wrecked — I'm done. Don't call.",
    "Hope your next gunner likes {curse}s as much as you do.",
    "Fly into a star for all I care, Cmdr.",
    "Worst tour I ever flew. Out.",
  ],
  gunner_kill: [
    "{target} — splashed!",
    "That's another {curse} for the void.",
    "Scratch one. Kill count: {kills}.",
    "Cleaner than I expected. Nice angle.",
    "Down they go. Manifest 'em, Cmdr.",
  ],
  gunner_docked: [
    "Solid dock. I'll stretch the legs.",
    "Fuel's flowing, hull's mending. Good call, Cmdr.",
    "Beacon's friendly. I'll grab a {coffee}.",
    "Nice approach. Some of my old captains couldn't park a barge.",
  ],
  gunner_cargofull: [
    "Hold's full, Cmdr — find a buyer.",
    "Cargo at max. Time to offload.",
    "No room for more rock. Dock somewhere?",
  ],
  pilot_idle: [
    "Steady vector, Cmdr. {weather}.",
    "Nice ride, this {ship}. Handles better than my last posting.",
    "{smalltalk}.",
    "If you want me to take the stick, tag a target and hit O.",
    "Sector {sector} logged. Clean drift.",
    "Fuel at {fuel}%. Want me to plot a scoop pass?",
    "Scope shows a black hole nearby. I'll route around it, Cmdr.",
    "Picked up a derelict on the fringe. Worth a swing if we've got hold room.",
    "That pulsar's ticking like a metronome. Kind of soothing, actually.",
    "Wormhole on the plot — cheapest jump you'll ever fly.",
  ],
  pilot_greet: [
    "Pilot reporting, Cmdr {cmdr}. Tag a target, hit O, and I'll fly it.",
    "Nav chair's warm — glad to ride the {ship}. O toggles autopilot.",
    "Flown three of these before. Docking's the easy part.",
    "Cmdr — I don't crash. Everything else is negotiable.",
  ],
  pilot_autopilot_on: [
    "I've got the stick. Plotting to {target}.",
    "Course locked on {target} — ETA short.",
    "Hands off, Cmdr. Bringing us in on {target}.",
    "Autopilot engaged. Try not to sneeze on the fire button.",
  ],
  pilot_autopilot_off: [
    "Stick's yours, Cmdr.",
    "Disengaging — you fly better than the manual says anyway.",
    "Handing back. Watch the pitch.",
    "Autopilot off. Yell if it gets weird.",
  ],
  pilot_docking: [
    "Matching velocity with {target}. Hold on.",
    "Bringing us to a stop at {target} — perfect approach.",
    "Docking pattern locked, {target} beacon has us.",
  ],
  pilot_farewell_good: [
    "Best captain I've flown for. Safe vectors, {cmdr}.",
    "Cmdr — thanks. I'll spread the word in {sector}.",
    "Fly the {ship} true. She likes you.",
  ],
  pilot_farewell_bad: [
    "You steer like a drunk asteroid. Out.",
    "Rather push a barge dirtside than fly for you again.",
    "Cmdr, you owe me a bar tab and a therapist.",
  ],
  engineer_idle: [
    "Hull's holding. Coupler harmonics look clean.",
    "{smalltalk}.",
    "Shield emitter running a hair warm — nothing critical.",
    "Fuel flow's efficient today. {praise}, Cmdr.",
    "I could rebuild this reactor blind. Don't test me.",
    "Reading a soft hum on the port thruster. I'll watch it.",
  ],
  engineer_greet: [
    "Engineer reporting. I'll keep the {ship} together, you keep it pointed.",
    "Cmdr — took a look at your reactor. It'll last. Barely.",
    "Kit's stowed, tools are hot. Let's not blow up.",
    "I've patched worse hulls with duct tape and prayer.",
  ],
  engineer_repair: [
    "Patching hull — give me a moment.",
    "Weld's holding. Hull back to {hull}%.",
    "Shaved off the worst of the scarring. You're welcome.",
    "Repair pass done. Try not to undo it, Cmdr.",
  ],
  engineer_shields: [
    "Shields cycling — capacitors happy.",
    "Boosted the recharge loop. Should feel snappier.",
    "Shield harmonics locked. That's my magic done.",
  ],
  engineer_fuel: [
    "Trimmed the burn — you're getting more meters per unit now.",
    "Reactor's sipping instead of guzzling. You're welcome.",
    "Fuel efficiency's up. Buy me a drink at the next dock.",
  ],
  engineer_farewell_good: [
    "Good ship, good captain. I'll miss the {ship}.",
    "Cmdr — she's tuned. Don't let the next hack ruin her.",
    "Safe vectors. Call if the reactor sings weird.",
  ],
  engineer_farewell_bad: [
    "You broke everything I fixed. Twice. I'm out.",
    "Never seen a hull this abused. Good luck, Cmdr.",
    "Rather patch a Guild scow than another minute on this bucket.",
  ],
  merchant_idle: [
    "Ore prices in {sector} are moving. Could be a play.",
    "You've got {credits} credits burning a hole, Cmdr.",
    "{smalltalk}.",
    "I hear a refinery near {planet} pays 20% over spot.",
    "Cargo at {cargo}%. When we dock, let me talk to the buyer.",
    "Bounty board's fat this cycle. Just saying.",
  ],
  merchant_greet: [
    "Merchant aboard, Cmdr. I'll shave 15% off the buy sheet and pad the sell.",
    "Cmdr {cmdr} — pleasure. My cousin runs the market in {sector}. Handy.",
    "Give me a cargo hold and a station, I'll give you profit.",
    "I read a rumor mill better than most read a manifest.",
  ],
  merchant_deal: [
    "Talked them up 15% on the ore — nice haul, Cmdr.",
    "Got you a discount on that refit. Don't say I never earn my keep.",
    "Buyer flinched. We won. {credits}cr looking healthier already.",
  ],
  merchant_broke: [
    "Cmdr, we're broke. Rocks won't sell themselves.",
    "Empty hold, empty pockets. Let's fix one of those.",
    "I can't haggle nothing into something. Get us cargo.",
  ],
  merchant_farewell_good: [
    "Made you money, made myself money. Textbook tour.",
    "Cmdr — I'll invest my cut. Come find me flush in {sector}.",
    "Solid captain, solid ledger. Fly true.",
  ],
  merchant_farewell_bad: [
    "You wouldn't take a deal if it kissed you. I'm gone.",
    "Cmdr, next captain, listen to your merchant.",
    "Rather sell rocks door-to-door than watch you refuse a margin.",
  ],
  banter: [
    "{a}: {b}, you ever going to fix that coupler?  ||  {b}: I fixed yours, {a}. Try locking the door.",
    "{a}: If we get boarded, {b} goes first.  ||  {b}: I go first because I'm faster, not braver.",
    "{a}: {coffee} again for dinner?  ||  {b}: Cmdr picked the ration crate. Blame the top of the food chain.",
    "{a}: I miss {miss}.  ||  {b}: I miss silence. Please.",
    "{a}: How long you been aboard, {b}?  ||  {b}: Long enough to know when to duck.",
    "{a}: Bet you five creds we hit rocks before we hit a station.  ||  {b}: Cmdr can hear us, you know.",
    "{a}: Last ship I flew, the {threat} were nicer than you.  ||  {b}: Last ship you flew is scrap. Coincidence?",
    "{a}: Cmdr's aim is getting better.  ||  {b}: Or {a} is getting quieter about the misses.",
    "{a}: If I fix one more coupler I'm putting my name on the hull.  ||  {b}: Please don't.",
    "{a}: Weather's {weather}.  ||  {b}: Weather is always {weather}. That's space.",
    "{a}: {praise}, Cmdr.  ||  {b}: Don't inflate the ego. He'll try to dock at a star.",
    "{a}: Any word on {rumor}?  ||  {b}: Yeah, and it gets worse the closer you look.",
  ],
};

interface ChatterCtx {
  cmdr: string; ship: string; speaker: string; short: string;
  hull: string; shield: string; fuel: string; cargo: string;
  credits: string; kills: string; target: string; nearest: string;
  sector: string; ore: string; fac: string; dist: string;
  a: string; b: string;
}

function fillTemplate(tpl: string, ctx: ChatterCtx, depth = 0): string {
  if (depth > 4) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (key in ctx) return (ctx as unknown as Record<string, string>)[key];
    const bucket = FRAGMENTS[key];
    if (bucket) return fillTemplate(bucket[Math.floor(Math.random() * bucket.length)], ctx, depth + 1);
    return "";
  });
}

function pickLine(kind: ChatterKind, ctx: ChatterCtx): string {
  const arr = TEMPLATES[kind];
  return fillTemplate(arr[Math.floor(Math.random() * arr.length)], ctx);
}

// Rotating tips shown on the title screen. Kept short so the line fits in
// even a narrow terminal; the renderer swaps one every ~5 seconds.
const TITLE_TIPS = [
  "Mouse wheel controls throttle. Scroll up = faster.",
  "Fly close to a star (not a black hole) with low throttle to scoop fuel.",
  "Hire a Pilot at any station — press O to autopilot to your target.",
  "Press L for the Codex — every glyph and color is documented.",
  "Distress beacons pay well… but ~35% are pirate traps.",
  "Wormholes (Ø) come in pairs. Drop into one, come out at its sibling.",
  "Derelict wrecks (†) are free salvage. No trap, no fight.",
  "Black holes bend your course before they eat you. Watch the drift.",
  "Pulsars (PSR) blink because they spin. Cosmetic — but pretty.",
  "Options ▸ Radio picks in-game music, including your own stream URL.",
  "Cargo full? Dock and sell before you mine another rock.",
  "Save often. Permadeath is opt-in for a reason.",
];

const SPECIES = ["Human", "Android", "Reptilian", "Aquilan", "Drift-born"];

// Ship hull catalog. Add entries to expose new hulls to character creation.
const SHIP_HULLS = [
  { id: "scout", name: "Sparrow Scout", hull: 60, shield: 40, cargo: 12, speed: 90, crewSlots: 1 },
  { id: "trader", name: "Mule Freighter", hull: 110, shield: 60, cargo: 64, speed: 55, crewSlots: 4 },
  { id: "fighter", name: "Wasp Interceptor", hull: 80, shield: 90, cargo: 8, speed: 110, crewSlots: 2 },
  { id: "miner", name: "Pickaxe Industrial", hull: 130, shield: 50, cargo: 40, speed: 50, crewSlots: 3 },
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
  | "loot"
  | "comet"
  | "nebula"
  | "beacon"
  | "ufo"
  | "thargoid"
  | "wormhole"
  | "dyson"
  | "derelict";

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
  // Named NPC pilot (optional). Ships with a callsign show it in the target
  // panel and in kill logs — "Raider Sting-14" alone is faceless, "Ace Vex
  // Mara" gives the world named recurring adversaries.
  pilotName?: string;
  // Faction retaliation: when set, this ship is temporarily hostile to the
  // player until performance.now()/1000 exceeds this value. Cleared by AI.
  hostileUntil?: number;
  // Preserved kind so retaliation can revert this ship to friendly/neutral
  // once the timer expires.
  peaceKind?: EntityKind;
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

// Multi-role crew. Roles: "gunner" (auto-fire/mine), "pilot" (autopilot to
// current target), "engineer" (regen hull/shield + fuel efficiency),
// "merchant" (better market spreads).
type CrewRole = "gunner" | "pilot" | "engineer" | "merchant";
interface CrewMember {
  role: CrewRole;
  name: string;
  species: string;
  gender: string;
  enabled: boolean;
  hiredAt: number;
  nextBarkAt: number;
  cooldown?: number;    // gunner auto-fire cadence
  autopilot?: boolean;  // pilot: toggled by O key
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
  missions?: Mission[];      // active quest log (mission + secondaries)
  lastSaveAt: number;
  // New since 0.2: optional hired gunner, faction reputation, lifetime kill count.
  gunner?: Gunner;           // legacy — migrated into crew[] on load
  crew?: CrewMember[];       // multi-role hires
  driftVel?: Vec3;           // preserved velocity when fuel hits zero
  reputation?: Record<string, number>;
  kills?: number;
}

type MissionKind = "deliver" | "destroy" | "scan" | "bounty" | "escort" | "rescue" | "haul";
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
  permadeath: boolean;       // when on, "Load Last Save" is disabled on death
  chatterFreq: "off" | "rare" | "normal" | "lively";
  radioMode: string;        // preset id — see RADIO_PRESETS. "off" disables.
  radioCustomUrl: string;   // used when radioMode === "custom"
  keybinds: Record<string, string>;
}

// Built-in radio presets. Chiptunes are procedurally generated by the
// WebAudio sequencer inside Voidwake (no asset dependency, works offline).
// Stream presets point at public SomaFM channels; the "custom" preset uses
// Options.radioCustomUrl. Order here is the order shown in the Options menu.
const RADIO_PRESETS: { id: string; label: string; kind: "off" | "chiptune" | "stream" | "custom"; url?: string; seed?: number }[] = [
  { id: "off",                       label: "Off",                            kind: "off" },
  { id: "chip-drift",                label: "Chiptune • Drift",               kind: "chiptune", seed: 11 },
  { id: "chip-frontier",             label: "Chiptune • Frontier",            kind: "chiptune", seed: 23 },
  { id: "chip-arcade",               label: "Chiptune • Arcade Runner",       kind: "chiptune", seed: 37 },
  { id: "chip-nebula",               label: "Chiptune • Nebula Cradle",       kind: "chiptune", seed: 53 },
  { id: "stream-somafm-deepspace",   label: "SomaFM • Deep Space One",        kind: "stream", url: "https://ice1.somafm.com/deepspaceone-128-mp3" },
  { id: "stream-somafm-space",       label: "SomaFM • Space Station",         kind: "stream", url: "https://ice1.somafm.com/spacestation-128-mp3" },
  { id: "stream-somafm-mission",     label: "SomaFM • Mission Control",       kind: "stream", url: "https://ice1.somafm.com/missioncontrol-128-mp3" },
  { id: "stream-somafm-defcon",      label: "SomaFM • DEF CON Radio",         kind: "stream", url: "https://ice1.somafm.com/defcon-128-mp3" },
  { id: "custom",                    label: "Custom URL",                     kind: "custom" },
];



interface SaveBlob {
  version: string;
  seed: number;
  player: PlayerState;
  entities: Entity[];
  options: Options;
  savedAt: number;
}

interface FlightRecorder {
  wall: number;
  frame: number;
  screen: Screen;
  reason: string;
  clean: boolean;
  hull?: number;
  hullMax?: number;
  shield?: number;
  shieldMax?: number;
  fuel?: number;
  pos?: Vec3;
  entityCount: number;
  lastLog?: string;
  deathReason?: string | null;
  crashError?: string | null;
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
  boost: "shift",
  jettison: "j",
  pause: "p",
  menu: "escape",
  toggleGunner: "g",
  supercruise: "x",      // hold: 3x speed, 3x fuel burn — for long hauls
  legend: "l",           // open the Codex / Legend overlay
  pinQuest: "k",         // toggle the persistent quest tracker panel
  cycleCatPrev: "[",     // target nearest of previous category (station/rock/hostile/...)
  cycleCatNext: "]",     // target nearest of next category
  autopilot: "o",        // toggle hired Pilot's autopilot to current target
  questLog: "u",         // open the toggle-able Quest Log popup
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
    permadeath: false,
    chatterFreq: "normal",
    radioMode: "off",
    radioCustomUrl: "",

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
const WORLD_RADIUS = 18000;

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

// Callsign pool for named NPC pilots. Kept small so the same faces recur —
// the point is that "Ace Vex Mara" is someone you might meet twice.
const PILOT_FIRST = ["Vex","Rho","Mira","Kael","Zara","Brun","Tessa","Doxx","Niri","Otho","Pell","Quill","Sable","Yara","Cass","Juno","Ren","Ilo","Boro","Etta"];
const PILOT_LAST  = ["Mara","Vant","Sool","Krev","Iyo","Drax","Phane","Wist","Orbit","Tann","Holt","Reyne","Kade","Osk","Vell","Brant"];
const PILOT_TITLE_HOSTILE  = ["Ace","Reaver","Fang","Slag","Ghost","Iron","Blackwake"];
const PILOT_TITLE_FRIENDLY = ["Cmdr","Lt.","Capt.","Wing"];
const PILOT_TITLE_NEUTRAL  = ["Trader","Freerunner","Skiff","Longhaul"];
function pilotNameFor(rng: () => number, kind: EntityKind): string {
  const first = PILOT_FIRST[Math.floor(rng() * PILOT_FIRST.length)];
  const last  = PILOT_LAST[Math.floor(rng() * PILOT_LAST.length)];
  const pool  = kind === "hostile" ? PILOT_TITLE_HOSTILE
              : kind === "friendly" ? PILOT_TITLE_FRIENDLY
              : PILOT_TITLE_NEUTRAL;
  const title = pool[Math.floor(rng() * pool.length)];
  return `${title} ${first} ${last}`;
}

let _entityIdSeq = 1;
function nextId() { return _entityIdSeq++; }

// World scale + entity counts. The universe radius was doubled (from 9k to
// 18k) to give a genuinely vast frontier. Renderer still fades anything past
// 5k to a colored period and culls past 10k, so most bodies will be distant
// pinpricks until you cruise toward them. Populations scaled up to match.
const WORLD = {
  starRadius: 0,
  planetRadius: 18000,
  asteroidRadius: 15000,
  stationRadius: 17000,
  shipRadius: 19000,
  cometRadius: 21000,
  nebulaRadius: 18000,
  beaconRadius: 18000,
  baseRadius: 19000,
  planets: 42,
  asteroids: 520,
  stations: 20,
  ships: 150,
  comets: 28,
  nebulae: 26,
  beacons: 20,
  pirateBases: 11,
};


function generateUniverse(seed: number): Entity[] {
  _entityIdSeq = 1;
  const rng = mulberry32(seed);
  const out: Entity[] = [];

  // Central star + a handful of distant scattered suns so the deep sky
  // shows a variety of stellar classes (red giants, blue supergiants, white
  // dwarves, etc — see stellarClassOf()).
  out.push({ id: nextId(), kind: "star", name: nameFrom(rng, "Sol"), pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, faction: "nature" });
  for (let i = 0; i < 14; i++) {
    out.push({ id: nextId(), kind: "star", name: nameFrom(rng, "Sun"), pos: randPos(rng, WORLD_RADIUS * 0.95), vel: { x: 0, y: 0, z: 0 }, faction: "nature" });
  }

  // Planets
  for (let i = 0; i < WORLD.planets; i++) {
    out.push({ id: nextId(), kind: "planet", name: nameFrom(rng, "P-"), pos: randPos(rng, WORLD.planetRadius), vel: { x: 0, y: 0, z: 0 }, faction: "nature" });
  }
  // Asteroid field
  for (let i = 0; i < WORLD.asteroids; i++) {
    out.push({
      id: nextId(), kind: "asteroid", name: "Rock", pos: randPos(rng, WORLD.asteroidRadius),
      vel: { x: (rng() - 0.5) * 2, y: (rng() - 0.5) * 2, z: (rng() - 0.5) * 2 },
      faction: "nature", ore: 5 + Math.floor(rng() * 20),
    });
  }
  // Civilian stations (dockable). Alternating federation/guild ownership.
  for (let i = 0; i < WORLD.stations; i++) {
    const fac = i % 2 === 0 ? "federation" : "guild";
    out.push({
      id: nextId(), kind: "station", name: nameFrom(rng, fac === "federation" ? "Station" : "Outpost"),
      pos: randPos(rng, WORLD.stationRadius), vel: { x: 0, y: 0, z: 0 }, faction: fac,
      hull: 500, shield: 300, state: "idle",
    });
  }
  // Pirate bases: fortified, hostile, undockable. Periodically spawn raiders
  // and fire turret bullets at anything not flying pirate colors. Destroying
  // one nets a fat bounty + rep, and stops local pirate respawns.
  for (let i = 0; i < WORLD.pirateBases; i++) {
    out.push({
      id: nextId(), kind: "station", name: nameFrom(rng, "Den"),
      pos: randPos(rng, WORLD.baseRadius), vel: { x: 0, y: 0, z: 0 }, faction: "pirate",
      hull: 900, shield: 500, state: "pirate_base", cooldown: 0,
    });
  }
  // Ships
  const factions = ["federation", "guild", "pirate"];
  for (let i = 0; i < WORLD.ships; i++) {
    const roll = rng();
    const kind: EntityKind = roll < 0.4 ? "friendly" : roll < 0.75 ? "neutral" : "hostile";
    const fac = kind === "friendly" ? "federation" : kind === "neutral" ? "guild" : "pirate";
    // ~35% of ships get a named pilot callsign so the world has recurring faces.
    const named = rng() < 0.35;
    out.push({
      id: nextId(), kind, name: nameFrom(rng, kind === "hostile" ? "Raider" : "Ship"),
      pos: randPos(rng, WORLD.shipRadius),
      vel: { x: (rng() - 0.5) * 10, y: (rng() - 0.5) * 10, z: (rng() - 0.5) * 10 },
      faction: factions.includes(fac) ? fac : "guild",
      hull: kind === "hostile" ? 50 : 40, shield: 30,
      state: "wander", cooldown: 0, weaponId: "pulse",
      pilotName: named ? pilotNameFor(rng, kind) : undefined,
    });
  }

  // Derelict ships: static, silent wrecks scattered across the frontier.
  // Fly within 40u to salvage credits + ore. No AI, no weapons — just loot
  // and a bit of environmental storytelling.
  for (let i = 0; i < 12; i++) {
    out.push({
      id: nextId(), kind: "derelict",
      name: nameFrom(rng, rng() < 0.5 ? "Wreck" : "Hulk"),
      pos: randPos(rng, WORLD_RADIUS * 0.9),
      vel: { x: (rng() - 0.5) * 1.5, y: (rng() - 0.5) * 1.5, z: (rng() - 0.5) * 1.5 },
      faction: "wreck",
      loot: {
        credits: 80 + Math.floor(rng() * 220),
        ore: 3 + Math.floor(rng() * 12),
      },
    });
  }

  // Comets: fast-moving, harmless. The renderer trails ~ glyphs along velocity.
  for (let i = 0; i < WORLD.comets; i++) {
    const dir = V.norm({ x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 });
    out.push({
      id: nextId(), kind: "comet", name: nameFrom(rng, "Comet"),
      pos: randPos(rng, WORLD.cometRadius),
      vel: V.scale(dir, 35 + rng() * 25),
      faction: "nature",
    });
  }
  // Nebula clouds: stationary fog. Inside they drain shields slowly and dim
  // the starfield. Pure "atmosphere" hazard you can hide a pursuer in.
  for (let i = 0; i < WORLD.nebulae; i++) {
    out.push({
      id: nextId(), kind: "nebula", name: nameFrom(rng, "Neb"),
      pos: randPos(rng, WORLD.nebulaRadius),
      vel: { x: 0, y: 0, z: 0 },
      faction: "nature",
    });
  }
  // Distress beacons: dock-on-touch for a small bounty (or pirate trap).
  for (let i = 0; i < WORLD.beacons; i++) {
    const trap = rng() < 0.35;
    out.push({
      id: nextId(), kind: "beacon",
      name: trap ? "Distress (?)" : "Distress",
      pos: randPos(rng, WORLD.beaconRadius),
      vel: { x: 0, y: 0, z: 0 },
      faction: "wreck",
      state: trap ? "trap" : "rescue",
      loot: { credits: 120 + Math.floor(rng() * 220) },
    });
  }

  // ---- Rare phenomena --------------------------------------------------
  // UFOs: a handful of enigmatic wanderers. They ignore factions and drift
  // between random survey points; if the player gets close they linger
  // ("observe") briefly then boost away.
  for (let i = 0; i < 4; i++) {
    out.push({
      id: nextId(), kind: "ufo", name: nameFrom(rng, "UAP"),
      pos: randPos(rng, WORLD_RADIUS),
      vel: { x: (rng() - 0.5) * 8, y: (rng() - 0.5) * 8, z: (rng() - 0.5) * 8 },
      faction: "alien",
      state: "wander",
    });
  }
  // Thargoid-like observers: extremely rare, dormant deep in the void.
  // When triggered they warp near the player, EMP everything, watch, and
  // depart. See engine tick for the encounter state machine.
  for (let i = 0; i < 2; i++) {
    out.push({
      id: nextId(), kind: "thargoid", name: "Unknown Contact",
      pos: randPos(rng, WORLD_RADIUS * 0.9),
      vel: { x: 0, y: 0, z: 0 },
      faction: "alien",
      state: "dormant",
      cooldown: 30 + rng() * 90, // seconds until it *might* consider triggering
    });
  }
  // Traversable wormhole pairs. Each pair shares a `targetId` pointing at
  // its sibling; flying within 60u teleports the player to the sibling.
  for (let i = 0; i < 2; i++) {
    const a: Entity = {
      id: nextId(), kind: "wormhole", name: nameFrom(rng, "Rift"),
      pos: randPos(rng, WORLD_RADIUS * 0.85),
      vel: { x: 0, y: 0, z: 0 }, faction: "nature",
    };
    const b: Entity = {
      id: nextId(), kind: "wormhole", name: nameFrom(rng, "Rift"),
      pos: randPos(rng, WORLD_RADIUS * 0.85),
      vel: { x: 0, y: 0, z: 0 }, faction: "nature",
    };
    a.targetId = b.id; b.targetId = a.id;
    out.push(a, b);
  }
  // Dyson swarm: pick a G/K/F star and lace a ring of "◇" collectors
  // around it. Purely cosmetic — no AI, no interaction beyond awe.
  const dysonHosts = out.filter((e) => e.kind === "star" && e.id !== 1);
  if (dysonHosts.length) {
    const host = dysonHosts[Math.floor(rng() * dysonHosts.length)];
    const ringR = 220;
    const nSwarm = 18;
    // Random ring tilt.
    const tiltX = (rng() - 0.5) * 0.6;
    const tiltZ = (rng() - 0.5) * 0.6;
    for (let i = 0; i < nSwarm; i++) {
      const a = (i / nSwarm) * Math.PI * 2;
      const dx = Math.cos(a) * ringR;
      const dz = Math.sin(a) * ringR;
      const dy = Math.sin(a) * ringR * tiltX + Math.cos(a) * ringR * tiltZ;
      out.push({
        id: nextId(), kind: "dyson", name: `${host.name} Swarm`,
        pos: { x: host.pos.x + dx, y: host.pos.y + dy, z: host.pos.z + dz },
        vel: { x: 0, y: 0, z: 0 },
        faction: "alien",
        ownerId: host.id,
      });
    }
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
  if (e.kind === "planet" || e.kind === "star" || e.kind === "asteroid" || e.kind === "bullet" || e.kind === "loot" || e.kind === "comet" || e.kind === "nebula" || e.kind === "beacon" || e.kind === "ufo" || e.kind === "thargoid" || e.kind === "wormhole" || e.kind === "dyson" || e.kind === "derelict") return;

  // Faction retaliation: retaliating ships attack the player like hostiles.
  const now = performance.now() / 1000;
  const retaliating = e.hostileUntil != null && now < e.hostileUntil;
  if (retaliating && (e.kind === "friendly" || e.kind === "neutral")) {
    const dir = V.sub(player.pos, e.pos);
    const dist = V.len(dir);
    if (dist < 1200) {
      const n = V.norm(dir);
      e.vel = V.scale(n, 32);
      e.state = "retaliate";
      e.cooldown = (e.cooldown ?? 0) - dt;
      if (dist < 420 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 1.0;
        ents.push(makeBullet(e, n));
      }
      return;
    }
  }


  // Pirate bases: turrets fire at any non-pirate in range, including player.
  if (e.kind === "station") {
    if (e.faction !== "pirate") return;
    e.cooldown = (e.cooldown ?? 0) - dt;
    // Pick nearest non-pirate ship OR player within 700u.
    let bestT: { pos: Vec3; id: number } | null = null;
    let bestD = 700;
    const playerD = V.len(V.sub(player.pos, e.pos));
    if (playerD < bestD) { bestT = { pos: player.pos, id: -1 }; bestD = playerD; }
    for (const t of ents) {
      if (t.kind !== "hostile" && t.kind !== "neutral" && t.kind !== "friendly") continue;
      if (t.faction === "pirate") continue;
      const d = V.len(V.sub(t.pos, e.pos));
      if (d < bestD) { bestD = d; bestT = { pos: t.pos, id: t.id }; }
    }
    if (bestT && (e.cooldown ?? 0) <= 0) {
      e.cooldown = 0.6;
      const dir = V.norm(V.sub(bestT.pos, e.pos));
      ents.push(makeBullet(e, dir));
    }
    return;
  }

  const distToPlayer = V.len(V.sub(player.pos, e.pos));

  // Helper: nearest enemy NPC ship within `range`. Pirates hunt non-pirate
  // ships; defenders (friendly/neutral) hunt pirates.
  const findEnemyShip = (range: number): Entity | null => {
    let best: Entity | null = null;
    let bestD = range;
    for (const t of ents) {
      if (t.id === e.id) continue;
      if (t.kind !== "hostile" && t.kind !== "neutral" && t.kind !== "friendly") continue;
      if ((t.hull ?? 1) <= 0) continue;
      // Pirates fight everyone non-pirate; defenders only engage pirates.
      if (e.faction === "pirate") {
        if (t.faction === "pirate") continue;
      } else {
        if (t.faction !== "pirate") continue;
      }
      const d = V.len(V.sub(t.pos, e.pos));
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  };

  if (e.kind === "hostile") {
    // Hostiles consider the player AND the nearest non-pirate NPC; closest wins.
    const enemyShip = findEnemyShip(700);
    const shipD = enemyShip ? V.len(V.sub(enemyShip.pos, e.pos)) : Infinity;
    let targetPos: Vec3 | null = null;
    let targetD = Infinity;
    if (distToPlayer < 800) { targetPos = player.pos; targetD = distToPlayer; }
    if (enemyShip && shipD < targetD) { targetPos = enemyShip.pos; targetD = shipD; e.targetId = enemyShip.id; }

    if (targetPos) {
      e.state = "attack";
      const dir = V.norm(V.sub(targetPos, e.pos));
      e.vel = V.scale(dir, 35);
      e.cooldown = (e.cooldown ?? 0) - dt;
      if (targetD < 400 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 0.8;
        ents.push(makeBullet(e, dir));
      }
    } else {
      e.state = "patrol";
      if (Math.random() < 0.02) e.vel = V.scale({ x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 }, 15);
    }
  } else if (e.kind === "friendly") {
    // Defend: engage pirates within 500u, else continue station route.
    const foe = findEnemyShip(500);
    if (foe) {
      const dir = V.norm(V.sub(foe.pos, e.pos));
      e.vel = V.scale(dir, 28);
      e.cooldown = (e.cooldown ?? 0) - dt;
      const fd = V.len(V.sub(foe.pos, e.pos));
      if (fd < 380 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 1.0;
        ents.push(makeBullet(e, dir));
      }
      return;
    }
    const station = ents.find((x) => x.kind === "station" && x.faction !== "pirate");
    if (station) {
      const d = V.sub(station.pos, e.pos);
      if (V.len(d) > 80) e.vel = V.scale(V.norm(d), 20);
      else e.vel = { x: 0, y: 0, z: 0 };
    }
  } else if (e.kind === "neutral") {
    // Skittish: only shoots if a pirate gets close (<350u). Otherwise mines.
    const foe = findEnemyShip(350);
    if (foe) {
      // Try to flee while plinking back.
      const away = V.norm(V.sub(e.pos, foe.pos));
      e.vel = V.scale(away, 24);
      e.cooldown = (e.cooldown ?? 0) - dt;
      const fd = V.len(V.sub(foe.pos, e.pos));
      if (fd < 320 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 1.4;
        const dir = V.norm(V.sub(foe.pos, e.pos));
        ents.push(makeBullet(e, dir));
      }
      return;
    }
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
  { id: "crew-quarters",   name: "Crew Quarters",   price: 1400, desc: "+1 crew slot" },
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

// Effective crew capacity after hull base + Crew Quarters modules.
function effectiveCrewMax(p: PlayerState): number {
  const hull = SHIP_HULLS.find((h) => h.id === p.ship.hullId);
  const base = hull?.crewSlots ?? 1;
  const quarters = p.ship.modules.filter((m) => m === "crew-quarters").length;
  return base + quarters;
}

// Merchant on-crew? Sell/buy price multipliers applied at station markets.
function merchantSellMult(p: PlayerState): number {
  return hasCrew(p, "merchant") ? 1.15 : 1.0;
}
function merchantBuyMult(p: PlayerState): number {
  return hasCrew(p, "merchant") ? 0.90 : 1.0;
}
function hasCrew(p: PlayerState, role: CrewRole): boolean {
  if (role === "gunner") return !!p.gunner;
  return !!(p.crew && p.crew.some((c) => c.role === role));
}
function getCrew(p: PlayerState, role: CrewRole): CrewMember | undefined {
  return p.crew?.find((c) => c.role === role);
}
function crewCount(p: PlayerState): number {
  return (p.gunner ? 1 : 0) + (p.crew ? p.crew.length : 0);
}

// Crew hiring fee per role.
const CREW_ROLE_INFO: Record<CrewRole, { title: string; baseFee: number; blurb: string; color: string }> = {
  gunner:   { title: "Gunner",   baseFee: 300, blurb: "auto-fires on hostiles, auto-mines rocks", color: "#fc6" },
  pilot:    { title: "Pilot",    baseFee: 450, blurb: "autopilot to current target (O)",         color: "#8cf" },
  engineer: { title: "Engineer", baseFee: 500, blurb: "hull regen, faster shield, -20% fuel",     color: "#7CFC00" },
  merchant: { title: "Merchant", baseFee: 400, blurb: "+15% ore sell, -10% station buy prices",    color: "#ffe066" },
};

function generateCrewMember(role: CrewRole, rng: () => number): CrewMember {
  const first = GUNNER_FIRST[Math.floor(rng() * GUNNER_FIRST.length)];
  const last  = GUNNER_LAST[Math.floor(rng() * GUNNER_LAST.length)];
  const gender = ["Female","Male","Nonbinary"][Math.floor(rng() * 3)];
  const species = SPECIES[Math.floor(rng() * SPECIES.length)];
  return {
    role,
    name: `${first} ${last}`,
    species, gender,
    enabled: true,
    hiredAt: Date.now(),
    nextBarkAt: 0,
    cooldown: 0,
    autopilot: false,
  };
}



// =============================================================================
// 7. Input
// =============================================================================
class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  // Case-preserving per-frame text input buffer. Populated in keydown with the
  // raw e.key (single characters or the sentinel "\b" for Backspace) so text
  // fields keep the user's capitalization instead of the lowercased routing
  // key used for gameplay input.
  textBuffer: string[] = [];
  // Accumulated mouse wheel deltaY for the frame. Positive = scroll down.
  wheelDelta = 0;
  // Mouse position in normalized canvas coords (-1..1, center is 0,0).
  // mouseInside is true while the cursor hovers the canvas.
  mouseNX = 0;
  mouseNY = 0;
  mouseInside = false;
  // Most recent mouse position in CSS pixels relative to the canvas top-left,
  // plus a one-shot click flag consumed by UI screens (e.g. Codex hyperlinks).
  mouseCX = 0;
  mouseCY = 0;
  mouseClicked = false;
  attach(el: HTMLElement, signal?: AbortSignal) {
    const opts = signal ? { signal } : undefined;
    el.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      // Case-preserving text capture for name fields etc.
      if (e.key === "Backspace") this.textBuffer.push("\b");
      else if (e.key.length === 1) this.textBuffer.push(e.key);
      if (["arrowup", "arrowdown", " ", "tab"].includes(k)) e.preventDefault();
    }, opts);
    el.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()), opts);
    el.addEventListener("blur", () => { this.keys.clear(); this.mouseInside = false; }, opts);
    el.addEventListener("mousemove", (e) => {
      const r = (el as HTMLCanvasElement).getBoundingClientRect();
      this.mouseCX = e.clientX - r.left;
      this.mouseCY = e.clientY - r.top;
      this.mouseNX = (this.mouseCX / r.width) * 2 - 1;
      this.mouseNY = (this.mouseCY / r.height) * 2 - 1;
      this.mouseInside = true;
    }, opts);
    el.addEventListener("mouseleave", () => { this.mouseInside = false; }, opts);
    el.addEventListener("mouseenter", () => { this.mouseInside = true; }, opts);
    el.addEventListener("click", (e) => {
      const r = (el as HTMLCanvasElement).getBoundingClientRect();
      this.mouseCX = e.clientX - r.left;
      this.mouseCY = e.clientY - r.top;
      this.mouseClicked = true;
    }, opts);
    el.addEventListener("wheel", (e) => {
      this.wheelDelta += e.deltaY;
      e.preventDefault();
    }, { ...(opts ?? {}), passive: false } as AddEventListenerOptions);
  }
  consume(k: string) {
    const had = this.pressed.has(k);
    this.pressed.delete(k);
    return had;
  }
  endFrame() {
    this.pressed.clear();
    this.mouseClicked = false;
    this.textBuffer.length = 0;
    this.wheelDelta = 0;
  }
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
  | "crashed"
  | "codex"
  | "quest-log";


// =============================================================================
// 9. Save / Load — unencrypted JSON in localStorage (plus export/import)
// =============================================================================
function saveGame(slot: string, blob: SaveBlob): { ok: true } | { ok: false; reason: "quota" | "error"; error?: unknown } {
  try {
    localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(blob, null, 2));
    return { ok: true };
  } catch (e) {
    // QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED — disk full, private-mode,
    // or save grew past the ~5 MB origin quota. Caller can warn the player
    // instead of crashing the engine.
    const isQuota =
      e instanceof DOMException &&
      (e.code === 22 || e.code === 1014 || /quota/i.test(e.name));
    // eslint-disable-next-line no-console
    console.warn("[ASCII Frontier] saveGame failed:", e);
    return { ok: false, reason: isQuota ? "quota" : "error", error: e };
  }
}
function loadGame(slot: string): SaveBlob | null {
  const raw = localStorage.getItem(SAVE_PREFIX + slot);
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as SaveBlob;
    // Backfill any new option fields for saves created before they existed.
    blob.options = { ...defaultOptions(), ...(blob.options ?? {}) } as Options;
    return blob;
  } catch { return null; }
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

function readDiagnostic<T>(key: string): T | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch { /* ignore unavailable storage / corrupt diagnostic */ }
  }
  return null;
}
function writeDiagnostic(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  for (const store of [sessionStorage, localStorage]) {
    try { store.setItem(key, raw); } catch { /* ignore unavailable storage */ }
  }
}
function removeDiagnostic(key: string) {
  for (const store of [sessionStorage, localStorage]) {
    try { store.removeItem(key); } catch { /* ignore unavailable storage */ }
  }
}

// =============================================================================
// 10. Renderer — ASCII grid drawn to canvas
// -----------------------------------------------------------------------------
// We draw a fixed character grid by computing cell size from canvas size.
// World-to-grid projection uses the player's yaw/pitch as an orientation.
// =============================================================================
const CELL_W = 9;   // px per glyph column
const CELL_H = 16;  // px per glyph row

interface Cell { ch: string; color: string; glow?: boolean }

// (blankGrid removed — replaced by Voidwake.acquireGrid which reuses a
// single buffer across frames instead of allocating cols*rows cells per frame.)


// putText writes a string into the grid, optionally clipped to a right-edge
// column (exclusive) so HUD overlays can't bleed into adjacent panels.
function putText(g: Cell[][], x: number, y: number, text: string, color = "#9fe", rightLimit?: number): void {
  if (y < 0 || y >= g.length) return;
  const cols = g[0].length;
  const maxX = rightLimit !== undefined ? Math.min(cols, rightLimit) : cols;
  for (let i = 0; i < text.length; i++) {
    const xi = x + i;
    if (xi < 0 || xi >= maxX) continue;
    g[y][xi] = { ch: text[i], color };
  }
}

// Multiplies an #rgb / #rrggbb hex color's RGB channels by `f` (clamped 0..1.4)
// and returns a #rrggbb string. Used to shade planet/station surfaces based on
// the angle to the nearest star (front lit vs. terminator vs. shadow side).
// Memoized shadeColor — planet surfaces call this for nearly every cell.
// Quantizing the factor into ~16 buckets means a planet's worth of cells
// reuses a tiny set of cached strings instead of doing fresh parse/multiply/
// hex-format work each time.
const _shadeCache = new Map<string, string>();
function shadeColor(hex: string, f: number): string {
  const k = Math.max(0, Math.min(1.4, f));
  const bucket = Math.round(k * 16); // 0..22 unique steps
  const key = hex + "|" + bucket;
  const hit = _shadeCache.get(key);
  if (hit !== undefined) return hit;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) { _shadeCache.set(key, hex); return hex; }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const kq = bucket / 16;
  const rr = Math.max(0, Math.min(255, Math.round(r * kq)));
  const gg = Math.max(0, Math.min(255, Math.round(g * kq)));
  const bb = Math.max(0, Math.min(255, Math.round(b * kq)));
  const out = "#" + rr.toString(16).padStart(2, "0") + gg.toString(16).padStart(2, "0") + bb.toString(16).padStart(2, "0");
  _shadeCache.set(key, out);
  return out;
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
    case "comet": return "#bff7ff";
    case "nebula": return "#c47afc";
    case "beacon": return "#ff66cc";
    case "ufo": return "#9effd2";
    case "thargoid": return "#a0ff3a";
    case "wormhole": return "#c8a0ff";
    case "dyson": return "#ffe6a0";
    case "derelict": return "#c0d0d8";
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
const PLANET_FILLS  = [
  "#7ec8ff", // ocean world
  "#9fd29b", // temperate green
  "#d9a06a", // desert / sand
  "#c98aff", // exotic violet
  "#ffd28a", // gas giant cream
  "#7fe3d1", // ice / methane
  "#ff8a5a", // molten / lava
  "#c8ffe4", // frozen aqua
  "#b0b0c0", // rocky grey
  "#8a5a3a", // rust
  "#ffb3c8", // pink cloud gas giant
  "#5a86c9", // stormy jovian
];
const PLANET_EDGES  = [
  "#3d6d9b", "#5a8a5a", "#8b6038", "#7a4eb0", "#a98a48", "#3d8a82",
  "#a04520", "#6a9aa2", "#606070", "#4a3020", "#a4536a", "#2b4a78",
];
const PLANET_TEX    = ["O", "Q", "@", "o", "Ø", "0", "8", "%", "&"];
const STATION_FILLS = ["#c2c2ff", "#a8ffd0", "#ffc8a0", "#cfe8ff"];
const STATION_TEX   = ["#", "H", "X", "=", "8"];
const ASTEROID_FILLS= ["#a6886a", "#8a7656", "#b89a78", "#7a6650"];
const ASTEROID_TEX  = ["%", "*", "#", ":", "."];

// Stellar classification: color / edge / relative size for each spectral
// class. Deterministic per-entity via hash01(id), so the same seed keeps the
// same sky. Sizes are multipliers on the base star sprite radius (40 units).
type StellarClass = {
  name: string;   // e.g. "O", "M", "RG", "WD"
  color: string;
  edge: string;
  halo: string;
  sizeMul: number;
  glyph: string;  // preferred fill glyph
};
const STELLAR_CLASSES: StellarClass[] = [
  // Blue supergiant (rare, huge, brilliant blue-white)
  { name: "O",  color: "#a8c8ff", edge: "#3050a0", halo: "#2a3f7a", sizeMul: 2.6, glyph: "*" },
  // Blue giant
  { name: "B",  color: "#c8dbff", edge: "#4060b0", halo: "#25355e", sizeMul: 1.6, glyph: "*" },
  // White main-sequence / white giant
  { name: "A",  color: "#ffffff", edge: "#8a8ac0", halo: "#4a4a6a", sizeMul: 1.1, glyph: "*" },
  // Yellow-white
  { name: "F",  color: "#fff2c8", edge: "#a08a5a", halo: "#5a4a28", sizeMul: 1.0, glyph: "*" },
  // Yellow like our Sun
  { name: "G",  color: "#ffd866", edge: "#a06a20", halo: "#5a4823", sizeMul: 1.0, glyph: "*" },
  // Orange dwarf
  { name: "K",  color: "#ff9a4a", edge: "#8a4010", halo: "#4a2308", sizeMul: 0.75, glyph: "*" },
  // Red giant (large, cool, deep orange-red)
  { name: "RG", color: "#ff6a3a", edge: "#a02010", halo: "#5a1808", sizeMul: 2.2, glyph: "*" },
  // Red supergiant (rare, colossal)
  { name: "RSG",color: "#ff4a2a", edge: "#8a0000", halo: "#4a0000", sizeMul: 3.4, glyph: "*" },
  // Red dwarf (tiny, dim, deep red)
  { name: "M",  color: "#d84040", edge: "#5a1010", halo: "#2a0808", sizeMul: 0.45, glyph: "*" },
  // White dwarf (tiny, brilliant white-blue)
  { name: "WD", color: "#e8f2ff", edge: "#6a80a0", halo: "#3a4a6a", sizeMul: 0.28, glyph: "•" },
  // Pulsar — tiny, rapidly rotating neutron star. Fill flickers in render
  // via stellarFillOf() so it visibly blinks against the sky.
  { name: "PSR", color: "#bfd8ff", edge: "#3a4a80", halo: "#101a3a", sizeMul: 0.22, glyph: "•" },
  // Black hole — dark core with a thin red-orange accretion glow.
  // Gravity pulls the player in close-approach; see BH handler in updatePlaying.
  { name: "BH", color: "#1a0a10", edge: "#ff6a20", halo: "#5a1a08", sizeMul: 0.9, glyph: "◉" },
];
// Weighted picker — main-sequence stars are more common than giants.
// New entries (PSR, BH) are appended at the end and use very small weights.
const STELLAR_WEIGHTS = [2, 5, 8, 10, 14, 12, 6, 2, 20, 8, 2, 1];
const _stellarWSum = STELLAR_WEIGHTS.reduce((a, b) => a + b, 0);
function stellarClassOf(e: Entity): StellarClass {
  const h = hash01(e.id * 977 + 31);
  let r = h * _stellarWSum;
  for (let i = 0; i < STELLAR_CLASSES.length; i++) {
    r -= STELLAR_WEIGHTS[i];
    if (r <= 0) return STELLAR_CLASSES[i];
  }
  return STELLAR_CLASSES[4]; // G-class fallback
}

// Nebula palettes — irregular, colored gas clouds. Each nebula picks one.
// [core, mid, edge] so the noise-driven fill can layer three glyph shades.
const NEBULA_PALETTES: [string, string, string][] = [
  ["#e6b8ff", "#c47afc", "#5a2a8a"], // classic violet
  ["#ffb0d4", "#ff5a9a", "#8a1a4a"], // rose / pink emission
  ["#7affc4", "#2ac48a", "#0a5a3a"], // green / OIII
  ["#8ac8ff", "#3a7ad4", "#0a2a5a"], // deep blue reflection
  ["#ffd4a0", "#e08a3a", "#6a3010"], // amber dust cloud
  ["#ffe6ff", "#c88aff", "#4a2a7a"], // pale lilac wisp
  ["#a0ffff", "#3adcdc", "#0a5a5a"], // cyan / turquoise
  ["#ff8a5a", "#c43a20", "#5a1005"], // crimson / supernova remnant
];
const NEBULA_GLYPHS = ["▒", "▓", "░", "▒", "%", "&", "*", "~"];
function nebulaPalette(e: Entity): [string, string, string] {
  return NEBULA_PALETTES[Math.floor(hash01(e.id * 613 + 7) * NEBULA_PALETTES.length)];
}
// Cheap 2D value-noise on integer grid cells, seeded per-entity. Used for
// nebula shape so each cloud has its own irregular outline instead of a
// perfect disc.
function nebulaNoise(id: number, gx: number, gy: number): number {
  const a = hash01(id * 9301 + gx * 131 + gy * 7919);
  const b = hash01(id * 9301 + (gx + 1) * 131 + gy * 7919);
  const c = hash01(id * 9301 + gx * 131 + (gy + 1) * 7919);
  const d = hash01(id * 9301 + (gx + 1) * 131 + (gy + 1) * 7919);
  return (a + b + c + d) * 0.25;
}

function tintFor(e: Entity): { fill: string; edge: string } {
  const h = hash01(e.id);
  switch (e.kind) {
    case "planet": {
      const i = Math.floor(h * PLANET_FILLS.length);
      return { fill: PLANET_FILLS[i], edge: PLANET_EDGES[i] };
    }
    case "station": {
      if (e.faction === "pirate") return { fill: "#c44", edge: "#ff7766" };
      const i = Math.floor(h * STATION_FILLS.length);
      return { fill: STATION_FILLS[i], edge: "#8a8ad0" };
    }
    case "star": {
      const sc = stellarClassOf(e);
      // Pulsars flicker: period ~0.6s, phase offset per-id. Off-beat drops
      // fill to the halo color so the star reads as blinking.
      if (sc.name === "PSR") {
        const phase = hash01(e.id * 1301) * Math.PI * 2;
        const t = performance.now() / 1000;
        const on = Math.sin(t * 10 + phase) > 0.2;
        return { fill: on ? sc.color : sc.halo, edge: sc.edge };
      }
      return { fill: sc.color, edge: sc.edge };
    }
    case "derelict": {
      return { fill: "#c0d0d8", edge: "#5a6870" };
    }
    case "asteroid": {
      const i = Math.floor(h * ASTEROID_FILLS.length);
      return { fill: ASTEROID_FILLS[i], edge: "#5a4838" };
    }
    case "nebula": {
      const p = nebulaPalette(e);
      return { fill: p[0], edge: p[1] };
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
  // Last reason gameplay returned to the title screen. Rendered on the title
  // so an unexpected dump has a visible breadcrumb instead of feeling silent.
  titleNotice: string | null = null;
  titleNoticeAt = 0;
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
  // Throttles for periodic respawning from stations / planets / pirate bases.
  private _nextCivSpawnAt = 25;
  private _nextPirateSpawnAt = 18;
  private _nextPlanetSpawnAt = 60;
  // Rare phenomena (UFO / Thargoid / wormhole / alien comms) scheduler state.
  _empUntil = 0;                    // performance.now()/1000 while Thargoid field is active
  _wormholeCooldown = 0;            // seconds; blocks re-entry after a jump
  _nextRareAt = 45;                 // seconds until next surprise spawn near player
  _nextAlienAt = 60;                // seconds until next alien transmission
  _empActive = false;               // set each frame from _empUntil, checked in fire block
  // Simple FPS counter (toggleable in Options).
  fps = 0;
  private _fpsAcc = 0;
  private _fpsFrames = 0;
  // Audio: small WebAudio context for cheap beeps (hit / death / dock).
  audio: AudioContext | null = null;
  // Radio player state — either an HTMLAudioElement (for streams / custom
  // URL) or a chiptune sequencer running against the shared AudioContext.
  private radioAudio: HTMLAudioElement | null = null;
  private radioActiveId: string | null = null;      // last successfully started preset
  private radioChipTimer: number | null = null;     // window.setInterval id
  private radioChipGain: GainNode | null = null;
  private radioChipStep = 0;
  private radioChipSeed = 1;
  private radioMasterGain: GainNode | null = null;  // master music bus

  // Starfield: world-space points that parallax around the player to give a
  // visceral sense of velocity and heading. Lazily seeded on first render.
  // Each star carries a brightness "tier" so the field has depth.
  private stars: { x: number; y: number; z: number; t: number }[] = [];
  // Title-screen drifting stars (camera-local 2D, no player required).
  private titleStars: { x: number; y: number; z: number; t: number }[] = [];
  private _lastRenderTs = 0;
  private _frameNo = 0;
  private _lastRecorderAt = 0;
  private _lastRecordedScreen: Screen = "title";
  // Reusable grid buffer — allocated once per resize, reset in place each
  // frame instead of allocating ~rows*cols fresh objects (was a major GC source).
  private _gridBuf: Cell[][] | null = null;
  private _gridCols = 0;
  private _gridRows = 0;
  // Respect OS-level motion preference. When true, skip flashes / fire FX /
  // shimmer so motion-sensitive players aren't strobed.
  private _reducedMotion = false;
  // Pause flag toggled on visibilitychange — skip update+render while hidden
  // so backgrounded tabs stop burning CPU.
  private _hidden = false;
  // --- Damage feedback state (set in updatePlaying, consumed by renderPlaying) ---
  private prevShield = -1;          // tracks shield from previous tick to detect drop-to-0
  private prevHull = -1;            // tracks hull from previous tick to detect any damage
  private shieldFlashUntil = 0;     // wall-time (s) until the shield-loss flash decays
  private hullFlashUntil = 0;       // wall-time (s) until the red hull-hit flash decays
  private nextHullAlarmAt = 0;      // periodic low-hull alarm beep timer
  private nextFuelAlarmAt = 0;      // periodic low-fuel alarm beep timer
  private prevGunnerKills = 0;      // to detect gunner-assisted kills for chatter
  // AbortController used to detach every window/document listener on stop().
  // Without this, HMR remounts in dev (or a future second-instance scenario)
  // would leak listeners that keep stale engine refs alive.
  private _abort = new AbortController();

  // --- UI overlays added in the situational-awareness pass ----------------
  // Pinned quest tracker: when true, render a compact mission panel anchored
  // to the top-right of the viewport during play. Toggled with K.
  questPinned = true;
  // Snap timer for targeting brackets — brackets "tighten in" from a wide
  // box to a tight one over a few frames when a new target is acquired.
  private _bracketTargetId: number | null = null;
  private _bracketAcquiredAt = 0;
  // Screen we came from when opening the Codex so ESC returns where we were.
  private _codexReturn: Screen = "title";
  // Codex page: 0 = symbols, 1 = colors, 2 = keys.
  private _codexPage = 0;
  // Bounds of the clickable source-code link drawn at the bottom of the Codex.
  private _codexLinkRect: { x: number; y: number; w: number; h: number } | null = null;
  // Fuel-scoop chatter throttle. When set, we're actively scooping a star;
  // reused by the HUD to render a "SCOOPING" badge.
  private _scoopingUntil = 0;
  // Screen-shake state: renderer offsets the grid draw pass by up to this
  // many pixels when performance.now()/1000 < _shakeUntil.
  private _shakeUntil = 0;
  private _shakeMag = 0;



  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.fit();
    const sig = this._abort.signal;
    window.addEventListener("resize", () => this.fit(), { signal: sig });
    this.input.attach(canvas, sig);
    canvas.focus();
    // Global error trap so async/uncaught errors during gameplay show on the
    // crash screen instead of vanishing into the console.
    window.addEventListener("error", (ev) => {
      if (this.screen !== "crashed" && this.screen !== "title") {
        this.crash(ev.error ?? new Error(ev.message));
      }
    }, { signal: sig });
    window.addEventListener("unhandledrejection", (ev) => {
      if (this.screen !== "crashed" && this.screen !== "title") {
        const r = ev.reason;
        this.crash(r instanceof Error ? r : new Error(String(r)));
      }
    }, { signal: sig });
    try {
      const saved = readDiagnostic<{ reason?: string; wall?: number }>(TITLE_NOTICE_KEY);
      if (saved?.reason && saved.wall && Date.now() - saved.wall < 5 * 60_000) {
        this.titleNotice = saved.reason;
        this.titleNoticeAt = performance.now() / 1000;
      }
      if (!this.titleNotice) {
        const rec = readDiagnostic<FlightRecorder>(FLIGHT_RECORDER_KEY);
        const fresh = rec?.wall && Date.now() - rec.wall < 5 * 60_000;
        const wasInFlight = rec?.screen === "playing" || rec?.screen === "menu" || rec?.screen === "station" || rec?.screen === "destroyed" || rec?.screen === "crashed";
        if (rec && fresh && wasInFlight && !rec.clean && this.options.cheat) {
          const hull = rec.hullMax ? ` hull ${Math.round(rec.hull ?? 0)}/${Math.round(rec.hullMax)}` : "";
          this.setTitleNotice(`Recovered after engine restart while ${rec.screen}; last record: ${rec.reason}${hull}; entities ${rec.entityCount}; frame ${rec.frame}.`);
        }

      }
    } catch { /* ignore diagnostic restore failures */ }
    window.addEventListener("pagehide", () => this.recordFlight("page hidden/unloaded", this.screen === "title", true), { signal: sig });
    // Pause when the tab is hidden — no point burning rAF cycles offscreen.
    document.addEventListener("visibilitychange", () => {
      this._hidden = document.visibilityState === "hidden";
      if (!this._hidden) this.lastTs = performance.now();
    }, { signal: sig });
    // Honour OS-level reduced-motion preference for flashes / fire FX.
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      this._reducedMotion = mq.matches;
      mq.addEventListener?.("change", (e) => { this._reducedMotion = e.matches; }, { signal: sig });
    } catch { /* matchMedia unavailable */ }
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
      // While the tab is hidden, idle cheaply — don't update or render.
      if (this._hidden) {
        this.lastTs = ts;
        this.rafId = requestAnimationFrame(loop);
        return;
      }
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
    this.recordFlight(`engine stopped while ${this.screen}`, this.screen === "title", true);
    this.running = false;
    cancelAnimationFrame(this.rafId);
    // Detach every window/document/canvas listener registered with this signal.
    this._abort.abort();
  }

  pushLog(msg: string) {
    this.log.push({ t: performance.now() / 1000, msg });
    if (this.log.length > 6) this.log.shift();
  }

  recordFlight(reason: string, clean = false, force = false) {
    const now = performance.now() / 1000;
    if (!force && now - this._lastRecorderAt < 1.5 && this.screen === this._lastRecordedScreen) return;
    this._lastRecorderAt = now;
    this._lastRecordedScreen = this.screen;
    const p = this.player;
    const rec: FlightRecorder = {
      wall: Date.now(),
      frame: this._frameNo,
      screen: this.screen,
      reason,
      clean,
      hull: p?.ship.hull,
      hullMax: p?.ship.hullMax,
      shield: p?.ship.shield,
      shieldMax: p?.ship.shieldMax,
      fuel: p?.ship.fuel,
      pos: p ? { ...p.pos } : undefined,
      entityCount: this.entities.length,
      lastLog: this.log[this.log.length - 1]?.msg,
      deathReason: this.deathReason,
      crashError: this.crashError,
    };
    writeDiagnostic(FLIGHT_RECORDER_KEY, rec);
  }

  setTitleNotice(reason: string) {
    this.titleNotice = reason.slice(0, 220);
    this.titleNoticeAt = performance.now() / 1000;
    writeDiagnostic(TITLE_NOTICE_KEY, { reason: this.titleNotice, wall: Date.now() });
    // eslint-disable-next-line no-console
    console.info("[ASCII Frontier] title return:", this.titleNotice);
  }

  clearTitleNotice() {
    this.titleNotice = null;
    this.titleNoticeAt = 0;
    removeDiagnostic(TITLE_NOTICE_KEY);
    removeDiagnostic(FLIGHT_RECORDER_KEY);
  }

  returnToTitle(reason: string, clearPlayer = true) {
    if (clearPlayer) this.player = null;
    // Diagnostic return-to-title notices are debug noise for normal play —
    // surface them only when the player has Cheat Mode (dev mode) on.
    if (this.options.cheat) this.setTitleNotice(reason);
    this.recordFlight(`explicit return to title: ${reason}`, true, true);
    this.screen = "title";
    this.menuCursor = 0;
  }

  noteImplicitTitleReturn(from: Screen, noticeAtBefore: number) {
    if (from === "title" || this.screen !== "title" || this.titleNoticeAt !== noticeAtBefore) return;
    if (from === "options" || from === "load" || from === "create-char" || from === "create-ship") return;
    if (!this.options.cheat) return; // debug-only diagnostic
    this.setTitleNotice(`Unexpected return to title from ${from}; no explicit reason was recorded.`);

  }

  // Append a single line to the comms / chatter feed shown in the COMMS box.
  // Newest line floats to the top. Capped at 6 lines so it never crowds the HUD.
  pushChatter(who: string, msg: string, color = "#9fe") {
    this.chatter.unshift({ t: performance.now() / 1000, who, msg, color });
    if (this.chatter.length > 6) this.chatter.pop();
  }

  // Eerie alien transmission generator — glyph-mixed strings that read as
  // untranslatable telemetry. Purely cosmetic; a few templates seeded with
  // occasional real-word fragments to imply almost-meaning.
  alienGibberish(): string {
    const glyphs = "◊∆∇≡Θξζψχφ▲▼◄►◇◈☌☍♁♆⌬⏃⏂⌘※∴∵";
    const phon = ["xa", "vok", "th", "ith", "ael", "orr", "nn", "ryx", "uun", "gha", "shk", "'", "-"];
    const words: string[] = [];
    const nW = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < nW; i++) {
      const parts = 2 + Math.floor(Math.random() * 3);
      let w = "";
      for (let j = 0; j < parts; j++) w += phon[Math.floor(Math.random() * phon.length)];
      words.push(w);
    }
    // Sprinkle glyph clusters.
    const g1 = glyphs[Math.floor(Math.random() * glyphs.length)];
    const g2 = glyphs[Math.floor(Math.random() * glyphs.length)];
    const templates = [
      `${g1}${g2} ${words.join(" ")} ${g2}`,
      `... ${words.slice(0, 2).join(" ")} ${g1} ${words.slice(2).join(" ")} ...`,
      `${words.join(".")} — ${g1}${g2}${g1}`,
      `[${g1}] ${words.join(" ")} [${g2}]`,
      `${g1} we ${g2} return — ${words[0]} ${g1}`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Occasional surprise: pick one rare phenomenon and spawn it near the
  // player. Extends the sense that the frontier is alive without cluttering
  // the persistent world. Suppressed while docked.
  spawnRarePhenomenon(p: PlayerState, _now: number) {
    if (this.dockedStationId != null) return;
    const roll = Math.random();
    // 40% jetsam drift, 30% wandering UFO, 15% derelict distress, 10% alien
    // transmission only, 5% Thargoid arrival.
    const off = () => ({
      x: (Math.random() - 0.5) * 900,
      y: (Math.random() - 0.5) * 300,
      z: (Math.random() - 0.5) * 900,
    });
    if (roll < 0.40) {
      // Jetsam field: 1-4 loot canisters drifting together.
      const n = 1 + Math.floor(Math.random() * 4);
      const base = V.add(p.pos, off());
      const kinds = ["ore", "supplies", "salvage", "medkit", "black-box"];
      const label = kinds[Math.floor(Math.random() * kinds.length)];
      for (let i = 0; i < n; i++) {
        this.entities.push({
          id: nextId(), kind: "loot", name: label,
          pos: V.add(base, { x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 60 }),
          vel: { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 },
          faction: "wreck",
          ttlAt: performance.now() / 1000 + 240,
          loot: { credits: 30 + Math.floor(Math.random() * 90), ore: Math.floor(Math.random() * 6) },
        });
      }
      this.pushChatter("Sensors", `Drifting ${label} canisters on scope — fly through to collect.`, "#ffe066");
    } else if (roll < 0.70) {
      // Spawn a wandering UFO within visual range.
      this.entities.push({
        id: nextId(), kind: "ufo", name: nameFrom(this.rng, "UAP"),
        pos: V.add(p.pos, off()),
        vel: { x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 },
        faction: "alien", state: "wander",
      });
      this.pushChatter("Sensors", "Unidentified aerial phenomenon on long-range scope.", "#9effd2");
    } else if (roll < 0.85) {
      // A derelict distress beacon nearby (may be a trap — same rules).
      const trap = Math.random() < 0.35;
      this.entities.push({
        id: nextId(), kind: "beacon",
        name: trap ? "Distress (?)" : "Distress",
        pos: V.add(p.pos, off()),
        vel: { x: 0, y: 0, z: 0 }, faction: "wreck",
        state: trap ? "trap" : "rescue",
        loot: { credits: 140 + Math.floor(Math.random() * 220) },
      });
      this.pushChatter("Comms", "...mayday...position...any vessel...", "#ff66cc");
    } else if (roll < 0.95) {
      // Just an eerie transmission — no entity.
      this.pushChatter("???", this.alienGibberish(), "#a0ff3a");
    } else {
      // Thargoid encounter: wake the first dormant one and force it to
      // trigger this frame. Skipped if none exist.
      const thg = this.entities.find((e) => e.kind === "thargoid" && e.state === "dormant");
      if (thg) thg.cooldown = 0.01;
      this.pushChatter("Sensors", "Unknown signature approaching. Very fast.", "#a0ff3a");
    }
  }


  // Build the slot dictionary used by the procedural chatter generator.
  // Pulls live state so generated lines reference the player's actual ship,
  // hull%, current target, sector coords, cargo, etc. — not canned text.
  chatterCtx(speaker?: Entity, opts?: { target?: Entity | null; a?: string; b?: string }): ChatterCtx {
    const p = this.player!;
    const hullPct   = Math.round(100 * (p.ship.hull / p.ship.hullMax));
    const shieldPct = Math.round(100 * (p.ship.shield / Math.max(1, p.ship.shieldMax)));
    const fuelPct   = Math.round(100 * (p.ship.fuel / Math.max(1, p.ship.fuelMax)));
    const cargoPct  = Math.round(100 * (cargoTotal(p) / Math.max(1, p.ship.cargoMax)));
    const shipName  = SHIP_HULLS.find((h) => h.id === p.ship.hullId)?.name ?? p.ship.hullId;
    const sector    = `${Math.floor(p.pos.x / 500)}:${Math.floor(p.pos.z / 500)}`;
    const target    = opts?.target ?? this.entities.find((e) => e.id === this.targetId) ?? null;
    // Linear scan with squared-distance — no array/closure/sort overhead.
    let nearestHostile: Entity | undefined;
    {
      let bestD2 = Infinity;
      for (const e of this.entities) {
        if (e.kind !== "hostile") continue;
        const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; nearestHostile = e; }
      }
    }

    const speakerName = speaker?.name ?? "Comms";
    return {
      cmdr: p.char.name,
      ship: shipName,
      speaker: speakerName,
      short: speakerName.split(" ")[0],
      hull: String(hullPct),
      shield: String(shieldPct),
      fuel: String(fuelPct),
      cargo: String(cargoPct),
      credits: String(p.credits),
      kills: String(p.kills ?? 0),
      target: target?.name ?? "the target",
      nearest: nearestHostile?.name ?? speakerName,
      sector,
      ore: String(p.cargo.ore ?? 0),
      fac: speaker?.faction ?? "Federation",
      dist: target ? String(Math.round(V.len(V.sub(target.pos, p.pos)))) : "?",
      a: opts?.a ?? "Crew",
      b: opts?.b ?? "Crew",
    };
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
    this.sfx("boom");
  }

  // Capture a runtime error from the loop / global handlers and freeze on
  // the crash screen. Keeps the player from being silently kicked to menu.
  crash(err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    this.crashError = e.message || "Unknown error";
    this.crashStack = (e.stack || "").split("\n").slice(0, 8).join("\n");
    this.recordFlight(`crash: ${this.crashError}`, false, true);
    // eslint-disable-next-line no-console
    console.error("[Voidwake crash]", e);
    // Also persist as a title notice so if the page reloads (HMR, React
    // remount, etc.) and we land on the title without seeing the crash
    // screen, the LAST EXIT banner still reports the cause.
    writeDiagnostic(TITLE_NOTICE_KEY, { reason: `Crash: ${this.crashError}`, wall: Date.now() });
    this.screen = "crashed";
    this.menuCursor = 0;
  }

  // WebAudio: lazily open the context on first use (autoplay-policy safe).
  private ensureAudio(): AudioContext | null {
    try {
      if (!this.audio) {
        this.audio = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = this.audio;
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch { return null; }
  }

  // Punchier 16-bit-style blip. Layers a pitch-glided oscillator with a short
  // noise "chip" burst so we get the crunch of a NES/GB era sound chip
  // instead of a pure sine tone. Keeps the original `beep(freq,dur,type)`
  // signature so existing call sites still work.
  beep(freq = 440, dur = 0.08, type: OscillatorType = "square", opts?: { glide?: number; noise?: number; detune?: number }) {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime;
      const vol = this.options.volumeMaster * this.options.volumeSfx * 0.18;
      if (vol <= 0.0001) return;

      // Main oscillator: pitch glide gives the "zap" character.
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      const glide = opts?.glide ?? 0;
      if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * Math.exp(glide)), t0 + dur);
      if (opts?.detune) o.detune.value = opts.detune;
      g.gain.setValueAtTime(vol, t0);
      // Fast attack / punchy body / exp decay — signature 8/16-bit envelope.
      g.gain.exponentialRampToValueAtTime(vol * 0.5, t0 + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0002, t0 + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);

      // Optional noise chip layered on top — great for hits and explosions.
      const noiseAmt = opts?.noise ?? 0;
      if (noiseAmt > 0) {
        const nDur = dur * 0.6;
        const sr = ctx.sampleRate;
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(sr * nDur)), sr);
        const data = buf.getChannelData(0);
        // Sample-and-hold quantized noise reads more retro than white noise.
        let hold = 0;
        for (let i = 0; i < data.length; i++) {
          if ((i & 7) === 0) hold = Math.random() * 2 - 1;
          data[i] = hold;
        }
        const n = ctx.createBufferSource();
        n.buffer = buf;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * noiseAmt, t0);
        ng.gain.exponentialRampToValueAtTime(0.0002, t0 + nDur);
        n.connect(ng).connect(ctx.destination);
        n.start(t0);
        n.stop(t0 + nDur + 0.02);
      }
    } catch { /* audio unavailable; non-fatal */ }
  }

  // Named 16-bit SFX. Each is a tuned combination of beep() + noise so the
  // event has a recognizable character instead of just "another chirp".
  sfx(name: "laser" | "hit" | "explode" | "dock" | "click" | "alarm" | "mining" | "chime" | "jettison" | "boom") {
    switch (name) {
      case "laser":
        // Downward-glided square with a tick of noise — classic pew.
        this.beep(1200, 0.09, "square",   { glide: -1.6, noise: 0.15 });
        this.beep( 600, 0.05, "triangle", { glide: -0.6 });
        break;
      case "hit":
        this.beep(360, 0.07, "square", { glide: -0.8, noise: 0.55, detune: 25 });
        break;
      case "explode":
        this.beep(180, 0.35, "sawtooth", { glide: -1.4, noise: 1.0 });
        this.beep( 90, 0.30, "triangle", { glide: -0.8, noise: 0.6 });
        break;
      case "boom":
        this.beep(120, 0.6, "sawtooth", { glide: -1.2, noise: 0.9 });
        this.beep( 70, 0.5, "triangle", { glide: -0.6, noise: 0.5 });
        break;
      case "dock":
        this.beep(660, 0.09, "square");
        setTimeout(() => this.beep(990, 0.12, "square"), 90);
        setTimeout(() => this.beep(1320, 0.14, "triangle"), 200);
        break;
      case "chime":
        this.beep(880, 0.14, "triangle");
        setTimeout(() => this.beep(1175, 0.14, "triangle"), 110);
        setTimeout(() => this.beep(1568, 0.20, "triangle"), 220);
        break;
      case "mining":
        this.beep(240, 0.10, "sawtooth", { glide: 0.4, noise: 0.35 });
        break;
      case "click":
        this.beep(1400, 0.03, "square", { noise: 0.2 });
        break;
      case "alarm":
        this.beep(700, 0.12, "square", { glide: -0.5 });
        setTimeout(() => this.beep(500, 0.14, "square", { glide: -0.5 }), 130);
        break;
      case "jettison":
        this.beep(340, 0.07, "triangle", { glide: -0.9, noise: 0.3 });
        break;
    }
  }

  // ---- Radio (in-game music) -----------------------------------------------
  // Reads Options.radioMode / radioCustomUrl and drives either an
  // HTMLAudioElement (streams / custom URL) or a WebAudio chiptune sequencer.
  // Call syncRadio() any time volume, mode, or URL changes.
  syncRadio(): void {
    const opt = this.options;
    const vol = Math.max(0, Math.min(1, opt.volumeMaster * opt.volumeMusic));
    // Update volume on live sources first — cheap path when only volume moved.
    if (this.radioAudio) this.radioAudio.volume = vol;
    if (this.radioMasterGain) this.radioMasterGain.gain.value = vol * 0.4;

    // If the requested preset changed, stop what's playing and start the new.
    if (opt.radioMode === this.radioActiveId) return;
    this.stopRadio();
    const preset = RADIO_PRESETS.find((p) => p.id === opt.radioMode);
    if (!preset || preset.kind === "off") { this.radioActiveId = "off"; return; }

    if (preset.kind === "chiptune") {
      const ctx = this.ensureAudio();
      if (!ctx) return;
      this.radioChipSeed = preset.seed ?? 1;
      this.radioChipStep = 0;
      const master = ctx.createGain();
      master.gain.value = vol * 0.4;
      master.connect(ctx.destination);
      this.radioMasterGain = master;
      this.radioChipGain = master;
      const bpm = 108;
      const stepMs = (60_000 / bpm) / 4; // 16th notes
      this.radioChipTimer = window.setInterval(() => this.chiptuneStep(), stepMs);
      this.radioActiveId = preset.id;
    } else {
      // Stream or custom URL.
      const url = preset.kind === "custom" ? opt.radioCustomUrl.trim() : (preset.url ?? "");
      if (!url) { this.radioActiveId = null; return; }
      try {
        const a = new Audio(url);
        a.crossOrigin = "anonymous";
        a.volume = vol;
        a.autoplay = true;
        a.loop = false;
        a.addEventListener("error", () => this.pushChatter("Radio", "signal lost.", "#c47afc"));
        void a.play().catch(() => this.pushChatter("Radio", "unable to tune in (autoplay blocked?).", "#c47afc"));
        this.radioAudio = a;
        this.radioActiveId = preset.id;
      } catch { this.radioActiveId = null; }
    }
  }

  stopRadio(): void {
    if (this.radioAudio) {
      try { this.radioAudio.pause(); this.radioAudio.src = ""; } catch { /* ignore */ }
      this.radioAudio = null;
    }
    if (this.radioChipTimer != null) { clearInterval(this.radioChipTimer); this.radioChipTimer = null; }
    if (this.radioMasterGain) { try { this.radioMasterGain.disconnect(); } catch { /* ignore */ } this.radioMasterGain = null; }
    this.radioChipGain = null;
    this.radioActiveId = null;
  }

  // Chiptune sequencer step: emits one 16th-note tick. Uses a per-preset
  // seeded pattern of pitches over a pentatonic scale + a bass note every
  // downbeat. Enough personality to feel composed without any external data.
  private chiptuneStep(): void {
    const ctx = this.audio;
    const bus = this.radioChipGain;
    if (!ctx || !bus) return;
    const step = this.radioChipStep++;
    const seed = this.radioChipSeed;
    // Minor pentatonic in A (Hz): A3, C4, D4, E4, G4, A4, C5, D5, E5, G5.
    const scale = [220, 262, 294, 330, 392, 440, 523, 587, 659, 784];
    const barPos = step % 16;
    const barIdx = Math.floor(step / 16);
    const t0 = ctx.currentTime;

    // Lead melody every 2nd step, avoiding 16th 12 (breath) for variety.
    if (barPos % 2 === 0 && barPos !== 12) {
      const h = hash01(seed * 131 + barIdx * 7 + barPos);
      const note = scale[Math.floor(h * scale.length)];
      const dur = 0.22;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = note;
      g.gain.setValueAtTime(0.28, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(bus);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    // Bass on every quarter note.
    if (barPos % 4 === 0) {
      const roots = [110, 98, 130.81, 87.31]; // A2, G2, C3, F2 (loose iv-VII-I-VI feel)
      const root = roots[Math.floor(hash01(seed * 17 + barIdx) * roots.length)];
      const dur = 0.34;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = root;
      g.gain.setValueAtTime(0.55, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(bus);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    // Hi-hat noise on the off-beats.
    if (barPos % 4 === 2) {
      const sr = ctx.sampleRate;
      const dur = 0.06;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const n = ctx.createBufferSource();
      n.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.value = 0.18;
      n.connect(ng).connect(bus);
      n.start(t0); n.stop(t0 + dur);
    }
  }



  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  update(dt: number) {
    this._frameNo++;
    const screenBefore = this.screen;
    const noticeAtBefore = this.titleNoticeAt;
    const kb = this.options.keybinds;
    this.recordFlight(`updating ${this.screen}`);
    // Global: ESC toggles main menu while playing
    if (this.input.consume(kb.menu)) {
      if (this.screen === "playing") { this.prevPlayScreen = this.screen; this.screen = "menu"; this.menuCursor = 0; }
      else if (this.screen === "menu" || this.screen === "options" || this.screen === "load" || this.screen === "save" || this.screen === "quit-confirm") {
        this.screen = this.player ? "playing" : "title";
      } else if (this.screen === "station") {
        this.screen = "playing";
      } else if (this.screen === "codex") {
        this.screen = this._codexReturn;
        this.menuCursor = 0;
      } else if (this.screen === "quest-log") {
        this.screen = this._codexReturn;
        this.menuCursor = 0;
      }
    }

    switch (this.screen) {
      case "title": this.updateTitle(); break;
      case "create-char": this.updateCharCreate(); break;
      case "create-ship": this.updateShipCreate(); break;
      case "playing": this.updatePlaying(dt); break;
      case "menu": this.updateMenu(); break;
      case "options": this.updateOptions(); break;
      case "load": this.updateLoad(); break;
      case "save": this.updateSave(); break;
      case "station": this.updateStation(); break;
      case "quit-confirm": this.updateQuitConfirm(); break;
      case "destroyed": this.updateDestroyed(); break;
      case "crashed": this.updateCrashed(); break;
      case "codex": this.updateCodex(); break;
      case "quest-log": this.updateQuestLog(); break;
    }
    this.noteImplicitTitleReturn(screenBefore, noticeAtBefore);
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
            this.syncRadio();
            return;
          }
        }
        this.pushLog("No save available.");
      }
      this.returnToTitle(`Crash menu: ${this.crashError ?? "unknown error"}`);
      this.crashError = null; this.crashStack = null;
    }

  }

  // --- Destroyed (death) screen -------------------------------------------
  // Menu items are computed each frame so "Respawn at Station" only appears
  // when permadeath is OFF — softcore players get a rescue path instead of
  // being forced to load a save or dump to title.
  get destroyedItems(): string[] {
    return this.options.permadeath
      ? ["Load Last Save", "Return to Main Menu"]
      : ["Respawn at Station", "Load Last Save", "Return to Main Menu"];
  }
  updateDestroyed() {
    // Brief grace period so the player actually reads the banner rather than
    // dismissing it with a held key from the moment of death.
    const now = performance.now() / 1000;
    const grace = 2.5;
    if (now - this.destroyedAt < grace) {
      this.input.consume("enter");
      this.input.consume("arrowup");
      this.input.consume("arrowdown");
      return;
    }
    const items = this.destroyedItems;
    this.menuNav(items.length);
    if (this.input.consume("enter")) {
      const c = items[this.menuCursor];
      const saves = listSaves();
      if (c === "Respawn at Station") {
        this.respawnAtStation();
        return;
      }
      if (c === "Load Last Save") {
        // Permadeath disables save recovery entirely.
        if (this.options.permadeath) {
          this.pushLog("Permadeath: no recovery.");
          return;
        }
        if (saves.length === 0) {
          // Don't silently bounce to title — keep the player here so they
          // know there is nothing to load. This was the "kicked to main
          // menu with no idea why" bug after dying before any autosave.
          this.pushLog("No save available — pick 'Return to Main Menu'.");
          return;
        }
        const blob = loadGame(saves[0].slot);
        if (!blob) {
          this.pushLog(`Save '${saves[0].slot}' is corrupt.`);
          return;
        }
        this.seed = blob.seed;
        this.rng = mulberry32(this.seed);
        this.entities = blob.entities;
        this.player = blob.player;
        this.options = blob.options;
        this.screen = "playing";
        this.pushLog(`Restored from ${saves[0].slot}.`);
        this.syncRadio();
        return;
      }
      // Return to Main Menu
      this.returnToTitle(`Destroyed: ${this.deathReason ?? "unknown cause"}`);
    }
  }

  // Softcore rescue: teleport to nearest station, restore hull/shield, refuel,
  // and skim a rescue fee from credits. Cargo is lost (went up with the ship).
  respawnAtStation() {
    const p = this.player;
    if (!p) { this.returnToTitle("Respawn lost player state.", false); return; }
    const stations = this.entities.filter((e) => e.kind === "station" && e.faction !== "pirate" && (e.hull ?? 1) > 0);
    if (stations.length === 0) {
      this.pushLog("No friendly stations available for rescue.");
      return;
    }
    // Nearest station by 3D distance from last position.
    let best = stations[0];
    let bestD = V.len(V.sub(p.pos, best.pos));
    for (const s of stations) {
      const d = V.len(V.sub(p.pos, s.pos));
      if (d < bestD) { best = s; bestD = d; }
    }
    // Drop the player a short offset off the station so they don't spawn
    // inside it and immediately collide.
    p.pos = { x: best.pos.x + 30, y: best.pos.y + 10, z: best.pos.z + 30 };
    p.heading = { yaw: 0, pitch: 0 };
    p.throttle = 0;
    p.cooldown = 0;
    p.ship.hull = p.ship.hullMax;
    p.ship.shield = p.ship.shieldMax;
    p.ship.fuel = Math.max(p.ship.fuel, Math.floor(p.ship.fuelMax * 0.5));
    // Rescue fee: 25% of credits, capped so brand-new commanders aren't wiped.
    const fee = Math.min(p.credits, Math.max(0, Math.floor(p.credits * 0.25)));
    p.credits -= fee;
    // Cargo is lost with the wreck.
    p.cargo = {};
    this.deathReason = null;
    this.deathKiller = null;
    this.screen = "playing";
    this.pushLog(`Rescued by ${best.name}. Hull restored. Fee: ${fee}cr. Cargo lost.`);
    this.beep(440, 0.2, "sine");
  }



  // --- Title --------------------------------------------------------------
  titleItems = ["New Game", "Load Game", "Legend (Codex)", "Options", "Quit"];
  updateTitle() {
    this.menuNav(this.titleItems.length);
    if (this.input.consume("enter")) {
      const choice = this.titleItems[this.menuCursor];
      if (choice === "New Game") { this.clearTitleNotice(); this.screen = "create-char"; this.menuCursor = 0; }
      else if (choice === "Load Game") { this.clearTitleNotice(); this.screen = "load"; this.menuCursor = 0; }
      else if (choice === "Legend (Codex)") { this._codexReturn = "title"; this.screen = "codex"; this.menuCursor = 0; }
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

  // Capture printable keys into the player name (case-preserving).
  // Uses Input.textBuffer so shift+letter keeps its capitalization; also strips
  // an accidentally-typed leading "Cmdr " since the HUD prepends that title
  // itself (would otherwise render "Cmdr Cmdr Nosaj").
  handleNameInput() {
    for (const k of this.input.textBuffer) {
      if (k === "\b") this.charDraft.name = this.charDraft.name.slice(0, -1);
      else if (/^[\w \-.]$/.test(k) && this.charDraft.name.length < 24) {
        this.charDraft.name += k;
      }
    }
    // Strip any leading "cmdr " (any case) the user typed by habit.
    this.charDraft.name = this.charDraft.name.replace(/^\s*cmdr\.?\s+/i, "");
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
    if (!p) { this.returnToTitle("Gameplay lost player state; returned to title.", false); return; }
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

    // Autopilot (Pilot crew, toggled by O): full auto — approach current
    // target, match velocity, and auto-dock stations / hold orbit at planets.
    // Steers by directly writing to yaw/pitch/throttle so the same movement
    // pipeline below applies (no separate physics).
    const pilotCrew = getCrew(p, "pilot");
    const autopilotOn = !!(pilotCrew && pilotCrew.autopilot);
    if (autopilotOn) this.driveAutopilot(dt, p);

    // Throttle / steering (manual). Autopilot has already written to these
    // this frame; user keys still override — press anything to take back the stick.
    if (keys.has(k.throttleUp)) { p.throttle = Math.min(1, p.throttle + dt * 0.7); this._disengageAutopilot("stick"); }
    if (keys.has(k.throttleDown)) { p.throttle = Math.max(0, p.throttle - dt * 0.7); this._disengageAutopilot("stick"); }
    if (keys.has(k.yawLeft)) { p.heading.yaw -= dt * 1.2; this._disengageAutopilot("stick"); }
    if (keys.has(k.yawRight)) { p.heading.yaw += dt * 1.2; this._disengageAutopilot("stick"); }
    if (keys.has(k.pitchUp)) { p.heading.pitch = Math.max(-Math.PI / 2, p.heading.pitch - dt * 1.0); this._disengageAutopilot("stick"); }
    if (keys.has(k.pitchDown)) { p.heading.pitch = Math.min(Math.PI / 2, p.heading.pitch + dt * 1.0); this._disengageAutopilot("stick"); }

    // Mouse wheel throttle: each notch nudges throttle by ~5%.
    if (this.input.wheelDelta !== 0) {
      const step = -this.input.wheelDelta * 0.001; // scroll up = throttle up
      p.throttle = Math.max(0, Math.min(1, p.throttle + step));
      this._disengageAutopilot("stick");
    }


    // Mouse steering: cursor offset from the *viewport* center (where the
    // reticle / ship's forward vector points) pulls yaw/pitch. Historically
    // we normalized against the entire canvas, so the reticle sat left of the
    // mouse's neutral zone because the right-hand HUD panel eats ~28 cols.
    // Remapping around the viewport keeps the crosshair under the cursor.
    if (this.options.mouseSteer && this.input.mouseInside && !autopilotOn) {
      const sens = this.options.mouseSensitivity;
      const dz = 0.08;
      const cols = Math.max(40, Math.floor(this.canvas.width / CELL_W));
      const rows = Math.max(20, Math.floor(this.canvas.height / CELL_H));
      const vpLeftPx = 1 * CELL_W;
      const vpRightPx = (cols - 28) * CELL_W;
      const vpTopPx = 1 * CELL_H;
      const vpBottomPx = (rows - 9) * CELL_H;
      const vpW = Math.max(1, vpRightPx - vpLeftPx);
      const vpH = Math.max(1, vpBottomPx - vpTopPx);
      // fit() sets canvas.width to CSS clientWidth, so mouseCX (CSS px) is
      // already in canvas pixel units — no DPR compensation required.
      const cxPx = this.input.mouseCX;
      const cyPx = this.input.mouseCY;
      const mx = ((cxPx - vpLeftPx) / vpW) * 2 - 1;
      const my = ((cyPx - vpTopPx) / vpH) * 2 - 1;
      const ax = Math.abs(mx) > dz ? (mx - Math.sign(mx) * dz) : 0;
      const ay = Math.abs(my) > dz ? (my - Math.sign(my) * dz) : 0;
      // Clamp to keep the effective steering rate the same when the cursor
      // strays into the HUD panel (mx/my can exceed 1 there).
      const cax = Math.max(-1, Math.min(1, ax));
      const cay = Math.max(-1, Math.min(1, ay));
      p.heading.yaw += cax * dt * 1.4 * sens;
      p.heading.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p.heading.pitch + cay * dt * 1.1 * sens));
    }

    // Afterburner: hold boost for +60% speed at 4x fuel cost. Disabled when dry.
    const boosting = keys.has(k.boost) && p.ship.fuel > 0;
    // Supercruise: hold for 3x speed at 3x fuel burn. Stacks with afterburner
    // but locks weapons (no fire while super-cruising) so it stays a travel tool.
    const supercruise = keys.has(k.supercruise) && p.ship.fuel > 0;
    const boostMul = (boosting ? 1.6 : 1.0) * (supercruise ? 3.0 : 1.0);
    // Engineer perk: -20% fuel burn.
    const engineerMul = hasCrew(p, "engineer") ? 0.80 : 1.0;
    const fuelMul  = (boosting ? 4.0 : 1.0) * (supercruise ? 3.0 : 1.0) * engineerMul;

    // Forward direction from heading
    const fwd = headingToVec(p.heading.yaw, p.heading.pitch);

    if (p.ship.fuel > 0) {
      // Powered flight: normal thrust. Cache the current velocity so if we
      // stall out mid-frame we keep drifting instead of snapping to zero.
      const sp = p.ship.speed * p.throttle * boostMul;
      const thrustV = V.scale(fwd, sp);
      p.pos = V.add(p.pos, V.scale(thrustV, dt));
      p.driftVel = { x: thrustV.x, y: thrustV.y, z: thrustV.z };
      p.ship.fuel = Math.max(0, p.ship.fuel - sp * dt * 0.001 * fuelMul);
      if (p.ship.fuel === 0) {
        this.pushLog("⚠ FUEL EXHAUSTED — drifting on momentum. Dock to refuel.");
        this.pushChatter("Sensors", "Reactor cold. Coasting only.", "#fc6");
      }
    } else {
      // Zero fuel: keep last drift velocity. Steering and throttle inputs
      // don't change trajectory — you're a bullet with your name on it.
      const dv = p.driftVel ?? { x: 0, y: 0, z: 0 };
      p.pos = V.add(p.pos, V.scale(dv, dt));
    }

    // Shield regen (suppressed while inside a nebula — applied below).
    // Engineer perk: +75% shield recharge rate.
    const shieldRegen = hasCrew(p, "engineer") ? 7.0 : 4.0;
    p.ship.shield = Math.min(p.ship.shieldMax, p.ship.shield + dt * shieldRegen);
    // Engineer perk: slow hull regen while throttle is light and not on fire.
    if (hasCrew(p, "engineer") && p.throttle < 0.35 && p.ship.hull > 0 && p.ship.hull < p.ship.hullMax) {
      p.ship.hull = Math.min(p.ship.hullMax, p.ship.hull + dt * 0.6);
    }

    // --- Environment hazards: nebula drain, beacon pickup, comet wash ------
    const now = performance.now() / 1000;
    let insideNebula = false;
    for (const e of this.entities) {
      if (e.kind === "star") {
        // --- Fuel scooping: skim a star's corona at safe range for free fuel.
        // Sweet spot scales with the star's apparent size (bigger stars scoop
        // from further out). Too close = burn (nebula-style shield/hull etch).
        const sc = stellarClassOf(e);
        const scoopR = 260 * sc.sizeMul;
        const burnR = 90 * sc.sizeMul;
        // Black holes and pulsars aren't safe to scoop from — their gravity /
        // radiation handlers own that band; skip the fuel bonus entirely.
        const scoopable = sc.name !== "BH" && sc.name !== "PSR";
        const d = V.len(V.sub(e.pos, p.pos));
        if (scoopable && d < scoopR && d > burnR && p.ship.fuel < p.ship.fuelMax) {
          // ~6 fuel/sec at the sweet spot (d ≈ burnR), tapering to zero at scoopR.
          const t01 = 1 - (d - burnR) / Math.max(1, scoopR - burnR);
          const rate = 6.0 * Math.max(0, Math.min(1, t01));
          p.ship.fuel = Math.min(p.ship.fuelMax, p.ship.fuel + rate * dt);
          if (!this._scoopingUntil || now > this._scoopingUntil) {
            this.pushChatter("Engineer", `Scooping ${sc.name} corona — refuelling.`, "#fc6");
          }
          this._scoopingUntil = now + 2.0;
        } else if (scoopable && d < burnR && !this.options.cheat) {
          // Inside the burn radius: shield/hull etch until the pilot pulls out.
          if (p.ship.shield > 0) p.ship.shield = Math.max(0, p.ship.shield - dt * 6);
          else p.ship.hull = Math.max(0, p.ship.hull - dt * 3);
        }
      } else if (e.kind === "nebula") {
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < 280) {
          insideNebula = true;
          if (!this.options.cheat) {
            // Slow shield burn; if shields are down, mild hull etch.
            if (p.ship.shield > 0) p.ship.shield = Math.max(0, p.ship.shield - dt * 3);
            else p.ship.hull = Math.max(0, p.ship.hull - dt * 1.2);
          }
        }
      } else if (e.kind === "beacon") {
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < 30) {
          if (e.state === "trap") {
            // Spawn a small pirate wing on contact.
            this.pushLog("☠ Beacon was a pirate trap!");
            this.pushChatter("Beacon", "Got 'em, lads!", "#ff8a8a");
            for (let i = 0; i < 2; i++) {
              this.entities.push({
                id: nextId(), kind: "hostile", name: "Trap Raider",
                pos: V.add(p.pos, { x: (Math.random() - 0.5) * 80, y: (Math.random() - 0.5) * 80, z: (Math.random() - 0.5) * 80 }),
                vel: { x: 0, y: 0, z: 0 },
                faction: "pirate", hull: 45, shield: 25,
                state: "attack", cooldown: 0, weaponId: "pulse",
              });
            }
          } else {
            const cr = e.loot?.credits ?? 150;
            p.credits += cr;
            p.ship.fuel = Math.min(p.ship.fuelMax, p.ship.fuel + 25);
            this.pushLog(`Distress payout: +${cr}cr, +25 fuel.`);
            this.pushChatter("Survivor", "Stars bless you, pilot.", "#9fe");
          }
          // Consume the beacon either way.
          e.hull = -1; e.kind = "loot"; e.loot = {}; e.ttlAt = performance.now() / 1000 + 0.1;
        }
      } else if (e.kind === "derelict") {
        // Silent salvage: fly within 40u to collect credits + ore. No trap.
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < 40) {
          const cr = e.loot?.credits ?? 0;
          const ore = e.loot?.ore ?? 0;
          p.credits += cr;
          if (ore && cargoTotal(p) < p.ship.cargoMax) {
            const take = Math.min(ore, p.ship.cargoMax - cargoTotal(p));
            p.cargo.ore = (p.cargo.ore ?? 0) + take;
            this.pushLog(`Salvaged ${e.name}: +${cr}cr +${take} ore.`);
          } else {
            this.pushLog(`Salvaged ${e.name}: +${cr}cr (hold full — ore left behind).`);
          }
          this.pushChatter("Sensors", `Derelict logged. ${e.name} was a ghost.`, "#c0d0d8");
          this.sfx("chime");
          // Convert to expiring loot so it disappears next tick.
          e.kind = "loot"; e.loot = {}; e.ttlAt = performance.now() / 1000 + 0.1;
        }
      } else if (e.kind === "ufo") {
        // Observe-then-flee. Close approach turns them curious.
        const dv = V.sub(p.pos, e.pos);
        const d = V.len(dv);
        e.cooldown = (e.cooldown ?? 0) - dt;
        if (e.state === "wander") {
          if (d < 900) {
            e.state = "observe";
            e.cooldown = 6 + Math.random() * 4;
            this.pushChatter("Sensors", "Unidentified contact holding station off our bow.", "#9effd2");
            this.sfx("chime");
          } else if ((e.cooldown ?? 0) <= 0) {
            e.cooldown = 3 + Math.random() * 6;
            e.vel = { x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 };
          }
        } else if (e.state === "observe") {
          // Pace the player.
          const desired = V.scale(V.norm(dv), 0);
          const drift = V.scale(V.sub(p.pos, e.pos), 0);
          e.vel = V.add(desired, drift);
          // Match player velocity roughly.
          const pv = p.driftVel ?? { x: 0, y: 0, z: 0 };
          e.vel = V.scale(pv, 0.8);
          if ((e.cooldown ?? 0) <= 0) {
            // Boost away perpendicular to player.
            const away = V.norm({ x: -dv.x + (Math.random() - 0.5) * 200, y: -dv.y, z: -dv.z + (Math.random() - 0.5) * 200 });
            e.vel = V.scale(away, 220); // impulse departure
            e.state = "depart";
            e.cooldown = 2.0;
            this.pushChatter("Sensors", "Contact accelerating — beyond scanner ceiling.", "#9effd2");
          }
        } else if (e.state === "depart") {
          if ((e.cooldown ?? 0) <= 0) {
            // Teleport far away and reset.
            e.pos = randPos(Math.random, WORLD_RADIUS);
            e.vel = { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
            e.state = "wander";
            e.cooldown = 20 + Math.random() * 60;
          }
        }
      } else if (e.kind === "thargoid") {
        // Rare EMP encounter. State: dormant -> approach -> emp -> leave.
        const dv = V.sub(p.pos, e.pos);
        const d = V.len(dv);
        e.cooldown = (e.cooldown ?? 0) - dt;
        if (e.state === "dormant") {
          // Tick down; when it hits zero AND player isn't docked, warp near.
          if ((e.cooldown ?? 0) <= 0 && this.dockedStationId == null) {
            // Warp to just off the player's port bow.
            const off = { x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 200, z: (Math.random() - 0.5) * 600 };
            e.pos = V.add(p.pos, off);
            e.state = "emp";
            e.cooldown = 9 + Math.random() * 4;
            // Engage EMP on the player.
            this._empUntil = now + (e.cooldown ?? 8);
            this.pushLog("⚠ SYSTEMS FAULT — unknown field enveloping the ship.");
            this.pushChatter("???", this.alienGibberish(), "#a0ff3a");
            this.sfx("alarm");
          }
        } else if (e.state === "emp") {
          // Hold station near player; keep EMP active.
          this._empUntil = Math.max(this._empUntil ?? 0, now + 0.25);
          // Ambient garbled comms.
          if (Math.random() < 0.02) this.pushChatter("???", this.alienGibberish(), "#a0ff3a");
          // Slow drift so it appears alive.
          e.vel = V.scale({ x: Math.sin(now * 0.6), y: Math.cos(now * 0.4), z: Math.sin(now * 0.5) }, 4);
          if ((e.cooldown ?? 0) <= 0) {
            e.state = "leave";
            e.cooldown = 1.2;
            this.pushChatter("Sensors", "Field collapsing — controls returning.", "#9effd2");
          }
        } else if (e.state === "leave") {
          // Streak away and re-arm dormant timer.
          const away = V.norm({ x: -dv.x, y: -dv.y, z: -dv.z });
          e.vel = V.scale(away, 400);
          if ((e.cooldown ?? 0) <= 0) {
            e.pos = randPos(Math.random, WORLD_RADIUS * 0.95);
            e.vel = { x: 0, y: 0, z: 0 };
            e.state = "dormant";
            e.cooldown = 240 + Math.random() * 360; // 4-10 minutes
          }
        }
      } else if (e.kind === "wormhole") {
        // Traversable: fly close, warp to sibling. Guard against instant
        // bounce-back via _wormholeCooldown.
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < 60 && (this._wormholeCooldown ?? 0) <= 0) {
          const sib = this.entities.find((x) => x.id === e.targetId && x.kind === "wormhole");
          if (sib) {
            p.pos = V.add(sib.pos, { x: 80, y: 0, z: 80 });
            p.driftVel = { x: 0, y: 0, z: 0 };
            p.throttle = 0;
            this._wormholeCooldown = 3.0;
            this.pushLog(`↯ Slipped through ${e.name} — emerged at ${sib.name}.`);
            this.pushChatter("Navigator", "Reality just... folded. We're somewhere else.", "#c8a0ff");
            this.sfx("dock");
          }
        }
      }
    }
    if (this._wormholeCooldown) this._wormholeCooldown = Math.max(0, this._wormholeCooldown - dt);
    if (insideNebula && Math.random() < 0.01) this.pushChatter("Sensors", "Nebula wash — shields degrading.", "#c47afc");
    // Save flag for renderer (dim starfield, fog overlay).
    (this as unknown as { _inNebula: boolean })._inNebula = insideNebula;
    // Block fire while super-cruising (preserved in fire block below via flag).
    (this as unknown as { _supercruise: boolean })._supercruise = supercruise;

    // --- EMP: if a Thargoid field is active, disable ship systems -----------
    const empActive = (this._empUntil ?? 0) > now;
    if (empActive) {
      p.throttle = 0;
      p.driftVel = V.scale(p.driftVel ?? { x: 0, y: 0, z: 0 }, 0.85);
      // Disable autopilot & block fire further down via _empActive flag.
      if (pilotCrew) pilotCrew.autopilot = false;
    }
    (this as unknown as { _empActive: boolean })._empActive = empActive;

    // --- Rare event scheduler: occasional surprises near the player --------
    this._nextRareAt = (this._nextRareAt ?? 45) - dt;
    if (this._nextRareAt <= 0) {
      this._nextRareAt = 90 + Math.random() * 180; // 1.5-4.5 minutes
      this.spawnRarePhenomenon(p, now);
    }
    // Alien transmissions: eerie static, more likely inside nebulae or during EMP.
    this._nextAlienAt = (this._nextAlienAt ?? 60) - dt;
    if (this._nextAlienAt <= 0) {
      this._nextAlienAt = (insideNebula || empActive ? 25 : 90) + Math.random() * 120;
      this.pushChatter("???", this.alienGibberish(), "#a0ff3a");
    }



    // Cycle target
    if (this.input.consume(k.cycleTarget)) this.cycleTarget();
    if (this.input.consume(k.cycleCatNext)) this.cycleTargetCategory(1);
    if (this.input.consume(k.cycleCatPrev)) this.cycleTargetCategory(-1);

    // Jettison: drop one unit of the heaviest cargo item.
    if (this.input.consume(k.jettison)) {
      const items = Object.entries(p.cargo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (items.length) {
        const [name] = items[0];
        p.cargo[name] = (p.cargo[name] ?? 0) - 1;
        if (p.cargo[name] <= 0) delete p.cargo[name];
        // Spawn a recoverable canister slightly behind the ship.
        const back = V.scale(headingToVec(p.heading.yaw, p.heading.pitch), -25);
        this.entities.push({
          id: nextId(), kind: "loot", name,
          pos: V.add(p.pos, back),
          vel: V.scale(p.driftVel ?? { x: 0, y: 0, z: 0 }, 0.5),
          faction: "player",
          ttlAt: performance.now() / 1000 + 300,
          loot: { ore: name === "ore" ? 1 : 0 },
        });
        this.pushLog(`Jettisoned 1 ${name}.`);
        this.sfx("jettison");
      } else {
        this.pushLog("Cargo hold is empty.");
      }
    }

    // Fire (locked while super-cruising — the FTL field destabilizes shots).
    p.cooldown -= dt;
    const _scState = (this as unknown as { _supercruise?: boolean })._supercruise;
    if (keys.has(k.fire) && p.cooldown <= 0 && !this.options.peaceful && p.ship.fuel >= 0 && !_scState && !this._empActive) {
      const w = WEAPONS.find((x) => x.id === p.ship.weaponId) ?? WEAPONS[0];
      p.cooldown = w.cooldown;
      this.entities.push({
        id: nextId(), kind: "bullet", name: "shot",
        pos: { ...p.pos }, vel: V.scale(fwd, 260),
        faction: "player", ownerId: -1, ttl: 2,
        ttlAt: performance.now() / 1000 + 2,
      });
      this.sfx("laser");
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
    // Toggle Pilot autopilot to current target (O key).
    if (this.input.consume(k.autopilot)) {
      const pilot = getCrew(p, "pilot");
      if (!pilot) this.pushLog("No pilot hired.");
      else if (this.targetId == null) this.pushLog("Autopilot needs a target — press T first.");
      else {
        pilot.autopilot = !pilot.autopilot;
        const t = this.entities.find((e) => e.id === this.targetId);
        this.pushChatter(`Pilot ${pilot.name.split(" ")[0]}`,
          pickLine(pilot.autopilot ? "pilot_autopilot_on" : "pilot_autopilot_off",
            this.chatterCtx(undefined, { target: t })), CREW_ROLE_INFO.pilot.color);
      }
    }
    // Open the Codex/Legend overlay from flight.
    if (this.input.consume(k.legend)) {
      this._codexReturn = "playing";
      this.screen = "codex";
      this.menuCursor = 0;
      return;
    }
    // Toggle the Quest Log popup from flight.
    if (this.input.consume(k.questLog)) {
      this._codexReturn = "playing";
      this.screen = "quest-log";
      this.menuCursor = 0;
      return;
    }
    // Toggle the pinned quest tracker.
    if (this.input.consume(k.pinQuest)) {
      this.questPinned = !this.questPinned;
      this.pushLog(this.questPinned ? "Quest tracker pinned." : "Quest tracker hidden.");
    }

    // Gunner autopilot + loot pickup + ambient chatter (cheap per-tick work).
    this.updateGunner(dt, fwd);
    this.pickupLoot();
    this.tickAmbientChatter(dt);
    this.tickCrewIdle(dt);
    this.tickCrewBanter(dt);
    this.tickRetaliation();
    this.tickRespawns(dt);

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
        const res = saveGame("autosave", blob);
        if (!res.ok) {
          this.pushLog(res.reason === "quota" ? "⚠ Autosave failed: browser storage full." : "⚠ Autosave failed.");
        } else {
          p.lastSaveAt = Date.now();
          this.pushLog("◉ Autosaved.");
        }
      } catch (err) {
        console.warn("Autosave failed", err);
      }
    }

    // Collision damage vs large bodies (planets / stars / stations / rocks).
    // Speed-scaled but forgiving: chip shields at low speeds, big hits at
    // ramming speed. Stars remain instant death. Stations still dock instead
    // of colliding at the dock-range we use elsewhere.
    if (!this.options.cheat) {
      // Approximate current absolute speed (u/s). Uses drift velocity when
      // fuel is out, otherwise the powered-thrust estimate.
      const currentSpeed = p.ship.fuel > 0
        ? p.ship.speed * p.throttle * (keys.has(k.boost) ? 1.6 : 1.0) * (keys.has(k.supercruise) ? 3.0 : 1.0)
        : V.len(p.driftVel ?? { x: 0, y: 0, z: 0 });
      for (const e of this.entities) {
        // Also collide vs NPC ships (any faction). Ramming a ship costs both
        // parties hull; player retaliation applies to same-faction bystanders.
        const isNpcShip = e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral";
        if (isNpcShip) {
          const d2 = V.len(V.sub(e.pos, p.pos));
          if (d2 < 10 && (e.hull ?? 0) > 0) {
            const n = V.scale(V.sub(p.pos, e.pos), 1 / Math.max(0.0001, d2));
            p.pos = V.add(e.pos, V.scale(n, 10.5));
            const speedFactor = Math.min(1, currentSpeed / 100);
            const dmg = Math.min(40, 6 + speedFactor * 40) * this.dmgScale() * dt * 4;
            if ((p.ship.shield ?? 0) > 0) p.ship.shield = Math.max(0, p.ship.shield - dmg);
            else p.ship.hull = Math.max(0, p.ship.hull - dmg);
            // Damage the other ship too, and trigger retaliation.
            e.hull = Math.max(0, (e.hull ?? 0) - dmg * 0.7);
            this.applyFactionRetaliation(e);
            if (p.driftVel) p.driftVel = V.scale(p.driftVel, 0.35);
            p.throttle = Math.min(p.throttle, 0.2);
            this.beep(200, 0.06, "sawtooth");
            if (p.ship.hull <= 0) { this.die(`Rammed ${e.name}`, e.name); return; }
          }
          continue;
        }
        if (e.kind !== "planet" && e.kind !== "star" && e.kind !== "asteroid" && e.kind !== "station") continue;
        const radius = e.kind === "star" ? 40 : e.kind === "planet" ? 30 : e.kind === "station" ? 18 : 10;
        const d = V.len(V.sub(e.pos, p.pos));
        // Black hole gravity: a strong inverse-square pull whenever the player
        // is inside ~800u of a BH-class star. Adds a real "watch your speed"
        // hazard to the sky. Killed on contact via the star radius check below.
        if (e.kind === "star" && stellarClassOf(e).name === "BH" && d < 800 && d > radius) {
          const n = V.scale(V.sub(e.pos, p.pos), 1 / d);
          // Pull scales with 1/d, capped so the frame step stays sane.
          const pull = Math.min(80, 4000 / Math.max(20, d));
          const dv = V.scale(n, pull * dt);
          p.driftVel = V.add(p.driftVel ?? { x: 0, y: 0, z: 0 }, dv);
          p.pos = V.add(p.pos, V.scale(n, pull * dt * 0.5));
          if (d < 200 && Math.random() < 0.05) this.pushLog("⚠ Gravitational shear rising — pull away!");
        }
        // Star fuel scoop: a "corona" ring just outside the kill radius.
        // Skipped for black holes (no photosphere to scoop from).
        if (e.kind === "star" && stellarClassOf(e).name !== "BH" && d > radius && d < radius * 2.0 && p.throttle < 0.35) {
          p.ship.fuel = Math.min(p.ship.fuelMax, p.ship.fuel + dt * 18);
          if (p.ship.shield > 0) p.ship.shield = Math.max(0, p.ship.shield - dt * 5);
          else p.ship.hull = Math.max(0, p.ship.hull - dt * 2);
          if (Math.random() < 0.02) this.pushLog("☼ Scooping stellar fuel — shields straining.");
          if (p.ship.hull <= 0) { this.die(`Burned alive scooping ${e.name}`, e.name); return; }
          continue;
        }
        if (d < radius) {
          const n = V.scale(V.sub(p.pos, e.pos), 1 / Math.max(0.0001, d));
          p.pos = V.add(e.pos, V.scale(n, radius + 0.5));
          if (e.kind === "star") {
            // Instant kill on star contact — no forgiveness.
            const isBH = stellarClassOf(e).name === "BH";
            this.die(isBH ? `Crossed the event horizon of ${e.name}` : `Incinerated by star ${e.name}`, e.name);
            return;
          }
          if (e.kind === "station") {
            // Speed-scaled but forgiving bump.
            const bump = Math.min(20, Math.max(1, currentSpeed * 0.05)) * this.dmgScale() * dt * 4;
            if ((p.ship.shield ?? 0) > 0) p.ship.shield = Math.max(0, p.ship.shield - bump);
            else p.ship.hull = Math.max(0, p.ship.hull - bump);
            p.throttle = Math.min(p.throttle, 0.1);
            // Kill drift velocity on station bump.
            p.driftVel = { x: 0, y: 0, z: 0 };
            this.pushLog(`Bumped ${e.name} — press F to dock.`);
            this.beep(220, 0.06, "square");
            continue;
          }
          // Planet / asteroid ram: scale damage with speed, cap it so a
          // single hit is survivable. Killing throttle prevents infinite churn.
          const speedFactor = Math.min(1, currentSpeed / 100);   // 0..1
          const base = e.kind === "planet" ? 22 : 10;
          const cap = e.kind === "planet" ? 55 : 30;
          const dmg = Math.min(cap, base + speedFactor * cap) * this.dmgScale() * dt * 4;
          if ((p.ship.shield ?? 0) > 0) p.ship.shield = Math.max(0, p.ship.shield - dmg);
          else p.ship.hull = Math.max(0, p.ship.hull - dmg);
          this.beep(180, 0.05, "triangle");
          // Bleed off velocity so the ship "grinds" instead of tunneling.
          if (p.driftVel) p.driftVel = V.scale(p.driftVel, 0.35);
          p.throttle = Math.min(p.throttle, 0.2);
          if (p.ship.hull <= 0) {
            this.die(`Collision with ${e.kind} ${e.name}`, e.name);
            return;
          }
        }
      }
    }



    // Move entities (reuse `now` from earlier this frame)

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
          // Gunner reacts to incoming fire, throttled so it isn't spammy.
          if (p.gunner && p.gunner.enabled && p.gunner.nextBarkAt <= 0) {
            p.gunner.nextBarkAt = 4 + Math.random() * 3;
            this.pushChatter(`Gunner ${p.gunner.name.split(" ")[0]}`,
              pickLine("gunner_hit", this.chatterCtx()), "#ff8a8a");
          }
          if (p.ship.hull <= 0) {
            const shooter = this.entities.find((x) => x.id === e.ownerId);
            const killer = shooter?.name ?? e.faction;
            this.die(`Killed by ${killer}`, killer);
          }
        }
        return false;
      }

      // Enemy hit. Stations are eligible only when their faction is hostile
      // to the bullet's faction (currently: pirate bases shot by anyone non-pirate,
      // civilian stations shot by pirates).
      for (const t of this.entities) {
        const isShip = t.kind === "hostile" || t.kind === "neutral" || t.kind === "friendly";
        const isStation = t.kind === "station";
        if (!isShip && !isStation) continue;
        if ((t.hull ?? 0) <= 0) continue;
        if (e.ownerId === t.id) continue;
        if (e.faction === t.faction && e.faction !== "player") continue;
        // Player bullets are non-aggressive vs civilian stations (would be too
        // easy to grief friendly outposts) — only pirate stations are valid.
        if (isStation && t.faction !== "pirate") continue;
        const hitRadius = isStation ? 22 : 14;
        if (V.len(V.sub(e.pos, t.pos)) < hitRadius) {
          // Damage value: player's weapon if the shot came from the player,
          // otherwise a flat NPC damage value.
          const playerShot = e.faction === "player";
          const dmg = playerShot
            ? (WEAPONS.find((x) => x.id === (this.player?.ship.weaponId)) ?? WEAPONS[0]).dmg
            : 6;
          if ((t.shield ?? 0) > 0) t.shield = Math.max(0, (t.shield ?? 0) - dmg);
          else t.hull = Math.max(0, (t.hull ?? 0) - dmg);
          // Faction retaliation: player-shot ship pings same-faction ships
          // within 2500u to become hostile for 90 seconds.
          if (playerShot && isShip) this.applyFactionRetaliation(t);
          if ((t.hull ?? 0) <= 0) {
            const isPirateBase = isStation && t.faction === "pirate";
            // Only credit the player when they pulled the trigger.
            if (playerShot) {
              this.pushLog(isPirateBase ? `★ Pirate base ${t.name} obliterated!` : `Destroyed ${t.name}.`);
              awardXP(p, isPirateBase ? 250 : 25);
              p.credits += isPirateBase ? 1500 : 50;
              p.kills = (p.kills ?? 0) + 1;
              // Gunner reacts to the kill (when active and not over-talking).
              if (p.gunner && p.gunner.enabled && p.gunner.nextBarkAt <= 0 && Math.random() < 0.7) {
                p.gunner.nextBarkAt = 3 + Math.random() * 2;
                this.pushChatter(`Gunner ${p.gunner.name.split(" ")[0]}`,
                  pickLine("gunner_kill", this.chatterCtx(undefined, { target: t })), "#fc6");
              }
              if (isPirateBase) {
                adjustRep(p, "federation", 12); adjustRep(p, "guild", 8); adjustRep(p, "pirate", -15);
              } else if (t.faction === "pirate") {
                adjustRep(p, "federation", 2); adjustRep(p, "guild", 1); adjustRep(p, "pirate", -3);
              } else if (t.faction === "federation") {
                adjustRep(p, "federation", -8); adjustRep(p, "pirate", 2);
              } else if (t.faction === "guild") {
                adjustRep(p, "guild", -5); adjustRep(p, "pirate", 1);
              }
              // Loot canister
              if (Math.random() < (isPirateBase ? 1.0 : 0.85)) {
                this.entities.push({
                  id: nextId(), kind: "loot", name: isPirateBase ? "cache" : "canister",
                  pos: { ...t.pos },
                  vel: V.scale(t.vel, 0.25),
                  faction: "wreck",
                  ttlAt: performance.now() / 1000 + (isPirateBase ? 120 : 45),
                  loot: {
                    credits: isPirateBase ? 600 + Math.floor(Math.random() * 800) : 20 + Math.floor(Math.random() * 80),
                    ore: isPirateBase ? 10 + Math.floor(Math.random() * 15) : Math.floor(Math.random() * 4),
                  },
                });
              }
              if (p.mission && p.mission.kind === "destroy" && p.mission.targetId === t.id) {
                p.mission.done = true;
                this.pushLog("Bounty completed — return to a station.");
              }
            } else {
              // NPC-on-NPC kill — just log it as ambient color.
              if (Math.random() < 0.4) this.pushLog(`${t.name} was destroyed in a skirmish.`);
            }
            // Convert to debris so AI/render stop treating it as a live ship.
            if (isStation) {
              // Stations become a chunky debris field marker.
              t.kind = "asteroid"; t.ore = 0; t.name = "wreckage"; t.hull = 0;
            } else {
              t.kind = "asteroid"; t.ore = 0; t.name = "debris";
            }
          }
          return false;
        }
      }
      return true;
    });

    // --- Damage-feedback alarms ----------------------------------------------
    // Detect shield collapse this tick (any positive shield reaching zero),
    // and run periodic low-hull / low-fuel klaxons. State is consumed by
    // renderPlaying() for screen flash, bar blink, and critical fire FX.
    const nowS = performance.now() / 1000;
    if (this.prevShield > 0 && p.ship.shield <= 0) {
      this.shieldFlashUntil = nowS + 0.45;
      this.sfx("hit");
    }
    // Red hull-hit flash: any hull drop this tick tints the screen red briefly.
    if (this.prevHull > 0 && p.ship.hull < this.prevHull) {
      this.hullFlashUntil = nowS + 0.35;
      // Screen-shake: proportional to the size of the hit, capped so a wave
      // of small pulse hits doesn't rattle the screen apart.
      const dmg = this.prevHull - p.ship.hull;
      this._shakeUntil = nowS + Math.min(0.35, 0.10 + dmg * 0.015);
      this._shakeMag = Math.min(6, 1.5 + dmg * 0.4);
    }
    this.prevShield = p.ship.shield;
    this.prevHull = p.ship.hull;
    const hullPct = p.ship.hull / p.ship.hullMax;
    if (hullPct > 0 && hullPct < 0.30 && nowS >= this.nextHullAlarmAt) {
      // Faster, more urgent alarm as hull drops; 10% → 0.6s, 30% → 1.6s
      const period = 0.6 + Math.max(0, (hullPct - 0.10)) * 5.0;
      this.nextHullAlarmAt = nowS + period;
      this.sfx("alarm");
    }
    const fuelPct = p.ship.fuel / p.ship.fuelMax;
    if (fuelPct > 0 && fuelPct < 0.15 && nowS >= this.nextFuelAlarmAt) {
      this.nextFuelAlarmAt = nowS + 2.2;
      this.sfx("alarm");
    }

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
    // Squared-distance comparator — no sqrt needed and we already skip bullets/self.
    const cand = this.entities
      .filter((e) => e.kind !== "bullet" && e.id !== this.targetId);
    let bestI = -1, bestD2 = Infinity;
    for (let i = 0; i < cand.length; i++) {
      const dx = cand[i].pos.x - p.pos.x;
      const dy = cand[i].pos.y - p.pos.y;
      const dz = cand[i].pos.z - p.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
    this.targetId = bestI >= 0 ? cand[bestI].id : null;
  }

  // Category-cycle order for [ / ]. Each press steps to the next category and
  // locks the nearest entity matching it. Skips categories with no candidates.
  private _targetCategories: { label: string; match: (e: Entity) => boolean }[] = [
    { label: "STATION",  match: (e) => e.kind === "station" && e.faction !== "pirate" },
    { label: "ASTEROID", match: (e) => e.kind === "asteroid" },
    { label: "HOSTILE",  match: (e) => e.kind === "hostile" || (e.kind === "station" && e.faction === "pirate") },
    { label: "FRIENDLY", match: (e) => e.kind === "friendly" },
    { label: "NEUTRAL",  match: (e) => e.kind === "neutral" },
    { label: "BEACON",   match: (e) => e.kind === "beacon" },
    { label: "PLANET",   match: (e) => e.kind === "planet" },
    { label: "DERELICT", match: (e) => e.kind === "derelict" },
  ];
  private _targetCatIdx = -1;

  cycleTargetCategory(step: 1 | -1) {
    const p = this.player; if (!p) return;
    const n = this._targetCategories.length;
    // Try each category once; skip ones with no candidates in range.
    for (let attempt = 0; attempt < n; attempt++) {
      this._targetCatIdx = ((this._targetCatIdx + step) % n + n) % n;
      const cat = this._targetCategories[this._targetCatIdx];
      let bestId = -1, bestD2 = Infinity;
      for (const e of this.entities) {
        if (!cat.match(e)) continue;
        const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestId = e.id; }
      }
      if (bestId >= 0) {
        this.targetId = bestId;
        this.pushLog(`Target: ${cat.label} — ${this.entities.find(e => e.id === bestId)?.name ?? "?"}`);
        return;
      }
    }
    this.pushLog("No targets in any category.");
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

  // Currently-docked station id, or null while flying. Drives the station
  // menu's price tables (each station has its own market).
  dockedStationId: number | null = null;

  tryDock() {
    const p = this.player; if (!p) return;
    const t = this.entities.find((e) => e.id === this.targetId);
    if (!t || t.kind !== "station") { this.pushLog("Target a station with T."); return; }
    if (t.faction === "pirate") { this.pushLog(`${t.name} is a pirate stronghold — no docking permitted.`); return; }
    const d = V.len(V.sub(t.pos, p.pos));
    if (d > 200) { this.pushLog("Too far to dock."); return; }
    if (p.throttle > 0.05) { this.pushLog("Reduce throttle to dock."); return; }
    this.screen = "station";
    this.menuCursor = 0;
    this.stationPage = "main";
    this.dockedStationId = t.id;
    // Refuel & repair on dock (free)
    p.ship.fuel = p.ship.fuelMax;
    p.ship.hull = p.ship.hullMax;
    this.pushLog(`Docked at ${t.name}. Refueled and repaired.`);
    this.pushChatter(`Dock ${t.name}`, this.getStock(t.id).rumor, "#c2c2ff");
    this.sfx("dock");
    if (p.gunner) {
      this.pushChatter(`Gunner ${p.gunner.name.split(" ")[0]}`,
        pickLine("gunner_docked", this.chatterCtx(t)), "#fc6");
    }

    // Hand in mission
    if (p.mission && p.mission.done) {
      p.credits += p.mission.reward;
      awardXP(p, 80);
      this.pushLog(`Mission paid: +${p.mission.reward}cr`);
      p.mission = this.generateMission();
    }
  }

  // --- Missions ------------------------------------------------------------
  // Seven kinds, chosen weighted-random each hand-in. Each kind pulls a live
  // entity as its objective where possible so the tracker + world marker have
  // something real to point at.
  generateMission(): Mission {
    const rng = this.rng;
    const roll = rng();
    const kinds: MissionKind[] =
      roll < 0.20 ? ["deliver"] :
      roll < 0.35 ? ["haul"] :
      roll < 0.50 ? ["destroy"] :
      roll < 0.63 ? ["bounty"] :
      roll < 0.76 ? ["scan"] :
      roll < 0.88 ? ["escort"] :
      ["rescue"];
    const k = kinds[0];
    const id = nextId();
    if (k === "destroy") {
      const target = this.entities.find((e) => e.kind === "hostile" && (e.hull ?? 0) > 0);
      return {
        id, kind: k, targetId: target?.id,
        description: `Destroy hostile ${target?.name ?? "raider"}`,
        reward: 250, done: false,
      };
    }
    if (k === "bounty") {
      // A named high-value pirate — pick one and mark it. Bigger reward.
      const target = this.entities.find((e) => e.kind === "hostile" && (e.hull ?? 0) > 0);
      return {
        id, kind: k, targetId: target?.id,
        description: `Bounty: eliminate ${target?.name ?? "raider"} (bounty board)`,
        reward: 600, done: false,
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
    if (k === "escort") {
      const target = this.entities.find((e) => e.kind === "friendly");
      return {
        id, kind: k, targetId: target?.id,
        description: `Escort ${target?.name ?? "convoy"} — stay within 500u for 60s`,
        reward: 300, done: false,
      };
    }
    if (k === "rescue") {
      const target = this.entities.find((e) => e.kind === "beacon");
      return {
        id, kind: k, targetId: target?.id,
        description: `Rescue signal near ${target?.name ?? "beacon"} — visit within 50u`,
        reward: 220, done: false,
      };
    }
    if (k === "haul") {
      return {
        id, kind: "haul", cargoItem: "ore", cargoQty: 15,
        description: "Haul 15 ore to any civilian station",
        reward: 520, done: false,
      };
    }
    return {
      id, kind: "deliver", cargoItem: "ore", cargoQty: 5,
      description: "Deliver 5 ore to any station",
      reward: 200, done: false,
    };
  }

  // Timers for escort progress (per-mission).
  private _escortStayAt = 0;

  tickMissions() {
    const p = this.player; if (!p || !p.mission) return;
    const m = p.mission;
    if (m.done) return;
    if (m.kind === "scan" && m.targetId) {
      const t = this.entities.find((e) => e.id === m.targetId);
      if (t && V.len(V.sub(t.pos, p.pos)) < 200) { m.done = true; this.pushLog("Anomaly scanned."); }
    }
    if (m.kind === "deliver" || m.kind === "haul") {
      if ((p.cargo[m.cargoItem!] ?? 0) >= (m.cargoQty ?? 0)) m.done = true;
    }
    if (m.kind === "escort" && m.targetId) {
      const t = this.entities.find((e) => e.id === m.targetId);
      const now = performance.now() / 1000;
      if (t && (t.hull ?? 1) > 0 && V.len(V.sub(t.pos, p.pos)) < 500) {
        if (this._escortStayAt === 0) this._escortStayAt = now;
        else if (now - this._escortStayAt >= 60) { m.done = true; this.pushLog("Escort complete."); }
      } else {
        this._escortStayAt = 0;
      }
    }
    if (m.kind === "rescue" && m.targetId) {
      const t = this.entities.find((e) => e.id === m.targetId);
      if (t && V.len(V.sub(t.pos, p.pos)) < 50) { m.done = true; this.pushLog("Rescue signal acknowledged."); }
    }
    // "bounty" / "destroy" completion is set by the bullet-hit loop.
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
        this.pushChatter(tag, pickLine("gunner_hostile", this.chatterCtx(undefined, { target: best })), "#ff8a8a");
      }
    } else if (best.kind === "asteroid") {
      if (bestDist > 200) return;
      if (g.cooldown > 0) return;
      if (cargoTotal(p) >= p.ship.cargoMax) {
        if (g.nextBarkAt <= 0) {
          g.nextBarkAt = 10 + Math.random() * 6;
          this.pushChatter(tag, pickLine("gunner_cargofull", this.chatterCtx()), "#ffd066");
        }
        return;
      }
      if ((best.ore ?? 0) <= 0) return;
      g.cooldown = 0.35;
      best.ore!--;
      p.cargo.ore = (p.cargo.ore ?? 0) + 1;
      awardXP(p, 1);
      if (g.nextBarkAt <= 0) {
        g.nextBarkAt = 4 + Math.random() * 3;
        this.pushChatter(tag, pickLine("gunner_mine", this.chatterCtx(undefined, { target: best })), "#ffd066");
      }
    } else if (best.kind === "station") {
      if (bestDist > 400) return;
      if (g.nextBarkAt > 0) return;
      g.nextBarkAt = 12 + Math.random() * 8;
      this.pushChatter(tag, pickLine("gunner_dock", this.chatterCtx(undefined, { target: best })), "#9fe");
    }
  }

  // --- Pilot autopilot ----------------------------------------------------
  // Full-auto approach to `this.targetId`. Points the nose at the target,
  // scales throttle by distance so we decelerate on approach, and auto-docks
  // stations / holds orbit at planets. Disengages on any manual stick input.
  private _lastAutopilotTag = 0;
  driveAutopilot(dt: number, p: PlayerState) {
    const pilot = getCrew(p, "pilot");
    if (!pilot || !pilot.autopilot) return;
    const t = this.targetId != null ? this.entities.find((e) => e.id === this.targetId) : null;
    if (!t) {
      pilot.autopilot = false;
      this.pushLog("Autopilot: no target — disengaged.");
      return;
    }
    const rel = V.sub(t.pos, p.pos);
    const dist = V.len(rel);
    // Turn toward target: convert rel to yaw/pitch and slew toward it.
    const targetYaw = Math.atan2(rel.x, rel.z);
    const targetPitch = Math.atan2(rel.y, Math.hypot(rel.x, rel.z));
    // Shortest-arc yaw diff
    let dy = targetYaw - p.heading.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const dp = targetPitch - p.heading.pitch;
    const slew = 2.0 * dt;
    p.heading.yaw += Math.max(-slew, Math.min(slew, dy));
    p.heading.pitch += Math.max(-slew, Math.min(slew, dp));
    p.heading.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p.heading.pitch));
    // Approach-throttle: full when far, ease down on final approach so we
    // don't cannonball into the dock.
    let dockR = 180;
    if (t.kind === "planet") dockR = 60;   // orbit hold radius
    if (t.kind === "star") dockR = 120;    // corona scoop distance
    if (t.kind === "asteroid") dockR = 120;
    if (dist > dockR * 2) p.throttle = Math.min(1, p.throttle + dt * 0.9);
    else if (dist > dockR) p.throttle = 0.35;
    else p.throttle = Math.max(0, p.throttle - dt * 1.6);
    // If close to a friendly station and stopped, auto-dock.
    const now = performance.now() / 1000;
    if (t.kind === "station" && t.faction !== "pirate" && dist < 200 && p.throttle < 0.05) {
      if (now - this._lastAutopilotTag > 3) {
        this._lastAutopilotTag = now;
        this.pushChatter(`Pilot ${pilot.name.split(" ")[0]}`,
          pickLine("pilot_docking", this.chatterCtx(t, { target: t })), CREW_ROLE_INFO.pilot.color);
      }
      pilot.autopilot = false;
      this.tryDock();
    }
  }

  private _disengageAutopilot(_why: "stick") {
    const p = this.player; if (!p) return;
    const pilot = getCrew(p, "pilot");
    if (pilot && pilot.autopilot) {
      pilot.autopilot = false;
      this.pushChatter(`Pilot ${pilot.name.split(" ")[0]}`,
        pickLine("pilot_autopilot_off", this.chatterCtx()), CREW_ROLE_INFO.pilot.color);
    }
  }

  // Faction retaliation: when the player damages a ship, nearby ships of the
  // same faction (within 2500u) flip hostile for 90 seconds. Their AI branches
  // still see them as their original kind; hostileUntil is checked in tickAI
  // and the bullet-hit loop.
  applyFactionRetaliation(victim: Entity) {
    const p = this.player; if (!p) return;
    const now = performance.now() / 1000;
    const RANGE = 2500;
    const RANGE2 = RANGE * RANGE;
    for (const e of this.entities) {
      if (e.id === victim.id) continue;
      if (e.faction !== victim.faction) continue;
      if (e.kind !== "friendly" && e.kind !== "neutral" && e.kind !== "hostile") continue;
      const dx = e.pos.x - victim.pos.x, dy = e.pos.y - victim.pos.y, dz = e.pos.z - victim.pos.z;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      // Already hostile stays hostile. Preserve original kind for revert.
      if (!e.peaceKind && e.kind !== "hostile") e.peaceKind = e.kind;
      e.hostileUntil = Math.max(e.hostileUntil ?? 0, now + 90);
    }
  }

  // Tick down retaliation timers and revert ships that timed out.
  tickRetaliation() {
    const now = performance.now() / 1000;
    for (const e of this.entities) {
      if (e.hostileUntil && now > e.hostileUntil) {
        e.hostileUntil = undefined;
        if (e.peaceKind && e.peaceKind !== e.kind) {
          e.kind = e.peaceKind;
        }
        e.peaceKind = undefined;
      }
    }
  }

  // Crew banter timer + tick (uses "banter" template kind).
  private _nextBanterAt = 0;
  tickCrewBanter(dt: number) {
    const p = this.player; if (!p) return;
    const freq = this.options.chatterFreq ?? "normal";
    if (freq === "off") return;
    const mul = freq === "rare" ? 3.0 : freq === "lively" ? 0.5 : 1.0;
    this._nextBanterAt -= dt;
    if (this._nextBanterAt > 0) return;
    this._nextBanterAt = (35 + Math.random() * 30) * mul;
    // Collect crew names (gunner + crew[])
    const names: { name: string; color: string }[] = [];
    if (p.gunner) names.push({ name: p.gunner.name.split(" ")[0], color: "#fc6" });
    if (p.crew) for (const c of p.crew) names.push({ name: c.name.split(" ")[0], color: CREW_ROLE_INFO[c.role].color });
    if (names.length < 2) return;
    // Pick two distinct crew.
    const a = names[Math.floor(Math.random() * names.length)];
    let b = a; let guard = 5;
    while (b === a && guard-- > 0) b = names[Math.floor(Math.random() * names.length)];
    if (b === a) return;
    const line = pickLine("banter", this.chatterCtx(undefined, { a: a.name, b: b.name }));
    // Split at "||" marker if present so the two lines land as two chatter entries.
    const parts = line.split("||").map((s) => s.trim());
    if (parts.length >= 2) {
      this.pushChatter(a.name, parts[0].replace(new RegExp(`^${a.name}:\\s*`), ""), a.color);
      this.pushChatter(b.name, parts[1].replace(new RegExp(`^${b.name}:\\s*`), ""), b.color);
    } else {
      this.pushChatter(a.name, line, a.color);
    }
  }

  // Occasional per-crew idle bark (pilot/engineer/merchant). Gated by chatterFreq.
  private _nextCrewIdleAt = 0;
  tickCrewIdle(dt: number) {
    const p = this.player; if (!p) return;
    const freq = this.options.chatterFreq ?? "normal";
    if (freq === "off") return;
    const mul = freq === "rare" ? 3.0 : freq === "lively" ? 0.4 : 1.0;
    this._nextCrewIdleAt -= dt;
    if (this._nextCrewIdleAt > 0) return;
    this._nextCrewIdleAt = (18 + Math.random() * 20) * mul;
    const roles: CrewRole[] = [];
    if (p.crew) for (const c of p.crew) roles.push(c.role);
    if (roles.length === 0) return;
    const r = roles[Math.floor(Math.random() * roles.length)];
    const c = getCrew(p, r);
    if (!c) return;
    const kind: ChatterKind = (r + "_idle") as ChatterKind;
    this.pushChatter(`${CREW_ROLE_INFO[r].title} ${c.name.split(" ")[0]}`,
      pickLine(kind, this.chatterCtx()), CREW_ROLE_INFO[r].color);
  }

  // Quest log screen — full-screen popup showing active mission + description
  // + progress + faction reputation. ESC or U closes it.
  updateQuestLog() {
    const kb = this.options.keybinds;
    if (this.input.consume(kb.questLog)) {
      this.screen = this._codexReturn;
      this.menuCursor = 0;
    }
  }

  renderQuestLog(g: Cell[][]) {
    const cols = g[0].length;
    putText(g, 4, 1, "[ QUEST LOG ]   U or ESC close", "#7CFC00");
    const p = this.player;
    if (!p) return;
    const m = p.mission;
    if (!m) {
      putText(g, 4, 4, "No active missions. Dock at a station to pick up work.", "#9fe");
      void cols;
      return;
    }
    putText(g, 4, 4, `Kind:   ${m.kind.toUpperCase()}`, "#fff");
    putText(g, 4, 5, `Task:   ${m.description}`, "#cf6");
    putText(g, 4, 6, `Reward: ${m.reward}cr`, "#ffe066");
    let prog = "in progress";
    if (m.done) prog = "READY — dock at any station";
    else if ((m.kind === "deliver" || m.kind === "haul") && m.cargoItem) {
      const have = p.cargo[m.cargoItem] ?? 0;
      prog = `${have}/${m.cargoQty} ${m.cargoItem} in hold`;
    } else if (m.kind === "escort" && m.targetId != null) {
      const t = this.entities.find((e) => e.id === m.targetId);
      if (t) {
        const d = V.len(V.sub(t.pos, p.pos));
        const held = this._escortStayAt ? Math.floor(performance.now() / 1000 - this._escortStayAt) : 0;
        prog = d < 500 ? `${held}/60 s in range of ${t.name}` : `out of range (d=${d.toFixed(0)}u)`;
      }
    } else if (m.targetId != null) {
      const t = this.entities.find((e) => e.id === m.targetId);
      if (t) {
        const d = V.len(V.sub(t.pos, p.pos));
        prog = `${t.name} at ${d.toFixed(0)}u`;
      }
    }
    putText(g, 4, 7, `Status: ${prog}`, m.done ? "#7CFC00" : "#9fe");

    // Reputation summary.
    const rep = p.reputation ?? {};
    putText(g, 4, 10, "Reputation:", "#7CFC00");
    putText(g, 6, 11, `Federation:  ${repLabel(rep.federation ?? 0).padEnd(10)} (${rep.federation ?? 0})`, "#aef");
    putText(g, 6, 12, `Guild:       ${repLabel(rep.guild ?? 0).padEnd(10)} (${rep.guild ?? 0})`, "#aef");
    putText(g, 6, 13, `Pirate:      ${repLabel(rep.pirate ?? 0).padEnd(10)} (${rep.pirate ?? 0})`, "#aef");

    // Crew roster summary.
    putText(g, 4, 15, "Crew:", "#7CFC00");
    let cy = 16;
    if (p.gunner) putText(g, 6, cy++, `Gunner    · ${p.gunner.name}  (${p.gunner.species}, ${p.gunner.gender})  [${p.gunner.enabled ? "AUTO" : "STANDBY"}]`, "#fc6");
    if (p.crew) for (const c of p.crew) {
      const info = CREW_ROLE_INFO[c.role];
      const stateTag = c.role === "pilot" ? (c.autopilot ? "AUTOPILOT" : "READY") : "ACTIVE";
      putText(g, 6, cy++, `${info.title.padEnd(9)} · ${c.name}  (${c.species}, ${c.gender})  [${stateTag}]`, info.color);
    }
    if (crewCount(p) === 0) putText(g, 6, cy, "(no hires yet — recruit at stations)", "#888");

    putText(g, 4, g.length - 2, "U or ESC to close", "#888");
  }

  // Sweep loot canisters near the player and absorb their contents.
  // Pickup radius widens if a "loot-magnet" module is installed.
  pickupLoot() {
    const p = this.player; if (!p) return;
    const magnet = p.ship.modules.includes("loot-magnet") ? 60 : 20;
    const magnet2 = magnet * magnet;
    const now = performance.now() / 1000;
    // In-place sweep — avoids allocating a new entities array each call.
    const src = this.entities;
    let w = 0;
    for (let r = 0; r < src.length; r++) {
      const e = src[r];
      let keep = true;
      if (e.kind === "loot") {
        if (e.ttlAt && e.ttlAt < now) {
          keep = false;
        } else {
          const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
          if (dx * dx + dy * dy + dz * dz <= magnet2) {
            const cr = e.loot?.credits ?? 0;
            const ore = e.loot?.ore ?? 0;
            if (cr) p.credits += cr;
            if (ore && cargoTotal(p) < p.ship.cargoMax) {
              const take = Math.min(ore, p.ship.cargoMax - cargoTotal(p));
              p.cargo.ore = (p.cargo.ore ?? 0) + take;
            }
            this.pushLog(`Salvaged canister: +${cr}cr +${ore} ore`);
            this.beep(540, 0.05, "sine");
            keep = false;
          }
        }
      }
      if (keep) { src[w++] = e; }
    }
    src.length = w;
  }



  // Periodically reseed ship population so the world doesn't depopulate.
  // Civilian stations launch friendlies/neutrals; pirate bases launch raiders;
  // planets occasionally emit a trader. All capped to keep entity count sane.
  tickRespawns(dt: number) {
    // Single linear pass: count ships and bucket potential spawn parents
    // by category so we don't run three more .filter()s below.
    let ships = 0;
    const civStations: Entity[] = [];
    const pirateBases: Entity[] = [];
    const planets: Entity[] = [];
    for (const e of this.entities) {
      if (e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral") {
        ships++;
      } else if (e.kind === "station") {
        if ((e.hull ?? 0) > 0) {
          if (e.faction === "pirate") pirateBases.push(e);
          else civStations.push(e);
        }
      } else if (e.kind === "planet") {
        planets.push(e);
      }
    }
    const SHIP_CAP = 80;
    this._nextCivSpawnAt -= dt;
    this._nextPirateSpawnAt -= dt;
    this._nextPlanetSpawnAt -= dt;

    const spawnNear = (origin: Vec3, kind: EntityKind, faction: string, name: string, hull: number) => {
      // INTENTIONALLY UNSEEDED: spawnNear runs during live gameplay (NPC
      // respawn ticks), not during universe generation. The seeded mulberry32
      // RNG (`rng`) is reserved for procedural placement that must reproduce
      // from a seed — stations, planets, starting layout. Using it here would
      // make every respawn identical across saves and reveal RNG state to the
      // player. Math.random() is the correct choice for runtime variance.
      const jitter = (): number => (Math.random() - 0.5) * 80;
      this.entities.push({
        id: nextId(), kind, name,
        pos: { x: origin.x + jitter(), y: origin.y + jitter(), z: origin.z + jitter() },
        vel: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
        faction, hull, shield: 30, state: "wander", cooldown: 0, weaponId: "pulse",
      });
    };

    if (this._nextCivSpawnAt <= 0) {
      this._nextCivSpawnAt = 30 + Math.random() * 25;
      if (ships < SHIP_CAP && civStations.length) {
        const src = civStations[Math.floor(Math.random() * civStations.length)];
        const kind: EntityKind = Math.random() < 0.55 ? "friendly" : "neutral";
        const fac = kind === "friendly" ? "federation" : "guild";
        spawnNear(src.pos, kind, fac, nameFrom(this.rng, kind === "friendly" ? "Patrol" : "Hauler"), 40);
      }
    }
    if (this._nextPirateSpawnAt <= 0) {
      this._nextPirateSpawnAt = 22 + Math.random() * 20;
      if (ships < SHIP_CAP && pirateBases.length) {
        const src = pirateBases[Math.floor(Math.random() * pirateBases.length)];
        spawnNear(src.pos, "hostile", "pirate", nameFrom(this.rng, "Raider"), 50);
      }
    }
    if (this._nextPlanetSpawnAt <= 0) {
      this._nextPlanetSpawnAt = 70 + Math.random() * 40;
      if (ships < SHIP_CAP && planets.length) {
        const src = planets[Math.floor(Math.random() * planets.length)];
        const kind: EntityKind = Math.random() < 0.7 ? "neutral" : "friendly";
        const fac = kind === "friendly" ? "federation" : "guild";
        spawnNear(src.pos, kind, fac, nameFrom(this.rng, kind === "friendly" ? "Courier" : "Trader"), 40);
      }
    }
  }



  // Periodically inject a flavor chatter line from nearby NPCs / stations /
  // planets. Cheap timer-gated work, mostly atmospheric.
  tickAmbientChatter(dt: number) {
    const p = this.player; if (!p) return;
    const freq = this.options.chatterFreq ?? "normal";
    if (freq === "off") return;
    const mul = freq === "rare" ? 3.0 : freq === "lively" ? 0.4 : 1.0;
    this._nextAmbientChatterAt -= dt;
    if (this._nextAmbientChatterAt > 0) return;
    this._nextAmbientChatterAt = (8 + Math.random() * 10) * mul;
    // Find a candidate within 1500u, prefer interesting kinds.
    const near = this.entities
      .filter((e) => e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral" || e.kind === "station" || e.kind === "planet")
      .map((e) => ({ e, d: V.len(V.sub(e.pos, p.pos)) }))
      .filter((x) => x.d < 1500)
      .sort((a, b) => a.d - b.d);
    if (near.length === 0) return;
    const pick = near[Math.floor(Math.random() * Math.min(4, near.length))].e;
    const ctx = this.chatterCtx(pick);
    switch (pick.kind) {
      case "hostile":
        this.pushChatter(pick.name, pickLine("hostile", ctx), "#ff8a8a");
        break;
      case "friendly":
        this.pushChatter(pick.name, pickLine("friendly", ctx), "#aef58a");
        break;
      case "neutral":
        this.pushChatter(pick.name, pickLine("neutral", ctx), "#dddddd");
        break;
      case "station":
        this.pushChatter(`Beacon ${pick.name}`, pickLine("station", ctx), "#c2c2ff");
        break;
      case "planet":
        this.pushChatter(pick.name, pickLine("planet", ctx), "#7ec8ff");
        break;
    }
    // If the gunner is around and bored, occasionally chime in.
    if (p.gunner && Math.random() < 0.35) {
      const tag = `Gunner ${p.gunner.name.split(" ")[0]}`;
      this.pushChatter(tag, pickLine("gunner_idle", this.chatterCtx()), "#fc6");
    }
  }


  // --- Main menu -----------------------------------------------------------
  menuItems = ["Resume", "Save Game", "Load Game", "Legend (Codex)", "Options", "Quit"];
  updateMenu() {
    this.menuNav(this.menuItems.length);
    if (this.input.consume("enter")) {
      const c = this.menuItems[this.menuCursor];
      if (c === "Resume") this.screen = "playing";
      else if (c === "Save Game") { this.screen = "save"; this.menuCursor = 0; }
      else if (c === "Load Game") { this.screen = "load"; this.menuCursor = 0; }
      else if (c === "Legend (Codex)") { this._codexReturn = "menu"; this.screen = "codex"; this.menuCursor = 0; }
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
    this.returnToTitle(this.player ? "Quit from pause menu." : "Quit from title menu.");
  }

  updateQuitConfirm() {
    const items = ["Cancel", "Quit Anyway"];
    this.menuNav(items.length);
    if (this.input.consume("enter")) {
      if (items[this.menuCursor] === "Quit Anyway") this.returnToTitle("Quit without saving from confirmation menu.");
      else this.screen = "menu";
    }
  }

  // --- Options -------------------------------------------------------------
  updateOptions() {
    const radioPreset = RADIO_PRESETS.find((r) => r.id === this.options.radioMode) ?? RADIO_PRESETS[0];
    const radioUrlLabel = this.options.radioMode === "custom"
      ? (this.options.radioCustomUrl ? this.options.radioCustomUrl.slice(0, 40) : "(press ENTER to set)")
      : "—";
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
      `Permadeath: ${this.options.permadeath ? "ON" : "OFF"}`,
      `Crew Chatter: ${this.options.chatterFreq ?? "normal"}`,
      `Radio: ${radioPreset.label}`,
      `Radio URL: ${radioUrlLabel}`,
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
    if (i === 7 && (left || right)) { this.options.volumeMaster = clamp01(this.options.volumeMaster + (right ? 0.05 : -0.05)); this.syncRadio(); }
    if (i === 8 && (left || right)) this.options.volumeSfx = clamp01(this.options.volumeSfx + (right ? 0.05 : -0.05));
    if (i === 9 && (left || right)) { this.options.volumeMusic = clamp01(this.options.volumeMusic + (right ? 0.05 : -0.05)); this.syncRadio(); }
    if (i === 10) this.options.unsavedWarnMinutes = Math.max(1, this.options.unsavedWarnMinutes + (right ? 1 : left ? -1 : 0));
    if (i === 11 && (left || right)) this.options.permadeath = !this.options.permadeath;
    if (i === 12 && (left || right)) {
      const modes: Options["chatterFreq"][] = ["off", "rare", "normal", "lively"];
      const idx = modes.indexOf(this.options.chatterFreq ?? "normal");
      const n = modes.length;
      this.options.chatterFreq = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 13 && (left || right)) {
      const idx = Math.max(0, RADIO_PRESETS.findIndex((r) => r.id === this.options.radioMode));
      const n = RADIO_PRESETS.length;
      this.options.radioMode = RADIO_PRESETS[(idx + (right ? 1 : -1) + n) % n].id;
      this.syncRadio();
    }
    if (this.input.consume("enter")) {
      if (i === 14) {
        // Prompt for a custom stream URL. window.prompt is fine here — this
        // is a game options screen, not a hot path.
        const cur = this.options.radioCustomUrl ?? "";
        const next = typeof window !== "undefined" && typeof window.prompt === "function"
          ? window.prompt("Radio stream URL (mp3 / ogg / m3u):", cur)
          : cur;
        if (next != null) {
          this.options.radioCustomUrl = next.trim();
          if (this.options.radioCustomUrl && this.options.radioMode !== "custom") {
            this.options.radioMode = "custom";
          }
          this.syncRadio();
        }
      } else if (items[i].startsWith("Reset")) {
        this.options.keybinds = { ...DEFAULT_KEYBINDS };
      } else if (items[i] === "Back") {
        this.screen = this.player ? "menu" : "title";
      }
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
      const res = saveGame(c, blob);
      if (!res.ok) {
        this.pushLog(res.reason === "quota" ? `Save to ${c} failed — storage full.` : `Save to ${c} failed.`);
      } else {
        this.player.lastSaveAt = Date.now();
        this.pushLog(`Saved to ${c}.`);
        this.screen = "menu";
      }
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
      this.syncRadio();
    }
  }

  // --- Station menu (paged) ------------------------------------------------
  // Pages: main → market | weapons | modules | crew. Cursor resets between
  // pages. Prices come from the cached StationStock for this station.
  stationItems = ["Market", "Weapon Bay", "Module Shop", "Crew", "Undock"];

  // Build the visible item list for the current station page so the
  // renderer and update loop stay in lockstep (cursor indexes line up).
  buildStationLines(): string[] {
    const p = this.player!;
    const sid = this.dockedStationId;
    if (sid == null) return ["Undock"];
    const stock = this.getStock(sid);
    if (this.stationPage === "main") return this.stationItems;
    if (this.stationPage === "market") {
      const ore = p.cargo.ore ?? 0;
      const fuelNeed = Math.ceil(p.ship.fuelMax - p.ship.fuel);
      const fuelCost = fuelNeed * stock.fuelPrice;
      return [
        `Sell all ore (${ore} × ${stock.orePrice}cr = ${ore * stock.orePrice}cr)`,
        `Buy fuel (${fuelNeed}u × ${stock.fuelPrice}cr = ${fuelCost}cr)`,
        "Back",
      ];
    }
    if (this.stationPage === "weapons") {
      return [
        ...stock.weapons.map((w) => {
          const def = WEAPONS.find((x) => x.id === w.id)!;
          const owned = p.ship.weaponId === w.id ? " (equipped)" : "";
          return `${def.name} — ${w.price}cr${owned}`;
        }),
        "Back",
      ];
    }
    if (this.stationPage === "modules") {
      return [
        ...stock.modules.map((m) => {
          const owned = p.ship.modules.includes(m.id) ? " (installed)" : "";
          return `${m.name} — ${m.price}cr — ${m.desc}${owned}`;
        }),
        "Back",
      ];
    }
    if (this.stationPage === "crew") {
      const cap = effectiveCrewMax(p);
      const cur = crewCount(p);
      const header = `Berths ${cur}/${cap}  (Crew Quarters module gives +1)`;
      const rows: string[] = [`~ ${header} ~`];
      const roles: CrewRole[] = ["gunner", "pilot", "engineer", "merchant"];
      for (const r of roles) {
        const info = CREW_ROLE_INFO[r];
        const fee = r === "gunner" ? stock.gunnerFee : Math.round(info.baseFee * merchantBuyMult(p));
        if (hasCrew(p, r)) {
          const c = r === "gunner"
            ? p.gunner!
            : getCrew(p, r)!;
          rows.push(`Dismiss ${info.title} ${c.name}`);
        } else {
          const gate = cur >= cap ? "  (berths full)" : "";
          rows.push(`Hire ${info.title} — ${fee}cr — ${info.blurb}${gate}`);
        }
      }
      rows.push("Back");
      return rows;
    }
    return ["Back"];
  }

  updateStation() {
    const p = this.player; if (!p) { this.returnToTitle("Station screen lost player state; returned to title.", false); return; }
    if (this.dockedStationId == null) { this.screen = "playing"; return; }
    const lines = this.buildStationLines();
    this.menuNav(lines.length);
    if (!this.input.consume("enter")) return;
    const i = this.menuCursor;
    const sid = this.dockedStationId;
    const stock = this.getStock(sid);

    if (this.stationPage === "main") {
      const c = this.stationItems[i];
      if (c === "Market")       { this.stationPage = "market";  this.menuCursor = 0; }
      else if (c === "Weapon Bay")  { this.stationPage = "weapons"; this.menuCursor = 0; }
      else if (c === "Module Shop") { this.stationPage = "modules"; this.menuCursor = 0; }
      else if (c === "Crew")    { this.stationPage = "crew";    this.menuCursor = 0; }
      else if (c === "Undock")  { this.screen = "playing"; this.dockedStationId = null; }
      return;
    }

    if (lines[i] === "Back") { this.stationPage = "main"; this.menuCursor = 0; return; }

    if (this.stationPage === "market") {
      if (i === 0) {
        const ore = p.cargo.ore ?? 0;
        if (ore > 0) {
          const price = Math.round(stock.orePrice * merchantSellMult(p));
          const total = ore * price;
          p.credits += total;
          p.cargo.ore = 0;
          this.pushLog(`Sold ${ore} ore for ${total}cr${hasCrew(p, "merchant") ? " (merchant bonus)" : ""}.`);
          if (hasCrew(p, "merchant")) {
            const m = getCrew(p, "merchant")!;
            this.pushChatter(`Merchant ${m.name.split(" ")[0]}`,
              pickLine("merchant_deal", this.chatterCtx()), CREW_ROLE_INFO.merchant.color);
          }
        } else this.pushLog("No ore to sell.");
      } else if (i === 1) {
        const need = p.ship.fuelMax - p.ship.fuel;
        const cost = Math.ceil(need * stock.fuelPrice * merchantBuyMult(p));
        if (cost === 0) { this.pushLog("Tanks already full."); return; }
        if (p.credits >= cost) { p.credits -= cost; p.ship.fuel = p.ship.fuelMax; this.pushLog(`Refueled (${cost}cr).`); }
        else this.pushLog("Not enough credits.");
      }
      return;
    }

    if (this.stationPage === "weapons") {
      const offer = stock.weapons[i];
      if (!offer) return;
      const price = Math.round(offer.price * merchantBuyMult(p));
      if (p.ship.weaponId === offer.id) { this.pushLog("Already equipped."); return; }
      if (p.credits < price) { this.pushLog("Not enough credits."); return; }
      p.credits -= price;
      p.ship.weaponId = offer.id;
      this.pushLog(`Equipped ${WEAPONS.find((w) => w.id === offer.id)!.name}.`);
      return;
    }

    if (this.stationPage === "modules") {
      const offer = stock.modules[i];
      if (!offer) return;
      const price = Math.round(offer.price * merchantBuyMult(p));
      if (p.ship.modules.includes(offer.id)) { this.pushLog("Already installed."); return; }
      if (p.credits < price) { this.pushLog("Not enough credits."); return; }
      p.credits -= price;
      p.ship.modules.push(offer.id);
      if (offer.id === "cargo-expander") p.ship.cargoMax += 12;
      if (offer.id === "shield-booster") { p.ship.shieldMax += 25; p.ship.shield += 25; }
      if (offer.id === "crew-quarters") this.pushLog("Crew quarters installed — +1 berth.");
      this.pushLog(`Installed ${offer.name}.`);
      return;
    }

    if (this.stationPage === "crew") {
      // Row 0 is the header; rows 1..4 are roles; last is Back (handled above).
      const roleIdx = i - 1;
      const roles: CrewRole[] = ["gunner", "pilot", "engineer", "merchant"];
      if (roleIdx < 0 || roleIdx >= roles.length) return;
      const r = roles[roleIdx];
      const info = CREW_ROLE_INFO[r];
      // Dismiss branch
      if (hasCrew(p, r)) {
        const c = r === "gunner" ? p.gunner! : getCrew(p, r)!;
        const tenureMin = (Date.now() - c.hiredAt) / 60000;
        const hullPct = p.ship.hull / p.ship.hullMax;
        const happy = tenureMin > 3 && p.credits > 500 && hullPct > 0.5;
        const kind: ChatterKind = (r + (happy ? "_farewell_good" : "_farewell_bad")) as ChatterKind;
        this.pushChatter(`${info.title} ${c.name.split(" ")[0]}`,
          pickLine(kind, this.chatterCtx()), happy ? info.color : "#f88");
        this.pushLog(`${c.name} signed off.`);
        if (r === "gunner") p.gunner = undefined;
        else p.crew = (p.crew ?? []).filter((x) => x.role !== r);
        return;
      }
      // Hire branch
      if (crewCount(p) >= effectiveCrewMax(p)) { this.pushLog("No spare berths — install Crew Quarters."); return; }
      const fee = r === "gunner" ? stock.gunnerFee : Math.round(info.baseFee * merchantBuyMult(p));
      if (p.credits < fee) { this.pushLog("Not enough credits."); return; }
      p.credits -= fee;
      if (r === "gunner") {
        p.gunner = generateGunner(Math.random);
        this.pushLog(`Hired ${p.gunner.name} (${p.gunner.species}).`);
        this.pushChatter(`Gunner ${p.gunner.name.split(" ")[0]}`,
          pickLine("gunner_greet", this.chatterCtx()), "#fc6");
      } else {
        const c = generateCrewMember(r, Math.random);
        p.crew = p.crew ?? [];
        p.crew.push(c);
        this.pushLog(`Hired ${info.title} ${c.name} (${c.species}).`);
        const greetKind: ChatterKind = (r + "_greet") as ChatterKind;
        this.pushChatter(`${info.title} ${c.name.split(" ")[0]}`,
          pickLine(greetKind, this.chatterCtx()), info.color);
      }
      return;
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
    const grid = this.acquireGrid(cols, rows);

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
      case "codex": this.renderCodex(grid); break;
      case "quest-log": this.renderQuestLog(grid); break;
    }


    // Screen-shake offset: while `_shakeUntil` is in the future, jitter the
    // grid draw pass by a couple of pixels. Suppressed under reduced-motion.
    const shakeNow = performance.now() / 1000;
    let shakeDX = 0, shakeDY = 0;
    if (!this._reducedMotion && this.screen === "playing" && shakeNow < this._shakeUntil) {
      const remain = this._shakeUntil - shakeNow;
      const mag = this._shakeMag * Math.min(1, remain / 0.25);
      shakeDX = (Math.random() * 2 - 1) * mag;
      shakeDY = (Math.random() * 2 - 1) * mag;
    }

    // Paint grid. Cells with `glow` get a CSS-style canvas shadow that bleeds
    // their color outward — used for stars and other "luminous" glyphs.
    const fontStr = `${CELL_H - 2}px ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
    if (this._lastFont !== fontStr) { ctx.font = fontStr; this._lastFont = fontStr; }
    ctx.textBaseline = "top";
    let lastFill: string | null = null;
    let lastShadow = 0;
    for (let y = 0; y < rows; y++) {
      const row = grid[y];
      for (let x = 0; x < cols; x++) {
        const c = row[x];
        if (c.ch === " ") continue;
        if (c.glow) {
          if (lastShadow !== 9) { ctx.shadowBlur = 9; lastShadow = 9; }
          ctx.shadowColor = c.color;
        } else if (lastShadow !== 0) {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          lastShadow = 0;
        }
        if (c.color !== lastFill) { ctx.fillStyle = c.color; lastFill = c.color; }
        ctx.fillText(c.ch, x * CELL_W + shakeDX, y * CELL_H + shakeDY);
      }
    }
    if (lastShadow !== 0) { ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; }

    // Shield-loss flash: brief cyan-white tint over the whole canvas the
    // instant shields collapse, decaying smoothly so it reads as a hit and
    // not a UI mode change. Skipped for reduced-motion users.
    if (this.screen === "playing" && !this._reducedMotion) {
      const tNow = performance.now() / 1000;
      const remain = this.shieldFlashUntil - tNow;
      if (remain > 0) {
        const a = Math.min(0.55, remain / 0.45 * 0.55);
        ctx.fillStyle = `rgba(170, 220, 255, ${a.toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      // Red hull-hit tint — any hull damage this tick, decays over ~0.35s.
      const hullRemain = this.hullFlashUntil - tNow;
      if (hullRemain > 0) {
        const a = Math.min(0.4, hullRemain / 0.35 * 0.4);
        ctx.fillStyle = `rgba(255, 60, 60, ${a.toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  // Reusable cell grid — allocate once per resize, reset characters in place.
  // Replaces the per-frame blankGrid() that produced ~rows*cols fresh objects.
  private _lastFont: string | null = null;
  acquireGrid(cols: number, rows: number): Cell[][] {
    if (!this._gridBuf || this._gridCols !== cols || this._gridRows !== rows) {
      const g: Cell[][] = [];
      for (let y = 0; y < rows; y++) {
        const row: Cell[] = new Array(cols);
        for (let x = 0; x < cols; x++) row[x] = { ch: " ", color: "#0f0" };
        g.push(row);
      }
      this._gridBuf = g;
      this._gridCols = cols;
      this._gridRows = rows;
      return g;
    }
    const g = this._gridBuf;
    for (let y = 0; y < rows; y++) {
      const row = g[y];
      for (let x = 0; x < cols; x++) {
        const c = row[x];
        if (c.ch !== " ") c.ch = " ";
        if (c.glow) c.glow = false;
        // color is overwritten by any draw; resetting it is unnecessary.
      }
    }
    return g;
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
    // 6-row block font for letters used in "ASCII FRONTIER".
    const F: Record<string, string[]> = {
      A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
      S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
      C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
      I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
      F: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "██║     ", "╚═╝     "],
      R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
      O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
      N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
      T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
      E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
      " ": ["   ", "   ", "   ", "   ", "   ", "   "],
    };
    const assemble = (word: string) => {
      const rows = ["", "", "", "", "", ""];
      for (const ch of word) {
        const glyph = F[ch] ?? F[" "];
        for (let r = 0; r < 6; r++) rows[r] += glyph[r];
      }
      return rows;
    };
    const top = assemble("ASCII");
    const bot = assemble("FRONTIER");
    const cols = g[0].length;
    const t = performance.now() / 1000;

    // Animated shimmer: hue sweeps across columns; selected color cycles.
    const palette = ["#7CFC00", "#9dff3b", "#b8ff66", "#5fc879", "#39c9a8", "#5fc"];
    const drawBanner = (rows: string[], yTop: number) => {
      const w = rows[0].length;
      const bx = Math.max(2, Math.floor((cols - w) / 2));
      for (let r = 0; r < rows.length; r++) {
        const line = rows[r];
        // Draw char-by-char so each column can shimmer independently.
        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          if (ch === " ") continue;
          const wave = Math.sin((c * 0.18) - t * 2.2 + r * 0.35);
          const idx = Math.floor(((wave + 1) / 2) * palette.length) % palette.length;
          putText(g, bx + c, yTop + r, ch, palette[idx]);
        }
      }
    };

    drawBanner(top, 2);
    drawBanner(bot, 2 + 6 + 1);

    const bannerBottom = 2 + 6 + 1 + 6;
    const tag = "— ASCII SPACE SIMULATION —";
    // Subtle tagline pulse.
    const pulse = 0.6 + 0.4 * Math.sin(t * 2);
    const cTag = pulse > 0.85 ? "#bff" : pulse > 0.5 ? "#5fc" : "#3aa";
    putText(g, Math.floor((cols - tag.length) / 2), bannerBottom + 1, tag, cTag);
    putText(g, Math.floor((cols - ("v" + VERSION).length) / 2), bannerBottom + 2, "v" + VERSION, "#678");

    const menuTop = bannerBottom + 4;
    this.titleItems.forEach((it, i) => {
      const sel = i === this.menuCursor;
      // Selected item gets a blinking marker.
      const blink = sel && Math.floor(t * 3) % 2 === 0 ? "▶ " : sel ? "▸ " : "  ";
      const label = blink + it;
      putText(g, Math.floor((cols - 16) / 2), menuTop + i * 2, label, sel ? "#fff" : "#9fe");
    });
    this.renderTitleNotice(g, Math.min(g.length - 6, menuTop + this.titleItems.length * 2 + 1));
    // Rotating tip line, one every ~5s, below the menu but above the footer.
    const tips = TITLE_TIPS;
    const tipIdx = Math.floor(performance.now() / 5000) % tips.length;
    const tip = "TIP · " + tips[tipIdx];
    const tipY = Math.min(g.length - 3, menuTop + this.titleItems.length * 2 + 5);
    putText(g, Math.max(2, Math.floor((cols - tip.length) / 2)), tipY, tip, "#6aa");
    putText(g, 4, g.length - 2, "↑/↓ select   ENTER confirm", "#888");
  }


  renderTitleNotice(g: Cell[][], preferredY: number) {
    if (!this.titleNotice) return;
    const cols = g[0].length;
    const age = performance.now() / 1000 - this.titleNoticeAt;
    const pulseNotice = Math.floor(age * 2) % 2 === 0;
    const maxW = Math.max(24, Math.min(cols - 8, 92));
    const raw = `LAST EXIT: ${this.titleNotice}`;
    const lines: string[] = [];
    let rest = raw;
    while (rest.length > maxW && lines.length < 2) {
      const cut = Math.max(18, rest.lastIndexOf(" ", maxW));
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest.length > maxW ? rest.slice(0, maxW - 1) + "…" : rest);
    const borderW = Math.min(maxW + 4, cols - 4);
    const boxH = lines.length + 2;
    const y = Math.max(1, Math.min(g.length - boxH - 2, preferredY));
    const x = Math.max(2, Math.floor((cols - borderW) / 2));
    putText(g, x, y, "┌" + "─".repeat(borderW - 2) + "┐", pulseNotice ? "#ffdd66" : "#b86");
    lines.slice(0, 3).forEach((line, i) => {
      putText(g, x, y + 1 + i, "│ " + line.padEnd(borderW - 4) + " │", "#ffdd66");
    });
    putText(g, x, y + 1 + lines.length, "└" + "─".repeat(borderW - 2) + "┘", pulseNotice ? "#ffdd66" : "#b86");
  }

  renderCharCreate(g: Cell[][]) {
    putText(g, 4, 2, "CREATE COMMANDER", "#7CFC00");
    putText(g, 4, 3, "←/→ adjust   ↑/↓ field   ENTER continue", "#888");
    const c = this.charDraft;
    const rows = [
      `name:    Cmdr ${c.name}_`,
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
      `Permadeath: ${this.options.permadeath ? "ON" : "OFF"}`,
      `Crew Chatter: ${this.options.chatterFreq ?? "normal"}`,
      `Radio: ${(RADIO_PRESETS.find((r) => r.id === this.options.radioMode) ?? RADIO_PRESETS[0]).label}`,
      `Radio URL: ${this.options.radioMode === "custom" ? (this.options.radioCustomUrl || "(press ENTER to set)").slice(0, 40) : "—"}`,
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
    const sid = this.dockedStationId;
    const stationName = sid != null ? this.entities.find((e) => e.id === sid)?.name ?? "Station" : "Station";
    const stock = sid != null ? this.getStock(sid) : null;
    putText(g, 4, 2, `DOCKED — ${stationName.toUpperCase()}`, "#7CFC00");
    putText(g, 4, 3, `credits: ${p.credits}   ore: ${p.cargo.ore ?? 0}   cargo: ${cargoTotal(p)}/${p.ship.cargoMax}   fuel: ${p.ship.fuel.toFixed(0)}/${p.ship.fuelMax}`, "#9fe");
    if (p.mission) putText(g, 4, 4, `mission: ${p.mission.description} ${p.mission.done ? "[READY]" : ""}`, "#fb6");
    // Reputation summary so the player can see how the station regards them.
    const rep = p.reputation ?? {};
    putText(g, 4, 5, `rep — Fed:${repLabel(rep.federation ?? 0)} (${rep.federation ?? 0})   Guild:${repLabel(rep.guild ?? 0)} (${rep.guild ?? 0})   Pirate:${repLabel(rep.pirate ?? 0)} (${rep.pirate ?? 0})`, "#aef");
    if (stock) putText(g, 4, 6, `“${stock.rumor}”`, "#fc6");
    putText(g, 4, 7, `[ ${this.stationPage.toUpperCase()} ]   ESC back to menu`, "#7CFC00");
    const lines = this.buildStationLines();
    lines.forEach((it, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 9 + i * 2, (sel ? "▸ " : "  ") + it, sel ? "#fff" : "#9fe");
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

  // --- Codex / Legend ------------------------------------------------------
  // Single overlay that documents every glyph, color, and keybind so players
  // don't have to guess what `%`, a pulsing red bracket, or a magenta `▒` mean.
  // Pages are flipped with ←/→; ESC closes back to whichever screen opened it.
  updateCodex() {
    if (this.input.consume("arrowleft"))  this._codexPage = (this._codexPage + 2) % 3;
    if (this.input.consume("arrowright")) this._codexPage = (this._codexPage + 1) % 3;
    if (this.input.consume("enter")) this._codexPage = (this._codexPage + 1) % 3;
    if (this.input.consume(this.options.keybinds.menu) ||
        this.input.consume(this.options.keybinds.legend)) {
      this.screen = this._codexReturn;
      this.menuCursor = 0;
    }
    // Clickable source-code link at the bottom of the Codex.
    if (this.input.mouseClicked && this._codexLinkRect) {
      const gx = this.input.mouseCX / CELL_W;
      const gy = this.input.mouseCY / CELL_H;
      const r = this._codexLinkRect;
      if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h) {
        window.open(SOURCE_URL, "_blank", "noopener,noreferrer");
      }
    }
  }

  renderCodex(g: Cell[][]) {
    const cols = g[0].length;
    const pages = ["SYMBOLS", "COLORS", "KEYS"];
    const title = `[ CODEX — ${pages[this._codexPage]} ]   ←/→ pages   ESC close`;
    putText(g, 4, 1, title, "#7CFC00");

    if (this._codexPage === 0) {
      // Symbols: pull names from GLYPHS so the legend can never drift.
      const rows: [string, string, string][] = [
        ["@", "#7CFC00", "your ship (radar)"],
        [GLYPHS.player, "#7CFC00", "your ship (cockpit)"],
        [GLYPHS.star, colorFor("star"), "star — fuel scoop in corona at low throttle"],
        [GLYPHS.planet, colorFor("planet"), "planet — landmark; collision damage on touch"],
        [GLYPHS.station, colorFor("station"), "station — dock for repair/refuel/shop (F)"],
        [GLYPHS.station, "#ff7766", "pirate base — fortified, hostile turrets"],
        [GLYPHS.asteroid, colorFor("asteroid"), "asteroid — minable ore (M)"],
        [GLYPHS.friendly, colorFor("friendly"), "friendly ship (Federation)"],
        [GLYPHS.neutral, colorFor("neutral"), "neutral ship (Guild trader)"],
        [GLYPHS.hostile, colorFor("hostile"), "hostile ship (Pirate raider)"],
        [GLYPHS.bullet, colorFor("bullet"), "weapon round in flight"],
        [GLYPHS.loot, colorFor("loot"), "loot canister — fly through to collect"],
        [GLYPHS.comet, colorFor("comet"), "comet — fast, harmless decoration"],
        [GLYPHS.nebula, colorFor("nebula"), "nebula cloud — drains shields, hides ships"],
        [GLYPHS.beacon, colorFor("beacon"), "distress beacon — payout, or a pirate trap"],
        [GLYPHS.ufo, colorFor("ufo"), "UFO — enigmatic wanderer, observes then flees"],
        [GLYPHS.thargoid, colorFor("thargoid"), "unknown contact — EMPs your ship, then departs"],
        [GLYPHS.wormhole, colorFor("wormhole"), "wormhole — fly through to warp to its paired rift"],
        [GLYPHS.dyson, colorFor("dyson"), "Dyson swarm — collector ring around a star"],
        [GLYPHS.derelict, colorFor("derelict"), "derelict wreck — fly within 40u to salvage"],
        ["◉", "#1a0a10", "black hole — bends your course, kills on contact"],
        ["•", "#bfd8ff", "pulsar — tiny neutron star, blinks visibly"],
        ["[ ]", "#ffaa55", "targeting brackets — current target on-screen"],
        ["◣◢◤◥", "#fc6", "edge pointer — target off-screen (distance shown)"],
        ["+", "#ffaa55", "lead indicator — fire here to hit a moving target"],
        ["◇", "#cf6", "mission objective marker"],
        ["-+-", "#3a6", "reticle — green idle, amber aligned, red in-range"],
      ];
      rows.forEach((r, i) => {
        const y = 4 + i;
        if (y >= g.length - 4) return;
        putText(g, 4, y, r[0].padEnd(5), r[1]);
        putText(g, 10, y, r[2], "#cfd");
      });
    } else if (this._codexPage === 1) {
      const swatches: [string, string][] = [
        ["#7CFC00", "friendly / system OK / your ship"],
        ["#ff5555", "hostile / hull critical / in-range lock"],
        ["#fc6",    "warning / out-of-range lock / gunner"],
        ["#c2c2ff", "station / civilian infrastructure"],
        ["#ff7766", "pirate base / forbidden zone"],
        ["#7ec8ff", "planet / friendly comms"],
        ["#a6886a", "asteroid / ore / mineable"],
        ["#ffd866", "star / luminous source"],
        ["#ffe066", "loot / credits / pickup"],
        ["#c47afc", "nebula / sensor wash"],
        ["#ff66cc", "beacon / distress signal"],
        ["#bff7ff", "comet / supercruise FTL"],
        ["#888888", "older comms / disabled menu item"],
        ["#cf6",    "mission tracker / objective"],
      ];
      swatches.forEach((s, i) => {
        const y = 4 + i;
        if (y >= g.length - 4) return;
        putText(g, 4, y, "████", s[0]);
        putText(g, 10, y, s[1], "#cfd");
      });
    } else {
      const kb = this.options.keybinds;
      const rows: [string, string][] = [
        [kb.throttleUp.toUpperCase() + " / " + kb.throttleDown.toUpperCase(), "throttle up / down"],
        [kb.yawLeft.toUpperCase() + " / " + kb.yawRight.toUpperCase(), "yaw left / right"],
        [kb.pitchUp.toUpperCase() + " / " + kb.pitchDown.toUpperCase(), "pitch up / down"],
        ["SHIFT",  "afterburner (4× fuel burn, +60% speed)"],
        [kb.supercruise.toUpperCase(), "supercruise (hold, 3× speed, weapons offline)"],
        ["SPACE",  "fire weapon"],
        [kb.cycleTarget.toUpperCase(), "cycle nearest target (any kind)"],
        [kb.cycleCatPrev + " / " + kb.cycleCatNext, "cycle nearest by category (stations / rocks / hostiles / ...)"],
        [kb.mine.toUpperCase(), "mine targeted asteroid"],
        [kb.dock.toUpperCase() + " / " + kb.station.toUpperCase(), "dock at targeted station"],
        [kb.jettison.toUpperCase(), "jettison heaviest cargo"],
        [kb.toggleGunner.toUpperCase(), "toggle hired gunner AUTO / STANDBY"],
        [kb.legend.toUpperCase(), "open this Codex"],
        [kb.pinQuest.toUpperCase(), "pin / unpin quest tracker"],
        [kb.questLog.toUpperCase(), "open Quest Log popup"],
        [kb.autopilot.toUpperCase(), "toggle Pilot autopilot (mouse steer does NOT disengage)"],
        [kb.pause.toUpperCase(), "pause"],
        ["ESC",    "main menu / close overlay"],
      ];
      rows.forEach((r, i) => {
        const y = 4 + i;
        if (y >= g.length - 4) return;
        putText(g, 4, y, r[0].padEnd(14), "#fff");
        putText(g, 20, y, r[1], "#cfd");
      });
    }

    // Clickable source-code link. The bounding box is stored so updateCodex()
    // can detect clicks and open the repository in a new tab.
    const linkText = `Source code: ${SOURCE_URL.replace(/^https:\/\//, "")}`;
    const linkX = 4;
    const linkY = g.length - 4;
    this._codexLinkRect = { x: linkX, y: linkY, w: linkText.length, h: 1 };
    putText(g, linkX, linkY, linkText, "#7ec8ff");

    // Show a pointer cursor when the mouse is over the link.
    const gx = this.input.mouseCX / CELL_W;
    const gy = this.input.mouseCY / CELL_H;
    const r = this._codexLinkRect;
    this.canvas.style.cursor =
      this.input.mouseInside && gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h
        ? "pointer"
        : "default";

    putText(g, 4, g.length - 2,
      "Tip: brackets tighten when a new target is acquired; the chevron shows where to turn.", "#888");
    void cols;
  }

  renderListMenu(g: Cell[][], title: string, items: string[]) {
    putText(g, 4, 2, title, "#7CFC00");
    items.forEach((it, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 5 + i * 2, (sel ? "▸ " : "  ") + it, sel ? "#fff" : "#9fe");
    });
    if (this.titleNotice) this.renderTitleNotice(g, 5 + items.length * 2 + 2);
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
      ship: 4, bullet: 0.5, comet: 2, nebula: 240, beacon: 3,
      ufo: 5, thargoid: 9, wormhole: 22, dyson: 4, derelict: 6,
    };
    // Sort far→near so close objects overdraw distant ones.
    // Distance falloff: past 5000u, force single-glyph "dot"; past 10000u, cull.
    const FAR_DOT = 5000;
    const FAR_CULL = 10000;
    const projected: { e: Entity; sx: number; sy: number; z: number; r: number; far: boolean }[] = [];
    for (const e of this.entities) {
      const r = V.sub(e.pos, p.pos);
      const dist2 = r.x * r.x + r.y * r.y + r.z * r.z;
      if (dist2 > FAR_CULL * FAR_CULL && e.kind !== "star") continue;
      const x1 = cy * r.x - sy * r.z;
      const z1 = sy * r.x + cy * r.z;
      const y1 = cp * r.y - sp * z1;
      const z2 = sp * r.y + cp * z1;
      if (z2 <= 1) continue; // behind camera
      const sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
      const sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      const far = dist2 > FAR_DOT * FAR_DOT && e.kind !== "star";
      let wr = worldRadius[e.kind] ?? 1;
      if (e.kind === "star") wr *= stellarClassOf(e).sizeMul;
      if (e.kind === "nebula") wr *= 0.8 + hash01(e.id * 251) * 0.9; // varied cloud sizes
      // Far entities collapse to a single colored period regardless of true size.
      const rCells = far ? 0 : (wr / z2) * vw * 0.7;
      projected.push({ e, sx, sy: sy2, z: z2, r: rCells, far });
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
      const { e, sx, sy: sy2, r: rCells, far } = proj;
      const glyph = GLYPHS[e.kind];
      const tint = tintFor(e);

      // Far entities (>5k units): render as a single colored period and skip
      // sprites, trails, halos, and labels. Cheap, low-clutter long-range scope.
      if (far) {
        if (sx > vpLeft && sx < vpRight && sy2 > vpTop && sy2 < vpBottom) {
          if (g[sy2][sx].ch === " ") {
            const glowFar = e.kind === "star" || e.kind === "comet" || e.kind === "bullet";
            g[sy2][sx] = { ch: ".", color: tint.fill, glow: glowFar };
          }
        }
        continue;
      }


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
            g[wp.sy][wp.sx] = { ch: trailCh[i - 1], color: palette[i - 1], glow: i <= 2 };
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
          if (ly < vpBottom) putText(g, Math.max(vpLeft + 1, lx), ly, e.name, "#9fe", vpRight);
        }
        continue;
      }

      // --- Distant non-ship body: single glyph -----------------------------
      if (rCells < 1.2) {
        if (sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) continue;
        const glowBody = e.kind === "star" || e.kind === "bullet" || e.kind === "comet";
        g[sy2][sx] = { ch: glyph, color: tint.fill, glow: glowBody };
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

      // Compute a camera-space 2D light direction for shading planets /
      // stations / asteroids. The "light" is the nearest star to the entity,
      // projected into the same camera basis the sprite is drawn in. Stars
      // themselves and tiny bodies skip shading.
      let lightX = 0, lightY = 0, lit = false;
      if (e.kind === "planet" || e.kind === "station" || e.kind === "asteroid") {
        let star: Entity | null = null;
        let bestD = Infinity;
        for (const s of this.entities) {
          if (s.kind !== "star") continue;
          const d = V.len(V.sub(s.pos, e.pos));
          if (d < bestD) { bestD = d; star = s; }
        }
        if (star) {
          const lr = V.sub(star.pos, e.pos);
          const lx1 = cy * lr.x - sy * lr.z;
          const lz1 = sy * lr.x + cy * lr.z;
          const ly1 = cp * lr.y - sp * lz1;
          // Screen Y grows downward, so flip the math-Y to match.
          let lvx = lx1, lvy = -ly1;
          const llen = Math.hypot(lvx, lvy);
          if (llen > 0.001) {
            lightX = lvx / llen;
            lightY = lvy / llen;
            lit = true;
          }
        }
      }

      // Star glow halo — a faint outer ring outside the solid disc so the
      // central star reads as a luminous source rather than a flat blob.
      // Halo color tracks the stellar class so blue giants shed blue light
      // and red dwarves smoulder red rather than every star haloing amber.
      if (e.kind === "star") {
        const haloR = 1.55;
        const haloChars = ["+", "·", "."];
        const haloCol = stellarClassOf(e).halo;
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
            const t = Math.min(2, Math.floor((d2 - 1.0) / 0.20));
            g[gy][gx] = { ch: haloChars[t], color: haloCol, glow: true };
          }
        }
      }

      // Nebulae: irregular colored gas cloud. Value-noise threshold gives it a
      // ragged outline (never a clean disc), three-tone palette layers a
      // bright core / mid / faint edge so it reads as volumetric. Blends with
      // (does not overwrite) whatever's already been painted underneath.
      if (e.kind === "nebula") {
        const pal = nebulaPalette(e);
        const gly = NEBULA_GLYPHS;
        // Nebula spans are large — the raw rCells can exceed 100+ cells. Keep
        // it that way; the noise threshold makes most cells transparent.
        const nrx = Math.max(3, Math.round(rCells));
        const nry = Math.max(2, Math.round(rCells * (CELL_W / CELL_H)));
        for (let dy = -nry; dy <= nry; dy++) {
          for (let dx = -nrx; dx <= nrx; dx++) {
            const nx = dx / nrx, ny = dy / nry;
            const d2 = nx * nx + ny * ny;
            if (d2 > 1.15) continue;
            const gx = sx + dx, gy = sy2 + dy;
            if (gx <= vpLeft || gx >= vpRight || gy <= vpTop || gy >= vpBottom) continue;
            // Irregular density: combine two noise scales so both large
            // wisps and fine fringe detail exist.
            const n = nebulaNoise(e.id, dx, dy) * 0.6
                    + nebulaNoise(e.id + 1, Math.floor(dx / 3), Math.floor(dy / 3)) * 0.4;
            const density = n * (1 - d2 * 0.85);
            if (density < 0.28) continue;
            // Do not obliterate stars / ships / planets already drawn.
            if (g[gy][gx].ch !== " ") continue;
            const shade = density > 0.55 ? 0 : density > 0.4 ? 1 : 2;
            const ch = gly[Math.floor(hash01(e.id * 17 + dx * 31 + dy * 7) * gly.length)];
            g[gy][gx] = { ch, color: pal[shade], glow: shade === 0 };
          }
        }
        // Skip the default filled-sphere path for nebulas.
        continue;
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
          let color = onEdge ? tint.edge : tint.fill;
          if (lit) {
            // Lambert-ish: dot of surface-normal proxy with light direction.
            // Bias up so the lit hemisphere is bright, terminator is muted,
            // and the back side fades to deep shadow.
            const dot = nx * lightX + ny * lightY; // -1..1
            const shadeFactor = 0.35 + 0.85 * Math.max(0, dot + 0.15);
            color = shadeColor(color, shadeFactor);
          }
          g[gy][gx] = { ch, color, glow: e.kind === "star" };
        }
      }


      // Label big objects centered just below the sprite.
      if (rCells >= 3 && e.name) {
        const lx = sx - Math.floor(e.name.length / 2);
        const ly = sy2 + ry + 1;
        if (ly < vpBottom) putText(g, Math.max(vpLeft + 1, lx), ly, e.name, "#9fe", vpRight);
      }
    }

    // ---------------------------------------------------------------------
    // Targeting overlay: brackets when the current target is on-screen, a
    // chevron edge-pointer + distance readout when it's off-screen. Color
    // tracks faction so a friendly bracket can't be confused with a hostile.
    // ---------------------------------------------------------------------
    const tgt = this.targetId != null ? this.entities.find((e) => e.id === this.targetId) : null;
    if (tgt) {
      // Reset bracket easing when the player swaps targets.
      if (this._bracketTargetId !== tgt.id) {
        this._bracketTargetId = tgt.id;
        this._bracketAcquiredAt = performance.now() / 1000;
      }
      const bracketCol =
        tgt.kind === "hostile" ? "#ff5555" :
        tgt.kind === "friendly" ? "#7CFC00" :
        tgt.kind === "station" ? (tgt.faction === "pirate" ? "#ff7766" : "#c2c2ff") :
        tgt.kind === "asteroid" ? "#a6886a" :
        "#fc6";
      const tprojIdx = projected.findIndex((q) => q.e.id === tgt.id);
      const tproj = tprojIdx >= 0 ? projected[tprojIdx] : null;
      if (tproj) {
        // On-screen: draw four corner brackets that snap inward over ~4 frames.
        const age = performance.now() / 1000 - this._bracketAcquiredAt;
        const ease = Math.min(1, age * 6); // 0→1 over ~0.17s
        const baseR = Math.max(2, Math.round(tproj.r));
        // Start wide (baseR + 4) and ease in to (baseR + 1).
        const rb = Math.round((baseR + 4) - 3 * ease);
        const bx = tproj.sx, by = tproj.sy;
        const corners: [number, number, string][] = [
          [bx - rb,     by - rb,     "┌"],
          [bx + rb,     by - rb,     "┐"],
          [bx - rb,     by + rb,     "└"],
          [bx + rb,     by + rb,     "┘"],
        ];
        for (const [cxB, cyB, ch] of corners) {
          if (cxB > vpLeft && cxB < vpRight && cyB > vpTop && cyB < vpBottom) {
            g[cyB][cxB] = { ch, color: bracketCol };
          }
        }
        // Distance + name tag above the top-left corner.
        const d = V.len(V.sub(tgt.pos, p.pos));
        const tag = `${tgt.name}  ${d.toFixed(0)}u`;
        const ty = by - rb - 1;
        if (ty > vpTop) putText(g, Math.max(vpLeft + 1, bx - rb), ty, tag.slice(0, Math.max(0, vpRight - (bx - rb) - 1)), bracketCol, vpRight);

        // Lead indicator: simple constant-bullet-speed first-order intercept.
        // Only useful for ships (asteroids barely drift). Drawn as a faint '+'.
        if (tgt.kind === "hostile" || tgt.kind === "friendly" || tgt.kind === "neutral") {
          const rel = V.sub(tgt.pos, p.pos);
          const relV = tgt.vel;
          const bulletS = 260;
          const dist = V.len(rel);
          if (dist > 5) {
            const tLead = dist / bulletS;
            const leadW = { x: tgt.pos.x + relV.x * tLead, y: tgt.pos.y + relV.y * tLead, z: tgt.pos.z + relV.z * tLead };
            const lp = projectPoint(leadW.x, leadW.y, leadW.z);
            if (lp && lp.sx > vpLeft && lp.sx < vpRight && lp.sy > vpTop && lp.sy < vpBottom) {
              const cell = g[lp.sy][lp.sx];
              if (cell.ch === " " || cell.ch === "·" || cell.ch === ".") {
                g[lp.sy][lp.sx] = { ch: "+", color: "#ffaa55" };
              }
            }
          }
        }
      } else {
        // Off-screen edge pointer. Project the relative vector into camera
        // space, then pick the viewport edge it intersects and an arrow glyph.
        const rel = V.sub(tgt.pos, p.pos);
        const x1 = cy * rel.x - sy * rel.z;
        const z1 = sy * rel.x + cy * rel.z;
        const y1 = cp * rel.y - sp * z1;
        const z2 = sp * rel.y + cp * z1;
        const behind = z2 <= 1;
        // Use a synthetic projection that radiates outward from center even
        // when the target is behind, so the arrow always points somewhere.
        let dx: number, dy: number;
        if (behind) { dx = -x1; dy = -y1; }
        else { dx = x1 / Math.max(0.5, z2); dy = y1 / Math.max(0.5, z2); }
        const cxV = vpLeft + vw / 2, cyV = vpTop + vh / 2;
        // Scale the direction to the viewport edge.
        const halfW = vw / 2 - 2, halfH = vh / 2 - 2;
        const m = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH) || 1;
        const ex = Math.round(cxV + dx / m);
        const ey = Math.round(cyV + dy / m);
        // Pick chevron based on dx/dy octant.
        let arrow = "●";
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax < ay * 0.4) arrow = dy < 0 ? "▲" : "▼";
        else if (ay < ax * 0.4) arrow = dx < 0 ? "◄" : "►";
        else if (dx < 0 && dy < 0) arrow = "◤";
        else if (dx > 0 && dy < 0) arrow = "◥";
        else if (dx < 0 && dy > 0) arrow = "◣";
        else arrow = "◢";
        const exC = Math.max(vpLeft + 1, Math.min(vpRight - 1, ex));
        const eyC = Math.max(vpTop + 1, Math.min(vpBottom - 1, ey));
        const dist = V.len(rel);
        const distStr = dist > 1000 ? `${(dist / 1000).toFixed(1)}k` : `${dist.toFixed(0)}`;
        const label = behind ? `${arrow} ${tgt.name.slice(0, 10)}  TURN ${distStr}` : `${arrow} ${tgt.name.slice(0, 10)}  ${distStr}`;
        // Place label hugging the chosen edge — left/right edges put text inside.
        let lx = exC + 1;
        if (exC > vpLeft + vw * 0.6) lx = Math.max(vpLeft + 1, exC - label.length - 1);
        const ly = Math.max(vpTop + 1, Math.min(vpBottom - 1, eyC));
        g[eyC][exC] = { ch: arrow, color: bracketCol };
        putText(g, lx, ly, label, bracketCol, vpRight);
      }
    } else {
      this._bracketTargetId = null;
    }

    // ---------------------------------------------------------------------
    // Persistent status banners — centered near the top of the viewport so
    // the pilot sees them without looking away from the reticle. Each banner
    // has its own trigger; a stack of up to three can appear at once.
    // ---------------------------------------------------------------------
    const banners: [string, string, boolean][] = []; // [text, color, blink]
    const bNow = performance.now() / 1000;
    const bBlink = Math.floor(bNow * 2) % 2 === 0;
    const hullFracB = p.ship.hull / p.ship.hullMax;
    if (hullFracB > 0 && hullFracB < 0.30) {
      banners.push([`⚠ LOW HULL ${Math.round(hullFracB * 100)}% — DOCK TO REPAIR`, bBlink ? "#ff5555" : "#661111", true]);
    }
    if (cargoTotal(p) >= p.ship.cargoMax) {
      banners.push(["◈ CARGO HOLD FULL — sell at station or jettison (J)", "#ffcc55", false]);
    }
    if (this._scoopingUntil > bNow) {
      banners.push(["◎ SCOOPING FUEL", bBlink ? "#ffd066" : "#a07020", false]);
    }
    banners.forEach((row, i) => {
      const [text, color] = row;
      const bx = Math.max(vpLeft + 2, vpLeft + Math.floor(vw / 2) - Math.floor(text.length / 2));
      const by = vpTop + 2 + i;
      putText(g, bx, by, text, color, vpRight);
    });

    // ---------------------------------------------------------------------
    // Pinned quest tracker — compact panel anchored top-right of viewport.
    // Mirrors the bottom-bar mission line but stays visible while flying.
    // ---------------------------------------------------------------------
    if (this.questPinned && p.mission) {
      const m = p.mission;
      const qw = 28;
      const qx = Math.max(vpLeft + 2, vpRight - qw - 1);
      const qy = vpTop + 1;
      putText(g, qx, qy, "[ QUEST ]", "#cf6", vpRight);
      const desc = m.description.length > qw ? m.description.slice(0, qw - 1) + "…" : m.description;
      putText(g, qx, qy + 1, desc, "#fff", vpRight);
      // Progress line:
      let prog = "";
      if (m.kind === "deliver" && m.cargoItem) {
        const have = p.cargo[m.cargoItem] ?? 0;
        prog = `${have}/${m.cargoQty} ${m.cargoItem}` + (m.done ? "  ✓ DOCK" : "");
      } else if (m.kind === "destroy" && m.targetId != null) {
        const tt = this.entities.find((e) => e.id === m.targetId);
        if (tt && (tt.hull ?? 0) > 0) {
          const d = V.len(V.sub(tt.pos, p.pos));
          prog = `${tt.name}  ${d.toFixed(0)}u`;
        } else prog = "✓ destroyed — DOCK";
      } else if (m.kind === "scan" && m.targetId != null) {
        const tt = this.entities.find((e) => e.id === m.targetId);
        if (tt) {
          const d = V.len(V.sub(tt.pos, p.pos));
          prog = m.done ? "✓ scanned — DOCK" : `${tt.name}  ${d.toFixed(0)}u`;
        }
      }
      if (prog) putText(g, qx, qy + 2, prog, m.done ? "#7CFC00" : "#cf6", vpRight);
      // Draw a small ◇ at the projected objective if on-screen.
      let objId: number | undefined = m.targetId;
      if (m.kind === "deliver") {
        // Nearest civilian station as the implicit objective.
        let bestS: Entity | null = null; let bestD = Infinity;
        for (const e of this.entities) {
          if (e.kind !== "station" || e.faction === "pirate") continue;
          const d2 = V.len(V.sub(e.pos, p.pos));
          if (d2 < bestD) { bestD = d2; bestS = e; }
        }
        if (bestS) objId = bestS.id;
      }
      if (objId != null) {
        const op = projected.find((q) => q.e.id === objId);
        if (op && op.sx > vpLeft && op.sx < vpRight && op.sy > vpTop && op.sy < vpBottom) {
          // Slight offset so it doesn't overlap the body's own glyph.
          const oy = Math.max(vpTop + 1, op.sy - Math.max(1, Math.round(op.r) + 1));
          if (g[oy][op.sx].ch === " ") g[oy][op.sx] = { ch: "◇", color: "#cf6" };
        }
      }
    }






    // Crosshair. Color shifts to indicate weapon-range state of whatever's
    // closest to the reticle's forward vector:
    //   green  → idle / nothing aligned
    //   amber  → target aligned but out of weapon range
    //   red    → target aligned AND in weapon range (free shot)
    const ccx = vpLeft + Math.floor(vw / 2), ccy = vpTop + Math.floor(vh / 2);
    let reticleCol = "#3a6";
    {
      const fwd = headingToVec(p.heading.yaw, p.heading.pitch);
      let bestDot = 0.93, bestE: Entity | null = null, bestD = Infinity;
      for (const e of this.entities) {
        if (e.kind !== "hostile" && e.kind !== "neutral" && e.kind !== "friendly" && e.kind !== "asteroid" && e.kind !== "station") continue;
        const rel = V.sub(e.pos, p.pos);
        const d = V.len(rel); if (d < 1) continue;
        const dotv = (rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z) / d;
        if (dotv > bestDot) { bestDot = dotv; bestE = e; bestD = d; }
      }
      if (bestE) {
        const w = WEAPONS.find((x) => x.id === p.ship.weaponId) ?? WEAPONS[0];
        const inRange = bestE.kind === "asteroid" ? bestD < 200
          : bestE.kind === "station"  ? bestD < 400
          : bestD < w.range;
        reticleCol = inRange ? "#ff5555" : "#fc6";
      }
    }
    putText(g, ccx - 1, ccy, "-+-", reticleCol);
    g[ccy - 1][ccx].ch = "|"; g[ccy - 1][ccx].color = reticleCol;
    g[ccy + 1][ccx].ch = "|"; g[ccy + 1][ccx].color = reticleCol;

    // --- Right-side cockpit panel ---
    const panelX = vpRight + 2;
    putText(g, panelX, vpTop, "[ COCKPIT ]", "#7CFC00");
    putText(g, panelX, vpTop + 2, `Cmdr ${p.char.name}`, "#fff");
    putText(g, panelX, vpTop + 3, `Rank ${p.rank}  XP ${p.xp}`, "#9fe");
    putText(g, panelX, vpTop + 4, `Credits ${p.credits}`, "#fb6");
    // Hull / Shield / Fuel — blink and brighten when in alarm range so the
    // player can't miss critical states even at a glance.
    const blinkOn = (Math.floor(performance.now() / 220) % 2) === 0;
    const hullPctR = p.ship.hull / p.ship.hullMax;
    const fuelPctR = p.ship.fuel / p.ship.fuelMax;
    const hullCol = hullPctR < 0.10 ? (blinkOn ? "#ff2222" : "#660000")
                  : hullPctR < 0.30 ? (blinkOn ? "#ff8a8a" : "#aa3333")
                  : "#f88";
    const shieldCol = (p.ship.shield <= 0 && performance.now() / 1000 < this.shieldFlashUntil)
                  ? (blinkOn ? "#ffffff" : "#8cf")
                  : "#8cf";
    const fuelCol = fuelPctR < 0.15 ? (blinkOn ? "#ffcc33" : "#664400") : "#fc6";
    putText(g, panelX, vpTop + 6, `Hull   ${bar(p.ship.hull, p.ship.hullMax)}`, hullCol);
    putText(g, panelX, vpTop + 7, `Shield ${bar(p.ship.shield, p.ship.shieldMax)}`, shieldCol);
    putText(g, panelX, vpTop + 8, `Fuel   ${bar(p.ship.fuel, p.ship.fuelMax)}`, fuelCol);
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
      if (t.pilotName) putText(g, panelX, cy2 + 4, `pilot: ${t.pilotName}`, "#ffd680");
      if (t.hull !== undefined) putText(g, panelX, cy2 + (t.pilotName ? 5 : 4), `hull ${t.hull}  sh ${t.shield ?? 0}`, "#f88");
    } else {
      putText(g, panelX, cy2 + 2, "T cycle  [ ] by kind", "#888");
    }

    // Crew status block — shows gunner + hired crew (pilot/engineer/merchant).
    if (p.gunner || (p.crew && p.crew.length > 0)) {
      let gy0 = cy2 + 6;
      putText(g, panelX, gy0, `[ CREW ${crewCount(p)}/${effectiveCrewMax(p)} ]`, "#7CFC00");
      gy0++;
      if (p.gunner) {
        putText(g, panelX, gy0, `Gun ${p.gunner.name.split(" ")[0]}`, "#fff");
        putText(g, panelX + 12, gy0, p.gunner.enabled ? "AUTO" : "STANDBY", p.gunner.enabled ? "#fc6" : "#888");
        gy0++;
      }
      if (p.crew) for (const c of p.crew) {
        const info = CREW_ROLE_INFO[c.role];
        const tag = c.role === "pilot" ? (c.autopilot ? "AUTOPILOT" : "ready") : "on watch";
        putText(g, panelX, gy0, `${info.title.slice(0, 3)} ${c.name.split(" ")[0]}`, "#fff");
        putText(g, panelX + 12, gy0, tag, info.color);
        gy0++;
      }
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
      ["X", "supercruise (3x)"],
      ["SPACE", "fire"],
      ["T", "cycle target"],
      ["[ / ]", "cycle by kind"],
      ["M", "mine target"],
      ["F", "dock / station"],
      ["J", "jettison cargo"],
      ["O", "autopilot (Pilot)"],
      ["U", "quest log"],
      ["L", "codex"],
      ["K", "pin tracker"],
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

    // --- COMMS / chatter box ---
    // Lives along the bottom edge between the system column and the log.
    // Newest line on top, dimmed by age so old lines fade visually.
    const commsX = 28;
    const commsY = rTop + 7;
    const inNeb = (this as unknown as { _inNebula?: boolean })._inNebula === true;
    const commsTitle = inNeb ? "[ CO▓M░S ]" : "[ COMMS ]";
    putText(g, commsX, commsY, commsTitle, inNeb ? "#c47afc" : "#7CFC00");
    const nowS = performance.now() / 1000;
    const commsW = Math.max(20, (cols - 52) - commsX - 2);
    for (let i = 0; i < Math.min(4, this.chatter.length); i++) {
      const c = this.chatter[i];
      const age = nowS - c.t;
      const dim = age > 20 ? "#555" : age > 8 ? "#888" : c.color;
      let line = `«${c.who}» ${c.msg}`;
      // Nebula interference: replace ~25% of chars with static so comms
      // read as garbled from inside a cloud.
      if (inNeb) {
        const junk = ["#", "%", "▒", "░", "▓", "*", "~", ".", "?"];
        const rSeed = Math.floor(nowS * 3) + i * 37;
        let out = "";
        for (let k = 0; k < line.length; k++) {
          const ch = line[k];
          if (ch === " ") { out += ch; continue; }
          if (hash01(rSeed + k) < 0.28) out += junk[Math.floor(hash01(rSeed * 13 + k) * junk.length)];
          else out += ch;
        }
        line = out;
      }
      putText(g, commsX, commsY + 1 + i, line.slice(0, commsW), dim);
    }


    // Log (mission / system events; separate from chatter).
    let ly = rTop;
    for (let i = this.log.length - 1; i >= 0; i--) {
      putText(g, cols - 52, ly++, "» " + this.log[i].msg, "#cfd");
      if (ly > rows - 2) break;
    }

    // Keys hint
    const gunnerHint = p.gunner ? `  G ${p.gunner.enabled ? "gunner ON" : "gunner off"}` : "";
    const pilotCrew = getCrew(p, "pilot");
    const autoHint = pilotCrew ? `  O ${pilotCrew.autopilot ? "AUTOPILOT" : "auto off"}` : "";
    putText(g, 2, rows - 1, "W/S thr  A/D yaw  Q/E pit  SHIFT boost  SPC fire  T tgt  [/] kind  M mine  F dock  J jett  O auto  U log  L legend  K pin  P pause  ESC menu" + gunnerHint + autoHint, "#666");

    // FPS overlay (optional)
    if (this.options.showFps) putText(g, cols - 10, 0, `fps ${this.fps}`, "#7CFC00");

    // Boost indicator
    if (this.input.keys.has(this.options.keybinds.boost) && p.ship.fuel > 0) {
      putText(g, vpLeft + Math.floor(vw / 2) - 5, vpBottom - 1, "» AFTERBURNER «", "#fc6", vpRight);
    }
    // Supercruise banner — separate row so it can stack with afterburner.
    if (this.input.keys.has(this.options.keybinds.supercruise) && p.ship.fuel > 0) {
      const msg = "» » » SUPERCRUISE — weapons offline « « «";
      putText(g, vpLeft + Math.floor(vw / 2 - msg.length / 2), vpTop + 1, msg, "#bff7ff", vpRight);
    }

    // Autopilot banner — large, near center, so mouse-steer players see clearly
    // that steering is hands-off and how to reclaim manual control. Mouse steer
    // is intentionally suppressed while autopilot is engaged (see driveAutopilot
    // gate above) so cursor motion does NOT disengage it — the pilot key does.
    if (pilotCrew && pilotCrew.autopilot) {
      const blink = Math.floor(performance.now() / 500) % 2 === 0;
      const col = blink ? "#8cf" : "#4a8fd6";
      const okey = (this.options.keybinds.autopilot || "o").toUpperCase();
      const l1 = "» » »  AUTOPILOT ENGAGED  « « «";
      const l2 = `Press ${okey} to disengage`;
      const cy = vpTop + Math.floor(vh / 2) - 3;
      putText(g, vpLeft + Math.floor(vw / 2 - l1.length / 2), cy,     l1, col, vpRight);
      putText(g, vpLeft + Math.floor(vw / 2 - l2.length / 2), cy + 1, l2, "#bcd", vpRight);
    }

    // Cockpit damage state: when hull < 25%, etch crack patterns along the
    // viewport edges and flash a warning. Pure decoration tied to ship health.
    const hullFrac = p.ship.hull / Math.max(1, p.ship.hullMax);
    if (hullFrac < 0.25) {
      const flash = Math.floor(performance.now() / 400) % 2 === 0;
      const crackCol = flash ? "#ff3a3a" : "#9a1a1a";
      const cracks: [number, number, string][] = [
        [vpLeft + 4, vpTop + 2, "/"], [vpLeft + 6, vpTop + 3, "\\"],
        [vpRight - 4, vpTop + 2, "\\"], [vpRight - 6, vpTop + 4, "/"],
        [vpLeft + 8, vpBottom - 3, "\\"], [vpRight - 8, vpBottom - 4, "/"],
        [vpLeft + 12, vpTop + 6, "*"], [vpRight - 14, vpBottom - 7, "*"],
        [vpLeft + 3, Math.floor((vpTop + vpBottom) / 2), "/"],
        [vpRight - 3, Math.floor((vpTop + vpBottom) / 2) + 1, "\\"],
      ];
      for (const [cx2, cy2, ch] of cracks) {
        if (cy2 > vpTop && cy2 < vpBottom && cx2 > vpLeft && cx2 < vpRight) {
          g[cy2][cx2] = { ch, color: crackCol };
        }
      }
      const warn = "‼ HULL CRITICAL ‼";
      putText(g, vpLeft + Math.floor(vw / 2 - warn.length / 2), vpBottom - 2, warn, crackCol);
    }

    // CRITICAL: hull <10% with no shields — animated fire dances across the
    // HUD edges so the player cannot miss they're seconds from breakup.
    if (hullFrac < 0.10 && p.ship.shield <= 0 && !this._reducedMotion) {
      const fireGlyphs = ["^", "*", "v", "&", "%", "#"];
      const fireCols = ["#ffe066", "#ffa033", "#ff5522", "#cc2200"];
      const tFire = performance.now() / 1000;
      // Top + bottom edges of the viewport
      for (let x = vpLeft + 1; x < vpRight; x++) {
        // Pseudo-noise — varies per column and time so flames flicker
        const n1 = Math.sin(x * 0.7 + tFire * 8.2) * 0.5 + Math.sin(x * 1.9 + tFire * 5.1) * 0.5;
        const n2 = Math.sin(x * 0.9 + tFire * 6.7 + 1.3) * 0.5 + Math.sin(x * 2.3 + tFire * 4.4) * 0.5;
        if (n1 > -0.2) {
          const ch = fireGlyphs[Math.floor((n1 + 1) * fireGlyphs.length / 2) % fireGlyphs.length];
          const col = fireCols[Math.floor((n1 + 1) * fireCols.length / 2) % fireCols.length];
          const y = vpTop + 1;
          g[y][x] = { ch, color: col, glow: true };
          if (n1 > 0.4) g[y + 1][x] = { ch: ".", color: fireCols[3] };
        }
        if (n2 > -0.2) {
          const ch = fireGlyphs[Math.floor((n2 + 1) * fireGlyphs.length / 2) % fireGlyphs.length];
          const col = fireCols[Math.floor((n2 + 1) * fireCols.length / 2) % fireCols.length];
          const y = vpBottom - 1;
          g[y][x] = { ch, color: col, glow: true };
          if (n2 > 0.4) g[y - 1][x] = { ch: ".", color: fireCols[3] };
        }
      }
      // Side edges, sparser
      for (let y = vpTop + 2; y < vpBottom - 1; y++) {
        const n = Math.sin(y * 1.3 + tFire * 7.0) * 0.5 + Math.sin(y * 2.1 + tFire * 3.9) * 0.5;
        if (n > 0.1) {
          const ch = fireGlyphs[Math.floor((n + 1) * fireGlyphs.length / 2) % fireGlyphs.length];
          const col = fireCols[Math.floor((n + 1) * fireCols.length / 2) % fireCols.length];
          g[y][vpLeft + 1] = { ch, color: col, glow: true };
          g[y][vpRight - 1] = { ch, color: col, glow: true };
        }
      }
      // Pulsing "BREAKUP IMMINENT" tag
      const tagBlink = (Math.floor(performance.now() / 180) % 2) === 0;
      const tag = "‼ ‼ ‼  BREAKUP IMMINENT — DOCK NOW  ‼ ‼ ‼";
      putText(g, vpLeft + Math.floor(vw / 2 - tag.length / 2), vpTop + Math.floor(vh / 2) + 3,
        tag, tagBlink ? "#ffe066" : "#ff3322");
    }

    // Nebula fog overlay — softens viewport with scattered dim glyphs.
    const inNeb2 = (this as unknown as { _inNebula?: boolean })._inNebula;
    if (inNeb2) {
      for (let i = 0; i < 30; i++) {
        const x = vpLeft + 1 + Math.floor(Math.random() * (vw - 2));
        const y = vpTop + 1 + Math.floor(Math.random() * (vh - 2));
        if (g[y][x].ch === " ") g[y][x] = { ch: "░", color: "#5a3a7a" };
      }
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
