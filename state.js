"use strict";

    /* ================================================================
       B) STATE
       ================================================================ */

    // roster = every hero the player has recruited, ever (persists for the whole game —
    // only a brand-new Start resets it). party = the ids-selected-from-roster subset
    // actually deployed to the current dungeon; buildParty() looks them up BY REFERENCE
    // (not fresh copies), so combat progress (level/xp/equipment/limit) written onto a
    // party member during a fight is automatically also roster's copy (§5.2, Phase H2).
    let roster = [];
    let party = [];
    let enemies = [];
    let partyItems = {};
    let partyOwnedItems = {};   // itemKey -> count owned by the PARTY (shared, not per-hero)

    // Dungeon-map progress (Phase G, extended H3). Reset by startDungeon() each time you deploy.
    let currentDungeonKey = null;  // which DUNGEONS entry is active ("prologue" | "sector1")
    let currentNodeId = null;      // node you're currently resolving (null = on the map)
    let unlockedNodeIds = [];      // node ids the player can click into
    let visitedNodeIds = [];       // node ids already resolved (win/loot claimed/rested)
    let lastMapMessage = "";       // most recent Loot/Rest result, shown on the Map screen
    const REST_HEAL_FRACTION = 0.65;   // Rest nodes restore this fraction of max HP/EN
    // §4.1a: true right after resolving a Rest node, cleared on the next node
    // click (onNodeClick) — drives whether renderMap shows the "Reconfigure
    // Tactic Slots" button, since Rest is one of only two places (with Town)
    // that reconfiguring is allowed.
    let justRested = false;

    // Town (Phase H4). lastTownMessage mirrors lastMapMessage's role but for
    // Town (e.g. the one-time ship-salvage grant). sector1BriefingShown gates
    // the "why we're attacking" story beat to once — later Town visits skip
    // straight to the squad-builder instead of repeating it.
    let lastTownMessage = "";
    let sector1BriefingShown = false;
    let lastCheckpointScene = "map";   // "map" | "town" — which one loadGame() should resume onto
    const SHIP_STARTING_ITEMS = ["kevlarMesh", "tacticalSidearm"];   // limited, hand-picked salvage

    let initiative = [];
    let turnIndex = 0;
    let activeCombatant = null;
    let pendingAction = null;

    let battleOver = false;
    let nextIdCounter = 1;

    let selectedHeroIds = [];    // roster hero ids picked on the squad-builder screen
    let lastSquad = [];          // hero ids from the most recent deploy (pre-selects next time)

    // Enemy AI difficulty knobs (higher = deadlier). Tuned so the default
    // 6-enemy fight is hard-but-winnable and rewards a balanced squad.
    // Bumped ~20% (Phase H4 tightening pass, 2026-07-23) for a bit more
    // overall bite across every fight in the game — re-verified via sim
    // (§5.2b/§9) that this doesn't tip any existing fight into unfair.
    // Bumped again 2026-07-29 (full-playthrough report: too easy outside
    // early Elite nodes) — enemies now press a special/heal more often.
    let AI_SPECIAL_CHANCE = 0.45;   // chance to use a special attack vs. basic (was 0.38)
    let AI_HEAL_CHANCE = 0.5;       // when a healer sees a hurt ally, how often it heals (was 0.43)
    let AI_HEAL_THRESHOLD = 0.4;    // an ally counts as "hurt" below this fraction of max HP

    // Global difficulty knobs (Phase 1c, 2026-07-24; bumped 2026-07-29 per a
    // full-playthrough report that the game reads too easy outside early
    // Elite nodes). Scale enemy durability and damage across the whole game
    // in one place so combat can be made harder without re-authoring every
    // ENEMIES entry. 1.0 = pre-1c behavior. Sim-tuned.
    let ENEMY_HP_MULT = 1.6;        // multiplies every non-boss enemy's max HP at creation (was 1.5)
    let ENEMY_DAMAGE_MULT = 1.3;    // multiplies damage non-boss enemies deal to heroes (was 1.2)
    // Boss-specific knobs (NEW 2026-07-29) — bosses were previously fully
    // EXEMPT from the two knobs above ("individually tuned already"), which
    // meant every time the trash/elite knobs got bumped, bosses quietly fell
    // behind the rest of the difficulty curve instead of staying ahead of it
    // the way a boss should. Confirmed by a fresh 135-battle regression
    // (9 bosses × 15 trials, a healer-less 3-hero party) landing 100% win /
    // 48-92% HP remaining on EVERY boss — bosses were the easiest fights in
    // the game, not the hardest. These apply on top of each boss's own
    // hand-tuned base stats, same way the trash knobs layer on top of
    // ENEMIES templates rather than replacing them.
    let BOSS_HP_MULT = 1.45;        // multiplies boss max HP at creation
    let BOSS_DAMAGE_MULT = 1.35;    // multiplies damage bosses deal to heroes

    // Leveling & enemy scaling (Phase E core; level source is now per-node, §5.1).
    let ENEMY_SCALE_PER_LEVEL = 0.1;        // +10% HP/ATK/DEF per enemy level above 1 (was 0.08)
    const TIER_XP = { fodder: 10, standard: 25, elite: 60, boss: 150 };  // base XP by tier (× enemy level)
    function xpForNext(level) { return 40 * level; }          // XP needed to reach the next level
    let SP_PER_LEVEL = 1;   // Skill Points earned per level-up, spent in SKILL_TREES

    // Tactic Slot budget (§4.1a) — how many non-"active" SKILL_TREES nodes a
    // hero can have SOCKETED at once. Deliberately NOT a stored hero field:
    // it's a pure function of level, so it can never desync from hero.level
    // and level-up code (levelUp/fastForwardHeroToLevel) needs zero changes.
    function tacticSlotsForLevel(level) { return 2 + Math.floor(level / 4); }

    // Limit Break gauge (Phase D½). Heroes only; the gauge PERSISTS across the dungeon (never reset
    // between nodes — only a fresh startDungeon zeroes it, since it's set at hero creation).
    // Rates roughly doubled (Phase H4 tightening pass) — the original "once per ~2 fights" pacing
    // was tuned against Sector 1's longer, denser fights; the story mode's shorter early fights
    // (prologue solo/duo, a single node before the boss) meant the gauge rarely filled at all in
    // practice, so nobody was reaching a Limit Break — see §5.2b/§9 for the sim numbers.
    let GAUGE_PER_DAMAGE_DEALT = 0.31;  // per point of damage the hero deals (was 0.06)
    let GAUGE_PER_DAMAGE_TAKEN = 0.13;  // per point of damage the hero takes (comeback trickle; was 0.03)
    let GAUGE_PER_HEAL = 0.21;          // per point of HP the hero restores (was 0.05)
    let GAUGE_PER_STATUS_APPLIED = 3;   // flat, when a status the hero applied actually lands (was 1)
    let GAUGE_PER_KILL = 11;            // flat, when the hero's hit finishes off a target (was 3)
    function gainLimit(hero, amount) { hero.limit = clamp(hero.limit + amount * limitGaugeMult(hero), 0, 100); }

    // Interim loot source until the map's real loot nodes exist (Phase G).
    let LOOT_DROP_CHANCE = 0.4;   // chance of a random unowned item dropping after a win


    /* ================================================================
       C) HELPERS
       ================================================================ */

    function nextId() { return nextIdCounter++; }
    function randomBetween(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
    // Weighted random pick — `entries` is [{ key/weight }, ...] (any shape with
    // a numeric `weight`); returns one entry. Used by Unknown-node resolution
    // (§5.4) and available for future weighted tables (loot rarity, etc).
    function pickWeighted(entries) {
      const total = entries.reduce(function (sum, e) { return sum + e.weight; }, 0);
      let r = Math.random() * total;
      for (let i = 0; i < entries.length; i++) {
        r -= entries[i].weight;
        if (r <= 0) return entries[i];
      }
      return entries[entries.length - 1];
    }
    function isAlive(c) { return c.stats.hp > 0; }
    function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // The target's damage multiplier for a given damage type (1 if unlisted).
    // 2026-07-28 (battle-mechanics overhaul, design doc §3.2a/§3.7): resolves
    // through DAMAGE_TYPE_CATEGORY into the target's bucket-keyed affinities,
    // not the raw flavor. Exotic-flavored types (void, gravity) bypass the
    // table entirely and always resolve neutral — no combatant is ever given
    // an `exotic` affinity, that's not a normal bucket, see data.js.
    function affinityMultiplier(target, damageType) {
      if (!damageType) return 1;
      const category = DAMAGE_TYPE_CATEGORY[damageType];
      if (!category || category === "exotic") return 1;
      const a = target.affinities || {};
      return (category in a) ? a[category] : 1;
    }

    // --- Status-effect helpers (Phase C) ---
    function hasStatus(c, type) { return c.effects.some(function (e) { return e.type === type; }); }
    function getStatus(c, type) { return c.effects.find(function (e) { return e.type === type; }); }

    // --- Tactic Slots (§4.1a Layer 2) — reading/managing a hero's SOCKETED
    // non-"active" tree nodes. `c` is any combatant here (enemies pass
    // through effectiveAttack/effectiveDefense too), so every reader is
    // defensive about `socketedPassives` not existing on non-heroes.

    // Every socketed node's { name, effect } for this hero, joined against
    // its class's SKILL_TREES entry. The one shared lookup every other
    // socketed-node reader below builds on — mirrors how SKILLS/STATUSES/
    // ENEMIES already keep engine code generic instead of per-node checks.
    function socketedEffects(c) {
      if (!c.socketedPassives || !c.socketedPassives.length) return [];
      const tree = SKILL_TREES[c.classKey] || [];
      return c.socketedPassives
        .map(function (key) { return tree.find(function (n) { return n.key === key; }); })
        .filter(function (n) { return n && n.effect; });
    }

    // Sums every socketed "statMod" node matching `stat` (and, if given, a
    // `scope` — e.g. { statusType: "sunder" } for a duration mod that only
    // touches one status). `flat` and `percent` amounts are kept separate
    // since a caller may want to apply them differently (percent multiplies
    // a computed base, flat just adds).
    function socketedStatMods(c, stat, scope) {
      scope = scope || {};
      let flat = 0, percent = 0;
      socketedEffects(c).forEach(function (node) {
        const e = node.effect;
        if (e.kind !== "statMod" || e.stat !== stat) return;
        if (e.scope) {
          if (e.scope.statusType && e.scope.statusType !== scope.statusType) return;
          if (e.scope.bucket && e.scope.bucket !== scope.bucket) return;
          if (e.scope.skillKey && e.scope.skillKey !== scope.skillKey) return;
        }
        if (e.mode === "percent") percent += e.amount; else flat += e.amount;
      });
      return { flat: flat, percent: percent };
    }

    function usedTacticSlots(hero) {
      const tree = SKILL_TREES[hero.classKey] || [];
      return hero.socketedPassives.reduce(function (sum, key) {
        const node = tree.find(function (n) { return n.key === key; });
        return sum + (node ? node.slotCost : 0);
      }, 0);
    }

    function canSocketNode(hero, nodeKey) {
      const tree = SKILL_TREES[hero.classKey] || [];
      const node = tree.find(function (n) { return n.key === nodeKey; });
      if (!node || node.type === "active") return false;             // actives are never socketed
      if (hero.unlockedNodes.indexOf(nodeKey) < 0) return false;      // must be learned (Layer 1) first
      if (hero.socketedPassives.indexOf(nodeKey) >= 0) return false;  // already socketed
      return usedTacticSlots(hero) + node.slotCost <= tacticSlotsForLevel(hero.level);
    }

    function socketNode(hero, nodeKey) {
      if (!canSocketNode(hero, nodeKey)) return false;
      hero.socketedPassives.push(nodeKey);
      return true;
    }

    function unsocketNode(hero, nodeKey) {
      const idx = hero.socketedPassives.indexOf(nodeKey);
      if (idx < 0) return false;
      hero.socketedPassives.splice(idx, 1);
      return true;
    }

    // A socketed "limitBreakOverride" keystone's skillKey, if any (there's
    // at most one meaningfully active at a time — first found wins). Read
    // live rather than cached on the hero so unsocketing it can't leave a
    // stale pointer behind.
    function keystoneLimitBreakSkillKey(hero) {
      const node = socketedEffects(hero).find(function (n) {
        return n.effect.kind === "ruleOverride" && n.effect.rule === "limitBreakOverride";
      });
      return node ? node.effect.skillKey : null;
    }

    // Any socketed keystone whose rule is a bespoke named flag rather than
    // one of the generic ruleOverride shapes (bonusApplies/limitBreakOverride)
    // — e.g. Synth Medic's Adaptive Nanites ("healCleansesDisable"). Each
    // bespoke rule still gets its own small, isolated branch at the exact
    // point it fires (matches the design doc's own Dread Knight Guard-reflect
    // precedent) — this just answers "is it socketed," not what it does.
    function hasKeystoneRule(hero, ruleName) {
      return socketedEffects(hero).some(function (n) {
        return n.effect.kind === "ruleOverride" && n.effect.rule === ruleName;
      });
    }

    // Same lookup as hasKeystoneRule, for a bespoke ruleOverride that also
    // carries a numeric `amount` (Unbreaking's Guard-reflect %, Meltdown's
    // Burn-target damage bonus, Overcharged Rail's Rail Shot boost — §4.1a,
    // 2026-07-29). Not keystone-exclusive despite the sibling function's name
    // above — effect.kind:"ruleOverride" isn't restricted to type:"keystone"
    // nodes, Overcharged Rail is a "passive". Returns 0 (falsy) if unsocketed.
    function socketedRuleAmount(hero, ruleName) {
      const node = socketedEffects(hero).find(function (n) {
        return n.effect.kind === "ruleOverride" && n.effect.rule === ruleName;
      });
      return node ? node.effect.amount : 0;
    }

    // A skill's EN cost after any socketed "enCost" statMod scoped to it
    // (an economy node, e.g. "Firewall Breach costs 20% less EN").
    function effectiveEnCost(hero, skillKey) {
      const mod = socketedStatMods(hero, "enCost", { skillKey: skillKey });
      let cost = SKILLS[skillKey].enCost + mod.flat;
      if (mod.percent) cost = Math.round(cost * (1 + mod.percent));
      return Math.max(0, cost);
    }

    // A socketed "limitGaugeRate" economy node speeds up Limit gauge fill —
    // read by gainLimit below, the single chokepoint every gauge gain
    // already passes through.
    function limitGaugeMult(hero) {
      return 1 + socketedStatMods(hero, "limitGaugeRate").percent;
    }

    // A socketed "lootRarity" economy node — unlike every other node type,
    // loot isn't attributed to one hero (grantLoot/pickWeightedLootItem,
    // ui.js, roll for the whole party), so this scans the whole `party`
    // rather than reading one hero's sockets.
    function lootRarityBonus() {
      return party.reduce(function (sum, h) { return sum + socketedStatMods(h, "lootRarity").flat; }, 0);
    }

    // Effective stats fold active debuffs into the base numbers on the fly
    // (we never mutate base stats, so nothing gets corrupted).
    function effectiveAttack(c) {
      let a = c.stats.attack;
      c.effects.forEach(function (e) {
        if (e.type === "weaken") a -= e.magnitude;
        if (e.type === "overclock") a += e.magnitude;
      });
      a += socketedStatMods(c, "attack").flat;
      return Math.max(0, a);
    }
    function effectiveDefense(c) {
      let d = c.stats.defense;
      c.effects.forEach(function (e) { if (e.type === "sunder") d -= e.magnitude; });
      d += socketedStatMods(c, "defense").flat;
      return Math.max(0, d);
    }
    // 2026-07-28 (§3.2a/§3.3): Pin (Gravity flavor) reduces effective Speed,
    // read by the initiative sort instead of raw stats.speed — mirrors
    // effectiveAttack/effectiveDefense's pattern exactly.
    function effectiveSpeed(c) {
      let s = c.stats.speed;
      c.effects.forEach(function (e) { if (e.type === "pin") s -= e.magnitude; });
      return Math.max(0, s);
    }
    // Guard multiplies incoming damage (e.g. x0.5); multiple stack multiplicatively.
    function guardMultiplier(c) {
      let m = 1;
      c.effects.forEach(function (e) { if (e.type === "guard") m *= e.magnitude; });
      return m;
    }
    // 2026-07-28 (§3.2a/§3.3): Irradiate halves incoming healing while active —
    // mirrors guardMultiplier's pattern, folded into the heal branch of
    // applyToTarget the same way guardMultiplier folds into the damage branch.
    const IRRADIATE_HEAL_MULT = 0.5;
    function healMultiplier(c) {
      return hasStatus(c, "irradiate") ? IRRADIATE_HEAL_MULT : 1;
    }

    // Add or refresh a status on a target. Respects nature-locks (e.g. Confuse
    // only affects organics). Refresh + keep-strongest: one instance per type.
    // Returns true if it actually landed (false if nature-blocked) — callers
    // use this to decide whether the status counts toward Limit Break gauge.
    function addEffect(target, spec) {
      const info = STATUSES[spec.type];
      if (info.requiresNature && target.nature !== info.requiresNature) {
        log(target.name + " is unaffected by " + info.name + ".", "resist");
        return false;
      }
      const existing = getStatus(target, spec.type);
      if (existing) {
        existing.duration = Math.max(existing.duration, spec.duration);
        existing.magnitude = Math.max(existing.magnitude, spec.magnitude);
      } else {
        target.effects.push({ type: spec.type, magnitude: spec.magnitude, duration: spec.duration });
      }
      log(target.name + (info.buff ? " gains " : " is afflicted with ") + info.name + "!",
          info.buff ? undefined : "resist");
      return true;
    }

    // Confusion may redirect a single-target attack to a random combatant.
    function applyConfusion(actor, skill, targets) {
      if (!hasStatus(actor, "confuse")) return targets;
      if (skill.kind !== "attack" || skill.target !== "enemy") return targets;
      if (Math.random() < getStatus(actor, "confuse").magnitude) {
        const pool = living(allCombatants()).filter(function (c) { return c.id !== actor.id; });
        if (pool.length) {
          log(actor.name + " is confused and strikes wildly!", "resist");
          return [pool[randomBetween(0, pool.length - 1)]];
        }
      }
      return targets;
    }

    function allCombatants() { return party.concat(enemies); }
    function living(list) { return list.filter(isAlive); }
    function opponentsOf(c) { return c.side === "heroes" ? enemies : party; }
    function alliesOf(c)    { return c.side === "heroes" ? party : enemies; }
    function findById(id) {
      return allCombatants().find(function (c) { return c.id === id; });
    }

    function createHero(classKey, displayName) {
      const t = CLASSES[classKey];
      const s = t.baseStats;
      const level = 1;
      return {
        id: nextId(),
        name: displayName || t.className,   // call-sign (Casimir Zaab, Vito, …)
        classKey: classKey,
        className: t.className,
        level: level,
        xp: 0,
        xpToNext: xpForNext(level),
        sp: 0,                   // Skill Points, earned per level, spent in SKILL_TREES
        unlockedNodes: [],       // tree node keys this hero has learned (Layer 1, permanent)
        socketedPassives: [],    // subset of unlockedNodes currently SOCKETED (Layer 2, §4.1a
                                  // Tactic Slots — only non-"active" node types live here; the
                                  // budget itself isn't stored, see tacticSlotsForLevel below)
        equipment: { head: null, body: null, legs: null, arms: null, weapon: null, ring: null },
        limit: 0,                // Limit Break gauge, 0-100, persists across the run
        overwatchUsed: false,    // Overwatch keystone (§4.1a): per-COMBAT flag, reset in enterNode
        subtitle: t.className + " · Lv " + level,   // "Merc · Lv 1"
        side: "heroes",
        stats: {
          hp: s.hp, maxHp: s.hp, en: s.en, maxEn: s.en,
          attack: s.attack, defense: s.defense, speed: s.speed
        },
        skills: t.skills.slice(),
        nature: t.nature,                             // "organic" | "synthetic" (status-lock)
        affinities: Object.assign({}, t.affinities),  // damage-type multipliers
        effects: []              // STATUS EFFECTS SEAM — filled in Phase C
      };
    }

    function createEnemy(enemyKey, displayName, level) {
      level = level || 1;
      const t = ENEMIES[enemyKey];
      const s = t.baseStats;
      const f = 1 + ENEMY_SCALE_PER_LEVEL * (level - 1);   // stat scaling by level
      // Set-piece bosses are individually hand-tuned, so they get their OWN
      // knob (BOSS_HP_MULT) rather than the trash/elite one — bosses were
      // fully EXEMPT from any multiplier until 2026-07-29, which let them
      // quietly fall behind every time the trash knob got bumped. Layers on
      // top of each boss's own hand-tuned base stats, same as the trash knob
      // layers on top of ENEMIES templates rather than replacing them.
      const hpMult = t.tier === "boss" ? BOSS_HP_MULT : ENEMY_HP_MULT;
      const hp = Math.round(s.hp * f * hpMult);
      return {
        id: nextId(),
        name: displayName || t.typeName,
        typeKey: enemyKey,
        level: level,
        subtitle: t.role + (level > 1 ? " · Lv " + level : ""),
        tier: t.tier,            // "fodder" | "standard" | "elite" (for encounters)
        side: "enemies",
        stats: {
          hp: hp, maxHp: hp,
          en: s.en, maxEn: s.en,
          attack: Math.round(s.attack * f),
          defense: Math.round(s.defense * f),
          speed: s.speed
        },
        skills: t.skills.slice(),
        nature: t.nature,                             // "organic" | "synthetic" (status-lock)
        affinities: Object.assign({}, t.affinities),  // damage-type multipliers
        effects: [],             // STATUS EFFECTS SEAM — filled in Phase C
        // Generic boss add-spawn hook (Site Erebus, §5.3): a template may
        // declare reinforceAt (fraction of maxHp) + reinforceWave (enemies to
        // spawn once) — undefined/harmless for every enemy that doesn't.
        reinforceAt: t.reinforceAt,
        reinforceWave: t.reinforceWave,
        reinforced: false,
        // Generic boss enrage hook (NEW 2026-07-29, same family as the
        // reinforceAt/reinforceWave hook above): a template may declare
        // enrageAt (fraction of maxHp) + enrageBuff (a one-time permanent
        // stat spike) + optionally enrageSkill (unlocks a new attack) —
        // undefined/harmless for every enemy that doesn't set them. See
        // triggerEnrage (engine.js).
        enrageAt: t.enrageAt,
        enrageBuff: t.enrageBuff,
        enrageSkill: t.enrageSkill,
        enrageMessage: t.enrageMessage,
        enraged: false,
        xpReward: Math.round((TIER_XP[t.tier] || 10) * level)
      };
    }


