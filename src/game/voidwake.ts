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
const VERSION = "0.5.14";

// =============================================================================
// Scripting Hooks (0.5.1)
// -----------------------------------------------------------------------------
// A minimal, runtime-agnostic hook surface reserved for the upcoming Lua
// scripting system. Hooks are pure JS callbacks today; a future Lua host
// (fengari-web / a WASM Lua 5.3) will register wrapped functions that thunk
// into Lua-space. Every hook is fire-and-forget — a throwing handler is
// caught here and never blocks engine ticks. Handlers must treat all
// arguments as read-only until a proper mutation API lands.
//
// Hook contract (payload shapes are stable — do not change without a
// VERSION bump and a migration note in src/game/README.md):
//
//   onWorldGenerate   ({ seed, entities })              end of generateUniverse
//   onTick            ({ dt, player, entities })        top of updatePlaying
//   onPlayerFire      ({ weaponId, from, target })      pilot fire path
//   onPlayerDock      ({ entity, kind })                inside tryDock success
//                                                     kind: "station" | "ship-trade" | "planet"
//   onEntityDestroyed ({ entity, byPlayer })            debris conversion block
//   onChatter         ({ who, msg, color, channel })    end of pushChatter
//   onSave            ({ slot, blob })                  after successful save
//   onLoad            ({ slot, blob })                  after successful load
//   onPlanetLand      ({ entity })                      populated-planet landing (also fires onPlayerDock)
//
// All handlers run synchronously in engine order. Hook lists are process-
// global (not per-Voidwake instance) so a script attached at boot survives
// New Game / Load Game cycles. Registration API is intentionally tiny:
// register/unregister/clear.
export type ScriptHookName =
  | "onWorldGenerate"
  | "onTick"
  | "onPlayerFire"
  | "onPlayerDock"
  | "onEntityDestroyed"
  | "onChatter"
  | "onSave"
  | "onLoad"
  | "onPlanetLand";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScriptHookFn = (payload: any) => void;

const _scriptHooks: Record<ScriptHookName, ScriptHookFn[]> = {
  onWorldGenerate:   [],
  onTick:            [],
  onPlayerFire:      [],
  onPlayerDock:      [],
  onEntityDestroyed: [],
  onChatter:         [],
  onSave:            [],
  onLoad:            [],
  onPlanetLand:      [],
};

export function registerScriptHook(name: ScriptHookName, fn: ScriptHookFn): () => void {
  _scriptHooks[name].push(fn);
  return () => unregisterScriptHook(name, fn);
}
export function unregisterScriptHook(name: ScriptHookName, fn: ScriptHookFn): void {
  const arr = _scriptHooks[name];
  const i = arr.indexOf(fn);
  if (i >= 0) arr.splice(i, 1);
}
export function clearScriptHooks(name?: ScriptHookName): void {
  if (name) _scriptHooks[name].length = 0;
  else (Object.keys(_scriptHooks) as ScriptHookName[]).forEach((k) => (_scriptHooks[k].length = 0));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dispatchHook(name: ScriptHookName, payload: any): void {
  const arr = _scriptHooks[name];
  if (arr.length === 0) return; // hot-path fast exit
  for (let i = 0; i < arr.length; i++) {
    try { arr[i](payload); }
    catch (err) { console.warn(`[ASCII Frontier] script hook ${name} threw:`, err); }
  }
}
// Expose on window in the browser so an external Lua-host bootstrapper (or
// devtools console) can attach hooks before the runtime lands. Guarded so
// SSR / node-only tooling doesn't trip.
if (typeof window !== "undefined") {
  (window as unknown as {
    ASCIIFrontier?: {
      registerScriptHook: typeof registerScriptHook;
      unregisterScriptHook: typeof unregisterScriptHook;
      clearScriptHooks: typeof clearScriptHooks;
      VERSION: string;
    };
  }).ASCIIFrontier = { registerScriptHook, unregisterScriptHook, clearScriptHooks, VERSION };
}
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
  | "hostile" | "boss_hostile" | "friendly" | "neutral" | "station" | "planet" | "planet_populated" | "patrol"
  | "patrol_tow" | "patrol_arrest" | "stranded_mayday" | "crit_hit" | "npc_crit" | "walkout" | "stranded_thanks"
  | "gunner_idle" | "gunner_hostile" | "gunner_mine" | "gunner_dock" | "gunner_hit"
  | "gunner_greet" | "gunner_farewell_good" | "gunner_farewell_bad"
  | "gunner_kill" | "gunner_docked" | "gunner_cargofull"
  | "pilot_idle" | "pilot_greet" | "pilot_autopilot_on" | "pilot_autopilot_off"
  | "pilot_docking" | "pilot_farewell_good" | "pilot_farewell_bad"
  | "engineer_idle" | "engineer_greet" | "engineer_repair" | "engineer_shields"
  | "engineer_fuel" | "engineer_farewell_good" | "engineer_farewell_bad"
  | "merchant_idle" | "merchant_greet" | "merchant_deal" | "merchant_broke"
  | "merchant_farewell_good" | "merchant_farewell_bad"
  | "navigator_idle" | "navigator_greet"
  | "navigator_farewell_good" | "navigator_farewell_bad"
  | "quartermaster_idle" | "quartermaster_greet"
  | "quartermaster_farewell_good" | "quartermaster_farewell_bad"
  | "recruiter_idle" | "recruiter_greet"
  | "recruiter_farewell_good" | "recruiter_farewell_bad"
  | "tactical_idle" | "tactical_greet" | "tactical_hostile"
  | "tactical_farewell_good" | "tactical_farewell_bad"
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
    "Nice hull. Be nicer as scrap.",
    "You a courier or a coffin, {ship}?",
    "Broadcasting: {ship} marked. Cut her open.",
    "Federation ain't coming. Not out here.",
    "Say hi to the void, {cmdr}.",
    "You brought {cargo}% cargo to a knife fight.",
    "That's a fine {ship}. Be a shame if it stopped flying.",
    "Comms are hot, guns are hotter, {cmdr}.",
    "Every second you drift, you owe me another credit.",
    "Bounty on you says ambitious. Corpse says overcooked.",
    "Slow-burn courier? Slower-burn corpse. Same difference.",
    "This lane's ours by right of guns, {cmdr}.",
    "Peel that {ship} like a ration can, boys.",
    "You should've picked a bigger hull, or a bigger set of nerves.",
    "Split her open — the black takes what we don't.",
    "I'll trade your beacon for a bounty at any grey dock, {cmdr}.",
    "You fly like paperwork. Neat, slow, filed under 'expired'.",
    "Guns hot on the {ship}. Say goodnight to {sector}.",
    "Bet you cargo-to-hull my burn beats your jink.",
    "That transponder's about to be someone else's souvenir.",
    "Hail the wing — {cmdr}'s hull is on the menu.",
    "Nothing personal, {cmdr}. Just quarterly numbers.",
    "Your beacon sings prey, {cmdr}. Loud and clear.",
    "Wing, mark the fuel — hulls burn better dry.",
    "You fly a {ship} like it owes you money. It doesn't. I do.",
    "Every lane's got a price. Yours came due.",
    "Cmdr — pop that transponder or I pop your hull. Either way, I win.",
    "That's a lot of paint for a coffin. Pretty though.",
    "Say your callsign one more time, {cmdr}. Want it on the ledger right.",
    "Fed patrol's a sector out. Won't matter to you.",
    "I've eaten commanders tougher than you for breakfast. Literally, once.",
    "Boys, the {ship}'s running hot — she'll cook herself if we're patient.",
    "You want a shot at me, {cmdr}? Try aiming. Cute either way.",
  ],
  boss_hostile: [
    "So THIS is the {cmdr} the bounty board's been screaming about.",
    "Name's on my hull. Yours will be on my log tonight.",
    "Wing — hold. I want the {ship} personally.",
    "Every captain I killed had that same look, {cmdr}.",
    "Half the sector wants your kill-mark. I got here first.",
    "Broadcasting: this hull is mine. Come and remember me.",
    "You made the boards, {cmdr}. Enjoy the last verse.",
    "Guns free on the {ship}. No cargo, no manifest — just meat.",
    "I don't chase small fry. I hunt commanders.",
    "You brought a hobbyist loadout to a professional's lane.",
    "I've buried commanders with better paint jobs than yours.",
    "You want a warning shot? That's what your hull is.",
    "Cmdr {cmdr} — I've been paid in advance for this kill.",
    "Wing, weapons cold. This one's mine end-to-end.",
    "Every scar on my hull came from a captain who fought harder than you.",
    "I write the epitaphs on this lane, {cmdr}. Yours is short.",
  ],
  friendly: [
    "Safe vectors, Cmdr {cmdr}.",
    "{ship}, you're clear to pass. {praise}.",
    "{fac} thanks you, {cmdr}. Watch the {sector} lanes.",
    "Heard about your {kills} kills — fly true.",
    "Need anything? Nearest dock pings from {sector}.",
    "Eyes up — {rumor}.",
    "Convoy running clean today. Fly with us if you like.",
    "Been reading your bounty tally, Cmdr. Keep at it.",
    "If you see a mayday out here, squawk it up the lane.",
    "Coffee's terrible, company's fine. Come say hi at {sector}.",
    "Wing formation's tight today. Nice to see, {cmdr}.",
    "Lanes are calm. We'll take a quiet shift.",
    "Fly under our colors sometime — the pay's honest.",
    "Cmdr, if the black gets loud, we're a squawk away.",
    "Bounty scanner's noisy today — mind your six.",
    "Half our lane rides on kindness. Yours is banked.",
    "Wing salutes the {ship}. That paint job earned it.",
    "Cmdr {cmdr}, our medic says thanks for the last resupply run.",
    "If you're hauling {ore}, we know a buyer paying above spot.",
    "Lane's ours till dusk cycle. Fly warm, {cmdr}.",
    "Kids on the promenade know your callsign, {cmdr}. Fly true.",
    "We logged your assist last week. Round's on us at any Fed dock.",
    "Reputation panel says you're welcome home, {cmdr}.",
    "That's a courier's burn if I ever saw one. Safe lanes.",
    "Convoy leader hails the {ship} — thanks for keeping the lane clean.",
    "Cmdr, we logged your last mayday assist. Coffee's on us at any Fed dock.",
    "Escort wing says the {ship} flies like it grew up in the black.",
    "Federation dispatch marks you as friend-of-lane. Fly proud.",
    "Cmdr, we heard about the pirate wing you thinned out in {sector}. Nice work.",
    "Convoy medic waves — we still have your blood type stocked. Just in case.",
    "Rookie in the wing wants your autograph, {cmdr}. Don't laugh, he's serious.",
    "If the lane goes hot, squawk on 121.5 — we're always listening.",
    "Wing runs quiet on this shift. Company's welcome if you want to formation up.",
    "Cmdr — the {ship}'s trim looks perfect from here. Textbook.",
    "Fed comms says the {sector} beat is running smooth. Rare and nice.",
  ],
  neutral: [
    "{ship}, mind your wake.",
    "Guild traffic, hold lanes near {sector}.",
    "Got rocks to sell, push off.",
    "Heard {rumor}. Probably nothing.",
    "Comms check — read you five-by, {cmdr}.",
    "If you see {curse} types out here, don't engage.",
    "Long haul today. Company's welcome — trouble isn't.",
    "You buying? I'm selling. Otherwise, drift on.",
    "Manifest's clean, {cmdr}. Don't get creative.",
    "This lane's slow. Sun's warm. That's the report.",
    "Guild rate today: pay me or don't hail me.",
    "Ore's moving. Fuel isn't. Do the math.",
    "You look like credit, {cmdr}. Or trouble. Same thing sometimes.",
    "Long-hauler code: hail early, dock later, spend never.",
    "Not my sector, not my mayday. Might be yours though.",
    "You want gossip, {cmdr}? Cheap for cargo, free for fuel.",
    "Guild dues paid, lane fees paid, insurance… pending. Same as always.",
    "Every captain's got a story. Mine's boring. Keep it that way.",
    "Refinery's paying premium on {ore} this cycle. Word to the wise.",
    "You didn't hear this from me, but the patrol beat's short-staffed.",
    "Fly under someone's colors long enough and you forget your own.",
    "Slow burn, low overhead, home before shift end. That's the trade.",
    "Guild says a new lane's opening near {sector}. Grain of salt.",
    "Cmdr, we haul for anyone who pays and doesn't ask. Includes you.",
    "Rocks aren't glamorous, but they're honest cargo. Unlike some captains.",
    "You ever try selling ore during a colony strike? Don't. It's grim.",
    "Guild dispatcher tried to reroute me three times today. Told 'em I'm busy.",
    "Fuel gauge says home, wallet says one more haul. Wallet wins.",
    "If a Fed patrol scans us, {cmdr}, back me up on 'that crate is spinach'.",
    "The lane's a job, not a poem, {cmdr}. Some hulls forget that.",
    "You look like a captain who tips. Am I right or am I right?",
    "Long haulers age in dog years. Look at me — I'm forty and eighty.",
    "Cargo insurance says one thing, cargo hold says another. Same as always.",
  ],
  station: [
    "...automated beacon, {sector}: dock fees waived this cycle.",
    "Approach vector clear for {ship}. Welcome, {cmdr}.",
    "Maintenance bay open. Refits at standard rate.",
    "Advisory: {weather}.",
    "Market tick — ore moving well today.",
    "Manifest scan ready when you dock, {cmdr}.",
    "Docking clamps standing by for {ship}. Cmdr {cmdr}, welcome.",
    "Beacon nominal, {sector} traffic light. Come on in.",
    "Bounty board updated — new marks posted this cycle.",
    "Hydro cycling — recycled air tastes like {coffee} again. Sorry.",
    "Docking control: pad four's yours if you like the view of the star.",
    "Shipwright's got a slot open — refits go quick this shift.",
    "Bar's open till the next tick. Bring credits and stories.",
    "Refuel gantry green — pull in slow and we'll top your tanks, Cmdr.",
    "Bounty office logs {kills} kills for you. Payout window's open.",
    "Rumor mill: {rumor}. Take it with your ration salt.",
    "Beacon calibrated. Approach vectors clean for the {ship}.",
    "Shipwright's apprentice just qualified — refit rates are a hair lower.",
    "Long-range comms picked up mayday traffic near {sector}. Patrol's rolling.",
    "Recruiter's in the bar taking sign-ons. Just so you know, Cmdr.",
    "Station chapel's open this cycle if you need a quiet room.",
    "Cmdr, docking bay four just had a spill. Approach on bay three instead.",
    "Beacon operator here — my shift's twenty hours in and my coffee's ice. Fly safe.",
    "Bay chief says the {ship} handles nicer than his last three tenants combined.",
    "Automated dispatch: cargo tally reads {cargo}%. Manifest office ready.",
    "Cmdr, the tradehouse just posted a rush order. Talk to the broker.",
    "Station lights dimmed one bar for a moment. Reactor hiccup. Nothing to worry about.",
    "New arrival: {ship} on final. Docking clamps warming.",
    "Cmdr, our shipwright wants a look at your emitter. Says he can hear it from here.",
    "Beacon calibration complete. Approach lanes reading clean.",
    "Lost-and-found has a data slate from a Cmdr matching your description. Come collect.",
  ],
  planet: [
    "Surface comms crackle: {weather}.",
    "{speaker} tradehouse requests manifests from the {ship}.",
    "Atmospheric thermals strong over the northern arc.",
    "Local chatter mentions {rumor}.",
    "Orbital relay {hailVerb} you, Cmdr {cmdr}.",
    "Unpopulated world — automated relay only, Cmdr.",
    "Sensors log dust storms over the equator this rotation.",
    "Downwell winds are ugly. Wouldn't recommend a drop.",
    "Old sensor mast pings against the ionosphere — beautiful racket.",
    "Nothing but weather and rock down there, {cmdr}. Save the fuel.",
    "Automated telemetry reports crustal tremors on the day side.",
    "Auroras coming in strong. Comms will crackle for the next few ticks.",
    "Ancient relay still whispering. No one's listened in a long time.",
  ],
  planet_populated: [
    "Colony control to {ship} — landing pads clear, welcome down, Cmdr {cmdr}.",
    "Tradehouse open — ore moving at spot, fuel at market rate.",
    "Downwell traffic advisory: {weather}.",
    "{speaker} bazaar {hailVerb} the {ship} — bring cargo, leave credits.",
    "Colony militia on the beat — {praise}, {cmdr}.",
    "Manifest scan queued. Step aboard when you're locked, {cmdr}.",
    "Kids on the promenade counting hulls — you're number {kills} this cycle.",
    "Fresh water on tap, {cmdr}. First round's on the colony.",
    "Ore prices holding steady — buyers hungry for {ore} units this rotation.",
    "Ring lights up when you're on final. Bring her in gentle.",
    "Militia's dry today. Any {curse} types come with you, sing out.",
    "Recruiters at the tradehouse — hiring hands out of dirtside.",
    "Colony brewhouse serving the {sector} lager. Warn your liver.",
    "Landing beacon steady. Bring the {ship} in whenever you're ready, Cmdr.",
    "Chapel bells at dusk cycle. Even the void keeps time.",
    "Colony council thanks the last Cmdr who cleared our lane. Might've been you.",
    "Kids running dockside races again. Watch your approach, {cmdr}.",
    "Manifest office short-staffed today. Bring patience, not just credits.",
    "Fresh medics on shift. If you're hurting, we're stitching.",
  ],
  patrol: [
    "SPD Patrol to {ship} — maintain course, {cmdr}.",
    "Space Police, {sector} beat. {praise}, Cmdr.",
    "Any {curse} in your six, {cmdr}? Squawk and we're on 'em.",
    "SPD advisory — {rumor}. Fly clean.",
    "{ship}, we log this lane. Behave and we're friends.",
    "Fuel dry? Squawk mayday — we'll tow you to dock.",
    "Patrol pinging {ship} — hull {hull}%, doing alright?",
    "Attack a lawful hull in our range, Cmdr, and we return the favor.",
    "SPD to all traffic: keep weapons cold on approach lanes.",
    "Coffee's cold, guns are warm. Standard shift.",
    "Cruiser {ship} logged. Move along, {cmdr}.",
    "Fly straight, hail early, and we're friends this shift.",
    "New lawful hull just launched from {sector}. Say hi.",
    "Report {curse} activity on this band, Cmdr. We answer maydays.",
    "SPD to {sector}: any lit hostiles, squawk 'em. We roll fast.",
    "Cruiser's got fuel to burn. Wave if you see grief.",
    "Patrol logs today's fly-bys. Yours reads clean, {cmdr}.",
    "Wing check — all cruisers on-station, all guns cold. Textbook.",
    "SPD to any hull: mayday within {sector}? Squawk and we roll.",
    "Cmdr {cmdr}, keep that transponder loud. Silent ships get scanned.",
    "Patrol pass through {sector} — no contraband today, no problems today.",
    "Cruiser's coffee is Fed-standard bad. Miss home already.",
    "SPD to {ship}: keep clear of the beacon lattice, {cmdr}.",
    "Any captain running from us today is running toward us tomorrow.",
    "Patrol wing signing off shift — replacements inbound, coverage seamless.",
    "SPD advisory to {ship}: reduce closing speed, {cmdr}. Just a friendly nudge.",
    "Patrol cruiser rolling {sector}. Squawk hostile, we roll faster.",
    "Cmdr, we ran your transponder — all clear. Fly on.",
    "SPD to any hull: mayday within thirty units? Squawk once, we're on it.",
    "Patrol log: this shift, four tows, zero arrests. Slow day. Good day.",
    "Cmdr, if you see a hull marked 'H' running dark, sing out.",
    "SPD to lane: any grief on approach, we answer. That's the whole job.",
    "Patrol wing's got fuel, guns, and time. Just how we like it.",
    "Cmdr — the {ship}'s reading nominal on our scope. Carry on.",
    "SPD comms: another quiet lane makes another paid shift. Long may it last.",
  ],
  patrol_tow: [
    "SPD to {target}: sit tight, tractor locking on.",
    "Patrol has your mayday, {target}. Tow inbound — no charge.",
    "Hooking the {target}. Nearest lawful dock in {sector}, ETA short.",
    "Stranded hull acquired. Cmdr {cmdr}, hold your lane while we drag.",
    "Tractor beam engaged on {target}. Sit tight, we've got the burn.",
    "Patrol tug to {target}: nice and gentle, we'll have you dockside soon.",
    "Cmdr, tell {target}'s crew we've got water and rations in the hold.",
    "Beacon triangulated. Towing {target} home — no charge, no lecture.",
  ],
  patrol_arrest: [
    "SPD to {ship}: cease fire and stand down. This is your only warning.",
    "You lit up a lawful hull, {cmdr}. Patrol is now engaging.",
    "Guns hot on {ship}. Drop shields or drop hull, your call.",
    "Weapons free on {ship}. Compliments of the {sector} beat.",
    "You broke the peace, {cmdr}. We're here to remake it.",
    "Patrol wing converging on {ship}. Drop weapons or drop hull.",
    "Cmdr {cmdr}, this is your one chance to squawk surrender.",
    "SPD to {ship}: your bounty just tripled. Congratulations.",
  ],
  stranded_mayday: [
    "MAYDAY, MAYDAY — {ship} drifting, no fuel, any vessel please respond.",
    "Comms open — dead in the water. Squawking on all bands.",
    "Reactor's cold. Life support on batteries. Anyone reading?",
    "{fac} freighter {ship} broadcasting mayday. Please advise.",
    "Fuel's out, patience thin. Tow, please. Anyone.",
    "Batteries at half, crew rationing air. Any hull in range?",
    "This is {ship}, adrift on the {sector} lane. Squawking mayday.",
    "If you're listening: we can pay in cargo for a top-up.",
    "Kids are scared. Fuel's dry. We just need someone to slow down.",
    "Any hull, any faction — we'll take the tow. Beggars, not choosers.",
    "Broadcasting on repeat: {ship} adrift. Please, any response.",
    "Life support at 40%. If anyone reads: {ship}, {sector} lane, MAYDAY.",
    "Reactor scrammed on the last jump. We are dead-drift and squawking.",
    "Please. Any hull. Kids on board. Fuel's gone.",
    "This is {ship}, we are broadcasting in the blind. Anyone. Please.",
    "Beacon on continuous. Fuel indicator flat. Time indicator against us.",
    "Any patrol on the lane: {ship}, adrift, squawking mayday, please advise.",
  ],
  crit_hit: [
    "★ CRIT — {target} rocked.",
    "★ CRITICAL HIT on {target}.",
    "★ Solid hit, {target} is smoking.",
    "★ Clean crit — {target}'s glowing.",
    "★ Punched through — {target} is venting.",
    "★ Weak point breach — {target} is spitting sparks.",
    "★ Sweet spot on {target} — that one hurt.",
    "★ Reactor sympathetic — {target} is cooking from the inside.",
    "★ That's a systems kill on {target} — capacitor's dumped.",
    "★ Cored the {target} — armor plating cracked wide.",
    "★ Painted a weak seam on {target} and rode it home.",
    "★ Textbook crit. {target}'s telemetry is screaming.",
  ],
  npc_crit: [
    "‼ HULL BREACH — that shot went deep.",
    "‼ Direct hit! Damage control to all decks.",
    "‼ They found a seam, Cmdr — brace!",
    "‼ Critical strike registered — hull integrity dropping.",
    "‼ Ouch. That was a clean shot on us.",
    "‼ Warning: armor compromised on the port quarter!",
    "‼ Sparks in the crew deck — that hit was a crit.",
    "‼ They rang the bell on us, Cmdr. Reactor's yelling.",
    "‼ Whoever shot that got paid extra. Ouch.",
  ],
  walkout: [
    "That's it — I'm off at the next dock. Morale's dust.",
    "Pack my kit. This tour's over, {cmdr}.",
    "You couldn't feed the crew, you can't keep 'em. I'm out.",
    "Walking. Find someone else to bleed for {credits}cr.",
    "Been a pleasure. It hasn't. I'm gone.",
    "Log me as departed, Cmdr. Empty bunks pay empty wages.",
    "Rations are thin and the wages are thinner. I'm off.",
    "Cmdr — I signed for a ship, not a rolling coffin. Bye.",
    "Tell the next hire the coffee's terrible and the captain's worse.",
    "I'll walk to a station on foot before I take another shift here.",
    "Better tours out there. Cheaper bunks, warmer captains. Gone.",
  ],
  stranded_thanks: [
    "Bless you, {cmdr}. Fuel in the tanks and stars in my sights.",
    "That top-up saved the crew. We owe you a round in {sector}.",
    "You didn't have to stop — but you did. Fly safe.",
    "Reactor's warm again. Thank you kindly, {ship}.",
    "The lanes remember kindness. So do we. Safe vectors.",
    "Kids say hi, Cmdr. Fuel's a miracle. So are you.",
    "We'll pay it forward on the next mayday we hear.",
    "You bought us another cycle, {cmdr}. Won't forget it.",
    "Squawking your callsign as friend-of-lane. Fly true.",
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
    "One good crit and even a raider captain rethinks his day.",
    "You know a Federation escort'll roll the whole wing for one lit hostile?",
    "Colonies pay ore premiums, {cmdr}. Filed under 'good to know'.",
    "Bounty payouts settle faster at Fed stations. Don't hold pirate marks too long.",
    "You'd be surprised what a clean transponder buys you at a patrol scan.",
    "Rumor mill from the last dock: {rumor}. Take it or don't.",
    "Half my scars are from taking the second shot. Take the first one, {cmdr}.",
    "Star's flaring. Good day to mine coronas, bad day to loiter.",
    "You know what I miss? Real coffee. This synth stuff tastes like {coffee}.",
    "Reminds me of a run through {sector} — three raiders, one crit, zero paperwork.",
    "Tag anything with a † glyph, Cmdr. Derelicts don't shoot back.",
    "Cargo hold's at {cargo}%. We could squeeze one more asteroid before dock.",
    "I keep a lucky spent casing from my first kill. Weird? Sure. Works? Absolutely.",
    "Cmdr, if I go quiet mid-fight it's because I'm concentrating, not sulking.",
    "Old gunner's rule: never trust a raider who hails you first.",
    "This scope's got a hairline crack. Doesn't matter — I aim by feel anyway.",
    "You should hear the songs the crew sing when you're not on comms.",
    "Reload cycle's smoother than my last three ships. Whoever tuned it — respect.",
    "Cmdr, remember: patrols scan cargo, not intentions. Keep the hold clean.",
    "You know what a full mag sounds like? Nothing. That's the point.",
    "I used to name every kill. Ran out of names in {sector}. Now I just count.",
    "Bounty board's got a new mark I might chase after this contract. Don't tell.",
    "Cmdr, when you jink starboard I miss high. When you jink port I miss low. Do the math.",
    "Miner ship on the plot. Pretty sight. Boring gunnery.",
    "One of these days I'll fire a shot I don't second-guess. Not today.",
    "Reticle's clean. Guns are warm. That's all a gunner asks for.",
    "You ever notice hostiles fly better after they've fed? Weird pattern.",
    "I count three ways to peel a raider's shields. Only one's legal.",
    "Cmdr — good gunnery is 80% patience, 15% timing, 5% luck. Some days it's all luck.",
    // Sci-fi tips of the hat (light homage — no direct quotes).
    "I've seen shots you people wouldn't believe. Tracer fire off the shoulder of a gas giant.",
    "In space, no one hears you miss. Lucky for me.",
    "Never tell me the odds, {cmdr}. Just tell me where the {target} is.",
    "Rule one of gunnery, {cmdr}: don't get cocky.",
    "Boarding party? I've got a very particular set of skills.",
    "It's a good day to fire — someone else's day, ideally.",
    "Set phasers to 'we're being polite'. Then don't be polite.",
    "The Gratuitous Space Battles forum would call that shot 'artistic'. I call it Tuesday.",
  ],
  gunner_hostile: [
    "On {target}! Firing!",
    "{target} in the reticle — burn 'em!",
    "Got the lock — {target}'s {threat}!",
    "Eat plasma, {curse}!",
    "Range good, {target} lit up!",
    "Splash-two-in-progress on {target}!",
    "Trace round on {target} — walk it in!",
  ],
  gunner_mine: [
    "Chewing rock — {ore} in the hold.",
    "Nice vein. Cargo at {cargo}%.",
    "Mining {target}, hold her steady.",
    "Ore tally: {ore}. Keep us pointed.",
    "Chip, chip, chip. My favorite music.",
  ],
  gunner_dock: [
    "Suggest we dock at {target}, Cmdr.",
    "{target} looks safe. Fuel's at {fuel}%.",
    "Could use a stretch — {target}'s right there.",
    "Hull {hull}%, shields {shield}% — dock at {target}?",
    "I could use a hot meal. {target}'s got a tradehouse.",
  ],
  gunner_hit: [
    "We're taking fire! Hull {hull}%!",
    "Shields buckling — {shield}% left!",
    "Hold her steady, {cmdr}!",
    "That's coming from {nearest}!",
    "Evasive! Hull at {hull}%!",
    "Whoever's shooting us — they'll regret it.",
    "Rounds off the bow, {cmdr} — jink!",
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
    "Empty pay chit, empty magazine. I'm walking.",
  ],
  gunner_kill: [
    "{target} — splashed!",
    "That's another {curse} for the void.",
    "Scratch one. Kill count: {kills}.",
    "Cleaner than I expected. Nice angle.",
    "Down they go. Manifest 'em, Cmdr.",
    "Hostile scratched. Loot on the plot.",
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
    "Sensors say we've got clean sky for the next few thousand units.",
    "Cmdr, if you tag a station, I'll take her in without you touching the stick.",
    "Grav well ahead — I'll bank us wide, saves the fuel curve.",
    "This lane rides smoother at low throttle. Just an observation.",
    "Ancient beacon a few clicks out. Sends nothing useful. Still charming.",
    "Cmdr, you're drifting two degrees off ideal. I won't nag. Much.",
    "Ever tried threading a wormhole at full burn? Don't. Trust me.",
    "The {ship} has a lovely trim if you feather the pitch on approach.",
    "Nav chair's warm, my mug's full. This is what promotion looks like.",
    "I filed the last three sector transits. Charts are getting handsome.",
    "Cmdr — if you tag a comet I'll match rotation. Free ice water for the crew.",
    "Weird gravity ripple two clicks portside. Probably a small black hole. Probably.",
    "Space is mostly empty. Doesn't stop me watching every pixel of it.",
    "Cleanest lane home right now is heading rimward. Just so you know.",
    "I trained on a hulk that couldn't turn without groaning. This {ship}'s a dream.",
    "Cmdr, you fly like you were born owing the black money.",
    "Autopilot's cheap. Sitting your own stick is cheaper. Just saying.",
    "Watch the yaw on approach — you drift six degrees late every time.",
    "Space is empty till it isn't. Then it's very much not.",
    "Wormholes chew fuel, but they save days. Trade you like for like.",
    "Cmdr, I've flown three of these before. This one likes you best.",
    "Old pilot's rule: never dock hot, never brake late, never drink at the stick.",
    "You'd think comets are pretty. They are. Right up till one clips your paint.",
    "Every lane's got a rhythm. This one's a waltz. Fly it three-count.",
    "Nav display's happy. I'm happy. Somewhere, a merchant is not. Balance.",
    // Pilot's little sci-fi shelf.
    "Punch it, {cmdr}? I've always wanted to say that with a straight face.",
    "This ship? She may not look like much, but she's got it where it counts.",
    "Course laid in. It's not the fall that kills you — it's the sudden rendezvous with a moon.",
    "I've flown worse. Once. It was a shuttle. It was on fire. Don't ask.",
    "Somewhere, another pilot is having a worse day. Statistically.",
    "Autopilot's a fine copilot. Doesn't hum, doesn't complain, doesn't try to fly upside down for fun.",
    "You know pitch loops both ways now, {cmdr}? Try not to make the engineer nauseous.",
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
    "Reactor's within margin. Boring. That's the compliment.",
    "Cmdr, next dock I'd like to bench-test the shield emitter. No rush.",
    "Coolant's steady. Fuel filter's a bit tired but nothing critical.",
    "That last hit shook a panel loose in the mess. Already re-seated.",
    "Every good tour I've flown, the engineer's chatter is boring. Take the hint.",
    "Reactor talks to me, Cmdr. Today it said 'thanks'.",
    "I could tune the shield emitter tighter, but you'd feel the throttle lag.",
    "Cooling loop's happy. Fuel's honest. It's a good day.",
    "Cmdr, if the lights flicker twice on the bridge — that's me swapping a relay.",
    "Old habit: I torque every bolt on the reactor by hand once a week.",
    "Your last dock rattled a mount. I quietly welded it. You're welcome.",
    "Reactor's older than half this crew. Runs like it isn't. Good design.",
    "There's a coffee ring on my main console. I refuse to clean it. Superstition.",
    "Shield harmonics love a lazy throttle. Fast bursts, slow rebuilds.",
    "Cmdr — I keep three spare emitters. Two are for optimism.",
    "Reactor purring, coolant humming, coffee cold. Perfect balance.",
    "I re-tapped the aft manifold. If it whines again, it's personal.",
    "Cmdr, next dock I want two hours in the shipwright bay. Preventative.",
    "You want more shield uptime? Ease off the throttle spikes. Physics, not magic.",
    "This hull's older than my daughter and holds together twice as well.",
    "I dream in reactor tones now, Cmdr. Not sure that's healthy.",
    "Fuel efficiency's up 3% this shift. Buy me lunch and I'll get you 4%.",
    "Cmdr, if you ever lose a shield emitter mid-fight, don't panic — panic wastes air.",
    "Every good engineer keeps a mystery bolt in her toolbox. Mine's saved this ship twice.",
    "Reactor's fine. Coupler's fine. The crew, however, is a work in progress.",
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
    "Colonies buy ore above spot when the storms hit. Watch the weather feeds.",
    "Cmdr, that derelict on the fringe? Scrap alone would pay a month of wages.",
    "Guild's tightening quotas. Move product before the freeze.",
    "Long-hauler tip: never sell a full hold at the first station you dock.",
    "I could turn {credits}cr into more if we swung by {sector}.",
    "Ore price index is jittery this cycle. Perfect for a quick flip.",
    "Cmdr, I've been keeping a private ledger. Suspiciously green.",
    "Cargo insurance on this run would cost more than the cargo. Skip it.",
    "Colonies pay in credits and gossip. Both are useful.",
    "A Guild scow tried to lowball me last dock. I laughed until they folded.",
    "Rare-metal futures in {sector} are looking twitchy. Watch that market.",
    "Cmdr, if we dock at a Fed hub, let me handle the bill. Trust me.",
    "Half of trading is patience. The other half is knowing when to leave.",
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
  navigator_idle: [
    "Plot's clean, Cmdr — nearest station bearing steady.",
    "{smalltalk}.",
    "Star charts say {rumor}. Filed it under 'maybe'.",
    "Fuel window looks fine at this burn rate.",
    "Wormhole density here is thin. We'd have to hunt for a shortcut.",
    "I've got the {sector} lanes memorized. Ask any time.",
    "Cmdr, the current burn wastes maybe 8% fuel. I can plot smoother.",
    "Two wormholes and a scoop pass — that's your cheapest tour home.",
    "Star charts logged for this rotation. Cleanest lane looks like the north arc.",
    "Colony pings at bearing… hold, adjusting. There. Cheap ore, warm bar.",
    "Cmdr, if you're patient I can chain three wormholes into a scenic tour.",
    "I read a nebula the way farmers read clouds. Trust me on the reroute.",
    "That derelict icon on the plot? I can drop you within docking range.",
    "Cmdr — every navigator worth the chair keeps a mental map. Mine's a good one.",
    "Sector {sector}'s pulsar makes for a lovely chronograph. And a worse jump gate.",
    "Give me a destination and a fuel margin, I'll give you three routes.",
  ],
  navigator_greet: [
    "Navigator aboard. I'll shave a jump off every long haul, Cmdr.",
    "Cmdr {cmdr} — I read stars like other people read faces. Glad to be here.",
    "Charts stowed. Point me at a destination and I'll find the cheap line.",
  ],
  navigator_farewell_good: [
    "Fair skies, Cmdr. I'll leave you the best charts.",
    "Been a pleasure plotting for the {ship}. Safe vectors.",
  ],
  navigator_farewell_bad: [
    "You ignored every plot I filed. Good luck without me.",
    "Rather map dead systems than fly with a captain who won't listen.",
  ],
  quartermaster_idle: [
    "Manifest's tight, Cmdr. I know where every crate lives.",
    "{smalltalk}.",
    "I can shave 8% off a module sticker if you let me haggle.",
    "Rations rotated, cargo lashed. Boring is good.",
    "Ore prices in {sector} would move if we pushed the right buyer.",
    "Every crate accounted for, Cmdr. Cargo hold reads {cargo}%.",
    "I could squeeze another 5% out of the next module refit if you let me talk.",
    "Wage bill's tidy. Recruiter earns his keep by keeping mine down.",
    "Manifest looks clean for a patrol scan. No contraband flags this time.",
    "Cmdr, if we ever run bulk ore I'd like to renegotiate the fuel line.",
    "I re-lashed the aft crates. If they rattle again it's ghosts, not physics.",
    "Kept the spares inventory current. Engineer'll thank me eventually.",
    "Every kilo of cargo has a story on my ledger. Some are boring stories.",
  ],
  quartermaster_greet: [
    "Quartermaster reporting. I'll squeeze margin out of every dock, Cmdr.",
    "Cmdr {cmdr} — pleasure. My ledger's cleaner than most surgeons' hands.",
    "Cargo hold's mine now. Trust the process.",
  ],
  quartermaster_farewell_good: [
    "Solid ledger, solid captain. I'll invest my cut in {sector}.",
    "Cmdr — thanks for letting me run the hold. Fly true.",
  ],
  quartermaster_farewell_bad: [
    "You wouldn't take my numbers seriously. I'm out.",
    "Rather count screws at a dry dock than watch you overpay again.",
  ],
  recruiter_idle: [
    "Talked to a few candidates at the last dock. Decent pool this cycle.",
    "{smalltalk}.",
    "Crew morale looks steady, Cmdr. Keep the wages honest.",
    "I know a gunner in {sector} who'd sign for cheap. Say the word.",
    "Reputation's a currency too. We're spending it slower than most.",
    "Morale's holding, Cmdr. Recruiter earns his coffee.",
    "I've got two candidates lined up for the next hire — one gunner, one merc.",
    "Bar in {sector} always has good talent. Bad prices, good talent.",
    "Cmdr, if you ever fire a crew, do it dockside. Space walkouts are ugly.",
    "Wages on time keep everything else forgivable. Just saying.",
    "I hear the {sector} guild is bleeding staff. Poach season.",
    "Morale's a slow burn, Cmdr — a single hot meal buys a week of loyalty.",
    "Cmdr, next dock let me buy the crew a round on the ship's tab.",
  ],
  recruiter_greet: [
    "Recruiter aboard. I'll trim hire fees and keep the bunk happy, Cmdr.",
    "Cmdr {cmdr} — I've placed hands on a hundred hulls. This one's mine now.",
    "Give me a station and a bar, I'll bring you signatures.",
  ],
  recruiter_farewell_good: [
    "Crew's in good shape. I'll leave you my rolodex, Cmdr.",
    "Been an honor. Look me up in {sector} — I'll always find you a hand.",
  ],
  recruiter_farewell_bad: [
    "You burned every hire I brought aboard. I'm done.",
    "Rather post flyers on a stationary hab than watch you drive off another crewman.",
  ],
  tactical_idle: [
    "Threat board's quiet. I like it quiet.",
    "{smalltalk}.",
    "Shield harmonics running hot — recharge's up 25%, courtesy of yours truly.",
    "If it turns red on my scope, {cmdr}, it stops moving.",
    "Kill count's {kills}. Half of those were my calls.",
    "Threat board just refreshed. I don't like the pattern in {sector}.",
    "Cmdr, when I run guns, I want two crits per engagement. Don't slow me down.",
    "Wing tactics beat lone guns nine times out of ten. Remember that.",
    "Shield harmonics timed to your throttle. Try boosting — you'll feel it.",
    "Cmdr — a raider captain rarely fires first. Read the pause before the pop.",
    "I ran the numbers on our last kill. Ninety percent efficiency. Not enough.",
    "Threat plot's a poem, Cmdr. Ugly, honest, and always right on the ending.",
    "Tactical is patience with a gun in its hand.",
  ],
  tactical_greet: [
    "Tactical officer reporting. I run the guns, {cmdr} — Gunner's redundant with me aboard.",
    "Cmdr {cmdr} — I've boarded three Guild scows and outshot a patrol wing. You're in good hands.",
    "Shields, targeting, priority calls — mine. You fly, I fight.",
  ],
  tactical_hostile: [
    "Priority target locked — burn 'em, {cmdr}!",
    "{target} in the reticle. Cleared to engage.",
    "Shields nominal — trade shots if you have to.",
  ],
  tactical_farewell_good: [
    "Cmdr — {kills} clean kills together. Not bad. Fly true.",
    "Solid captain, solid ship. I'll take another contract when you call.",
  ],
  tactical_farewell_bad: [
    "You wasted every shot I called. I'm out.",
    "Rather train recruits than watch another good hull chew on plasma for no reason.",
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
    "{a}: {b}, quit humming.  ||  {b}: {a}, it's the reactor. That's a bad sign.",
    "{a}: Cmdr's on a streak.  ||  {b}: Cmdr's on borrowed time. Same difference.",
    "{a}: What's for shore leave?  ||  {b}: Whatever {sector} still has stocked. So, rations.",
    "{a}: The coupler's whining again.  ||  {b}: The coupler's always whining. Ignore it or fix it.",
    "{a}: If Cmdr docks that hot one more time —  ||  {b}: — the shipwright buys a boat. Yeah.",
    "{a}: I filed a hazard report on our approach lanes.  ||  {b}: Cmdr filed it in the airlock.",
    "{a}: You ever pray, {b}?  ||  {b}: Only when the reactor sings. So, weekly.",
    "{a}: We should unionize.  ||  {b}: We're two people, {a}. That's just a conversation.",
    "{a}: Bet Cmdr can't dock without scraping.  ||  {b}: You're on. Loser buys {coffee}.",
    "{a}: How much did the last refit cost?  ||  {b}: Don't. You'll cry.",
    "{a}: If we hit another rock —  ||  {b}: — we're calling it exploration. Sound better on the log.",
    "{a}: Rations again.  ||  {b}: Rations forever. Welcome aboard.",
    "{a}: What's the emergency plan?  ||  {b}: Panic loudly and hope Cmdr's listening.",
    "{a}: Cmdr's aim was better this week.  ||  {b}: Cmdr paid the wage bill this week. Related?",
    "{a}: You believe in luck, {b}?  ||  {b}: I believe in trajectory. Same thing, less superstition.",
    "{a}: Cmdr's morale meeting is at 0800.  ||  {b}: The morale meeting IS the meeting. That's the whole show.",
    "{a}: {b}, why do you keep the reactor room warm?  ||  {b}: Because the mess is cold and Cmdr's colder.",
    "{a}: You count the bounties?  ||  {b}: I count the survivors. Cheaper math.",
    "{a}: Ever wonder if the {threat} keep score too?  ||  {b}: Every scar on this hull says yes.",
    "{a}: Cmdr called a course change mid-fight.  ||  {b}: Bold. Wrong, probably. But bold.",
    "{a}: The rations menu changed.  ||  {b}: No it didn't. You just read the label wrong.",
    "{a}: We're logged as friend-of-lane at three colonies now.  ||  {b}: Four. You forgot the one in {sector}.",
    "{a}: New engineer says the reactor's fine.  ||  {b}: New engineers always say that. Until it isn't.",
    "{a}: If I retire, I'm buying a hab in {sector}.  ||  {b}: If you retire, I owe Cmdr five creds.",
    "{a}: Cmdr's log entries get shorter every week.  ||  {b}: That's how you know it's going well. Or badly. One of those.",
    "{a}: Ever miss dirtside, {b}?  ||  {b}: Only the gravity. And the sky. And the coffee. Otherwise no.",
    "{a}: Guild recruiter tried to poach me at the last dock.  ||  {b}: What'd you say?  ||  {a}: I said the coupler needs me.",
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
  "Options ▸ Audio ▸ Radio picks in-game music, including your own stream URL.",
  "Cargo full? Dock and sell before you mine another rock.",
  "Save often. Permadeath is opt-in for a reason.",
];

// Species catalog. Each entry has a passive (applied when the *player's*
// species matches) and a role affinity (a *crew member* of this species
// gets a small extra boost when serving in that role). Every species must
// have some upside and some drawback — no strict winners.
//
// Player passives are woven into the effective*() helpers, and hull /
// shield / cargo multipliers apply once at makePlayer(). Crew affinity
// stacks multiplicatively with the base role perk in the same helpers
// (see crewRoleMul() below).
const SPECIES = [
  "Human", "Android", "Reptilian", "Aquilan", "Drift-born",
  "Sylph", "Voidkin", "Chorus",
] as const;
type SpeciesName = typeof SPECIES[number];

interface SpeciesInfo {
  bonus: string;
  drawback: string;
  // Player passives (all optional; default 1.0 / 0):
  radarBonus?: number;         // flat +u to radar range
  cooldownMul?: number;        // weapon cooldown multiplier (<1 = faster)
  topSpeedMul?: number;        // top-speed multiplier
  fuelMul?: number;            // fuel-burn multiplier (<1 = less)
  sellMul?: number;            // extra sell-price mult (stacks on merchant)
  buyMul?: number;             // extra buy-price mult (stacks on merchant)
  hullMul?: number;            // initial hullMax scale
  shieldMul?: number;          // initial shieldMax scale
  cargoMul?: number;           // initial cargoMax scale
  xpMul?: number;              // XP-gain multiplier
  affinity?: CrewRole;         // role this species is naturally good at
  // Ship-hull unlocks (see SHIP_HULLS below).
  hullUnlocks?: string[];
}

const SPECIES_INFO: Record<SpeciesName, SpeciesInfo> = {
  Human:       { bonus: "Adaptable — +3% sell / -3% buy prices",       drawback: "No standout strength",
                 sellMul: 1.03, buyMul: 0.97, affinity: "merchant", hullUnlocks: ["explorer"] },
  Android:     { bonus: "Efficient reactor — -15% fuel burn",           drawback: "-10% hull max",
                 fuelMul: 0.85, hullMul: 0.90, affinity: "engineer", hullUnlocks: ["nomad"] },
  Reptilian:   { bonus: "Cold-blooded gunnery — -10% weapon cooldown",  drawback: "-10% shield max",
                 cooldownMul: 0.90, shieldMul: 0.90, affinity: "gunner", hullUnlocks: ["warhawk"] },
  Aquilan:     { bonus: "Sharp senses — +250u radar range",             drawback: "+5% fuel burn",
                 radarBonus: 250, fuelMul: 1.05, affinity: "pilot", hullUnlocks: ["skyeye"] },
  "Drift-born":{ bonus: "Void-native — +10% XP earned",                 drawback: "-5% top speed (fragile bones)",
                 xpMul: 1.10, topSpeedMul: 0.95, affinity: "merchant", hullUnlocks: ["driftbarge"] },
  Sylph:       { bonus: "Lightframe — +8% top speed, +200u radar",      drawback: "-15% hull max",
                 topSpeedMul: 1.08, radarBonus: 200, hullMul: 0.85, affinity: "pilot", hullUnlocks: ["skyeye"] },
  Voidkin:     { bonus: "Radiation-tolerant — +10% shield max",         drawback: "-10% cargo capacity",
                 shieldMul: 1.10, cargoMul: 0.90, affinity: "engineer", hullUnlocks: ["nomad"] },
  Chorus:      { bonus: "Hive-minded — +8% XP, faster crew perks",      drawback: "-5% top speed",
                 xpMul: 1.08, topSpeedMul: 0.95, affinity: "merchant", hullUnlocks: ["explorer"] },
};

function speciesOf(name: string | undefined): SpeciesInfo {
  return SPECIES_INFO[(name as SpeciesName)] ?? SPECIES_INFO.Human;
}

// Ship hull catalog. Add entries to expose new hulls to character creation.
// crewSlots is the base berth count; the "Crew Quarters" module still adds
// +1 on top. Every hull now supports up to 2 additional berths beyond the
// old baseline so larger crews are actually assemblable.
//
// unlockSpecies:  hull only appears in ship-create if the player's species
//                 is listed (or the list is undefined = always available).
// unlockPriorSave: hull requires at least one prior save in localStorage
//                 (a "veteran" hull unlocked after your first commander).
const SHIP_HULLS: Array<{
  id: string; name: string; hull: number; shield: number;
  cargo: number; speed: number; crewSlots: number;
  unlockSpecies?: SpeciesName[]; unlockPriorSave?: boolean;
  blurb?: string;
}> = [
  { id: "scout",   name: "Sparrow Scout",       hull: 60,  shield: 40, cargo: 12, speed: 90,  crewSlots: 3 },
  { id: "trader",  name: "Mule Freighter",      hull: 110, shield: 60, cargo: 64, speed: 55,  crewSlots: 6 },
  { id: "fighter", name: "Wasp Interceptor",    hull: 80,  shield: 90, cargo: 8,  speed: 110, crewSlots: 4 },
  { id: "miner",   name: "Pickaxe Industrial",  hull: 130, shield: 50, cargo: 40, speed: 50,  crewSlots: 5 },
  // Species-locked hulls.
  { id: "warhawk",   name: "Warhawk Gunship",     hull: 120, shield: 110, cargo: 14, speed: 100, crewSlots: 4,
    unlockSpecies: ["Reptilian"], blurb: "Reptilian gunnery frame" },
  { id: "skyeye",    name: "Skyeye Recon",        hull: 70,  shield: 55,  cargo: 18, speed: 120, crewSlots: 3,
    unlockSpecies: ["Aquilan", "Sylph"], blurb: "long-range recon hull" },
  { id: "nomad",     name: "Nomad Cell-Ship",     hull: 140, shield: 70,  cargo: 30, speed: 65,  crewSlots: 5,
    unlockSpecies: ["Android", "Voidkin"], blurb: "self-repairing cell-ship" },
  { id: "driftbarge",name: "Drift Barge",         hull: 160, shield: 55,  cargo: 90, speed: 45,  crewSlots: 6,
    unlockSpecies: ["Drift-born"], blurb: "clan hauler" },
  { id: "explorer",  name: "Wayfarer Explorer",   hull: 95,  shield: 70,  cargo: 26, speed: 85,  crewSlots: 5,
    unlockSpecies: ["Human", "Chorus"], blurb: "balanced explorer" },
  // Veteran hulls — require at least one prior save on this device.
  { id: "veteran",   name: "Veteran Corvette",    hull: 130, shield: 100, cargo: 20, speed: 95,  crewSlots: 5,
    unlockPriorSave: true, blurb: "unlocked after your first commander" },
  { id: "phoenix",   name: "Phoenix Prototype",   hull: 110, shield: 90,  cargo: 22, speed: 105, crewSlots: 5,
    unlockPriorSave: true, blurb: "veteran skunkworks" },
];

// Prior-save check for veteran hull unlocks. Cheap enough to call per frame
// in the ship-create screen (localStorage.length is a plain int).
function hasPriorSave(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SAVE_PREFIX)) return true;
    }
  } catch { /* localStorage blocked — treat as no priors */ }
  return false;
}

