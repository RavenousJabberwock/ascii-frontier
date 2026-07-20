// =============================================================================
// Lua host (0.5.5) — sandboxed fengari-web runtime for the scripting hook API.
// -----------------------------------------------------------------------------
// Wires user-authored Lua 5.3 scripts to the `dispatchHook` callsites defined
// in voidwake.ts. Keep the surface tight:
//
//   frontier.version        — engine VERSION string
//   frontier.log(msg)       — pushes a system log line (single-tab, "System")
//   frontier.chat(w,m,c?)   — pushes a Comms line as speaker `w`, message `m`,
//                             optional CSS color `c` (defaults to #9fe).
//   frontier.on(name, fn)   — registers a Lua callback for a script hook. The
//                             payload arrives as a shallow Lua table with
//                             primitive leaves (numbers/strings/booleans).
//                             Nested objects deeper than depth 2 are
//                             stringified so scripts never see live JS refs.
//
// The sandbox nulls `io`, `package`, `debug`, `require`, `dofile`, `loadfile`,
// `load`, `loadstring`, and `collectgarbage`. `os` is replaced with a
// timing-only stub (`os.time`, `os.clock`). Scripts cannot open sockets,
// read/write files, mutate JS globals, or call `eval` — every JS-side call is
// through an explicit `frontier.*` binding.
//
// Errors from a script (load, top-level run, per-hook invocation) are trapped,
// stored on `LuaHost.lastError`, and echoed to the pushLog bridge so the
// Options ▸ Scripting menu can surface them. A throwing hook can never take
// down an engine tick.
//
// Mutation API (spawn/despawn/pushChatter/etc. writable) is the next
// milestone — see plan.md ▸ "Modding roadmap".

import { lua, lauxlib, lualib, to_luastring } from "fengari-web";
import {
  registerScriptHook,
  type ScriptHookName,
} from "./voidwake";

const HOOK_NAMES: ScriptHookName[] = [
  "onWorldGenerate", "onTick", "onPlayerFire", "onPlayerDock",
  "onEntityDestroyed", "onChatter", "onSave", "onLoad", "onPlanetLand",
];

export interface LuaHostBridge {
  pushLog: (msg: string) => void;
  pushChatter: (who: string, msg: string, color?: string) => void;
  // 0.5.7 — M2 mutation API. Scripts can nudge player state via a narrow,
  // audited surface. All mutators are optional so older bridges keep working.
  addCredits?: (delta: number) => number | null;   // returns new balance, or null if no player
  addFuel?:    (delta: number) => number | null;   // returns new fuel, or null if no player
  getPlayerSnapshot?: () => Record<string, unknown> | null;
  // 0.7.0 — expanded M2 surface + M3/M4 read-only content hooks.
  addXp?:      (delta: number) => number | null;
  addOre?:     (delta: number) => number | null;
  worldTime?:  () => number;                       // seconds since engine start (or Date.now/1000)
  worldSeed?:  () => number;
  listEntities?: (filter?: { kind?: string; faction?: string; max?: number }) => Array<Record<string, unknown>>;
  getEntity?:  (idx: number) => Record<string, unknown> | null;
  chatterAdd?: (kind: string, line: string) => boolean;   // append a template line; returns true if kind is known
  installedMods?: () => Array<{ id: string; name: string; enabled: boolean }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;

export class LuaHost {
  private L: L = null;
  private unsubs: Array<() => void> = [];
  lastError: string | null = null;
  loaded = false;

  constructor(private bridge: LuaHostBridge, private version: string) {}

  dispose(): void {
    for (const off of this.unsubs) { try { off(); } catch { /* noop */ } }
    this.unsubs = [];
    if (this.L) {
      try { lua.lua_close(this.L); } catch { /* noop */ }
    }
    this.L = null;
    this.loaded = false;
  }

