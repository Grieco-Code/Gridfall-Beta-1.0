# GRIDFALL — Master Design & Planning Document

*A living document. We edit and extend this as we build. It supersedes the v1 kickoff
and v2 plan as the single source of truth for direction; those remain as history.*

**Last updated:** 2026-07-24 · **Current build:** v4 — a post-beta difficulty & content pass (§12,
2026-07-24): smart enemy targeting/statuses/boss adds (Phase 1a/1b/1d), global difficulty knobs (1c),
**Dungeon 4 "Talos Bio-Foundry" shipped** (§5.4/§5.4a — fog of war, Unknown nodes, dead-end spurs,
weighted loot, the Regen status, two faction-differentiated wings, boss Proteus; see the changelog for
the full build + the two real bugs the sim-tuning process caught), and **Dungeon 5 "Helios Station"
bones shipped** (§5.4b — a genuinely new map SHAPE: a circular/radial layout with a double boss dead
center, not the depth-row diamond every prior dungeon used; a narrow Void/Entropy preview roster; two
engine generalizations, a per-node boss-encounter override and non-terminal boss nodes, both reusable
by Dungeon 6 or the endless portal later). **Remaining story content: Dungeon 6 (dead Earth finale)**,
plus a balance/"smart autoplay" tuning pass on Dungeon 5 (structurally verified, zero crashes, but only
naive-floor tested so far — see §5.4b) and a sprite-art pass for both Dungeon 4's and Dungeon 5's new
rosters (currently generic-blob fallback — see [[gridfall-sprite-workflow]]). Everything below this line is
the v3 changelog, kept as history. · **Prior build:** v3 — Phases A–G: the v2 combat core (damage types,
statuses, tiered Tiangong roster, skill trees, equipment, leveling, Limit Break) plus a real scene
manager and the **first mini-dungeon** (Tiangong Station Sector 1, 9 nodes, Talos Systems as a 2nd
faction, boss "The Warden"), with no-heal-between-fights run persistence — **plus Phase H1 (Title
scene + real `localStorage` save/load), Phase H2 (a player-named starting hero, a persistent
`roster` distinct from the active party, and a roster-driven squad-builder), Phase H3 (the
story-mode prologue, "Kharon's Reach" — see §5.2a), Phase H4 (the Town scene, "the Long Shot" —
see §5.2c, plus Sector 1 reframed as "dungeon 2" with a new mandatory Netrunner recruit node), and a
**post-H4 tightening pass** (§5.2d — story text cleaned up, Wren's recruit node repositioned,
difficulty and Limit Break pacing both retuned), and **Phase H5** (§5.2e — Party Inventory made
actionable, the Character Sheet's Stats section grown into a real overview, item effects shown
inline everywhere), and **Phase L** (§5.3 — **Dungeon 3, "Site Erebus," shipped**: the bug-planet
crash, five hive castes, boss "the Broodmarshal" with a new generic mid-battle reinforcement engine
hook and a one-time "jam the relay" interactable, the Sector 1 → Erebus → Town story handoff).**
**Next build:** Phase I is nearly done (combat sprites, hex-node map, region + combat backdrops all
shipped; only UI/menu theming polish remains). **Story canon is now locked (§9, 2026-07-23):** a
tight 3-act arc in one Sol system ending on dead Earth — cage-vs-merge corporate war over an ancient
precursor engine. Remaining content = **Dungeon 4 (Talos bio-site), Dungeon 5 (precursor site),
Dungeon 6 (dead Earth finale + player-choice ending)**. The immediate next authoring target is
**Dungeon 4** (§9.4). Also done this session: `game.html` split into 5 classic `<script>` files.

---

## 1. Vision & pillars

GRIDFALL is a **gritty space-core, turn-based RPG** — classic Final Fantasy combat feel,
re-skinned as cyberpunk/space opera. The long-term shape is a **repeatable dungeon crawler**:
pick a squad, fight through a branching run of encounters, grow stronger, push into tougher
regions, and eventually chase a loose overall goal.

**Design pillars (what we optimize for):**

1. **Combat is the core.** Everything else exists to feed interesting fights. We invest the
   most here: damage types, resistances/weaknesses, status effects, class identity.
2. **Choices matter.** Squad composition, targeting, path selection, and loadouts should all
   change outcomes. (Our balance sim already shows squad choice swinging win rates from ~15% to ~99%.)
3. **Data-driven content.** Skills, enemies, items, status effects, affinities, maps, and
   regions are all defined as *data tables*. Adding content = editing data, not rewriting logic.
4. **Build-free & runnable.** Stays vanilla HTML/CSS/JS, no frameworks or build step, hostable
   as static files and playable on a phone.
5. **Small, explained, iterative steps.** Each slice is playable and reviewed before the next.

---

## 2. Current state (what's built)

- **Combat engine** runs on *lists*: `party` (≤3) vs `enemies` (≤6), initiative by Speed,
  "actor acts on target" model, one `applyToTarget()` core.
- **Targeting:** click-to-target for single-target skills; auto-resolve for self/AoE.
- **Character-select screen:** all 5 classes, pick up to 3, pick order = party order.
- **Classes (starter kits):** Merc, Dread Knight, Mech Runner, Netrunner, Mentalist — currently
  damage/AoE/heal only (debuffs/guard/taunt deferred until the status engine exists).
- **Enemies:** Spider Drone (tuned to hit harder), Security Mech (AoE Rocket Barrage),
  Squad Leader (Command Strike + a *probabilistic* Repair heal — a mini-boss).
- **Enemy AI:** picks between basic attack, specials, and heals; difficulty knobs at top of script
  (`AI_SPECIAL_CHANCE`, `AI_HEAL_CHANCE`, `AI_HEAL_THRESHOLD`).
- **Shared item bag** (Stim); Run to flee; Rematch / Change-squad flow.
- **Status-effect seam** (`tickEffects`) present but empty, awaiting Phase B.
- **Balance verified by headless simulation** (JavaScriptCore + a DOM stub) — we can keep
  stress-testing balance as content grows.

---

## 3. Combat system design (the core — deepest section)

### 3.1 The turn loop (keep)
Round-based, everyone sorted by Speed each round; heroes prompt the player, enemies use AI;
status effects tick at the start of each combatant's turn; win when one side is wiped.
**No positioning/grid in combat** — it stays menu-driven JRPG. (Tactical positioning is a
deliberate, much larger future fork; see §6.)

### 3.2 Damage types & affinities (NEW — the big depth lever)
Every damaging skill gets a **damage type**. Every combatant has an **affinity table** of
multipliers (default 1.0). Damage is multiplied by the target's affinity for that type, with
clear log feedback ("Super effective!" / "Resisted.").

Proposed space-core damage types:

| Type | Flavor | Strong vs | Weak / resisted by |
|------|--------|-----------|--------------------|
| **Kinetic** | bullets, melee, shrapnel | organics, light targets | heavy armor (Mech) |
| **Shock / EMP** | electric, arc | machines, drones | insulated/organic |
| **Thermal** | plasma, incendiary | organics, unarmored | heat-shielded |
| **Corrosive** | acid, chem | armor (strips it) | synthetics (sealed) |
| **Psionic** | mind, fear | organic minds | synthetics (no mind) |
| **Cyber / Hack** | intrusion, malware | synthetics & AI | organics (immune) |

Example affinity profiles (the "Mech strong vs physical, weak vs lightning/hacking" idea, generalized):

- **Security Mech:** resist Kinetic (0.5), **weak Shock (1.5)**, **weak Cyber (2.0)**, immune Psionic (0).
- **Spider Drone:** weak Shock (1.5), weak Cyber (1.5), immune Psionic (0).
- **Squad Leader (organic):** weak Psionic (1.25), neutral otherwise, immune Cyber.
- **Space Squid (organic, future):** weak Thermal/Corrosive, resist Psionic, immune Cyber.
- **Heroes have affinities too** (e.g., the Synthetic-race Netrunner is weak to Cyber/Shock but
  resists Psionic) — so enemy variety threatens different squads differently.

Data shape: `skill.damageType = "shock"`; `combatant.affinities = { kinetic: 0.5, shock: 1.5, cyber: 2.0, psionic: 0 }`.
Multiplier 0 = immune; >1 = weak; <1 = resist; (later, negative could mean "absorbs → heals").

**Scope decision (locked 2026-07-22):** ship the **core six** above first. The multiplier
system handles any number of types for free — the cost of a new type is *authoring* (every enemy
needs an affinity profile, every skill a type), so we keep the up-front set legible.

**Reserve types (add later, with new regions/enemies as flavor demands):**
- **Radiation / Bio** — the missing anti-organic-*body* type; completes the symmetry
  Cyber = anti-synthetic · Psionic = anti-mind · Bio = anti-body. Status: Irradiate/Poison (DoT + reduced healing).
- **Cryo** — Thermal's opposite; a second strong control type. Status: Freeze/Slow.
- **Void / Entropy** — exotic alien "unmaking" for the late/organic regions; punches through
  resistances so endgame isn't just resist-stacking.
- **Gravity / Force** — ignores armor, hits DEF-heavy targets. Status: Pin.
- (further reserve, if ever: Sonic/anti-barrier, Photonic/anti-evasion.)

**Model:** start with a **flat** affinity table (above). The **Armor/Shields families** model
(two defense layers — Armor soaks Physical, Shields soak Energy — granted by equipment) is a
planned *later* layer, introduced via character inventory/equipment (see §7).

### 3.3 Status-effect engine (NEW — the deferred Phase B, expanded)
Effects are data on `combatant.effects`: `{ type, magnitude, duration, damageType?, source }`.
They **tick at turn start**: apply DoT, count down, expire. Proposed catalog:

- **DoT:** Burn (Thermal), Corrode (Corrosive, also −DEF), Shock-DoT.
- **Control:** Disable/Hacked (skip turn — Netrunner's signature vs machines), Stun, Slow (−SPD),
  Confuse (may hit a random/own-side target — Mentalist).
- **Debuffs:** Weaken (−ATK), Sunder (−DEF).
- **Buffs:** Guard (−incoming damage), Overclock (+ATK/+SPD), Regen (HoT), Barrier (absorb shield).
- **Aggro:** Taunt (forces enemy AI to target the taunter) — Dread Knight's tank tool.

This unlocks the **full class identities** we deferred, and pairs with affinities (e.g., Shock
both damages *and* can Disable a machine).

### 3.4 Full class kits (target design, built once §3.2/§3.3 exist)
Damage type in brackets; ⓔ = costs EN.

- **Merc** (Kinetic DPS): Attack · Frag Grenade [Kinetic AoE]ⓔ · Suppressing Fire [Kinetic +Slow]ⓔ · Adrenaline [self Overclock]ⓔ
- **Dread Knight** (Kinetic tank): Attack · Crushing Blow [Kinetic]ⓔ · **Guard** [self buff]ⓔ · **Taunt** [aggro]ⓔ · Cleave [Kinetic AoE]ⓔ
- **Mech Runner** (heavy weapons): Rail Shot [Kinetic]ⓔ · Incendiary Rounds [Thermal +Burn]ⓔ · Overclock [self buff]ⓔ
- **Netrunner** (Shock/Cyber control): Attack · EMP Blast [Shock AoE]ⓔ · **Hack** [Cyber, Disable a machine]ⓔ · Firewall Breach [Cyber −DEF]ⓔ · Repair [heal a synthetic ally]ⓔ
- **Mentalist** (heaviest mage + best debuffs): Psi-Burst [Psionic]ⓔ · Mind Spike [Psionic +Weaken]ⓔ · Terror [Confuse]ⓔ · Cerebral Overload [Psionic AoE]ⓔ · Mend [heal]ⓔ

### 3.4a Kit template (locked 2026-07-22)
Every class reads the same shape: **basic Attack (free, Kinetic) · a signature high-damage special
(their type) · one utility (status / AoE / DoT / heal)**. A **4th "advanced" slot** is reserved and
**gated by level / skill-tree** in a later phase — that's the home for the flashiest abilities and
avoids front-loading power. (Designated support Mentalist may run a slightly fuller active kit —
damage + heal + a debuff — because its raw stats are the weakest.)

**The affinity-vs-defense tension (why the Mech felt unkillable):** damage is
`(ATK + power − DEF) × affinity`, so a ×1.5 weakness on a small post-DEF number is still small — the
"counter" class didn't hit hard enough. Fixes: (a) higher special base power; (b) a real
**Netrunner Hack [Cyber ×2.0]** as the Mech's designated answer; (c) **Sunder** to strip armor as a
setup→payoff combo; (d) optional **armor-pierce** (ignore ~half DEF) on a couple of heavy specials.
The Mech stays tanky vs the *wrong* tools and melts to the *right* ones.

### 3.5 Enemy design & AI
**Roster & tiers (locked 2026-07-22):** ~6 types for the first region, tagged by a **tier**:
**fodder** (weak, swarms — early nodes), **standard** (one gimmick each — mid nodes), **elite/mini-boss**
(Security Mech, Squad Leader — late nodes only). Each new region adds ~3–5 more with **different
affinity profiles** so squads must adapt. Enemy-roster building starts here (D) and is formalized into
per-region **enemy pools** at the map phase (G); **leveling (E)** ties tiers to progression so a fresh
party meets fodder first and grows into the elites.

**First-region roster (provisional names, tune via sim):**

| Enemy | Tier | Nature | Gimmick | Notable affinity |
|-------|------|--------|---------|------------------|
*All Tiangong-branded except the Hull Roach (an unbranded hull pest).*

| Enemy | Tier | Nature | Gimmick | Notable affinity |
|-------|------|--------|---------|------------------|
| Tiangong Spider Drone | Fodder | synthetic | swarms | weak Shock/Cyber |
| Hull Roach *(bug)* | Fodder | organic | swarms | weak Thermal/Psionic |
| Arc Sentinel *(Tiangong)* | Standard | synthetic | Shock attacks, can Disable a hero | resist Shock, weak Cyber |
| Tiangong Pvt. | Standard | organic | Kinetic bruiser (+ light Weaken?) | slightly weak Psionic |
| Tiangong Security Mech | Elite | synthetic | AoE barrage, armored | resist Kinetic, weak Cyber ×2 |
| Tiangong Lt. *(was Squad Leader)* | Elite | organic | Command Strike + heal + Sunder | slightly weak Psionic |
- Enemies defined by template + affinity profile + skill list + an AI "role" (bruiser, healer,
  controller, swarm). AI already chooses attack/special/heal; we extend it to *use* affinities
  (target a hero weak to its damage type) and status (apply debuffs, buff allies).
- Bosses = deeper kits, multiple phases later.

### 3.6 Balance via simulation (keep as a practice)
We maintain the headless sim harness to stress-test win rates whenever we add content, so
difficulty stays intentional. Target: a *good* squad ~50–70%, a *bad* comp clearly punished.

---

## 4. Progression & leveling

**Difficulty is emergent, not a menu (decided 2026-07-22).** No difficulty picker. The challenge curve
comes from four levers working together: **party level**, **enemy types**, **enemy levels** (the same
type scales up), and **zone depth** along the dungeon path. Each zone sets a level band + an enemy pool;
deeper zones = higher enemy levels + tougher types. Tiers (fodder/standard/elite) are authoring metadata
for composing those encounters.

- **Enemy levels:** every enemy has a `level` that scales its base stats (and XP reward). Encounters/zones
  set the level, so a "Spider Drone Lv1" and "Spider Drone Lv6" are the same type at different strengths.
- **XP** awarded per encounter, scaled by enemy difficulty (sum of defeated enemies' XP).
- **Levels:** each hero has `level / xp / xpToNext` (curve e.g. `xpToNext = round(40 * level^1.5)`).
- **Growth:** per-level stat gains defined *per class* (Dread Knight gains more HP/DEF; Mentalist
  more EN; etc.).
- **Ability unlocks** at level milestones (e.g., lv3/5/7) — data-driven, ties to loadouts (§8).
- **Region level bands:** each region targets a level range; mobs scale up per region, so
  progression feels earned. Party/level/inventory **persist across encounters and regions**
  (in memory now; saving later).
- **Tie to the map:** completing a region's boss gate grants a big XP payout and unlocks the next,
  tougher region.

### 4.1 Skill points & skill trees ✅ (locked + shipped 2026-07-22)
Skills are **learned by spending Skill Points**, not auto-granted — a "menu of spells/skills that
grows as you go," FF-style.
- Each hero earns **Skill Points (SP)** on level-up (and possibly from Skill rooms / loot).
- Each class has a **skill tree**: nodes that unlock **active skills** (the gated kit — System Shock,
  Terror, Cleave, Overclock, Repair, Cerebral Overload, the Limit Break, …) and **passive upgrades**
  (+stat, +affinity, +pierce, etc.), with prerequisites so builds branch.
- Unlocked actives appear in the combat **Skill menu** (§4.4). This is where the "4th advanced slot"
  from §3.4a actually lives — you *choose* what to unlock.
- SP is a **stored, persistent** resource (part of run state) — "storing skill points."
- **Sub-decisions (2026-07-22):** stat growth per level stays **automatic** (the `growth` table) —
  SP is a **separate** currency spent only in the tree, so the difficulty ramp stays predictable/tunable.
  Tiered skills ("Hack 1/2/3") are **distinct named skills** unlocked in sequence via `prereq`, not
  ranks of one skill — reuses the vocabulary we already have (Suppressing Fire, System Shock, Terror)
  plus a few new ones (Cleave, Overclock, Firewall Breach, Cerebral Overload). First build: the
  **engine, sim-tested, with a minimal debug "Skills" panel** between fights — not the full Character
  Sheet, which comes next.

### 4.2 Run persistence (HP + EN/SP carry over)
Party state — **HP, EN, XP, level, SP, learned skills, inventory, Limit charge** — **persists between
nodes** across a Slay-the-Spire run. **No free full-heal between fights.** Recover via **Rest nodes**
(restore % HP/EN), **items** (Stim = HP, EN Cell = EN), and in-combat heals. This resource-rationing
across ~10–15 fights before the boss is the core roguelike tension that makes map choices matter.
(In memory now; save/load later.)

### 4.3 Limit Break (momentum gauge) ✅ (locked + approved to build 2026-07-22)
Each hero has a **0–100 Limit gauge** (shown on their panel) that **persists across the run**.
- **Fills from momentum:** dealing damage (main driver), healing (secondary), kills/debuffs (bonus),
  and **taking damage** (a smaller trickle — the comeback factor).
- **At 100%:** the class's **Limit Break** unlocks — a powerful signature (e.g. Merc *Full Auto*,
  Mech Runner *Orbital Strike*, Netrunner *system-wide hack*, Mentalist *mass heal / mass Confuse*,
  Dread Knight *party bulwark + counter*). Using it spends the gauge.
- Reuses existing machinery (damage/heal events, per-hero state, panel pips). **Build timing: soon —
  a combat-feel slice right after Phase D mobs/tiering** (it doesn't need the map).
- **Class ultimates (locked 2026-07-22):** Merc *Full Auto* (Kinetic AoE) · Dread Knight *Unbreakable
  Line* (party-wide Guard) · Mech Runner *Orbital Strike* (huge single-target Thermal, heavy pierce) ·
  Netrunner *Total Hack* (Cyber AoE + Disable on every target) · Mentalist *Mind's Mercy* (full-party
  heal + **cleanse**, strips debuffs/DoTs, keeps buffs). Bypasses EN, costs the whole gauge (resets to
  0 on use). Deliberately varied flavor (2 nukes, 1 control, 1 defense, 1 support), not just bigger numbers.
- **Extension point for later:** each class's Limit Break is just a skill-key pointer
  (`CLASSES[classKey].limitBreak`). A future SP-tree node can simply overwrite that pointer to a
  stronger skill — no redesign needed to add "upgraded Limit Breaks unlockable via the skill tree."
- **Pacing (tuned via simulation, 2026-07-22):** the first gain-rate pass fired 2+ times per fight —
  trivial. Cut twice; landed at **roughly once every 2 fights**, and demonstrably helps a weak squad
  survive meaningfully longer (~5.7→~8.0 fights in testing) without being a win-button. Because the
  gauge persists across the run, this also enables a real strategic choice: spend it now, or hoard it
  for a tougher fight ahead.

### 4.4 The command menu (UI evolution)
As learned kits grow past ~4 skills, the flat action bar becomes an FF1-style **command menu**:
`Attack · Skill ▸ · Item ▸ · Limit · Run`. **Skill** opens the learned-spell list (with EN cost +
damage type), **Item** opens the shared bag, **Limit** is enabled only at a full gauge. Built alongside
skill-learning (Phase E).

---

## 5. Map & run structure  ★ key decision

**Recommendation: Slay-the-Spire-style branching node map**, with combat staying menu-style.

- A **run** = one region rendered as a small node graph you traverse forward, choosing paths.
- **Node types:** Combat · Elite (mini-boss) · Boss gate · Loot (items) · Cache (XP) · Skill room
  (learn/unlock an ability) · Shop · Rest (heal / swap loadout).
- **Different mobs per location:** each region has an **enemy pool**; nodes draw encounters from it.
- **Boss gate** ends the region → **Region Clear** → advance to the next region (higher level band,
  new enemy pool with different affinities, so squads must adapt).
- Cheap to render (nodes + connecting lines), no map art needed, pairs perfectly with pixel UI.

**Alternative on the table (parked): hexgrid / tabletop map** — move a token across tiles over an
area image, encounters on squares. It's more immersive but: (a) fights the pixel-art look (photo vs
pixel), (b) adds grid/movement/fog/art work, and (c) tempts a jump to tactical positioning combat,
which would rewrite the core. Revisit as a *later* overworld skin or a deliberate tactical-combat
pivot — not now.