function unlockedShipHulls(species: string): typeof SHIP_HULLS {
  const prior = hasPriorSave();
  return SHIP_HULLS.filter((h) => {
    if (h.unlockPriorSave && !prior) return false;
    if (h.unlockSpecies && !h.unlockSpecies.includes(species as SpeciesName)) return false;
    return true;
  });
}

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
  // Named pirate captain flag. Bosses have +50% hull, a distinct title, and
  // drop bonus credits/XP on kill. 5% roll on pirate spawn (see spawnNear).
  boss?: boolean;
  // Last time this entity was counted as an alien encounter for the player
  // (performance.now()/1000). Throttles xeno-encounter counter increments so
  // one long fly-by doesn't spam the counter.
  _encAt?: number;
  // Non-hostile ship out of fuel. Sits still and waits for a Space Patrol
  // tractor tow to the nearest non-hostile station. Cleared on delivery.
  stranded?: boolean;
  // While a Patrol is towing this stranded ship, its id is stored here.
  towById?: number;
  // Colony flag: a small subset of planets are inhabited. Landing on one
  // opens a stripped station-style market (ore/fuel only). Untouched by
  // combat AI — colonies stay "nature" faction and non-hostile.
  populated?: boolean;
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
  // Optional dedicated Gunner weapon. When set, updateGunner() fires this
  // weapon instead of the pilot's. Purchased at the station's "Gunner Bay"
  // page. Undefined on legacy saves — the gunner falls back to the pilot
  // weapon in that case.
  gunnerWeaponId?: string;
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
  wage: number;               // flat credits paid to this crewmember every dock
  nextBarkAt: number;         // throttle idle barks
}

// Multi-role crew. Roles: "gunner" (auto-fire/mine), "pilot" (autopilot to
// current target), "engineer" (regen hull/shield + fuel efficiency),
// "merchant" (better market spreads).
type CrewRole = "gunner" | "pilot" | "engineer" | "merchant" | "navigator" | "quartermaster" | "recruiter" | "tactical";
interface CrewMember {
  role: CrewRole;
  name: string;
  species: string;
  gender: string;
  enabled: boolean;
  hiredAt: number;
  nextBarkAt: number;
  cooldown?: number;    // gunner/tactical auto-fire cadence
  autopilot?: boolean;  // pilot: toggled by O key
  wage?: number;        // flat credits paid every dock — see tryDock()
  // 0.5.5 — morale drifts down on wage shortfalls, up on full pay. Loaded
  // saves default to 100. Recruiter halves the decay rate. A future pass
  // ties morale <30 to reduced perks / walk-outs; today it just changes the
  // Comms line the crew posts after payroll.
  morale?: number;      // 0..100, defaults to 100
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
  // IDs of alien ruin planets already scanned — prevents double-payout on
  // subsequent flybys. See universe generation for ruin spawn logic.
  scannedRuins?: number[];
  // Lifetime count of close-approach encounters with alien-family entities
  // (UFOs, thargoids, alien swarms, motherships). Once it crosses the
  // XENO_HIRE_THRESHOLD (5), the station Crew page unlocks Xeno hires.
  alienEncounters?: number;
}
const XENO_HIRE_THRESHOLD = 5;

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
// `channel` groups the line for the Comms tab filter:
//   "crew"     = on-ship chatter between the player's own crew,
//   "external" = every other ship, station, planet, alien, distress signal,
//   "system"   = ship-computer / sensors / radio-station output.
interface ChatterLine {
  t: number;                  // performance.now() / 1000 when posted
  who: string;
  msg: string;
  color: string;
  channel: "crew" | "external" | "system";
}

// Best-effort routing of a chatter line to a Comms tab based on the speaker
// label passed to pushChatter. Player-crew titles ("Gunner Mira", "Pilot Roe",
// bare "Crew") land in Crew; ship-computer voices ("Sensors", "Radio") land
// in System; everything else — NPC ships, stations, planets, distress calls,
// alien gibberish — lands in External. Kept as a pure module-level helper so
// tests can inspect it without instantiating the engine.
const CREW_SPEAKER_PREFIXES = ["Gunner ", "Pilot ", "Engineer ", "Navigator ", "Merchant ", "Quartermaster ", "Recruiter ", "Tactical "];
// Bare speaker labels that route to the "crew" channel. "Computer" is the
// ship's onboard voice — it speaks when a crew station is unfilled or when
// the ship itself needs to report a systems event.
const CREW_BARE_LABELS = new Set(["Crew", "Computer", "Ship Computer", "Gunner", "Pilot", "Engineer", "Navigator", "Merchant", "Quartermaster", "Recruiter", "Tactical"]);
function classifyChatterChannel(who: string): "crew" | "external" | "system" {
  if (CREW_BARE_LABELS.has(who) || CREW_SPEAKER_PREFIXES.some((p) => who.startsWith(p))) return "crew";
  if (who === "Sensors" || who === "Radio") return "system";
  return "external";
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
  // Alternative input schemes. "auto" enables touch on coarse-pointer devices.
  gamepad: "auto" | "on" | "off";
  gamepadDeadzone: number;               // 0..0.5
  touchControls: "auto" | "on" | "off";
  // Visual FX toggles + HUD/reticle theming (added 0.3).
  glitchFx: boolean;              // enable screen glitch on hull hits + thargoid presence
  scanlines: boolean;             // draw subtle horizontal scanlines over the canvas
  scanlineDensity?: 1 | 2 | 3;    // 0.5.6 — row skip (1=dense/every row, 2=default, 3=sparse)
  hudScheme: "green" | "amber" | "cyan" | "white" | "red";
  reticleColor: "green" | "amber" | "cyan" | "magenta" | "white" | "red";
  reticleShape: "cross" | "dot" | "brackets" | "circle" | "diamond";
  // Comms panel dimensions (0.5). commsCols is width in glyphs, commsRows
  // is number of visible feed lines. commsWrap wraps long lines instead of
  // truncating with an ellipsis.
  commsCols: number;
  commsRows: number;
  commsWrap: boolean;
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
  // Optional: persisted comms feed (last ~250 lines). Optional so older saves
  // still load; we backfill to [] on load.
  chatter?: ChatterLine[];
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
  cycleTypePrev: "{",    // cycle to previous in-range target of the current target's type
  cycleTypeNext: "}",    // cycle to next in-range target of the current target's type
  autopilot: "o",        // toggle hired Pilot's autopilot to current target
  questLog: "u",         // open the toggle-able Quest Log popup
};

// User-visible actions listed on the Options ▸ Controls ▸ Keybinds screen.
// Order here is the order shown; the id must match a key in DEFAULT_KEYBINDS.
// `mission` is intentionally omitted — it aliases `questLog` and only the
// latter is actually consumed by the input handlers.
const KEYBIND_ACTIONS: { id: string; label: string }[] = [
  { id: "throttleUp",   label: "Throttle Up" },
  { id: "throttleDown", label: "Throttle Down" },
  { id: "yawLeft",      label: "Yaw Left" },
  { id: "yawRight",     label: "Yaw Right" },
  { id: "pitchUp",      label: "Pitch Up" },
  { id: "pitchDown",    label: "Pitch Down" },
  { id: "fire",         label: "Fire" },
  { id: "mine",         label: "Mine" },
  { id: "cycleTarget",  label: "Cycle Target" },
  { id: "cycleCatPrev", label: "Prev Target Category" },
  { id: "cycleCatNext", label: "Next Target Category" },
  { id: "cycleTypePrev", label: "Prev Target (Same Type)" },
  { id: "cycleTypeNext", label: "Next Target (Same Type)" },
  { id: "dock",         label: "Dock" },
  { id: "station",      label: "Station Menu" },
  { id: "boost",        label: "Boost" },
  { id: "jettison",     label: "Jettison Cargo" },
  { id: "supercruise",  label: "Supercruise (hold)" },
  { id: "toggleGunner", label: "Toggle Gunner" },
  { id: "autopilot",    label: "Autopilot Toggle" },
  { id: "pinQuest",     label: "Pin Quest Tracker" },
  { id: "questLog",     label: "Quest Log" },
  { id: "legend",       label: "Codex / Legend" },
  { id: "pause",        label: "Pause" },
  { id: "menu",         label: "Main Menu / Back" },
];

// Human-readable label for a raw key value stored in Options.keybinds.
// Keys are stored lowercased (or " " for space, "escape" for ESC, etc.).
function keyLabel(k: string): string {
  if (k === " ") return "SPACE";
  if (k === "\b") return "BKSP";
  if (k.length === 1) return k.toUpperCase();
  return k.toUpperCase();
}


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
    gamepad: "auto",
    gamepadDeadzone: 0.18,
    touchControls: "auto",
    glitchFx: true,
    scanlines: false,
    scanlineDensity: 2,
    hudScheme: "green",
    reticleColor: "green",
    reticleShape: "cross",
    commsCols: 54,
    commsRows: 12,
    commsWrap: false,
  };
}

// =============================================================================
// 4. Universe Generation
// -----------------------------------------------------------------------------
// We seed a PRNG with the chosen world seed and scatter entities across a
// cube. Coordinates are in arbitrary units; the cockpit radar is sized to a
// fixed range so distant entities just appear faint.
// =============================================================================
const WORLD_RADIUS = 54000;

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
// Reserved for named pirate captains — grander, more menacing than a generic
// hostile "Ace" or "Reaver". Rolled at spawn on ~5% of pirates.
const PIRATE_BOSS_TITLE = ["Warlord","Blackwake","Dread","Corsair-Prime","Ironmaw","Voidbaron","Skullbrand"];
function pilotNameFor(rng: () => number, kind: EntityKind): string {
  const first = PILOT_FIRST[Math.floor(rng() * PILOT_FIRST.length)];
  const last  = PILOT_LAST[Math.floor(rng() * PILOT_LAST.length)];
  const pool  = kind === "hostile" ? PILOT_TITLE_HOSTILE
              : kind === "friendly" ? PILOT_TITLE_FRIENDLY
              : PILOT_TITLE_NEUTRAL;
  const title = pool[Math.floor(rng() * pool.length)];
  return `${title} ${first} ${last}`;
}
// Boss-captain callsign. Distinct pool so bosses read differently from
// regular named hostiles ("Warlord Vex Krev" vs "Ace Vex Mara").
function pirateBossNameFor(rng: () => number): string {
  const first = PILOT_FIRST[Math.floor(rng() * PILOT_FIRST.length)];
  const last  = PILOT_LAST[Math.floor(rng() * PILOT_LAST.length)];
  const title = PIRATE_BOSS_TITLE[Math.floor(rng() * PIRATE_BOSS_TITLE.length)];
  return `${title} ${first} ${last}`;
}