  /** Load and run a fresh Lua source. Returns { ok, error }. */
  load(source: string): { ok: boolean; error?: string } {
    this.dispose();
    this.lastError = null;

    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    this.L = L;

    // --- sandbox: null the dangerous libs and loaders --------------------
    const nullGlobal = (name: string) => {
      lua.lua_pushnil(L);
      lua.lua_setglobal(L, to_luastring(name));
    };
    for (const n of ["io", "package", "debug", "dofile", "loadfile", "load",
                     "loadstring", "require", "collectgarbage"]) {
      nullGlobal(n);
    }
    // Replace `os` with a timing-only stub.
    lua.lua_newtable(L);
    lua.lua_pushjsfunction(L, () => { lua.lua_pushnumber(L, Date.now() / 1000); return 1; });
    lua.lua_setfield(L, -2, to_luastring("time"));
    lua.lua_pushjsfunction(L, () => { lua.lua_pushnumber(L, performance.now() / 1000); return 1; });
    lua.lua_setfield(L, -2, to_luastring("clock"));
    lua.lua_setglobal(L, to_luastring("os"));

    // --- frontier.* API --------------------------------------------------
    lua.lua_newtable(L);
    lua.lua_pushliteral(L, this.version);
    lua.lua_setfield(L, -2, to_luastring("version"));

    lua.lua_pushjsfunction(L, (Ls: L) => {
      const s = lua.lua_tojsstring(Ls, 1) ?? "";
      this.bridge.pushLog(String(s));
      return 0;
    });
    lua.lua_setfield(L, -2, to_luastring("log"));

    lua.lua_pushjsfunction(L, (Ls: L) => {
      const w = lua.lua_tojsstring(Ls, 1) ?? "Script";
      const m = lua.lua_tojsstring(Ls, 2) ?? "";
      const c = lua.lua_type(Ls, 3) === lua.LUA_TSTRING ? lua.lua_tojsstring(Ls, 3) : "#9fe";
      this.bridge.pushChatter(String(w), String(m), c ?? "#9fe");
      return 0;
    });
    lua.lua_setfield(L, -2, to_luastring("chat"));

    // --- M2 mutation API (0.5.7) ---------------------------------------
    // Narrow, safe writes to the running game. Each mutator returns the
    // resulting number so scripts can react (e.g. warn on empty fuel).
    lua.lua_pushjsfunction(L, (Ls: L) => {
      const d = lua.lua_tonumber(Ls, 1);
      const r = this.bridge.addCredits?.(Number(d) || 0) ?? null;
      if (r == null) lua.lua_pushnil(Ls); else lua.lua_pushnumber(Ls, r);
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("addCredits"));

    lua.lua_pushjsfunction(L, (Ls: L) => {
      const d = lua.lua_tonumber(Ls, 1);
      const r = this.bridge.addFuel?.(Number(d) || 0) ?? null;
      if (r == null) lua.lua_pushnil(Ls); else lua.lua_pushnumber(Ls, r);
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("addFuel"));

    lua.lua_pushjsfunction(L, (Ls: L) => {
      const snap = this.bridge.getPlayerSnapshot?.() ?? null;
      pushJsAsLua(Ls, snap, 0);
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("player"));

    lua.lua_pushjsfunction(L, (Ls: L) => {
      const nameStr = lua.lua_tojsstring(Ls, 1) ?? "";
      const name = String(nameStr) as ScriptHookName;
      if (!HOOK_NAMES.includes(name)) {
        return lauxlib.luaL_error(Ls, to_luastring(`frontier.on: unknown hook '${nameStr}'`));
      }
      if (lua.lua_type(Ls, 2) !== lua.LUA_TFUNCTION) {
        return lauxlib.luaL_error(Ls, to_luastring("frontier.on: expected function as arg 2"));
      }
      // Ref the callback in the registry so we can call it later.
      lua.lua_pushvalue(Ls, 2);
      const ref = lauxlib.luaL_ref(Ls, lua.LUA_REGISTRYINDEX);
      const off = registerScriptHook(name, (payload) => {
        if (!this.L) return; // disposed between register and dispatch
        try {
          lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);
          pushJsAsLua(this.L, payload, 0);
          const rc = lua.lua_pcall(this.L, 1, 0, 0);
          if (rc !== lua.LUA_OK) {
            const err = lua.lua_tojsstring(this.L, -1) ?? "(unknown lua error)";
            this.lastError = `hook ${name}: ${err}`;
            this.bridge.pushLog(`[script] ${this.lastError}`);
            lua.lua_pop(this.L, 1);
          }
        } catch (e) {
          this.lastError = `hook ${name}: ${String(e)}`;
        }
      });
      this.unsubs.push(off);
      return 0;
    });
    lua.lua_setfield(L, -2, to_luastring("on"));

    lua.lua_setglobal(L, to_luastring("frontier"));

    // --- run script ------------------------------------------------------
    const loadStatus = lauxlib.luaL_loadstring(L, to_luastring(source));
    if (loadStatus !== lua.LUA_OK) {
      const err = lua.lua_tojsstring(L, -1) ?? "(load error)";
      this.lastError = `load: ${err}`;
      this.dispose();
      return { ok: false, error: this.lastError };
    }
    const runStatus = lua.lua_pcall(L, 0, 0, 0);
    if (runStatus !== lua.LUA_OK) {
      const err = lua.lua_tojsstring(L, -1) ?? "(run error)";
      this.lastError = `run: ${err}`;
      this.dispose();
      return { ok: false, error: this.lastError };
    }
    this.loaded = true;
    return { ok: true };
  }
}

/**
 * Shallow JS → Lua conversion. Depth-capped at 2 to prevent scripts from
 * receiving live entity handles or deeply-nested state trees. Functions are
 * skipped entirely. Beyond depth 2, values are stringified.
 */
function pushJsAsLua(L: L, v: unknown, depth: number): void {
  if (v === null || v === undefined) { lua.lua_pushnil(L); return; }
  const t = typeof v;
  if (t === "number") { lua.lua_pushnumber(L, v as number); return; }
  if (t === "boolean") { lua.lua_pushboolean(L, (v as boolean) ? 1 : 0); return; }
  if (t === "string") { lua.lua_pushstring(L, to_luastring(v as string)); return; }
  if (depth >= 2) { lua.lua_pushstring(L, to_luastring(String(v))); return; }
  if (Array.isArray(v)) {
    lua.lua_createtable(L, v.length, 0);
    for (let i = 0; i < v.length; i++) {
      pushJsAsLua(L, v[i], depth + 1);
      lua.lua_rawseti(L, -2, i + 1);
    }
    return;
  }
  if (t === "object") {
    lua.lua_newtable(L);
    for (const k of Object.keys(v as object)) {
      const val = (v as Record<string, unknown>)[k];
      if (typeof val === "function") continue;
      pushJsAsLua(L, val, depth + 1);
      lua.lua_setfield(L, -2, to_luastring(k));
    }
    return;
  }
  lua.lua_pushnil(L);
}