**Regions arc (draft — SUPERSEDED 2026-07-23 by the locked story arc, §9.4):** the old sketch was
R1 Corp Security Station → R2 a raider-held moon → R3 alien/organic depths (Space Squid) → …. The
concrete, locked roadmap is now the 3-act Sol arc in **§9.4** (Kharon's Reach → Tiangong Station →
Erebus → Talos bio-site → precursor site → dead Earth). The raider-moon / Space-Squid ideas survive
only as an optional detour if scope ever expands to a 7th dungeon (not planned).

### 5.1 First mini-dungeon — build requirements (locked 2026-07-22) ✅ SHIPPED 2026-07-22

Dictated at session end as the concrete next build, ahead of any further combat-depth work:

- **Multi-pronged branching tree** — genuine route selection (multiple distinct paths to choose
  between), not a single line with occasional forks. "Limited rails" scope: a small hand-authored
  graph (earlier proposal: ~8 nodes), not a map generator.
- **Limited info per node** — the map shows *some* info per node (its type/category) but not full
  contents; you don't see exact enemy composition or exact loot before committing to a node. Node
  markers are **hexagon-shaped icons** on the path (a visual style choice, confirmed 2026-07-22) — the
  underlying structure stays the locked StS branching tree; this is not the parked hexgrid movement
  model (still parked, §5 "Alternative on the table").
- **Node types (minimum for v1):** Combat · Elite · Loot · Rest · **Boss** (at the very end).
- **Graphics stay deferred** — build the map data/text-driven first, same discipline as everything
  else this session; the visual pass (hex icons, art) comes later (Phase I).

**Mob composition & leveling — supersedes the current global `encounterLevel` mechanic:**
- **Randomize mob makeup** so encounters aren't the same squad every time — each Combat/Elite node
  rolls its enemies from an appropriate pool rather than reusing one hardcoded `ENCOUNTER` array.
- **Per-enemy level, not one global dial** — enemies within the *same* squad can be at **different
  levels from each other** (e.g. a Lv2 Drone alongside a Lv4 Pvt in one fight). Level (and
  composition) is set **per node**, not by a single incrementing `encounterLevel` that raises
  everyone uniformly on every "Next fight." *(The current `encounterLevel`/single-`ENCOUNTER` code in
  `game.html` is a Phase E testing stopgap — it gets replaced, not extended, when the map is built.)*
- **Escalating difficulty ending in a boss** — nodes get harder as the dungeon progresses, culminating
  in a real boss-tier fight at the final node.
- **Bring in a second faction now** for mob variety, rather than waiting for "a later region" as
  originally sketched — **Talos Systems** enemies get designed alongside Tiangong's for this dungeon's
  pool. Cap at these **two factions for now**; hold off on introducing further ones until these are
  established.

**Talos Systems roster (locked 2026-07-22):** deliberately the opposite of Tiangong's synthetic/
Kinetic-Shock bent — **organic, bio-augmented operatives**, leaning **Corrosive/Thermal**, uniformly
**weak to Psionic**. This makes the Mentalist the designated Talos specialist the way the Netrunner
(Cyber/Shock) is the Tiangong specialist — Cyber goes quiet vs. an organic faction, so squads
genuinely have to re-tool between the two, not just fight "more of the same" with a reskin. Sized for
this one dungeon's pool (3 types, not a full 6-type region roster like Tiangong's).

| Enemy | Tier | Nature | Gimmick | Notable affinity |
|-------|------|--------|---------|------------------|
| Talos Wraith | Fodder | organic | fast, swarms, venomed claws (Corrosive) | weak Psionic/Thermal |
| Talos Phantom | Standard | organic | stealth striker, Corrosive blade + a debuff (Weaken/Sunder) | weak Psionic, resist Kinetic |
| Talos Vanguard | Elite | organic | heavy plasma edge (Thermal), high-burst frontliner | weak Psionic ×2, resist Corrosive |

*(Skills/stats/exact numbers not yet authored — tune via sim alongside the map build, same as every
prior roster.)*

**First dungeon boss (locked 2026-07-22): "The Warden"** — a corrupted/malfunctioning Tiangong
station-defense AI core. Keeps dungeon #1 a coherent single-faction story (Tiangong's station going
wrong) with Talos mixed in as the "different threat" among the regular nodes, rather than opening the
corp-vs-corp rivalry this early. Likely kit: Physical/Shock/Cyber (in-faction with the rest of
Tiangong), single-phase for v1 — true multi-phase bosses are a later depth pass (§3.5 already notes
"Bosses = deeper kits, multiple phases later"). Exact kit/stats: authored alongside the Talos roster,
tuned via sim.

**Genre note (locked 2026-07-22):** GRIDFALL is a **JRPG with a persistent world**, not a roguelike
with permadeath runs — the hexnode map is the *shape of one dungeon's path*, not a self-contained "run"
that resets on death. The StS-derived vocabulary ("run", "region") describes the branching-map
*mechanic*, borrowed for its navigation shape only. Party level/XP/SP/skills/inventory/Limit already
persist continuously across fights (§4.2), which is the correct model here. **Towns/hubs between
dungeons or missions** are the intended future connective layer (checkpoints, eventually saving) —
explicitly **out of scope for this build**, which is just the dungeon "bones." **Interim wipe behavior
(locked 2026-07-22):** until towns + a save system exist, a party wipe simply ends the attempt — back
to squad select, no retry, no checkpoint. This is a placeholder, not a permadeath design stance; it
gets replaced once towns/saving land.

---

### 5.2 Story mode, roster & towns (locked 2026-07-23) — NEW, redefines Phase H

**Trigger:** the current game starts every player at a free pick-3-of-5 Character Select and drops
straight into the dungeon — no title screen, no save, no narrative gating. Decided (2026-07-23) to
shift to a **story-mode start**: begin with **one hero**, meet and recruit others as the story
progresses, with **towns/hubs** as the connective layer between dungeons. This pulls roadmap
**Phase K (towns)** forward — it's no longer a distant "future, not yet scoped" layer, it's needed
immediately to host the opening act. Phase K is retired as a separate future phase; it's absorbed
into Phase H below.

**Roster vs. active party (new split):** today `selectedClasses` conflates "everyone who exists" with
"who you're bringing" — pick-3-of-5 IS the roster. Going forward these are two things:
- **`roster`** — every hero the player has recruited so far (persists across the whole save; starts
  at length 1). A hero's persistent state (level/xp/sp/unlockedNodes/equipment/limit) lives here,
  same shape as today's hero object.
- **active party** — up to 3 heroes drawn *from* the roster for the dungeon currently being run. The
  existing squad-select screen becomes a squad-*builder* reading from `roster` instead of all 5
  `CLASSES` — same UI, different data source. Recruiting is what grows the pool of who's eligible,
  not what's paint on a class card.

**Starting hero (locked):** the **Augmented Human Merc** — the original v1 hero from the kickoff doc.
New-game roster = `[merc]`. **Player-named (locked 2026-07-23):** the player types a call-sign for
this hero right after Start, before reaching the squad-builder; that name is what shows everywhere
a hero's name renders — squad-builder cards, combat panels, and the inventory/Character screen still
to come (H5). The same naming step is intended to be reused for later recruit events (H3) — every
companion gets named this way, not just the starter.

**Party management between dungeons (locked 2026-07-23):** the squad-builder (which roster hero(es)
are actively deployed) isn't a one-time pick at game start — it's revisited **between dungeons**, the
same screen reached today after Retire/New-squad/Abandon. As the roster grows past 1 (H3+), this is
where the player chooses which ≤3 recruited heroes to bring on the next dungeon. Today (H2) it's the
seam, not the destination — Town (H4) is where this naturally lives long-term, alongside Rest and
Inventory, but the mechanic itself (build a party from the roster) is already real as of H2.

**Recruit system (minimal, data-driven):** an ordered list of recruit events, each tied to a specific
town/node visit, gated by a simple flag array (e.g. `storyFlags: Set` / array of triggered event
keys). A recruit event pushes a new `createHero(classKey, name)` onto `roster`. No dialogue engine,
no branching narrative logic — same "content as data" discipline as skills/enemies/nodes. Exact
recruit events (which class, at which beat) are authored alongside the prologue content, not designed
in the abstract.

**Balance fix — a new prologue, not a retuned dungeon (locked):** "Tiangong Station Sector 1" (the
existing 9-node dungeon) was sim-tuned assuming a **3-hero squad** (~50–65% clears for a
tanked/healer/counter comp). A solo hero dropped into it as-is gets flattened. Rather than re-tune 9
already-verified nodes for variable squad size, build a **short new prologue** first — a small town
hub + a couple of solo/duo-friendly encounters — where the player starts alone, meets 1–2 companions,
and only *then* is handed off to the existing dungeon at close to full squad strength. The existing
dungeon's balance work is untouched.

**Where the prologue lives (narrative economy):** the prologue town is **the same station**, an
earlier/different area — e.g. "Tiangong Station — Docking Ring" — rather than inventing a wholly
separate location for a few opening beats. "Sector 1" (today's dungeon) becomes the place the story
sends you *after* the docking-ring prologue, not a separate disconnected setting.

**Town scene (new):** a real scene in the scene manager — `Title → Town → Map → Battle → Town → …` —
not just a state inside Battle's endbar. This is also the natural home originally scoped for Phase H
("inventory & loadout screens"): Town is where the player reaches Roster/Inventory/Loadout
(promoting today's post-battle-only debug Character Sheet into a proper reachable screen), Rest
(heal outside combat), and later Shop (§7). Future town *flavor* — space stations, mining ships, an
asteroid base, planets — is reskinning of this one scene type as later regions introduce them; the
underlying Town scene mechanics don't change per-location, only its content/backdrop (ties to the
existing regions arc in §9 and the future graphics pass in §8).

**Save/load (pulled forward, locked):** the title screen's **Start / Saved Game** choice makes save
real now, not a Phase-K-later placeholder — a placeholder button that does nothing would just get
rebuilt immediately after. **`localStorage`**, one JSON blob under a single key, written at natural
checkpoints (arriving in Town, clearing a dungeon node). Serializes: `roster`, active party
selection, `partyOwnedItems`, `storyFlags`, current town/map position, and which dungeon is active.
**Start** begins a fresh game (confirm-overwrite if a save already exists); **Saved Game** is
disabled/greyed when no save exists, otherwise loads and resumes wherever the player left off.

**Visual scope for these new screens (locked):** Title/Town/Roster/Inventory get built in the
existing "space terminal" CSS-only theme — clean, consistent, no canvas/sprites yet. The full
graphics pass stays Phase I; building these screens twice (plain now, sprited later) is exactly the
kind of redo this project's discipline avoids, so match today's visual bar, not less, but don't
reach for canvas art before Phase I.

**Proposed build order (Phase H, each slice playable & reviewed, same discipline as every prior
phase):**
1. **H1 — Title scene + save engine ✅.** `goToScene("title")` as the new entry point (replaces
   `showSelect()` running on load); Start / Saved Game buttons; `saveGame()`/`loadGame()` against
   `localStorage`; checkpoint-write hooks.
2. **H2 — Roster split ✅.** Introduce `roster` distinct from active-party selection; squad-builder
   screen reads from `roster` (length 1 on a new game) instead of all 5 `CLASSES`; player names the
   starting hero right after Start.
3. **H3 — Prologue content ✅.** "Kharon's Reach" — a 4-node Tiangong mining-colony escape (not the
   docking-ring sketched above; superseded, see §5.2a) + a mid-escape recruit beat (Kade, Mech
   Runner) + a duo boss finale (Overseer Krell), tuned via sim.
4. **H4 — Town scene proper.** The small ship the escape ends on. Reachable after the prologue and
   after each dungeon clear; hosts Rest and links to Roster/Inventory.
5. **H5 — Inventory & loadout screens.** Promote the existing debug Character Sheet
   (`showCharacterPanel`) into a real Town-reachable screen; this is the original Phase H scope,
   now sequenced after the pieces it depends on (roster, town) exist.

**Watch-item (not urgent, noted for later):** `game.html` is already ~102KB / a few thousand lines.
§10 already flags the split-into-classic-`<script>`-files plan for when "sprites + multiple screens
bloat it" — Title/Town/Roster/Inventory is exactly that kind of growth. Not a blocker for Phase H,
but worth revisiting once H5 lands.

### 5.2a The prologue — "Kharon's Reach" (shipped 2026-07-23, Phase H3)

**Canon story beats (the source of truth — game.html's narrative text should match this if the two
ever drift):**
- **Setting:** Kharon's Reach, a Vossmark Industries asteroid mining colony (renamed from Tiangong
  Heavy Industries, 2026-07-25 — §9.2). Serfs are born
  already owing Tiangong — debt-bondage from birth, raised in tunnel-dark.
- **Opening beat (no combat — a narrative-only intro screen):** the hero's younger brother, **Dez**,
  reroutes a haul-quota terminal to buy the work gang one shift's rest. **Foreman Voss** executes him
  in front of the gang as an example. While Voss turns to radio it in, the hero (player-named at the
  naming screen, §5.2) kills him and takes his rifle — the literal opening action of the game.
- **The escape (p1, p2 — solo, easy fodder):** colony security responds. p1 = a Spider Drone
  (perimeter security, reused Tiangong content); p2 = two Colony Guards (new fodder, human
  enforcers). Both tuned very light (sim: 100% win, ~87–89% hero HP remaining even with
  naive attack-only play) — these exist to establish combat feel, not to threaten a solo level-1 hero.
- **The recruit (p3 — no combat, a story beat):** **Kade**, a Mech Runner rig operator, is found
  mid-escape and joins on the spot — both the `roster` (persists) and the active `party` (fights the
  finale). Deliberately non-combat: recruiting a permanent companion is a bigger beat than a Loot
  node, so it gets the full-screen story treatment, not the small map-banner one.
- **The finale (p4 — duo boss):** **Overseer Krell**, the colony's chief overseer, blocks the hangar.
  Tuned via sim specifically for a level-1 Merc+Mech Runner duo (§5.2b) — real tension (~59% average
  party HP remaining even on naive attack-only play) without ever walling a new player (0 losses in
  200 sim trials at any skill level tested). Winning triggers the escape epilogue and hands off to
  Sector 1 as the next dungeon.
- **The escape ship** is the epilogue's payoff and becomes the seed of the Town scene (H4) —
  narratively, "two debts paid, a long way still to go."

**Technical shape (see the tech reference for exact function/data-shape detail):**
- **`DUNGEONS` registry** (was a single `DUNGEON_MAP`) — the game now supports more than one
  dungeon, keyed by `currentDungeonKey`. Each entry carries a `title` (Map heading) and a
  `nextDungeonKey` (what a boss-clear advances to; `null` = nothing built past it yet, still true for
  Sector 1). This is necessary, not speculative — a story-mode game needs more than one dungeon by
  construction.
- **A new `recruit` node type** — resolved like Loot/Rest (inline, no battle scene) but via its own
  `resolveRecruitNode`, since gaining a permanent companion needs the bigger story-scene treatment.
- **A reusable `showStoryScene(paragraphs, buttonLabel, onContinue)` component** — one generic
  "narrative beat" screen, not a separate one-off screen (or a full dialogue engine) per moment.
  Used for the intro, the recruit beat, and the epilogue; available for later story moments too.
- **The prologue is entirely hand-scripted**, not drawn from `ENEMY_POOLS`/`depthLevel` like Sector
  1 — a short, tightly-authored escape sequence doesn't need randomized composition, same "unique
  fight, tuned directly" treatment the boss roster already got.