let _entityIdSeq = 1;
function nextId() { return _entityIdSeq++; }

// World scale + entity counts. Universe radius has been expanded from 9k →
// 18k → 27k. Renderer still fades anything past 5k to a colored period and
// culls past 10k, so most bodies remain distant pinpricks until you cruise
// toward them. Populations scale with volume (radius^3, ≈3.375x per 1.5x
// bump) to keep the on-screen density of stars, traffic, and rocks roughly
// constant as the play area grows.
// World scale + entity counts. Universe radius has been expanded 9k → 18k →
// 27k → 54k. Renderer still fades anything past 5k to a colored period and
// culls past 10k, so most bodies remain distant pinpricks until you cruise
// toward them. Populations scale with volume (radius^3, ≈8x per 2x bump)
// to keep the on-screen density of stars, traffic, and rocks roughly
// constant as the play area grows.
const WORLD = {
  starRadius: 0,
  planetRadius: 54000,
  asteroidRadius: 45000,
  stationRadius: 51000,
  shipRadius: 57000,
  cometRadius: 63000,
  nebulaRadius: 80000,
  beaconRadius: 54000,
  baseRadius: 57000,
  planets: 1136,
  asteroids: 14040,
  stations: 544,
  ships: 4048,
  comets: 760,
  nebulae: 1120,
  beacons: 544,
  pirateBases: 296,
};


