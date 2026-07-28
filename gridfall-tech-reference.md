# GRIDFALL — Technical Reference

*A living map of the code, kept in sync with `game.html` so we don't have to re-read the whole
file each session. Pair with `gridfall-design.md` (the "why/what") — this doc is the "how/where".*

**Last updated:** 2026-07-23 · **Describes:** `game.html` (v3 — combat core through D½/E plus
Phase F/G: a real scene manager and the first mini-dungeon map — Tiangong Station Sector 1, 9
hand-authored nodes, Talos Systems as a 2nd faction, a boss ("The Warden"), no-heal-between-fights
run persistence — plus Phase H1: a Title scene and a real `localStorage` save/load engine, Phase H2:
a player-named starting hero + a persistent `roster` driving the squad-builder, Phase H3: the
story-mode prologue "Kharon's Reach" — a `DUNGEONS` registry (multi-dungeon support), a reusable
story-scene component, and a hand-scripted 4-node escape dungeon — and Phase H4: the Town scene
("the Long Shot," the general dungeon-return hub), a generalized Character Sheet + a new Party
Inventory screen, and Sector 1 reframed as "dungeon 2" with a new mandatory recruit node — plus a
post-H4 tightening pass (story text, Wren's node position, difficulty, Limit Break pacing) and
Phase H5 (Party Inventory made actionable, Character Sheet Stats grown into a real overview, item
effects shown inline). Phase H (Title, roster & town) is now fully shipped, H1–H5.
**Update this doc whenever the code's structure, schemas, or conventions change.**

---

## 1. File shape

**Combat layout (FF-style):** `#game` is a **viewport-height flex column** (`height: calc(100vh-24px)`)
so the action menu + log stay pinned and visible. `#battle` (flex column, set to `display:flex` in
`showBattle`) holds `#battlefield` (`flex:1; overflow-y:auto` — scrolls internally when crowded; two
`.field-col` columns: `#enemy-col` LEFT, `#hero-col` RIGHT; stacks under `max-width:560px`), then
`#turn-banner`, `#actions`, `#log` (all `flex:none`), then post-battle `#endbar` / `#character-panel`.
Panels are compact so it fits ~620px viewports. `#battle` itself also has `overflow-y:auto` as a
safety net — if the endbar or skills panel grow tall, `#battle` scrolls internally rather than
pushing content past `#game`'s fixed height (verified: `pageScrollNeeded` stays false).
Heroes named from `HERO_NAMES` in pick order. Full FF bottom-band (party-status window + command menu
+ sprites) is a later overhaul (design §8.1).

**Visual / layout validation (how to actually SEE the UI):** headless jsc validates *logic only* — no
CSS/render. To verify layout: `python3 -m http.server <port>` in the game dir (the extension **cannot**
open `file://`), navigate Chrome (claude-in-chrome) to `http://localhost:<port>/game.html`, then use
`javascript_tool` to `deploy()` and read `getBoundingClientRect()` geometry. **Screenshots via the
extension currently time out** ("script injection timed out") — rely on DOM measurement. Window won't
shrink below ~606px on Mac, so true phone (<560px) layout is still unverified without device emulation.

`game.html` + **five sibling `.js` files** (split out 2026-07-23, Phase I refactor — was one
self-contained file; see §11 changelog). Still build-free and double-click-to-run:
1. **HTML** (`game.html` `<body>`) — a `#game` wrapper holding `#title-scene` (Title, Phase H1 —
   Start / Saved Game; note the element id is `title-scene`, since `#title` is already the
   always-visible "GRIDFALL" masthead `<h1>` above all four scenes), `#select` (character select),
   `#map` (the dungeon map, Phase G), and `#battle` (the battlefield: `#enemies`, `#party`,
   `#turn-banner`, `#actions`, `#log`). Exactly one of the four scene containers is visible at a
   time, via `goToScene(name)` (Phase F's scene manager, extended Phase H1 — see §4 D/D2).
2. **CSS** (`<style>` in `game.html`'s `<head>`) — "space terminal" theme, all CSS, no images.
3. **JS** — five **classic** (NOT ES-module) `<script src>` files, loaded in this order at the end
   of `game.html`'s `<body>`, each with its own `"use strict"`:
   - **`data.js`** — Section A: all data tables + constants (SKILLS, CLASSES, ENEMIES, ITEMS,
     DUNGEONS, SPRITE_SHAPES/SPRITES, affinity/status/tier constants…).
   - **`state.js`** — Sections B (mutable globals) + C (helpers).
   - **`ui.js`** — Sections D/D2/D3 (Title/Save/Select, Map, Town screens) + E (battlefield panels,
     the sprite-drawing engine, the log, the action bar).
   - **`engine.js`** — Sections F (combat core) + G (targeting) + H (turn flow / AI) + I (startup,
     run, leveling).
   - **`main.js`** — the entry point, just `showTitle()`.
   Classic scripts share **one global lexical scope**, so the split is purely organizational — a
   `const`/`function` in one file is visible to the others at call time. Load order matters only
   because `main.js` executes `showTitle()` at load; every other file is pure declarations. ES-module
   `import` is deliberately avoided (browsers block it over `file://`); classic `<script src>` loads
   fine over `file://`, keeping double-click-to-run working.

**Gotcha for tooling:** `game.html`'s top comment contains the word "script" in prose — irrelevant
now that the JS is external, but the balance sim **concatenates the five `.js` files** rather than
extracting an inline block (see §9).

---

## 2. Data schemas (the data-driven core)

All content is data read by a small engine. Shapes as they exist today:

**SKILLS[key]** — every action (hero, enemy, item):
```
{ name, enCost, kind: "attack" | "heal", target, power, message }
  target: "enemy" | "ally" | "self" | "allEnemies" | "allAllies"   (RELATIVE to the user)
  power:  for "attack" = bonus added to attacker.attack; can be negative (AoE softeners)
          for "heal"   = HP restored
  message: verb phrase for the log, e.g. "fires at" → "Merc fires at Spider Drone A — 11 damage!"
```
Damaging skills also carry **`damageType`** — one of 8 flavors: `kinetic`, `corrosive`, `thermal`,
`shock`, `cyber`, `psionic`, `void`, `gravity`. **(2026-07-26 battle-mechanics overhaul, design doc
§3.2a/§3.7, corrected 2026-07-28, SPEC ONLY — not yet built.)** `damageType` is checked against the
target's `affinities` in `applyToTarget`, but NOT directly — it resolves through
`DAMAGE_TYPE_CATEGORY[damageType]` first, which maps each of the 8 flavors to one of 4 resistance
buckets: `kinetic`/`corrosive` → `physical`; `thermal` → `thermal` (its own bucket); `shock`/`cyber` →
`shock`; `psionic` → `mind`; `void`/`gravity` → `exotic` (a non-numeric category — see below). This is
what lets a skill keep its full flavor-word vocabulary and message text while the actual resistance math
only has 4 numbers to track. `gravity` is new (see §5 for its pierce-based DEF-ignore). Also new:
`drain` (0-1, attack skills only) — heals the actor for that fraction of damage dealt.
Heals have no `damageType`. Skills may also have **`kind: "status"`** (no damage/heal, pure effect)
and an **`applies: [{ type, magnitude, duration }, ...]`** array of status effects to lay on the
target (see STATUSES). Example: `terror` = `{kind:"status", target:"enemy", applies:[{type:"confuse",…}]}`.
Attack skills may carry **`pierce`** (0–1) — the fraction of the target's DEF ignored (armor-piercing).

**CLASSES[key]** — playable class template:
```
{ className, race, role, baseStats: { hp, en, attack, defense, speed }, skills: [skillKey,...] }
```

**ENEMIES[key]** — enemy template:
```
{ typeName, role, nature, tier, baseStats: {...}, skills: [skillKey,...], affinities: {...} }
```
`tier` ∈ `fodder | standard | elite | boss`. Current roster: Tiangong `spiderDrone`/`hullRoach`
(fodder — Hull Roach is the one unbranded pest), `arcSentinel`/`tiangongPvt` (standard),
`securityMech`/`tiangongLt` (elite); Talos Systems (Phase G, §5.1 — organic, Corrosive/Thermal,
uniformly weak Psionic) `talosWraith` (fodder), `talosPhantom` (standard), `talosVanguard` (elite);
and the dungeon boss `warden` (tier `boss`, synthetic, same profile shape as Security Mech — resist
Kinetic **removed** after sim testing, see §9 note — weak Shock, doubly-weak Cyber, hard-resist
Psionic). Note: an enemy's **first attack skill is its basic** (so `arcSentinel` uses a Shock
`arcBolt` basic); the AI treats the rest as specials. (Key `squadLeader` was renamed `tiangongLt`.)
Kharon's Reach (Phase H3, §5.2a): `colonyGuard` (fodder, organic Tiangong enforcer — `attack` basic
+ `batonStrike` special) and `krell` ("Overseer Krell," tier `boss`, organic — kit `attack` +
`ironDiscipline` (Weaken) + `overseersLash` (heavy single-target, pierce) + `overseersCrackdown`
(Kinetic AoE); NOT drawn from `ENEMY_POOLS` — see `rollPrologueEncounter`, §4 I).
Site Erebus (Phase L, §5.3): `erebusRoach` (fodder, Corrosive), `erebusWarrior` (standard, Corrosive
+ Sunder), `erebusShaman` (standard, Psionic + Confuse — hard-resists Psionic itself, weak Kinetic),
`erebusArmoredWarrior` (elite, resist Kinetic — the counter-pick fight, same shape as Security Mech),
`broodmarshal` ("The Broodmarshal," tier `boss`, organic — kit `marshalClaws`/`hiveCommand`/
`marshalRend`/`psychicDominion`; hard-resists Psionic, weak Thermal, deliberately NOT Kinetic-
resistant per the Warden lesson, §9). All uniformly weak Psionic/Thermal except where noted, echoing
Talos's affinity profile ahead of ever reaching Talos territory. NOT drawn from `ENEMY_POOLS` — see
`rollErebusEncounter`, §4 I. `broodmarshal` also carries `reinforceAt: 0.5` and `reinforceWave:
[{key,count},...]` — see the new reinforcement-hook entry below.

**Boss reinforcement hook (Phase L, §5.3) — generic, not Broodmarshal-specific.** An ENEMIES template
may declare `reinforceAt` (fraction of maxHp) and `reinforceWave` (`[{key, count}, ...]`); `createEnemy`
copies both plus a fresh `reinforced: false` onto the combatant. Checked in `applyToTarget`'s attack
branch, after damage resolves: the first time an enemy with a `reinforceWave` drops to/below
`reinforceAt` HP, `reinforced` flips true and `spawnReinforcements(target)` (§4 F/I) pushes a fresh
wave into the live `enemies` array (letter-continuing from whatever's already in play, dead or alive)
and calls `renderCombatants()`/`updateScreen()`. New arrivals don't act until the next round —
initiative only rebuilds at `startRound()` — which reads as "the hive answers a call," not a same-
round ambush. Any future boss can reuse this by just adding the two template fields; no new engine
branch needed. The Broodmarshal fight also renders a one-time "Jam the Relay" action (`renderActions`,
§4 E) that sets `reinforced = true` directly — jamming early means the HP-threshold check finds
`reinforced` already true and never fires. No separate flag was needed for this.

**ENEMY_POOLS** (Phase G, §5.1) — `{ fodder: [...], standard: [...], elite: [...] }`, each mixing
both factions' keys at that tier. Replaces the old single hardcoded `ENCOUNTER` array (deleted, along
with the global `encounterLevel` counter) — `rollEncounterForNode(node)` (§4 I) draws from these per
node instead.

**DUNGEONS** (Phase H3, §5.2a — was a single `DUNGEON_MAP`) — a registry of every dungeon, keyed by
`currentDungeonKey` (new global state, §3): `{ [dungeonKey]: { start: nodeId, title, nextDungeonKey,
nodes: { [id]: { id, type, depth, levelDepth?, connectsTo: [id,...], ...extra fields } } } }`.
`title` labels the Map screen heading; `nextDungeonKey` is what a **boss**-type node win advances to
(read by `renderEndbar`) — `null` means nothing built past it yet. `type` ∈ `combat | elite | loot |
rest | recruit | boss`. `depth` groups nodes into map rows AND (Sector 1 only) feeds
`depthLevel(depth)` (§4 I) for enemy-level scaling — **unless** the node also carries `levelDepth`
(Phase H4), in which case enemy scaling reads `levelDepth` instead, letting a node's map ROW position
and its BALANCE position diverge (see the `recruit1` insertion below for why this exists).

- **`DUNGEONS.prologue`** ("Kharon's Reach," Phase H3) — 4 linear nodes (`p1→p2→p3→p4`, no
  branching — an escape, not a crawl). `p1`/`p2` are `combat` (each carries an `enterText` flavor
  line, read by `enterNode` instead of the generic "Hostiles engage!"). `p3` is `type:"recruit"`
  (extra fields `recruitClass`/`recruitName`/`recruitText`/`recruitButtonLabel` — see
  `resolveRecruitNode`, §4 D2). `p4` is `boss` (also has `enterText`). `nextDungeonKey: "sector1"`.
- **`DUNGEONS.sector1`** (Phase G; extended Phase H4; recruit position changed in the 2026-07-23
  tightening pass) — the original 9-node Tiangong Station Sector 1 (a branch — safer Combat+Rest vs
  riskier Elite+Loot — that reconverges, a Combat node, a final Elite gate, a Rest stop, then the
  Boss; `n8` was added during Slice G4 balance testing) PLUS a 10th node, **`recruit1`**
  (`type:"recruit"`, `recruitClass:"netrunner"`, `recruitName:"Wren"`). `n1` is still the dungeon's
  `start` (unchanged from Phase G); `recruit1` sits right after it (`depth:2`, `n1.connectsTo:
  ["recruit1"]`, `recruit1.connectsTo: ["n2","n3"]`) — still before the branch point, so every
  playthrough meets Wren regardless of path, but now the player fights the breach corridor
  themselves before meeting her (moved from BEFORE `n1` in the initial H4 build; her recruit text
  was rewritten to match — she no longer claims to have cleared the corridor herself). Every node
  from `n2` on carries `levelDepth` set to its ORIGINAL pre-`recruit1` depth (`n2/n3:2, n4/n5:3,
  n6:4, n7:5, n8:6, boss:7`) — `rollEncounterForNode`'s `levelFor()` reads `node.levelDepth ||
  node.depth`, so inserting `recruit1` doesn't also quietly retune the level curve (a sim comparison
  showed it would: risky-branch clear rate roughly halved without this fix — see the design doc
  §5.2c). `n1` needs no `levelDepth` override since its render `depth` (1) already matches its
  original value. `nextDungeonKey: "erebus"` (Phase L — was `null`).
- **`DUNGEONS.erebus`** ("Site Erebus," Phase L, §5.3) — 9 nodes, same size/branch topology as
  Sector 1 (`e1`→`e2`→branch `e3`(combat, safe)/`e4`(elite, risky)→`e5`(rest)/`e6`(loot)→reconverge
  `e7`(combat)→`e8`(rest)→`boss`). No `recruit` node (deliberate scope call, §5.3). Every combat/
  elite/boss node carries `enterText` (the environmental storytelling — annex wreckage, Tiangong ID
  plates — lives there, not in a separate node type). Hand-scripted like the prologue —
  `rollErebusEncounter(node)` (§4 I), NOT `ENEMY_POOLS`/`depthLevel`. `nextDungeonKey: null`
  (nothing built past here yet, but its boss-clear still gets a full epilogue — see `renderEndbar`,
  §4 I, which now dispatches by SOURCE dungeon, not just by whether `nextDungeonKey` is set).

`NODE_TYPE_LABEL` gives each type its display string (now includes `recruit: "Recruit"`).

**Combatant** (the live object `createHero` / `createEnemy` produce; the engine only ever reads
these, never hard-coded fighters):
```
{
  id,                      // unique int (nextId())
  name,                    // display name (enemies get lettered: "Spider Drone A")
  side: "heroes"|"enemies",
  classKey | typeKey,      // hero has classKey; enemy has typeKey
  className, level, xp, xpToNext,   // heroes — leveling (Phase E core)
  level, tier, xpReward,            // enemies — level scales stats; xpReward = TIER_XP[tier]×level
  subtitle,                // hero: "Class · Lv N"; enemy: "role" (+ " · Lv N" if level>1)
  nature: "organic"|"synthetic",   // for status nature-locks (e.g. Confuse = organic only)
  stats: { hp, maxHp, en, maxEn, attack, defense, speed },
  skills: [skillKey,...],
  affinities: { <damageType>: multiplier },  // damage-type multipliers; unlisted type = x1
  effects: [ { type, magnitude, duration }, ... ]   // active status effects (Phase C)
}
```
`affinities` come from an `affinities` field on the CLASS/ENEMY template (copied per-instance via
`Object.assign`). Named tiers in code: `HARD_RESIST 0.2`, `RESIST 0.5`, `NEUTRAL 1.0`, `MILD_WEAK 1.25`,
`WEAK 1.5`, `DOUBLE_WEAK 2.0`. **No true immunity** — a hard-resisted hit still chips ≥1.
CLASSES/ENEMIES templates now also carry an `affinities` field.

**(2026-07-26 battle-mechanics overhaul, design doc §3.2a/§3.7, corrected 2026-07-28, SPEC ONLY — not
yet built.)** As of this plan, `affinities` keys stop being raw `damageType`s and become the 4
resistance-bucket names instead: `physical`, `thermal`, `shock`, `mind` — plus `exotic`, which is NOT a
key any template ever sets (Exotic-flavored skills bypass the affinity lookup entirely —
`affinityMultiplier` returns `1` unconditionally when `DAMAGE_TYPE_CATEGORY[damageType] === "exotic"`,
no per-combatant authoring needed). All 42 existing CLASS/ENEMY `affinities` tables need migrating from
the old 7-flavor keys to the 4 new bucket keys — see §12 for the full (now fully hand-verified, not just
methodology) table, engine-change list, and regression plan. **Governing rule:** `physical` values are
clamped to `RESIST`–`DOUBLE_WEAK` (0.5–2.0) game-wide — never `HARD_RESIST`, since Kinetic is every
hero's free universal Attack and must never read as a dead button.

**STATUSES[type]** — status-effect registry (Phase C): `{ name, pip, buff?, requiresNature? }`.
Current seven: `burn` (magnitude = DoT damage/turn), `weaken` (−ATK), `sunder` (−DEF),
`guard` (magnitude = incoming-damage multiplier e.g. 0.5; `buff:true`), `disable` (skip turn),
`confuse` (magnitude = redirect chance; `requiresNature:"organic"`), `overclock` (magnitude = +ATK;
`buff:true`). Effects tick at the START of the afflicted's turn; **one instance per type, refresh +
keep-strongest** on re-apply. **+2 new, SPEC ONLY (§12):** `irradiate` (DoT like `burn`, PLUS halves
incoming healing via a new `healMultiplier` helper) and `pin` (flat Speed reduction, read by a new
`effectiveSpeed` helper that the initiative sort uses instead of raw `stats.speed`).

**EQUIPMENT_SLOTS** — `["head","body","legs","arms","weapon","ring"]`, iteration order for the UI.

**ITEMS[itemKey]** — equipment (Phase E character-development layer): `{ name, slot, statBonus:
{hp?,en?,attack?,defense?,speed?}, classRestrict?, grantsSkill?, spriteKey }`. `classRestrict` (a
classKey) gates Arms + Ring items to one class each (18 items total, 3 universal per Head/Body/Legs/
Weapon, 1 per class for Arms + Ring). `grantsSkill` (Arms only) pushes a skillKey onto the hero's
`skills` **while equipped** — unequip removes it again (swappable, unlike SKILL_TREES' permanent
unlocks). `spriteKey` is unused today, a forward-compat placeholder for the future paperdoll (Phase I).
New skills for the 5 Arms grants: `wristRocket`, `powerFist`, `terminalProbe`, `psiConduit` (single-
target signature bursts) and `shoulderRocket` (Thermal AoE, the one exception).

Hero field: `equipment: { head, body, legs, arms, weapon, ring }` (item keys or `null`).

**partyOwnedItems** — `{ itemKey: count }`, party-wide (not per-hero). Equipment must be **owned**
before it can be equipped. Reset empty only on a brand-new Start (`onStartClicked`, Phase H2) — NOT
on every `startDungeon` anymore, since heroes (and their equipped gear) now persist across dungeons;
resetting ownership per-attempt would leave a hero's `equipment` pointing at gear nobody "owns."
`findWornBy(itemKey)` scans the whole **roster** (Phase H4 fix — was `party` only, which under-
reported a benched hero's gear as "unworn" once Town let the player equip any recruited hero, not
just whoever's actively deployed);
`equipItem` transfers an item away from whoever else has it on (one physical item, one wearer).
Interim acquisition (until the map's real loot nodes exist): `rollLootDrop()` — `LOOT_DROP_CHANCE`
(0.4) odds of a random unowned item after a win, called from `endBattle("win")` after `awardXp()`.

**Limit Break (Phase D½; gain rates retuned in the 2026-07-23 tightening pass).** Each hero has
`limit` (0–100, **persists across the run** — never reset in `beginEncounter`, only implicitly
zeroed by a fresh `startRun` via `createHero`). `CLASSES[classKey].limitBreak` points at a skill key
(`fullAuto`/`unbreakableLine`/`orbitalStrike`/`totalHack`/`mindsMercy` — enCost 0, bypasses EN).
Gauge gain happens inline in `applyToTarget`, heroes only: `GAUGE_PER_DAMAGE_DEALT`(0.31, was
0.06)/`_TAKEN`(0.13, was 0.03)/`_HEAL`(0.21, was 0.05) per point, `_STATUS_APPLIED`(3, was
1)/`_KILL`(11, was 3) flat. The original values were tuned so it fired roughly **once per ~2
fights** against Sector 1's longer encounters (headless-verified at the time) — but a sim check
against the new story mode's short prologue (3 fights total) showed the gauge averaging only 41% by
the end even at 2x those rates, and never once crossing 100% in 200 simulated playthroughs. Roughly
5x the original rates was what it took before a sim showed it firing within the prologue in ~73% of
playthroughs, averaging right at the threshold by the final fight — enough to be reachable in short
content without guaranteeing it every time. `gainLimit(hero,
amount)` clamps 0–100. `addEffect` now **returns true/false** (landed vs nature-blocked) so callers know
whether to award status-application gauge. Heal skills may set `cleanse: true` — strips all non-buff
effects (checked via `STATUSES[type].buff`) before the heal resolves. Activation: `chooseLimitBreak()`
(guards `limit>=100`) → normal `enterTargeting` flow → `performPendingAction` zeroes `activeCombatant.
limit` unconditionally after `resolveSkill` (so any incidental gauge gained during its own resolution
doesn't get refunded). UI: a `.limit-btn` in the action bar (progress text below 100%, "LIMIT BREAK:
Name" and enabled at 100%) and a purple `.limit-fill` bar on hero panels only (`c.side==="heroes"`).

**SKILL_TREES[classKey]** — Phase E skill trees (array of nodes): `{ key, skillKey, name, cost, prereq }`.
`prereq` is another node's `key` in the same tree (or `null`) — multiple nodes may already share one
`prereq`, so branching needs no engine change, only content. Learning a node (`learnNode`) pushes
`skillKey` onto the hero's `skills` array — it's usable in combat immediately, no extra wiring. Current
trees: `merc` [suppressingFire], `dreadKnight` [cleave], `mechRunner` [overclock], `netrunner`
[systemShock → firewallBreach], `mentalist` [terror → cerebralOverload] (the last two are 2-tier
prereq chains). Hero fields: `sp` (Skill Points, earned via `SP_PER_LEVEL` per level-up) and
`unlockedNodes` (learned node keys, for prereq/already-learned checks).

**(2026-07-26 battle-mechanics overhaul, design doc §4.1a/§3.7, SPEC ONLY — not yet built.)** Node shape
grows a `type` field (`"active" | "passive" | "keystone" | "econ" | "meta"`) and, for every non-`active`
type, a `slotCost` (1-3). `learnNode`'s behavior for `type:"active"` nodes is UNCHANGED (pushes
`skillKey` onto `hero.skills` immediately, permanent). For every other type, learning only adds the node
to `unlockedNodes` (SP spent, permanent) — it does NOT take effect until also socketed into a new,
separate budget: `hero.tacticSlots` (total capacity, from `tacticSlotsForLevel(hero.level)`, proposed
curve `2 + floor(level/4)`) and `hero.socketedPassives` (array of currently-active non-active node keys,
sum of their `slotCost` ≤ `tacticSlots`). Socketing/unsocketing is only callable from Rest-node and Town
screens (mirrors how squad-swap and equipment already work), never mid-combat. Socketed passives' actual
effects fold into `effectiveAttack`/`effectiveDefense`/EN-cost/gauge-gain the same way Weaken/Sunder/
Guard already do — see §12 for the full engine-change list.

**pendingAction** (transient, during a hero's target pick): `{ key: skillKey, isItem: bool }`.

**partyItems** — shared consumable bag: `{ stim: 3 }` (reset each battle).

---

## 3. Global state (Section B, lines ~424–443)

| Var | Meaning |
|-----|---------|
| `roster` (Phase H2) | every hero the player has recruited, ever — persists for the whole game; only a brand-new Start (§4 D) resets it to `[]` |
| `party` / `enemies` | the two live combatant lists. `party`'s entries are, by construction, the SAME objects as their `roster` entries (see `buildParty`) — combat mutations on a deployed hero are automatically also roster's copy |
| `partyItems` | shared item bag (resets each `startDungeon` — a balance/economy call, not tied to hero identity) |
| `initiative` | living combatants sorted by Speed for the current round |
| `turnIndex` | pointer into `initiative` |
| `activeCombatant` | whose turn it is right now |
| `pendingAction` | skill chosen, awaiting a target click (else null) |
| `battleOver` | true once a side is wiped / fled; guards all turn functions |
| `nextIdCounter` | source of unique combatant ids |
| `selectedHeroIds` (Phase H2, was `selectedClasses`) | roster hero **ids** currently ticked on the squad-builder screen |
| `lastSquad` | hero ids from the most recently deployed squad (for Rematch / pre-select) |
| `AI_SPECIAL_CHANCE` `AI_HEAL_CHANCE` `AI_HEAL_THRESHOLD` | enemy-AI difficulty knobs |
| `currentDungeonKey` (Phase H3) | which `DUNGEONS` entry is active (`"prologue"` \| `"sector1"`) |
| `currentNodeId` | the dungeon node currently being resolved (`null` when on the Map) |
| `unlockedNodeIds` / `visitedNodeIds` | dungeon-map progress (Phase G); reset by `startDungeon` |
| `lastMapMessage` | most recent Loot/Rest result text, shown on the Map screen |
| `REST_HEAL_FRACTION` | fraction of max HP/EN a Rest node restores (0.65) |
| `lastTownMessage` (Phase H4) | most recent Town result text (e.g. the ship-salvage grant), shown on the Town screen — mirrors `lastMapMessage` |
| `sector1BriefingShown` (Phase H4) | gates the "why we're attacking the station" story beat to once; after that Town's mission button skips straight to the squad-builder |
| `lastCheckpointScene` (Phase H4) | `"map"` \| `"town"` — which one `loadGame()` should resume onto (both are now checkpoints, not just the Map) |
| `SHIP_STARTING_ITEMS` (Phase H4) | `["kevlarMesh","tacticalSidearm"]` — the fixed, hand-picked salvage grant, not a loot roll |
| `charPanelHeroList` / `charPanelReturnTo` (Phase H4) | which hero list the open Character Sheet's tabs iterate, and whether "Done" returns to `"battle"` (the endbar) or `"town"` — set explicitly on first open, reused by internal re-render calls |

---

## 4. Function catalog (by section)

**A) DATA** — `SKILLS`, `CLASSES`, `ENEMIES`, `ENCOUNTER` constants.

**C) HELPERS**
- `nextId()` · `randomBetween(min,max)` · `clamp(v,min,max)` · `isAlive(c)`
- `allCombatants()` → `party.concat(enemies)` · `living(list)` → alive filter
- `opponentsOf(c)` / `alliesOf(c)` → the enemy/own list **relative to `c.side`** (key to relative targeting)
- `affinityMultiplier(target, damageType)` → target's multiplier for that type (1 if unlisted/none)
- `hasStatus(c,type)` / `getStatus(c,type)` — query a combatant's active effects
- `effectiveAttack(c)` / `effectiveDefense(c)` — base stat ± active Weaken/Overclock or Sunder (never mutates base)
- `guardMultiplier(c)` — product of active Guard multipliers (incoming-damage scaling)
- `addEffect(target, spec)` — apply/refresh a status (respects nature-lock; keep-strongest)
- `applyConfusion(actor, skill, targets)` — maybe redirect a single-target attack to a random combatant
- `capitalize(s)` · `findById(id)` → combatant
- `createHero(classKey, displayName?)` / `createEnemy(enemyKey, displayName?)` → fresh combatant

**D) TITLE, SAVE & SELECT** *(renamed Phase H1 — was just "SELECT")*
- `goToScene(name)` — the scene manager (Phase F, extended H1/H3/H4): shows exactly one of
  `title-scene`/`naming-scene`/`story-scene`/`town-scene`/`select`/`map`/`battle` (`SCENE_DISPLAY`
  gives each its "shown" display value), hides the rest
- `showTitle()` / `showSelect()` / `showBattle()` / `showMap()` / `showTown()` — thin wrappers
  around `goToScene`; `showTitle` also calls `renderTitleScreen`, `showSelect` also calls
  `renderSelectScreen`, `showMap`/`showTown` also call `renderMap`/`renderTown`, set
  `lastCheckpointScene` (Phase H4), and `saveGame()` — **both** are checkpoints now, not just the Map
- `returnToHub()` (Phase H4) — the "go back to base" dispatcher used by Retire/New-squad/Abandon/a
  no-`nextDungeonKey` boss-clear: `showSelect()` while `currentDungeonKey === "prologue"` (Town
  doesn't exist yet in the fiction), else `showTown()`
- `showStoryScene(paragraphs, buttonLabel, onContinue)` (Phase H3) — generic reusable "narrative
  beat" screen: `#story-scene` filled with one `<p class='story-p'>` per paragraph + one Continue
  button running `onContinue`. Used by `showIntroScene`, `resolveRecruitNode`, `showPrologueEpilogue`,
  and (H4) `onHeadToStation` — one small data-driven component instead of a bespoke screen (or a full
  dialogue engine) per story moment
- `renderTitleScreen()` (H1) — Start / Saved Game buttons; Saved Game is `disabled` when
  `hasSave()` is false
- `onStartClicked()` (H1, routing updated H2/H3) — if a save exists, `confirm()`s overwrite
  (declining is a no-op) and `clearSave()`s; resets `roster`/`party`/`selectedHeroIds`/`lastSquad`/
  `partyItems`/`partyOwnedItems`/`currentDungeonKey`/`lastTownMessage`/`sector1BriefingShown`/
  `lastCheckpointScene` to empty/null/default (a true fresh story start, §5.2), then `showNaming()`
- `onContinueClicked()` (H1, extended H4) — `loadGame()`; on failure `alert()`s "No saved game
  found." and re-renders the Title screen; on success resumes onto whichever of Map/Town was
  actually checkpointed (`lastCheckpointScene`), not always the Map like before H4
- `SAVE_KEY` / `buildSaveData()` / `saveGame()` / `hasSave()` / `loadGame()` / `clearSave()`
  (H1, extended H2/H3/H4) — the save engine. One JSON blob in `localStorage["gridfallSave"]`. Saves
  only ever happen from `showMap()`/`showTown()`, so a save never has to capture mid-battle turn
  state; `loadGame()` always resets `currentNodeId` to `null` so loading resumes onto Map/Town, never
  mid-fight. Also now serializes `lastTownMessage`/`sector1BriefingShown`/`lastCheckpointScene`
  (Phase H4). Serializes `roster` (full hero objects) and `activePartyIds` (just ids) rather than
  `party` directly — `JSON.stringify`/`parse` always makes independent copies, so saving both as full
  objects would silently break the "party members ARE roster objects" reference-sharing invariant on
  reload;
  `loadGame()` re-derives `party` by looking `activePartyIds` up in the freshly-parsed `roster`.
  Also serializes `lastSquad`, `partyItems`, `partyOwnedItems`, `currentDungeonKey` (H3), `unlockedNodeIds`,
  `visitedNodeIds`, `lastMapMessage`, `nextIdCounter`. `loadGame()` returns `true`/`false`
  (corrupt/missing JSON is treated as "no save," not a thrown error)
- `renderNamingScreen()` / `onConfirmName()` (H2, destination changed H3) — shown once, right after
  Start, before the prologue. A text input (16-char max, Enter or the Confirm button submits) with a
  `HERO_NAMES[0]` fallback if left blank; creates `createHero("merc", <name>)`, pushes it onto
  `roster`, then **`showIntroScene(hero)`** (H3 — was `showSelect()` in H2; the squad-builder is
  skipped entirely for the forced-solo first deploy)
- `showIntroScene(hero)` (Phase H3) — the game's literal opening: Kharon's Reach, brother Dez killed
  by Foreman Voss, the hero kills Voss and takes his rifle (§5.2a has the full canon text). No
  combat — an ambush played out as a fight would undercut it. `showStoryScene(...)` with Continue →
  `currentDungeonKey = "prologue"; startDungeon([hero.id], "prologue")`
- `renderSelectScreen()` (H2 — was "builds cards from `CLASSES`") — the squad-builder: now builds
  one card per **roster** hero (name/class/level/current stats/skills, not class templates), reading
  live `h.stats`/`h.level` so progress shows up here too; pre-selects `lastSquad`, filtered to ids
  still present in `roster`
- `toggleSelect(heroId)` (H2 — was `toggleSelect(classKey)`) — pick/deselect a roster hero by id
  (cap 3) → `refreshCardStates` + `updateDeployRow`
- `refreshCardStates()` — card highlight + pick-order badge (iterates `roster`, not `CLASSES`)
- `updateDeployRow()` — Deploy button (needs ≥1) + count
- `deploy()` (H3: dungeon target added) — sets `lastSquad = selectedHeroIds.slice()`,
  `startDungeon(lastSquad, currentDungeonKey)` — redeploys into whichever dungeon is already active
  (set by `showIntroScene` or `showPrologueEpilogue`); this screen is only reached via a
  retry/retire/abandon WITHIN that dungeon, never a fresh pick between dungeons

**D2) MAP** (Phase G, §5.1; extended Phase H3 for multi-dungeon + recruit nodes)
- `renderMap()` — reads `DUNGEONS[currentDungeonKey]`, uses its `title` for the heading, draws
  `.nodes` grouped into rows by `depth`; each node is a plain button (hex-marker art is a later
  Phase I pass) labeled by `NODE_TYPE_LABEL`, showing locked (🔒) / visited (✓) / unlocked state;
  also renders `lastMapMessage` if set and an "Abandon run" button (→ `returnToHub()`, Phase H4)
- `onNodeClick(nodeId)` — guards locked/already-visited, then branches: Combat/Elite/Boss →
  `enterNode(nodeId)` (a real fight); **Recruit (H3) → `resolveRecruitNode(nodeId)`**; Loot/Rest →
  `resolvePassiveNode(nodeId)` (resolved inline, no battle scene)
- `resolvePassiveNode(nodeId)` — marks visited, runs `grantLoot()`/`restParty()` into
  `lastMapMessage`, unlocks `node.connectsTo`, re-renders the Map
- `grantLoot()` — guaranteed random unowned item into `partyOwnedItems` (same `ITEMS` pool as the
  interim combat-win `rollLootDrop`, but guaranteed, not a chance roll)
- `restParty()` — `+= REST_HEAL_FRACTION * max` on HP and EN (clamped), clears `effects`
- `resolveRecruitNode(nodeId)` (Phase H3, generalized H4 — was Kade-only hardcoded text) — reads the
  node's `recruitClass`/`recruitName`/`recruitText`/`recruitButtonLabel`, `createHero`s the
  companion, pushes them onto `roster` always but the live `party` only **if there's a free slot**
  (`party.length < 3` — the prologue's forced-solo start made this a non-issue there; Sector 1's
  pre-chosen squad could in principle already be full, Phase H4), marks visited/unlocks connections
  like `resolvePassiveNode`, then `showStoryScene(node.recruitText, node.recruitButtonLabel, ...)`
  (NOT the small `lastMapMessage` banner — gaining a permanent companion is a bigger beat than a Loot
  node) with a Continue that calls `showMap()`

**D3) TOWN** (Phase H4, §5.2c) — the general hub between dungeons
- `renderTown()` — ship name + flavor line + `lastTownMessage` (if set) + a `#town-roster` row per
  ROSTER hero (name/class/level/HP) + `#town-buttons`: **Roster & Equipment** (opens the Character
  Sheet against `roster`, returns to Town — `showCharacterPanel(undefined, roster, "town")`),
  **Party Inventory** (`showInventoryPanel()`), a mission button (**"Head to the Station"** →
  `onHeadToStation` if `currentDungeonKey==="sector1" && !sector1BriefingShown`, else **"Prep
  Squad"** → `showSelect` directly), and **Save** (`saveGame()` + a confirmation message + re-render)
- `onHeadToStation()` — the one-time "why we're attacking the station" briefing: sets
  `sector1BriefingShown = true`, `showStoryScene(...)` with Continue → `showSelect()`. Hand-authored
  like the other story beats — only one such briefing exists today
- `showInventoryPanel()` / `removeInventoryPanel()` — party-wide inventory (the "shared party
  inventory screen" design §7.1 flagged as still-open), **actionable as of Phase H5** (was read-only
  in H4): Consumables (`partyItems`) + Equipment (every `partyOwnedItems` key, its count, its
  `itemEffectText` — e.g. "+4 DEF" — and, via `findWornBy`, who if anyone is wearing it). An
  unequipped item gets one `.inv-equip-btn` per roster hero eligible for it (`classRestrict`-filtered)
  — clicking calls `equipItem(hero, itemKey)` directly and re-renders the panel via a fresh
  `showInventoryPanel()` call. A worn item's `.inv-worn-btn` ("worn by X") jumps straight to that
  hero's sheet: `removeInventoryPanel(); showCharacterPanel(hero.id, roster, "town")`. Appends into
  `#town-scene`; Done just removes it (Town underneath is untouched, no re-render needed)
- `grantShipStartingItems()` — a fixed, hand-picked one-time grant (`SHIP_STARTING_ITEMS`:
  `kevlarMesh`, `tacticalSidearm`) into `partyOwnedItems`, called from `showPrologueEpilogue`'s
  Continue (right before `showTown()`) — deliberately not a loot roll

**E) UI**
- `panelHtml(c)` — HTML string for one combatant panel (EN bar only if `maxEn>0`)
- `renderCombatants()` — writes all panels into `#enemies` / `#party` (once per battle)
- `updateScreen()` — refreshes every panel's HP/EN text+bar and `.down`/`.active` classes
- `log(text, flag?)` — append a log line. `flag`: `true`→important/green, or a class string
  `"super"` (gold, "Super effective!") / `"resist"` (grey, "Resisted."/"No effect!")