- **A real behavior change surfaced by this build, not just prologue-specific:** starting *any* fresh
  dungeon attempt now fully heals HP/EN and clears effects. This does NOT touch the no-heal-
  between-NODES-within-a-dungeon rule (§4.2, unchanged) — it's a dungeon-*attempt*-boundary thing.
  It was needed because Phase H2 made heroes persist by reference across dungeons: without it, a
  losing solo hero (or the whole prologue, which is mostly solo with no Rest node) could redeploy
  still dead and instant-lose forever — a real soft-lock, not a theoretical one. Also just standard
  genre logic ("you regroup and try again").
- **First deploy skips the squad-builder entirely** — naming the hero flows straight into the intro
  screen, then straight into the prologue (no "pick your squad of 1" step, since there's nothing to
  pick yet).

### 5.2b Balance notes — Kharon's Reach (Phase H3, kept here for the same reason §9's Sector 1
findings are kept: to explain *why* the numbers are what they are, not just what they are)

- **Overseer Krell went through two tuning passes.** First pass (hp 70/atk 12/def 7, single-target
  kit) was a **100% win in 3–6 actions with 89%+ party HP remaining** — no real fight at all. Root
  cause: a solo boss vs. a two-hero party is structurally lopsided (the party gets ~2 actions per
  round to the boss's 1), so HP alone can't create tension — it only changes how long the stomp
  takes. Fix: raised HP to 140, attack to 20, defense to 10, buffed both specials (`overseersLash`
  22 power + pierce, `ironDiscipline` 8 power + Weaken) and added a third, `overseersCrackdown` (a
  Kinetic AoE — a duo has no one to hide behind). Landed at **0 losses in 200 naive-attack-only
  trials, averaging 59% party HP remaining** — real, felt damage taken without ever being punishing,
  which is the intentionally more forgiving bar for a story-hook opening boss vs. the ~50–65% target
  for Sector 1's endgame (§9) — new players shouldn't get walled by fight #1.
- **p1/p2 (the solo fodder fights) were sim-verified light on purpose:** 100% win rate, ~87–89% hero
  HP remaining even under naive attack-only play. These exist to teach combat, not to threaten a
  solo level-1 hero — real difficulty starts at the boss.

### 5.2c Town ("the Long Shot") + Sector 1 as "dungeon 2" (shipped 2026-07-23, Phase H4)

**Town is the general hub, not a one-off post-prologue screen.** Every "return to base" action
(Retire, New squad after a loss, Abandon a run, and a boss-clear with no `nextDungeonKey`) now
routes there via a `returnToHub()` helper — *except* while still inside the prologue itself
(`currentDungeonKey === "prologue"`), which still goes straight to the squad-builder, since Town
doesn't exist yet in the fiction until you've actually escaped. Town is also now a checkpoint
(`saveGame()` on arrival, same pattern as the Map) — and, per this session's explicit ask, also
carries its own visible **Save** button so saving doesn't feel implicit/invisible.

**Town today ("the Long Shot," a battered long-haul shuttle):**
- **Roster row** — every recruited hero, name/class/level/HP, at a glance.
- **Roster & Equipment** — the Character Sheet, generalized (Phase H2/H1's `showCharacterPanel` was
  hardcoded to the active `party` and to returning to the battle endbar) to open against the whole
  **roster** and return to Town — you can review/equip ANY recruited hero here, not just whoever's
  currently deployed.
- **Party Inventory** (new) — the "shared party inventory screen" the design doc flagged as
  still-open (§7.1). Read-only: consumables + every owned equipment item and who (if anyone) is
  wearing it. Equipping itself still happens on the Character Sheet, which already does that job.
- **A mission button** — "Head to the Station" (plays the one-time "why we're attacking" briefing,
  then the squad-builder) the first time, "Prep Squad" (straight to the squad-builder) after.
- **Save.**

**Limited ship salvage (locked 2026-07-23):** on first arrival, a fixed, hand-picked grant — Kevlar
Mesh + Tactical Sidearm — seeds `partyOwnedItems` so Town doesn't open on a completely empty
equipment pool. Deliberately not a loot roll or a "search the ship" interaction — small, curated,
and done, same discipline as every other hand-authored content drop in this project.

**Sector 1 becomes "dungeon 2" (locked 2026-07-23) — reframed, not rebuilt.** Rather than author an
entirely new dungeon, the already-built, already-balance-tested Tiangong Station Sector 1 (§5.1) is
narratively repositioned as the station in high orbit above Kharon's Reach — the same corp, the same
region, an obvious next target. A new one-time story beat ("Head to the Station") explains *why* the
crew turns to fight rather than just running: it's not enough to hide anymore, not with Dez's death
still fresh.

**A third companion recruited inside that dungeon's flow (locked 2026-07-23):** **Wren**, a
Netrunner — found already sabotaging the station's systems from the inside — joins at a new
mandatory entry node, `recruit1`, prepended to Sector 1's existing node graph. "Mandatory" was a
deliberate placement call: Sector 1's original shape branches (safer Combat+Rest vs. riskier
Elite+Loot) immediately after its first node, so a recruit placed on only one branch would be
missable depending on player choice — `recruit1` sits BEFORE that fork, guaranteeing every
playthrough meets Wren regardless of which path they take later. The new companion always joins the
persistent `roster`; they only join the immediate active `party` if there's a free slot (the
existing 3-hero cap) — not assumed, since Sector 1's active party is chosen up front via the
squad-builder and could in principle already be full, unlike the prologue's forced-solo start.

**A real balance-preservation mechanic came out of this, not just Sector 1 content:** inserting
`recruit1` required shifting every existing Sector 1 node's depth by +1 to keep the branch topology's
row-rendering intact. But `depthLevel(depth)` also drives enemy-level *scaling* — a sim comparison
showed the shift alone (see §5.2b's sibling §9) dropped the risky branch's clear rate from ~53% to
~32% for the story's fixed starting trio (Merc/Mech Runner/Netrunner — no tank, no healer, since the
story locks composition rather than letting the player free-pick a "good" comp). That's too punishing
for a mandatory story gate with no comp choice yet. Fix: each Sector 1 node now also carries a
`levelDepth` (its original, pre-shift depth); enemy-level scaling reads THAT, while the render
`depth` (map row position) uses the new shifted value — decoupling "where a node sits on the map"
from "how hard it hits," restoring the original curve. This is a reusable pattern, not a one-off
hack: any future node insertion into an already-tuned dungeon can use the same `levelDepth` escape
hatch instead of accepting a silent balance shift.

**Known gap, carried forward (not urgent):** even with the `levelDepth` fix restoring the original
curve, the story's fixed Merc/Mech Runner/Netrunner trio has no dedicated tank or healer, and Sector
1 was originally tuned assuming a free-pick squad that *could* include one — the risky branch clears
well under half the time for this specific comp (vs. the ~50–65% target for a "good," freely-chosen
squad, §9; see §5.2d for the current number after the tightening pass below). That's within the
range the original design already treats as acceptable for a suboptimal comp ("a no-tank squad
clears less often," §9), and the story doesn't yet offer an alternative comp to pick, so there's
nothing actionable to change *now* — flagged so a future recruit (a tank or healer, if one joins
before harder content) or an explicit rebalance isn't a surprise if this comes up again.

### 5.2d Tightening pass (2026-07-23, post-H4)

A review pass across the story content shipped so far (H2–H4), requested after actual playtesting
turned up two real, concrete problems: the narration read as visibly AI-written, and the Limit Break
system — live since Phase D½ — had never once fired in testing.

**Writing pass — no em-dashes, less "AI voice."** Every player-facing story string (the intro,
both recruit scenes, the epilogue, the Sector 1 briefing, the naming/title screen copy, and the two
boss-defeat log lines) was rewritten: em-dashes replaced with plain sentence structure (periods,
commas, semicolons, colons), and the punchy two-fragment "trailer voice" sign-offs ("He isn't.
Neither are you.") smoothed into fuller sentences. The pre-existing **combat log** format (e.g.
"Merc fires at Spider Drone — 11 damage!") was deliberately left alone — it predates this session
(the original v1/v2 combat feedback format), and it's compact mechanical feedback, not prose.

**Wren's recruit node moved to after n1, not before it.** Originally placed as Sector 1's very first
node so she'd be unmissable regardless of branch; moved to sit right after n1 instead (still before
the branch point, so the unmissable guarantee holds) so the player fights the breach corridor
themselves, solo/duo, before meeting her — a better first impression of the new dungeon than a
non-combat node as literally the first thing you see. Her dialogue was rewritten to match: she no
longer claims to have cleared the corridor herself ("someone beat you to it"), she reacts to the
squad clearing it.

**Difficulty nudged up, globally.** `AI_SPECIAL_CHANCE` (0.35→0.38) and `AI_HEAL_CHANCE` (0.4→0.43)
apply to every enemy in the game, so a small bump here reaches everything without per-enemy
retuning. `ENEMY_SCALE_PER_LEVEL` also went from 0.08→0.1. Sim-checked before settling on these
numbers: a first attempt at a bigger bump (0.35→0.42 / 0.4→0.48) was rolled back after it more than
halved Sector 1's risky-branch clear rate (~48%→~20%) — elite-heavy content is disproportionately
sensitive to AI aggression knobs, since it stacks multiple hard fights with less recovery between
them. The smaller, final bump lands at roughly: Krell (prologue boss) 100%→100% win rate but party
HP-remaining-on-win down a few points (~59%→~58% naive); Sector 1 safe branch ~78%→~70-79%
(sample-to-sample variance is real at n=100, confirmed stable at n=300); risky branch ~48%→~26-29%.
The risky branch is the one absorbing most of this — acceptable, since it's the deliberately
higher-risk optional path (§9), not the mandatory one.

**Limit Break gauge sped up by roughly 5x, not a small nudge.** The original pacing ("once per ~2
fights," §4.3) was tuned against Sector 1's longer, denser encounters. Once story mode added the
prologue's three short fights as most players' actual first experience with the system, a sim check
showed the gauge averaging only 41% by the end of the prologue at 2x the original rates, and it
literally never crossed 100% in 200 simulated playthroughs. It took roughly 5x the original rates
(`GAUGE_PER_DAMAGE_DEALT` 0.06→0.31, `_TAKEN` 0.03→0.13, `_HEAL` 0.05→0.21,
`_STATUS_APPLIED` 1→3, `_KILL` 3→11) before a sim showed it firing at least once within the
prologue's 3 fights in ~73% of playthroughs, averaging right at the 100% threshold by the boss
fight. Not every playthrough — it should still feel earned, not automatic — but no longer
effectively unreachable in short content.

### 5.2e Phase H5 — inventory & loadout screens, grown from H4's first cut

H4 shipped a working Party Inventory (read-only) and a generalized Character Sheet (roster-wide,
Town-reachable). H5 is the "grow into the fuller customize flow" step the roadmap had always
pointed at, scoped to what H4's screens were actually missing rather than a rebuild:

- **Party Inventory became actionable.** Every unequipped owned item now gets a direct **"→ Hero"**
  button per eligible roster hero (respecting class restriction) — equip right from the inventory
  list instead of memorizing what you saw there and going to a different screen to act on it. A worn
  item's "worn by X" is now a clickable jump straight to that hero's Character Sheet, instead of
  static text.
- **The Character Sheet's Stats section became a real overview.** It used to be one line of core
  combat numbers. It now leads with class/race/nature/level, then the same core stats, then the
  **Limit Break gauge %** (checkable outside combat now — a natural companion to the pacing fix in
  §5.2d) and any non-neutral affinities (the "why" behind a weak/resist call players see in the
  combat log).
- **Item effects show up everywhere an item's name does.** Equip buttons and the "currently
  equipped" line (Character Sheet) and every inventory row (Party Inventory) now show what an item
  actually does — its stat bonus (`+4 DEF`) or, for Arms items, what skill it grants — instead of
  just its name. Choices are informed at a glance instead of requiring the player to remember or
  look elsewhere.

Deliberately NOT touched: the Skills section (learned skills already auto-populate the combat menu —
there's no "choose your loadout" decision to surface there, unlike equipment), and no new screens —
everything lives inside Town's existing Roster/Inventory panels. Visual polish stays within the
existing CSS-only "space terminal" theme; the graphical paperdoll is still Phase I.

### 5.3 Story canon — Dungeon 3: "Site Erebus" (shipped 2026-07-23)

**Why this arc exists:** the loose framing in §9 has been a Tiangong-vs-Talos corporate cold war
with the crew caught in the middle, personal stakes anchored by Dez. This dungeon is the first
crack in that frame — proof the cold war isn't the whole picture, without abandoning it. It stays a
**single-dungeon detour**, not a new region: one chapter that widens the world, then hands the story
back to the Tiangong/Talos throughline with a bigger question hanging over it.

**Canon story beats:**
- **The shootdown isn't personal.** Leaving Town after the Warden's fall, the crew's ship (still
  running on scavenged, barely-holding parts) strays into an old automated minefield ringing a system
  that isn't on any nav chart. It fires because that's what it's always done, not because Tiangong is
  hunting them — nobody up top even knows they're out here. This keeps the beat unsettling rather
  than escalatory: they didn't provoke this, they stumbled into it.
- **What the blockade was hiding: Site Erebus**, a Tiangong xenobiology annex, gone dark. Wreckage
  and terminal logs the crew pulls on the way down (and through the dungeon) establish that Tiangong
  did **not create** the bugs — the hive is native to this rock, older than the corp's charter. The
  annex existed to study, harvest, and ultimately try to **control** it. The comm logs go quiet
  partway through and nobody ever came back to shut the blockade off. Tiangong reached for something
  bigger than themselves and lost their grip on it — that's the reveal, not "the corp built a
  monster."
- **Naming convention:** continues the Greek/underworld vein set by Kharon's Reach (Charon, ferryman
  of the dead). The planet carries no name in any nav database, only the blockade's quarantine
  marker: **Site Erebus** (Erebus, primordial god of darkness — fitting for "the place Tiangong
  buried and never spoke of again").
- **The dungeon crawl escalates through hive castes**, each fight built on established affinity
  design (§3.2) rather than a new damage type:

  | Caste | Tier | Type | Notes |
  |---|---|---|---|
  | Roach | Fodder | Kinetic/Corrosive | swarms, cheap — teaches the room like the prologue's fodder did |
  | Warrior | Standard | Corrosive | the hive's basic bruiser line |
  | Shaman (hive-mind caste) | Standard/Elite | **Psionic** | hive-mind casters — a deliberate callback to Talos's Psionic weakness profile (§5.1), foreshadowing why a Psionic-leaning class matters before the crew ever reaches Talos territory |
  | Armored Warrior | Elite | Corrosive + high flat armor, resist Kinetic | the "counter-pick" fight, same design language as the Tiangong Security Mech |
  | **The Broodmarshal** (leadership caste, boss) | Boss | Psionic command aura + Corrosive strikes | wears a fused, half-grown-over Tiangong control rig — the annex's last attempt to leash the hive's command caste, which didn't take |
- **Boss mechanic (locked to your original spec):** at 50% HP, the Broodmarshal calls the hive and
  spawns additional mobs mid-fight. The arena includes a one-time interactable — a dead annex
  console — that can jam the summons once at the cost of a turn: a mechanical payoff for the
  "you're standing inside Tiangong's ruin" setting, not just flavor text.
- **The payoff is a fragment, not a dump.** Looting the Broodmarshal's control rig and the annex's
  remains gets the crew real evidence Tiangong's ambitions go past security bots and mechs, plus one
  unanswered question they can't resolve yet (something about the hive, or the rig, or what Tiangong
  was actually trying to build) — deliberately incomplete, so it colors how the crew reads Tiangong
  *and eventually Talos* from here on, rather than resolving into a tidy "gotcha."
- **No new companion recruited here** (unlike dungeons 1 and 2) — a deliberate scope call to keep
  this a clean one-dungeon detour rather than a third region-style chapter. A Psionic-leaning
  recruit (a Mentalist) would pay off the Shaman-caste foreshadowing nicely, but that's left open for
  a later story beat rather than forced into this one.
- **Getting off-world:** the crew escapes via salvaged parts or the annex's own mothballed transport,
  which is what hands the story back to Town and the Tiangong/Talos throughline — not a new hub, not
  a new region, just the road continuing with heavier cargo.