function generateUniverse(seed: number): Entity[] {
  _entityIdSeq = 1;
  const rng = mulberry32(seed);
  const out: Entity[] = [];

  // Central star + a handful of distant scattered suns so the deep sky
  // shows a variety of stellar classes (red giants, blue supergiants, white
  // dwarves, etc — see stellarClassOf()).
  out.push({ id: nextId(), kind: "star", name: nameFrom(rng, "Sol"), pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, faction: "nature" });
  for (let i = 0; i < 376; i++) {
    out.push({ id: nextId(), kind: "star", name: nameFrom(rng, "Sun"), pos: randPos(rng, WORLD_RADIUS * 0.95), vel: { x: 0, y: 0, z: 0 }, faction: "nature" });
  }

  // Planets
  for (let i = 0; i < WORLD.planets; i++) {
    // ~12% of planets are inhabited colonies. Prefix the name with "◈" so
    // scanner labels, target panels, and chatter tags all read as inhabited
    // without needing a per-panel branch.
    const populated = rng() < 0.12;
    const baseName = nameFrom(rng, populated ? "Colony" : "P-");
    const name = populated ? `◈ ${baseName}` : baseName;
    out.push({ id: nextId(), kind: "planet", name, pos: randPos(rng, WORLD.planetRadius), vel: { x: 0, y: 0, z: 0 }, faction: "nature", populated: populated || undefined });
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
    // ~2% of non-hostile ships spawn "stranded" — dead in the water, waiting
    // for a Space Patrol tow (see tickAI). Cheap, adds emergent flavor.
    const stranded = kind !== "hostile" && rng() < 0.02;
    out.push({
      id: nextId(), kind, name: nameFrom(rng, kind === "hostile" ? "Raider" : "Ship"),
      pos: randPos(rng, WORLD.shipRadius),
      vel: stranded
        ? { x: 0, y: 0, z: 0 }
        : { x: (rng() - 0.5) * 10, y: (rng() - 0.5) * 10, z: (rng() - 0.5) * 10 },
      faction: factions.includes(fac) ? fac : "guild",
      hull: kind === "hostile" ? 50 : 40, shield: 30,
      state: stranded ? "stranded" : "wander", cooldown: 0, weaponId: "pulse",
      pilotName: named ? pilotNameFor(rng, kind) : undefined,
      stranded: stranded || undefined,
    });
  }

  // Space Patrol ("SPD"): heavily-armed friendlies that hunt pirates, defend
  // any lawful ship under attack (including retaliation against the player),
  // and tractor-tow stranded ships to the nearest non-hostile station.
  // See tickAI's "patrol" branch. Faction is `patrol` so the AI can key on it
  // without a new EntityKind (colored cyan-blue by tintFor / colorFor).
  const patrolCount = 40 + Math.floor(rng() * 24);
  for (let i = 0; i < patrolCount; i++) {
    out.push({
      id: nextId(), kind: "friendly",
      name: `SPD Patrol ${String.fromCharCode(65 + i)}-${100 + Math.floor(rng() * 900)}`,
      pos: randPos(rng, WORLD.shipRadius),
      vel: { x: (rng() - 0.5) * 6, y: (rng() - 0.5) * 6, z: (rng() - 0.5) * 6 },
      faction: "patrol",
      hull: 140, shield: 90,
      state: "patrol", cooldown: 0, weaponId: "pulse",
      pilotName: pilotNameFor(rng, "friendly"),
    });
  }

  // Derelict ships: static, silent wrecks scattered across the frontier.
  // Fly within 40u to salvage credits + ore. No AI, no weapons — just loot
  // and a bit of environmental storytelling.
  for (let i = 0; i < 328; i++) {
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
  for (let i = 0; i < 112; i++) {
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
  //
  // Cadence: one instance only. The initial dormant cooldown is 60-120
  // minutes, matching the "special event every hour or two" target. The
  // encounter itself is disruptive (~10s of no controls), so anything
  // faster than that gets annoying fast. Post-encounter reset uses the
  // same window — see the `leave` state in the tick.
  //
  // Previous bug: this loop spawned TWO thargoids with 30-120s initial
  // cooldowns, so effective time-to-first-EMP was 15-60 seconds — the
  // "why is this happening every couple minutes" report.
  out.push({
    id: nextId(), kind: "thargoid", name: "Unknown Contact",
    pos: randPos(rng, WORLD_RADIUS * 0.9),
    vel: { x: 0, y: 0, z: 0 },
    faction: "alien",
    state: "dormant",
    cooldown: 3600 + rng() * 3600, // 60-120 minutes until it *might* consider triggering
  });
  // Traversable wormhole pairs. Each pair shares a `targetId` pointing at
  // its sibling; flying within 60u teleports the player to the sibling.
  // 0.5: 5% of rifts have a Federation station orbiting one mouth; a
  // rarer subset (~30% of those) have stations at BOTH ends, useful for
  // long-haul trading loops.
  for (let i = 0; i < 56; i++) {
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
    // Stations orbiting wormhole mouths.
    const roll = rng();
    const hasStationA = roll < 0.05;
    const hasStationB = hasStationA && rng() < 0.30;
    const orbitOffset = (base: Vec3): Vec3 => ({
      x: base.x + (rng() - 0.5) * 220,
      y: base.y + (rng() - 0.5) * 100,
      z: base.z + (rng() - 0.5) * 220,
    });
    if (hasStationA) {
      out.push({
        id: nextId(), kind: "station",
        name: nameFrom(rng, "Gate ") + "-A",
        pos: orbitOffset(a.pos),
        vel: { x: 0, y: 0, z: 0 }, faction: "federation",
      });
    }
    if (hasStationB) {
      out.push({
        id: nextId(), kind: "station",
        name: nameFrom(rng, "Gate ") + "-B",
        pos: orbitOffset(b.pos),
        vel: { x: 0, y: 0, z: 0 }, faction: "federation",
      });
    }
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

  // ---- Alien ruins ------------------------------------------------------
  // 1-6 desolate ruin planets. Scanning one (fly within 200u) awards a
  // one-shot XP + credit bounty; subsequent flybys are silent. The planet
  // itself renders like an ordinary world but with a `state: "ruins"`
  // marker the render / interaction code can key off.
  const ruinCount = 1 + Math.floor(rng() * 6);
  for (let i = 0; i < ruinCount; i++) {
    out.push({
      id: nextId(), kind: "planet",
      name: nameFrom(rng, "Ruin-"),
      pos: randPos(rng, WORLD.planetRadius),
      vel: { x: 0, y: 0, z: 0 },
      faction: "alien-ruins",
      state: "ruins",
    });
  }

  // ---- UFO Mothership (1% chance per universe) --------------------------
  // A single capital-class hostile with 3-4 UFO escorts. Bounty: massive.
  if (rng() < 0.01) {
    const motherPos = randPos(rng, WORLD_RADIUS * 0.9);
    const mother: Entity = {
      id: nextId(), kind: "hostile",
      name: "UFO Mothership",
      pos: motherPos,
      vel: { x: 0, y: 0, z: 0 },
      faction: "alien-boss",
      hull: 1200, shield: 600,
      state: "attack", cooldown: 0, weaponId: "pulse",
      boss: true,
    };
    out.push(mother);
    const escorts = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < escorts; i++) {
      const off = { x: (rng() - 0.5) * 400, y: (rng() - 0.5) * 200, z: (rng() - 0.5) * 400 };
      out.push({
        id: nextId(), kind: "hostile", name: "UFO Escort",
        pos: V.add(motherPos, off),
        vel: { x: 0, y: 0, z: 0 },
        faction: "alien-boss",
        hull: 60, shield: 40,
        state: "attack", cooldown: 0, weaponId: "pulse",
      });
    }
  }

  // ---- Anomalous ("thargoid-like") homeworld (5% chance) ---------------
  // A single alien world permanently ringed by 8-12 hostile fighters.
  // These are ordinary hostiles under the `alien-swarm` faction so they
  // hunt any non-alien within engagement range using the existing AI.
  if (rng() < 0.05) {
    const homePos = randPos(rng, WORLD_RADIUS * 0.85);
    out.push({
      id: nextId(), kind: "planet",
      name: "Anomalous Homeworld",
      pos: homePos,
      vel: { x: 0, y: 0, z: 0 },
      faction: "alien-swarm",
      state: "homeworld",
    });
    const swarm = 8 + Math.floor(rng() * 5);
    for (let i = 0; i < swarm; i++) {
      const ang = (i / swarm) * Math.PI * 2;
      const r = 260 + rng() * 120;
      out.push({
        id: nextId(), kind: "hostile", name: "Anomalous Fighter",
        pos: { x: homePos.x + Math.cos(ang) * r, y: homePos.y + (rng() - 0.5) * 80, z: homePos.z + Math.sin(ang) * r },
        vel: { x: (rng() - 0.5) * 6, y: (rng() - 0.5) * 6, z: (rng() - 0.5) * 6 },
        faction: "alien-swarm",
        hull: 55, shield: 30,
        state: "attack", cooldown: 0, weaponId: "pulse",
      });
    }
  }

  // ---- Small orbital stations ------------------------------------------
  // ~25% of civilian planets get a mini-station in low orbit. Dockable
  // but only sells fuel / buys ore (see buildStationLines: `state: "orbital"`
  // collapses the menu). No modules / weapons / crew.
  const civPlanets = out.filter((e) => e.kind === "planet" && e.faction === "nature");
  for (const pl of civPlanets) {
    if (rng() > 0.25) continue;
    const fac = rng() < 0.5 ? "federation" : "guild";
    const off = { x: (rng() - 0.5) * 300, y: (rng() - 0.5) * 120, z: (rng() - 0.5) * 300 };
    out.push({
      id: nextId(), kind: "station",
      name: `${pl.name} Orbital`,
      pos: V.add(pl.pos, off),
      vel: { x: 0, y: 0, z: 0 }, faction: fac,
      hull: 300, shield: 200, state: "orbital",
    });
  }

  dispatchHook("onWorldGenerate", { seed, entities: out });
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
// 0.5.6 — AI event queue. tickAI pushes state-transition events (patrol
// starting a tow, patrol beginning to arrest the player) that Voidwake
// drains each frame so it can post keyed chatter without threading `this`
// through the module-level AI helper.
export type AiEvent =
  | { kind: "patrol_tow_start";     e: Entity; targetId: number }
  | { kind: "patrol_arrest_start";  e: Entity };
const _aiEvents: AiEvent[] = [];
export function drainAiEvents(): AiEvent[] {
  if (_aiEvents.length === 0) return [];
  const out = _aiEvents.slice();
  _aiEvents.length = 0;
  return out;
}

function tickAI(e: Entity, dt: number, player: PlayerState, ents: Entity[], rng: () => number) {
  if (e.kind === "planet" || e.kind === "star" || e.kind === "asteroid" || e.kind === "bullet" || e.kind === "loot" || e.kind === "comet" || e.kind === "nebula" || e.kind === "beacon" || e.kind === "ufo" || e.kind === "thargoid" || e.kind === "wormhole" || e.kind === "dyson" || e.kind === "derelict") return;
  // Distance gate: with the 2× universe expansion (0.5.14) there are far
  // too many active ships/bases to run every tickAI branch every frame.
  // Anything more than ~3500u from the player skips the expensive per-tick
  // scans; it still coasts on its last-set velocity so the world feels
  // alive on the map, we just don't spend cycles doing target selection
  // for entities the player will never see.
  {
    const _dx = e.pos.x - player.pos.x, _dy = e.pos.y - player.pos.y, _dz = e.pos.z - player.pos.z;
    if (_dx * _dx + _dy * _dy + _dz * _dz > 3500 * 3500) {
      e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt;
      return;
    }
  }
  // Stranded lawful ships coast in place waiting for a Patrol tow.
  if (e.stranded && e.towById == null && (e.kind === "friendly" || e.kind === "neutral")) {
    e.vel = { x: 0, y: 0, z: 0 };
    e.state = "stranded";
    return;
  }

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
  } else if (e.kind === "friendly" && e.faction === "patrol") {
    // ---- Space Patrol AI ------------------------------------------------
    // Priority 1: nearest hostile within 1500u — engage hard, fast, long range.
    // Priority 2: player marked as aggressor (any friendly/neutral within
    //             1000u has hostileUntil > now with player as implicit target)
    //             — fire on the player until the retaliation timer expires.
    // Priority 3: stranded lawful ship within 600u — engage tow: gently move
    //             both patrol and towed ship toward the nearest non-hostile
    //             station until within 220u of it, then release.
    // Priority 4: patrol randomly.
    const hostile = findEnemyShip(1500);
    if (hostile) {
      e.state = "chase";
      e.towById = undefined;
      const dir = V.norm(V.sub(hostile.pos, e.pos));
      e.vel = V.scale(dir, 42);
      e.cooldown = (e.cooldown ?? 0) - dt;
      const hd = V.len(V.sub(hostile.pos, e.pos));
      if (hd < 500 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 0.55;
        ents.push(makeBullet(e, dir));
      }
      return;
    }
    // Player aggression: any lawful ship near this patrol with an active
    // retaliation timer means the player attacked a bystander. Chase & fire.
    const aggro = ents.some((x) =>
      (x.kind === "friendly" || x.kind === "neutral") &&
      x.hostileUntil != null &&
      now < x.hostileUntil &&
      V.len(V.sub(x.pos, e.pos)) < 1000);
    if (aggro && distToPlayer < 1200) {
      if (e.state !== "arrest") _aiEvents.push({ kind: "patrol_arrest_start", e });
      e.state = "arrest";
      e.towById = undefined;
      const dir = V.norm(V.sub(player.pos, e.pos));
      e.vel = V.scale(dir, 38);
      e.cooldown = (e.cooldown ?? 0) - dt;
      if (distToPlayer < 460 && (e.cooldown ?? 0) <= 0) {
        e.cooldown = 0.6;
        ents.push(makeBullet(e, dir));
      }
      return;
    }
    // Tractor tow: adopt a stranded ship and drag it to a safe station.
    if (e.towById != null) {
      const tow = ents.find((x) => x.id === e.towById);
      if (!tow || tow.stranded !== true) {
        e.towById = undefined;
      } else {
        const dock = ents.reduce<{ s: Entity | null; d: number }>((acc, x) => {
          if (x.kind !== "station" || x.faction === "pirate") return acc;
          const d = V.len(V.sub(x.pos, tow.pos));
          return d < acc.d ? { s: x, d } : acc;
        }, { s: null, d: Infinity });
        if (dock.s) {
          const dir = V.norm(V.sub(dock.s.pos, tow.pos));
          e.vel = V.scale(dir, 20);
          // Drag the towed ship along behind the patrol.
          // Vel is applied by the integrator; also snap pos to trail the patrol
          // so the towed ship visibly follows in formation instead of drifting.
          tow.vel = V.scale(dir, 20);
          if (dock.d < 220) {
            tow.stranded = undefined;
            tow.state = "wander";
            e.towById = undefined;
            e.state = "patrol";
          }
        }
        return;
      }
    }
    const strandedNearby = ents.find((x) =>
      x.stranded === true &&
      (x.kind === "friendly" || x.kind === "neutral") &&
      x.towById == null &&
      V.len(V.sub(x.pos, e.pos)) < 600);
    if (strandedNearby) {
      strandedNearby.towById = e.id;
      e.towById = strandedNearby.id;
      e.state = "tow";
      const dir = V.norm(V.sub(strandedNearby.pos, e.pos));
      e.vel = V.scale(dir, 30);
      _aiEvents.push({ kind: "patrol_tow_start", e, targetId: strandedNearby.id });
      return;
    }
    e.state = "patrol";
    if (Math.random() < 0.01) {
      e.vel = V.scale({ x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 }, 14);
    }
    return;
  } else if (e.kind === "friendly") {
    // Defend: engage pirates within 800u (was 500u — friendly ships now
    // actively rally to nearby allies under fire, per the "rescue AI"
    // backlog item). Also engages if any other friendly within 100u is
    // being retaliated against (hostileUntil active) — flying past a
    // brawl now pulls in nearby patrols.
    let foe = findEnemyShip(800);
    if (!foe) {
      const ally = ents.find((x) =>
        x.id !== e.id &&
        (x.kind === "friendly" || x.kind === "neutral") &&
        x.hostileUntil != null &&
        now < x.hostileUntil &&
        V.len(V.sub(x.pos, e.pos)) < 100);
      if (ally) {
        // Attack the nearest hostile to the beleaguered ally, or the
        // player if they are the aggressor (retaliation vector).
        let bestD = 1500;
        let best: Entity | null = null;
        for (const t of ents) {
          if (t.kind !== "hostile" || (t.hull ?? 1) <= 0) continue;
          const d = V.len(V.sub(t.pos, ally.pos));
          if (d < bestD) { bestD = d; best = t; }
        }
        if (best) foe = best;
      }
    }
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
  // Apply species multipliers once at creation. All are clamped to reasonable
  // integers so displayed stats stay clean.
  const s = speciesOf(char.species);
  const hullMax   = Math.max(1, Math.round(hull.hull   * (s.hullMul   ?? 1)));
  const shieldMax = Math.max(0, Math.round(hull.shield * (s.shieldMul ?? 1)));
  const cargoMax  = Math.max(1, Math.round(hull.cargo  * (s.cargoMul  ?? 1)));
  return {
    char,
    ship: {
      hullId: hull.id,
      hull: hullMax, hullMax,
      shield: shieldMax, shieldMax,
      fuel: 100, fuelMax: 100,
      cargoMax,
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
  // Player-species XP multiplier (Drift-born / Chorus). Rounded to avoid
  // fractional-XP drift accumulating over long sessions.
  const mul = speciesOf(p.char.species).xpMul ?? 1;
  p.xp += Math.max(0, Math.round(n * mul));
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
    wage: 30,      // flat cr per dock; see tryDock() wage deduction
    nextBarkAt: 0,
  };
}

// ---- Station market generation -------------------------------------------
// Deterministic per station id so revisiting a station shows the same
// market. Stock variety is intentional — frontier outposts charge more
// for fuel, refineries pay better for ore, etc.
const MODULE_CATALOG = [
  { id: "cargo-expander",     name: "Cargo Expander",     price: 800,  desc: "+12 cargo capacity" },
  { id: "shield-booster",     name: "Shield Booster",     price: 1100, desc: "+25 shield max" },
  { id: "afterburner-od",     name: "Afterburner OD",     price: 650,  desc: "boost +20% (cheap)" },
  { id: "auto-loader",        name: "Auto-Loader",        price: 900,  desc: "weapon cooldown -15%" },
  { id: "loot-magnet",        name: "Loot Magnet",        price: 500,  desc: "pickup range 3x" },
  { id: "crew-quarters",      name: "Crew Quarters",      price: 1400, desc: "+1 crew slot" },
  // Sensor Array: passive radar-range boost. Stacks additively with the
  // small crew bonuses granted by an on-board Pilot / Engineer (see
  // effectiveRadarRange). Single install — dupes blocked in buyModule().
  { id: "sensor-array",       name: "Sensor Array",       price: 950,  desc: "+600u radar range" },
  // New: capacity / performance modules. Effects applied at install time
  // (hullMax/fuelMax bump) or via effective*() helpers (top speed, boost).
  { id: "engine-tune",        name: "Engine Tune",        price: 1200, desc: "+15% top speed" },
  { id: "reinforced-plating", name: "Reinforced Plating", price: 1000, desc: "+40 hull max" },
  { id: "aux-fuel-tank",      name: "Aux Fuel Tank",      price: 700,  desc: "+50 fuel max" },
  { id: "long-range-scanner", name: "Long-Range Scanner", price: 1300, desc: "+1000u radar range" },
];

function generateStationStock(stationId: number): StationStock {
  const rng = mulberry32(stationId * 9176 + 7);
  const fuelPrice = 4 + Math.floor(rng() * 5);      // 4..8
  const orePrice  = 7 + Math.floor(rng() * 8);      // 7..14
  // Each station carries 1-3 weapons and 2-5 modules from the (now larger)
  // catalog. Slightly widened so the expanded upgrade list is discoverable
  // without hopping through five stations.
  const shuffled = <T,>(arr: T[]) => arr.slice().sort(() => rng() - 0.5);
  const weapons = shuffled(WEAPONS).slice(0, 1 + Math.floor(rng() * 3))
    .map((w) => ({ id: w.id, price: Math.round((w.dmg * 40 + w.range * 0.4) * (0.8 + rng() * 0.5)) }));
  const modules = shuffled(MODULE_CATALOG).slice(0, 2 + Math.floor(rng() * 4))
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

// Effective radar range in world units. Base 1500u, +150u each for an
// on-crew Pilot (sharp eyes on the nav plot) and Engineer (better sensor
// tuning), and +600u for a Sensor Array module. Kept as a pure function
// so renderRadar's culling test and the on-screen "RADAR ####u" label
// always agree.
function effectiveRadarRange(p: PlayerState): number {
  let r = 1500;
  if (hasCrew(p, "pilot")) r += 150;
  if (hasCrew(p, "engineer")) r += 150;
  if (hasCrew(p, "navigator")) r += 400;
  if (p.ship.modules.includes("sensor-array")) r += 600;
  if (p.ship.modules.includes("long-range-scanner")) r += 1000;
  // Player-species passive: Aquilan / Sylph get an innate scope bonus.
  r += speciesOf(p.char.species).radarBonus ?? 0;
  return r;
}

// Top speed and boost multipliers after module installs. Engine Tune adds
// +15% to base ship speed; Afterburner OD adds +20% to the boost multiplier
// (i.e. 1.6x → 1.92x while holding boost). Kept in one place so the flight
// tick and the collision-speed estimate can't drift apart.
function effectiveTopSpeed(p: PlayerState): number {
  const tune = p.ship.modules.includes("engine-tune") ? 1.15 : 1.0;
  const speciesMul = speciesOf(p.char.species).topSpeedMul ?? 1;
  return p.ship.speed * tune * speciesMul;
}
function effectiveBoostMul(p: PlayerState): number {
  return p.ship.modules.includes("afterburner-od") ? 1.6 * 1.20 : 1.6;
}
// Auto-Loader trims weapon cooldown by 15%. Reptilians shave another 10%.
function effectiveCooldownMul(p: PlayerState): number {
  const modMul = p.ship.modules.includes("auto-loader") ? 0.85 : 1.0;
  const speciesMul = speciesOf(p.char.species).cooldownMul ?? 1;
  return modMul * speciesMul;
}
// Species fuel-burn multiplier applied on top of the boost/supercruise/
// engineer stack. Android burns less; Aquilan burns slightly more.
function speciesFuelMul(p: PlayerState): number {
  return speciesOf(p.char.species).fuelMul ?? 1;
}

// Merchant on-crew? Sell/buy price multipliers applied at station markets.
// Player-species passives (Human sellMul/buyMul) stack multiplicatively so
// a Human without a merchant already gets a small edge, and hiring one
// widens the spread. A merchant whose species has "merchant" affinity
// (Human / Drift-born / Chorus) squeezes an extra 3%.
function merchantSellMult(p: PlayerState): number {
  const base = hasCrew(p, "merchant") ? 1.15 : 1.0;
  const qm = hasCrew(p, "quartermaster") ? 1.05 : 1.0;
  const affinity = crewAffinityBonus(p, "merchant");
  return base * qm * (speciesOf(p.char.species).sellMul ?? 1) * (1 + affinity);
}
function merchantBuyMult(p: PlayerState): number {
  const base = hasCrew(p, "merchant") ? 0.90 : 1.0;
  const qm = hasCrew(p, "quartermaster") ? 0.95 : 1.0;
  const affinity = crewAffinityBonus(p, "merchant");
  return base * qm * (speciesOf(p.char.species).buyMul ?? 1) * (1 - affinity);
}
// Small bonus when the on-crew member of `role` is a species with an
// affinity for that role. Returns 0..0.05 range (roughly +5%).
function crewAffinityBonus(p: PlayerState, role: CrewRole): number {
  if (!hasCrew(p, role)) return 0;
  const c = role === "gunner" ? p.gunner : getCrew(p, role);
  if (!c) return 0;
  const s = speciesOf(c.species);
  return s.affinity === role ? 0.05 : 0;
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
  gunner:       { title: "Gunner",       baseFee: 300, blurb: "auto-fires on hostiles, auto-mines rocks",  color: "#fc6" },
  pilot:        { title: "Pilot",        baseFee: 450, blurb: "autopilot to current target (O)",           color: "#8cf" },
  engineer:     { title: "Engineer",     baseFee: 500, blurb: "hull regen, faster shield, -20% fuel",      color: "#7CFC00" },
  merchant:     { title: "Merchant",     baseFee: 400, blurb: "+15% ore sell, -10% station buy prices",    color: "#ffe066" },
  navigator:    { title: "Navigator",    baseFee: 420, blurb: "+400u radar range, -10% fuel burn",         color: "#a9f0ff" },
  quartermaster:{ title: "Quartermaster",baseFee: 380, blurb: "extra 5% off buys, 5% on ore sells",        color: "#e0c890" },
  recruiter:    { title: "Recruiter",    baseFee: 350, blurb: "-15% crew hire fees",                        color: "#f0a0ff" },
  tactical:     { title: "Tactical",     baseFee: 600, blurb: "+25% shield recharge (excludes Gunner)",    color: "#ff7a7a" },
};

function generateCrewMember(role: CrewRole, rng: () => number): CrewMember {
  const first = GUNNER_FIRST[Math.floor(rng() * GUNNER_FIRST.length)];
  const last  = GUNNER_LAST[Math.floor(rng() * GUNNER_LAST.length)];
  const gender = ["Female","Male","Nonbinary"][Math.floor(rng() * 3)];
  const species = SPECIES[Math.floor(rng() * SPECIES.length)];
  // Role-tuned wages: specialists cost more than clerks. Flat cr per dock.
  const wage =
    role === "tactical" ? 75 :
    role === "pilot" ? 60 :
    role === "engineer" ? 55 :
    role === "navigator" ? 50 :
    role === "quartermaster" ? 45 :
    role === "recruiter" ? 45 :
    role === "merchant" ? 40 : 40;
  return {
    role,
    name: `${first} ${last}`,
    species, gender,
    enabled: true,
    hiredAt: Date.now(),
    nextBarkAt: 0,
    cooldown: 0,
    autopilot: false,
    wage,
    morale: 100,
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

  // --- Gamepad state -------------------------------------------------------
  // Keys currently held "on our behalf" by the gamepad. On the next poll, any
  // key in this set that is no longer commanded by the pad is released — so
  // buttons/dpad/sticks feel exactly like their keyboard equivalents.
  private _gpHeld = new Set<string>();
  gamepadConnected = false;

  // --- Touch state ---------------------------------------------------------
  // A single "stick" pointer whose anchor is where the finger first touched
  // the left half of the viewport; subsequent movement drives yaw/pitch.
  touchAvailable = false;         // set once we ever see a touch pointer
  private _stickPtrId: number | null = null;
  stickAnchorX = 0;
  stickAnchorY = 0;
  stickCurX = 0;
  stickCurY = 0;
  stickActive = false;
  // A separate throttle "slider" pointer (upper-left column) — drag up/down to
  // set throttle 0..1 directly.
  private _throttlePtrId: number | null = null;
  throttleActive = false;
  throttleValue = -1;             // -1 = untouched (do not override throttle)
  // Buttons registered by the renderer each frame; touched here.
  buttonRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private _btnPtrIds = new Map<number, string>();   // pointerId → button id
  private _touchHeld = new Set<string>();

  // --- Menu touch/swipe state ---------------------------------------------
  // When the game is on a list-style menu screen, touch is repurposed:
  //   • tap on an item     → select + confirm (ENTER)
  //   • swipe right (→)    → forward / confirm (ENTER)
  //   • swipe left  (←)    → back (ESCAPE)
  // Renderers publish `menuItemRects` each frame; the game reads
  // `menuTapIndex` from menuNav() and applies it to menuCursor.
  menuActive = false;
  menuItemRects: { index: number; x: number; y: number; w: number; h: number }[] = [];
  menuTapIndex = -1;
  private _menuPtrId: number | null = null;
  private _menuStart = { x: 0, y: 0, t: 0, idx: -1 };

  attach(el: HTMLElement, signal?: AbortSignal) {
    const opts = signal ? { signal } : undefined;
    el.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      // Case-preserving text capture for name fields etc.
      if (e.key === "Backspace") this.textBuffer.push("\b");
      else if (e.key.length === 1) this.textBuffer.push(e.key);
      if (["arrowup", "arrowdown", " ", "tab", "pageup", "pagedown"].includes(k)) e.preventDefault();
    }, opts);
    el.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()), opts);
    el.addEventListener("blur", () => {
      this.keys.clear(); this.mouseInside = false;
      this._gpHeld.clear(); this._touchHeld.clear();
      this._stickPtrId = null; this.stickActive = false;
      this._throttlePtrId = null; this.throttleActive = false; this.throttleValue = -1;
      this._btnPtrIds.clear();
    }, opts);
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

    // --- Pointer / touch ---------------------------------------------------
    // We route by pointerType so mouse users keep the existing mouse-steer
    // path unchanged. Touch is treated as a set of virtual gamepad zones
    // published by the renderer via `buttonRects` each frame.
    const localXY = (e: PointerEvent) => {
      const r = (el as HTMLCanvasElement).getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };
    const hitButton = (x: number, y: number): string | null => {
      for (const b of this.buttonRects) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
      }
      return null;
    };
    const hitMenuItem = (x: number, y: number): number => {
      for (const m of this.menuItemRects) {
        if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return m.index;
      }
      return -1;
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      this.touchAvailable = true;
      const { x, y, w, h } = localXY(e);
      try { (el as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      // Menu screens: capture the whole gesture (tap or horizontal swipe) —
      // do not start the flight stick or throttle strip.
      if (this.menuActive && this._menuPtrId == null) {
        this._menuPtrId = e.pointerId;
        this._menuStart = { x, y, t: performance.now(), idx: hitMenuItem(x, y) };
        e.preventDefault();
        return;
      }
      // Priority: buttons first (small explicit zones), then throttle slider,
      // then stick (large left-half fallback).
      const btn = hitButton(x, y);
      if (btn) {
        this._btnPtrIds.set(e.pointerId, btn);
        if (!this._touchHeld.has(btn)) this.pressed.add(btn);
        this._touchHeld.add(btn);
        e.preventDefault();
        return;
      }
      // Throttle strip: leftmost 8% of width, middle 60% of height.
      const inThrottle = x < w * 0.08 && y > h * 0.15 && y < h * 0.85;
      if (inThrottle && this._throttlePtrId == null) {
        this._throttlePtrId = e.pointerId;
        this.throttleActive = true;
        this.throttleValue = 1 - (y - h * 0.15) / (h * 0.7);
        e.preventDefault();
        return;
      }
      // Otherwise, use left half of screen for the flight stick.
      if (x < w * 0.5 && this._stickPtrId == null) {
        this._stickPtrId = e.pointerId;
        this.stickAnchorX = x; this.stickAnchorY = y;
        this.stickCurX = x; this.stickCurY = y;
        this.stickActive = true;
        e.preventDefault();
      }
    }, opts);
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const { x, y, w, h } = localXY(e);
      if (e.pointerId === this._stickPtrId) {
        this.stickCurX = x; this.stickCurY = y;
        e.preventDefault();
      } else if (e.pointerId === this._throttlePtrId) {
        this.throttleValue = Math.max(0, Math.min(1, 1 - (y - h * 0.15) / (h * 0.7)));
        e.preventDefault();
      } else if (e.pointerId === this._menuPtrId) {
        // Track only — decision is made on pointerup.
        e.preventDefault();
      }
    }, opts);
    const endPointer = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      if (e.pointerId === this._menuPtrId) {
        const { x, y } = localXY(e);
        const s = this._menuStart;
        const dx = x - s.x, dy = y - s.y;
        const adx = Math.abs(dx), ady = Math.abs(dy);
        const dt = performance.now() - s.t;
        // Horizontal swipe: forward (→) = ENTER, back (←) = ESCAPE.
        // Requires ≥ 80px of horizontal travel, clearly dominant over vertical
        // (2×), and completed within 600ms — otherwise treat as a tap.
        if (adx >= 80 && adx > ady * 2 && dt < 600) {
          this.pressed.add(dx > 0 ? "enter" : "escape");
        } else {
          // Tap: use the pointerup position against the current rects (fresh
          // as of the last render). Fall back to the pointerdown hit-test if
          // the finger drifted off the row. Generous 40px slop.
          const upIdx = hitMenuItem(x, y);
          const idx = upIdx >= 0 ? upIdx : s.idx;
          if (idx >= 0 && Math.hypot(dx, dy) < 40) this.menuTapIndex = idx;
        }
        this._menuPtrId = null;
        return;
      }
      if (e.pointerId === this._stickPtrId) {
        this._stickPtrId = null; this.stickActive = false;
      }
      if (e.pointerId === this._throttlePtrId) {
        this._throttlePtrId = null; this.throttleActive = false; this.throttleValue = -1;
      }
      const btn = this._btnPtrIds.get(e.pointerId);
      if (btn) {
        this._btnPtrIds.delete(e.pointerId);
        // Only release if no other pointer is holding the same button.
        const stillHeld = [...this._btnPtrIds.values()].includes(btn);
        if (!stillHeld) { this._touchHeld.delete(btn); }
      }
    };
    el.addEventListener("pointerup", endPointer, opts);
    el.addEventListener("pointercancel", endPointer, opts);
    el.addEventListener("lostpointercapture", endPointer, opts);
    // Suppress the default touch scroll/zoom on the canvas so drags don't
    // fight the browser's pan-to-refresh or pinch handlers.
    el.addEventListener("touchstart", (e) => { e.preventDefault(); }, { ...(opts ?? {}), passive: false } as AddEventListenerOptions);
    el.addEventListener("touchmove",  (e) => { e.preventDefault(); }, { ...(opts ?? {}), passive: false } as AddEventListenerOptions);
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
    // Persistent held sets (_gpHeld, _touchHeld) survive across frames.
    // buttonRects and menuItemRects are rebuilt every render — but we do NOT
    // clear them here. Touch pointerdown events fire between frames, and if
    // the rects were empty during that gap the hit-test would miss and taps
    // would silently drop. The renderers reset their own rect list on entry.
  }

  // Synthesize a "key held" from a controller/touch source. Idempotent:
  // safe to call every frame; only emits a pressed edge on rising transitions.
  private _synthDown(k: string, held: Set<string>) {
    if (!held.has(k)) this.pressed.add(k);
    held.add(k);
    this.keys.add(k);
  }
  private _synthUp(k: string, held: Set<string>) {
    if (held.has(k)) {
      held.delete(k);
      this.keys.delete(k);
    }
  }
  // Poll standard-mapped gamepads and translate to key presses matching the
  // user's keybinds. Called once per frame from the engine loop before update.
  // dpad + sticks also emit arrow keys / enter for menu navigation.
  pollGamepad(kb: Record<string, string>, deadzone: number, enabled: boolean) {
    if (!enabled || typeof navigator === "undefined" || !navigator.getGamepads) {
      // Release any keys we were holding.
      for (const k of this._gpHeld) this.keys.delete(k);
      this._gpHeld.clear();
      this.gamepadConnected = false;
      return;
    }
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const p of pads) { if (p && p.connected && p.mapping === "standard") { pad = p; break; } }
    if (!pad) {
      for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    }
    this.gamepadConnected = !!pad;
    // Compute this frame's desired held-set.
    const want = new Set<string>();
    const pressBtn = (i: number, key: string) => { if (pad!.buttons[i]?.pressed) want.add(key); };
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const dz = deadzone;
      if (ax < -dz) { want.add(kb.yawLeft); want.add("arrowleft"); }
      if (ax >  dz) { want.add(kb.yawRight); want.add("arrowright"); }
      if (ay < -dz) { want.add(kb.pitchUp); want.add("arrowup"); }
      if (ay >  dz) { want.add(kb.pitchDown); want.add("arrowdown"); }
      // Right stick Y nudges throttle (up = faster, down = slower).
      const rY = pad.axes[3] ?? 0;
      if (rY < -dz) want.add(kb.throttleUp);
      if (rY >  dz) want.add(kb.throttleDown);
      // Face buttons (standard mapping: 0=A/Cross, 1=B/Circle, 2=X/Square, 3=Y/Triangle)
      pressBtn(0, kb.fire); if (pad.buttons[0]?.pressed) want.add("enter");
      pressBtn(1, kb.menu);
      pressBtn(2, kb.mine);
      pressBtn(3, kb.dock);
      // Shoulders / triggers
      pressBtn(4, kb.cycleCatPrev);
      pressBtn(5, kb.cycleCatNext);
      pressBtn(6, kb.boost);        // LT — afterburner
      pressBtn(7, kb.fire);         // RT — fire
      // Select/Start
      pressBtn(8, kb.legend);       // Back/Select → Codex
      pressBtn(9, kb.pause);        // Start → pause
      pressBtn(10, kb.toggleGunner); // L3
      pressBtn(11, kb.autopilot);    // R3
      // Dpad
      if (pad.buttons[12]?.pressed) { want.add(kb.throttleUp); want.add("arrowup"); }
      if (pad.buttons[13]?.pressed) { want.add(kb.throttleDown); want.add("arrowdown"); }
      if (pad.buttons[14]?.pressed) { want.add(kb.cycleCatPrev); want.add("arrowleft"); }
      if (pad.buttons[15]?.pressed) { want.add(kb.cycleCatNext); want.add("arrowright"); }
    }
    // Diff against _gpHeld to emit rising/falling edges.
    for (const k of want) this._synthDown(k, this._gpHeld);
    for (const k of [...this._gpHeld]) if (!want.has(k)) this._synthUp(k, this._gpHeld);
  }

  // Translate the virtual touch stick + throttle slider + touch buttons into
  // synthetic held keys. Called once per frame from the engine loop.
  pollTouch(kb: Record<string, string>, enabled: boolean): { yaw: number; pitch: number; throttle: number } {
    if (!enabled) {
      for (const k of this._touchHeld) this.keys.delete(k);
      this._touchHeld.clear();
      return { yaw: 0, pitch: 0, throttle: -1 };
    }
    // Buttons are already recorded on pointerdown into _touchHeld/pressed.
    // Re-assert the "keys" bit so they read as held while the finger stays down.
    for (const k of this._touchHeld) this.keys.add(k);
    // Compute analog stick output from anchor offset (in px), clamped.
    let yaw = 0, pitch = 0;
    if (this.stickActive) {
      const dx = this.stickCurX - this.stickAnchorX;
      const dy = this.stickCurY - this.stickAnchorY;
      const R = 80; // px full-deflection radius
      yaw = Math.max(-1, Math.min(1, dx / R));
      pitch = Math.max(-1, Math.min(1, dy / R));
      // Also feed arrow keys so touch works in menus.
      const dz = 0.35;
      if (yaw < -dz) this.pressed.add("arrowleft");
      if (yaw >  dz) this.pressed.add("arrowright");
      if (pitch < -dz) this.pressed.add("arrowup");
      if (pitch >  dz) this.pressed.add("arrowdown");
    }
    return { yaw, pitch, throttle: this.throttleActive ? this.throttleValue : -1 };
    // Note: kb param reserved for future rebindable touch mapping.
    void kb;
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
  | "howto"
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
// Wreckage / debris palette: scorched hull plating instead of warm rock.
// Rendered when an "asteroid" entity is actually a wreck (name === "debris"
// or "wreckage"), which happens after a ship or station is destroyed.
const DEBRIS_FILLS  = ["#6a6a72", "#8a8890", "#4c4a52", "#a89880"];
const DEBRIS_TEX    = ["╱", "╲", "¦", "·", "=", "/", "\\", "|"];
function isWreck(e: Entity): boolean {
  return e.kind === "asteroid" && (e.name === "debris" || e.name === "wreckage");
}

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
// Stellar class for a star entity. Called from several hot paths per frame
// (culling, halo tinting, corona scoop math), so results are memoized per
// entity in a WeakMap — the class is deterministic from `e.id`, so caching
// on the object reference is safe and avoids re-running the weighted roll.
const _stellarClassCache = new WeakMap<Entity, StellarClass>();
function stellarClassOf(e: Entity): StellarClass {
  const cached = _stellarClassCache.get(e);
  if (cached) return cached;
  const h = hash01(e.id * 977 + 31);
  let r = h * _stellarWSum;
  let out: StellarClass = STELLAR_CLASSES[4]; // G-class fallback
  for (let i = 0; i < STELLAR_CLASSES.length; i++) {
    r -= STELLAR_WEIGHTS[i];
    if (r <= 0) { out = STELLAR_CLASSES[i]; break; }
  }
  _stellarClassCache.set(e, out);
  return out;
}
// Per-star effective size multiplier: the class-level baseline modulated
// by a deterministic per-star jitter (roughly 0.55x–1.75x) so no two stars
// of the same class look identical — a few Sol-analog G-classes are truly
// enormous, others are barely-lit dwarfs. Consumed by the renderer world
// radius and the corona scoop/burn ring math so they stay consistent.
const _starSizeCache = new WeakMap<Entity, number>();
function starSizeMul(e: Entity): number {
  const cached = _starSizeCache.get(e);
  if (cached !== undefined) return cached;
  const base = stellarClassOf(e).sizeMul;
  const jitter = 0.55 + hash01(e.id * 613 + 91) * 1.20;
  const out = base * jitter;
  _starSizeCache.set(e, out);
  return out;
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
      if (isWreck(e)) {
        const i = Math.floor(h * DEBRIS_FILLS.length);
        return { fill: DEBRIS_FILLS[i], edge: "#2a2a30" };
      }
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
    e.kind === "asteroid"? (isWreck(e) ? DEBRIS_TEX : ASTEROID_TEX) :
    null;
  if (!palette) return fillCh;
  const h = hash01(e.id * 131 + gx * 1009 + gy * 7919);
  // Debris sparks: a small % of cells flicker to a bright '*' or '+' per
  // second, sold as burning parts of the ship. Deterministic per-cell
  // seed + a coarse time bucket keeps it cheap and stable.
  if (e.kind === "asteroid" && isWreck(e)) {
    const t = Math.floor((typeof performance !== "undefined" ? performance.now() : 0) / 140);
    const sparkH = hash01(e.id * 977 + gx * 613 + gy * 419 + t * 7);
    if (sparkH < 0.06) return sparkH < 0.03 ? "*" : "+";
  }
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
  // SPD Patrol cruisers — deliberately blockier / more armored-looking than a
  // civilian friendly so the player can eyeball law enforcement at a glance.
  patrol: [
    ["[^]", "|#|", "[v]"],
    ["/T\\", "[@]", "\\T/"],
    [".T.", "{#}", "'T'"],
    ["|^|", "[X]", "|v|"],
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
  // Options screen has been split into a small hub with three subsections
  // (Gameplay / Audio / Controls) plus a Keybinds sub-page under Controls.
  // "root" is the hub itself.
  optionsSection: "root" | "gameplay" | "audio" | "controls" | "keybinds" | "scripting" | "chat" = "root";
  // Lua scripting (0.5.5): source is edited via a browser prompt from the
  // Options ▸ Scripting page and persisted in localStorage. The runtime
  // (LuaHost) is created lazily on the first enable so users who never open
  // that submenu don't pay the ~200KB fengari-web parse cost.
  private luaHost: import("./lua-host").LuaHost | null = null;
  private scriptSource = "";
  private scriptEnabled = false;
  private scriptStatus = "";       // last load result summary shown in the menu
  // While non-null, the Keybinds screen is capturing the next pressed key
  // as the new binding for this action id (a key in Options.keybinds).
  private _rebindAction: string | null = null;
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
  // performance.now()/1000 of the last "reactor cold" fuel-zero chatter so we
  // don't spam it every frame while fuel is pinned at 0 (also filters the
  // once-per-toggle edge when Cheat Mode is flicked on/off right at empty).
  private _lastFuelWarnAt = 0;
  // Undock clamp cooldown — after leaving a station we suppress `tryDock`
  // for a short beat so an accidental double-tap of F doesn't immediately
  // re-open the station screen.
  private _dockCooldownUntil = 0;
  // Autosave bookkeeping. We rotate into the dedicated "autosave" slot every
  // `autosaveInterval` seconds while in flight.
  autosaveTimer = 0;
  autosaveInterval = 120; // seconds

  // Per-station market state, lazily generated on first dock and cached
  // for the rest of the session. Keyed by station entity id.
  stationStocks = new Map<number, StationStock>();
  // Comms / chatter feed. See pushChatter / renderChatter. Cap ~250 so the
  // top-left Comms panel can scroll back through recent traffic.
  chatter: ChatterLine[] = [];
  // Active tab in the top-left Comms panel. Cycled with '\' (see updatePlaying).
  chatterTab: "all" | "crew" | "external" | "system" = "all";
  // Comms panel rect in cell coords, updated each render. Used by the wheel
  // handler to route mouse-wheel scroll to the panel when the cursor is
  // over it (falls through to throttle otherwise).
  _commsRect: { x: number; y: number; w: number; h: number } | null = null;
  // Whether the comms panel is collapsed to a single "Show Comms" button.
  // Transient (per-session); toggled via the [Hide]/[Show] header button.
  commsHidden = false;
  // Scroll offset into the filtered feed. 0 = pinned to newest.
  chatterScroll = 0;
  // Cursor in the multi-page station screen.
  stationPage: "main" | "market" | "weapons" | "gunner-bay" | "modules" | "crew" = "main";
  // Throttle for ambient world chatter (hostile taunts, station beacons, etc).
  private _nextAmbientChatterAt = 0;
  // Throttles for periodic respawning from stations / planets / pirate bases.
  private _nextCivSpawnAt = 25;
  private _nextPirateSpawnAt = 18;
  private _nextPlanetSpawnAt = 60;
  // Rare phenomena (UFO / Thargoid / wormhole / alien comms) scheduler state.
  _empUntil = 0;                    // performance.now()/1000 while Thargoid field is active
  _wormholeCooldown = 0;            // seconds; blocks re-entry after a jump
  // Rare surprises are meant to be genuinely rare — first hit ~30 min into a
  // session, then once every 1–2 hours of play. Alien static is more ambient
  // (a few minutes between whispers, faster inside nebulae / EMP fields).
  _nextRareAt = 1800;               // seconds until next surprise spawn near player
  _nextAlienAt = 60;                // seconds until next alien transmission
  _sessionTime = 0;                 // seconds since engine start (for HUD readouts)
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
  // Sparse colorful gas puffs — small drifting cloud dots in world space.
  private gasClouds: { x: number; y: number; z: number; c: string }[] = [];
  // Direction samples along the galactic disk (unit vectors, fixed in world
  // space). Rendered at infinity — only the camera rotation applies. Lazily
  // built on first frame.
  private _galaxyDirs: { x: number; y: number; z: number; b: number }[] = [];
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
  // How-To-Play overlay: same return-screen pattern as Codex.
  private _howtoReturn: Screen = "title";
  private _howtoPage = 0;
  // Fuel-scoop chatter throttle. When set, we're actively scooping a star;
  // reused by the HUD to render a "SCOOPING" badge.
  private _scoopingUntil = 0;
  // Screen-shake state: renderer offsets the grid draw pass by up to this
  // many pixels when performance.now()/1000 < _shakeUntil.
  private _shakeUntil = 0;
  private _shakeMag = 0;

  // --- Alternative input state -------------------------------------------
  // Populated each frame by update() from the gamepad + touch pollers. Analog
  // stick output is applied in updatePlaying so it can coexist with keyboard.
  private _touchStick: { yaw: number; pitch: number; throttle: number } = { yaw: 0, pitch: 0, throttle: -1 };
  // Cached "does this device have a coarse pointer" (phones, tablets, Steam
  // Deck touchscreen) so the "auto" touch mode enables itself sensibly.
  private _coarsePointer = false;
  _touchControlsActive(): boolean {
    const m = this.options.touchControls;
    if (m === "off") return false;
    if (m === "on") return true;
    return this._coarsePointer || this.input.touchAvailable;
  }



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
    try {
      const mq2 = window.matchMedia("(pointer: coarse)");
      this._coarsePointer = mq2.matches;
      mq2.addEventListener?.("change", (e) => { this._coarsePointer = e.matches; }, { signal: sig });
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
    // 0.5.5 — restore persisted Lua script + enable flag. If it was on last
    // session, boot the host now so hooks are live before New Game / Load.
    this.loadScriptSettings();
    if (this.scriptEnabled && this.scriptSource.trim()) {
      void this.reloadScript();
    }
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

  // Append a single line to the comms / chatter feed shown in the top-left
  // Comms panel. Newest line lives at index 0. Capped at 250 so long
  // sessions don't grow unbounded. `channel` is inferred from the speaker
  // label when the caller doesn't specify one so the hundreds of existing
  // pushChatter callsites stay untouched.
  pushChatter(
    who: string,
    msg: string,
    color = "#9fe",
    channel?: ChatterLine["channel"],
  ) {
    const ch = channel ?? classifyChatterChannel(who);
    this.chatter.unshift({ t: performance.now() / 1000, who, msg, color, channel: ch });
    if (this.chatter.length > 250) this.chatter.pop();
    // If the user was scrolled up, keep their view stable by advancing the
    // offset — but only within the filtered feed for the current tab so the
    // panel doesn't drift under lines they can't see.
    if (this.chatterScroll > 0 && (this.chatterTab === "all" || this.chatterTab === ch)) {
      this.chatterScroll = Math.min(this.chatterScroll + 1, 240);
    }
    dispatchHook("onChatter", { who, msg, color, channel: ch });
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
    if (!s) {
      s = generateStationStock(stationId);
      // 0.5.6 — Colony jitter. Populated planets pay noticeably more for
      // ore (colonies always need refinery feedstock), charge a small
      // premium on fuel (no atmosphere refinery), and use a colony-specific
      // rumor set. Weapons are unlisted at colonies (militia-only supply).
      const ent = this.entities.find((x) => x.id === stationId);
      if (ent && ent.kind === "planet" && ent.populated) {
        s.orePrice = Math.round(s.orePrice * 1.25);
        s.fuelPrice = Math.round(s.fuelPrice * 1.10);
        s.weapons = [];
        const colonyRumors = [
          "Colony gossip: militia recruiting anyone with a straight trigger finger.",
          "Bazaar buzz: ore buyers offering above spot for the next cycle.",
          "Dirtside chatter: a courier vanished on the outer belt run.",
          "Kids swear they saw a derelict spin past the moon last night.",
        ];
        s.rumor = colonyRumors[Math.floor((Math.abs(stationId) * 7 + 3) % colonyRumors.length)];
      }
      this.stationStocks.set(stationId, s);
    }
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
    // Alternative input polling — gamepad + touch synthesize key presses so
    // the rest of the game (menus + flight) needs no special-casing. Both
    // resolve to keyboard bindings, so remapping keys remaps controllers too.
    const gpOn = this.options.gamepad !== "off";
    this.input.pollGamepad(kb, this.options.gamepadDeadzone, gpOn);
    const touchOn = this._touchControlsActive();
    this._touchStick = this.input.pollTouch(kb, touchOn);
    this.recordFlight(`updating ${this.screen}`);
    // Global: ESC toggles main menu while playing
    if (this.input.consume(kb.menu)) {
      if (this.screen === "playing") { this.prevPlayScreen = this.screen; this.screen = "menu"; this.menuCursor = 0; }
      else if (this.screen === "options") {
        // Rebind capture uses its own ESC handler; skip so we don't leave
        // the screen mid-rebind.
        if (this._rebindAction) {
          this._rebindAction = null;
        } else if (this.optionsSection !== "root") {
          // Bounce a subsection back to the Options hub. Keybinds goes back
          // to Controls (its parent), not straight to root.
          if (this.optionsSection === "keybinds") this.optionsSection = "controls";
          else if (this.optionsSection === "chat") { this.optionsSection = "gameplay"; this.menuCursor = 13; }
          else this.optionsSection = "root";
          this.menuCursor = 0;
        } else {
          this.screen = this.player ? "playing" : "title";
        }
      }
      else if (this.screen === "menu" || this.screen === "load" || this.screen === "save" || this.screen === "quit-confirm") {
        this.screen = this.player ? "playing" : "title";
      } else if (this.screen === "station") {
        this.screen = "playing";
      } else if (this.screen === "codex") {
        this.screen = this._codexReturn;
        this.menuCursor = 0;
      } else if (this.screen === "howto") {
        this.screen = this._howtoReturn;
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
      case "howto": this.updateHowto(); break;
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
  titleItems = ["New Game", "Load Game", "How To Play", "Legend (Codex)", "Options", "Quit"];
  updateTitle() {
    this.menuNav(this.titleItems.length);
    if (this.input.consume("enter")) {
      const choice = this.titleItems[this.menuCursor];
      if (choice === "New Game") { this.clearTitleNotice(); this.screen = "create-char"; this.menuCursor = 0; }
      else if (choice === "Load Game") { this.clearTitleNotice(); this.screen = "load"; this.menuCursor = 0; }
      else if (choice === "How To Play") { this._howtoReturn = "title"; this.screen = "howto"; this.menuCursor = 0; this._howtoPage = 0; }
      else if (choice === "Legend (Codex)") { this._codexReturn = "title"; this.screen = "codex"; this.menuCursor = 0; }
      else if (choice === "Options") { this.screen = "options"; this.optionsSection = "root"; this.menuCursor = 0; }
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
      const i = SPECIES.indexOf(this.charDraft.species as SpeciesName);
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
  // Hulls available for the picker are filtered by player species and the
  // presence of any prior save (veteran hulls). Clamped when the pool
  // changes so an out-of-range cursor snaps to zero on species change.
  updateShipCreate() {
    const items = ["hull", "weapon", "Launch →"];
    this.menuNav(items.length);
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    const f = items[this.menuCursor];
    const hulls = unlockedShipHulls(this.charDraft.species);
    if (this.hullDraftIdx >= hulls.length) this.hullDraftIdx = 0;
    if (f === "hull") {
      if (left) this.hullDraftIdx = (this.hullDraftIdx - 1 + hulls.length) % hulls.length;
      if (right) this.hullDraftIdx = (this.hullDraftIdx + 1) % hulls.length;
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
    const hulls = unlockedShipHulls(this.charDraft.species);
    const hullId = hulls[Math.min(this.hullDraftIdx, hulls.length - 1)]?.id ?? SHIP_HULLS[0].id;
    this.player = makePlayer(this.charDraft, hullId);
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
    // Cheat Mode = full god mode: keep hull/shield pinned to max every frame
    // so nothing (star scoop, ram, stray bullet, beacon trap) can ever whittle
    // us down. Damage sites are already gated on !cheat, this is belt-and-braces.
    if (this.options.cheat) {
      p.ship.hull = p.ship.hullMax;
      if (p.ship.shieldMax) p.ship.shield = p.ship.shieldMax;
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
    dispatchHook("onTick", { dt, player: p, entities: this.entities });


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
    // Yaw sign flips when the ship is inverted (|pitch| > π/2, i.e.
    // cos(pitch) < 0). Without this, "yaw left" from the pilot's seat feels
    // reversed after looping over the top because world-space yaw is measured
    // around a fixed up axis. Applies to keyboard/touch/mouse — not AI slew,
    // which already works from world-space target angles.
    const yawSign = Math.cos(p.heading.pitch) < 0 ? -1 : 1;
    if (keys.has(k.yawLeft)) { p.heading.yaw = wrapPi(p.heading.yaw - yawSign * dt * 1.2); this._disengageAutopilot("stick"); }
    if (keys.has(k.yawRight)) { p.heading.yaw = wrapPi(p.heading.yaw + yawSign * dt * 1.2); this._disengageAutopilot("stick"); }
    if (keys.has(k.pitchUp))   { p.heading.pitch = wrapPi(p.heading.pitch - dt * 1.0); this._disengageAutopilot("stick"); }
    if (keys.has(k.pitchDown)) { p.heading.pitch = wrapPi(p.heading.pitch + dt * 1.0); this._disengageAutopilot("stick"); }

    // Virtual touch stick: analog yaw/pitch scaled by same rates as keyboard.
    // Applies alongside keys so the pilot can hold "boost" on a button while
    // steering with the stick. Also drops the mouse-steer path this frame so
    // the two don't fight each other.
    const ts = this._touchStick;
    if ((ts.yaw !== 0 || ts.pitch !== 0) && !autopilotOn) {
      p.heading.yaw = wrapPi(p.heading.yaw + yawSign * ts.yaw * dt * 1.4);
      p.heading.pitch = wrapPi(p.heading.pitch + ts.pitch * dt * 1.1);
      this._disengageAutopilot("stick");
    }
    // Touch throttle slider — direct absolute value, not relative.
    if (ts.throttle >= 0 && !autopilotOn) {
      p.throttle = ts.throttle;
      this._disengageAutopilot("stick");
    }

    // Mouse wheel: routes to the Comms panel when the cursor is over it
    // (scroll the feed), otherwise adjusts throttle by ~5% per notch.
    if (this.input.wheelDelta !== 0) {
      const rect = this._commsRect;
      const gx = this.input.mouseCX / CELL_W;
      const gy = this.input.mouseCY / CELL_H;
      const overComms = !!rect && this.input.mouseInside
        && gx >= rect.x && gx < rect.x + rect.w
        && gy >= rect.y && gy < rect.y + rect.h;
      if (overComms) {
        // Wheel up (negative deltaY) = scroll toward older lines (higher scroll idx).
        const notch = this.input.wheelDelta > 0 ? -2 : 2;
        this.chatterScroll = Math.max(0, Math.min(this.chatterScroll + notch, 999));
      } else {
        const step = -this.input.wheelDelta * 0.001; // scroll up = throttle up
        p.throttle = Math.max(0, Math.min(1, p.throttle + step));
        this._disengageAutopilot("stick");
      }
    }


    // Mouse steering: cursor offset from the *viewport* center (where the
    // reticle / ship's forward vector points) pulls yaw/pitch. Historically
    // we normalized against the entire canvas, so the reticle sat left of the
    // mouse's neutral zone because the right-hand HUD panel eats ~28 cols.
    // Remapping around the viewport keeps the crosshair under the cursor.
    // Suppressed while a touch stick is active so the two don't fight.
    if (this.options.mouseSteer && this.input.mouseInside && !autopilotOn && !this.input.stickActive) {
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
      p.heading.yaw += yawSign * cax * dt * 1.4 * sens;
      p.heading.pitch = wrapPi(p.heading.pitch + cay * dt * 1.1 * sens);
    }

    // Afterburner: hold boost for +60% speed at 4x fuel cost. Disabled when dry.
    const boosting = keys.has(k.boost) && p.ship.fuel > 0;
    // Supercruise: hold for 3x speed at 3x fuel burn. Stacks with afterburner
    // but locks weapons (no fire while super-cruising) so it stays a travel tool.
    const supercruise = keys.has(k.supercruise) && p.ship.fuel > 0;
    const boostMul = (boosting ? effectiveBoostMul(p) : 1.0) * (supercruise ? 3.0 : 1.0);
    // Engineer perk: -20% fuel burn.
    const engineerMul = (hasCrew(p, "engineer") ? 0.80 : 1.0) * (hasCrew(p, "navigator") ? 0.90 : 1.0);
    const fuelMul  = (boosting ? 4.0 : 1.0) * (supercruise ? 3.0 : 1.0) * engineerMul * speciesFuelMul(p);

    // Forward direction from heading
    const fwd = headingToVec(p.heading.yaw, p.heading.pitch);

    if (p.ship.fuel > 0) {
      // Powered flight: normal thrust. Cache the current velocity so if we
      // stall out mid-frame we keep drifting instead of snapping to zero.
      const sp = effectiveTopSpeed(p) * p.throttle * boostMul;
      const thrustV = V.scale(fwd, sp);
      p.pos = V.add(p.pos, V.scale(thrustV, dt));
      p.driftVel = { x: thrustV.x, y: thrustV.y, z: thrustV.z };
      // Cheat Mode = full god mode: burn no fuel, top the tank off in case
      // something else drained it before the toggle was flipped.
      if (this.options.cheat) {
        p.ship.fuel = p.ship.fuelMax;
      } else {
        p.ship.fuel = Math.max(0, p.ship.fuel - sp * dt * 0.001 * fuelMul);
      }
      // Fuel-zero notice is throttled — without a guard the branch fires on
      // every frame that fuel is pinned at 0 (including the one-frame window
      // where Cheat Mode is toggled right as the tank drains), spamming the
      // COMMS feed.
      if (p.ship.fuel === 0) {
        const nowS = performance.now() / 1000;
        if (nowS - this._lastFuelWarnAt > 15) {
          this._lastFuelWarnAt = nowS;
          this.pushLog("⚠ FUEL EXHAUSTED — drifting on momentum. Dock to refuel.");
          this.pushChatter("Sensors", "Reactor cold. Coasting only.", "#fc6");
        }
      } else if (p.ship.fuel > 1) {
        // Re-arm so a fresh emptying after refuel prints the warning again.
        this._lastFuelWarnAt = 0;
      }
    } else {
      // Zero fuel: keep last drift velocity. Steering and throttle inputs
      // don't change trajectory — you're a bullet with your name on it.
      const dv = p.driftVel ?? { x: 0, y: 0, z: 0 };
      p.pos = V.add(p.pos, V.scale(dv, dt));
    }

    // Shield regen (suppressed while inside a nebula — applied below).
    // Engineer perk: +75% shield recharge rate.
    let shieldRegen = hasCrew(p, "engineer") ? 7.0 : 4.0;
    if (hasCrew(p, "tactical")) shieldRegen *= 1.25;
    p.ship.shield = Math.min(p.ship.shieldMax, p.ship.shield + dt * shieldRegen);
    // Engineer perk: slow hull regen while throttle is light and not on fire.
    if (hasCrew(p, "engineer") && p.throttle < 0.35 && p.ship.hull > 0 && p.ship.hull < p.ship.hullMax) {
      p.ship.hull = Math.min(p.ship.hullMax, p.ship.hull + dt * 0.6);
    }

    // --- Environment hazards: nebula drain, beacon pickup, comet wash ------
    const now = performance.now() / 1000;
    let insideNebula = false;
    for (const e of this.entities) {
      // Passive xeno-encounter counter — bumped once per entity per 3 minutes
      // of close approach. Powers the station "Hire Xeno" gate.
      if ((e.faction === "alien" || e.faction === "alien-boss" || e.faction === "alien-swarm") && (e.hull ?? 1) > 0) {
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < 500 && (!e._encAt || now - e._encAt > 180)) {
          e._encAt = now;
          const prev = p.alienEncounters ?? 0;
          p.alienEncounters = prev + 1;
          if (prev < XENO_HIRE_THRESHOLD && p.alienEncounters >= XENO_HIRE_THRESHOLD) {
            this.pushLog("⚠ Xeno-contact quota met — stations will register xeno hires.");
          }
        }
      }
      if (e.kind === "star") {
        // --- Fuel scooping: skim a star's corona at safe range for free fuel.
        // Sweet spot scales with the star's apparent size (bigger stars scoop
        // from further out). Too close = burn (nebula-style shield/hull etch).
        const sc = stellarClassOf(e);
        const szMul = starSizeMul(e);
        const scoopR = 260 * szMul;
        const burnR = 90 * szMul;
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
            this.pushChatter(hasCrew(p, "engineer") ? "Engineer" : "Computer",
              `Scooping ${sc.name} corona — refuelling.`, hasCrew(p, "engineer") ? "#fc6" : "#9effd2");
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
      } else if (e.kind === "planet" && e.state === "ruins") {
        // Alien ruins: silent XP + credit payout once per ruin.
        const d = V.len(V.sub(e.pos, p.pos));
        if (d < 200) {
          p.scannedRuins = p.scannedRuins ?? [];
          if (!p.scannedRuins.includes(e.id)) {
            p.scannedRuins.push(e.id);
            const cr = 180 + Math.floor(Math.random() * 220);
            p.credits += cr;
            awardXP(p, 120);
            this.pushLog(`⛭ Scanned alien ruins on ${e.name}: +${cr}cr, +120 XP.`);
            this.pushChatter("Sensors", "Datalog: pre-collapse xeno civilization. Uploading.", "#c8a0ff");
            this.sfx("chime");
          }
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
            e.cooldown = 3600 + Math.random() * 3600; // 60-120 minutes — matches initial cadence
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
            this.pushChatter("Computer", "Reality just... folded. We're somewhere else.", "#9effd2");
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
    this._sessionTime = (this._sessionTime ?? 0) + dt;
    this._nextRareAt = (this._nextRareAt ?? 1800) - dt;
    if (this._nextRareAt <= 0) {
      // 1–2 hours between surprises. They should feel like postcards from the
      // deep, not a scheduled event calendar.
      this._nextRareAt = 3600 + Math.random() * 3600;
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
    if (this.input.consume(k.cycleTypeNext)) this.cycleTargetSameType(1);
    if (this.input.consume(k.cycleTypePrev)) this.cycleTargetSameType(-1);

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
      p.cooldown = w.cooldown * effectiveCooldownMul(p);
      this.entities.push({
        id: nextId(), kind: "bullet", name: "shot",
        pos: { ...p.pos }, vel: V.scale(fwd, 260),
        faction: "player", ownerId: -1, ttl: 2,
        ttlAt: performance.now() / 1000 + 2,
      });
      this.sfx("laser");
      const _tgt = this.targetId != null ? this.entities.find((e) => e.id === this.targetId) ?? null : null;
      dispatchHook("onPlayerFire", { weaponId: w.id, from: p, target: _tgt });
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

    // Comms panel controls. '\' cycles the tab (All → Crew → External),
    // PageUp/PageDown scroll the filtered feed. Scroll is clamped in the
    // renderer against the current tab's line count.
    if (this.input.consume("\\")) {
      const order: Voidwake["chatterTab"][] = ["all", "crew", "external", "system"];
      const i = order.indexOf(this.chatterTab);
      this.chatterTab = order[(i + 1) % order.length];
      this.chatterScroll = 0;
    }
    if (this.input.consume("pageup"))   this.chatterScroll = Math.min(this.chatterScroll + 4, 240);
    if (this.input.consume("pagedown")) this.chatterScroll = Math.max(this.chatterScroll - 4, 0);
    if (this.input.consume("home"))     this.chatterScroll = 0;

    // Gunner autopilot + loot pickup + ambient chatter (cheap per-tick work).
    this.updateGunner(dt, fwd);
    this.updateTactical(dt, fwd);
    this.pickupLoot();
    this.tickAmbientChatter(dt);
    this.tickCrewIdle(dt);
    this.tickCrewBanter(dt);
    this.tickNpcBanter(dt);
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
          chatter: this.chatter.slice(0, 250),
        };
        const res = saveGame("autosave", blob);
        if (!res.ok) {
          this.pushLog(res.reason === "quota" ? "⚠ Autosave failed: browser storage full." : "⚠ Autosave failed.");
        } else {
          p.lastSaveAt = Date.now();
          this.pushLog("◉ Autosaved.");
          dispatchHook("onSave", { slot: "autosave", blob });
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
        ? effectiveTopSpeed(p) * p.throttle * (keys.has(k.boost) ? effectiveBoostMul(p) : 1.0) * (keys.has(k.supercruise) ? 3.0 : 1.0)
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
    // 0.5.6 — drain AI state-transition events into keyed chatter lines.
    const aiEvents = drainAiEvents();
    if (aiEvents.length) {
      for (const ev of aiEvents) {
        if (ev.kind === "patrol_tow_start") {
          const tow = this.entities.find((x) => x.id === ev.targetId);
          if (tow) {
            const ctx = this.chatterCtx(tow, { target: tow });
            this.pushChatter(ev.e.name, pickLine("patrol_tow", ctx), "#7fd0ff");
          }
        } else if (ev.kind === "patrol_arrest_start") {
          const ctx = this.chatterCtx();
          this.pushChatter(ev.e.name, pickLine("patrol_arrest", ctx), "#ff9a6a");
        }
      }
    }
    // Bullet collisions + TTL
    this.entities = this.entities.filter((e) => {
      if (e.kind !== "bullet") return true;
      if ((e.ttlAt ?? 0) < now) return false;
      // Player hit
      if (e.faction !== "player" && V.len(V.sub(e.pos, p.pos)) < 12) {
        if (!this.options.cheat) {
          let dmg = 6 * this.dmgScale();
          // 0.5.7 — NPC crit symmetry. Hostile fire crits back at 6% base
          // (10% if the shooter is a "boss" bounty). 2× damage + comms line.
          const shooter = this.entities.find((x) => x.id === e.ownerId);
          const critBase = shooter?.boss ? 0.10 : 0.06;
          const npcCrit = Math.random() < critBase;
          if (npcCrit) dmg *= 2;
          if ((p.ship.shield ?? 0) > 0) p.ship.shield = Math.max(0, p.ship.shield - dmg);
          else p.ship.hull = Math.max(0, p.ship.hull - dmg);
          this.beep(npcCrit ? 160 : 220, 0.04, "sawtooth");
          if (npcCrit) {
            this._shakeUntil = performance.now() / 1000 + 0.25;
            this._shakeMag = 4;
            this.pushChatter("Damage", pickLine("npc_crit", this.chatterCtx()), "#ff5555");
          }
          // Gunner reacts to incoming fire, throttled so it isn't spammy.
          if (p.gunner && p.gunner.enabled && p.gunner.nextBarkAt <= 0) {
            p.gunner.nextBarkAt = 4 + Math.random() * 3;
            this.pushChatter(`Gunner ${p.gunner.name.split(" ")[0]}`,
              pickLine("gunner_hit", this.chatterCtx()), "#ff8a8a");
          }
          if (p.ship.hull <= 0) {
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
          // ownerId -2 = gunner-fired shot; -3 = tactical-fired shot.
          const gunnerFired   = playerShot && e.ownerId === -2;
          const tacticalFired = playerShot && e.ownerId === -3;
          const shooterWepId = gunnerFired
            ? (this.player?.ship.gunnerWeaponId ?? this.player?.ship.weaponId)
            : this.player?.ship.weaponId;
          let dmg = playerShot
            ? (WEAPONS.find((x) => x.id === shooterWepId) ?? WEAPONS[0]).dmg
            : 6;
          // 0.5.6 — critical hits. Base 8% on any player shot; +5% with a
          // Gunner aboard; +15% floor when a Tactical Officer fires. Crits
          // apply a 2× multiplier and post a brief "★ CRIT" chatter line.
          let crit = false;
          if (playerShot) {
            let critChance = 0.08;
            if (this.player?.gunner) critChance += 0.05;
            if (tacticalFired) critChance = Math.max(critChance, 0.23);
            if (Math.random() < critChance) {
              dmg *= 2;
              crit = true;
            }
          }
          if ((t.shield ?? 0) > 0) t.shield = Math.max(0, (t.shield ?? 0) - dmg);
          else t.hull = Math.max(0, (t.hull ?? 0) - dmg);
          if (crit && playerShot) {
            const tag = tacticalFired ? "Tactical" : gunnerFired ? "Gunner" : "Weapons";
            this.pushChatter(tag,
              pickLine("crit_hit", this.chatterCtx(undefined, { target: t })),
              "#ffdd66");
            this.beep(1180, 0.05, "square");
          }
          // Faction retaliation: player-shot ship pings same-faction ships
          // within 2500u to become hostile for 90 seconds.
          if (playerShot && isShip) this.applyFactionRetaliation(t);
          if ((t.hull ?? 0) <= 0) {
            const isPirateBase = isStation && t.faction === "pirate";
            const isBoss = !!t.boss && !isStation;
            // Only credit the player when they pulled the trigger.
            if (playerShot) {
              this.pushLog(
                isPirateBase ? `★ Pirate base ${t.name} obliterated!` :
                isBoss ? `★ Bounty claimed: ${t.name} — dead. +${400}cr bonus.` :
                `Destroyed ${t.name}.`
              );
              awardXP(p, isPirateBase ? 250 : isBoss ? 90 : 25);
              p.credits += isPirateBase ? 1500 : isBoss ? 450 : 50;
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
                // Bosses swing rep harder — killing a named captain is a real signal.
                const mul = isBoss ? 3 : 1;
                adjustRep(p, "federation", 2 * mul); adjustRep(p, "guild", 1 * mul); adjustRep(p, "pirate", -3 * mul);
              } else if (t.faction === "federation") {
                adjustRep(p, "federation", -8); adjustRep(p, "pirate", 2);
              } else if (t.faction === "guild") {
                adjustRep(p, "guild", -5); adjustRep(p, "pirate", 1);
              }
              // Loot canister. Bosses always drop and drop a fatter cache.
              if (Math.random() < (isPirateBase ? 1.0 : isBoss ? 1.0 : 0.85)) {
                this.entities.push({
                  id: nextId(), kind: "loot", name: isPirateBase ? "cache" : isBoss ? "captain's cache" : "canister",
                  pos: { ...t.pos },
                  vel: V.scale(t.vel, 0.25),
                  faction: "wreck",
                  ttlAt: performance.now() / 1000 + (isPirateBase ? 120 : isBoss ? 90 : 45),
                  loot: {
                    credits: isPirateBase ? 600 + Math.floor(Math.random() * 800)
                           : isBoss       ? 300 + Math.floor(Math.random() * 400)
                                          : 20 + Math.floor(Math.random() * 80),
                    ore:     isPirateBase ? 10 + Math.floor(Math.random() * 15)
                           : isBoss       ? 4  + Math.floor(Math.random() * 8)
                                          : Math.floor(Math.random() * 4),
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
            // Convert to debris so AI/render stop treating it as a live
            // ship. Neutralize the wreck so it can't fire, get chased, or
            // get targeted as hostile: faction → nature, hostileUntil
            // cleared, weapons stripped. Small salvage ore payload so a
            // player who mines the corpse gets a scrap tip.
            const salvageOre = 1 + Math.floor(Math.random() * 3);
            if (isStation) {
              // Stations become a chunky debris field marker.
              t.kind = "asteroid"; t.ore = salvageOre + 2; t.name = "wreckage"; t.hull = 0;
            } else {
              t.kind = "asteroid"; t.ore = salvageOre; t.name = "debris"; t.hull = 0;
            }
            t.faction = "nature";
            t.hostileUntil = 0;
            t.weaponId = undefined;
            t.state = undefined;
            dispatchHook("onEntityDestroyed", { entity: t, byPlayer: playerShot });
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
    // Iterate distance-sorted candidates so repeated presses walk *through*
    // every entity in range, not just ping-pong between the two nearest.
    // Prior bug: the filter excluded the current target and picked nearest,
    // which meant "cycle" bounced between target A and target B forever —
    // hostiles that arrived third-nearest (behind a station + asteroid, for
    // instance) were unreachable via T once a Navigator's extended radar
    // pulled more mundane blips into view.
    const range = effectiveRadarRange(p);
    const cand = this.entities
      .filter((e) => e.kind !== "bullet")
      .map((e) => {
        const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
        return { e, d2: dx * dx + dy * dy + dz * dz };
      })
      .filter(({ d2 }) => d2 <= range * range)
      .sort((a, b) => a.d2 - b.d2);
    if (cand.length === 0) { this.targetId = null; return; }
    const curIdx = cand.findIndex(({ e }) => e.id === this.targetId);
    const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % cand.length;
    this.targetId = cand[nextIdx].e.id;
  }

  // {/} — cycle in-range targets that match the current target's category.
  // If nothing is targeted (or the target's category isn't recognised), fall
  // through to a plain nearest-of-any cycle so the keys never feel dead.
  cycleTargetSameType(step: 1 | -1) {
    const p = this.player; if (!p) return;
    const cur = this.targetId != null ? this.entities.find((e) => e.id === this.targetId) : null;
    if (!cur) { this.cycleTarget(); return; }
    const cat = this._targetCategories.find((c) => c.match(cur));
    if (!cat) { this.cycleTarget(); return; }
    const range = effectiveRadarRange(p);
    const cand = this.entities
      .filter((e) => cat.match(e))
      .map((e) => {
        const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
        return { e, d2: dx * dx + dy * dy + dz * dz };
      })
      .filter(({ d2 }) => d2 <= range * range)
      .sort((a, b) => a.d2 - b.d2);
    if (cand.length === 0) {
      this.pushLog(`No other ${cat.label} in range.`);
      return;
    }
    const curIdx = cand.findIndex(({ e }) => e.id === this.targetId);
    const n = cand.length;
    const nextIdx = curIdx < 0 ? 0 : ((curIdx + step) % n + n) % n;
    this.targetId = cand[nextIdx].e.id;
    this.pushLog(`Target: ${cat.label} — ${cand[nextIdx].e.name ?? "?"} (${curIdx < 0 ? 1 : nextIdx + 1}/${n})`);
  }

  // Category-cycle order for [ / ]. Each press steps to the next category and
  // locks the nearest entity matching it. Skips categories with no candidates.
  private _targetCategories: { label: string; match: (e: Entity) => boolean; navigator?: boolean }[] = [
    { label: "STATION",  match: (e) => e.kind === "station" && e.faction !== "pirate" },
    { label: "ASTEROID", match: (e) => e.kind === "asteroid" },
    { label: "HOSTILE",  match: (e) => e.kind === "hostile" || (e.kind === "station" && e.faction === "pirate") },
    { label: "FRIENDLY", match: (e) => e.kind === "friendly" },
    { label: "NEUTRAL",  match: (e) => e.kind === "neutral" },
    { label: "BEACON",   match: (e) => e.kind === "beacon" },
    { label: "PLANET",   match: (e) => e.kind === "planet" },
    { label: "DERELICT", match: (e) => e.kind === "derelict" },
    // 0.5.5 — Navigator crew unlocks three extra categories in [/] cycle.
    { label: "WORMHOLE", match: (e) => e.kind === "wormhole", navigator: true },
    { label: "MISSION",  match: (e) => this.player?.mission?.targetId === e.id, navigator: true },
    { label: "EXOTIC",   match: (e) => { if (e.kind !== "star") return false; const n = stellarClassOf(e).name; return n === "BH" || n === "PSR"; }, navigator: true },
  ];
  private _targetCatIdx = -1;

  cycleTargetCategory(step: 1 | -1) {
    const p = this.player; if (!p) return;
    const n = this._targetCategories.length;
    // Try each category once; skip ones with no candidates in range.
    const hasNav = hasCrew(p, "navigator");
    for (let attempt = 0; attempt < n; attempt++) {
      this._targetCatIdx = ((this._targetCatIdx + step) % n + n) % n;
      const cat = this._targetCategories[this._targetCatIdx];
      if (cat.navigator && !hasNav) continue;
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
    // Rare: ~1-in-50 chance the fragment is an "encoded relic" — pays a
    // one-shot credit bonus and a chunk of XP. Kept as an immediate payout
    // (rather than a new cargo item) so it stays a one-line surprise instead
    // of requiring market plumbing.
    if (Math.random() < 0.02) {
      const bonus = 30 + Math.floor(Math.random() * 61); // 30..90cr
      p.credits += bonus;
      awardXP(p, 12);
      this.pushLog(`✦ Encoded relic recovered — +${bonus}cr`);
      this.pushChatter("Sensors", "Anomalous inscription in that ore. Datacore paid out.", "#c4f");
    }
  }

  // Currently-docked station id, or null while flying. Drives the station
  // menu's price tables (each station has its own market).
  dockedStationId: number | null = null;

  tryDock() {
    // Short cooldown after an undock so an accidental double-tap of F doesn't
    // instantly re-dock. Silent — we don't spam the log if the player just
    // pressed the button one frame too early.
    if (performance.now() / 1000 < this._dockCooldownUntil) return;
    const p = this.player; if (!p) return;
    const t = this.entities.find((e) => e.id === this.targetId);
    if (!t) { this.pushLog("Target a station or friendly ship with T."); return; }
    // Ship-to-ship trade: pull alongside a friendly / neutral within 50u and
    // "dock" to open a stripped-down market (fuel + ore). No repair, no wages.
    if ((t.kind === "friendly" || t.kind === "neutral") && (t.hull ?? 0) > 0) {
      if (t.faction === "pirate") { this.pushLog(`${t.name} isn't the trading kind.`); return; }
      const dShip = V.len(V.sub(t.pos, p.pos));
      if (dShip > 50) { this.pushLog("Too far to hail — pull within 50u."); return; }
      if (p.throttle > 0.05) { this.pushLog("Match speed to hail."); return; }
      // 0.5.7 — Stranded rescue: hailing a mayday ship donates 15% of your
      // fuel, clears its stranded state, and pays a small rep/credit bounty.
      // No market screen — this is a discrete helping-hand interaction.
      if (t.stranded) {
        if (p.ship.fuel < p.ship.fuelMax * 0.2) {
          this.pushLog(`Not enough fuel to spare for ${t.name}. Refuel first.`);
          return;
        }
        const gift = Math.floor(p.ship.fuelMax * 0.15);
        p.ship.fuel = Math.max(0, p.ship.fuel - gift);
        t.stranded = undefined;
        t.state = "wander";
        t.vel = { x: (Math.random() - 0.5) * 6, y: 0, z: (Math.random() - 0.5) * 6 };
        t.towById = undefined;
        const bonus = 120;
        p.credits += bonus;
        awardXP(p, 40);
        if (t.faction && t.faction !== "pirate") {
          adjustRep(p, t.faction, 3);
        }
        this.pushLog(`Donated ${gift} fuel to ${t.name}. +${bonus}cr, +40 XP, +3 rep.`);
        this.pushChatter(t.name, pickLine("stranded_thanks", this.chatterCtx(t)), "#7CFC00");
        this.sfx("dock");
        dispatchHook("onPlayerDock", { entity: t, kind: "ship-trade" });
        return;
      }
      this.screen = "station";
      this.menuCursor = 0;
      this.stationPage = "market";
      this.dockedStationId = t.id;
      this.pushLog(`Trading with ${t.name}.`);
      this.pushChatter(t.name, this.getStock(t.id).rumor, "#c2c2ff");
      this.sfx("dock");
      dispatchHook("onPlayerDock", { entity: t, kind: "ship-trade" });
      return;
    }
    // Populated planet landing — treat as a stripped station (market only,
    // NO free repair). buildStationLines already returns [Market, Undock]
    // for any docked entity whose kind !== "station" (isMini branch).
    if (t.kind === "planet" && t.populated) {
      const dp = V.len(V.sub(t.pos, p.pos));
      if (dp > 300) { this.pushLog("Too far to land — hold low orbit within 300u."); return; }
      if (p.throttle > 0.05) { this.pushLog("Reduce throttle to land."); return; }
      this.screen = "station";
      this.menuCursor = 0;
      this.stationPage = "market";
      this.dockedStationId = t.id;
      this.pushLog(`Landed at colony ${t.name}. Colony trade only — no shipyard services.`);
      this.pushChatter(`Colony ${t.name}`, this.getStock(t.id).rumor, "#ffd28a");
      this.sfx("dock");
      dispatchHook("onPlayerDock", { entity: t, kind: "planet" });
      dispatchHook("onPlanetLand", { entity: t });
      return;
    }
    if (t.kind !== "station") { this.pushLog("Target a station or friendly ship with T."); return; }
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
    dispatchHook("onPlayerDock", { entity: t, kind: "station" });
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

    // Pay crew wages. Flat per-dock cr per crewmember + gunner. Shortfalls
    // drop each crewmember's `morale` (0..100). Recruiter aboard halves the
    // hit. Full pay nudges morale back toward 100.
    //
    // 0.5.6 — Cheat Mode: wages+morale entirely skipped (safe sandbox).
    //         Easy difficulty: morale floors at 5 (griping only, no
    //         walk-outs). Normal+: morale ≤ 0 triggers a walk-out with a
    //         farewell_bad line and the crewmember is spliced from crew[].
    if (!this.options.cheat) {
      let bill = 0;
      if (p.gunner) bill += p.gunner.wage ?? 30;
      if (p.crew) for (const c of p.crew) bill += c.wage ?? 40;
      if (bill > 0) {
        const paid = Math.min(bill, p.credits);
        p.credits -= paid;
        const short = paid < bill;
        // 0.5.7 — morale perk attenuation: Recruiter halves the base decay,
        // Quartermaster/Merchant stretch supplies to soften it further, and a
        // floor of 3 keeps at least a nudge so wages still matter.
        let decayBase = 15;
        if (hasCrew(p, "recruiter")) decayBase -= 7;
        if (hasCrew(p, "quartermaster")) decayBase -= 3;
        if (hasCrew(p, "merchant")) decayBase -= 2;
        const decay = short ? Math.max(3, decayBase) : 0;
        const gain  = short ? 0 : 2;
        const easy = this.options.difficulty === "Easy";
        const moraleFloor = easy ? 5 : 0;
        const walkouts: CrewMember[] = [];
        if (p.crew) for (const c of p.crew) {
          const m = (c.morale ?? 100) - decay + gain;
          c.morale = Math.max(moraleFloor, Math.min(100, m));
          if (!easy && c.morale <= 0) walkouts.push(c);
        }
        // Splice walkouts out of the crew and post a farewell line each.
        if (walkouts.length && p.crew) {
          for (const w of walkouts) {
            const i = p.crew.indexOf(w);
            if (i >= 0) p.crew.splice(i, 1);
            const first = w.name.split(" ")[0];
            const roleTag = (CREW_ROLE_INFO[w.role]?.title ?? w.role);
            this.pushLog(`✗ ${roleTag} ${first} walked off — morale collapsed.`);
            const roleFarewell = `${w.role}_farewell_bad` as ChatterKind;
            const line = (TEMPLATES[roleFarewell] && TEMPLATES[roleFarewell].length)
              ? pickLine(roleFarewell, this.chatterCtx())
              : pickLine("walkout", this.chatterCtx());
            this.pushChatter(`${roleTag} ${first}`, line,
              CREW_ROLE_INFO[w.role]?.color ?? "#fc6");
          }
        }
        // The legacy gunner has its own morale field on Gunner if present.
        if (short) {
          const anyLow = p.crew && p.crew.some((c) => (c.morale ?? 100) < 30);
          const grump = easy
            ? "Payday's short, but we'll manage. Barely."
            : anyLow
              ? "Morale's underwater. Fix this or we walk."
              : "Payday came up light, boss.";
          this.pushLog(`Crew wages: paid ${paid}cr — SHORT ${bill - paid}cr. Crew is grumbling.`);
          this.pushChatter("Crew", grump, "#fc6");
        } else {
          this.pushLog(`Crew wages: -${paid}cr.`);
        }
      }
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
      // Gunner fires their dedicated weapon if one is installed, else falls
      // back to the pilot's. Purchased via the station's "Gunner Bay" page.
      const gunnerWepId = p.ship.gunnerWeaponId ?? p.ship.weaponId;
      const w = WEAPONS.find((x) => x.id === gunnerWepId) ?? WEAPONS[0];
      if (bestDist > w.range) return;
      if (g.cooldown > 0) return;
      g.cooldown = w.cooldown * 1.15 * effectiveCooldownMul(p);   // slightly slower than manual fire
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
      // Gunner-mined rocks roll the same 1-in-50 relic chance as manual
      // mining — see mineTarget() for the rationale.
      if (Math.random() < 0.02) {
        const bonus = 30 + Math.floor(Math.random() * 61);
        p.credits += bonus;
        awardXP(p, 12);
        this.pushLog(`✦ Encoded relic recovered — +${bonus}cr`);
        this.pushChatter(tag, "Anomalous inscription in that fragment. Datacore paid out.", "#c4f");
      }
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

  // --- Tactical firing (0.5.5) --------------------------------------------
  // Tactical Officer is mutually exclusive with Gunner, so this only runs
  // when a `tactical` crew slot is filled. Same alignment cone / range check
  // as updateGunner() but only engages hostiles — a Tactical will never
  // fire on rocks or stations. Fires the pilot's mounted weapon (there is
  // no separate Tactical bay), and posts an occasional bark on hit.
  updateTactical(dt: number, fwd: Vec3) {
    const p = this.player;
    if (!p || this.options.peaceful) return;
    const tac = getCrew(p, "tactical");
    if (!tac || !tac.enabled) return;
    tac.cooldown = (tac.cooldown ?? 0) - dt;
    tac.nextBarkAt -= dt;
    let best: Entity | null = null;
    let bestDot = 0.94, bestDist = Infinity;
    for (const e of this.entities) {
      if (e.kind !== "hostile") continue;
      if ((e.hull ?? 1) <= 0) continue;
      const rel = V.sub(e.pos, p.pos);
      const d = V.len(rel);
      if (d < 1 || d > 900) continue;
      const dotv = (rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z) / d;
      if (dotv > bestDot) { bestDot = dotv; best = e; bestDist = d; }
    }
    if (!best) return;
    const w = WEAPONS.find((x) => x.id === p.ship.weaponId) ?? WEAPONS[0];
    if (bestDist > w.range) return;
    if ((tac.cooldown ?? 0) > 0) return;
    tac.cooldown = w.cooldown * 1.10 * effectiveCooldownMul(p); // slight cadence bonus vs. Gunner
    this.entities.push({
      id: nextId(), kind: "bullet", name: "shot",
      pos: { ...p.pos }, vel: V.scale(fwd, 260),
      faction: "player", ownerId: -3, ttl: 2,
      ttlAt: performance.now() / 1000 + 2,
    });
    this.beep(760, 0.04, "square");
    if (tac.nextBarkAt <= 0) {
      tac.nextBarkAt = 3 + Math.random() * 2.5;
      const first = tac.name.split(" ")[0];
      this.pushChatter(`Tactical ${first}`,
        pickLine("tactical_hostile", this.chatterCtx(undefined, { target: best })),
        "#ff7a7a");
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
    // Shortest-arc diffs on both axes so autopilot rights the ship the short
    // way when the player engaged it while inverted (pitch beyond ±π/2 is now
    // legal thanks to continuous pitch — we can't just clamp anymore).
    let dy = targetYaw - p.heading.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    let dp = targetPitch - p.heading.pitch;
    while (dp > Math.PI) dp -= Math.PI * 2;
    while (dp < -Math.PI) dp += Math.PI * 2;
    const slew = 2.0 * dt;
    p.heading.yaw = wrapPi(p.heading.yaw + Math.max(-slew, Math.min(slew, dy)));
    p.heading.pitch = wrapPi(p.heading.pitch + Math.max(-slew, Math.min(slew, dp)));
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
      this.pushChatter(a.name, parts[0].replace(new RegExp(`^${a.name}:\\s*`), ""), a.color, "crew");
      this.pushChatter(b.name, parts[1].replace(new RegExp(`^${b.name}:\\s*`), ""), b.color, "crew");
    } else {
      this.pushChatter(a.name, line, a.color, "crew");
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

  // Occasional inter-NPC exchange — pick two nearby non-alien speakers
  // (ships, stations, or planets) within scanner range of the player and
  // post a short back-and-forth so the Comms feed reads like a lived-in
  // sector. Emits into the "external" channel. Gated by chatterFreq like
  // every other ambient scheduler.
  private _nextNpcBanterAt = 25;
  tickNpcBanter(dt: number) {
    const p = this.player; if (!p) return;
    const freq = this.options.chatterFreq ?? "normal";
    if (freq === "off") return;
    const mul = freq === "rare" ? 3.0 : freq === "lively" ? 0.5 : 1.0;
    this._nextNpcBanterAt -= dt;
    if (this._nextNpcBanterAt > 0) return;
    this._nextNpcBanterAt = (22 + Math.random() * 25) * mul;
    const near = this.entities
      .filter((e) => (e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral" || e.kind === "station")
        && !e.faction.startsWith("alien")
        && e.state !== "stranded")
      .map((e) => ({ e, d: V.len(V.sub(e.pos, p.pos)) }))
      .filter((x) => x.d < 1800)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    if (near.length < 2) return;
    // Prefer pairings that feel dramatic: hostile ↔ friendly threats, or a
    // ship ↔ station handshake. Otherwise fall back to two random nearby
    // speakers.
    const shuf = near.slice().sort(() => Math.random() - 0.5);
    let a = shuf[0].e, b = shuf[1].e;
    const hostileHere = shuf.find((x) => x.e.kind === "hostile")?.e;
    const friendlyHere = shuf.find((x) => x.e.kind === "friendly")?.e;
    const stationHere = shuf.find((x) => x.e.kind === "station")?.e;
    const shipHere = shuf.find((x) => x.e.kind !== "station")?.e;
    if (hostileHere && friendlyHere) { a = hostileHere; b = friendlyHere; }
    else if (stationHere && shipHere) { a = shipHere; b = stationHere; }
    if (a === b) return;
    const colorFor = (e: Entity) =>
      e.kind === "hostile" ? "#ff8a8a"
      : e.kind === "friendly" ? (e.faction === "patrol" ? "#7fd0ff" : "#aef58a")
      : e.kind === "station" ? "#c2c2ff"
      : "#dddddd";
    const lineFor = (e: Entity, other: Entity) => {
      const ctx = this.chatterCtx(e, { target: other });
      if (e.kind === "hostile") return pickLine(e.boss ? "boss_hostile" : "hostile", ctx);
      if (e.kind === "friendly" && e.faction === "patrol") return pickLine("patrol", ctx);
      if (e.kind === "friendly") return pickLine("friendly", ctx);
      if (e.kind === "station")  return pickLine("station",  ctx);
      return pickLine("neutral", ctx);
    };
    const tag = (e: Entity) => (e.kind === "station" ? `Beacon ${e.name}` : e.name);
    this.pushChatter(tag(a), lineFor(a, b), colorFor(a), "external");
    // Reply lands slightly later via a queued micro-timer so the two lines
    // don't collapse into the same frame. Simplest cheap version: schedule
    // via a short setTimeout on the underlying window — engine already runs
    // in the browser main thread.
    const bTag = tag(b), bMsg = lineFor(b, a), bCol = colorFor(b);
    setTimeout(() => this.pushChatter(bTag, bMsg, bCol, "external"), 900 + Math.random() * 700);
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
        // 5% chance this raider is a named captain: distinct callsign,
        // +50% hull, and pays out a bounty on kill (see kill handler).
        const isBoss = Math.random() < 0.05;
        const rname = isBoss ? pirateBossNameFor(Math.random) : nameFrom(this.rng, "Raider");
        const rhull = isBoss ? 75 : 50;
        spawnNear(src.pos, "hostile", "pirate", rname, rhull);
        if (isBoss) {
          // spawnNear pushed the ship last; tag it.
          const spawned = this.entities[this.entities.length - 1];
          spawned.boss = true;
          spawned.pilotName = rname;
          spawned.shield = 60;
          this.pushLog(`⚠ Notorious pirate captain in-system: ${rname}.`);
        }
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
    // Find a candidate within 1500u, prefer interesting kinds. Skip alien-
    // family factions — UFOs and thargoids stay wordless / gibberish.
    // 0.5.6 — Stranded ships now broadcast maydays (previously suppressed).
    // Filter still skips alien-family factions.
    const near = this.entities
      .filter((e) => (e.kind === "hostile" || e.kind === "friendly" || e.kind === "neutral" || e.kind === "station" || e.kind === "planet")
        && !e.faction.startsWith("alien"))
      .map((e) => ({ e, d: V.len(V.sub(e.pos, p.pos)) }))
      .filter((x) => x.d < 1500)
      .sort((a, b) => a.d - b.d);
    if (near.length === 0) return;
    const pick = near[Math.floor(Math.random() * Math.min(4, near.length))].e;
    const ctx = this.chatterCtx(pick);
    // 0.5.6 — Stranded ships broadcast mayday on the ext channel.
    if (pick.stranded && pick.state === "stranded" && (pick.kind === "friendly" || pick.kind === "neutral")) {
      this.pushChatter(pick.name, pickLine("stranded_mayday", ctx), "#ffcc55");
      return;
    }
    // Patrols speak with a distinct "SPD" cyan tag rather than the generic
    // green friendly voice, so they read as authorities.
    if (pick.kind === "friendly" && pick.faction === "patrol") {
      this.pushChatter(pick.name, pickLine("patrol", ctx), "#7fd0ff");
    } else {
      switch (pick.kind) {
        case "hostile":
          this.pushChatter(pick.name, pickLine(pick.boss ? "boss_hostile" : "hostile", ctx), pick.boss ? "#ff5566" : "#ff8a8a");
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
          if (pick.populated) {
            this.pushChatter(`Colony ${pick.name}`, pickLine("planet_populated", ctx), "#ffd28a");
          } else {
            this.pushChatter(pick.name, pickLine("planet", ctx), "#7ec8ff");
          }
          break;
      }
    }
    // If the gunner is around and bored, occasionally chime in.
    if (p.gunner && Math.random() < 0.35) {
      const tag = `Gunner ${p.gunner.name.split(" ")[0]}`;
      this.pushChatter(tag, pickLine("gunner_idle", this.chatterCtx()), "#fc6");
    }
  }


  // --- Main menu -----------------------------------------------------------
  menuItems = ["Resume", "Save Game", "Load Game", "How To Play", "Legend (Codex)", "Options", "Quit"];
  updateMenu() {
    this.menuNav(this.menuItems.length);
    if (this.input.consume("enter")) {
      const c = this.menuItems[this.menuCursor];
      if (c === "Resume") this.screen = "playing";
      else if (c === "Save Game") { this.screen = "save"; this.menuCursor = 0; }
      else if (c === "Load Game") { this.screen = "load"; this.menuCursor = 0; }
      else if (c === "How To Play") { this._howtoReturn = "menu"; this.screen = "howto"; this.menuCursor = 0; this._howtoPage = 0; }
      else if (c === "Legend (Codex)") { this._codexReturn = "menu"; this.screen = "codex"; this.menuCursor = 0; }
      else if (c === "Options") { this.screen = "options"; this.optionsSection = "root"; this.menuCursor = 0; }
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
  // The Options screen is a small hub: a root list picks between three
  // subsections (Gameplay / Audio / Controls). Controls itself exposes a
  // Keybinds sub-page that lets the player rebind every action.
  //
  // Sub-page routing lives in a single `optionsSection` field on the class
  // so the ESC handler (in the global input loop) can bounce a subsection
  // back to root without needing to know which page is active.
  updateOptions() {
    // Rebind capture takes priority — swallow all input until a key lands
    // or ESC cancels. (The global ESC handler in update() only fires when
    // _rebindAction is null; see the guard there.)
    if (this._rebindAction) {
      // ESC cancels rebind. We check both consume + the raw key so the
      // player can also click "Cancel" via the touch swipe-left gesture.
      if (this.input.consume("escape")) { this._rebindAction = null; return; }
      // Pick the first fresh press that isn't a modifier / navigation key.
      const skip = new Set(["shift", "control", "alt", "meta", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
      for (const k of this.input.pressed) {
        if (skip.has(k)) continue;
        this.options.keybinds[this._rebindAction] = k;
        this._rebindAction = null;
        break;
      }
      // Drain enter so the same press that opened rebind doesn't confirm
      // something on the next frame.
      this.input.consume("enter");
      return;
    }

    if (this.optionsSection === "root")      { this.updateOptionsRoot();      return; }
    if (this.optionsSection === "gameplay")  { this.updateOptionsGameplay();  return; }
    if (this.optionsSection === "audio")     { this.updateOptionsAudio();     return; }
    if (this.optionsSection === "controls")  { this.updateOptionsControls();  return; }
    if (this.optionsSection === "keybinds")  { this.updateOptionsKeybinds();  return; }
    if (this.optionsSection === "scripting") { this.updateOptionsScripting(); return; }
    if (this.optionsSection === "chat")      { this.updateOptionsChat();      return; }
  }

  // Root Options hub. Scripting became a real subsection in 0.5.5; the
  // greyed-out placeholder is gone.
  private optionsRootItems = ["Gameplay", "Audio", "Controls", "Scripting", "Back"];
  // Reserved for future greyed-out rows. Empty in 0.5.5.
  private optionsRootDisabled: number[] = [];
  private updateOptionsRoot() {
    this.menuNav(this.optionsRootItems.length);
    if (!this.input.consume("enter")) return;
    const c = this.optionsRootItems[this.menuCursor];
    if (this.optionsRootDisabled.includes(this.menuCursor)) return;
    if (c === "Gameplay") { this.optionsSection = "gameplay"; this.menuCursor = 0; }
    else if (c === "Audio")     { this.optionsSection = "audio";     this.menuCursor = 0; }
    else if (c === "Controls")  { this.optionsSection = "controls";  this.menuCursor = 0; }
    else if (c === "Scripting") { this.optionsSection = "scripting"; this.menuCursor = 0; }
    else if (c === "Back")      { this.screen = this.player ? "menu" : "title"; this.menuCursor = 0; }
  }

  // --- Options ▸ Gameplay --------------------------------------------------
  // Difficulty, peaceful, cheat, autosave, unsaved warning, permadeath, crew chatter.
  private updateOptionsGameplay() {
    const items = this.optionsGameplayItems();
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
    if (i === 3 && (left || right)) this.options.autosave = !this.options.autosave;
    if (i === 4) this.options.unsavedWarnMinutes = Math.max(1, this.options.unsavedWarnMinutes + (right ? 1 : left ? -1 : 0));
    if (i === 5 && (left || right)) this.options.permadeath = !this.options.permadeath;
    if (i === 6 && (left || right)) {
      const modes: Options["chatterFreq"][] = ["off", "rare", "normal", "lively"];
      const idx = modes.indexOf(this.options.chatterFreq ?? "normal");
      const n = modes.length;
      this.options.chatterFreq = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 7 && (left || right)) this.options.glitchFx = !this.options.glitchFx;
    if (i === 8 && (left || right)) this.options.scanlines = !this.options.scanlines;
    if (i === 9 && (left || right)) {
      const modes: Array<1 | 2 | 3> = [1, 2, 3];
      const cur = (this.options.scanlineDensity ?? 2) as 1 | 2 | 3;
      const idx = Math.max(0, modes.indexOf(cur));
      this.options.scanlineDensity = modes[(idx + (right ? 1 : -1) + modes.length) % modes.length];
    }
    if (i === 10 && (left || right)) {
      const modes: Options["hudScheme"][] = ["green", "amber", "cyan", "white", "red"];
      const idx = Math.max(0, modes.indexOf(this.options.hudScheme ?? "green"));
      const n = modes.length;
      this.options.hudScheme = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 11 && (left || right)) {
      const modes: Options["reticleColor"][] = ["green", "amber", "cyan", "magenta", "white", "red"];
      const idx = Math.max(0, modes.indexOf(this.options.reticleColor ?? "green"));
      const n = modes.length;
      this.options.reticleColor = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 12 && (left || right)) {
      const modes: Options["reticleShape"][] = ["cross", "dot", "brackets", "circle", "diamond"];
      const idx = Math.max(0, modes.indexOf(this.options.reticleShape ?? "cross"));
      const n = modes.length;
      this.options.reticleShape = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    // "Chat Windows" opens a nested sub-page with the three comms controls
    // (width, height, word-wrap). Kept out of the flat Gameplay list so the
    // list stays scannable and there's room for future per-tab options.
    if (i === 13 && this.input.consume("enter")) {
      this.optionsSection = "chat"; this.menuCursor = 0;
      return;
    }
    if (this.input.consume("enter") && items[i] === "Back") {
      this.optionsSection = "root"; this.menuCursor = 0;
    }
  }
  private optionsGameplayItems(): string[] {
    const dens = this.options.scanlineDensity ?? 2;
    const densLabel = dens === 1 ? "dense" : dens === 3 ? "sparse" : "normal";
    return [
      `Difficulty: ${this.options.difficulty}`,
      `Peaceful Mode: ${this.options.peaceful ? "ON" : "OFF"}`,
      `Cheat Mode: ${this.options.cheat ? "ON" : "OFF"}`,
      `Autosave: ${this.options.autosave ? "ON" : "OFF"}`,
      `Unsaved Warn: ${this.options.unsavedWarnMinutes} min`,
      `Permadeath: ${this.options.permadeath ? "ON" : "OFF"}`,
      `Crew Chatter: ${this.options.chatterFreq ?? "normal"}`,
      `Glitch FX: ${this.options.glitchFx === false ? "OFF" : "ON"}`,
      `Scanlines: ${this.options.scanlines ? "ON" : "OFF"}`,
      `Scanline Density: ${densLabel}`,
      `HUD Color: ${this.options.hudScheme ?? "green"}`,
      `Reticle Color: ${this.options.reticleColor ?? "green"}`,
      `Reticle Shape: ${this.options.reticleShape ?? "cross"}`,
      `Chat Windows ▸`,
      "Back",
    ];
  }

  // --- Options ▸ Gameplay ▸ Chat Windows -----------------------------------
  // Nested sub-page for the Comms panel controls (width, height, word-wrap).
  // Kept as its own section so future per-tab colors / timestamp format /
  // auto-hide-in-combat toggles have somewhere obvious to land.
  private updateOptionsChat() {
    const items = this.optionsChatItems();
    this.menuNav(items.length);
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    const i = this.menuCursor;
    if (i === 0) {
      const delta = right ? 2 : left ? -2 : 0;
      this.options.commsCols = Math.max(28, Math.min(120, (this.options.commsCols ?? 54) + delta));
    }
    if (i === 1) {
      const delta = right ? 1 : left ? -1 : 0;
      this.options.commsRows = Math.max(4, Math.min(30, (this.options.commsRows ?? 12) + delta));
    }
    if (i === 2 && (left || right)) this.options.commsWrap = !this.options.commsWrap;
    if (this.input.consume("enter") && items[i] === "Back") {
      this.optionsSection = "gameplay"; this.menuCursor = 13;
    }
  }
  private optionsChatItems(): string[] {
    return [
      `Comms Width: ${this.options.commsCols ?? 54} cols`,
      `Comms Height: ${this.options.commsRows ?? 12} rows`,
      `Comms Word Wrap: ${this.options.commsWrap ? "ON" : "OFF"}`,
      "Back",
    ];
  }

  // --- Options ▸ Audio -----------------------------------------------------
  // Master / SFX / Music volumes, radio preset, radio custom URL.
  private updateOptionsAudio() {
    const items = this.optionsAudioItems();
    this.menuNav(items.length);
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    const i = this.menuCursor;
    if (i === 0 && (left || right)) { this.options.volumeMaster = clamp01(this.options.volumeMaster + (right ? 0.05 : -0.05)); this.syncRadio(); }
    if (i === 1 && (left || right)) this.options.volumeSfx = clamp01(this.options.volumeSfx + (right ? 0.05 : -0.05));
    if (i === 2 && (left || right)) { this.options.volumeMusic = clamp01(this.options.volumeMusic + (right ? 0.05 : -0.05)); this.syncRadio(); }
    if (i === 3 && (left || right)) {
      const idx = Math.max(0, RADIO_PRESETS.findIndex((r) => r.id === this.options.radioMode));
      const n = RADIO_PRESETS.length;
      this.options.radioMode = RADIO_PRESETS[(idx + (right ? 1 : -1) + n) % n].id;
      this.syncRadio();
    }
    // i === 4 (Radio URL) is entered via ENTER below.
    if (this.input.consume("enter")) {
      if (i === 4) {
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
      } else if (items[i] === "Back") {
        this.optionsSection = "root"; this.menuCursor = 0;
      }
    }
  }
  private optionsAudioItems(): string[] {
    const radioPreset = RADIO_PRESETS.find((r) => r.id === this.options.radioMode) ?? RADIO_PRESETS[0];
    const radioUrlLabel = this.options.radioMode === "custom"
      ? (this.options.radioCustomUrl ? this.options.radioCustomUrl.slice(0, 40) : "(press ENTER to set)")
      : "—";
    return [
      `Master Volume: ${(this.options.volumeMaster * 100).toFixed(0)}%`,
      `SFX Volume: ${(this.options.volumeSfx * 100).toFixed(0)}%`,
      `Music Volume: ${(this.options.volumeMusic * 100).toFixed(0)}%`,
      `Radio: ${radioPreset.label}`,
      `Radio URL: ${radioUrlLabel}`,
      "Back",
    ];
  }

  // --- Options ▸ Controls --------------------------------------------------
  // Mouse steer, mouse sensitivity, gamepad, gamepad deadzone, touch controls,
  // and an entry that opens the Keybinds sub-page (which also owns the
  // "Reset Keybinds" action so it stays grouped with the bindings themselves).
  private updateOptionsControls() {
    const items = this.optionsControlsItems();
    this.menuNav(items.length);
    const left = this.input.consume("arrowleft");
    const right = this.input.consume("arrowright");
    const i = this.menuCursor;
    if (i === 0 && (left || right)) this.options.mouseSteer = !this.options.mouseSteer;
    if (i === 1) this.options.mouseSensitivity = Math.max(0.1, Math.min(3, this.options.mouseSensitivity + (right ? 0.1 : left ? -0.1 : 0)));
    if (i === 2 && (left || right)) {
      const modes: Options["gamepad"][] = ["off", "auto", "on"];
      const idx = modes.indexOf(this.options.gamepad);
      const n = modes.length;
      this.options.gamepad = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 3) this.options.gamepadDeadzone = Math.max(0, Math.min(0.5, this.options.gamepadDeadzone + (right ? 0.02 : left ? -0.02 : 0)));
    if (i === 4 && (left || right)) {
      const modes: Options["touchControls"][] = ["off", "auto", "on"];
      const idx = modes.indexOf(this.options.touchControls);
      const n = modes.length;
      this.options.touchControls = modes[(idx + (right ? 1 : -1) + n) % n];
    }
    if (i === 5 && (left || right)) this.options.showFps = !this.options.showFps;
    if (this.input.consume("enter")) {
      if (items[i].startsWith("Configure Keybinds")) {
        this.optionsSection = "keybinds"; this.menuCursor = 0;
      } else if (items[i] === "Back") {
        this.optionsSection = "root"; this.menuCursor = 0;
      }
    }
  }
  private optionsControlsItems(): string[] {
    return [
      `Mouse Steer: ${this.options.mouseSteer ? "ON" : "OFF"}`,
      `Mouse Sensitivity: ${this.options.mouseSensitivity.toFixed(2)}`,
      `Gamepad: ${this.options.gamepad.toUpperCase()}${this.input.gamepadConnected ? "  •connected" : ""}`,
      `Gamepad Deadzone: ${this.options.gamepadDeadzone.toFixed(2)}`,
      `Touch Controls: ${this.options.touchControls.toUpperCase()}`,
      `Show FPS: ${this.options.showFps ? "ON" : "OFF"}`,
      `Configure Keybinds…`,
      "Back",
    ];
  }

  // --- Options ▸ Controls ▸ Keybinds --------------------------------------
  // One row per action in KEYBIND_ACTIONS, plus "Reset Keybinds" and "Back".
  // ENTER on an action row arms _rebindAction; the next non-modifier keypress
  // becomes the new binding (see updateOptions() top-of-function guard).
  private updateOptionsKeybinds() {
    const items = this.optionsKeybindsItems();
    this.menuNav(items.length);
    if (!this.input.consume("enter")) return;
    const i = this.menuCursor;
    if (items[i] === "Back") { this.optionsSection = "controls"; this.menuCursor = 0; return; }
    if (items[i].startsWith("Reset Keybinds")) {
      this.options.keybinds = { ...DEFAULT_KEYBINDS };
      return;
    }
    // Action rows come first, in KEYBIND_ACTIONS order.
    if (i < KEYBIND_ACTIONS.length) {
      this._rebindAction = KEYBIND_ACTIONS[i].id;
      // Drain the fresh-press set so the ENTER that opened rebind isn't
      // captured as the new binding on this same frame.
      this.input.pressed.clear();
    }
  }
  private optionsKeybindsItems(): string[] {
    const kb = this.options.keybinds;
    const rows = KEYBIND_ACTIONS.map((a) => {
      const cur = kb[a.id] ?? DEFAULT_KEYBINDS[a.id] ?? "?";
      return `${a.label}: ${keyLabel(cur)}`;
    });
    rows.push("Reset Keybinds to Defaults");
    rows.push("Back");
    return rows;
  }

  // --- Options ▸ Scripting (0.5.5) -----------------------------------------
  // Lua runtime lives in ./lua-host.ts (fengari-web). Source is edited via a
  // browser `prompt()` — no in-canvas text editor, but works offline. Script
  // + enabled flag persist in localStorage. See dispose/init helpers below.
  private optionsScriptingItems(): string[] {
    const on = this.scriptEnabled;
    const loaded = !!this.luaHost?.loaded;
    const len = this.scriptSource.length;
    const err = this.luaHost?.lastError ?? null;
    return [
      `Scripting: ${on ? "ON" : "OFF"}`,
      `Edit Script...  (${len} chars)`,
      `Reload Script${loaded ? "  (loaded)" : ""}`,
      "Clear Script",
      `Status: ${err ? "err — " + this.truncate(err, 44) : (on && loaded ? "running" : on ? "idle" : "disabled")}`,
      "Back",
    ];
  }
  private truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + "…"; }

  private updateOptionsScripting() {
    const items = this.optionsScriptingItems();
    this.menuNav(items.length);
    if (!this.input.consume("enter")) return;
    const i = this.menuCursor;
    const row = items[i];
    if (row.startsWith("Scripting:")) {
      this.scriptEnabled = !this.scriptEnabled;
      this.saveScriptSettings();
      if (this.scriptEnabled) this.reloadScript();
      else this.disposeScript();
    } else if (row.startsWith("Edit Script")) {
      // Browser prompt is the simplest cross-target editor. Truncated at
      // ~2KB in most browsers — a drag-drop .lua file picker is on the mod
      // roadmap (M3).
      if (typeof window !== "undefined" && typeof window.prompt === "function") {
        const next = window.prompt("Paste Lua source (M1 sandbox: frontier.on/log/chat):", this.scriptSource);
        if (next != null) {
          this.scriptSource = next;
          this.saveScriptSettings();
          if (this.scriptEnabled) this.reloadScript();
        }
      } else {
        this.pushLog("No prompt() available — edit via localStorage 'voidwake.script.source'.");
      }
    } else if (row.startsWith("Reload Script")) {
      if (this.scriptEnabled) this.reloadScript();
      else this.pushLog("Enable Scripting first.");
    } else if (row === "Clear Script") {
      this.scriptSource = "";
      this.saveScriptSettings();
      this.disposeScript();
      this.pushLog("Script cleared.");
    } else if (row === "Back") {
      this.optionsSection = "root"; this.menuCursor = 0;
    }
  }

  private saveScriptSettings() {
    try {
      localStorage.setItem("voidwake.script.source", this.scriptSource);
      localStorage.setItem("voidwake.script.enabled", this.scriptEnabled ? "1" : "0");
    } catch { /* quota — silent */ }
  }
  private loadScriptSettings() {
    try {
      this.scriptSource = localStorage.getItem("voidwake.script.source") ?? "";
      this.scriptEnabled = localStorage.getItem("voidwake.script.enabled") === "1";
    } catch { /* noop */ }
  }
  private disposeScript() {
    if (this.luaHost) { this.luaHost.dispose(); this.luaHost = null; }
  }
  private async reloadScript() {
    this.disposeScript();
    if (!this.scriptSource.trim()) { this.pushLog("Script is empty."); return; }
    try {
      // Lazy import so users who never enable scripting don't pay the
      // fengari-web bundle cost.
      const mod = await import("./lua-host");
      this.luaHost = new mod.LuaHost({
        pushLog: (m) => this.pushLog(m),
        pushChatter: (w, m, c) => this.pushChatter(w, m, c),
        addCredits: (d) => {
          const p = this.player; if (!p) return null;
          p.credits = Math.max(0, Math.floor(p.credits + d));
          return p.credits;
        },
        addFuel: (d) => {
          const p = this.player; if (!p) return null;
          p.ship.fuel = Math.max(0, Math.min(p.ship.fuelMax, p.ship.fuel + d));
          return p.ship.fuel;
        },
        getPlayerSnapshot: () => {
          const p = this.player; if (!p) return null;
          return {
            name: p.char.name, credits: p.credits, kills: p.kills ?? 0, xp: p.xp ?? 0,
            hull: p.ship.hull, hullMax: p.ship.hullMax,
            shield: p.ship.shield, shieldMax: p.ship.shieldMax,
            fuel: p.ship.fuel, fuelMax: p.ship.fuelMax,
            throttle: p.throttle, seed: this.seed,
          };
        },
      }, VERSION);
      const res = this.luaHost.load(this.scriptSource);
      if (res.ok) {
        this.pushLog("[script] loaded.");
        this.pushChatter("Script", "Lua host online.", "#c4f");
      } else {
        this.pushLog(`[script] load failed: ${res.error}`);
      }
    } catch (e) {
      this.pushLog(`[script] runtime unavailable: ${String(e)}`);
    }
  }






  // --- Save / Load screens -------------------------------------------------
  // Save slots always show all three (slot-1..3) with their most-recent save
  // timestamp — an empty slot renders "(empty)" so the player can see at a
  // glance which slots are free. The trailing "Export to JSON" action dumps
  // the current in-memory game to a downloadable .json file.
  updateSave() {
    if (!this.player) { this.screen = "menu"; return; }
    const items = ["slot-1", "slot-2", "slot-3", "Export to JSON", "Back"];
    this.menuNav(items.length);
    if (this.input.consume("enter")) {
      const c = items[this.menuCursor];
      if (c === "Back") { this.screen = "menu"; return; }
      if (c === "Export to JSON") { this.exportCurrentSave(); return; }
      const blob: SaveBlob = {
        version: VERSION, seed: this.seed,
        player: this.player, entities: this.entities,
        options: this.options, savedAt: Date.now(),
        chatter: this.chatter.slice(0, 250),
      };
      const res = saveGame(c, blob);
      if (!res.ok) {
        this.pushLog(res.reason === "quota" ? `Save to ${c} failed — storage full.` : `Save to ${c} failed.`);
      } else {
        this.player.lastSaveAt = Date.now();
        this.pushLog(`Saved to ${c}.`);
        dispatchHook("onSave", { slot: c, blob });
        this.screen = "menu";
      }
    }
  }
  updateLoad() {
    const saves = listSaves();
    const slotNames = saves.map((s) => s.slot);
    const items = [...slotNames, "Import from JSON", "Back"];
    this.menuNav(items.length);
    if (this.input.consume("enter")) {
      const c = items[this.menuCursor];
      if (c === "Back") { this.screen = this.player ? "menu" : "title"; return; }
      if (c === "Import from JSON") { this.importSaveFromFile(); return; }
      const blob = loadGame(c);
      if (!blob) { this.pushLog("Load failed."); return; }
      this.applyLoadedBlob(blob, `Loaded ${c}.`, c);
    }
  }

  // Shared restore path used by disk loads and JSON imports.
  private applyLoadedBlob(blob: SaveBlob, logMsg: string, slotLabel: string) {
    this.seed = blob.seed;
    this.rng = mulberry32(this.seed);
    this.entities = blob.entities;
    this.player = blob.player;
    this.options = blob.options;
    this.chatter = Array.isArray(blob.chatter) ? blob.chatter.slice(0, 250) : [];
    this.chatterScroll = 0;
    this.screen = "playing";
    this.pushLog(logMsg);
    this.syncRadio();
    dispatchHook("onLoad", { slot: slotLabel, blob });
  }

  // Download the current in-memory game as a .json blob. Uses a transient <a>
  // element with a data URL so the browser's usual "Save As" dialog fires.
  private exportCurrentSave() {
    if (!this.player) return;
    try {
      const blob: SaveBlob = {
        version: VERSION, seed: this.seed,
        player: this.player, entities: this.entities,
        options: this.options, savedAt: Date.now(),
        chatter: this.chatter.slice(0, 250),
      };
      const json = JSON.stringify(blob, null, 2);
      const file = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(file);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `ascii-frontier-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on next tick — some browsers race the click otherwise.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.pushLog("Exported save to JSON.");
    } catch (e) {
      console.warn("[ASCII Frontier] exportCurrentSave failed:", e);
      this.pushLog("Export failed.");
    }
  }

  // Prompt for a .json file and adopt it as the live game state.
  private importSaveFromFile() {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.style.display = "none";
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) { input.remove(); return; }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result)) as SaveBlob;
            parsed.options = { ...defaultOptions(), ...(parsed.options ?? {}) } as Options;
            this.applyLoadedBlob(parsed, "Imported save from JSON.", "(import)");
          } catch (err) {
            console.warn("[ASCII Frontier] importSaveFromFile parse failed:", err);
            this.pushLog("Import failed — invalid JSON.");
          } finally {
            input.remove();
          }
        };
        reader.onerror = () => {
          this.pushLog("Import failed — could not read file.");
          input.remove();
        };
        reader.readAsText(f);
      };
      document.body.appendChild(input);
      input.click();
    } catch (e) {
      console.warn("[ASCII Frontier] importSaveFromFile failed:", e);
      this.pushLog("Import failed.");
    }
  }

  // --- Station menu (paged) ------------------------------------------------
  // Pages: main → market | weapons | modules | crew. Cursor resets between
  // pages. Prices come from the cached StationStock for this station.
  stationItems = ["Market", "Weapon Bay", "Gunner Bay", "Module Shop", "Crew", "Undock"];

  // Build the visible item list for the current station page so the
  // renderer and update loop stay in lockstep (cursor indexes line up).
  buildStationLines(): string[] {
    const p = this.player!;
    const sid = this.dockedStationId;
    if (sid == null) return ["Undock"];
    const stock = this.getStock(sid);
    // Orbital mini-stations and ship-to-ship "hail" docks expose only the
    // Market page — no crew, weapons, or module inventory.
    const dockedEnt = this.entities.find((e) => e.id === sid);
    const isMini = dockedEnt && (dockedEnt.kind !== "station" || dockedEnt.state === "orbital");
    if (this.stationPage === "main") {
      return isMini ? ["Market", "Undock"] : this.stationItems;
    }
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
    if (this.stationPage === "gunner-bay") {
      // Gunner-only weapon slot. Requires a hired gunner to be useful, but
      // the slot is buyable ahead of hiring so the player can pre-outfit.
      const rows: string[] = [];
      if (!p.gunner) rows.push("~ No gunner hired — buy anyway, or dismiss first ~");
      // "Unmount" line clears the gunner's dedicated weapon so they revert
      // to firing the pilot weapon.
      if (p.ship.gunnerWeaponId) {
        const cur = WEAPONS.find((w) => w.id === p.ship.gunnerWeaponId);
        rows.push(`Unmount current: ${cur?.name ?? p.ship.gunnerWeaponId}`);
      }
      rows.push(...stock.weapons.map((w) => {
        const def = WEAPONS.find((x) => x.id === w.id)!;
        // Gunner-slot weapons sell at a 25% premium (dedicated mount hardware).
        const price = Math.round(w.price * 1.25);
        const owned = p.ship.gunnerWeaponId === w.id ? " (gunner-equipped)" : "";
        return `${def.name} — ${price}cr${owned}`;
      }));
      rows.push("Back");
      return rows;
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
      const roles: CrewRole[] = ["gunner", "pilot", "engineer", "merchant", "navigator", "quartermaster", "recruiter", "tactical"];
      const recruiterMul = hasCrew(p, "recruiter") ? 0.85 : 1.0;
      for (const r of roles) {
        const info = CREW_ROLE_INFO[r];
        const baseFee = r === "gunner" ? stock.gunnerFee : Math.round(info.baseFee * merchantBuyMult(p));
        const fee = Math.round(baseFee * recruiterMul);
        if (hasCrew(p, r)) {
          const c = r === "gunner"
            ? p.gunner!
            : getCrew(p, r)!;
          rows.push(`Dismiss ${info.title} ${c.name}`);
        } else {
          // Gunner ↔ Tactical mutual exclusivity: only expose the row if
          // its counterpart is not on the crew list.
          if (r === "gunner" && hasCrew(p, "tactical")) {
            rows.push(`Gunner — locked (Tactical Officer aboard)`);
            continue;
          }
          if (r === "tactical" && !!p.gunner) {
            rows.push(`Tactical — locked (Gunner aboard)`);
            continue;
          }
          const gate = cur >= cap ? "  (berths full)" : "";
          rows.push(`Hire ${info.title} — ${fee}cr — ${info.blurb}${gate}`);
        }
      }
      // Xeno hires: only after enough alien contact has been logged. Xenos
      // cost 2x the normal fee, occupy one berth, and are cosmetically tagged
      // with a xeno species label. They otherwise inherit their role's perk.
      if ((p.alienEncounters ?? 0) >= XENO_HIRE_THRESHOLD) {
        rows.push("~ Xeno recruits ~");
        for (const r of roles) {
          if (hasCrew(p, r)) continue;
          if (r === "gunner" && hasCrew(p, "tactical")) continue;
          if (r === "tactical" && !!p.gunner) continue;
          const info = CREW_ROLE_INFO[r];
          const baseFee = r === "gunner" ? stock.gunnerFee : Math.round(info.baseFee * merchantBuyMult(p));
          const fee = Math.round(baseFee * 2 * recruiterMul);
          const gate = cur >= cap ? "  (berths full)" : "";
          rows.push(`Hire Xeno ${info.title} — ${fee}cr${gate}`);
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
      const c = lines[i];
      if (c === "Market")       { this.stationPage = "market";  this.menuCursor = 0; }
      else if (c === "Weapon Bay")  { this.stationPage = "weapons"; this.menuCursor = 0; }
      else if (c === "Gunner Bay")  { this.stationPage = "gunner-bay"; this.menuCursor = 0; }
      else if (c === "Module Shop") { this.stationPage = "modules"; this.menuCursor = 0; }
      else if (c === "Crew")    { this.stationPage = "crew";    this.menuCursor = 0; }
      else if (c === "Undock")  {
        // Play a short "clamps disengaging" beat by suppressing tryDock for
        // 0.6s. Prevents the docking screen from bouncing right back if the
        // player mashes F.
        this._dockCooldownUntil = performance.now() / 1000 + 0.6;
        this.pushLog("Clamps disengaging…");
        this.screen = "playing"; this.dockedStationId = null;
      }
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

    if (this.stationPage === "gunner-bay") {
      // Header row + optional "Unmount" line shift the weapon indices.
      const rows = lines;
      const label = rows[i];
      if (!label || label.startsWith("~")) return;
      if (label.startsWith("Unmount current:")) {
        p.ship.gunnerWeaponId = undefined;
        this.pushLog("Gunner mount unloaded.");
        return;
      }
      // Match the offer by name prefix (rows contain "Name — Ncr[ (owned)]").
      const offer = stock.weapons.find((w) => {
        const def = WEAPONS.find((x) => x.id === w.id);
        return def && label.startsWith(def.name);
      });
      if (!offer) return;
      const price = Math.round(offer.price * 1.25 * merchantBuyMult(p));
      if (p.ship.gunnerWeaponId === offer.id) { this.pushLog("Already gunner-equipped."); return; }
      if (p.credits < price) { this.pushLog("Not enough credits."); return; }
      p.credits -= price;
      p.ship.gunnerWeaponId = offer.id;
      this.pushLog(`Gunner armed with ${WEAPONS.find((w) => w.id === offer.id)!.name}.`);
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
      if (offer.id === "reinforced-plating") { p.ship.hullMax += 40; p.ship.hull += 40; }
      if (offer.id === "aux-fuel-tank") { p.ship.fuelMax += 50; p.ship.fuel += 50; }
      this.pushLog(`Installed ${offer.name}.`);
      return;
    }

    if (this.stationPage === "crew") {
      const row = lines[i] ?? "";
      if (!row || row.startsWith("~")) return;
      const roles: CrewRole[] = ["gunner", "pilot", "engineer", "merchant", "navigator", "quartermaster", "recruiter", "tactical"];
      // "locked" rows: eaten silently so exclusivity messaging in the menu
      // doesn't try to hire a locked slot.
      if (row.includes("locked")) {
        this.pushLog(row.startsWith("Gunner") ? "Dismiss the Tactical Officer first." : "Dismiss the Gunner first.");
        return;
      }
      // Dismiss line matches "Dismiss <title> ..."
      if (row.startsWith("Dismiss")) {
        const r = roles.find((rr) => hasCrew(p, rr) && row.includes(CREW_ROLE_INFO[rr].title));
        if (!r) return;
        const info = CREW_ROLE_INFO[r];
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
      // Xeno hire: "Hire Xeno <title> — Ncr..."
      const xeno = row.startsWith("Hire Xeno");
      const hire = xeno || row.startsWith("Hire ");
      if (!hire) return;
      const r = roles.find((rr) => row.includes(CREW_ROLE_INFO[rr].title));
      if (!r) return;
      const info = CREW_ROLE_INFO[r];
      if (hasCrew(p, r)) return;
      if (r === "gunner" && hasCrew(p, "tactical")) { this.pushLog("Tactical Officer aboard — Gunner slot locked."); return; }
      if (r === "tactical" && !!p.gunner) { this.pushLog("Gunner aboard — Tactical Officer slot locked."); return; }
      if (crewCount(p) >= effectiveCrewMax(p)) { this.pushLog("No spare berths — install Crew Quarters."); return; }
      const recruiterMul = hasCrew(p, "recruiter") ? 0.85 : 1.0;
      const baseFee = r === "gunner" ? stock.gunnerFee : Math.round(info.baseFee * merchantBuyMult(p));
      const fee = Math.round((xeno ? baseFee * 2 : baseFee) * recruiterMul);
      if (p.credits < fee) { this.pushLog("Not enough credits."); return; }
      p.credits -= fee;
      if (r === "gunner") {
        p.gunner = generateGunner(Math.random);
        if (xeno) p.gunner.species = "Xeno";
        this.pushLog(`Hired ${p.gunner.name} (${p.gunner.species}).`);
        this.pushChatter(`Gunner ${p.gunner.name.split(" ")[0]}`,
          pickLine("gunner_greet", this.chatterCtx()), "#fc6");
      } else {
        const c = generateCrewMember(r, Math.random);
        if (xeno) c.species = "Xeno";
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
    // Touch tap on a rendered menu item → move cursor to it and confirm.
    const tap = this.input.menuTapIndex;
    if (tap >= 0 && tap < n) {
      this.menuCursor = tap;
      this.input.pressed.add("enter");
    }
    this.input.menuTapIndex = -1;
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
    // Reset per-frame menu-touch flag; renderListMenu re-enables it.
    this.input.menuActive = false;

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
      this.screen === "crashed" || this.screen === "quit-confirm" || this.screen === "howto"
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
      case "howto": this.renderHowto(grid); break;
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

    // ---- Glitch overlay -------------------------------------------------
    // Triggered by (a) recent hull damage and (b) a Thargoid actively
    // enveloping us (EMP or within 2000u while non-dormant). Draws a few
    // horizontal band-shifts and per-pixel noise scanlines. Skipped under
    // reduced-motion or when the player has disabled it.
    if (this.screen === "playing" && !this._reducedMotion && this.options.glitchFx !== false) {
      const tNow = performance.now() / 1000;
      const hullPulse = Math.max(0, this.hullFlashUntil - tNow);
      let thargoidNear = (this._empUntil ?? 0) > tNow ? 1 : 0;
      if (!thargoidNear && this.player) {
        for (const e of this.entities) {
          if (e.kind !== "thargoid" || e.state === "dormant") continue;
          if (V.len(V.sub(e.pos, this.player.pos)) < 2000) { thargoidNear = 1; break; }
        }
      }
      const intensity = Math.max(hullPulse > 0 ? 0.6 : 0, thargoidNear ? 0.85 : 0);
      if (intensity > 0) {
        // Cheap band-shift: pick 2-3 random horizontal slices and copy them
        // sideways by a few pixels. Uses drawImage(canvas,...) which the
        // 2D context supports on its own canvas.
        const bands = 2 + Math.floor(Math.random() * 3);
        for (let b = 0; b < bands; b++) {
          const by = Math.floor(Math.random() * h);
          const bh = 3 + Math.floor(Math.random() * 12);
          const dx = Math.floor((Math.random() - 0.5) * 40 * intensity);
          try { ctx.drawImage(this.canvas, 0, by, w, bh, dx, by, w, bh); } catch { /* ignore */ }
        }
        // Green/magenta chroma tick to sell the alien signal.
        ctx.fillStyle = thargoidNear
          ? `rgba(160, 255, 60, ${(0.09 * intensity).toFixed(3)})`
          : `rgba(255, 80, 80, ${(0.10 * intensity).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // ---- Scanlines ------------------------------------------------------
    // Subtle even-row darkening — pure CRT flavor, opt-in in Options.
    if (this.screen === "playing" && this.options.scanlines) {
      // 0.5.6 — density adjustable in Options. Higher step = sparser lines.
      const step = Math.max(1, Math.min(4, this.options.scanlineDensity ?? 2));
      const alpha = step === 1 ? 0.20 : step === 2 ? 0.14 : 0.10;
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      for (let sy = 0; sy < h; sy += step) ctx.fillRect(0, sy, w, 1);
    }

    // ---- HUD scheme tint ------------------------------------------------
    // Multiply overlay in the chosen theme color. Green is the default and
    // no-ops. Amber gives a classic amber-CRT feel, cyan/white/red/etc.
    // recolor the entire HUD (and starfield) at once without touching any
    // draw call. Alpha is low so glyphs remain readable.
    if (this.screen === "playing") {
      const scheme = this.options.hudScheme ?? "green";
      if (scheme !== "green") {
        const tint = ({
          amber: "rgba(255, 165, 40, 0.28)",
          cyan:  "rgba(80, 200, 255, 0.22)",
          white: "rgba(240, 240, 255, 0.14)",
          red:   "rgba(255, 90, 90, 0.22)",
        } as Record<string, string>)[scheme];
        if (tint) {
          const prev = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = "multiply";
          ctx.fillStyle = tint;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = prev;
        }
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

    // ---- Deep-sky pass (galactic disk + core + BH) -----------------------
    // Fixed points in world space treated as if they lived at infinity —
    // only the camera rotation applies, translation is ignored. This lets
    // us paint a "background sky" that always sits behind everything else.
    const projectDir = (dx: number, dy: number, dz: number) => {
      const x1 = cy * dx - sy * dz;
      const z1 = sy * dx + cy * dz;
      const y1 = cp * dy - sp * z1;
      const z2 = sp * dy + cp * z1;
      if (z2 <= 0.05) return null;
      const sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
      const sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      if (sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) return null;
      return { sx, sy: sy2 };
    };
    if (this._galaxyDirs.length === 0) {
      // 180 points spread around the disk. Slight thickness (dy) so the band
      // reads as a faint smear rather than a pixel-thin line.
      for (let i = 0; i < 180; i++) {
        const th = (i / 180) * Math.PI * 2 + Math.random() * 0.02;
        const r = 0.85 + Math.random() * 0.15;
        const dx = Math.cos(th) * r;
        const dz = Math.sin(th) * r;
        const dy = (Math.random() - 0.5) * 0.08; // thin disk
        const b = Math.floor(Math.random() * 3);
        // Normalize.
        const L = Math.hypot(dx, dy, dz) || 1;
        this._galaxyDirs.push({ x: dx / L, y: dy / L, z: dz / L, b });
      }
    }
    const DISK_PAL = ["#241a2c", "#3a2740", "#4d3358"];
    const DISK_CH = [".", ".", "·"];
    for (const d of this._galaxyDirs) {
      const pt = projectDir(d.x, d.y, d.z);
      if (!pt) continue;
      const cell = g[pt.sy][pt.sx];
      if (cell.ch === " ") g[pt.sy][pt.sx] = { ch: DISK_CH[d.b], color: DISK_PAL[d.b] };
    }
    // Galactic core: direction to world origin. Bright center with a faint
    // halo, and a black-hole disk at the very core.
    const toCoreLen = Math.hypot(p.pos.x, p.pos.y, p.pos.z) || 1;
    const cxDir = -p.pos.x / toCoreLen, cyDir = -p.pos.y / toCoreLen, czDir = -p.pos.z / toCoreLen;
    const core = projectDir(cxDir, cyDir, czDir);
    if (core) {
      // Halo (2-cell radius) in warm dust colors.
      const HALO = ["#3a2440", "#553055", "#77406a", "#a05680"];
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -3; ox <= 3; ox++) {
          const rad = Math.hypot(ox * 0.6, oy);
          if (rad < 0.5 || rad > 3.2) continue;
          const sx = core.sx + ox, sy2 = core.sy + oy;
          if (sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) continue;
          if (g[sy2][sx].ch !== " ") continue;
          const tier = Math.min(3, Math.floor(rad));
          g[sy2][sx] = { ch: "·", color: HALO[3 - tier] };
        }
      }
      // Bright galactic-center glyph, then black hole overlay.
      if (g[core.sy][core.sx].ch === " " || g[core.sy][core.sx].ch === "·")
        g[core.sy][core.sx] = { ch: "*", color: "#f4c67a", glow: true };
      // BH: single darkened cell right beside the core so the core reads as
      // "bright halo with a dark eye". Only draw if inside viewport.
      if (core.sx + 1 < vpRight)
        g[core.sy][core.sx + 1] = { ch: "●", color: "#0a0508" };
    }

    // ---- Colorful gas cloud puffs ---------------------------------------
    // Sparse and dim — meant to add a splash of color without obscuring the
    // starfield or entities. Same reject-and-respawn scheme as the stars.
    if (this.gasClouds.length === 0) {
      const CLOUD_TINTS = ["#2a1a3a", "#3a1a2a", "#1a2a3a", "#1a3a2a", "#3a2a1a", "#301538"];
      for (let i = 0; i < 60; i++) {
        const seed = this.spawnWorldStar(R * 1.4, false);
        this.gasClouds.push({ x: seed.x, y: seed.y, z: seed.z, c: CLOUD_TINTS[i % CLOUD_TINTS.length] });
      }
    }
    for (const c of this.gasClouds) {
      const rx = c.x - p.pos.x, ry = c.y - p.pos.y, rz = c.z - p.pos.z;
      const x1 = cy * rx - sy * rz;
      const z1 = sy * rx + cy * rz;
      const y1 = cp * ry - sp * z1;
      const z2 = sp * ry + cp * z1;
      if (z2 <= 1) {
        // Behind camera — reposition ahead.
        const ahead = 0.5 * R + Math.random() * R;
        c.x = p.pos.x + fwd.x * ahead + (Math.random() - 0.5) * R;
        c.y = p.pos.y + fwd.y * ahead + (Math.random() - 0.5) * R;
        c.z = p.pos.z + fwd.z * ahead + (Math.random() - 0.5) * R;
        continue;
      }
      const sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
      const sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      if (sx <= vpLeft || sx >= vpRight || sy2 <= vpTop || sy2 >= vpBottom) continue;
      if (g[sy2][sx].ch === " ") g[sy2][sx] = { ch: "·", color: c.c };
    }

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
    // Species blurb — always shown so the player sees the trade-off before
    // committing. Placed a few rows below the field list.
    const info = speciesOf(c.species);
    putText(g, 6, 6 + rows.length * 2 + 1, `+ ${info.bonus}`,  "#7CFC00");
    putText(g, 6, 6 + rows.length * 2 + 2, `- ${info.drawback}`, "#fc6");
    if (info.affinity) {
      putText(g, 6, 6 + rows.length * 2 + 3,
        `crew affinity: ${CREW_ROLE_INFO[info.affinity].title}`, "#9fe");
    }
  }

  renderShipCreate(g: Cell[][]) {
    putText(g, 4, 2, "OUTFIT SHIP", "#7CFC00");
    const hulls = unlockedShipHulls(this.charDraft.species);
    const idx = Math.min(this.hullDraftIdx, hulls.length - 1);
    const hull = hulls[idx] ?? SHIP_HULLS[0];
    const wep = WEAPONS[this.weaponDraftIdx];
    const blurb = hull.blurb ? `  — ${hull.blurb}` : "";
    const rows = [
      `hull:   ${hull.name}   (HP ${hull.hull}, SH ${hull.shield}, cargo ${hull.cargo}, spd ${hull.speed}, crew ${hull.crewSlots})${blurb}`,
      `weapon: ${wep.name}   (dmg ${wep.dmg}, cd ${wep.cooldown}s, rng ${wep.range})`,
      `Launch →`,
    ];
    rows.forEach((r, i) => {
      const sel = i === this.menuCursor;
      putText(g, 6, 6 + i * 2, (sel ? "▸ " : "  ") + r, sel ? "#fff" : "#9fe");
    });
    putText(g, 4, 6 + rows.length * 2 + 1,
      `available hulls: ${hulls.length}  (species: ${this.charDraft.species}${hasPriorSave() ? ", veteran unlocks" : ""})`,
      "#888");
    putText(g, 4, g.length - 2, "←/→ change   ↑/↓ field   ENTER confirm", "#888");
  }

  renderMenu(g: Cell[][]) { this.renderListMenu(g, "MAIN MENU", this.menuItems); }
  renderOptions(g: Cell[][]) {
    // Render whichever Options subsection is active. The rebind capture
    // overlays a "press any key" prompt without hiding the underlying list.
    let title = "OPTIONS";
    let items: string[];
    let hint = "↑/↓ select   ENTER open   ESC back";
    switch (this.optionsSection) {
      case "root":
        items = this.optionsRootItems.slice();
        break;
      case "gameplay":
        title = "OPTIONS ▸ GAMEPLAY";
        items = this.optionsGameplayItems();
        hint = "←/→ change   ↑/↓ field   ESC back";
        break;
      case "audio":
        title = "OPTIONS ▸ AUDIO";
        items = this.optionsAudioItems();
        hint = "←/→ change   ↑/↓ field   ENTER edit URL   ESC back";
        break;
      case "controls":
        title = "OPTIONS ▸ CONTROLS";
        items = this.optionsControlsItems();
        hint = "←/→ change   ↑/↓ field   ENTER open keybinds   ESC back";
        break;
      case "keybinds":
        title = "OPTIONS ▸ CONTROLS ▸ KEYBINDS";
        items = this.optionsKeybindsItems();
        hint = "↑/↓ select   ENTER rebind   ESC back";
        break;
      case "scripting":
        title = "OPTIONS ▸ SCRIPTING (LUA)";
        items = this.optionsScriptingItems();
        hint = "↑/↓ select   ENTER activate   ESC back";
        break;
      case "chat":
        title = "OPTIONS ▸ GAMEPLAY ▸ CHAT WINDOWS";
        items = this.optionsChatItems();
        hint = "←/→ change   ↑/↓ field   ESC back";
        break;
      default:
        items = this.optionsRootItems.slice();
        break;
    }
    this.renderListMenu(g, title, items, this.optionsSection === "root" ? this.optionsRootDisabled : []);
    // Extra hint sits one row above renderListMenu's footer so the two
    // strings don't clip into each other (this was the "ENTER confirmwipe"
    // artifact — options hint + list-menu footer overwriting the same row).
    putText(g, 4, g.length - 3, hint, "#888");
    if (this._rebindAction) {
      const label = KEYBIND_ACTIONS.find((a) => a.id === this._rebindAction)?.label ?? this._rebindAction;
      const cols = g[0].length;
      const msg = `Press any key to bind [${label}]  —  ESC to cancel`;
      putText(g, Math.max(2, Math.floor((cols - msg.length) / 2)), Math.floor(g.length / 2), msg, "#7CFC00");
    }
  }
  renderSave(g: Cell[][]) {
    const saves = listSaves();
    const stamp = (slot: string) => {
      const s = saves.find((x) => x.slot === slot);
      return s ? `— ${new Date(s.savedAt).toLocaleString()}` : "— (empty)";
    };
    const labels = [
      `slot-1  ${stamp("slot-1")}`,
      `slot-2  ${stamp("slot-2")}`,
      `slot-3  ${stamp("slot-3")}`,
      "Export to JSON",
      "Back",
    ];
    this.renderListMenu(g, "SAVE GAME", labels);
  }
  renderLoad(g: Cell[][]) {
    const saves = listSaves();
    const slots = saves.map((s) => `${s.slot}  — ${new Date(s.savedAt).toLocaleString()}`);
    const labels = [...slots, "Import from JSON", "Back"];
    this.renderListMenu(g, "LOAD GAME", labels);
    if (slots.length === 0) {
      putText(g, 4, g.length - 5, "(no saves on disk — Import loads a .json file)", "#888");
    }
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

  // --- How To Play --------------------------------------------------------
  // Six-page onboarding overlay. Pages: Premise, First Quest, Controls, HUD,
  // Mouse-steer warning, Tips. ←/→ or Enter to flip; ESC to close back to
  // whichever menu opened it (title or pause).
  updateHowto() {
    const pages = 6;
    if (this.input.consume("arrowleft"))  this._howtoPage = (this._howtoPage + pages - 1) % pages;
    if (this.input.consume("arrowright")) this._howtoPage = (this._howtoPage + 1) % pages;
    if (this.input.consume("enter"))      this._howtoPage = (this._howtoPage + 1) % pages;
    if (this.input.consume(this.options.keybinds.menu)) {
      this.screen = this._howtoReturn;
      this.menuCursor = 0;
    }
  }

  renderHowto(g: Cell[][]) {
    const cols = g[0].length;
    const kb = this.options.keybinds;
    const pageTitles = ["PREMISE", "SURVIVE YOUR FIRST QUEST", "CONTROLS", "HUD & DISPLAY", "MOUSE-STEER SAFETY", "TIPS & TRICKS"];
    const title = `[ HOW TO PLAY — ${pageTitles[this._howtoPage]} (${this._howtoPage + 1}/${pageTitles.length}) ]   ←/→ pages   ESC close`;
    putText(g, 4, 1, title, "#7CFC00");

    const wrap = (text: string, width: number): string[] => {
      const out: string[] = [];
      for (const para of text.split("\n")) {
        if (!para.length) { out.push(""); continue; }
        const words = para.split(" ");
        let line = "";
        for (const w of words) {
          if ((line + (line ? " " : "") + w).length > width) {
            if (line) out.push(line);
            line = w;
          } else {
            line = line ? line + " " + w : w;
          }
        }
        if (line) out.push(line);
      }
      return out;
    };

    const drawBody = (lines: { text: string; color?: string }[]) => {
      let y = 4;
      const width = Math.min(cols - 8, 96);
      for (const ln of lines) {
        if (y >= g.length - 3) break;
        if (ln.text === "") { y++; continue; }
        const wrapped = wrap(ln.text, width);
        for (const w of wrapped) {
          if (y >= g.length - 3) break;
          putText(g, 4, y++, w, ln.color ?? "#cfd");
        }
      }
    };

    if (this._howtoPage === 0) {
      drawBody([
        { text: "You are a solitary starship captain flying an ASCII cockpit through a", color: "#9fe" },
        { text: "procedurally-generated pocket of space. Trade, mine, hunt bounties,", color: "#9fe" },
        { text: "escort convoys, dodge pirates — or make them wish they'd stayed home.", color: "#9fe" },
        { text: "" },
        { text: "There is no fixed storyline. The galaxy is small but restless: pirates" },
        { text: "raid, Federation patrols answer maydays, Guild traders haul ore between" },
        { text: "stations, and rare wanderers (UFOs, unknowns, derelicts, wormholes) drift" },
        { text: "through the black. Your reputation with each faction rises and falls" },
        { text: "with your choices." },
        { text: "" },
        { text: "Death is permanent on Normal difficulty and above; on Easy you get a", color: "#fc6" },
        { text: "softcore rescue for a fee. Cheat Mode makes you invincible and turns off", color: "#fc6" },
        { text: "wages/morale entirely — a safe sandbox for exploring the systems.", color: "#fc6" },
      ]);
    } else if (this._howtoPage === 1) {
      drawBody([
        { text: "Your first job is to survive long enough to earn a real paycheck.", color: "#7CFC00" },
        { text: "" },
        { text: `1. Press ${kb.cycleTarget.toUpperCase()} to cycle targets. Find a nearby station (▲ glyph, blue).` },
        { text: `2. Point at it, throttle up with ${kb.throttleUp.toUpperCase()}, and close the range.` },
        { text: `3. Within 200u, cut throttle (${kb.throttleDown.toUpperCase()}) below 5% and press ${kb.dock.toUpperCase()} to dock.` },
        { text: "   Docking is FREE — it refuels and repairs you and pays the crew." },
        { text: `4. At the station, press ${kb.station.toUpperCase()}/Enter through the menu:` },
        { text: "     Market  — buy low, sell high (ore, fuel, weapons at real stations)" },
        { text: "     Missions — accept a mission (J) for guaranteed credits" },
        { text: "     Shipyard — upgrade later, when you've saved 2000+ credits" },
        { text: "" },
        { text: "5. Undock and complete the mission — the tracker pins on the HUD." },
        { text: "" },
        { text: "Early warnings:", color: "#fc6" },
        { text: "  • Red ships (◄) are hostile. Turn away from them until you have shields.", color: "#fc6" },
        { text: "  • Watch fuel — if it hits 0 you drift. Squawk near a Patrol for a free tow.", color: "#fc6" },
        { text: "  • Asteroids look pretty but bump hard. Approach at low throttle to mine (M).", color: "#fc6" },
        { text: "  • Never fly into a star's corona at high throttle. Idle near it to fuel-scoop.", color: "#fc6" },
      ]);
    } else if (this._howtoPage === 2) {
      drawBody([
        { text: "Flight", color: "#7CFC00" },
        { text: `  ${kb.throttleUp.toUpperCase()} / ${kb.throttleDown.toUpperCase()}   throttle up / down` },
        { text: `  ${kb.yawLeft.toUpperCase()} / ${kb.yawRight.toUpperCase()}   yaw left / right` },
        { text: `  ${kb.pitchUp.toUpperCase()} / ${kb.pitchDown.toUpperCase()}   pitch up / down` },
        { text: `  SHIFT     afterburner   ·   ${kb.supercruise.toUpperCase()}   supercruise (weapons off)` },
        { text: "" },
        { text: "Combat & Interaction", color: "#7CFC00" },
        { text: `  SPACE  fire weapon   ·   ${kb.cycleTarget.toUpperCase()}  cycle target   ·   ${kb.mine.toUpperCase()}  mine asteroid` },
        { text: `  ${kb.cycleCatPrev}/${kb.cycleCatNext}  target by category   ·   ${kb.cycleTypePrev}/${kb.cycleTypeNext}  next of same type in range` },
        { text: `  ${kb.dock.toUpperCase()} / ${kb.station.toUpperCase()}  dock or land (must be close and slow)` },
        { text: `  ${kb.jettison.toUpperCase()}  jettison heaviest cargo   ·   ${kb.toggleGunner.toUpperCase()}  gunner AUTO/STANDBY` },
        { text: "" },
        { text: "UI", color: "#7CFC00" },
        { text: `  ${kb.legend.toUpperCase()}  Codex (every glyph & color explained)` },
        { text: `  ${kb.questLog.toUpperCase()}  Quest Log   ·   ${kb.pinQuest.toUpperCase()}  pin/unpin mission tracker` },
        { text: `  ${kb.autopilot.toUpperCase()}  autopilot toggle   ·   ${kb.pause.toUpperCase()}  pause   ·   ESC  main menu` },
        { text: "" },
        { text: "Every key can be rebound under Options ▸ Controls ▸ Configure Keybinds…", color: "#9fe" },
        { text: "Gamepad and touch controls are also supported under Options ▸ Controls.", color: "#9fe" },
      ]);
    } else if (this._howtoPage === 3) {
      drawBody([
        { text: "Cockpit HUD (top-left)", color: "#7CFC00" },
        { text: "  Ship name, hull %, shield %, fuel %, cargo %, credits, kills." },
        { text: "  Bars flash amber when a value is critical." },
        { text: "" },
        { text: "Reticle (center)", color: "#7CFC00" },
        { text: "  -+-  green = idle   ·   amber = aligned   ·   red = target in range" },
        { text: "  ✚  lead indicator turns green when a firing solution is ready." },
        { text: "" },
        { text: "Targeting", color: "#7CFC00" },
        { text: "  [ ]  brackets tighten around the current on-screen target." },
        { text: "  ◣◢◤◥  edge pointers show off-screen targets with a distance readout." },
        { text: "  ◇  mission objective marker." },
        { text: "" },
        { text: "Radar (top-right)", color: "#7CFC00" },
        { text: "  A pseudo-3D ASCII sphere. `@` is you at center. Contacts render as their" },
        { text: "  glyph — green friendly, amber neutral, red hostile, blue station." },
        { text: "" },
        { text: "Comms & Log (bottom)", color: "#7CFC00" },
        { text: "  Left  = system log (mission progress, damage, dock events)." },
        { text: "  Right = comms chatter — NPC voices, patrol calls, crew banter." },
      ]);
    } else if (this._howtoPage === 4) {
      drawBody([
        { text: "★ MOUSE-STEER SAFETY — READ THIS ★", color: "#ff5555" },
        { text: "" },
        { text: "If your ship is SPINNING or SPIRALING out of control, this is almost", color: "#ff5555" },
        { text: "always the mouse-steer input. To recover:", color: "#ff5555" },
        { text: "" },
        { text: "  1. MOVE YOUR MOUSE CURSOR TO THE CENTER OF THE SCREEN and hold it there.", color: "#ff5555" },
        { text: "  2. Or open the pause menu (ESC) and turn Mouse-Steer OFF under", color: "#ff5555" },
        { text: "     Options ▸ Controls ▸ Mouse-Steer.", color: "#ff5555" },
        { text: "" },
        { text: "How mouse-steer works", color: "#7CFC00" },
        { text: "  When enabled, your mouse position relative to the screen center pitches" },
        { text: "  and yaws the ship. A cursor parked in the center = neutral input. A" },
        { text: "  cursor at the corner = maximum turn in that direction. If you switch" },
        { text: "  windows, alt-tab, or the cursor lands off-center on load, the ship will" },
        { text: "  spin until you recenter or disable the option." },
        { text: "" },
        { text: "Alternatives", color: "#7CFC00" },
        { text: "  Keyboard steering with A/D (yaw) and Q/E (pitch) works fine on its own." },
        { text: "  Gamepads use the right stick. Touch devices use on-screen thumbsticks." },
      ]);
    } else {
      drawBody([
        { text: "Making credits", color: "#7CFC00" },
        { text: "  • Bounty missions pay big and give you an excuse to fight pirates." },
        { text: "  • Ore prices vary between stations — buy low at asteroid-heavy sectors," },
        { text: "    sell high at populated colonies (+25% ore price at colony markets)." },
        { text: "  • Salvage derelicts (†) by flying within 40u — free loot canisters." },
        { text: "" },
        { text: "Crew", color: "#7CFC00" },
        { text: "  Hire crew at stations. Roles stack: an Engineer + Navigator + Merchant is" },
        { text: "  a solid trader loadout; Gunner OR Tactical (they conflict) plus Recruiter" },
        { text: "  keeps a combat build stable. Pay wages every dock — low morale grumbles," },
        { text: "  empty morale walks the crew off (unless Easy Mode or Cheat Mode is on)." },
        { text: "" },
        { text: "Hazards", color: "#fc6" },
        { text: "  ◉ Black hole — bends your course, kills on contact. Go around, not through." },
        { text: "  ▒ Nebula — drains shields and hides ships. Great for ambushes, either way." },
        { text: "  ⚠ Unknown contact (thargoid) — EMPs you, then leaves. Don't provoke it." },
        { text: "" },
        { text: "Rescue", color: "#7CFC00" },
        { text: "  Friendly ships broadcasting MAYDAY are out of fuel. SPD Patrols will tow" },
        { text: "  them for free, but you can also hail one directly: pull within 50u, match" },
        { text: "  speed (throttle ≤ 5%), and press dock. You'll donate 15% fuel and get a" },
        { text: "  cash bonus + XP for your trouble." },
        { text: "" },
        { text: "See also: Codex (L) for glyph/color legend and full keybinds.", color: "#9fe" },
      ]);
    }
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
        ["+", "#ffaa55", "lead indicator — fire when it turns green ✚ (on the reticle)"],
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
        [kb.cycleTypePrev + " / " + kb.cycleTypeNext, "cycle in-range targets of the current target's type"],
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

  renderListMenu(g: Cell[][], title: string, items: string[], disabled: number[] = []) {
    putText(g, 4, 2, title, "#7CFC00");
    const cols = g[0].length;
    // Touch: whole screen is a menu-gesture surface (tap items, swipe ←/→).
    this.input.menuActive = true;
    // Rebuild hit-boxes fresh each frame (see Input.endFrame() comment).
    this.input.menuItemRects.length = 0;
    items.forEach((it, i) => {
      const sel = i === this.menuCursor;
      const dis = disabled.includes(i);
      const row = 5 + i * 2;
      const col = dis ? (sel ? "#666" : "#444") : (sel ? "#fff" : "#9fe");
      putText(g, 6, row, (sel ? "▸ " : "  ") + it, col);
      // Register hit-box spanning most of the row so a fat-fingered tap
      // still lands. Full row height, from left margin to right margin.
      this.input.menuItemRects.push({
        index: i,
        x: 2 * CELL_W,
        y: (row - 0.4) * CELL_H,
        w: (cols - 4) * CELL_W,
        h: CELL_H * 1.8,
      });
    });
    if (this.titleNotice) this.renderTitleNotice(g, 5 + items.length * 2 + 2);
    putText(g, 4, g.length - 2, "↑/↓ or tap   ENTER / swipe →   ESC / swipe ←", "#888");
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
      ship: 4, bullet: 0.5, comet: 2, nebula: 420, beacon: 3,
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
      if (dist2 > FAR_CULL * FAR_CULL && e.kind !== "star" && e.kind !== "nebula") continue;
      const x1 = cy * r.x - sy * r.z;
      const z1 = sy * r.x + cy * r.z;
      const y1 = cp * r.y - sp * z1;
      const z2 = sp * r.y + cp * z1;
      if (z2 <= 1) continue; // behind camera
      const sx = vpLeft + Math.floor(vw / 2 + (x1 / z2) * vw * 0.7);
      const sy2 = vpTop + Math.floor(vh / 2 + (y1 / z2) * vh * 0.7);
      const far = dist2 > FAR_DOT * FAR_DOT && e.kind !== "star";
      let wr = worldRadius[e.kind] ?? 1;
      if (e.kind === "star") wr *= starSizeMul(e);
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
          const spriteKey = (e.kind === "friendly" && e.faction === "patrol") ? "patrol" : e.kind;
          const variants = SHIP_SPRITES[spriteKey] ?? SHIP_SPRITES[e.kind];
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
        e.kind === "asteroid" ? (isWreck(e) ? "¦" : "%") : glyph;
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

      // 0.5.6 — Roche-limit deformation for small bodies (asteroids/comets/
      // meteors). If the entity sits within 2× the nearest planet's world
      // radius, perturb the edge threshold with a hash-driven per-cell
      // roughness so its silhouette reads as tidally-shredded rather than
      // a clean disc. Cheapest possible: seed roughness with `e.id`, `dx`,
      // `dy`, and a coarse time bucket for a slow shimmer.
      let rocheK = 0;
      if (e.kind === "asteroid" || e.kind === "comet") {
        let nearestPR = 0, nearestPD = Infinity;
        for (const q of this.entities) {
          if (q.kind !== "planet") continue;
          const dq = V.len(V.sub(q.pos, e.pos));
          if (dq < nearestPD) { nearestPD = dq; nearestPR = worldRadius.planet ?? 30; }
        }
        if (nearestPD < nearestPR * 3) {
          // Ramp from 0 at 3×R to ~0.28 at 1×R (inside surface).
          rocheK = Math.max(0, Math.min(0.28, (nearestPR * 3 - nearestPD) / (nearestPR * 3) * 0.28));
        }
      }
      const tBucket = rocheK > 0 ? Math.floor((typeof performance !== "undefined" ? performance.now() : 0) / 220) : 0;

      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const nx = dx / rx, ny = dy / ry;
          let d2 = nx * nx + ny * ny;
          if (rocheK > 0) {
            const rough = hash01(e.id * 1301 + dx * 613 + dy * 419 + tBucket * 11);
            d2 += (rough - 0.5) * rocheK;
          }
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

      // 0.5.6 — Colony overlay ring: populated planets get a faint dotted
      // orbital ring (`·`) just outside the sprite and a small `◈` beacon
      // tag at the top, so they read as inhabited at a glance without
      // waiting for the name label.
      if (e.kind === "planet" && e.populated) {
        const ringR = 1.15;
        const rrx = Math.max(2, Math.round(rx * ringR));
        const rry = Math.max(1, Math.round(ry * ringR));
        for (let dy = -rry; dy <= rry; dy++) {
          for (let dx = -rrx; dx <= rrx; dx++) {
            const nx = dx / rrx, ny = dy / rry;
            const d2 = nx * nx + ny * ny;
            if (d2 <= 1.02 || d2 > ringR * ringR) continue;
            // Sparse ring: only paint every ~3rd cell along the ring.
            if (hash01(e.id * 733 + dx * 191 + dy * 313) > 0.22) continue;
            const gx = sx + dx, gy = sy2 + dy;
            if (gx <= vpLeft || gx >= vpRight || gy <= vpTop || gy >= vpBottom) continue;
            if (g[gy][gx].ch !== " ") continue;
            g[gy][gx] = { ch: "·", color: "#ffd28a", glow: false };
          }
        }
        const bx = sx, by = sy2 - ry - 1;
        if (bx > vpLeft && bx < vpRight && by > vpTop && by < vpBottom) {
          g[by][bx] = { ch: "◈", color: "#ffd28a", glow: true };
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
      // "On-screen" means projected AND the sprite center is inside the
      // viewport with a little margin. If it projects off the viewport we
      // fall through to the edge-pointer branch — otherwise brackets get
      // silently clipped and the player sees no indicator at all.
      const onScreen =
        !!tproj &&
        tproj.sx > vpLeft + 1 && tproj.sx < vpRight - 1 &&
        tproj.sy > vpTop + 1 && tproj.sy < vpBottom - 1;
      if (tproj && onScreen) {
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
        // Only useful for ships (asteroids barely drift). Color flips to
        // bright green when the marker is within 2 cells of the reticle
        // (viewport center) — that's the "shoot NOW" window; otherwise it
        // stays a faint orange nudge so the pilot knows which way to lean.
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
              const reticleX = vpLeft + Math.floor(vw / 2);
              const reticleY = vpTop + Math.floor(vh / 2);
              const dxL = lp.sx - reticleX, dyL = lp.sy - reticleY;
              const onTarget = dxL * dxL + dyL * dyL <= 4; // ≤ 2 cells
              const cell = g[lp.sy][lp.sx];
              if (cell.ch === " " || cell.ch === "·" || cell.ch === ".") {
                g[lp.sy][lp.sx] = { ch: onTarget ? "✚" : "+", color: onTarget ? "#7CFC00" : "#ffaa55" };
              }
            }
          }
        }
      } else {
        // Off-screen edge pointer. Use the pure angular direction from the
        // camera's forward axis to the target (camera-space x1, y1) — this
        // is the *shortest* angular direction to sweep the reticle onto the
        // target, i.e. "closest direction" the pilot must turn. We do NOT
        // divide by z2 here: perspective division distorts the direction
        // for anything near the edges, and is meaningless when z2 ≤ 0.
        const rel = V.sub(tgt.pos, p.pos);
        const x1 = cy * rel.x - sy * rel.z;
        const z1 = sy * rel.x + cy * rel.z;
        const y1 = cp * rel.y - sp * z1;
        const z2 = sp * rel.y + cp * z1;
        const behind = z2 <= 1;
        let dx = x1;
        let dy = y1;
        if (behind) {
          // Target is behind the camera plane. There is no "closest" edge —
          // the shortest sweep is 180°. Radiate the arrow toward whichever
          // side of the screen the target is leaning on so the pilot at
          // least turns the right way.
          dx = -x1;
          dy = -y1;
        }
        // Degenerate (exactly on the camera axis): pick a stable default so
        // the arrow doesn't collapse to the center. Point down for behind,
        // right for ahead (arbitrary but consistent).
        if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
          if (behind) { dx = 0; dy = 1; }
          else { dx = 1; dy = 0; }
        }
        const cxV = vpLeft + vw / 2, cyV = vpTop + vh / 2;
        // Ray-to-rect: scale the (dx, dy) direction so it lands on the
        // viewport edge, hugging whichever axis it exceeds first.
        const halfW = Math.max(1, vw / 2 - 2);
        const halfH = Math.max(1, vh / 2 - 2);
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
        // Place label hugging the chosen edge — right side puts text inside.
        let lx = exC + 1;
        if (exC > vpLeft + vw * 0.6) lx = Math.max(vpLeft + 1, exC - label.length - 1);
        const ly = Math.max(vpTop + 1, Math.min(vpBottom - 1, eyC));
        g[eyC][exC] = { ch: arrow, color: bracketCol };
        putText(g, lx, ly, label, bracketCol, vpRight);
      }
    } else {
      this._bracketTargetId = null;
    }

    // Reticle — a faint crosshair at the viewport center marks where the
    // guns actually point and where mouse-steering pulls toward. Drawn last
    // over the world so it stays legible against stars/debris but under the
    // status banners.
    {
      const rcx = vpLeft + Math.floor(vw / 2);
      const rcy = vpTop + Math.floor(vh / 2);
      const marks: [number, number, string][] = [
        [rcx - 2, rcy, "-"],
        [rcx + 2, rcy, "-"],
        [rcx, rcy - 1, "|"],
        [rcx, rcy + 1, "|"],
        [rcx, rcy, "+"],
      ];
      for (const [mx, my, ch] of marks) {
        if (mx <= vpLeft || mx >= vpRight || my <= vpTop || my >= vpBottom) continue;
        const cell = g[my][mx];
        if (cell.ch === " " || cell.ch === "·" || cell.ch === ".") {
          g[my][mx] = { ch, color: "#3a5a3a" };
        }
      }
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






    // Crosshair. Color and glyph shape both configurable via Options ▸
    // Gameplay ▸ Reticle. Base color comes from options.reticleColor; the
    // range/lock feedback still overrides to amber / red so combat cues
    // remain readable regardless of the pilot's chosen tint.
    const ccx = vpLeft + Math.floor(vw / 2), ccy = vpTop + Math.floor(vh / 2);
    const reticleBase = ({
      green: "#3aff88", amber: "#fc6", cyan: "#7fd0ff",
      magenta: "#ff7fd0", white: "#eeeeee", red: "#ff8888",
    } as const)[this.options.reticleColor ?? "green"] ?? "#3a6";
    let reticleCol: string = reticleBase;
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
    const shape = this.options.reticleShape ?? "cross";
    if (shape === "cross") {
      putText(g, ccx - 1, ccy, "-+-", reticleCol);
      g[ccy - 1][ccx].ch = "|"; g[ccy - 1][ccx].color = reticleCol;
      g[ccy + 1][ccx].ch = "|"; g[ccy + 1][ccx].color = reticleCol;
    } else if (shape === "dot") {
      g[ccy][ccx].ch = "•"; g[ccy][ccx].color = reticleCol;
    } else if (shape === "brackets") {
      putText(g, ccx - 2, ccy, "[ ]", reticleCol);
      g[ccy][ccx].ch = "·"; g[ccy][ccx].color = reticleCol;
    } else if (shape === "circle") {
      putText(g, ccx - 1, ccy, "(+)", reticleCol);
    } else if (shape === "diamond") {
      g[ccy][ccx].ch = "◇"; g[ccy][ccx].color = reticleCol;
      g[ccy - 1][ccx].ch = "·"; g[ccy - 1][ccx].color = reticleCol;
      g[ccy + 1][ccx].ch = "·"; g[ccy + 1][ccx].color = reticleCol;
    }

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
    putText(g, panelX, vpTop + 10, `Speed ${(effectiveTopSpeed(p) * p.throttle).toFixed(0)} u/s`, "#9fe");
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

    // --- COMMS / chatter panel ---
    // Top-left overlay with All / Crew / External / System tabs. Filtered by
    // this.chatterTab, scrolled by this.chatterScroll (0 = newest pinned).
    // Header exposes clickable tabs and a [Hide] toggle that collapses the
    // whole panel to a single "[+] Show Comms" button.
    const inNeb = (this as unknown as { _inNebula?: boolean })._inNebula === true;
    const nowS = performance.now() / 1000;
    const commsX = 2;
    const commsY = 1;
    const commsW = Math.max(28, Math.min(120, this.options.commsCols ?? 54));
    const commsRows = Math.max(4, Math.min(30, this.options.commsRows ?? 12));
    const wrap = !!this.options.commsWrap;

    // Mouse-click helpers. We resolve the cursor to a cell once and consume
    // mouseClicked when we hit any of our hotspots so downstream UI (codex
    // link, etc.) doesn't double-process it.
    const mgx = this.input.mouseCX / CELL_W;
    const mgy = this.input.mouseCY / CELL_H;
    const clickIn = (x: number, y: number, w: number, h = 1): boolean => {
      if (!this.input.mouseClicked || !this.input.mouseInside) return false;
      if (mgx < x || mgx >= x + w || mgy < y || mgy >= y + h) return false;
      this.input.mouseClicked = false;
      return true;
    };

    // Collapsed state — draw only the "Show Comms" pill and bail out.
    if (this.commsHidden) {
      const pill = "[+] Show Comms";
      putText(g, commsX, commsY, pill, "#7CFC00");
      if (clickIn(commsX, commsY, pill.length)) {
        this.commsHidden = false;
      }
      this._commsRect = { x: commsX, y: commsY, w: pill.length, h: 1 };
    } else {

    // Header row with tabs.
    const titleCol = inNeb ? "#c47afc" : "#7CFC00";
    const commsTitle = inNeb ? "[ CO▓M░S ]" : "[ COMMS ]";
    putText(g, commsX, commsY, commsTitle, titleCol);
    const tabs: { id: Voidwake["chatterTab"]; label: string }[] = [
      { id: "all",      label: "All" },
      { id: "crew",     label: "Crew" },
      { id: "external", label: "Ext" },
      { id: "system",   label: "Sys" },
    ];
    let tx = commsX + commsTitle.length + 1;
    for (const t of tabs) {
      const active = this.chatterTab === t.id;
      const lbl = active ? `[${t.label}]` : ` ${t.label} `;
      putText(g, tx, commsY, lbl, active ? "#ffe066" : "#7aa");
      if (clickIn(tx, commsY, lbl.length)) {
        this.chatterTab = t.id;
        this.chatterScroll = 0;
      }
      tx += lbl.length + 1;
    }
    // [Hide] button — right side of the header row within the panel width.
    const hideLbl = "[Hide]";
    const hideX = commsX + Math.max(tx - commsX, commsW - hideLbl.length);
    putText(g, hideX, commsY, hideLbl, "#fc6");
    if (clickIn(hideX, commsY, hideLbl.length)) {
      this.commsHidden = true;
    }
    // Publish the comms rect so the wheel handler can route scroll here
    // when the cursor is over the panel (header + rows + hint row).
    this._commsRect = { x: commsX, y: commsY, w: commsW, h: commsRows + 2 };
    // Filter feed to the active tab.
    const feed = this.chatter.filter((c) =>
      this.chatterTab === "all" ? true : c.channel === this.chatterTab);
    // Word-wrap helper: split a line into commsW-wide chunks on word
    // boundaries when possible; falls back to hard-splitting super-long
    // tokens so a word never overflows the panel.
    const wrapLine = (raw: string): string[] => {
      if (!wrap) {
        return [raw.length > commsW ? raw.slice(0, commsW - 1) + "…" : raw];
      }
      const chunks: string[] = [];
      const words = raw.split(/(\s+)/);
      let cur = "";
      for (const w of words) {
        if ((cur + w).length <= commsW) { cur += w; continue; }
        if (cur) chunks.push(cur.trimEnd());
        cur = "";
        let rest = w.trimStart();
        while (rest.length > commsW) {
          chunks.push(rest.slice(0, commsW));
          rest = rest.slice(commsW);
        }
        cur = rest;
      }
      if (cur) chunks.push(cur.trimEnd());
      return chunks.length ? chunks : [""];
    };
    // Build the visible-line buffer (post-wrap) so scroll math is in
    // rendered rows, not raw messages.
    const rendered: { text: string; color: string; entry: number }[] = [];
    for (let e = 0; e < feed.length; e++) {
      const c = feed[e];
      const age = nowS - c.t;
      const dim = age > 25 ? "#555" : age > 10 ? "#888" : c.color;
      const parts = wrapLine(`«${c.who}» ${c.msg}`);
      for (const part of parts) rendered.push({ text: part, color: dim, entry: e });
    }
    const maxScroll = Math.max(0, rendered.length - commsRows);
    if (this.chatterScroll > maxScroll) this.chatterScroll = maxScroll;
    for (let i = 0; i < commsRows; i++) {
      const idx = i + this.chatterScroll;
      if (idx >= rendered.length) break;
      let line = rendered[idx].text;
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
      putText(g, commsX, commsY + 1 + i, line, rendered[idx].color);
    }
    // Scroll indicators + hint on the last row of the panel.
    const hintY = commsY + commsRows + 1;
    if (rendered.length > commsRows) {
      const total = rendered.length;
      const shown = Math.min(commsRows, total - this.chatterScroll);
      const from = this.chatterScroll + 1;
      const to   = this.chatterScroll + shown;
      putText(g, commsX, hintY, `▲/▼ ${from}-${to} / ${total}  (\\ tab · PgUp/Dn or wheel)`, "#557");
    } else if (rendered.length === 0) {
      putText(g, commsX, hintY, `(quiet)  \\ tab · wheel scroll · Home newest`, "#446");
    } else {
      putText(g, commsX, hintY, `\\ tab · wheel/PgUp/Dn scroll · Home newest`, "#446");
    }
    } // end !commsHidden


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
    putText(g, 2, rows - 1, "W/S thr  A/D yaw  Q/E pit  SHIFT boost  SPC fire  T tgt  [/] kind  M mine  F dock  J jett  O auto  U log  L legend  K pin  \\ comms  P pause  ESC menu" + gunnerHint + autoHint, "#666");

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

    // Nebula fog overlay — pronounced coloured haze whenever the ship is
    // physically inside a nebula cloud. Uses three glyph/tint bands so it
    // looks like layered gas rather than a single flat speckle, and includes
    // a pulsing corner tag so the player knows why sensors are misbehaving.
    const inNeb2 = (this as unknown as { _inNebula?: boolean })._inNebula;
    if (inNeb2) {
      const glyphs = ["░", "▒", "·", "∴", "▓"];
      const tints = ["#5a3a7a", "#7a4aa0", "#9a6acc", "#3a5aa0", "#c47afc"];
      // Density scales with viewport area so the effect reads on any canvas.
      const density = Math.min(220, Math.floor((vw * vh) / 22));
      for (let i = 0; i < density; i++) {
        const x = vpLeft + 1 + Math.floor(Math.random() * (vw - 2));
        const y = vpTop + 1 + Math.floor(Math.random() * (vh - 2));
        const row = g[y]; if (!row) continue;
        const cell = row[x]; if (!cell) continue;
        // Overwrite empties and softly veil dim glyphs; leave bright HUD alone.
        if (cell.ch === " " || Math.random() < 0.15) {
          row[x] = {
            ch: glyphs[(Math.random() * glyphs.length) | 0],
            color: tints[(Math.random() * tints.length) | 0],
          };
        }
      }
      // Pulsing status tag lower-centre of viewport.
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260);
      const tag = "▒ NEBULA WASH — sensors degraded ▒";
      const tx = vpLeft + Math.floor(vw / 2 - tag.length / 2);
      const ty = vpTop + vh - 2;
      const col = pulse > 0.75 ? "#c47afc" : "#7a4aa0";
      putText(g, tx, ty, tag, col);
    }


    // Pause banner (big, centered, obvious)
    if (this.paused) {
      const msg = "‖ PAUSED — press P to resume";
      putText(g, vpLeft + Math.floor(vw / 2 - msg.length / 2), vpTop + Math.floor(vh / 2) - 1, msg, "#ffcc33");
      const t = Math.floor(this._sessionTime ?? 0);
      const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
      const pad = (n: number) => (n < 10 ? "0" + n : String(n));
      const stamp = `session ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
      putText(g, vpLeft + Math.floor(vw / 2 - stamp.length / 2), vpTop + Math.floor(vh / 2) + 1, stamp, "#7a8a9a");
      const p2 = this.player;
      if (p2) {
        const cargoQty = Object.values(p2.cargo ?? {}).reduce((a: number, c) => a + (Number(c) || 0), 0);
        const stats = `${p2.credits | 0} cr · ${p2.kills ?? 0} kills · ${cargoQty} cargo`;
        putText(g, vpLeft + Math.floor(vw / 2 - stats.length / 2), vpTop + Math.floor(vh / 2) + 2, stats, "#5a6a7a");
      }
    }

    // Touch controls overlay (virtual stick + throttle strip + button pad).
    if (this._touchControlsActive()) this._renderTouchOverlay(g);

    this.tickMissions();
  }

  // Renders the virtual controller overlay and registers per-frame hit-boxes
  // on the Input class so pointerdown can dispatch button presses. Coordinates
  // are computed from the current grid dimensions so the layout stays put
  // whether the canvas is 800×600 (phone portrait) or 1400×900 (tablet).
  private _renderTouchOverlay(g: Cell[][]) {
    const kb = this.options.keybinds;
    const cols = g[0].length;
    const rows = g.length;
    const cw = CELL_W, ch = CELL_H;
    // Rebuild hit-boxes fresh each frame (see Input.endFrame() comment).
    this.input.buttonRects.length = 0;
    // Virtual stick: bottom-left circle indicator (rendered by dot glyphs).
    const stickCx = 6, stickCy = rows - 5;
    const stickR = 3;
    const drawRing = (cx: number, cy: number, r: number, glyph: string, color: string) => {
      for (let a = 0; a < 24; a++) {
        const th = (a / 24) * Math.PI * 2;
        const gx = Math.round(cx + Math.cos(th) * r * 1.6);
        const gy = Math.round(cy + Math.sin(th) * r);
        if (gy >= 0 && gy < rows && gx >= 0 && gx < cols) g[gy][gx] = { ch: glyph, color };
      }
    };
    drawRing(stickCx, stickCy, stickR, "·", "#4a6a80");
    // Show current stick knob position if active.
    if (this.input.stickActive) {
      const t = this._touchStick;
      const kx = Math.round(stickCx + t.yaw * stickR * 1.6);
      const ky = Math.round(stickCy + t.pitch * stickR);
      if (ky >= 0 && ky < rows && kx >= 0 && kx < cols) g[ky][kx] = { ch: "◉", color: "#9be" };
    } else {
      if (stickCx >= 0 && stickCx < cols && stickCy >= 0 && stickCy < rows) g[stickCy][stickCx] = { ch: "+", color: "#7a8a9a" };
    }
    putText(g, stickCx - 3, stickCy + stickR + 1, "STICK", "#5a6a7a");

    // Throttle strip: 2-column column on the far left.
    const trCol = 0;
    const trTop = Math.floor(rows * 0.18);
    const trBottom = Math.floor(rows * 0.82);
    const p = this.player;
    const thr = p ? p.throttle : 0;
    for (let y = trTop; y <= trBottom; y++) {
      g[y][trCol] = { ch: "│", color: "#3a4a5a" };
    }
    const knobY = Math.round(trBottom - thr * (trBottom - trTop));
    if (knobY >= 0 && knobY < rows) g[knobY][trCol] = { ch: "◄", color: "#7CFC00" };
    putText(g, trCol, trTop - 1, "THR", "#5a6a7a");

    // Button pad: bottom-right cluster. Each is a 5×3 tile with a label.
    const btnW = 6, btnH = 3;
    // Layout: two rows of buttons in the lower-right quadrant.
    const btns = [
      { id: kb.fire,        label: "FIRE" },
      { id: kb.mine,        label: "MINE" },
      { id: kb.dock,        label: "DOCK" },
      { id: kb.cycleTarget, label: "TGT " },
      { id: kb.cycleCatPrev, label: " [  " },
      { id: kb.cycleCatNext, label: " ]  " },
      { id: kb.boost,       label: "BOOST"},
      { id: kb.jettison,    label: "JETT" },
      { id: kb.autopilot,   label: "AUTO" },
      { id: kb.toggleGunner, label: "GUN " },
      { id: kb.legend,      label: "CDX " },
      { id: kb.pause,       label: "PAUS" },
      { id: kb.menu,        label: "MENU" },
    ];
    // Arrange from bottom-right upward in a 2-wide column of buttons.
    const rightCol = cols - btnW - 1;
    let x = rightCol, y = rows - btnH - 1;
    let col = 0;
    for (const b of btns) {
      const bx = x, by = y;
      // Draw a bordered box.
      for (let dy = 0; dy < btnH; dy++) {
        for (let dx = 0; dx < btnW; dx++) {
          const gx = bx + dx, gy = by + dy;
          if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
          const edge = dx === 0 || dx === btnW - 1 || dy === 0 || dy === btnH - 1;
          const held = this.input.keys.has(b.id);
          g[gy][gx] = { ch: edge ? "·" : " ", color: held ? "#9be" : "#3a4a5a" };
        }
      }
      putText(g, bx + 1, by + 1, b.label, this.input.keys.has(b.id) ? "#fff" : "#9fe");
      // Register hit-box in canvas CSS pixels.
      this.input.buttonRects.push({ id: b.id, x: bx * cw, y: by * ch, w: btnW * cw, h: btnH * ch });
      // Move up. Two columns wide.
      y -= btnH + 1;
      if (y < Math.floor(rows * 0.35)) {
        col++;
        x -= btnW + 1;
        y = rows - btnH - 1;
      }
      if (col >= 2) break;
    }
  }



  renderRadar(g: Cell[][], x: number, y: number, w: number, h: number) {
    const p = this.player; if (!p) return;
    // Radar range in world units. Crew (Pilot/Engineer) and the Sensor
    // Array module extend it — see effectiveRadarRange. Same value drives
    // both the culling test below and the scale label rendered in the
    // title bar so they never disagree.
    const radarRange = effectiveRadarRange(p);
    // Border + title. Range readout tucked in the title bar so the sweep
    // area stays uncluttered; players kept asking "what's the scale?"
    putText(g, x, y, `[ RADAR  ${radarRange}u ]`, "#7CFC00");
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
  // (sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)). Valid at any
  // pitch — including looped-over-the-top values in (-π, π].
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { x: sy * cp, y: sp, z: cy * cp };
}

// Wrap an angle in radians into (-π, π]. Used to let pitch loop over the
// top / under the bottom continuously instead of clamping at ±π/2 — a real
// spacecraft has no absolute "up", so a full pitch rotation is expected.
function wrapPi(a: number): number {
  const TAU = Math.PI * 2;
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a;
}

// Hash function exported for tooling tests; otherwise unused.
export const _internals = { hashString, mulberry32 };