- `setBanner(text)` / `clearActions()` — turn banner + action-bar helpers
- `renderActions(hero)` — builds skill buttons (disabled if EN too low) + Item + Run. Phase L: also a
  one-time "Jam the Relay" button, rendered only while a live `broodmarshal` enemy is present and
  un-reinforced — see §2's reinforcement-hook entry

**F) COMBAT CORE**
- `resolveSkill(skillKey, actor, targets[])` — **pays EN once**, then `applyToTarget` per target
- `applyToTarget(skill, actor, target)` — the damage/heal math + log (see §5). *Phase B extends this.*

**G) TARGETING** (player turns only; enemy AI bypasses this)
- `validTargets(skill, actor)` — living targets per `skill.target` (relative)
- `chooseSkill(skillKey)` / `chooseItem(itemKey)` — set `pendingAction`, enter targeting (EN/stock checked)
- `enterTargeting(skill)` — self/AoE auto-resolve; single-target → highlight + wait
- `highlightTargets(targets)` / `clearTargeting()` — add/remove `.targetable` + click handlers
- `onTargetClicked(id)` → `performPendingAction([target])`
- `performPendingAction(targets)` — consume item if any, `resolveSkill`, `updateScreen`, `finishHeroAction`
- `showCancelOnly()` / `cancelTargeting()` — back out to action choice
- `finishHeroAction()` — clear bar, `setTimeout(endTurn, 500)`