**Dungeon shape (locked at build time):** 9 nodes, same size and branch topology as Sector 1 —
`e1`(combat, Roach swarm) → `e2`(combat, Warrior pack) → branch: `e3`(combat, Warrior+Shaman —
"safe") vs. `e4`(elite, Armored Warrior — "risky") → `e5`(rest)/`e6`(loot) → reconverge at
`e7`(combat, mixed final approach) → `e8`(rest) → `boss`. No recruit node (§5.3's scope call, above).
Hand-scripted per node (`rollErebusEncounter`), not drawn from `ENEMY_POOLS`/`depthLevel` — same
"unique fight, tuned directly" treatment as the prologue, since a one-dungeon detour doesn't need
randomized composition. Every combat/elite/boss node carries its own `enterText`, which is where the
environmental storytelling (the annex's ruins, the Tiangong ID plates on the hive-torn door) actually
lives — no separate "story" node type was needed.

**New generic engine capability: mid-battle boss reinforcements.** Before this dungeon, nothing in
the engine could add enemies to a fight in progress. Implemented as data on the ENEMIES template
(`reinforceAt`: fraction of maxHp, `reinforceWave`: enemies to spawn), checked generically in
`applyToTarget` after damage resolves (not hardcoded to the Broodmarshal) — any future boss can reuse
the same hook by just adding those two fields. Reinforcements join the LIVE `enemies` array immediately
but don't act until the next round (initiative only rebuilds at `startRound()`), which reads as "the
hive answers a call," not an ambush inside an ambush.

**The console-jam interactable** (the arena's dead annex console, spec'd as "costs a turn, jams the
summons once") turned out not to need any new UI or state: it reuses the SAME `reinforced` flag the
HP-threshold check reads. A hero action sets `boss.reinforced = true` directly — jamming early marks
the boss as already-reinforced, so the natural 50%-HP trigger simply never fires. The button (only
rendered while a `broodmarshal` is present and un-reinforced) disappears the moment either path fires.

**Mob roster, as built:** Erebus Roach (fodder, Corrosive) / Erebus Warrior (standard, Corrosive +
Sunder) / Erebus Shaman (standard, Psionic + Confuse — organic-only, so Wren the synthetic Netrunner
is immune, a deliberate synergy with the roster on hand) / Erebus Armored Warrior (elite, resists
Kinetic like the Security Mech) / the Broodmarshal (boss, Corrosive melee + a Psionic command aura,
hard-resists Psionic itself, weak Thermal — deliberately NOT Kinetic-resistant, the same lesson the
Warden's tuning taught: heroes go EN-starved late in a long fight and fall back to Kinetic, so a boss
that resists it turns the back half into an unwinnable slog, §9).

**Sim-verified (headless, naive-attack-only policy, 150 trials per level):** at party level 4 (where
the fixed story trio realistically sits after Sector 1) — 94% boss-clear rate, ~53% average party HP
remaining on a full clear, safe branch 100% / risky branch 87%. That lands right in this project's
established "real tension without walling the player" target band (~50–65% HP remaining, §9) on the
first pass, so no further stat retuning was done. At level 5 the dungeon is a comfortable 100% clear,
which is the expected shape (a party that overlevels the content should feel it). The reinforcement
and relay-jam mechanics were exercised directly in the sim (spawn fires in ~half of un-jammed boss
fights; jamming reliably suppresses it) — mechanically sound, not just theoretically wired. A separate
full end-to-end regression (title → prologue → Sector 1 → Erebus → Town handoff, via the real control-
flow functions, not shortcuts) confirmed the changes to `renderEndbar`/`DUNGEONS.sector1.nextDungeonKey`
didn't regress the two existing dungeons.

### 5.4 Map system upgrade — fog, Unknown nodes, loot variance, bigger branchier graphs
(planned 2026-07-24, applies to **Dungeons 4–6 only**; not built yet — this is the locked spec to
build against, the outcome of a dedicated planning session, not implementation)

**Motivation:** the 3 shipped dungeons all share one shape (a small 7–9 node graph, a binary
safe/risky branch that always reconverges before the boss) and **zero mystery** — the map already
reveals every unlocked node's exact type (⚔/✦/◈/✚/⊕/☠) before you click it, and there are no true
dead ends (`unlockedNodeIds` unlocks are OR'd across all of a cleared node's `connectsTo`, so no
branch is ever truly lost). Fine for a tight opening act; not enough to make the back half of the
game feel escalating. **Explicit non-goal: no procedural map generator.** That's a much bigger,
harder-to-balance engineering bet and cuts against the project's "small, explained, data-driven"
discipline (§1). Everything below stays hand-authored `connectsTo` data, same as today — just more
of it, plus a few new *reusable* node-level mechanics.

**Scope decision (locked):** these systems are **additive, Dungeons 4–6 only** — Kharon's Reach,
Sector 1, and Erebus stay exactly as shipped/sim-verified, no retrofit, no re-tuning of finished
content. This also means the systems below double as shared substrate for the future **endless
portal (roadmap Phase P3)** — building them once against Dungeon 4 avoids building them twice.

**New systemic mechanics (build once, reuse across Dungeons 4–6 and later endless mode):**
1. **Fog of war — "local reveal" (locked):** a node's true type is only shown once it's **≤1 hop**
   from the current unlocked frontier; anything further shows a generic `?` icon. You always know
   your *immediate* choice, but the far side of a branchy map stays a mystery until you commit toward
   it. Pure `renderMap` icon-logic change (compute hop-distance from `visitedNodeIds`/
   `unlockedNodeIds`) — no new persisted state.
2. **A true "Unknown" node type:** one new `type: "unknown"` whose outcome is rolled **at resolve
   time** from a small weighted table — loot, a bonus fight (extra XP), an ambush/trap (costs HP, no
   reward), or a narrative-only vignette. One new node type + one data table (`resolveUnknownNode`),
   reusable forever. This is the actual "surprise" lever, separate from and complementary to the fog
   rule above (fog hides *known* types at a distance; Unknown nodes hide their outcome even once
   you're standing on them).
3. **Dead-end / loot spurs:** a node with `connectsTo: []` hanging off a junction — zero new engine
   mechanics needed (already works: visiting a junction unlocks ALL its `connectsTo` targets, so
   grabbing a spur doesn't forfeit the main path). Needs a small CSS/label treatment so a spur reads
   as "optional detour" rather than "did I softlock" — a distinct connector style + maybe a "Dead End"
   sub-label under the node type.
4. **Loot variance:** `ITEMS` gains a `rarity`/weight field; `grantLoot` becomes a weighted draw
   instead of flat-uniform. Elite nodes and the risky arm of an Unknown-node roll get access to a
   heavier/rarer table — pushing into danger has a visibly bigger jackpot, not just "an item."
5. **Broaden Sector 1's randomization pattern:** only Sector 1 currently draws combat from
   `ENEMY_POOLS` + `depthLevel`; the prologue and Erebus are 100% hand-scripted (deliberate, for their
   short/unique-fight framing — see §5.2a/§5.3). Dungeons 4–6, being full-size regions, should default
   to pools+`depthLevel` so replays don't refight an identical fight order.

**Bigger, branchier hand-authored graphs (content, not engine):** `computeMapLayout` already lays
out any graph shape/size for free (positions purely by `depth` + count-per-depth-column), so growing
node count is a pure authoring cost, not an engineering one. Rough sizing (tune per dungeon, not a
hard rule): **Dungeon 4 ~12–14 nodes** (up from 9), with a genuine **3-way branch** (not just binary
safe/risky) — critically, branches should be **pool-differentiated**, not just risk-differentiated
(e.g. one arm leans Corrosive-heavy, another Psionic-heavy), so gear/skill choices from the build-depth
work (roadmap Phase P2 — branching trees + Armor/Shields families gear) get tested against a real
prediction, not just "the tanky path vs. the loot path." **Dungeon 6 (finale) biggest, ~16–18 nodes** —
it's meant to read as the culmination.

**Per-dungeon differentiation (beyond reskinning — content anchored in the locked §9.4 canon):**
- **Dungeon 4 (Talos bio-site, moon/Europa lab):** different *shape of threat*, not just new damage
  flavor — bio-tanks with **Regen** (a reserved status, §3.3, never shipped; its natural home), heavy
  Corrode/Sunder splicers that punish gear neglect, and the new Psionic recruit's kit as the designed
  answer. Pool-differentiated branches (above) tie directly into this.
- **Dungeon 5 (the Sun, "Helios" — location locked, §5.4b):** **shape TBD — deliberately deferred**
  until Dungeon 4 ships and we have a data point on reception; options range from "same
  reconverging-diamond shape, alien flavor only" to "break the shape entirely" (e.g. a rest-less
  back-to-back gauntlet, reflecting that it's not a physical facility but something *testing* you).
  **Locked:** Dungeon 5 **previews a reserved damage type (Void/Entropy, §3.2)** narrowly and
  thematically — precursor "unmaking" tech fits it — both because it's a strong thematic fit and
  because it sim-tests the type before endless mode (Phase P3) leans on it harder. This is also where
  the endless-mode wormhole gets cracked open (§5.4b) — sealed as a story object until post-D6.
- **Dungeon 6 (dead Earth, "the Cradle," finale):** the convergence dungeon — **mixed Vossmark +
  Talos pools in the same encounters** (free enemy variety, zero new art needed, since both rosters
  already exist), the biggest node count, and the already-locked player-choice ending (§9.5) as the
  capstone.

**Difficulty interaction (ties to the Phase 1 difficulty work, §12):** bigger maps directly compound
the existing no-heal-between-nodes attrition tension (§4.2) — more fights before a Rest node means
more cumulative bite, which is a good, intentional lever. **Risk flagged:** Rest-node density must
stay roughly proportional to fight count or a 14–18 node dungeon could accidentally overtune past
"story fair." Re-sim (naive + smart autoplay, per the Phase 1 methodology) once each dungeon is built,
same discipline as every prior slice.

**Still open (not blocking Dungeon 4, revisit as they come up):** exact Unknown-node outcome table +
weights; exact loot rarity tiers/weights; whether Dungeon 6's mixed-faction pools need any new AI
handling for "two enemy factions on the same side" (likely not — `opponentsOf`/`alliesOf` are already
relative, not faction-aware).

### 5.4a Dungeon 4 visual & mob identity (locked 2026-07-24, spec only — not built)

**The gap that drove this:** Talos already has three enemy types stubbed since Phase D
(`talosWraith`/`talosPhantom`/`talosVanguard`, full kits + affinities) but **unpooled**. All three
reuse existing human-silhouette shapes (`stealthHumanoid`, `humanoidOfficer`) recolored red/cyan —
fine as trained operatives, but on their own they'd make Dungeon 4 read as "Sector 1 with a new
palette," not the **"transcendence through flesh"** faction identity locked in §9.2. Shipping only
those three would fail the "make it stand out" bar. Fix: split the roster into two wings, one of
which is genuinely new geometry, not a reskin.

**Two wings (also doubles as the §5.4 pool-differentiated branch — structural, not decorative):**
- **"Security Wing" branch** — the existing 3 stubs, kits/affinities unchanged, just finally pooled:
  Wraith (fodder, fast infiltrator) → Phantom (standard, stealth) → Vanguard (elite, 2.0× weak
  Psionic). Kinetic-resist, agile. Plays like a sharper Sector 1 in a new faction's colors —
  intentional, this is the "familiar" branch.
- **"Specimen Wing" branch** — new, bespoke, this is where the faction's actual identity lives.
  Built around **Regen** (§5.4's already-locked debut status) so it's a race-the-clock branch,
  Corrosive/Thermal-leaning per Talos's established profile:
  - **Splice Husk** (fodder, swarm) — a failed early test subject, barely held together. The tragic
    note: these were people. Sets up the Psionic recruit (a freed test subject, §9.4) emotionally
    before the story explains it.
  - **Bio-Tank** (standard) — a restrained containment specimen that breaks loose; carries **Regen**,
    so the branch's core tension is burst-it-down-or-it-outheals-you.
  - **Chimera Specimen** (elite) — **fully bespoke shape** (locked 2026-07-24, not a hive-shape
    reuse), conceptually hive-*inspired* per the §9.2/§9.3 canon (Talos secretly experimenting on
    hive-derived precursor biology — "the hive and Talos are the same story"), but its own silhouette.
    The Erebus connection is carried by **flavor text**, not instant sprite recognition.
- **Boss** — the "half-transcended bio-executive" already named in §9.4. Fully bespoke, no reuse:
  human officer-silhouette torso fusing into organic growth below the waist — the thesis of the whole
  faction in one sprite.
- **Third branch arm:** per §5.4's "genuine 3-way branch," the third arm is a dead-end loot spur, not
  a full combat path — keeps authoring bounded (2 real combat wings + 1 optional detour, not 3 full
  rosters).

**Tone (locked): "unsettling, not graphic."** Wrongness communicated through shape/asymmetry and
color — sickly growth, unnatural fusion, restraints, distorted silhouettes — not visceral/gore detail.
Readable at the game's small pixel scale, and deliberately doesn't tone-shift away from the rest of
the game's fairly restrained pixel-art violence.

**Backdrop (locked): clinical/sterile corrupted by organic growth.** A new `region: "biofoundry"`
(or similar key), same CSS-gradient technique as the 3 shipped regions (no images) applied to both
the map graph and the battlefield per the existing pattern. Deliberately **contrasts** rather than
echoes the hive region: hive is organic/earthy/cave-dark throughout; Talos should read as ordered,
lit, clinical white/cyan lab space with growth visibly breaching containment and a reddish undertone
low in the frame — the cage-vs-merge theme rendered as a room. A moon/Europa bio-foundry lab per §9.4.

**How this feeds the difficulty work:** the two wings are a real squad-composition test, not just
flavor — Security Wing rewards burst/Psionic pressure (Vanguard's 2.0× weakness), Specimen Wing
punishes low sustained damage (Regen races you). A squad built for one arm feels it on the other —
the Phase 2 "builds matter" work (branching trees, families gear) showing up in content, not just in
mechanics.

**Not yet done:** no sprites drawn, no backdrop CSS written, no `ENEMIES`/`SKILLS` entries for the 3
new Specimen-Wing types or the boss, Talos stubs not yet pooled. Per the sprite workflow
([[gridfall-sprite-workflow]]) — prototype one sprite at a time in scratchpad, present ASCII previews,
ask before porting into `data.js`.

### 5.4b Dungeon 5 location & the endless-portal identity (locked 2026-07-24, spec only — not built)

**Location locked: the Sun.** Dungeon 5's previously-deferred "outer system, shape TBD" placeholder is
now a precursor structure built at/orbiting Sol itself — working name **Helios** (continues the
Greek/underworld naming vein: Kharon, Erebus; tunable). Resolves two open questions at once:
- **Visual identity:** blinding light, radiation, heat-shimmer, ancient architecture silhouetted
  against a stellar backdrop — contrasts D4's clinical biofoundry and Erebus's organic cave-dark, the
  same "make it stand out" bar §5.4a set for D4.
- **Narrative "why":** if dead Earth (the Cradle, D6) holds the precursor seed-or-scour engine (the
  Loom), Helios is its **regulator/power-tap** — the two sites become one split precursor system, not
  two unrelated dungeons. Deepens §9.3's "caretakers who lost control" theme instead of just adding
  scenery.

**The endless-mode portal is the wormhole cracked open here.** The Void/Entropy preview already
locked for D5 (§5.4) is now specifically the beat where the crew's expedition tears a hole in normal
space at Helios — "unmaking" tech rupturing spacetime is a literal match for the damage type's
flavor. The rupture stays **sealed/unstable through the rest of Act III** (a Chekhov's gun, not
playable content — doesn't shortcut to D6, doesn't change D5/D6 pacing). After **D6's ending** (any
of the three §9.5 choices), it destabilizes for real and becomes the **permanent post-game
endless-mode destination**, reachable from Town/ship — giving the already-locked "alien temporal
space" endless portal (§12) a concrete in-fiction origin instead of a bare mechanic. Also answers "why
infinite scaling mobs in one place" for free: it isn't a place, it's a fracture.

**Still open:** D5's map *shape* (reconverging diamond vs. a rest-less gauntlet, per §5.4's original
deferral) is unaffected by this lock, still decided when D5 is authored. Exact portal-rupture fight
composition, and whether it's D5's boss or a separate node, also deferred to authoring time, per the
doc's usual "not designed in the abstract" discipline.

**2026-07-24, BUILD SESSION — Dungeon 5 "Helios Station" bones SHIPPED.** The shape question above
resolved to something new rather than either original option: a genuine **circle**, boss dead center —
the user's own idea, not the diamond/gauntlet fork this section originally posed. Built end to end:

- **Radial map layout (new, reusable systemic mechanic):** `ui.js` `computeMapLayoutRadial` — depth 1
  sits on the outer rim, the deepest depth sits at the exact center; same `{pos, height, width}` return
  shape as the existing depth-row `computeMapLayout`, so fog-of-war/edge-drawing/rendering didn't need
  to change, only positioning math. Opt-in via `dungeon.mapShape: "radial"` — every other dungeon is
  byte-for-byte unaffected. The map container itself is a true circle (`border-radius: 50%` on a
  `.map-radial` class), not just a rounded rect.
- **The double boss (new engine capability):** two `type: "boss"` nodes chained (`bossSoul` ->
  `bossSun`, no rest node between them — the attrition IS the fight). Required two generalizations:
  (1) `rollEncounterForNode` now checks `node.bossEncounter || dungeon.bossEncounter`, since one
  dungeon-wide boss composition can't cover two different bosses; (2) `renderEndbar`'s `isBossClear`
  now also requires `connectsTo.length === 0` — a boss-type node that connects onward to another boss
  node is a normal `resolveNodeVictory()` unlock, not the dungeon's terminal clear. Both changes are
  no-ops for every existing boss node (all already have empty `connectsTo`).
- **Void roster (narrow preview, per §5.4's original scope):** Poltergeist (fodder) -> Shade/Terror
  (standard) -> Void Horror/Demon/Devil (elite) -> **Void Soul Eater** (gatekeeper boss) -> **the Sun
  God** (true final boss, secretly Helios's own regulator core corrupted — a machine under a god's
  face, not a literal deity, closing the loop back to the Netrunner as its designated Cyber counter).
  Family is uniformly weak Thermal / resist Kinetic+Psionic — the first faction where Psionic ISN'T the
  free answer, and the Mech Runner (Thermal) gets a rare turn as the general specialist. Only 3 skills
  across the whole roster actually deal `damageType: "void"` (Void Horror's special + both bosses'
  signature specials) — a deliberate "precious, not flooded" preview of the reserved type.
- **`nextDungeonKey` landmine, caught before it could bite (not after, this time):** wiring
  `dungeon4.nextDungeonKey = "dungeon5"` would have silently reproduced the exact bug the Erebus
  epilogue fix documented (a `showXEpilogue()` with no real handoff leaving `currentDungeonKey` stuck)
  — Dungeon 4's boss clear had never had its own epilogue function since its `nextDungeonKey` was null
  until now. Added `showDungeon4Epilogue` (Proteus's fall -> 2nd key fragment -> star-map points at the
  sun, not the outer system) and `showDungeon5Epilogue` (guards `nextDungeonKey` being null, since
  Dungeon 6 doesn't exist yet — stays on "dungeon5" rather than nulling `currentDungeonKey`).
- **`region: "helios"` backdrop** (map + battlefield CSS): a corona blowing outward from the center,
  deliberately the inverse read of every prior region (all of which read as ambient/directionless).
- **Verified (headless, jsc + a from-scratch DOM/localStorage stub, this session's scratchpad —
  rebuild if lost, same "rebuild each time" pattern as the Phase-1 sim harness):** graph structurally
  sound (all 10 nodes reachable, exactly one terminal boss, every pool/skill/status reference
  resolves), radial layout produces finite coordinates with the Sun God exactly at dead center, and a
  full naive-policy combat run through every node including the chained double-boss (Soul Eater ->
  straight into the Sun God, no heal) completes without a single exception.
- **First balance read (naive floor only, NOT yet the smart-autoplay pass every other boss got before
  locking):** trash nodes tested too easy (an isolated-level-testing artifact, same lesson as Dungeon
  4's postmortem — real levels will be lower when the party is actually fresh off Dungeon 4). Void Soul
  Eater solo: naive win, 39% party HP left. Sun God solo (fresh party): naive win, 45% HP left. The real
  double-boss chain (Soul Eater then straight into the Sun God, no rest): party enters the Sun God
  fight at 50% HP and is **wiped** under pure naive play. This matches how every other boss in the
  project reads under the naive floor before its smart-autoplay pass (naive is the pessimistic floor,
  not the real target) — flagged, not alarming, but **do not consider Dungeon 5 balance-locked** until
  that pass runs, per this project's established discipline.
- **Not done:** no sprites for any of the 8 new Void/boss enemies (generic dark-violet blob fallback,
  new `GENERIC_PALETTES.void` entry added so they're at least visually distinct from organic/synthetic
  — ask-before-drawing per [[gridfall-sprite-workflow]]); the smart-autoplay balance pass above; the
  wormhole-crack beat is still narrative-only (no engine hook — that's Phase P3, endless portal).

**2026-07-25, follow-up — radial layout rebuilt (real playtest feedback) + Sun God strengthened.**
Two fixes from actual play, not sim-found:
- **The circle wasn't a circle.** Root cause: the first `computeMapLayoutRadial` mapped every DEPTH to
  its own radius, spreading nodes around a full ring only when several shared one depth — but this
  graph's critical path is mostly one node per depth, and a lone node always landed at the same fixed
  angle (top), so `h1 -> converge -> restFinal -> bossSoul -> bossSun` were all colinear: a straight
  spoke dead through the center, not a circle. Rebuilt as two phases: a RIM phase (depths 1 through
  `maxDepth - radialDiveDepths`) holds radius constant at the outer edge while angle sweeps ~300°
  across depth, so walking the critical path reads as walking around the ring; a DIVE phase (the last
  `dungeon.radialDiveDepths`, default 2 — the double boss) freezes the angle where the rim ended and
  collapses radius straight to 0, i.e. exactly "do a circle, then aim the line into the center for the
  last two bosses." `radialDiveDepths` is a per-dungeon field (defaults to 2), not hardcoded, so a
  future radial dungeon can pick a different split. Re-verified headless: the 10-node layout now traces
  top → right → bottom → left before diving in, all coordinates spread (not colinear).
- **The Sun God strengthened + a new reinforceWave**, per direct request: hp 135→155, atk 20→21, def
  13→14, and a new add — **Sol's Acolytes** (`ENEMIES.solAcolyte`, a genuine "reskinned Void" — its
  own tier:"standard" entry, not a reused trash key, so it reads distinctly in the log), 2 of them at
  50% HP, chanting self-Overclock and chipping in Psionic damage. **Balance signal (naive floor):** the
  Sun God now LOSES to a naive-play FRESH party solo (was a naive win at 45% HP pre-buff) — the buff
  landed hard. This makes the smart-autoplay tuning pass (already flagged as outstanding above) more
  urgent, not less — flagging explicitly rather than assuming "a bit stronger" landed where intended.

**2026-07-25, same-day — Act I / Sector 1 naming pass (display-name-only, mechanically inert).**
User-driven rename batch across the first two dungeons + the Region-1 faction, decided after a
multi-round brainstorm (several AskUserQuestion rounds — the corp name in particular went through
three passes before landing). Locked:
- **Colony Guard → Quota Enforcer** — ties directly to the haul-quota terminal already in Dez's death
  scene, more earned than a generic reskin.
- **Overseer Krell → Overseer Voraxx.**
- **Tiangong Pvt. → Grunt**, **Tiangong Lt. → Officer** (both display-name only, `tiangongPvt`/
  `tiangongLt` ENEMIES keys unchanged — internal identifiers, never player-facing).
- **The Warden's role subtitle → "Penal Colony AI"** (was "Station Security AI"; typeName stays "The
  Warden"). Deliberately reuses the `.tile-sub` subtitle line built for exactly this — the ORIGINAL
  Warden name, "Warden, Prison AI," got clipped by the 100px `.tile-name` ellipsis before that line
  existed (§12's 2026-07-24 Warden-title-bug entry); this can't regress the same way since name and
  role render as two separate lines now.
- **Corp: Tiangong Heavy Industries → Vossmark Industries** (§9.2 carries the full note + rationale).
  Landed on the "merger-name" technique (à la Weyland-**Yutani**) after two earlier rounds (a
  wordplay-coinage batch: Blackrig/Gantry/Ironhand/Draeger; then a classic-megacorp-surname batch:
  Strathmore/Kessler/Vantrell/Ferrous) didn't land — **Vossmark** ties directly into existing canon:
  Foreman Voss, the mid-level enforcer the hero kills in the prologue's opening scene, shares his name
  with the corp itself. Implied reading: the founding family's name outlived the family's power, or
  it's simply common enough on Kharon's Reach that everyone on the floor carries a piece of it.
- **Full pass executed** across `data.js`/`engine.js`/`ui.js` (typeNames, role subtitles, the Sector 1
  dungeon title `"VOSSMARK STATION SECTOR 1"`, every narrative string mentioning the old names —
  prologue intro/recruit/epilogue text, the Erebus shootdown/epilogue beats, the Sun God epilogue,
  sprite-shape comments) — verified via the same headless jsc parse-check + full smoke test used for
  the Dungeon 5 build, zero regressions. Two intentional exceptions left as historical record in
  `data.js` comments (`// Grunt (was "Tiangong Pvt.", 2026-07-25)...`) rather than being erased — same
  "don't rewrite history" discipline this doc already follows for "Squad Leader" → Tiangong Lt.
- **Scope note:** this doc's own historical, dated build-log prose (§5.2a/§5.2c/§5.3/§5.4/§5.4a and
  the §12 entries below this one) still says "Tiangong" and "Krell" in places — left as-is on purpose,
  matching how this document has never retroactively rewritten past session logs when something was
  renamed later. §9.1/§9.2/§9.4/the Factions list (the *living* canon, not a dated log) were updated to
  Vossmark; anything still branded Tiangong below this point is describing what was true *at the time*.

---

## 6. Screens & state management (the "glue")

Introduce a lightweight **scene manager**: exactly one active scene, transitions via `goToScene()`.
Persistent run state (party, inventory, level, map position) lives outside scenes.

**Scenes:** Title → Squad Select → **Map** → Combat → Reward/Loot → (back to Map) …
with **Party/Inventory** and **Loadout** reachable from the Map, and Region-Clear / Game-Over states.

Current `showSelect()/showBattle()` is the seed of this; Phase E formalizes it into a real manager.

---

## 7. Inventory, equipment & customization

- **Shared consumable bag** (decided): Stims, EN Cells, throwables, revive kits — items as data with IDs.
- **Per-character loadout:** which skills/abilities a hero brings (unlocked via level-ups & skill rooms).
- **Equipment (later layer):** weapons/armor/implants that grant stats *and affinities* (e.g., an
  "Insulated Plating" mod adds Shock resistance) — directly feeding the resist/weakness combat.
- **Armor & Shields (planned future model):** equipment can grant two defense layers —
  **Armor** (soaks Physical-family damage) and **Shields** (soaks Energy-family damage, and can be
  broken down first, exposing the target). This is how the "families" combat model (§3.2) enters the
  game — through what a character equips — so players build resistance profiles by gearing, not just
  by class choice.
- **Customization screen:** assign skills and gear per character; this is where §3 depth becomes
  player-facing strategy.

### 7.1 Equipment system ✅ (designed + shipped 2026-07-22)
Six classic RPG paperdoll slots, as requested: **Head, Body, Legs, Arms, Weapon, Ring**.

| Slot | Role |
|------|------|
| Head / Body / Legs / Weapon | Plain stat bonuses (HP/EN/ATK/DEF/SPD), universal items |
| **Arms** | **Grants a class-specific ability WHILE EQUIPPED** — swap items, swap your special (distinct from the SP skill tree's permanent unlocks) |
| **Ring** | A class-flavored unique, stat-only, one pool per class |

**Key decisions:**
- **Arms abilities are swappable, not permanent** — equip a different Arms item and you get a
  different skill; unequip and it's gone from your menu. This keeps two clean, distinct progression
  axes: the **SP skill tree = who you are** (permanent), **equipment = what you're carrying right
  now** (swappable loadout). Shipped abilities: Merc *Wrist Rocket*, Dread Knight *Power Fist*,
  Mech Runner *Shoulder Rocket* (AoE), Netrunner *Terminal Probe*, Mentalist *Psi Conduit* — each a
  strong signature-type single-target burst (Shoulder Rocket is the AoE exception, matching its name).
- **Ring (and Arms) are class-restricted** — a separate item pool per class, matching the original
  "depending on class" framing and deepening class identity.
- **v1 scope: stats + Arms ability grants only.** Affinity-granting gear (the Armor/Shields families
  model above) and weapon-swaps-damage-type are explicitly **deferred** — same discipline as every
  prior slice, keep the authored set legible.
- **No rarity/procgen** — a short hand-authored list per slot (18 items total), same philosophy as
  our skills/enemies: grows by editing data, not by building a loot-generation system.
- **Forward-compat for the future paperdoll:** every item carries an unused `spriteKey` field now, so
  the Phase I graphics pass doesn't need to retrofit every item to add sprites.

**The screen:** a Character Sheet panel (not yet the full Scene-Manager screen) with per-hero **tabs**
and three sections — **Stats / Skills / Equipment** — built the same way as the earlier Skills panel
(data-driven text/button rows, no graphics yet), reachable via a "Character" button on the win endbar.
Equipment rows only list items the hero is actually eligible for (class-restriction filtering happens
in the render). Verified in-browser with real clicks: class filtering per hero, stat math composing
correctly with level growth, and independent per-hero equipment state across tabs.

**Ownership correction (locked 2026-07-22):** equipment was originally freely equippable with no
acquisition gate — wrong for a roguelike run ("no reason to start with gear"). Fixed: a **party-wide
ownership pool** (`partyOwnedItems`) gates what's equippable; starts empty each run. Until the map's
loot nodes exist, a **simple interim mechanic** — a chance of a random item drop after each victory —
gives equipment something to do now. A found item is **shared party-wide and transferable** (only one
hero can wear a given item at a time; equipping it elsewhere first un-equips the previous wearer).

**Still open / later:** ~~the shared **party inventory** screen~~ ✅ shipped Phase H4/H5 (§5.2c/§5.2e)
— a dedicated, actionable view of the owned-but-unequipped pool. Still open: a true graphical
**paperdoll** (Phase I); real loot nodes replacing the interim random-drop mechanic once the map
exists (§5) — Sector 1's `n5` Loot node has existed since Phase G, but the interim per-win
`rollLootDrop()` chance-roll was never actually retired alongside it and still runs too.

---

## 8. Graphics & presentation (8/16-bit pass)

Goal: move beyond text without needing to "look amazing," and keep it cohesive with the retro vibe.

- **Approach:** a `<canvas>`-based combat scene drawing small **pixel sprites** per combatant
  (1–2 frame idle + a hit flash), styled HP/EN bars, a simple parallax/backdrop per region.
- **Assets, build-free:** embed sprites as base64 data-URIs or draw them from compact pixel arrays
  in code — no external files, still one hostable bundle. Start with placeholder sprites and swap in
  nicer art without touching logic (sprite is just data on the template).
- **Consistency:** pixel art + node map + terminal UI = one coherent look (another reason to skip the
  photo-hexgrid).
- **Can arrive incrementally:** a first "coat of paint" on combat can land as soon as the scene
  manager exists, even before every system is finished — good for motivation.

### 8.1 Combat UI layout (FF1-style target)
The classic Final Fantasy battle layout, which scales as we add party members:
- **Battlefield (top):** **enemies LEFT, heroes RIGHT** (FF orientation). Sprites later; panels for now.
- **Message log (thin band):** readable, turn separators, existing color-coding (super/resist/important).
- **Bottom band:** a **command menu** (`Attack · Skill ▸ · Item ▸ · Limit · Run`) for the active hero +
  a **party status window** with one row per hero: **Name · Class · Lv**, and **HP / EN / Limit (✦)** bars
  + status pips. Adding characters = adding rows — the reason this layout scales.
- **Responsive:** left/right on wide screens; **stack** (enemies top / heroes bottom, ~today's layout)
  on narrow/phone.

**Phasing (important):** three things the bottom band shows don't exist yet — **Level** (Phase E),
**Limit ✦** (D½), **sprites** (Phase I) — so building the full restructure now means building it twice.
- **Light QoL pass ✅ (done 2026-07-22):** hero call-sign names (pool: Matteo/Vito/Nat/Tupac/Jaime/Nero,
  pick order, player-editable later) + **Class · Lv** label, **enemies-left/heroes-right (responsive)**,
  bigger zebra-striped log.
- **Fit-to-screen pass ✅ (done 2026-07-22):** rendering in-browser revealed the action menu + log were
  **below the fold** (page ~1000–1260px tall vs ~620px viewport — you had to scroll to reach controls).
  Fixed: `#game` is now a viewport-height flex column; battlefield takes the top and scrolls internally;
  menu + log are pinned/always visible; panels compacted. **Verified by DOM measurement** (controls now
  on-screen, `pageScrollNeeded:false`). Screenshots via the extension time out; true phone (<560px) still
  unverified. Going forward: render + measure in-browser for every UI change.
- **Full "Combat UI overhaul" slice (later):** the complete FF bottom-band (party status window + command
  menu + log) with sprites — scheduled **after D½ (Limit) + Phase E (levels)**, built with the Scene
  manager (F) and Graphics (I) so it's done once with all its data present.

---

## 9. Story & goal — the canonical arc (locked 2026-07-23)

*Was "loose framing, later." Now the source-of-truth story bible. Everything below retro-fits the
already-shipped content (Kharon's Reach, Tiangong Station, Site Erebus) with no retcons — it makes
explicit the threads those dungeons already planted. Nothing here needs new engine work: the whole
remaining arc is content authored as data (new `DUNGEONS` entries, `ENEMIES`, story-scene beats),
reusing the map/backdrop/sprite/combat systems shipped in Phase I.*

### 9.0 The one-sentence spine
In a dying **Sol system**, two megacorps fight a resource war that is secretly a race to control an
**ancient precursor engine buried inside dead Earth** — one corp trying to *cage* alien power with
machines, the other to *merge* with it through flesh — and a crew of escaped debt-serfs becomes the
only force that doesn't want to own it.

### 9.1 Premise, scope & tone (locked)
- **Scope: one solar system (Sol), not a galaxy** (locked 2026-07-23). Tighter, stronger, and fits
  all existing content; no FTL. Everything — the mining colony, the orbital station, the bug-planet
  hive, dead Earth — sits inside a used-up Sol.
- **Dystopia:** Earth is *already dead* when the game opens — strip-mined and scorched generations
  ago, abandoned and off-limits. Humanity lives in the off-world sprawl (stations, asteroid colonies,
  moon bases) under two megacorps who inherited the wreckage. Resources are scarce; the cold war is
  turning hot. **Debt-bondage** (Kharon's Reach) is how the corps own the labor — this is established,
  not new.
- **The crew** are the dispossessed — escaped debt-serfs, defectors, the people both corps grind up.
  They are the story's *third force*: the only faction not trying to own the prize.

### 9.2 The thematic axis: CAGE vs. MERGE
*Renamed 2026-07-25: **Tiangong Heavy Industries** is now **Vossmark Industries** — locked, applies
everywhere below and in every shipped dungeon/enemy. The old name is preserved only in dated
historical build-log entries earlier in this doc (matching how this doc already treats every prior
naming change, e.g. "Squad Leader" → Tiangong Lt.); nothing below still uses it as current canon.*

Both corps are two wrong answers to the same theft — this snaps the existing faction design into place:
- **Vossmark Industries** — **dominion through machines. Cage the
  alien, own the labor.** Industrial, synthetic, Kinetic/Shock/Cyber; security bots, mechs, the
  Warden AI, the Broodmarshal's *fused control rig that never worked* (§5.3 — already canon). Debt-
  bondage, black sites, authoritarian-industrial. Region-1 faction; the crew's first oppressor
  (Dez, Kharon's Reach).
- **Talos Systems** — **transcendence through flesh. Merge with the alien, evolve past humanity.**
  Named (ironically) for the bronze automaton *animated by living ichor* — a fusion of machine and
  life. Organic, bio-augmented, Corrosive/Thermal, uniformly weak Psionic (§5.1 — already canon).
  Predatory-biotech. Has been secretly **experimenting on hive-derived precursor biology** — which is
  exactly why §5.1/§5.3 gave the Erebus Shaman/Broodmarshal a Psionic profile "echoing Talos ahead of
  ever reaching Talos territory." The hive and Talos are the same story.

The crew rejects both. Neither corp is "the good one."

### 9.3 The precursors & the engine
- Long before humans left Earth, an **ancient precursor intelligence** seeded Sol with dormant
  structures and a Psionic lattice. The **Erebus hive is its last living caretaker-organism** — this
  is why §5.3 made it "native and older than the corp." The *"incomplete data fragment"* Erebus drops
  (already in the game) is a **partial precursor key/star-map** — the Act II hook is already shipped.
- The prize is a precursor **"seed-or-scour" engine**: it can *reseed* a dead world into life or
  *scour* a living one to ash. It is **keyed to / buried in Earth** — the one place the corps wrote
  off as worthless. Deliberate ambiguity to preserve: the precursors may have *scoured Earth with it
  once* (which is why the tech is there and why Earth is dead), and humanity merely never let it heal.
- Dead Earth's codename: **"the Cradle"** (humanity's abandoned birthplace). The engine's working
  name: **"the Loom"** (it weaves/reseeds life) — or "Chthon" for its site. (Names tunable; they
  continue the established Greek/underworld naming vein: Kharon, Erebus.)

### 9.4 Act structure & the locked roadmap (3 built + 3 to author = 6 dungeons)
**Length locked 2026-07-23: 3 more dungeons, a clean 3-act shape.** Antagonist names, exact recruit
identities, and per-node composition are authored per-dungeon (same discipline as every prior
dungeon), not pre-designed in the abstract.

- **ACT I — Escape & revenge (SHIPPED).** Personal, boots-on-the-neck. **Kharon's Reach** (§5.2a) →
  **Vossmark Station Sector 1** (§5.2c). Establishes Vossmark, the crew, the debt-war. Cast: hero +
  Kade (Mech Runner) + Wren (Netrunner).
- **ACT II — The wider truth (Erebus SHIPPED + 1 to author).**
  - **Site Erebus** (§5.3, shipped) — widens the world past the corp feud; drops the precursor
    fragment.
  - **Dungeon 4 — a Talos bio-site** (TO AUTHOR). Finally reach the rival corp; the war goes hot from
    the crew's side. Reveal the *merge* horror — Talos splicing hive/precursor biology into people.
    **Recruit the Psionic ally** the Erebus notes teased (§5.3 flagged "a Psionic-leaning Mentalist
    recruit would pay off the Shaman caste") — a freed test-subject / defector, the crew's window into
    the alien truth. Payoff: the **2nd key fragment.** Setting sketch: a moon bio-foundry (e.g. a
    Jovian/Europa lab). Faction focus: Talos (the Mentalist's designated counter-faction, §5.1).
- **ACT III — The Cradle (2 to author).**
  - **Dungeon 5 — the Sun** ("Helios," TO AUTHOR, location locked §5.4b). The assembled key points to
    a precursor structure built into Sol itself — the engine's regulator/power-tap, not a separate,
    unrelated site. The full truth lands: a seed-or-scour engine on Earth (the Loom), keyed by Helios;
    the precursors were *caretakers who lost control* — a mirror for the corps. Also where the crew
    cracks the endless-mode wormhole open (§5.4b), sealed until after D6. Both corps may race the
    crew here.
  - **Dungeon 6 — Dead Earth, "the Cradle"** (FINALE, TO AUTHOR). Both corps converge on the
    abandoned homeworld where the engine actually is. Final confrontation + the ending choice (§9.5).
    The game ends **on burnt-out dead Earth.**

**Named human antagonists to author (the war needs faces):** a **Vossmark director** (architect of the
debt system and the black sites) and a **Talos figure** (a half-transcended bio-executive — a
body-horror antagonist). The finale can run three-way (both corp heads + the crew), or force the corps
into a brief truce against the crew. Specifics deferred to when Dungeons 4/6 are authored.

**Faster fallback (not chosen, kept on record):** a 2-more-dungeon cut (Talos → Earth, folding the
precursor reveal into the Talos site) would reach a finished game one dungeon sooner if scope needs
to tighten mid-build.

### 9.5 The ending — player choice (locked 2026-07-23)
A lightweight branching capstone on dead Earth (not a content explosion — one choice, short divergent
epilogues via the existing `showStoryScene` component). Three options:
- **Reseed** — the dispossessed use the engine to begin bringing the dead homeworld back. Earned,
  bittersweet hope; the corps threw Earth away, the crew reclaims it.
- **Destroy / deny** — wreck the engine so neither corp can own the future. Bleak but clean: the win
  is only that no one gets to cage or merge humanity.
- **Deny both, walk away** — leave it buried and sealed; the crew chooses not to be the next hand
  that reaches for it. The most thematically pointed refusal.

*(Exact wording, and whether all three or a curated two ship, is finalized when Dungeon 6 is
authored.)*

### 9.6 Continuity — what this locks vs. what's already shipped
This bible **contradicts nothing shipped.** It makes explicit: (a) the Erebus fragment = precursor
key; (b) the hive = precursor caretaker; (c) Talos's Psionic-adjacent bio-tech = hive/precursor
experimentation; (d) both corps' existing tech identities = the cage/merge axis; (e) the regions arc
lands on dead Earth. The old §5 "regions arc (draft): R1 → R2 raider moon → R3 Space Squid depths" is
**superseded** by this concrete Sol roadmap (the raider-moon / Voidborn-Space-Squid ideas remain
available as an optional Dungeon-4.5 detour only if scope later expands to 7 dungeons — not planned).

### Factions (established 2026-07-22, expanded 2026-07-23 — see §9.2 for the cage/merge axis)
Two competing megacorps frame the setting — a corporate cold war the crew is caught in:
- **Vossmark Industries** (renamed from Tiangong Heavy Industries, 2026-07-25 — §9.2) — the
  **Region 1** faction. Industrial maker of security bots and mechs; the current enemy roster is
  Vossmark. Grimy, hardware-heavy. *Cage the alien, own the labor* (§9.2).
- **Talos Systems** — the **rival**, reached in Act II (Dungeon 4). Named for the mythic bronze
  automaton; sleeker, more predatory, *different* tech and affinity profiles so squads must re-adapt.
  *Merge with the alien, transcend humanity* (§9.2).

This rivalry is the spine for the story and for why regions escalate.

---

## 10. Architecture & tech notes

- **Content-as-data everywhere.** Skills, effects, affinities, enemies, items, nodes, regions =
  data tables read by a small engine. This is what keeps iteration fast and cheap.
- **File structure as it grows:** a single `game.html` is fine now. When sprites + multiple screens
  bloat it, split into a few **classic** `<script>` files (e.g., `data.js`, `engine.js`, `ui.js`,
  `main.js`) loaded by `index.html`. *Avoid ES-module `import` over `file://`* (browsers block it);
  classic script tags keep double-click-to-run working. Still no build step, still static-hostable.
- **Keep the sim harness** as a dev tool for balance regression as content expands.
- **Save/load** (localStorage) is a natural add once runs span multiple regions — currently out of scope.

---

## 11. Roadmap (phased, each slice playable & reviewed)

Combat depth first (it's the core), then progression, then the map/glue, then customization,
then graphics, then story. Graphics can slot in partially earlier as a coat of paint.

| Phase | Deliverable |
|-------|-------------|
| ~~**B. Damage types + affinities**~~ ✅ DONE | resist/weakness multipliers + super-effective/resisted/no-effect feedback; enemy affinity profiles (Mech resists Kinetic, weak Shock/Cyber, immune Psionic). Swing = Standard (weak ×1.5 / resist ×0.5 / immune ×0); weaknesses learned via combat log; basic Attack = Kinetic for all |
| ~~**C. Status-effect engine**~~ ✅ DONE | `tickEffects` filled: Burn (DoT), Weaken (−ATK), Sunder (−DEF), Guard (buff), Disable (skip turn), Confuse (organic-only). Mostly-universal + a few nature-locked; refresh + keep-strongest; effective-stat model; pips on panels. Demo skills across classes + Squad Leader Mark Target. Balance held (~50/95/17) |
| **D. Kits + specials + mobs + tiering** ✅ | Slice 1 ✅ specials rebalance + full kits (`pierce`, Netrunner **Hack** = Mech-killer). Slice 2 ✅ 6-enemy roster in 3 tiers, Tiangong-branded. Difficulty picker **cut** — difficulty is emergent (see below), tiers kept as encounter/zone authoring metadata. See §3.4a / §3.5. |
| **D½. Limit Break** ✅ | per-hero momentum gauge (persists across the run) + a Limit Break per class (§4.3) |
| **E. Progression & run resources** | Slice 1 ✅ **leveling foundation**. Slice 2 ✅ **Skill Points + skill trees** (§4.1). Slice 3 ✅ **Equipment + Character Sheet screen** (§7.1) — 6 slots, class-restricted Arms/Ring, swappable Arms abilities, per-hero tabbed panel. Follow-ons ⬜: **party inventory screen** · **no-heal HP/EN run persistence** (§4.2) · **command-menu** UI (§4.4) |
| ~~**F. Scene/state manager**~~ ✅ DONE | minimal screen router: Select/Map/Battle via `goToScene` |
| ~~**G. First mini-dungeon map**~~ ✅ DONE | branching node tree (§5.1): 9 hand-authored nodes, hex-marker-styled (art deferred to I) node buttons, randomized per-node mob composition (replaces global `encounterLevel`), intra-squad level variance, escalating difficulty → boss finale ("The Warden"), **Talos Systems** shipped as a 2nd faction, no-heal-between-fights persistence |
| **H. Title, roster & town** *(redefined 2026-07-23, §5.2 — all slices shipped)* | H1 title scene + real `localStorage` save/load ✅ · H2 roster/active-party split (solo start, Merc, **player-named** — §5.2 update) ✅ · H3 prologue ("Kharon's Reach" — §5.2a) ✅ · H4 Town scene ("the Long Shot" — §5.2c: Roster/Equipment, Party Inventory, explicit Save, general dungeon-return hub; Sector 1 reframed as dungeon 2 with a new Netrunner recruit) ✅ · H5 inventory & loadout screens proper (§5.2e: Party Inventory made actionable, Character Sheet Stats grown into a real overview, item effects shown inline) ✅ |
| ~~**L. Dungeon 3 — "Site Erebus"**~~ ✅ DONE *(§5.3)* | bug-planet crash dungeon: Roach/Warrior/Shaman/Armored Warrior tiers → boss "the Broodmarshal" (add-spawn at 50% HP, a new generic reinforcement engine hook + a relay-jam counter), a Tiangong black-site reveal that widens the story past the corp cold war, one-dungeon detour (no new region, no recruit), sim-verified |
| **I. Graphics pass** | ✅ combat sprites (all 5 heroes + all 17 enemies, idle bob + hit flash, tier-scaled), ✅ hex-node map + per-region backdrops, ✅ combat backdrops (mining/station/hive). Also this phase: the single `game.html` was split into 5 classic `<script>` files (data/state/ui/engine/main). **Sprite-quality pass (2026-07-24) in progress, paused:** ✅ 3/5 heroes redrawn to 24×32 w/ human faces (Merc, Kade-mech, Wren-female); ✅ Spider Drone, guards (`guardTrooper`, w/ tier-recolor accent zones), Overseer Krell redrawn. Remaining: ⬜ **Dread Knight + Mentalist** 24×32 redraws, ⬜ guard tier-recolor variants (Riot/Heavy), ⬜ UI/menu theming polish |
| **J. Story arc → finished game** *(canon locked 2026-07-23, §9; map-system spec locked 2026-07-24, §5.4)* | The 3-act Sol arc to a finite ending. Act I shipped (Kharon's Reach → Tiangong Station); Act II = Erebus (shipped) + **Dungeon 4 ✅ SHIPPED 2026-07-24** (Talos bio-foundry, §5.4a — 14 nodes, two pool-differentiated wings, Six the Psionic Mentalist recruit, boss Proteus, sim-verified end-to-end) — debuted the §5.4 map upgrade (fog of war, Unknown nodes, loot variance, dead-end spurs) as reusable systemic mechanics, not one-off content; Act III = **Dungeon 5 "Helios Station" ✅ BONES SHIPPED 2026-07-24** (§5.4b — a new radial/circular map shape, the double boss, a narrow Void/Entropy preview roster, structurally sim-verified but NOT yet balance-tuned) + **Dungeon 6 (dead Earth "the Cradle," finale — mixed Tiangong+Talos pools, biggest map, player-choice ending)**, still TO AUTHOR. Sprite art for Dungeon 4's AND Dungeon 5's new rosters still outstanding (generic-blob fallback). See §9.4 for story beats, §5.4/§5.4a/§5.4b for the map-system + Dungeon 4/5 specs |
| ~~**K. Town/hub layer**~~ *(retired 2026-07-23 — absorbed into Phase H, §5.2)* | superseded: towns/roster/save could not wait for a "future" phase once story-mode start was decided |

*(B and C are close cousins and may be built together; I is flexible and can start once F lands.)*

---

## 12. Decisions

**Locked (2026-07-24, post-beta difficulty & direction pass — new gameplay-direction plan):**
- **Structure = HYBRID:** keep the authored 6-dungeon story + saves as the campaign AND add an
  **endless portal endgame** (high-score, scaling/varied mobs, precursor "temporal space" theming;
  reuses `DUNGEONS`/`ENEMY_POOLS`/`depthLevel`). Not either/or. **In-fiction identity locked
  2026-07-24 (§5.4b):** the portal is the wormhole cracked open at Dungeon 5 (Helios, the Sun), sealed
  through Act III, reopening after the D6 ending as the permanent post-game destination.
- **Difficulty split = story fair, endless brutal.** Campaign stays beatable; real attrition/death-cost
  lives in the endless portal.
- **Build-depth levers chosen:** branching skill trees (add the never-built passive/opportunity-cost
  nodes) + Affinity/Armor-Shields "families" gear (turn on the deferred §7 model), and generally
  stronger/varied enemies.
- **Phase 1a — smart enemy targeting (SHIPPED).** `chooseEnemyAction` no longer picks a random foe:
  `pickEnemyTarget` weights targets by a threat score (finish the wounded, secure kills, prioritise
  squishies + the medic, exploit affinity weakness, avoid resistances). "Sharpness" scales with tier
  (fodder loose, elites/bosses focus hard) — the difficulty dial §3.5 asked for. Also: specials now
  prefer an AoE when 2+ heroes are alive. This alone dropped the Warden from ~50%→~36% party HP.
- **Phase 1c — global difficulty knobs (SHIPPED, sim-tuned).** `ENEMY_HP_MULT` (1.5) and
  `ENEMY_DAMAGE_MULT` (1.2) in `state.js` scale non-boss enemy durability/damage in one place, so
  combat can be hardened without re-authoring every `ENEMIES` entry. **Set-piece bosses (tier "boss")
  are exempt** — they're individually tuned, and 1a already sharpened them. These knobs are also the
  endless-mode difficulty lever. Sim results (naive attack-only, the pessimistic floor): standard
  node 84%→**66%** HP, elite node 72%→**52%**, solo tutorial 87%→**75%** (deliberately still gentle),
  bosses unchanged. A no-tank glass comp now **loses 100%** of an elite node it used to clear — squad
  composition went from cosmetic to decisive.
- **Phase 1b — enemies use statuses/buffs (SHIPPED).** `chooseEnemyAction` now also fires `kind:"status"`
  skills: self-buffs (Guard when hurt <55% HP, Overclock when healthy) and pure debuffs (landing a
  *fresh* status on a smart target). The status engine is finally two-sided. New reusable enemy skills:
  `braceUp` (self-Guard), `overdrive` (self-Overclock), `stunBaton` (Kinetic+Disable), `sentryShot`,
  `nanoRepair`.
- **Phase 1d — boss support adds (SHIPPED, sim-tuned naive+smart).** All 3 bosses now fight with
  hardware/minions, tuned so **smart play** (use affinities, kill the healer) lands ~50-70% HP / ~100%
  win, while **naive mashing** is punished — the intended "skills matter" pressure. Uses the existing
  `reinforceAt`/`reinforceWave` hook + a new data-driven `reinforceMessage`. **New enemy types**
  (reused sprite shapes, recolored — placeholder art): `securityTurret` (slow glass-cannon emplacement),
  `repairDrone` (killable heal source — a targetable weak point), `riotEnforcer` (braces + stuns; the
  planned guardTrooper recolor). Compositions: **Warden** opens + turret + spider drone, calls arc
  sentinel + repair drone at 50% (Warden `corePurge` softened 22→16 for the longer fight); **Krell**
  fights beside a Riot Enforcer (no wave — keeps the L1 duo opener forgiving, naive ~77% win);
  **Broodmarshal** wave trimmed to 2 roaches (the 1c knobs had made the old wave far deadlier).
- **Fixes (2026-07-24):** Arc Sentinel is now **EMP/Shock-neutral** (was `RESIST` — an EMP hitting a
  drone shouldn't read "Resisted"; Cyber/Hack stays its `WEAK` counter — overrides the §3.5 table).
  **Warden title bug:** the enemy battlefield tile now renders a **role/subtitle line under the name for
  elite/boss units** (`.tile-sub`), and the Warden was renamed **"The Warden" / "Station Security AI"**
  (the old "Warden, Prison AI" clipped at the 100px `.tile-name` ellipsis so "AI" was cut off).
- **Sim methodology note:** bosses with strong counterplay (affinity weakness + killable healer) are
  now measured under BOTH a naive-attack floor and a **smart autoplay** (targets the healer/lowest-HP,
  uses the best-affinity affordable skill). Naive is the pessimistic floor; smart is the real target —
  the right yardstick once fights reward using your tools. Harness in the session scratchpad.
- **Root-cause note (why it was too easy):** enemy AI targeted randomly and never focus-fired; trash
  died too fast/hit too soft to matter; only bosses had bite. Equipment gave single-digit nudges and
  skill trees were 1–2 "unlock an active" nodes with no opportunity cost — both deferred-depth, next
  in the plan (P2). See the gameplay-direction memory + §3.5/§4.1/§7 for the scaffolding being turned on.

**Locked (2026-07-22):**
- **Map style:** Slay-the-Spire node map for navigation. Gets an 8-bit skin later (styled nodes,
  connective art, region backdrops — not bare lines); run logic stays separate from its rendering.
- **Combat type:** stays menu-JRPG. Tactical grid positioning is explicitly *not* planned.
- **Damage types:** ship the **core six** now; Radiation/Bio, Cryo, Void, Gravity held in reserve (§3.2).
- **Defense model:** flat affinity table now; **Armor/Shields families** added later via equipment (§7).
- **Graphics timing:** after core systems (Phase I); a partial coat-of-paint may start once the scene manager (Phase F) lands.

**Locked (2026-07-22, Phase B):**
- **Affinity swing:** ladder ×2.0 / ×1.5 / ×1.0 / ×0.5 / ×0.2 (`WEAK/RESIST/HARD_RESIST` constants).
  **No true immunity** (revised 2026-07-22) — the old ×0 became ×0.2 "hard-resist" so a chip always
  lands and no class is ever dead weight; status effects give resisted classes other ways to contribute.
- **Reveal model:** discover via combat feedback (log says Super effective! / Resisted. / No effect!).
  A Scan/Analyze action can be added later.
- **Basic Attack:** Kinetic for every class (a reliable fallback vs any enemy).

**Locked (2026-07-22, Phase C):**
- **First status set:** Burn, Weaken, Sunder, Guard, Disable, **Confuse** (Confuse chosen over Taunt).
- **Nature rule:** mostly universal; a few nature-locked (Confuse = organic-only; future Hack = synthetic-only).
  Uses a `nature: organic|synthetic` tag on every combatant.
- **Stacking:** one instance per type; re-apply = refresh duration + keep strongest magnitude.
- **Scope:** engine + demo skills now; full per-class/enemy kits are Phase D.
- **Taunt** deferred to the reserve list (tank aggro), to add with the Dread Knight's fuller kit.

**Locked (2026-07-22, Phase D shape):**
- **Focus:** kits + special rebalance + ~3 new mobs + difficulty tiering (all together — kits and mobs
  must be balanced against each other).
- **Kit template:** basic + signature-damage special + one utility; 4th advanced slot gated later (§3.4a).
- **Roster:** ~6 enemy types across fodder/standard/elite tiers (§3.5).
- **Feedback that drove this:** Security Mech unkillable at level 1 → fix via stronger specials +
  designated counters (Hack) + tiering + leveling, not by nerfing it into a pushover.

**Still open:**
- Final specifics of the 3 new mobs and each class's exact skill numbers (proposed next; tune via sim).
- Build slice order for Phase D (proposed: 1 kits/specials → 2 new mobs/tiers → 3 difficulty picker).

**Locked (2026-07-23, story mode pivot — §5.2, full detail there):**
- **Story-mode start:** new game begins with **one hero (the Merc)**, not a pick-3-of-5 squad;
  further heroes join via recruit events as the story progresses.
- **Roster vs. active party split:** `roster` (everyone recruited, persistent) is now distinct from
  the ≤3 heroes actively deployed to a dungeon; the squad-select screen becomes a squad-*builder*
  reading from `roster`.
- **Save is real, now:** the title screen's Start / Saved Game choice is backed by actual
  `localStorage` persistence, checkpointed on Town arrival and node clears — not a later placeholder.
- **Towns pulled forward:** the Town scene (roadmap Phase K) is no longer future/unscoped — it's
  needed immediately as the connective layer and the home for Roster/Inventory/Rest. Phase K retired,
  absorbed into Phase H.
- **Existing dungeon untouched:** rather than re-tune "Tiangong Station Sector 1" (sim-verified for a
  3-hero squad) for variable squad size, a **new short prologue** ramps the player to near-full squad
  strength before handing off to it. **Superseded 2026-07-23:** the prologue's actual setting became
  a Tiangong asteroid mining colony ("Kharon's Reach"), not a docking-ring area of Sector 1's own
  station — see §5.2a for why (a cleaner escape→arrival story beat) and the shipped story.
- **New-screen visual bar:** Title/Town/Roster/Inventory match today's CSS-only "space terminal"
  theme; no canvas/sprites before Phase I (avoid building these screens twice).

**Locked (2026-07-23, Phase H3 — full detail in §5.2a/§5.2b):**
- **Story canon:** setting = Kharon's Reach (Tiangong asteroid mining colony); cast = the
  player-named hero, younger brother **Dez** (killed by **Foreman Voss**, who the hero then kills —
  the game's opening action), recruit **Kade** (Mech Runner, joins mid-escape), finale boss
  **Overseer Krell** (colony chief, hangar checkpoint).
- **Dungeon shape:** 4 nodes, linear (an escape, not a branching crawl) — 2 solo fodder fights, 1
  non-combat recruit beat, 1 duo boss finale. Hand-scripted encounters, not drawn from the
  Sector-1-style pools/depth-scaling.
- **Multi-dungeon architecture:** `DUNGEON_MAP` became a `DUNGEONS` registry (`prologue`, `sector1`),
  keyed by new state `currentDungeonKey`; each entry carries `nextDungeonKey` for what a boss-clear
  advances to.
- **Reusable story-scene component:** one generic paragraphs+Continue screen, used for the intro,
  the recruit beat, and the epilogue — not a bespoke screen or a full dialogue engine per moment.
- **Fresh-attempt full heal (new, not prologue-only):** starting any dungeon attempt now fully heals
  HP/EN and clears effects. Required once Phase H2 made heroes persist by reference across
  dungeons — without it, a losing solo hero could redeploy already dead and instant-lose forever.
  Does not touch the existing no-heal-*within*-a-dungeon rule (§4.2).

**Locked (2026-07-23, shipped — full detail in §5.3):**
- **Dungeon 3 story canon:** "Site Erebus," a Tiangong xenobiology black site the crew crashes into
  after their ship strays into its automated blockade leaving Town. Tiangong did not create the
  hive — it's native and older than the corp — the annex existed to study/harvest/control it and
  went dark trying. Boss **the Broodmarshal** (leadership caste) wears a fused Tiangong control rig
  that never worked, and spawns hive reinforcements at 50% HP (per the user's original spec).
- **Theme call:** this arc **widens the world** rather than just escalating the Dez/Tiangong revenge
  thread — the payoff is a deliberately incomplete data fragment, not a clean win, so it raises a
  question that colors how the crew reads both Tiangong and Talos afterward.
- **Scope:** a **one-dungeon detour**, not a new region — no new companion recruited here (a
  Psionic-leaning Mentalist recruit would pay off the Shaman caste nicely but is left for later).
- **Mob roster:** Roach (fodder) → Warrior (standard, Corrosive) → Shaman (Psionic, hive-mind caste)
  → Armored Warrior (elite, resist Kinetic) → the Broodmarshal (boss). No new damage type — reuses
  the existing six (§3.2); Psionic on the Shaman/boss deliberately echoes Talos's affinity profile.
- **Naming convention:** continues Kharon's Reach's Greek/underworld naming vein (Erebus =
  primordial god of darkness).
- **Dungeon shape:** 9 nodes, same size/branch topology as Sector 1 (a branch that reconverges, a
  final combat push, a Rest stop, then the Boss) — hand-scripted per node, not pool-drawn.
- **New generic engine capability:** any ENEMIES template can now declare `reinforceAt`/
  `reinforceWave` to spawn a one-time reinforcement wave mid-battle (checked in `applyToTarget`, not
  hardcoded to the Broodmarshal) — reusable by a future boss, not a one-off hack.
- **Sim-verified, no second phase needed:** 94% boss-clear / ~53% avg HP remaining at party level 4
  (150 headless trials, naive-attack-only) — lands in the project's established "real tension" band
  on the first pass. The Broodmarshal's kit stays single-phase for v1, same call as the Warden.

**Locked (2026-07-22, long-term systems):**
- **Limit Break gauge: persists across the run** (a saved momentum resource); fills from damage dealt
  (main) / healing / kills+debuffs / damage-taken (lesser). Build **soon**, right after Phase D mobs/tiering (D½).
- **Skill learning: Skill-Point currency + per-class skill trees** (not simple auto-learn) — spend
  earned SP to unlock actives + passives; learned actives populate the combat Skill menu (Phase E).
- **Run persistence:** HP + EN(SP) + Limit + SP + skills + inventory carry between nodes; recover at
  Rest nodes / items (Phase E + map).
- **Difficulty note:** current "too hard" is the always-hard 6-stack test encounter, not the core
  mechanics — resolved by Phase D Slice 3's easy/medium tiers.

---

## 13. Changelog
- **2026-07-24** — **Map system rebuilt after playtest feedback: fog of war was cosmetic, not
  structural (a real leak) + a mid-dungeon recruit had no way to actually join the fight.** Two
  distinct fixes to §5.4:
  1. **True fog of war.** The original implementation only hid a not-yet-unlocked node's TYPE — but
     `computeMapLayout`/`renderMap` always laid out and drew edges for the ENTIRE graph regardless of
     visited/unlocked state, so the full shape (including which nodes had zero outgoing edges, i.e.
     dead ends) was visible from the very first click, no exploration required. Playtest verdict: "the
     current path is obviously a dead end before you even click on it." **Rebuilt:** on a foggy dungeon,
     a node isn't rendered AT ALL until unlocked (no hex, no placeholder), and a node's OUTGOING edges
     only draw once that node is **visited**, not merely unlocked/reachable — so d3s/d3p/d3x (the entry
     fork) are genuinely indistinguishable in structure until you commit to one and explore it. The
     "Dead End" tag now only appears post-visit (a confirmation, never a spoiler); the old predictive
     dashed `.spur` edge styling (which leaked the same info one step earlier) was removed outright.
     Verified with a real (non-stub) DOM-tracking test harness inspecting `renderMap()`'s actual output
     at each step of a playthrough — not just "did it crash." **Map widened** 300→440px for foggy
     dungeons (`MAP_GRAPH_W_FOGGY`) so a busier fogged reveal has room. Non-foggy dungeons (Kharon's
     Reach/Sector1/Erebus) are provably byte-for-byte unchanged — verified against the exact same DOM
     inspection harness (all nodes always shown, locked ones still 🔒 with type hidden, matching the
     pre-existing shipped behavior exactly).
  2. **Mid-dungeon squad swap.** Six (recruited partway through Dungeon 4) joined the `roster` but the
     active `party` was already full (cap 3), so Six sat unusable for the rest of that dungeon run —
     no squad-builder access mid-run (it would reset the attempt via `deploy()`→`startDungeon()`).
     Playtest ask: "we should have a method to swap her in." Added `showSquadSwapPrompt()`: right after
     a full-party recruit's story beat, offers an immediate in-place swap (pick who's benched, or skip
     and swap later at Town) — `party[idx] = companion`, no dungeon reset, the benched hero's HP/EN/
     level are untouched since `roster` still holds them by reference. A party with a free slot still
     auto-joins exactly as before (Kade's and Wren's existing recruits are unaffected — verified). Fully
     tested via a real DOM-tracking harness: full-party swap, skip, and not-full-auto-join all confirmed
     correct.
  Full combat-balance regression re-run after both fixes — all numbers unchanged (this was a rendering/
  UI-layer rebuild, not a combat-math change).
- **2026-07-24** — **Post-ship bugfix: Erebus → Dungeon 4 handoff was broken (found by real
  playtesting).** `showErebusEpilogue()` predated Dungeon 4 and was written when
  `erebus.nextDungeonKey` was `null` — it took no argument and always called `showTown()` directly,
  **never updating `currentDungeonKey`**. Harmless at the time (nothing existed past Erebus), but once
  Dungeon 4 shipped and `nextDungeonKey` became `"dungeon4"`, `currentDungeonKey` stayed stuck on
  `"erebus"` forever — so `deploy()` (which redeploys into whatever `currentDungeonKey` currently is,
  by design) sent the player straight back into Erebus after Town instead of into Dungeon 4. Fixed to
  match `showPrologueEpilogue`'s established pattern: takes `nextDungeonKey`, sets
  `currentDungeonKey = nextDungeonKey` before `showTown()`. **Verified via the real control-flow
  functions** (not a shortcut): drove an actual boss win → endbar → epilogue → Town → deploy sequence
  in the sim and confirmed it now lands in `dungeon4`; also re-verified the prologue→sector1 and
  sector1→erebus handoffs are unaffected. **Lesson for future dungeon handoffs (5→6 etc.):** any
  dungeon-specific epilogue function that doesn't take `nextDungeonKey` as a parameter is a latent bug
  the moment a sequel dungeon gets wired in — grep for `showXEpilogue()` calls with no argument before
  connecting a new `nextDungeonKey`.
- **2026-07-24** — **Dungeon 4 ("Talos Bio-Foundry") shipped — §5.4/§5.4a fully built, wired into the
  story chain (`erebus.nextDungeonKey = "dungeon4"`).** All 5 systemic map mechanics built: **fog of
  war** (`dungeon.foggy`, local-reveal via a `.fogged` node state — Dungeons 4+ only, Sector1/Erebus
  untouched), a real **Unknown node type** (`UNKNOWN_NODE_OUTCOMES` weighted table: loot/fight/trap/
  narrative, rolled at click time; "fight" hands off to the real battle flow), **dead-end loot spurs**
  (`connectsTo: []`, a dashed `.spur` edge + "Dead End" tag — zero new engine mechanics needed),
  **weighted loot rarity** (`ITEMS[k].rarity`, 4 new rare items, heavy odds for Elite wins + Unknown
  loot rolls), and **Regen** (the reserved HoT status, finally shipped, with a dead-guard so it can't
  revive a corpse in the same tick as a lethal Burn). Content: pooled the 3 dormant Talos stubs as the
  **Security Wing**; authored 3 bespoke **Specimen Wing** bio-horror enemies (Splice Husk, Bio-Tank
  w/ Regen, Chimera Specimen) + boss **Proteus** ("half-transcended bio-executive," Greek-shapeshifter
  name continuing the Kharon/Erebus vein); a clinical-white/organic-corruption **`biofoundry` backdrop**
  (CSS-gradient, same technique as the 3 shipped regions); a **14-node graph** (all reachable, 3 correct
  dead ends) — two pool-differentiated wings that only need ONE cleared to proceed (OR-unlock, same
  mechanic as Sector 1's branch), converging before a shared Rest + Proteus.
  **Sim-tuning found and fixed two real bugs**, not just numbers — kept here because they're reusable
  lessons: (1) `rollEncounterForNode`'s boss branch was Sector-1-hardcoded (`node.type==="boss"` always
  returned the Warden combo); generalized to read `dungeon.bossEncounter`/`dungeon.pools[node.poolBranch]`
  so Dungeons 4-6 can reuse it — Sector 1 re-verified unregressed after the refactor. (2) **A full
  end-to-end chain regression** (real control-flow functions, not isolated fights — same discipline as
  Erebus's original regression) caught what isolated-node testing missed: the Specimen Wing's original
  3-fights-then-rest arm shape (d1→d3→d4→d5) collapsed to 0-21% full clears even under smart, item-free
  play; restructured so the Unknown node is a genuinely optional spur off the combat node (2 guaranteed
  fights per arm before rest, matching Sector 1's proven density) — and separately, Proteus's hardcoded
  boss level (7) didn't match the level the party actually reaches through the graph (6), which alone
  had been masking a 90%-vs-40% win-rate gap between "isolated fresh test" and "real chained arrival."
  Both fixes + a Chimera Specimen softening pass landed the final numbers at **72%/58% full-clear**
  (Security/Specimen arm, smart play, N=300, no items used — a conservative floor, since real players
  have Stims/EN Cells the sim doesn't model) — harder than Sector1/Erebus's ~94-100% norm, which fits
  Act II's intended escalation, but should be revisited if it plays harder than intended in practice.
  **Known gap:** the 4 new enemies (Splice Husk/Bio-Tank/Chimera Specimen/Proteus) and the Riot
  Enforcer/Sentry Turret/Repair Drone from the earlier difficulty pass have **no bespoke sprites yet**
  — they render via the generic nature-colored blob fallback. Per the sprite workflow
  ([[gridfall-sprite-workflow]]), drawing real sprites is a separate, ask-first step, not done this
  session. Full diagnosis + numbers kept in the gameplay-direction memory.
- **2026-07-24** — **Sprite quality pass (Phase I art, partial) + first enemy-roster edits.** A focused
  art session, paused mid-stream to return to gameplay planning. **Heroes → 24×32 with human faces
  (3 of 5 done):** Merc (augmented soldier, rifle held across chest, arms visible), Mech Runner "Kade"
  (small human head atop a full **mech body** — glowing amber core, cannon arm, mech legs — no longer a
  Merc twin), Netrunner "Wren" (scaled up to a clearly **female** android — long hair, hourglass, cyan
  eyes). **Dread Knight + Mentalist remain on the old 18×28 shapes** and render smaller until redrawn —
  the two outstanding hero sprites. **Enemies:** Spider Drone redrawn from a blob into a real
  mechanical spider (chassis + red optic + 6 jointed legs); the two rank-and-file guards (Colony Guard,
  Tiangong Pvt.) rebuilt as a **deliberately non-hero** `guardTrooper` — angry scowling face, raised
  glowing **stun-baton**, boxy pauldroned armor + gorget — with **modular accent zones (H pauldron, V
  glow) designed for cheap tier recolors** (planned but unbuilt: Riot Enforcer, Heavy Trooper); Overseer
  Krell given a bespoke **fat-tyrant-with-a-whip** boss sprite. **Roster/canon edits:** the Warden
  renamed **"Warden, Prison AI"**; **Talos units removed from the Sector 1 enemy pool** (they stay
  *defined* but *unpooled* until a Talos-territory dungeon exists — Talos is a later-arc faction, §9.4).
  Roaches (Hull/Erebus) left as-is (deemed the best-looking mobs). All shape/palette/pool changes were
  headless-validated (dimension + ASCII-preview + palette-coverage checks). See the tech-reference §11
  changelog for the mechanics (new `SHAPE_SCALE_OVERRIDE`, the scratchpad sprite-prototyping workflow).
- **2026-07-23** — **Story canon locked: the full arc (§9 rewritten).** Scope set to **one Sol
  system** (not a galaxy); the corp cold war reframed as a **cage-vs-merge** race (Tiangong cages
  alien power with machines, Talos merges with it through flesh) over an **ancient precursor
  "seed-or-scour" engine buried in dead Earth ("the Cradle")**. Retro-fits all shipped content with no
  retcons (Erebus fragment = precursor key; hive = precursor caretaker; Talos's Psionic-adjacent
  bio-tech = hive experimentation). **Length locked at 6 dungeons** (3 shipped + 3 to author:
  Talos bio-site w/ Psionic recruit → precursor site → dead-Earth finale) with a **player-choice
  ending** (reseed / destroy / deny). Old §5 "regions arc draft" superseded. Immediate next authoring
  target: **Dungeon 4 (Talos bio-site).** All remaining content is data, no new engine.
- **2026-07-23** — **Phase I (graphics) mostly shipped + file split.** Combat sprites for all 5 heroes
  (redrawn to FF4/6-era quality — real faces/eyes, 3-tone shading, per-class silhouettes + weapons)
  and all 17 enemies (7 reusable archetype shapes, tier-scaled so elites/bosses tower); 2-frame idle
  bob + white hit-flash. Dungeon map rebuilt as a **hex-node graph with SVG point-to-point
  connectors** and **per-region backdrops** (mining/station/hive, all CSS); the same three themes
  re-skin the **combat battlefield** behind translucent combatant panels. `game.html`'s single
  ~4,400-line `<script>` split into five classic sibling files (`data`/`state`/`ui`/`engine`/`main`),
  build-free, double-click-to-run preserved. Only UI/menu theming polish remains in Phase I.
- **2026-07-23** — **Phase L shipped: Dungeon 3, "Site Erebus" (§5.3).** Same session, planned then
  built: the Sector 1 → Erebus story handoff (an old Tiangong blockade shoots the escaping ship down,
  not deliberate retaliation — guarding a xenobiology black site that studied/tried to control a hive
  **native to the planet**, not one Tiangong created), a 9-node hand-scripted dungeon mirroring
  Sector 1's shape, five new hive-caste enemies (Roach/Warrior/Shaman/Armored Warrior/the
  Broodmarshal), and a **new generic engine capability**: any enemy can now declare `reinforceAt`/
  `reinforceWave` to spawn a one-time reinforcement wave mid-battle, checked generically in
  `applyToTarget` rather than hardcoded to this boss. The arena's "jam the relay" interactable turned
  out to need no new state at all — it just sets the same `reinforced` flag the HP-threshold check
  reads, early. `showSector1Epilogue`/`showErebusEpilogue` added (extension recipe's showXEpilogue
  pattern, §10), dispatched by source dungeon in `renderEndbar` rather than only by whether
  `nextDungeonKey` is set, since Erebus's escape-to-Town beat needed telling even with nothing built
  past it yet. Sim-verified (150 headless trials/level, naive-attack-only): 94% boss-clear / ~53% avg
  HP remaining at level 4, landing in the established "real tension" band on the first pass — no
  further stat retuning needed. A full end-to-end regression (prologue → Sector 1 → Erebus via the
  real control-flow functions) confirmed no regression to the two existing dungeons. Roadmap Phase L
  is now done; next build reverts to "Phase I (graphics) or further story, not yet decided."
- **2026-07-23** — **Phase H5 shipped: inventory & loadout screens grown into the fuller flow**
  (§5.2e) — the last slice of the redefined Phase H roadmap. Party Inventory gained direct
  per-eligible-hero equip buttons and a "worn by X" jump link to that hero's Character Sheet, instead
  of being read-only. The Character Sheet's Stats section grew from one line into a real overview
  (class/race/nature/level, Limit Break gauge %, non-neutral affinities). Item effects (stat bonus or
  granted skill) now show inline everywhere an item's name appears, not just its name. No new
  screens — everything grew inside Town's existing Roster/Inventory panels, matching H4's visual
  bar. Verified headless (extended the running driver with equip-via-inventory and jump-to-sheet
  checks — the underlying logic, since the harness's crude `querySelectorAll` can't faithfully
  simulate onclick wiring across separate calls) and in-browser via claude-in-chrome with real
  clicks (equip button worked, panel re-rendered correctly, jump link opened the right hero's sheet
  with the new Stats section visible). Phase H (Title, roster & town) is now fully shipped,
  H1 through H5. Next: Phase I (graphics) or further story content, not yet decided.
- **2026-07-23** — **Tightening pass** (§5.2d), requested after playtesting: (1) rewrote every
  player-facing story string to remove em-dashes and other AI-sounding phrasing; combat log format
  left alone (pre-existing, mechanical, not prose). (2) Moved Wren's recruit node from before n1 to
  after it, so the breach corridor is fought solo/duo first; her dialogue rewritten to match. (3)
  Nudged difficulty up globally (`AI_SPECIAL_CHANCE` 0.35→0.38, `AI_HEAL_CHANCE` 0.4→0.43,
  `ENEMY_SCALE_PER_LEVEL` 0.08→0.1) — a first, bigger attempt was rolled back after sim testing
  showed it more than halved Sector 1's risky-branch clear rate; settled on a smaller bump after
  confirming the safe branch and Krell stayed comfortably winnable. (4) Sped up Limit Break gauge
  gain by roughly 5x (not the smaller bump originally tried) after a sim showed the original pacing
  — tuned for Sector 1's longer fights — meant the gauge never once crossed 100% across the entire
  3-fight prologue in 200 simulated playthroughs; now fires within the prologue in ~73% of
  playthroughs. All four changes verified via the existing headless drivers (unaffected) plus new
  and updated balance sims, and a real-browser check that the rewritten/repositioned Wren scene
  renders correctly. Full numbers and reasoning in §5.2d.
- **2026-07-23** — **Phase H4 shipped: Town ("the Long Shot") + Sector 1 reframed as "dungeon 2"**
  (§5.2c). Town is now the general dungeon-return hub (Retire/New-squad/Abandon/no-next-dungeon
  boss-clear all route there past the prologue), a save checkpoint with its own explicit Save
  button, and hosts a generalized Roster & Equipment screen (Character Sheet now works against the
  whole roster, not just the active party, and can return to Town instead of only the battle endbar)
  plus a new read-only Party Inventory screen (closing the "shared inventory screen" gap §7.1 had
  flagged as still-open). A limited, hand-picked ship-salvage grant (Kevlar Mesh, Tactical Sidearm)
  seeds the equipment pool on first arrival. Sector 1 becomes "dungeon 2" by reframing, not
  rebuilding — a new one-time "why we're attacking the station" briefing, then a new mandatory entry
  node recruiting a third companion, **Wren** (Netrunner), placed before Sector 1's existing branch
  point so every playthrough meets her regardless of path. Recruits now only join the active party if
  there's a free slot (respects the 3-hero cap — the prologue's forced-solo start made this a
  non-issue there, but Sector 1's pre-chosen squad could in principle already be full).
  **Real correctness fix, not just new content:** `findWornBy` was scanning only the active `party`,
  not the full `roster` — harmless before H4 (nothing let you equip a benched hero), but a real bug
  once Town's Roster screen does exactly that; fixed to scan `roster`. **Balance-preservation
  mechanic:** inserting the mandatory recruit node required shifting Sector 1's existing node depths
  by +1, which a sim comparison showed also quietly dropped the risky branch's clear rate from ~53%
  to ~32% (for the story's fixed, tank/healer-less trio) since `depthLevel` scales off the same
  `depth` field used for map rendering. Fixed with a new `levelDepth` override per node — enemy
  scaling reads the original pre-shift value, decoupling "where a node renders" from "how hard it
  hits," restoring the curve to ~48%/~78% — a reusable escape hatch for any future insertion into an
  already-tuned dungeon. Verified headless (extended the H3 full-playthrough driver through Town,
  Roster/Inventory panels, the briefing, and into Sector 1's new recruit node — 55 checks) and via a
  dedicated Sector-1-traversal sim (both branches, with and without the shift, to isolate the
  regression before fixing it) and in-browser via claude-in-chrome (Town, Inventory, and Character
  panels all confirmed rendering correctly with real CSS, no scroll issues). Next: Phase H5,
  inventory/loadout screens proper.
- **2026-07-23** — **Phase H3 shipped: the story-mode prologue, "Kharon's Reach"** (§5.2a/§5.2b).
  Built from the user's story concept (a serf's brother killed by a colony guard, kills him in the
  guard's distracted moment, escapes with a companion who joins right before the finale, reaches a
  small ship). Expanded into full canon: Tiangong mining colony Kharon's Reach, brother **Dez**,
  killer/killed **Foreman Voss**, recruit **Kade** (Mech Runner), finale boss **Overseer Krell**. A
  4-node linear dungeon (2 solo fodder fights → non-combat recruit beat → duo boss) — shorter than
  Sector 1 by design, entirely hand-scripted rather than pool/depth-derived. New architecture: a
  `DUNGEONS` registry (was a single map) since a story-mode game needs more than one dungeon; a
  reusable `showStoryScene` component for narrative beats (intro/recruit/epilogue); a `recruit` node
  type. **Real behavior change, not just prologue content:** every fresh dungeon attempt now fully
  heals HP/EN — required once H2 made heroes persist across dungeons (else a losing solo hero could
  redeploy already dead and soft-lock), and standard genre logic besides. Krell was tuned via two
  sim passes (first pass: 100% win in 3–6 actions, no real fight — a solo-boss-vs-duo structural
  problem; buffed to HP 140/ATK 20/DEF 10 + a 3rd AoE special, landing at 0 losses in 200 trials but
  59% average party HP remaining — real tension, still a story-hook boss that shouldn't wall new
  players). Verified headless (32-check full-playthrough driver + a dedicated wipe/retry driver +
  balance sims for all three prologue fights) and in-browser via claude-in-chrome with real button
  clicks properly paced against the game's actual `setTimeout` turn timing (not the headless
  harness's instant-resolve stub) — confirmed real rendering, real target-highlighting, a real
  combat round resolving with correct damage math. Next: Phase H4, the Town scene (the escape ship).
- **2026-07-23** — **Phase H2 shipped: player-named hero + roster/party split** (§5.2 build order,
  step 2; naming + "party management between dungeons" added to scope at the user's request). New
  persistent `roster` (everyone recruited) distinct from the active party; `party` members are the
  same objects as their `roster` entries, so level/xp/equipment/Limit now carry across dungeons, not
  just within one. Start always begins a genuinely fresh game and routes through a new naming screen
  — the player's typed call-sign becomes the hero's display name everywhere (squad-builder, combat,
  the future Character screen). The squad-builder (today's Select screen) now builds its cards from
  `roster` instead of a fixed 5-class list — this is the screen that becomes "party management
  between dungeons" as the roster grows past 1 in H3. `partyOwnedItems` stopped resetting per-dungeon
  (only on a fresh Start) since persistent hero equipment requires persistent ownership to stay
  consistent. Verified headless (22-check driver) and in-browser via a real page reload. Full detail
  in the tech reference doc. Next: H3, the prologue town + first recruit events.
- **2026-07-23** — **Phase H1 shipped: Title scene + real save/load** (§5.2 build order, step 1).
  Entry point is now `showTitle()` (Start / Saved Game) instead of dropping straight into Select.
  Save/load is real, not a placeholder: one `localStorage` blob, checkpointed whenever the player
  arrives on the Map (today's stand-in for "arriving in Town" until H4). Start still routes to the
  existing pick-up-to-3 Select screen — that changes in H2. Verified headless (21-check jsc+DOM-stub
  driver) and in a real browser via an actual page reload (claude-in-chrome + `python3 -m
  http.server`): deployed a solo Merc, reloaded the page for real, clicked Saved Game, confirmed the
  same hero (with its current HP) came back from real `localStorage`. Full detail in the tech
  reference doc. Next: H2, the roster/active-party split.
- **2026-07-23** — **Planning session: story-mode pivot (§5.2).** Decided to move off the free
  pick-3-of-5 start toward a real story mode: **one starting hero (the Merc)**, recruit companions
  over time, **towns** as the hub between dungeons (space stations/mining ships/asteroid base/
  planets as future flavor). New `roster` (persistent, everyone recruited) vs. **active party** (≤3
  deployed) split. Because a solo hero can't survive the existing 3-squad-tuned dungeon, decided to
  build a **new short prologue** (docking-ring town + solo/duo encounters + first recruits) ahead of
  "Tiangong Station Sector 1" rather than re-tune that dungeon's already-verified balance. Made
  **save/load real now** (`localStorage`, checkpointed) since a "Saved Game" button can't be a
  placeholder — this **retires roadmap Phase K**, folding towns into a redefined **Phase H** (Title →
  roster split → prologue → Town scene → inventory/loadout screens, 5 build slices, §5.2). New
  screens stay in the current CSS-only visual theme; full graphics pass is still Phase I, deliberately
  avoiding a build-it-twice screen. No code changed this entry — planning only, ready to build H1.
- **2026-07-22** — Document created. Recorded vision/pillars, current state, combat/affinity/status
  design, progression, map recommendation (StS), scene manager, inventory, graphics approach,
  architecture, and the phased roadmap.
- **2026-07-22** — Decisions locked: StS map (with future 8-bit skin), menu-style combat, core-six
  damage types with a reserve list (Radiation/Bio, Cryo, Void, Gravity), flat affinity model now +
  Armor/Shields-via-equipment later, graphics after core systems. Next step: Phase B.
- **2026-07-22** — **Phase B shipped** (damage types + affinities). Standard swing, discover-via-log,
  Kinetic basic attack. Enemies profiled; balance re-verified (~48/95/12). Next: Phase C status effects.
- **2026-07-22** — Immunity softened: true ×0 → ×0.2 hard-resist (no class ever dead weight).
- **2026-07-22** — **Phase C shipped** (status-effect engine): Burn/Weaken/Sunder/Guard/Disable/Confuse,
  nature-locks, refresh+strongest, pips; demo skills across the kit. Balance held (~50/95/17). Next: Phase D.
- **2026-07-22** — Playtest feedback: Security Mech too tanky. Reshaped Phase D → kits + special
  rebalance + ~6 tiered mobs + difficulty picker. Locked kit template (signature+utility, 4th gated)
  and enemy tiers (fodder/standard/elite). Documented the affinity-vs-defense tension + fixes (§3.4a).
- **2026-07-22** — Factions named: **Tiangong Heavy Industries** (Region 1) vs **Talos Systems** (rival,
  later). Bug fodder = **Hull Roach**. Squad Leader → **Tiangong Lt.**; Corp Medtech → **Tiangong Pvt.**
- **2026-07-22** — **Phase D Slice 1 shipped**: armor-pierce (`pierce`), Merc Aimed Shot, Netrunner Hack
  (Mech-killer), buffed Crushing Blow / Rail Shot; base kits finalized (systemShock & terror gated).
  Mech now killable; good squads ~87–100% vs the old 6-stack. Difficulty retuned in Slice 3. Next: Slice 2.
- **2026-07-22** — **Phase E Slice 1 (leveling foundation) shipped**: party XP/levels + per-class stat
  growth; enemy levels scale stats (×0.08/lvl) + XP reward; run loop (Next fight ramps enemy level; party
  persists, HP/EN refill for now). Tuned ramp (good 36–40 fights, weak ~10). Verified in-browser. Follow-ons:
  skill trees, no-heal persistence, command-menu UI; then scene manager → map/zones.
- **2026-07-22** — **Phase E Slice 2 (skill trees) shipped**: SP is a currency separate from automatic
  stat growth; tiered skills are distinct named skills with `prereq` chains (not ranks); 5 class trees
  (2 are 2-tier chains); minimal debug Skills panel between fights. Verified headless + in-browser
  (real clicks, prereq/cost enforcement, no double-XP, layout didn't regress). Next requested: a
  **Character Sheet** screen (stats/skills/equipment) + a **party inventory** screen (§7.1); equipment
  scoped to simple stat-only slots first, affinity-granting gear deferred.
- **2026-07-22** — **Equipment + Character Sheet shipped** (§7.1): 6 slots (Head/Body/Legs/Arms/
  Weapon/Ring), Arms+Ring class-restricted, Arms grants a swappable class ability (not permanent —
  distinct from the SP tree), 18 hand-authored items, `spriteKey` placeholder for the future paperdoll.
  Tabbed per-hero Character Sheet panel (Stats/Skills/Equipment). Verified headless (restriction
  enforcement, stat math, skill grant/revert, double-equip guard) AND in-browser via real clicks
  (class-filtered options per hero, correct stacking with level growth, independent per-hero state,
  no layout regression). Next: party inventory screen, or move on to the map/zones.
- **2026-07-22** — Planning session: reviewed full phase status; **decided to pivot toward the map**
  (a first mini-dungeon) after finishing Limit Break + the equipment-ownership correction, rather than
  continuing to deepen combat in isolation — "different mobs per node" and real loot both require it.
  Locked Limit Break's 5 class ultimates and the equipment ownership/interim-loot fix (§4.3, §7.1).
- **2026-07-22** — **D½ Limit Break shipped**: persistent gauge, 5 ultimates, pacing tuned via sim to
  ~once/2 fights (from an initial 2+/fight). **Equipment ownership fix shipped**: party-wide found/owned
  gate + transfer-between-heroes + interim loot-on-victory. Both verified headless + in-browser. Next:
  a minimal scene manager, then the first mini-dungeon map + title/init screen.
- **2026-07-22 (session end)** — Locked concrete build requirements for the first mini-dungeon (§5.1):
  multi-pronged branching tree, limited-info nodes (hex-shaped markers, to confirm), node types
  Combat/Elite/Loot/Rest/Boss, **randomized per-node mob composition + intra-squad level variance
  replacing the global `encounterLevel` mechanic**, escalating difficulty to a boss finale, and
  **Talos Systems introduced now** as a 2nd faction for mob variety (capped at 2 factions for now).
  No code changed this entry — documentation/planning only, ready for next session to build from.
- **2026-07-22** — Planning session (next-session kickoff): resolved the hex-node open question
  (hex-shaped **markers** on the existing branching path, not the parked hexgrid movement model).
  Map size locked at **~8 nodes**, single hand-authored dungeon. Designed and locked the **Talos
  Systems roster** (Wraith/Phantom/Vanguard — organic, Corrosive/Thermal, uniformly weak Psionic,
  making the Mentalist the Talos specialist the way the Netrunner is Tiangong's) and the dungeon
  **boss, "The Warden"** (corrupted Tiangong station AI core, single-phase for v1). Clarified the
  **genre**: JRPG with a persistent world, not a roguelike permadeath run — towns/hubs between
  dungeons are a real future layer (new roadmap Phase K) but explicitly out of scope now. Interim
  rule until towns/saving exist: a party wipe ends the attempt, back to squad select, no retry. No
  code changed this entry — ready to move into Phase F (scene manager) + Phase G (map) build.
- **2026-07-22** — **Difficulty picker cut** (Slice 3 dropped). Difficulty is emergent via party level +
  enemy types + enemy levels + zone depth (§4). Tiers kept as encounter/zone authoring metadata.
  Phase D considered complete. Next focus: progression (leveling + enemy levels) → scene mgr → map/zones.
- **2026-07-22** — **Phase D Slice 2 shipped**: 6-enemy roster in 3 tiers, Tiangong-branded. Added
  Hull Roach (bug fodder), Arc Sentinel (Shock/Disable — wakes the Netrunner's Shock weakness),
  Tiangong Pvt. (Weaken). AI uses each enemy's own basic attack. Medium default encounter set. Next: Slice 3.
- **2026-07-22** — Long-term systems planned (§4.1–4.4): **Skill-Point + skill-tree** learning,
  **HP/EN run persistence**, and a **persistent Limit Break** momentum gauge. Roadmap: added **D½ Limit
  Break** (soon, after mobs/tiering); reshaped **Phase E** into "Progression & run resources" (leveling +
  SP/trees + persistence + command-menu UI). Difficulty concern attributed to the test encounter, not mechanics.
- **2026-07-22 — Phase F + Phase G shipped: the first mini-dungeon is playable.** Resolved the
  session-start open items: hex node = marker style only (confirmed); map sized at **9 nodes**
  (grew from ~8 during balance testing, see below); designed and shipped the **Talos Systems**
  roster (Wraith/Phantom/Vanguard — organic, Corrosive/Thermal, uniformly weak Psionic, the
  Mentalist's rival faction the way the Netrunner is Tiangong's) and the boss **The Warden**
  (corrupted Tiangong station AI core). Clarified the **genre** mid-session: JRPG with a persistent
  world, not a roguelike permadeath run — recorded in §5.1; towns/hubs are real future scope
  (**new roadmap Phase K**) but out of this build. A party wipe currently just ends the attempt
  (back to squad select) until towns/saving exist.
  **Built in six verified slices** (scene manager → static map → real per-node encounters →
  Loot/Rest effects → removing the free heal between fights → balance pass), each checked headless
  (JavaScriptCore sim) and in-browser (claude-in-chrome DOM measurement), matching every prior
  phase's discipline.
  **Balance pass found two real problems via simulation, not guesswork:** (1) the path from the
  final Elite gate straight into the Boss left no room to recover — fixed by adding a Rest node
  (`n8`) right before the boss gate, a legible genre beat as well as a fix; (2) EN never regenerates
  mid-fight and every class's free fallback attack is Kinetic, so a Kinetic-resistant, self-healing
  boss turned EN-starved late fights into an unwinnable attrition spiral rather than a hard one —
  fixed by dropping the Warden's Kinetic resistance and self-heal and re-tuning its stats/level.
  Elite-node level jitter was also capped so it only ever eases a fight, never spikes it. Final
  numbers: a well-built (tank + healer + counter-class) squad clears the safer Combat+Rest branch
  reliably and the riskier Elite+Loot branch (which trades safety for a guaranteed item) with real
  tension (~50–65%) — the two branches' differing risk profile is intentional, not a flaw. Squad
  composition still measurably matters (a no-tank squad clears less often than the same squad with
  one added). **Known gap:** no EN-restoring item exists yet (only the HP-only Stim) — worth adding
  if EN-starvation attrition resurfaces as more content changes the numbers again.
  Full technical detail (schemas, functions, exact tuning values) is in the tech reference doc,
  which was updated alongside this entry — read that instead of re-deriving it from `game.html`.