**H) TURN FLOW**
- `tickEffects(combatant)` — at turn start: applies Burn DoT, notes Disable, counts down/expires all
  effects; **returns `true` if the combatant is Disabled** (so `beginTurn` skips its turn). `beginTurn`
  also handles death-by-DoT at turn start. Confusion is checked at resolve time (`applyConfusion`), not here.
- `turnOrder(list)` — sort by Speed desc (ties keep list order → party before enemies on a tie)
- `startRound()` — rebuild `initiative` from living, `turnIndex=0`, `nextTurn()`
- `nextTurn()` — skip dead; at end → `startRound()` (new round); else `beginTurn(initiative[turnIndex])`
- `beginTurn(c)` — set active, `tickEffects`, `updateScreen`; hero → `beginHeroChoice`, enemy → `setTimeout(enemyAct,700)`
- `beginHeroChoice(hero)` — banner + `renderActions`
- `chooseEnemyAction(enemy)` — AI: maybe heal worst-hurt ally (`AI_HEAL_*`); else attack — the enemy's
  **first** attack skill is its basic, later attack skills are specials used at `AI_SPECIAL_CHANCE`; returns `{key, targets}` or null
- `enemyAct(enemy)` — resolve the decision, then `setTimeout(endTurn,600)`
- `endTurn()` — `checkBattleEnd()`? else `turnIndex++`, `nextTurn()`
- `checkBattleEnd()` — win/lose → `endBattle()`, returns bool
- `onRun()` — 50% flee → `endBattle()`, else costs the turn

**I) STARTUP, RUN & LEVELING**
- `buildEnemies(rolled)` — instantiate enemies from a pre-resolved `[{key, level}, ...]` list
  (each entry carries its OWN level — replaces the old `(encounter, level)` shared-level signature),
  letter duplicates A/B/C…
- `pickRandom(list)` — small helper, one random element
- `depthLevel(depth)` — `Math.ceil(depth * 0.7)`, node depth → baseline enemy level. Deliberately
  sub-linear (see §9 balance note): a 1:1 depth-to-level mapping badly outpaced how much XP a party
  actually earns within this dungeon's ~6 fights.
- `rollEncounterForNode(node)` — Phase G, §5.1's per-node encounter roll for **Sector 1 only**
  (Phase H3: the prologue uses `rollPrologueEncounter` instead, see below), replacing the old single
  `ENCOUNTER` + `encounterLevel`. Boss → fixed `[{key:"warden", level:4}]` (a unique fight, tuned
  directly rather than off the depth curve). Elite → 1 guaranteed elite-tier + 1 support (fodder or
  standard), each `depthLevel(node.levelDepth || node.depth) + randomBetween(-1,0)` — **Phase H4:
  reads `levelDepth` when present, NOT the render `depth`**, so inserting `recruit1` (which shifted
  every node's render `depth` by +1) doesn't also shift the enemy-level curve — see §2's DUNGEONS
  entry. **Jitter never goes upward**; elites already hit harder from their own base stats, so a
  level bump stacked on top spiked past what a same-depth party could handle in testing. Combat →
  2-3 enemies, fodder/standard mix that skews standard at `depth>=3`.
- `rollPrologueEncounter(node)` (Phase H3) — the prologue's encounters, entirely hand-scripted by
  node id (`p1`→1 Spider Drone, `p2`→2 Colony Guards, `p4`→Overseer Krell), NOT drawn from
  `ENEMY_POOLS`/`depthLevel` — a short, tightly-authored escape doesn't need randomized composition,
  same "unique fight, tuned directly" treatment the boss roster already gets. `p3` (recruit) returns
  `[]`; it's resolved by `resolveRecruitNode` instead, never reaches `enterNode`
- `rollErebusEncounter(node)` (Phase L, §5.3) — Site Erebus's encounters, hand-scripted by node id
  same as the prologue (`e1`→3 Roach, `e2`→2 Warrior+1 Roach, `e3`→Warrior+Shaman, `e4`→Armored
  Warrior+Roach, `e7`→2 Warrior+1 Roach, `boss`→the Broodmarshal), NOT `ENEMY_POOLS`/`depthLevel`.
  Levels are a first-pass guess sim-verified at level 4 (§9); rest/loot nodes return `[]`
- `buildParty(heroIds)` (Phase H2 — was `buildParty(classKeys)`, which called `createHero` fresh
  every deploy) — looks the chosen heroes up **by reference** in `roster` via `.find()`. This, not a
  copy, is what makes level/xp/equipment/limit persist across dungeons: a `party` entry and its
  `roster` entry are the literal same object
- `startDungeon(heroIds, dungeonKey)` (Phase H2, **signature + behavior extended H3**) — sets
  `currentDungeonKey = dungeonKey`, `party = buildParty(heroIds)`, then **fully heals HP/EN and
  clears `effects` on every party member** (new in H3 — see the callout below), resets `partyItems`
  (still a per-attempt reset — a balance/economy call, not a correctness one; `partyOwnedItems` is
  NOT reset here, see its own entry in §2) and map progress (`visitedNodeIds=[]`,
  `unlockedNodeIds=[DUNGEONS[dungeonKey].start]`), `showMap()`
  - **Why the full heal was added (H3):** once H2 made heroes persist by reference across dungeons,
    redeploying after a wipe would field an already-dead (0 HP) party and instant-lose again — a
    real soft-lock risk, not theoretical, since the prologue is mostly solo with no Rest node. The
    fix applies at every dungeon-ATTEMPT boundary (fresh start, retry-after-loss, next dungeon) and
    does **not** touch the existing no-heal-*between-nodes-within-a-dungeon* rule (§4.2, unchanged).
    Verified by a dedicated driver: force a hero to 0 HP, lose, retire, redeploy — hero comes back at
    full HP, not still dead.
- `enterNode(nodeId)` (H3: dungeon-aware; Phase L: 3-way dispatch) — Combat/Elite/Boss entry: reads
  `DUNGEONS[currentDungeonKey].nodes[nodeId]`; rolls its encounter via `rollPrologueEncounter`
  (`currentDungeonKey === "prologue"`), `rollErebusEncounter` (`"erebus"`), else `rollEncounterForNode`
  (Sector 1) → `buildEnemies(...)`; clears `effects` (combat-scoped, unlike HP/EN — see §9),
  `showBattle()`, `startRound()`. Does **not** refill HP/EN itself (that no-heal-between-nodes rule
  is unchanged — the new full-heal in `startDungeon` only fires at the dungeon-attempt boundary,
  before `enterNode` is ever reached). Opening log line is `node.enterText` if the node has one (the
  prologue's and every Erebus node do — see §2), else the original generic "The Warden activates!"/
  "Hostiles engage!"
- `spawnReinforcements(boss)` (Phase L, §5.3) — the boss reinforcement hook's payload: pushes
  `boss.reinforceWave` into the live `enemies` array (continuing letter sequence from whatever's
  already in play), logs, `renderCombatants()`/`updateScreen()`. Called from `applyToTarget` (§ F) the
  first time a reinforceWave-bearing enemy crosses `reinforceAt`; see §2's new entry for the full hook.
- `resolveNodeVictory()` (H3: dungeon-aware) — reads `DUNGEONS[currentDungeonKey].nodes[currentNodeId]`;
  called from the post-win endbar's "Continue →" for a non-boss node: marks `currentNodeId` visited,
  unlocks `node.connectsTo`, `showMap()` (replaces the old `nextFight`)
- `awardXp()` — sum `enemy.xpReward`, split among party, apply `levelUp` while `xp≥xpToNext`
- `levelUp(h)` — `level++`, apply `CLASSES[h.classKey].growth` to stats, `sp += SP_PER_LEVEL`, refresh subtitle, log
- `xpForNext(level)`, consts `ENEMY_SCALE_PER_LEVEL` (0.1, was 0.08 — 2026-07-23 tightening pass), `TIER_XP` (incl. `boss: 150`), `SP_PER_LEVEL` (1)
- `canLearnNode(hero, nodeKey)` / `learnNode(hero, nodeKey)` — prereq/cost/already-learned checks; spends SP, unlocks the skill
- `applyStatBonus(hero, bonus, sign)` — ± a `statBonus` object onto `hero.stats` (maxHp/maxEn move with current hp/en, same pattern as `levelUp`)
- `addItemEffects(hero, item)` / `removeItemEffects(hero, item)` — stat bonus + (Arms) `grantsSkill` push/splice
- `findWornBy(itemKey)` — scans the whole party for whoever currently has an item equipped
- `equipItem(hero, itemKey)` / `unequipItem(hero, slot)` — `{ok, reason?}`; enforces `partyOwnedItems` ownership + `classRestrict`; auto-transfers the item away from another wearer first, then swaps out whatever was in the target slot
- `rollLootDrop()` — interim loot source (Phase D½ → until real loot nodes exist): `LOOT_DROP_CHANCE` odds of granting party ownership of a random unowned item
- `gainLimit(hero, amount)` — clamp-add to a hero's Limit Break gauge (0–100)
- `chooseLimitBreak()` — spend a full gauge on `CLASSES[hero.classKey].limitBreak`, via the normal targeting flow
- `endBattle(outcome)` — sets `lastOutcome`, awards XP once (`"win"` only), calls `renderEndbar(outcome)`
- `renderEndbar(outcome)` (H3: boss-clear branch generalized; H4: hub routing; Phase L: dispatch by
  SOURCE dungeon) — **split from `endBattle`** so re-showing it (e.g. from the Character panel's
  "Done") never re-awards XP. `"win"` on a non-boss node → "Continue →" (`resolveNodeVictory`) /
  **Character** / Retire (→ `returnToHub()`, H4). `"win"` on a **boss-type** node (checked via
  `DUNGEONS[currentDungeonKey].nodes[currentNodeId].type === "boss"` — data-driven, not a hardcoded
  `"boss"` id string, since the prologue's boss node id is `"p4"`) branches on `currentDungeonKey`
  itself, not just on whether `nextDungeonKey` is set: prologue → "Escape to the ship →" →
  `showPrologueEpilogue`; sector1 → "Break for open space →" → `showSector1Epilogue`; erebus → "Get
  off this rock →" → `showErebusEpilogue` (plays even though `nextDungeonKey` is `null` — nothing's
  built past Erebus yet, but its escape-to-Town beat still needs telling); anything else falls back
  to "Dungeon Clear! ✓" → `returnToHub()`. `"lose"`/`"flee"` → New squad (→ `returnToHub()`, H4)
- `showPrologueEpilogue(nextDungeonKey)` (Phase H3, extended H4) — the prologue → Sector 1 handoff:
  hand-authored like the intro/recruit beats. `showStoryScene(...)` with Continue →
  `currentDungeonKey = nextDungeonKey; lastTownMessage = grantShipStartingItems(); showTown()`
- `showSector1Epilogue(nextDungeonKey)` (Phase L, §5.3) — Sector 1 → Site Erebus. Unlike the
  prologue's handoff, does NOT route through Town — the ship is shot down mid-flight, never lands
  safely, so there's no "prep squad" beat between dungeons. `showStoryScene(...)` with Continue →
  `currentDungeonKey = nextDungeonKey; startDungeon(party.map(h => h.id), nextDungeonKey)` — deploys
  the SAME live `party` that just cleared the Warden straight into Erebus (mirrors `showIntroScene`'s
  direct `startDungeon` call, not the Town-then-`showSelect` flow)
- `showErebusEpilogue()` (Phase L, §5.3) — Site Erebus → Town. No dungeon exists past Erebus yet, but
  the escape-and-return beat still gets told (the crew patches the Long Shot with salvaged annex
  parts rather than trading up to a new ship, so Town's existing "the Long Shot" identity, §5.2c,
  doesn't need to change). `showStoryScene(...)` with Continue → `showTown()`
- `showCharacterPanel(heroId?, heroList?, returnTo?)` (Phase H4: generalized — was hardcoded to
  `party` + the battle endbar) / `removeCharacterPanel()` — minimal debug **Character Sheet**:
  per-hero tabs (`.char-tab`) + three sections built by
  `statsSectionHtml`/`skillsSectionHtml`/`equipmentSectionHtml`. `heroList`/`returnTo` are stored in
  module state (`charPanelHeroList`/`charPanelReturnTo`, §3) on first call and reused by internal
  re-render calls (`showCharacterPanel(h.id)` from Learn/Equip/Unequip handlers, which omit them);
  the battle endbar's Character button now explicitly passes `(undefined, party, "battle")` on every
  open so a previously Town-opened panel's state never leaks in. Equipment rows only list items the
  hero is eligible for (slot match + class-restriction filter happens in the render, not just in
  `equipItem`). All Learn/Equip/Unequip buttons re-render the whole panel on click
  (`showCharacterPanel(h.id)`) to reflect new state. Done returns to the endbar (`returnTo==="battle"`)
  or Town (`returnTo==="town"`); appends into `#battle` or `#town-scene` accordingly
- `statsSectionHtml(h)` (Phase H5: grown from one line into a real overview) — class/race/nature/
  level, then core stats (unchanged), then the Limit Break gauge % (`Math.floor(h.limit)`, checkable
  outside combat now) and any non-neutral affinities (`h.affinities` entries where the multiplier
  isn't 1, formatted "Kinetic ×1.5")
- `equipmentSectionHtml(h)` (Phase H5: shows what an item DOES) — each equip button and the
  currently-equipped line now append `itemEffectText(item)` (its stat bonus, or "grants X" for
  Arms items) instead of showing only the item's name
- `statBonusText(bonus)` / `itemEffectText(item)` (Phase H5) — shared helpers: `statBonusText`
  turns a `statBonus` object into `"+4 DEF, +10 HP"` style text; `itemEffectText` returns that, or
  `"grants " + skill.name` for an Arms item with no stat bonus, or `""` for neither. Used by both
  `equipmentSectionHtml` (Character Sheet) and `showInventoryPanel` (Party Inventory) so item
  choices are informed the same way in both places
- `removeEndbar()`
- **Entry point:** `showTitle()` at the very bottom runs on load (updated Phase H1 — used to be
  `showSelect()`).

---

## 5. Combat math (current)

**Attack:** `base = actor.attack + skill.power − target.defense`; `dmg = max(1, base + rand(−2..2))`;
then **affinity applied**: `dmg = max(1, round(dmg × affinityMultiplier(target, skill.damageType)))`
— always ≥1, so even a hard-resisted hit chips (no true immunity). Neutral hits (×1) reproduce the
pre-Phase-B numbers exactly. Feedback words/colors: >1 "Super effective!"(super), ≤0.25 "Barely a
scratch."(resist), <1 "Resisted."(resist), ×1 none.
Damage now uses **effective** stats (`effectiveAttack`/`effectiveDefense`, i.e. base minus Weaken/Sunder,
with the defense further reduced by the skill's `pierce` fraction) and is scaled by the target's
`guardMultiplier` (Guard buff). After a surviving hit, `skill.applies`
effects are laid on the target via `addEffect`.
**Heal:** `target.hp = clamp(hp + skill.power, 0, maxHp)`; logs restored amount; also runs `skill.applies`.
**Status (`kind:"status"`):** no damage/heal — just logs and runs `skill.applies`.

---

## 6. Control flow (the tricky part)

Turns are **event-driven**, not a loop — a hero's turn pauses until a button/target click, so we
advance with a turn cursor + `setTimeout` pacing:

```
showTitle → (Start) → showNaming → onConfirmName → showIntroScene → startDungeon("prologue")
  → showMap → onNodeClick → enterNode/resolveRecruitNode/resolvePassiveNode → ... → startRound
  → beginTurn   [first deploy skips showSelect entirely — solo, nothing to pick]
showTitle → (Saved Game) → loadGame → showMap/showTown  [resumes onto lastCheckpointScene, H4]
prologue boss win → showPrologueEpilogue → grantShipStartingItems → showTown   [H4 — was showSelect]
showTown → (Head to the Station, once) → onHeadToStation → showSelect
showTown → (Prep Squad / repeat visits) → showSelect
showSelect → deploy → startDungeon(heroIds, currentDungeonKey) → showMap → ...
  [reached from Town (H4), or via returnToHub() from Retire/New-squad/Abandon/a no-next-dungeon
  boss-clear — returnToHub() goes to showSelect() only while still in the prologue, else showTown()]
  ├─ hero:  beginHeroChoice → renderActions → chooseSkill/Item → enterTargeting
  │           ├─ self/AoE → performPendingAction
  │           └─ single → highlightTargets → onTargetClicked → performPendingAction
  │         → resolveSkill → finishHeroAction → (500ms) endTurn
  └─ enemy: (700ms) enemyAct → chooseEnemyAction → resolveSkill → (600ms) endTurn
endTurn → checkBattleEnd ? endBattle : (turnIndex++ → nextTurn)
nextTurn wraps to startRound at end of initiative = a new round.
```

---

## 7. Conventions & invariants (follow these when extending)

- **Data-driven:** add content by adding a `SKILLS`/`CLASSES`/`ENEMIES` entry, not new logic.
  New behavior = a new `kind`/branch in `applyToTarget`, or a new field the engine reads.
- **Relative targeting:** always resolve sides via `opponentsOf(c)` / `alliesOf(c)`, never hard-code
  "party"/"enemies". This is why enemy heals/attacks aim correctly with no special-casing.
- **EN is paid once per skill** (in `resolveSkill`), not per target.
- **DOM is keyed by combatant `id`:** elements are `panel-<id>`, `hp-text-<id>`, `hp-bar-<id>`,
  `en-text-<id>`, `en-bar-<id>`, `downtag-<id>`, `status-<id>`. `updateScreen()` re-reads these.
- **Player targeting only** goes through Section G; **enemy AI builds its own target list** in
  `chooseEnemyAction` and calls `resolveSkill` directly.
- **`battleOver` guards** the top of every turn-flow function; late `setTimeout`s no-op after a battle ends.
- **Pacing timers:** 700ms before an enemy acts, 600ms after it acts, 500ms after a hero action.

---

## 8. Seams reserved for upcoming phases

- **Status effects (Phase C — DONE):** six statuses (Burn/Weaken/Sunder/Guard/Disable/Confuse) via
  the STATUSES registry; skills apply them through `applies`/`kind:"status"`; `tickEffects` runs them;
  pips render in each panel's `#status-<id>` div. Nature-lock uses `combatant.nature`. Reserve statuses
  (Slow, Overclock, Regen, Barrier, Taunt, Hack, DoTs for other types) slot in the same way.
- **Affinities (Phase B — DONE):** combatants carry `affinities`, attack skills carry `damageType`,
  multiplier applied in `applyToTarget`. Reserve damage types (Radiation/Bio, Cryo, Void, Gravity) and
  the Armor/Shields families model are future additions on top of this same machinery.
- **Scenes (Phase F — DONE; extended H3/H4):** `goToScene(name)` now routes Title/Naming/Story/
  Town/Select/Map/Battle. Town (H4) gave Inventory a real screen (`showInventoryPanel`) reachable
  outside combat, and the Character Sheet now works from Town too, not just the battle endbar.
  Phase H5 (DONE) grew both into the "fuller equip/customize flow" the design doc originally scoped
  for "inventory & loadout screens" — Party Inventory is actionable, the Character Sheet's Stats
  section is a real overview. Phase H (Title, roster & town) is now fully shipped, H1–H5; the
  remaining screen-shaped seam is the graphical paperdoll, Phase I.
- **Leveling & run persistence (Phase E + G — DONE):** level/XP/SP/skills/inventory/Limit persist
  continuously (never reset between nodes, only by `startDungeon`); HP/EN also persist now (Phase G
  removed the old between-fight refill) — Rest nodes and items are the only recovery.

---

## 9. Dev tooling — headless balance sim

No Node in this environment. We validate logic/balance by running the game's JS in **JavaScriptCore**
with a tiny DOM stub (so `document`, `setTimeout` resolve), then auto-playing many battles.

- `jsc` path: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`
- **Get the JS (post-split, 2026-07-23):** the game's code now lives in five sibling `.js` files, so
  just **concatenate them in load order** instead of extracting an inline block:
  `cat data.js state.js ui.js engine.js > /tmp/game.js` (skip `main.js` — its `showTitle()` needs the
  DOM; the sim drives functions manually). Prepend the DOM/timer stub, then the concatenated code.
  *(The old `awk` inline-`<script>` extraction is retired — there is no inline script anymore.)*
- Stub: fake `El`/`document.getElementById`/`createElement` (give `El` a `remove()` no-op and a
  `getContext`-less object so the sprite engine's canvas guards no-op); queue `setTimeout` callbacks
  into an array and `drain()` them in a loop (turns chain via timers); stub `setInterval`/
  `clearInterval` as no-ops (the sprite idle-bob timer). See the sprite engine's own guards in `ui.js`
  — `redrawAllSprites`/`startSpriteAnimation` already no-op when there's no real canvas/`setInterval`.
- Then drive the public functions (`toggleSelect`, `deploy`, `onNodeClick`/`enterNode`, `chooseSkill`,
  `onTargetClicked`, `chooseLimitBreak`, …) and read `living(enemies)` / `battleOver` / `lastOutcome`
  to score outcomes. For a full dungeon run, drive node-by-node and call `resolveNodeVictory()`
  after each non-boss win (mirrors clicking "Continue →" on the real endbar).
- Enemy AI is mutable at runtime (functions are hoisted globals), so a sim can override
  `chooseEnemyAction` or tweak `ENEMIES`/`SKILLS`/`AI_*` to scan balance without editing the file.

*(This is how the original combat encounter was tuned to ~50–99% win for good squads, <15% for bad
comps, and how the Phase G dungeon below was tuned.)*

**Phase G dungeon-balance findings (2026-07-22), kept here because they explain *why* several
numbers in the code are what they are, not just what they are:**
- **The dungeon needed a Rest node between the final Elite gate and the Boss** (`n8`, depth 6) — going
  straight from Elite into Boss with no free heal left the party too depleted to have a real shot,
  regardless of skill. A rest stop right before a boss is also a standard genre beat, so it earned
  its spot over strict adherence to the original "~8 nodes" sketch (now 9).
- **Elite-node level jitter was capped so it never spikes upward** (`randomBetween(-1, 0)`, not
  `(-1, 1)`, and the old `+1` "elite bump" was removed) — elite-tier enemies already hit harder purely
  from their own higher base stats; stacking a level bump *and* upward jitter on top produced fights
  that spiked well past what a same-depth party could handle.
- **`depthLevel()` is sub-linear** (`ceil(depth * 0.7)`, not `depth` directly) — a 1:1 mapping
  outpaced how much XP a 3-hero party actually earns within this dungeon's ~6 fights (XP is split
  three ways and mostly drawn from fodder).
- **The Warden lost its Kinetic resistance and its self-heal (`emergencyRepair`)**, and its base
  stats came down (`hp 220→150`, `attack 19→18`, `defense 16→14`), boss level fixed at `4` rather
  than read off `depthLevel`. The root cause, found by logging a full sim'd fight round-by-round: EN
  never regenerates mid-battle, and *every* class's free EN-less fallback ("Attack") is Kinetic — so
  once heroes were EN-starved (by round ~3 of a long fight), a Kinetic-resistant boss with a self-heal
  turned the back half into an unwinnable attrition spiral, not a hard-but-fair fight. Shock (weak)
  and Cyber (doubly-weak) remain the reward for a squad that brings and manages EN for the counter.
- **Verified compositions, not just raw win-rate:** a tanked, healer+counter-class squad clears the
  "safe" (Combat+Rest) branch reliably and the "risky" (Elite+Loot) branch at real but comfortable
  tension (~50–65%) — the two branches are *deliberately* asymmetric risk/reward, so only the risky
  branch is expected to show meaningful loss frequency. A no-tank squad clears measurably less often
  than the same squad with a tank added, confirming squad comp still matters post-tuning.

**Site Erebus balance findings (Phase L, §5.3):**
- **First-pass numbers landed in the target band without retuning.** 150 headless trials/level,
  naive-attack-only, fixed story trio (Merc/Mech Runner/Netrunner) at the level they'd realistically
  be post-Sector 1: level 4 → 94% boss-clear, ~53% avg party HP remaining on a full clear, safe branch
  100%/risky branch 87%. That's squarely inside the ~50–65% "real tension without walling the player"
  band this project has targeted since Sector 1, so the Broodmarshal's stats shipped as first-drafted.
  Level 5 → 100% clear, the expected shape for a party that's overleveled the content.
- **The reinforcement/relay-jam mechanics were exercised directly, not just theorized.** The sim let
  a hero jam the relay on turn one in ~half of boss-fight trials; in the other half, reinforcements
  fired in a plausible fraction of runs (spawning is HP-threshold-gated, so it doesn't fire in every
  fight, e.g. if the party burns the boss down fast). No crashes, no letter-collision bugs in
  `spawnReinforcements`' naming (dead enemies stay in the `enemies` array rather than being removed,
  so the letter-continuation logic reading current counts off that array is safe).
- **A full end-to-end regression** (title → naming → prologue → Sector 1 (incl. Wren's recruit) →
  Erebus → Town, driving the REAL control-flow functions — `showIntroScene`, `onNodeClick`,
  `deploy`, `showSector1Epilogue`, etc. — not sim shortcuts) confirmed the `renderEndbar`/
  `DUNGEONS.sector1.nextDungeonKey` changes didn't regress the two pre-existing dungeons. One stub
  gap found and fixed along the way: `showStoryScene` wires a continue button's `onclick` but doesn't
  fire it — a sim driving story beats has to simulate that click (`document.getElementById(
  "story-continue-btn").onclick()`) explicitly, it won't happen on its own.

---

## 10. Extension recipes (quick)

- **New skill:** add a `SKILLS` entry; add its key to a class/enemy `skills` list. New effect type →
  a branch in `applyToTarget`.
- **New class:** add a `CLASSES` entry (it auto-appears wherever `roster`/`CLASSES` is iterated —
  note the squad-builder reads `roster`, not `CLASSES`, since Phase H2, so a new class only becomes
  pickable once some recruit event or the starting hero actually uses it).
- **New enemy:** add an `ENEMIES` entry; reference its key in the right tier of `ENEMY_POOLS` so
  `rollEncounterForNode` can draw it (Sector 1). A prologue-only enemy instead goes straight into
  `rollPrologueEncounter`'s hand-scripted list (Phase H3) — no pool needed for a hand-authored dungeon.
- **New dungeon node:** add an entry to `DUNGEONS[dungeonKey].nodes` and point some existing node's
  `connectsTo` at it.
- **New dungeon:** add a `DUNGEONS[newKey]` entry (`start`, `title`, `nextDungeonKey`, `nodes`); give
  its boss-clear branch in `renderEndbar` a `showXEpilogue()`-style handoff, added as its own
  `currentDungeonKey === "..."` branch (Phase L generalized this from a `nextDungeonKey`-truthy check
  to a per-source-dungeon dispatch, since an epilogue can be needed even with `nextDungeonKey: null`).
- **Boss mid-battle add-spawn:** give the boss's `ENEMIES` entry `reinforceAt` (fraction of maxHp)
  and `reinforceWave` (`[{key, count}, ...]`) — no new engine code needed, `applyToTarget` +
  `spawnReinforcements` (Phase L) already handle it generically.
- **New story beat:** call `showStoryScene(paragraphs, buttonLabel, onContinue)` — no new screen or
  markup needed (Phase H3).
- **New encounter shape:** tune `rollEncounterForNode` (composition counts, `depthLevel`, jitter).
- **Difficulty:** tweak `AI_SPECIAL_CHANCE`, `AI_HEAL_CHANCE`, `AI_HEAL_THRESHOLD`, or template stats.

---

## 11. Changelog
- **2026-07-26 — Battle mechanics overhaul: schema + migration plan written, SPEC ONLY, nothing built.**
  Full technical detail in the new §12. Schema changes previewed inline above: `damageType` gains
  `gravity` (§2 SKILLS), `affinities` keys move from 7 raw flavors to 4 resistance buckets
  (`physical`/`energy`/`mind`, + non-authored `exotic`) via a new `DAMAGE_TYPE_CATEGORY` lookup (§2
  Combatant), 2 new STATUSES (`irradiate`/`pin`, §2), and SKILL_TREES nodes gain `type`/`slotCost` plus
  two new hero fields (`tacticSlots`/`socketedPassives`, §2 SKILL_TREES). Design rationale: design doc
  §3.2a/§3.3/§3.7/§4.1a. Nothing in `data.js`/`engine.js`/`ui.js` touched yet — pending user go-ahead.
- **2026-07-24** — **Sprite-quality pass (partial, paused) + roster edits.** All in `data.js`
  (`SPRITE_SHAPES`/`SPRITES`/`ENEMIES`/`ENEMY_POOLS`) except one `ui.js` mechanism.
  **(1) New/redrawn shapes.** Heroes to **24×32 w/ human faces** (`heroMerc`, `heroMech` = human head +
  full mech body, `heroNetrunner` = female android); **`heroDread`/`heroMentalist` are still the old
  18×28 shapes** — the two outstanding redraws (they render smaller on the field until done). Enemies:
  `spiderDrone` redrawn (mechanical spider, not blob); **new `guardTrooper` (24×32)** replaces the old
  16×16 `humanoidGrunt` usage for `colonyGuard`+`tiangongPvt` — an angry helmeted enforcer w/ a raised
  stun-baton, with **modular accent keys `H` (pauldron) + `V` (glow)** for cheap tier recolors
  (`humanoidGrunt` is now unused but left defined); **new bespoke `krellFat` (22×22)** boss shape for
  `krell`. **(2) `SHAPE_SCALE_OVERRIDE` (new, `ui.js` near `TIER_SPRITE_SCALE`).** A `{shapeName: scale}`
  map consulted by `scaleFor` **before** the tier scale, so enemies that borrow an oversized grid render
  right: `guardTrooper → HERO_BATTLE_SCALE (3)` (else a 24×32 fodder at ×4 would dwarf the party),
  `krellFat → 5`. Add an entry whenever a non-hero enemy uses a hero-sized/bespoke-large grid.
  **(3) Data edits.** `ENEMIES.warden.typeName` → `"Warden, Prison AI"`; `ENEMY_POOLS` stripped of the
  three `talos*` keys (Sector 1's only draw source — Talos is a later-arc faction; the units stay
  defined for a future Talos dungeon). **(4) Validation workflow (repeatable, `scratchpad/`).** Prototype
  each sprite in a standalone `jsc` file that (a) asserts every row is the exact grid width + ASCII-only,
  (b) prints an ASCII silhouette preview (`.`→space) to eyeball the art before porting. After porting,
  a **palette-coverage probe** concatenates `data.js` + a checker that fails if any `SPRITES[k]` shape
  uses a char with no palette entry, and a **parse/link check** wraps `cat data.js state.js ui.js
  engine.js` in `new Function(...)`. All three are green as of this entry. **Remaining (paused here to
  return to gameplay planning):** Dread Knight + Mentalist 24×32 redraws; guard tier-recolor variants.
- **2026-07-23** — **Phase I underway: combat sprites + file split.** (1) **Sprite engine** added to
  `ui.js` (Section E): `SPRITE_SHAPES` (ASCII-grid pixel art) + `SPRITES` (per-combatant shape+palette)
  + `GENERIC_PALETTES` live in `data.js`; `drawSpriteFrame`/`redrawAllSprites`/`spriteFor`/`scaleFor`/
  `spriteCanvasSize`/`bobShape`/`flashCombatant`/`start`+`stopSpriteAnimation` render a `<canvas>` per
  combatant panel (`panelHtml`), with a 2-frame idle bob (500ms `setInterval`) and a 150ms white
  hit-flash triggered from `applyToTarget`. Heroes are CSS-flipped to face center. **All 5 hero classes
  have unique 18×28 shapes** (redrawn to FF4/6-era quality — real two-eye faces, 3-tone shading,
  per-class silhouettes + weapons) and **all 17 enemies have bespoke 16×16 shapes** (7 reusable
  archetype templates: humanoidGrunt/Officer, sentryBot, heavyMech, hive Crawler/Brute/Mystic/Lord).
  Enemies scale up by tier (`TIER_SPRITE_SCALE`: fodder/standard ×4, elite ×5, boss ×6 px/cell);
  heroes fixed at ×4. Engine reads each grid's own width/height, so hero (taller) and enemy shapes
  coexist with no special-casing. Sprite code guards against the headless sim (no real canvas/
  `setInterval`) so balance testing is unaffected. (2) **File split** — the single ~4,400-line
  `game.html` `<script>` block was broken into five classic sibling files (`data.js`/`state.js`/
  `ui.js`/`engine.js`/`main.js`, §1) loaded in order; purely organizational (shared global scope),
  build-free, double-click-to-run preserved. Sim harness updated to concatenate them (§9). `game.html`
  `<script>`-block-extraction tooling retired.
- **2026-07-23** — **Phase L shipped: Dungeon 3, "Site Erebus" (§5.3).** New `DUNGEONS.erebus` (9
  hand-scripted nodes, `rollErebusEncounter`), five new `ENEMIES` entries (`erebusRoach/Warrior/
  Shaman/ArmoredWarrior`, `broodmarshal`) and their `SKILLS`. New **generic engine capability**: any
  enemy template can declare `reinforceAt`/`reinforceWave`; `createEnemy` copies them plus
  `reinforced: false`; `applyToTarget` checks the threshold generically post-damage and calls the new
  `spawnReinforcements(boss)`, which pushes a wave into the live `enemies` array (new arrivals act
  next round, not this one) and re-renders. The Broodmarshal fight's "Jam the Relay" interactable
  (`renderActions`) needed no new state — it just sets the same `reinforced` flag early. `sector1`'s
  `nextDungeonKey` flipped `null → "erebus"`. New `showSector1Epilogue`/`showErebusEpilogue`;
  `renderEndbar`'s boss-clear branch now dispatches by `currentDungeonKey` (source dungeon) instead
  of only by whether `nextDungeonKey` is truthy, since Erebus's epilogue plays with `nextDungeonKey:
  null`. Sim-verified (§9: 94% boss-clear/~53% avg HP at level 4, in-band on the first pass) plus a
  full real-control-flow regression across all three dungeons — no regressions found.
- **2026-07-23** — **Phase H5 shipped: inventory & loadout screens grown into the fuller flow.**
  New `statBonusText(bonus)`/`itemEffectText(item)` helpers (shared by `equipmentSectionHtml` and
  `showInventoryPanel`) — item choices now show what an item DOES (`"+4 DEF"` or `"grants X"`), not
  just its name. `statsSectionHtml` rewritten from one stats line into class/race/nature/level +
  stats + Limit gauge % + non-neutral affinities. `showInventoryPanel` rewritten from read-only to
  actionable: `.inv-equip-btn` per eligible roster hero on every unequipped item (calls `equipItem`
  directly, re-renders via a fresh `showInventoryPanel()` call), `.inv-worn-btn` jumps to that
  hero's Character Sheet (`removeInventoryPanel(); showCharacterPanel(hero.id, roster, "town")`).
  New CSS: `.inv-worn-btn`, `.inv-equip-choices`, `.inv-equip-btn`. No new scenes or containers —
  everything grew inside Town's existing panels. This closes out Phase H (Title, roster & town),
  H1 through H5, all shipped. **Testing note:** the headless jsc+DOM-stub harness's
  `querySelectorAll` creates fresh, disconnected synthetic elements per call (a regex scan over an
  innerHTML string, not a persistent DOM), so an onclick wired during the game's own render pass
  isn't visible to a separately-called test query — verified the underlying logic directly
  (`equipItem` + re-render, `showCharacterPanel` call) headless, and the actual click-wiring
  in-browser via claude-in-chrome, where the DOM is faithful and it worked correctly end to end.
- **2026-07-23** — **Tightening pass** (post-H4, requested after playtesting). **Story text:**
  every player-facing string rewritten to remove em-dashes/AI-sounding phrasing (`showIntroScene`,
  both recruit texts, `showPrologueEpilogue`, `onHeadToStation`, the naming screen, `DUNGEONS.*`
  `title`s, the two boss-defeat log lines, `grantLoot`/`restParty` messages); the pre-existing
  combat-log dash format (damage/heal/turn-banner/flee/level-up lines) deliberately left untouched —
  mechanical feedback predating this session, not prose. **Wren's node moved:** `recruit1` now sits
  after `n1` instead of before it (`n1.connectsTo` changed from `["n2","n3"]` to `["recruit1"]`;
  `recruit1.connectsTo` is now `["n2","n3"]`; `n1` dropped its `levelDepth` override since its
  render `depth` now naturally matches its original value) — her `recruitText` rewritten to match
  (no longer claims to have cleared the corridor herself). **Difficulty:** `AI_SPECIAL_CHANCE`
  0.35→0.38, `AI_HEAL_CHANCE` 0.4→0.43, `ENEMY_SCALE_PER_LEVEL` 0.08→0.1 — a larger first attempt
  (0.42/0.48) was reverted after sim testing showed it more than halved Sector 1's risky-branch
  clear rate; the smaller bump was chosen after confirming the safe branch and the prologue boss
  stayed comfortably winnable. **Limit Break:** gain rates roughly 5x'd (see §2's Limit Break entry
  for exact numbers) after a sim showed the original pacing meant the gauge never crossed 100% once
  in 200 simulated prologue playthroughs; now fires in ~73% of them. Verified: existing headless
  drivers unaffected (0 regressions), `sim_sector1.js`/`sim_krell.js`/`sim_solo.js` re-run against
  the new constants, a new `sim_limit.js` added to measure gauge-fill-by-boss-fight specifically,
  and a real-browser check (claude-in-chrome) that Wren's repositioned, rewritten scene renders
  correctly and reflects the new node order. Full reasoning and numbers in the design doc §5.2d.
- **2026-07-23** — **Phase H4 shipped: Town ("the Long Shot") + Sector 1 as "dungeon 2."** New
  `#town-scene`, `showTown`/`renderTown`, and `returnToHub()` (Retire/New-squad/Abandon/a
  no-`nextDungeonKey` boss-clear now route through it, except still inside the prologue). Town is a
  new save checkpoint (`lastCheckpointScene` tracks Map vs. Town so `loadGame` resumes onto the right
  one) with its own explicit Save button. `showCharacterPanel` generalized (new `heroList`/`returnTo`
  params, backed by module state `charPanelHeroList`/`charPanelReturnTo`) so Town can open it against
  the whole `roster` and return to Town, not just `party`/the battle endbar — the battle endbar's
  Character button now explicitly passes `(undefined, party, "battle")` so no state leaks between
  contexts. New `showInventoryPanel`/`removeInventoryPanel` — a read-only party-wide view (the
  "shared party inventory screen" design §7.1 flagged as still-open). New `grantShipStartingItems()`
  — a fixed, hand-picked one-time grant (Kevlar Mesh, Tactical Sidearm), called from
  `showPrologueEpilogue` right before it now routes to `showTown()` instead of `showSelect()`. **Bug
  fix surfaced by this work:** `findWornBy` scanned only `party`, not `roster` — harmless before
  (nothing let you equip a benched hero), a real under-report once Town's Roster screen does exactly
  that; fixed to scan `roster`. Sector 1 gets a new `recruit1` node (Wren, Netrunner) prepended as
  its `start`, placed before the branch point so every playthrough meets her regardless of path;
  recruits now only join the active `party` if `party.length < 3` (the cap), not unconditionally —
  Sector 1's pre-chosen squad could in principle already be full, unlike the prologue's forced-solo
  start. Inserting `recruit1` required shifting every other Sector 1 node's `depth` by +1; since
  `rollEncounterForNode`'s `levelFor()` scales off `depth`, a sim comparison showed this alone
  dropped the risky branch's clear rate ~53%→~32% for the story's fixed trio. Fixed with a new
  per-node `levelDepth` field (the original pre-shift depth) that `levelFor()` now prefers over
  `depth` — decouples map-row position from balance position; restored to ~48%/~78%. New
  `onHeadToStation()` — a one-time "why we're attacking the station" briefing before Sector 1's
  squad-builder, gated by new state `sector1BriefingShown`. Verified headless (extended the H3
  driver through Town/Inventory/Character-from-Town/the briefing/into Sector 1's recruit node — 55
  checks) and via a dedicated Sector-1-traversal sim (both branches, shifted vs. pre-shift depths,
  to isolate and confirm the fix) and in-browser via claude-in-chrome (Town/Inventory/Character
  panels all rendering correctly with real CSS, no scroll issues). Next: Phase H5, inventory/loadout
  screens proper.
- **2026-07-23** — **Phase H3 shipped: the story-mode prologue, "Kharon's Reach."** `DUNGEON_MAP`
  became `DUNGEONS` (a registry keyed by new state `currentDungeonKey`, each entry with `title` +
  `nextDungeonKey`) — `prologue` (4 linear nodes) and `sector1` (the original 9, unchanged shape).
  New `recruit` node type (`resolveRecruitNode`). New reusable `showStoryScene(paragraphs,
  buttonLabel, onContinue)` used by the new `showIntroScene`, `resolveRecruitNode`, and
  `showPrologueEpilogue`. New prologue-only content: `SKILLS.batonStrike/ironDiscipline/
  overseersLash/overseersCrackdown`, `ENEMIES.colonyGuard/krell`, `rollPrologueEncounter` (hand-
  scripted, not pool-drawn). `onConfirmName` now routes to `showIntroScene` instead of `showSelect`
  — first deploy skips the squad-builder entirely (forced solo, nothing to pick). `deploy()` now
  passes `currentDungeonKey` through to `startDungeon`. `renderEndbar`'s boss-clear check became
  data-driven (`node.type==="boss"`, not a hardcoded `"boss"` id) and branches on `nextDungeonKey`.
  **Real behavior/correctness change, not just prologue content:** `startDungeon` now fully heals
  HP/EN and clears effects at every fresh dungeon ATTEMPT — required once Phase H2 made heroes
  persist by reference across dungeons (else redeploying after a wipe would field an already-dead
  party and instant-lose forever); does not touch the existing no-heal-*within*-a-dungeon rule.
  **Verified headless:** a 32-check full-playthrough driver (Title→Start→Name→Intro→p1→p2→recruit
  Kade→p4 boss→epilogue→sector1 squad-builder) plus a dedicated wipe/retry driver (force 0 HP → lose
  → New squad → redeploy → confirms full heal, not a soft-lock) plus balance sims for all three
  prologue fights. **Krell balance (two sim passes):** first pass (hp70/atk12/def7) was 100% win in
  3-6 actions at 89%+ party HP remaining — a solo-boss-vs-2-hero-party structural non-fight (the
  party gets ~2 actions/round to the boss's 1, so HP alone can't create tension). Buffed to
  hp140/atk20/def10 + a 3rd AoE special (`overseersCrackdown`) — landed at 0 losses in 200 naive-
  attack-only trials but 59% avg party HP remaining (real tension, still not walling new players).
  p1 (vs 1 Spider Drone) and p2 (vs 2 Colony Guards) confirmed intentionally light: 100% win, 87-89%
  hero HP remaining even under naive play. **Verified in-browser** via claude-in-chrome against a
  real `python3 -m http.server` instance — real rendering of the intro/map/combat screens, real
  `.targetable` highlighting, and (important discovery) real combat requires pacing clicks against
  the game's actual `setTimeout` delays (500-700ms) — the headless harness's instant-resolve
  `setTimeout` stub doesn't reflect real timing, so a tight synchronous click-loop outpaces the UI;
  spacing clicks with waits confirmed a full real round resolves with correct damage math end to end.
  Next: Phase H4, the Town scene (the small ship the prologue ends on).
- **2026-07-23** — **Phase H2 shipped: player-named hero + roster-driven squad-builder.** New
  `roster` global (persistent — only `onStartClicked` resets it) distinct from `party` (the deployed
  subset); `party` entries are now the SAME objects as their `roster` entries (`buildParty` looks up
  by id/reference, no longer calls `createHero` fresh), so level/xp/equipment/limit carry across
  dungeons. New `#naming-scene` + `renderNamingScreen`/`onConfirmName` — Start always begins a truly
  fresh game (roster/party/items reset) and routes through naming before the squad-builder; the typed
  call-sign becomes the hero's `name`, visible everywhere `h.name` already renders (squad-builder
  cards, combat panels, the Character Sheet). `renderSelectScreen`/`toggleSelect`/`refreshCardStates`
  rewritten to read `roster` instead of `CLASSES` (`selectedClasses`→`selectedHeroIds`, now hero ids
  not class keys). Save schema changed to serialize `roster`+`activePartyIds` instead of `party`
  directly, specifically to preserve object-reference sharing across a `JSON.stringify`/`parse`
  round-trip (see the `buildSaveData` entry in §4 D for why). `partyOwnedItems` no longer resets in
  `startDungeon` (only on a fresh Start) — required once hero equipment persists across dungeons, to
  avoid a hero showing gear the party no longer "owns." Verified headless (a 22-check jsc+DOM-stub
  driver: Start → Naming → type a name → Confirm → squad-builder shows the named/leveled card →
  select by id → Deploy → mutate level/hp → save → simulated reload → roster/party correctly
  re-linked by reference) **and** in-browser via claude-in-chrome against a real `python3 -m
  http.server` instance — including a genuine full page reload confirming the named hero ("Vex")
  and the `party[0] === roster[0]` reference identity both survive real `localStorage`. Note: the
  extension's synthetic keyboard/mouse dispatch (`computer` tool `type`/`key`/coordinate `left_click`)
  did not register on this page in this session (focus and `elementFromPoint` both confirmed the
  right element was targeted, so this reads as an environment/tooling limitation, not a game bug —
  same class of issue as the already-documented screenshot timeouts); verification fell back to
  real `.click()` calls via `javascript_tool` and direct value+`dispatchEvent('input')`, which
  exercise the actual DOM/render/event-handler pipeline just not raw OS-level keystroke synthesis.
  Next: Phase H3 (prologue town + solo/duo encounters + first recruit events).
- **2026-07-23** — **Phase H1 shipped: Title scene + real save/load.** New `#title-scene` container
  (entry point — `showTitle()` replaces `showSelect()` at the bottom of the script); `SCENE_DISPLAY`
  extended to 4 scenes. `renderTitleScreen`/`onStartClicked`/`onContinueClicked` plus a small save
  engine (`SAVE_KEY`/`buildSaveData`/`saveGame`/`hasSave`/`loadGame`/`clearSave`) against
  `localStorage`, checkpointed inside `showMap()` (arriving on the Map stands in for "arriving in
  Town" until Phase H4 builds a real Town scene). Start still goes to the existing pick-up-to-3
  Select screen — the roster/solo-start split is Phase H2, not this slice. Verified headless (a
  new jsc+DOM-stub harness driving real clicks: Title → Start → pick Merc → Deploy → Map → save
  written → simulated reload → Saved Game → party restored, 21/21 checks) **and** in-browser via
  claude-in-chrome: a genuine full page reload against a real `python3 -m http.server` instance,
  clicking the real Saved Game button, confirming the deployed Merc (with its current HP) survives
  an actual browser reload from real `localStorage` — not just the headless simulation. No layout
  regression (`pageScrollNeeded` stayed false on the Title screen). Next: Phase H2 (roster split).
- **2026-07-22** — Created from `game.html` at v2 (Phase A + select + enemy roster/AI + balance pass).
- **2026-07-22** — Phase B: added damage types (`damageType` on skills) + affinities (`affinities` on
  combatants/templates, `affinityMultiplier` helper, `NEUTRAL/WEAK/RESIST/IMMUNE` tiers), affinity
  multiplier + super/resist/immune feedback in `applyToTarget`, `log()` class-string support,
  `capitalize`, and damage-type labels on skill buttons. Balance re-verified (48/95/12).
- **2026-07-22** — Removed true immunity: `IMMUNE 0` → `HARD_RESIST 0.2`; damage floored at ≥1 always;
  feedback ×0-branch replaced with "Barely a scratch." (≤0.25). Balance held (48/96/16).
- **2026-07-22** — Phase C: status-effect engine. Added STATUSES registry (burn/weaken/sunder/guard/
  disable/confuse), `nature` field + nature-lock, skill `applies` + `kind:"status"`, helpers
  (hasStatus/getStatus/effectiveAttack/effectiveDefense/guardMultiplier/addEffect/applyConfusion),
  `tickEffects` rewritten (returns disabled), `beginTurn` DoT-death/disable handling, confusion in
  both resolve paths, status pips in `updateScreen` + CSS. Demo skills: Guard (DK), Incendiary Rounds
  (Mech Runner), Mind Spike + Terror (Mentalist), System Shock (Netrunner), Mark Target (Squad Leader).
  Balance baseline unchanged (~50/95/17); statuses are additive tactical depth.
- **2026-07-22** — Phase D Slice 1: special rebalance + full kits + `pierce` (armor-pierce). New skills
  `aimedShot` (Merc signature), `hack` (Netrunner Cyber signature = Mech-killer, ×2.0). Buffed
  `crushingBlow` (power 18, pierce .3) and `railShot` (power 22, pierce .5). Base kits now: Merc
  [attack/aimedShot/fragGrenade], DK [attack/crushingBlow/guard], MechRunner [attack/railShot/incendiary],
  Netrunner [attack/hack/empBlast], Mentalist [attack/psiBurst/mindSpike/mend]. `systemShock`, `terror`
  are GATED (unlocked via level/skill-tree later; still defined in SKILLS). Mech now killable; good
  squads ~87–100% vs the (soon-to-be-"hard") 6-stack. (Difficulty picker later cut — difficulty is
  emergent via levels/zones, not a picker; see design doc §4/§12.)
- **2026-07-22** — Phase D Slice 2: roster → 6 enemies in 3 tiers, Tiangong-branded. New mobs `hullRoach`
  (organic fodder, weak Thermal/Psionic), `arcSentinel` (synthetic standard; Shock basic `arcBolt` +
  `arcDischarge` Disable; hurts the Shock-weak Netrunner), `tiangongPvt` (organic standard; `suppressingFire`
  Weaken). Added `tier` field (+ on instances); rebranded roles; renamed `squadLeader`→`tiangongLt`.
  AI now uses each enemy's own first attack as its basic. New default encounter = a medium showcase
  (Lt+Arc+Pvt+Drone+2 Roach). Next: Slice 3 (difficulty picker).
- **2026-07-22** — Phase E core (leveling foundation): heroes gain `xp`/`xpToNext` + `CLASSES.growth`
  per-level stat growth; `levelUp`/`awardXp`/`xpForNext`. Enemies gain `level` (scales HP/ATK/DEF by
  `ENEMY_SCALE_PER_LEVEL=0.08`) + `xpReward` (`TIER_XP[tier]×level`). Run loop: `startRun`→`beginEncounter`
  (party persists, HP/EN refill between fights)→win awards XP→`nextFight` (`encounterLevel++`, tougher
  enemies). `endBattle(outcome)` win/lose/flee. `updateScreen` refreshes subtitle live. Skill-tree
  unlocks + no-heal run-persistence are later slices. Ramp verified (good squads 36–40 fights, weak ~10).
- **2026-07-22** — Phase E skill trees: `SKILL_TREES[classKey]` (nodes with cost/prereq), hero
  `sp`/`unlockedNodes`, `SP_PER_LEVEL` (awarded in `levelUp`), `canLearnNode`/`learnNode`. New skills
  `cleave` (DK), `overclock` (Mech Runner, + new `overclock` buff status, +ATK, wired into
  `effectiveAttack`), `firewallBreach` (Netrunner tier 2), `cerebralOverload` (Mentalist tier 2); reused
  existing `suppressingFire`/`systemShock`/`terror` as tier-1 unlocks. `endBattle` split into
  `endBattle`+`renderEndbar` (`lastOutcome` tracked) so reopening the endbar from the Skills panel never
  re-awards XP. Minimal debug UI: `showSkillsPanel`/`removeSkillsPanel`, a "Skills" button on the win
  endbar. `#battle` gained `overflow-y:auto` as a safety net for the new panel. Verified headless (prereq/
  cost/already-learned enforcement, no double-XP, learned skill usable in combat) AND in-browser via real
  DOM clicks (button wiring, 2-tier chain completes with enough SP, layout doesn't regress — `pageScrollNeeded`
  stayed false, learned skill appeared as a real action button next fight).
- **2026-07-22** — Equipment + Character Sheet: `EQUIPMENT_SLOTS`, `ITEMS` (18 items, `classRestrict`
  on Arms/Ring, `grantsSkill` on Arms, `spriteKey` placeholder), hero `equipment` field, `applyStatBonus`/
  `addItemEffects`/`removeItemEffects`/`equipItem`/`unequipItem`. 5 new Arms-granted skills (wristRocket/
  powerFist/terminalProbe/psiConduit = signature single-target bursts; shoulderRocket = Thermal AoE).
  **Replaced** the old Skills panel entirely with `showCharacterPanel`/`removeCharacterPanel` — a
  per-hero-tabbed panel with Stats/Skills/Equipment sections (`#skills-panel` and its functions no
  longer exist). Endbar's "Skills" button renamed "Character". Verified headless (class-restriction
  enforcement, stat bonus apply/revert exactly, Arms skill grant is reversible not permanent, double-
  equip guard, granted skill works in combat) AND in-browser via real clicks (per-hero eligible-item
  filtering in the live UI, stat math correctly composing with level growth, independent per-hero
  equipment state across tabs, no layout regression).
- **2026-07-22** — Combat UI light QoL pass: hero call-signs (`HERO_NAMES` = Matteo/Vito/Nat/Tupac/
  Jaime/Nero, pick order, player-editable later); panels show Name + "Class · Lv N" (`className`/`level`
  on hero); FF orientation (enemies-left/heroes-right `#battlefield` columns, responsive stack ≤560px);
  bigger zebra-striped log. Full FF bottom-band overhaul deferred (needs Limit + levels + sprites; §8.1).
- **2026-07-22** — **D½ Limit Break + equipment ownership fix shipped.** Limit Break: persistent 0–100
  gauge, 5 class ultimates, `applyToTarget` gauge-gain hooks, `cleanse` heal flag, `chooseLimitBreak`
  activation, `.limit-btn`/`.limit-fill` UI. Gain rates tuned down twice after simulation showed the
  first pass firing 2+ times/fight (trivial) — landed at ~once/2 fights, verified to meaningfully help
  a weak squad (~5.7→~8.0 fights survived) without breaking balance. Equipment ownership: `partyOwnedItems`
  (party-wide, reset each run), `findWornBy` + transfer-on-equip, `rollLootDrop` (interim 40%-per-win
  source), Character Sheet equipment rows now filter to owned+eligible only ("Nothing found yet"
  otherwise). Verified headless (gauge math, all 5 ultimates' effects incl. AoE/cleanse/party-buff,
  ownership gate blocks unowned equip, transfer moves gear between heroes, loot roll grants ownership)
  AND in-browser via real clicks (button progress text/disabled state, gauge resets after use, "Nothing
  found yet" → real equip option the instant ownership is granted). Next: minimal scene manager, then
  a first mini-dungeon map.
- **2026-07-22 (session end)** — No code changed. Flagged `encounterLevel`/single-`ENCOUNTER` (§I) as
  slated for replacement by the map's per-node encounter composition (design doc §5.1) — read that
  warning before extending the current leveling loop further.
- **2026-07-22 — Phase F + Phase G shipped** (scene manager + first mini-dungeon map). Built in six
  verified slices (headless sim + in-browser DOM checks each time, per §9):
  - **Scene manager:** `goToScene`, `#map` container, `showMap`.
  - **Static map:** `DUNGEON_MAP` (9 nodes), `NODE_TYPE_LABEL`, `renderMap`, `onNodeClick` traversal
    (locked/visited/unlocked), `startDungeon` (replaces `startRun`).
  - **Real encounters:** authored the **Talos Systems** roster (`talosWraith`/`talosPhantom`/
    `talosVanguard`) and boss **`warden`** ("The Warden") + their skills; `ENEMY_POOLS`; generalized
    `buildEnemies` to a pre-resolved `[{key,level}]` list; `rollEncounterForNode`/`depthLevel`;
    `enterNode`/`resolveNodeVictory` replace `beginEncounter`/`nextFight` (deleted, along with
    `ENCOUNTER` and `encounterLevel`); `renderEndbar` gained a distinct "Dungeon Clear" branch.
  - **Loot/Rest nodes:** `grantLoot`/`restParty`, `resolvePassiveNode`, `lastMapMessage` shown on the Map.
  - **No-heal persistence:** removed `enterNode`'s HP/EN refill + item restock (design §4.2).
  - **Balance pass:** found and fixed a real structural gap (no recovery between the final Elite gate
    and the Boss → added Rest node `n8`) and a real numeric gap (elite level jitter spiking upward,
    boss EN-starvation attrition spiral) via headless sim with a smarter auto-play harness (affinity-
    aware skill choice, Limit Break usage). Full findings in §9. Final state: a tanked/healer/counter
    squad clears the safe branch reliably and the risky branch with real tension (~50–65%); squad
    comp still measurably matters (no-tank squad clears less often).
  - Verified in-browser via claude-in-chrome + DOM measurement each slice (no layout overflow, panels
    render correctly incl. the 300+ HP boss panel, real click-driven node unlocking).
  - **Known gap carried forward:** no EN-restoring item exists yet (only Stim, HP-only) — design §4.2
    mentions "EN Cell" as a future item; still not authored. Worth adding if EN-starvation attrition
    resurfaces once more content (skill trees, equipment) changes the numbers again.

## 12. Battle mechanics overhaul — migration & schema reference (2026-07-26, SPEC ONLY, not yet built)

Design rationale and locked decisions live in `gridfall-design.md` §3.2a (damage buckets), §3.3 (new
statuses), §3.7 (full plan this section elaborates), §4.1a (skill trees). This section is the concrete
"what code actually changes" reference for whoever builds it — written as a plan, before any file was
touched, per the user's explicit request to think through effects/breakage first.

**New/changed constants (data.js):**
```
const DAMAGE_TYPE_CATEGORY = {
  kinetic: "physical", corrosive: "physical",
  thermal: "thermal",
  shock: "shock",       cyber: "shock",
  psionic: "mind",
  void: "exotic",       gravity: "exotic"
};
const HARD_RESIST = 0.2, RESIST = 0.5, NEUTRAL = 1.0,
      MILD_WEAK = 1.25, WEAK = 1.5, DOUBLE_WEAK = 2.0;   // MILD_WEAK/DOUBLE_WEAK newly named
const TACTIC_SLOTS_BASE = 2;
function tacticSlotsForLevel(level) { return TACTIC_SLOTS_BASE + Math.floor(level / 4); }  // tunable
```

**Changed functions (state.js):**
- `affinityMultiplier(target, damageType)` — resolve via `DAMAGE_TYPE_CATEGORY[damageType]`; return `1`
  unconditionally when the category is `"exotic"` (no table lookup at all for Void/Gravity).
- New `healMultiplier(c)` (mirrors `guardMultiplier`, ~line 137) — `let m=1; c.effects.forEach(e => { if
  (e.type==="irradiate") m *= 0.5; }); return m;` (flat 50% heal-block while irradiated, not a magnitude
  field — simplest shape, matches how `guard`'s multiplier is authored per-skill rather than per-status).
- New `effectiveSpeed(c)` (mirrors `effectiveAttack`/`effectiveDefense`, ~line 123-135) — subtracts
  `pin` magnitude, floors at 0.

**Changed functions (engine.js):**
- `applyToTarget`'s heal branch — multiply the restored amount by `healMultiplier(target)` before the
  `clamp`, same pattern as the damage branch's `guardMultiplier(target)` call.
- The initiative sort (currently `combatants.slice().sort((a,b) => b.stats.speed - a.stats.speed)`) —
  switch to `effectiveSpeed(b) - effectiveSpeed(a)`.
- `learnNode` — branch on `node.type`. `"active"` keeps today's exact behavior (push `skillKey` onto
  `hero.skills`). Every other type instead only records the unlock (`hero.unlockedNodes.push(nodeKey)`,
  SP spent) — no `hero.skills` push, no combat-facing effect until socketed.
- New `canSocket(hero, nodeKey)` / `socketPassive(hero, nodeKey)` / `unsocketPassive(hero, nodeKey)` —
  enforce `sum(socketed slotCosts) + node.slotCost <= tacticSlotsForLevel(hero.level)`; callable only
  from Rest-node and Town code paths (not from the in-combat action bar).
- Passive effects need a resolution hook wherever their target stat/roll already gets computed —
  e.g. a `+pierce%` passive folds into the `pierce` term of the damage formula in `applyToTarget`
  (currently `def = effectiveDefense(target) * (1 - (skill.pierce || 0))`), a weakness-payoff passive
  hooks the existing `gainLimit` call right after the `mult > 1` check. Exact hook points depend on the
  specific passives authored in the Content Authoring build step — no generic "effect interpreter" is
  being built up front; each passive gets a small, explicit hook, matching how Weaken/Sunder/Guard were
  each added individually rather than via a generic buff engine.
- No changes needed: `chooseEnemyAction`/`pickEnemyTarget`/`enemyThreatScore`/`estimateEnemyDamage` (call
  `affinityMultiplier` generically already) — smoke-test only, not expected to need edits.

**Changed schema (hero object, state.js `createHero`):**
```
tacticSlots: tacticSlotsForLevel(1),   // recomputed on level-up, same place growth/xpToNext update
socketedPassives: [],                  // subset of unlockedNodes currently active, sum(slotCost) ≤ tacticSlots
```

**UI changes (ui.js):**
- `skillsSectionHtml` (engine.js) — group nodes by branch (indent/label under their tree's root) instead
  of one flat list; add a "learned but not socketed / socketed" state per non-active node.
- New Tactic Slots sub-panel in the Character Sheet Skills tab — lists a hero's unlocked non-active
  nodes with a socket/unsocket toggle, a running `used/total` slot counter, disabled when not at a
  Rest/Town screen. No visual node-graph — stays a data-driven text list, matching this project's
  established "cheap, text-first, graphics later" discipline (same choice the dungeon map itself made
  before the hex-icon pass).
- `statsSectionHtml`'s affinity display (`capitalize(k) + " ×" + value`) and the skill-menu damage-type
  label (`" · " + capitalize(skill.damageType)`) both need ZERO changes — both already render whatever
  keys/strings exist generically.

**The 42-affinity-table migration** — fully hand-audited in design doc §3.7 (corrected 2026-07-28 after
the Thermal/Shock split); this is the mechanical checklist, now backed by a completed audit rather than
a methodology to apply later:
1. `kinetic`+`corrosive` → `physical` (1 conflict found, `demon`, both sources already agreed — pure
   rename in practice). `thermal` → `thermal` (pure rename, no template ever had a second Thermal
   source). `psionic` → `mind` (pure rename, always single-source). `shock`+`cyber` → `shock` (the only
   bucket with real conflicts — see design doc §3.7 for the full resolved case list: same-direction
   conflicts take the more extreme value; organic-only single-source `cyber: HARD_RESIST` entries with
   no `shock` companion dampen one step to `RESIST`).
2. Clamp every resulting `physical` value into `[RESIST, DOUBLE_WEAK]` — checked, never actually
   triggers on current content (nothing today sets `kinetic`/`corrosive` below `RESIST`).
3. Also add the 3 new personal affinities for the previously-empty classes (design doc §4.1a):
   `merc.affinities.physical = MILD_WEAK`, `dreadKnight.affinities.physical = RESIST`,
   `mechRunner.affinities.thermal = RESIST`.
4. Re-run the sim suite (§9) after every ~5-10 templates, not all 42 at once — catches a bad
   reconciliation call immediately instead of compounding it across a whole dungeon's roster.

**Regression risk / save-compat / build sequencing:** design doc §3.7 has the full table and 6-step
build order (Foundation → skill-tree engine → content authoring → optional flavor seeding → full-game
regression sim → real playtest). Not duplicated here — that section is the source of truth for
sequencing; this section is the source of truth for exact code shape.
