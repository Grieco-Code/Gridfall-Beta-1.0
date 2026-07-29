    "use strict";

    /* ================================================================
       A) DATA
       ================================================================ */

    // DAMAGE TYPES & AFFINITIES (Phase B; consolidated to a 4-bucket resistance
    // system 2026-07-28, design doc §3.2a/§3.7 — SLICE 1 of the battle-mechanics
    // overhaul, gridfall-battle-mechanics-overhaul memory).
    // 8 flavors (`damageType` on skills, unchanged vocabulary/messages):
    // kinetic, corrosive, thermal, shock, overload, psionic, void, gravity.
    // ("cyber" renamed to "overload" 2026-07-28, Synth Medic rework — "Cyber"
    // read as hacking/computer-breach flavor text landing on enemies with no
    // systems to hack; "Overload" reads as a neural/circuit overload either
    // way, so it works narrated against organic or synthetic targets alike.
    // Purely a label change — same bucket, same numbers, see below.)
    // Each flavor resolves through DAMAGE_TYPE_CATEGORY into one of 4 resistance
    // BUCKETS — combatants author `affinities` against the bucket, not the raw
    // flavor, so a skill keeps its full narrative vocabulary while the actual
    // resistance math only has 4 numbers to track:
    //   physical (kinetic, corrosive) · thermal (thermal) · shock (shock, overload)
    //   · mind (psionic) · exotic (void, gravity — NOT a normal bucket, see below)
    // Any bucket NOT listed on a combatant defaults to NEUTRAL (x1). Named tiers
    // keep the tables readable and let us retune the whole game from one place.
    // Affinity ladder: 2.0 doubly-weak · 1.5 weak · 1.25 mildly weak · 1.0 neutral
    // · 0.5 resist · 0.2 hard-resist. Nothing is fully immune — even a
    // hard-resisted hit chips for at least 1, so no class is ever dead weight.
    // GOVERNING RULE: `physical` is never HARD_RESIST anywhere (clamped to
    // RESIST-DOUBLE_WEAK) — Kinetic is every hero's free universal Attack and
    // must never read as a dead button. Thermal/Shock/Mind may use the full range.
    const NEUTRAL     = 1.0;
    const MILD_WEAK    = 1.25;
    const WEAK        = 1.5;   // takes extra damage ("Super effective!")
    const DOUBLE_WEAK  = 2.0;
    const RESIST      = 0.5;   // takes reduced damage ("Resisted.")
    const HARD_RESIST = 0.2;   // barely a scratch — the floor for "immune-flavored" matchups

    const DAMAGE_TYPE_CATEGORY = {
      kinetic: "physical", corrosive: "physical",
      thermal: "thermal",
      shock: "shock",       overload: "shock",
      psionic: "mind",
      void: "exotic",       gravity: "exotic"
    };
    // "exotic" is deliberately NOT a normal bucket — no combatant is ever given
    // an `exotic` affinity value. Void/Gravity skills bypass the affinity table
    // entirely (see affinityMultiplier, state.js) and each defines its own
    // special rule instead (Void: always neutral, punches through resistance;
    // Gravity: ignores DEF via `pierce:1`, applies Pin — see below).

    // STATUS EFFECTS (Phase C; +2 new 2026-07-28, design doc §3.3). Each status
    // is data: skills apply them via an `applies: [{ type, magnitude, duration }]`
    // field; they tick at the start of the afflicted's turn (see tickEffects).
    // `pip` is the panel badge, `buff` flags a good effect, `requiresNature`
    // locks it to organic/synthetic.
    //   burn      — magnitude = damage per turn (DoT)
    //   weaken    — magnitude = ATK reduction
    //   sunder    — magnitude = DEF reduction
    //   guard     — magnitude = incoming-damage multiplier (e.g. 0.5)  [buff]
    //   disable   — skip the turn (magnitude unused)
    //   confuse   — magnitude = chance to strike a random target; organic minds only
    //   overclock — magnitude = ATK increase  [buff]
    //   irradiate — magnitude = DoT/turn (like burn), PLUS halves all incoming
    //               healing on the afflicted while active (see healMultiplier,
    //               state.js). Radiation flavor, carried by Physical/Thermal/
    //               Shock-flavored skills — no dedicated damage type needed.
    //   pin       — magnitude = flat Speed reduction, read by effectiveSpeed()
    //               (state.js) instead of raw stats.speed for turn order.
    //               Gravity flavor exclusively.
    //   taunt     — magnitude unused; a self-buff that locks enemy AI
    //               single-target aggro onto the taunter (pickEnemyTarget,
    //               engine.js). Dread Knight's tank tool, §3.3/§4.1a — the
    //               long-reserved mechanic finally built.
    const STATUSES = {
      burn:      { name: "Burn",      pip: "BURN"  },
      weaken:    { name: "Weaken",    pip: "ATK↓" },
      sunder:    { name: "Sunder",    pip: "DEF↓" },
      guard:     { name: "Guard",     pip: "GUARD", buff: true },
      disable:   { name: "Disable",   pip: "STUN"  },
      confuse:   { name: "Confuse",   pip: "CONF",  requiresNature: "organic" },
      overclock: { name: "Overclock", pip: "ATK↑",  buff: true },
      // Regen (§5.4, debuts on Dungeon 4's Bio-Tank) — a HoT, Burn's mirror.
      // Ticks in tickEffects alongside Burn; the "race Regen before it heals
      // more than you can burst" tension is the Bio-Tank's whole design.
      regen:     { name: "Regen",     pip: "REGEN", buff: true },
      irradiate: { name: "Irradiate", pip: "RAD"   },
      pin:       { name: "Pinned",    pip: "PIN"   },
      taunt:     { name: "Taunt",     pip: "TAUNT", buff: true }
    };

    // SKILLS are data. Each says its ENERGY cost, KIND, TARGET, and (for
    // damaging skills) its damageType — which is checked against the target's
    // affinities in applyToTarget().
    //   kind:   "attack" -> damage      |  "heal" -> restore HP
    //   target: "enemy"  "ally"  "self"  "allEnemies"  "allAllies"  (RELATIVE to user)
    const SKILLS = {
      // --- Basic (Kinetic for everyone — a reliable fallback) ---
      attack: {
        name: "Attack", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 0, message: "fires at"
      },

      // --- Merc ---
      aimedShot: {   // signature: reliable heavy single-target
        name: "Aimed Shot", enCost: 8, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 16, message: "lines up a shot on"
      },
      fragGrenade: {   // utility: AoE
        name: "Frag Grenade", enCost: 10, kind: "attack", target: "allEnemies",
        damageType: "kinetic", power: 10, message: "lobs a Frag Grenade at"
      },
      // Merc skill-tree branch (§4.1a, 2026-07-29): the Physical-bucket
      // armor-melter — trades Aimed Shot's raw power for a much bigger
      // pierce, a real answer to a heavy-DEF target (Mech, boss armor).
      armorPiercingRounds: {   // tree, tier 2 (needs Suppressing Fire)
        name: "Armor-Piercing Rounds", enCost: 11, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 12, pierce: 0.65, message: "puts an armor-piercing round through"
      },

      // --- Dread Knight ---
      crushingBlow: {   // signature: heavy hit that partly ignores armor
        name: "Crushing Blow", enCost: 8, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 18, pierce: 0.3, message: "smashes"
      },
      guard: {   // utility: self-buff, halve incoming damage until your next turn
        name: "Guard", enCost: 5, kind: "status", target: "self",
        message: "raises a defensive bulwark",
        applies: [{ type: "guard", magnitude: 0.5, duration: 1 }]
      },
      // Dread Knight skill-tree branch (§4.1a, 2026-07-29): Taunt is the
      // long-reserved aggro mechanic (§3.3) — see pickEnemyTarget, engine.js
      // — finally built as this tree's first branch root.
      taunt: {   // tree, tier 2 (needs Cleave): self-buff, locks enemy aggro
        name: "Taunt", enCost: 6, kind: "status", target: "self",
        message: "plants their feet and taunts the enemy",
        applies: [{ type: "taunt", magnitude: 0, duration: 2 }]
      },
      bloodfeed: {   // tree, tier 3 (needs Taunt): Physical + self-heal drain
        name: "Bloodfeed", enCost: 12, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 14, drain: 0.3, message: "tears into"
      },
      crackArmor: {   // tree, tier 2 (needs Cleave): Physical + guaranteed Sunder
        name: "Crack Armor", enCost: 10, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 10, message: "cracks the armor of",
        applies: [{ type: "sunder", magnitude: 6, duration: 2 }]
      },

      // --- Mech Runner ---
      railShot: {   // signature: huge single-target, ignores half of armor
        name: "Rail Shot", enCost: 12, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 22, pierce: 0.5, message: "fires a rail shot into"
      },
      incendiaryRounds: {   // thermal hit + Burn (damage-over-time)
        name: "Incendiary Rounds", enCost: 10, kind: "attack", target: "enemy",
        damageType: "thermal", power: 4, message: "lights up",
        applies: [{ type: "burn", magnitude: 6, duration: 3 }]
      },
      // Mech Runner skill-tree branch (§4.1a, 2026-07-29): named
      // "mechRocketBarrage" (not "rocketBarrage") since that key already
      // belongs to Security Mech's AoE special — same flavor name, distinct
      // skill, different owner; display `name` matches the design doc's
      // worked example verbatim, only the code key differs.
      mechRocketBarrage: {   // tree, tier 2 (needs Overclock): Thermal AoE + guaranteed Burn
        name: "Rocket Barrage", enCost: 14, kind: "attack", target: "allEnemies",
        damageType: "thermal", power: 6, message: "rains rocket fire on",
        applies: [{ type: "burn", magnitude: 5, duration: 2 }]
      },

      // --- Synth Medic (Nyx) — 2026-07-28 rework: was Netrunner/"Hacker,"
      // reframed as a nanite-support caster (design doc §4.1a's obsolete
      // Netrunner branch superseded — see current changelog entry). Kept the
      // Overload/Shock damage identity (still the anti-synthetic answer she
      // always was — Security Mech, Arc Sentinel, the Warden, the Sun God all
      // still resolve through the same "shock" bucket, just no hero is
      // narratively required to be "the hacker" to deliver it) and added her
      // first real heal, `naniteWeave`, for parity with Psion's `mend`. ---
      hack: {   // signature: Overload burst — still the Security Mech/synthetic answer (x2.0)
        name: "Nanite Surge", enCost: 12, kind: "attack", target: "enemy",
        damageType: "overload", power: 16, message: "surges nanites through"
      },
      empBlast: {   // utility: Shock AoE (anti-swarm) — unchanged, already flavor-neutral
        name: "EMP Blast", enCost: 12, kind: "attack", target: "allEnemies",
        damageType: "shock", power: 8, message: "blasts"
      },
      // Immediate-but-small heal + a short Regen tail — Mend's mirror-image:
      // Mend front-loads one big burst, Nanite Weave trades burst size for
      // extra total healing spread over 2 turns. Real tactical difference
      // (need HP right now -> Mend; have a turn to spare -> Nanite Weave),
      // not a reskinned duplicate of the same heal.
      naniteWeave: {
        name: "Nanite Weave", enCost: 10, kind: "heal", target: "ally",
        power: 20, message: "weaves repair nanites into",
        applies: [{ type: "regen", magnitude: 8, duration: 2 }]
      },
      systemShock: {   // GATED (level / skill-tree later): shock hit + Disable (skip a turn)
        name: "Neural Jolt", enCost: 14, kind: "attack", target: "enemy",
        damageType: "shock", power: 4, message: "jolts",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      // Synth Medic tree branch (§4.1a, 2026-07-28): her first AoE heal —
      // distinct in shape from Psion's ultimate-only Mind's Mercy (a regular
      // skill, not a Limit Break) and from her own Nanite Weave (AoE instead
      // of single-target).
      repairSwarm: {   // tree, tier 2 (needs Neural Jolt): AoE heal + Regen
        name: "Repair Swarm", enCost: 16, kind: "heal", target: "allAllies",
        power: 14, message: "sends a swarm of repair nanites through",
        applies: [{ type: "regen", magnitude: 5, duration: 2 }]
      },

      // --- Mentalist (debuff specialist) ---
      psiBurst: {
        name: "Psi-Burst", enCost: 12, kind: "attack", target: "enemy",
        damageType: "psionic", power: 14, message: "sears"
      },
      mindSpike: {   // small psi hit + Weaken (−ATK)
        name: "Mind Spike", enCost: 8, kind: "attack", target: "enemy",
        damageType: "psionic", power: 4, message: "spikes the mind of",
        applies: [{ type: "weaken", magnitude: 6, duration: 3 }]
      },
      terror: {   // GATED (level / skill-tree later): Confuse (organic minds only)
        name: "Terror", enCost: 10, kind: "status", target: "enemy",
        message: "floods raw terror into",
        applies: [{ type: "confuse", magnitude: 0.5, duration: 2 }]
      },
      mend: {
        name: "Mend", enCost: 8, kind: "heal", target: "ally",
        power: 35, message: "channels Mend into"
      },
      // Psion tree branch (§4.1a, 2026-07-28): a heal+shield hybrid — distinct
      // in shape from both Mend (pure heal) and Synth Medic's Repair Swarm
      // (AoE+regen, no shielding).
      calmMind: {   // tree, tier 2 (needs Terror): single-target heal + Guard
        name: "Calm Mind", enCost: 10, kind: "heal", target: "ally",
        power: 18, message: "settles a calm mind into",
        applies: [{ type: "guard", magnitude: 0.7, duration: 2 }]
      },

      // --- Shared item ---
      stim: {
        name: "Stim", enCost: 0, kind: "heal", target: "ally",
        power: 40, message: "injects a Stim into"
      },

      // --- Enemy skills ---
      rocketBarrage: {
        name: "Rocket Barrage", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "kinetic", power: -9, message: "rains rockets on"  // AoE: softer than a focused shot
      },
      commandStrike: {
        name: "Command Strike", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 7, message: "lands a command strike on"
      },
      markTarget: {   // enemy debuff demo: light hit + Sunder (−DEF) on a hero
        name: "Mark Target", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 0, message: "paints a target on",
        applies: [{ type: "sunder", magnitude: 5, duration: 2 }]
      },
      arcBolt: {   // Arc Sentinel basic — Shock (threatens the Shock-weak Netrunner)
        name: "Arc Bolt", enCost: 0, kind: "attack", target: "enemy",
        damageType: "shock", power: 0, message: "zaps"
      },
      arcDischarge: {   // Arc Sentinel special — Shock + chance to Disable a hero
        name: "Arc Discharge", enCost: 0, kind: "attack", target: "enemy",
        damageType: "shock", power: 2, message: "discharges into",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      suppressingFire: {   // Grunt special — Kinetic + Weaken
        name: "Suppressing Fire", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 0, message: "lays down suppressing fire on",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      repairProtocol: {
        name: "Repair Protocol", enCost: 0, kind: "heal", target: "ally",
        power: 24, message: "runs Repair Protocol on"
      },

      // --- Kharon's Reach colony (Phase H3 prologue, §5.2) ---
      batonStrike: {   // Quota Enforcer special — Kinetic
        name: "Baton Strike", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 3, message: "cracks a shock baton into"
      },
      // --- Boss-support add skills (2026-07-24) ---
      sentryShot: {   // Sentry Turret — armor-piercing Kinetic sniper (glass cannon)
        name: "Sentry Shot", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 8, pierce: 0.15, message: "draws a bead and fires on"
      },
      nanoRepair: {   // Repair Drone — patches up a wounded ally (killable heal source)
        name: "Nano-Repair", enCost: 0, kind: "heal", target: "ally",
        power: 20, message: "sprays repair nanites over"
      },
      braceUp: {   // enemy self-Guard — halves incoming damage for a couple turns
        name: "Brace", enCost: 0, kind: "status", target: "self",
        message: "braces behind a riot shield",
        applies: [{ type: "guard", magnitude: 0.5, duration: 2 }]
      },
      overdrive: {   // enemy self-Overclock — +ATK for a few turns (elite aggression)
        name: "Overdrive", enCost: 0, kind: "status", target: "self",
        message: "spools into overdrive",
        applies: [{ type: "overclock", magnitude: 6, duration: 3 }]
      },
      stunBaton: {   // Riot Enforcer — Kinetic + Disable (locks a hero out for a turn)
        name: "Stun Baton", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 4, message: "jabs a stun baton into",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      ironDiscipline: {   // Overseer Voraxx special — Kinetic + Weaken
        name: "Iron Discipline", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 8, message: "barks iron discipline at",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      overseersLash: {   // Overseer Voraxx special — heavy single-target, partly armor-piercing
        name: "Overseer's Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 22, pierce: 0.2, message: "lashes out at"
      },
      overseersCrackdown: {   // Overseer Voraxx special — Kinetic AoE (a duo has no one to hide behind)
        name: "Overseer's Crackdown", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "kinetic", power: 6, message: "cracks down on the whole squad, hitting"
      },

      // --- Talos Systems skills (Phase G, §5.1 — organic, Corrosive/Thermal, the
      //     Mentalist's designated rival faction the way Netrunner is Vossmark's) ---
      venomClaws: {   // Talos Wraith basic — Corrosive
        name: "Venom Claws", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 0, message: "rakes with venomed claws at"
      },
      phantomBlade: {   // Talos Phantom basic — Corrosive
        name: "Phantom Blade", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 0, message: "cuts with a corroded blade into"
      },
      phantomStrike: {   // Talos Phantom special — Corrosive + Sunder (a called shot at armor joints)
        name: "Phantom Strike", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 3, message: "strikes a weak point on",
        applies: [{ type: "sunder", magnitude: 5, duration: 2 }]
      },
      vanguardEdge: {   // Talos Vanguard basic — Thermal
        name: "Vanguard Edge", enCost: 0, kind: "attack", target: "enemy",
        damageType: "thermal", power: 4, message: "burns with a plasma edge into"
      },
      plasmaCleave: {   // Talos Vanguard special — heavy Thermal burst, partly armor-piercing
        name: "Plasma Cleave", enCost: 0, kind: "attack", target: "enemy",
        damageType: "thermal", power: 20, pierce: 0.4, message: "cleaves with a plasma edge into"
      },

      // ---------- DUNGEON 4 "SPECIMEN WING" (§5.4a, 2026-07-24) ----------
      // Bio-horror side of Talos — Corrosive/Thermal-leaning like the existing
      // Security Wing stubs above, but built around the Regen debut (Bio-Tank)
      // and unsettling-not-graphic status effects rather than raw gore.
      witheredGrasp: {   // Splice Husk basic — Corrosive
        name: "Withered Grasp", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 0, message: "claws with a grip that shouldn't still have strength at"
      },
      fusedSlam: {   // Bio-Tank basic — Corrosive
        name: "Fused Slam", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 2, message: "slams a fused, malformed limb into"
      },
      boundedGrowth: {   // Bio-Tank self-buff — Regen (§5.4 debut). "Bounded":
        // restrained, but growing anyway — the race-the-clock tension.
        name: "Bounded Growth", enCost: 0, kind: "status", target: "self",
        message: "shudders as torn tissue knits back together",
        applies: [{ type: "regen", magnitude: 8, duration: 3 }]
      },
      chimeraRend: {   // Chimera Specimen special — heavy Corrosive burst, partly armor-piercing
        name: "Chimera Rend", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 14, pierce: 0.3, message: "rends with too many limbs at once into"
      },
      unmakingHowl: {   // Chimera Specimen — a sound that shouldn't be possible;
        // pure status (no damage) — the "unsettling, not graphic" horror beat.
        name: "Unmaking Howl", enCost: 0, kind: "status", target: "enemy",
        message: "lets out a howl that no throat should be able to make",
        applies: [{ type: "weaken", magnitude: 4, duration: 2 }]
      },
      // --- Proteus (boss) — half-transcended Talos bio-executive, §9.4/§5.4a ---
      proteusLash: {   // basic — Corrosive
        name: "Proteus Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 6, message: "lashes out with something that used to be an arm at"
      },
      proteusBloom: {   // heavy special — Thermal burst, partly armor-piercing
        name: "Proteus Bloom", enCost: 0, kind: "attack", target: "enemy",
        damageType: "thermal", power: 24, pierce: 0.3, message: "blooms open with searing bio-plasma into"
      },
      proteusUnraveling: {   // AoE status — deliberately not a damage skill; the
        // "unsettling, not graphic" horror beat scaled up to boss stakes.
        name: "The Unraveling", enCost: 0, kind: "status", target: "allEnemies",
        message: "unfolds into a shape nothing should have, and the squad's resolve falters",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },

      // ---------- HELIOS STATION / DUNGEON 5 (§5.4b, 2026-07-24) ----------
      // Void roster — narrowly previews the reserved Void/Entropy damage
      // type (§3.2), so only the elite (Void Horror's special) and both
      // bosses actually deal it; the rest lean on existing flavors
      // (corrosive/psionic) so Void stays a rare, precious hit rather than
      // flooding every skill. The family is uniformly weak Thermal (a sun
      // station's light is their one shared bane — the designated counter
      // is the Mech Runner, an underused specialist next to Netrunner/
      // Mentalist) and resist Kinetic/Psionic (immaterial, and their minds
      // are already too alien for a mundane psychic hit to land clean —
      // deliberately denies "just bring the Mentalist," unlike every prior
      // faction). Terror/Devil still WIELD Psionic themselves despite
      // resisting it, the same "resists its own domain" shape already
      // established by the Erebus Shaman/Broodmarshal.
      restlessGrasp: {   // Poltergeist basic — Kinetic (still just an unnerving physical grab)
        name: "Restless Grasp", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 0, message: "claws with hands that shouldn't still be moving at"
      },
      umbralCut: {   // Shade basic — Corrosive
        name: "Umbral Cut", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 0, message: "cuts with an edge made of absence into"
      },
      witherTouch: {   // Shade special — Corrosive + Weaken
        name: "Wither Touch", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 3, message: "drains the strength out of",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      creepingDread: {   // Terror basic — Psionic
        name: "Creeping Dread", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 0, message: "floods a formless dread into"
      },
      hollowScream: {   // Terror special — Psionic + Confuse (organic-only)
        name: "Hollow Scream", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 2, message: "screams with a throat that isn't really there at",
        applies: [{ type: "confuse", magnitude: 0.5, duration: 2 }]
      },
      rendingClaw: {   // Void Horror basic — Corrosive
        name: "Rending Claw", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 4, message: "rends with claws too long for its own shape into"
      },
      consumeLight: {   // Void Horror special — heavy VOID burst, partly armor-piercing (the
        // elite's "preview" moment — Void punches through resistances, §3.2)
        name: "Consume Light", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 16, pierce: 0.3, message: "consumes the light around"
      },
      clawRake: {   // Demon basic — Corrosive
        name: "Claw Rake", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 4, message: "rakes burning claws across"
      },
      hellbrand: {   // Demon special — heavy Thermal, partly armor-piercing (wields the one
        // element its own family fears, same trope the Sun God pays off at boss scale)
        name: "Hellbrand", enCost: 0, kind: "attack", target: "enemy",
        damageType: "thermal", power: 17, pierce: 0.3, message: "brands searing fire into"
      },
      tormentLash: {   // Devil basic — Psionic
        name: "Torment Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 3, message: "lashes a psychic torment across"
      },
      damnationDecree: {   // Devil special — Psionic AoE + Weaken (a command aura, same shape
        // as the Broodmarshal's Hive Command)
        name: "Damnation Decree", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "psionic", power: 2, message: "passes a decree of ruin over",
        applies: [{ type: "weaken", magnitude: 4, duration: 2 }]
      },
      // --- Void Soul Eater (boss 1 of 2 — the gatekeeper) --- No self-heal
      // and no reinforceWave, on purpose: the Warden/Proteus lesson (tech-
      // ref §9) is that a self-sustaining boss on top of EN-starved late
      // rounds produces an unwinnable attrition slog, not a hard fight. This
      // boss's teeth are hitting hard once and stripping the party's
      // resolve before the Sun God — no rest node separates the two.
      soulRend: {   // basic — VOID
        name: "Soul Rend", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 7, message: "tears at something that isn't quite flesh in"
      },
      devouringMaw: {   // special — heavy VOID burst, partly armor-piercing
        name: "Devouring Maw", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 20, pierce: 0.35, message: "opens a maw that shouldn't fit inside its own silhouette on"
      },
      witheringGaze: {   // status — Weaken (drains a hero's will to keep fighting)
        name: "Withering Gaze", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 0, message: "looks straight through the armor and the person wearing it at",
        applies: [{ type: "weaken", magnitude: 6, duration: 2 }]
      },
      // --- The Sun God (boss 2 of 2 — Helios's regulator core, corrupted;
      // secretly a machine under a god's face, not a literal deity, §5.4b) ---
      solarLash: {   // basic — Thermal (it commands the fire, doesn't fear it — ironic
        // against its own hard-resist-thermal affinity below)
        name: "Solar Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "thermal", power: 7, message: "lashes a whip of raw sunlight across"
      },
      coronalFlare: {   // special — heavy Thermal AoE
        name: "Coronal Flare", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "thermal", power: 11, message: "erupts in a coronal flare that engulfs"
      },
      unmakingPulse: {   // special — heavy VOID burst, partly armor-piercing (echoes the
        // Soul Eater — the two bosses share one true element under different masks)
        name: "Unmaking Pulse", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 21, pierce: 0.35, message: "pulses with a light that unmakes on contact into"
      },
      eclipseProtocol: {   // status — Disable (the "it's a machine, not a god" tell — Disable
        // isn't nature-locked, but this is the move that makes the reveal legible in the log)
        name: "Eclipse Protocol", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 0, message: "locks out the motor systems of",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      // --- Sol's Acolytes (2026-07-25) — the Sun God's reinforceWave add,
      // a reskin (own ENEMIES entry, not a literal reused Void trash key) so
      // it reads distinctly in the log/UI. ---
      fanaticStrike: {   // basic — Psionic
        name: "Fanatic Strike", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 2, message: "lashes out, chanting an oath to something that no longer answers, at"
      },
      devotedChant: {   // special — self-Overclock (fervor overtaking fear)
        name: "Devoted Chant", enCost: 0, kind: "status", target: "self",
        message: "chants louder, fervor overtaking fear",
        applies: [{ type: "overclock", magnitude: 5, duration: 3 }]
      },

      // --- The Warden (boss) — corrupted Vossmark station AI core, §5.1 ---
      turretVolley: {   // basic — Kinetic
        name: "Turret Volley", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 4, message: "opens fire with a turret volley on"
      },
      overloadCoils: {   // special — Shock AoE, station-wide hazard (extra bite vs the Netrunner)
        name: "Overload Coils", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "shock", power: 9, message: "floods the deck with overload coils, hitting"
      },
      corePurge: {   // special — heavy single-target Overload burst, partly armor-piercing
        name: "Core Purge", enCost: 0, kind: "attack", target: "enemy",
        // power 22→16 (2026-07-24): with add-support the Warden fight runs longer,
        // giving it more nuke turns — softened so the longer fight stays fair.
        // damageType relabeled cyber->overload 2026-07-28 (Synth Medic rework) —
        // an enemy skill's type is never shown to the player, so this is purely
        // for internal consistency, no behavior or text change.
        damageType: "overload", power: 16, pierce: 0.3, message: "unleashes a Core Purge into"
      },
      lockdownProtocol: {   // special — Kinetic hit + Disable (locks down a hero's gear)
        name: "Lockdown Protocol", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 2, message: "locks down the systems of",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      emergencyRepair: {   // heal — the station AI rerouting power to repair itself
        name: "Emergency Repair", enCost: 0, kind: "heal", target: "self",
        power: 30, message: "reroutes power into Emergency Repair protocols for"
      },

      // --- Site Erebus (Dungeon 3, planned §5.3) — the hive castes ---
      chitinBite: {   // Erebus Roach basic — Corrosive
        name: "Chitin Bite", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 0, message: "snaps corroded chitin jaws at"
      },
      mandibleStrike: {   // Erebus Warrior basic — Corrosive
        name: "Mandible Strike", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 0, message: "tears into"
      },
      carapaceRend: {   // Erebus Warrior special — Corrosive + Sunder (a called shot at armor joints)
        name: "Carapace Rend", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 4, message: "rakes armor-scarring claws across",
        applies: [{ type: "sunder", magnitude: 5, duration: 2 }]
      },
      psiLash: {   // Erebus Shaman basic — Psionic
        name: "Psi Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 0, message: "floods a psionic shriek into"
      },
      hiveShriek: {   // Erebus Shaman special — Psionic + Confuse (organic-only; Nyx's synthetic
                       // nature makes her immune, a deliberate synergy with the roster on hand)
        name: "Hive Shriek", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 2, message: "screams straight into the mind of",
        applies: [{ type: "confuse", magnitude: 0.5, duration: 2 }]
      },
      clawSlash: {   // Erebus Armored Warrior basic — Corrosive
        name: "Claw Slash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 2, message: "slashes armored claws across"
      },
      crushingPincer: {   // Erebus Armored Warrior special — heavy Corrosive, partly armor-piercing
        name: "Crushing Pincer", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 19, pierce: 0.35, message: "closes a crushing pincer on"
      },
      marshalClaws: {   // Broodmarshal basic — Corrosive
        name: "Marshal's Claws", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 4, message: "rakes claws still fused to broken cabling across"
      },
      hiveCommand: {   // Broodmarshal special — Psionic AoE + Weaken (a command aura over the whole squad)
        name: "Hive Command", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "psionic", power: 2, message: "floods a command aura over",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      marshalRend: {   // Broodmarshal special — heavy Corrosive, partly armor-piercing
        name: "Marshal's Rend", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 20, pierce: 0.3, message: "rends deep into"
      },
      psychicDominion: {   // Broodmarshal special — Psionic + Disable (seizes a hero's motor control)
        name: "Psychic Dominion", enCost: 0, kind: "attack", target: "enemy",
        damageType: "psionic", power: 2, message: "seizes control of the nerves of",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },

      // --- Skill-tree unlocks (Phase E: learned by spending Skill Points, see SKILL_TREES) ---
      cleave: {   // Dread Knight tree: an AoE version of a heavy swing
        name: "Cleave", enCost: 10, kind: "attack", target: "allEnemies",
        damageType: "kinetic", power: 8, message: "cleaves through"
      },
      overclock: {   // Mech Runner tree: self-buff, temporarily boosts ATK
        name: "Overclock", enCost: 8, kind: "status", target: "self",
        message: "overclocks their weapon systems",
        applies: [{ type: "overclock", magnitude: 6, duration: 3 }]
      },
      firewallBreach: {   // Synth Medic tree, tier 2 (needs Neural Jolt): Overload + Sunder
        name: "Overload Surge", enCost: 10, kind: "attack", target: "enemy",
        damageType: "overload", power: 6, message: "surges overload through",
        applies: [{ type: "sunder", magnitude: 6, duration: 3 }]
      },
      cerebralOverload: {   // Mentalist tree, tier 2 (needs Terror): Psionic AoE
        name: "Cerebral Overload", enCost: 16, kind: "attack", target: "allEnemies",
        damageType: "psionic", power: 8, message: "unleashes a cerebral overload on"
      },

      // --- Equipment-granted (Arms slot only; active while equipped, see ITEMS) ---
      wristRocket: {   // Merc: Wrist Rocket Rig
        name: "Wrist Rocket", enCost: 12, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 20, message: "fires a wrist rocket at"
      },
      powerFist: {   // Dread Knight: Power Fist Gauntlet
        name: "Power Fist", enCost: 10, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 22, pierce: 0.4, message: "drives a power fist into"
      },
      shoulderRocket: {   // Mech Runner: Shoulder Rocket Pod
        name: "Shoulder Rocket", enCost: 14, kind: "attack", target: "allEnemies",
        damageType: "thermal", power: 10, message: "unloads a shoulder rocket volley on"
      },
      terminalProbe: {   // Synth Medic: Nanite Lance Rig
        name: "Nanite Lance", enCost: 12, kind: "attack", target: "enemy",
        damageType: "overload", power: 20, message: "drives a nanite lance into"
      },
      psiConduit: {   // Mentalist: Psi Conduit Glove
        name: "Psi Conduit", enCost: 12, kind: "attack", target: "enemy",
        damageType: "psionic", power: 18, message: "channels a psi conduit into"
      },

      // --- Limit Breaks (Phase D½): bypass EN, spend the whole gauge, one per class ---
      fullAuto: {   // Merc: massive Kinetic AoE
        name: "Full Auto", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "kinetic", power: 24, message: "unloads Full Auto on"
      },
      unbreakableLine: {   // Dread Knight: Guard buff to the whole party
        name: "Unbreakable Line", enCost: 0, kind: "status", target: "allAllies",
        message: "rallies the squad",
        applies: [{ type: "guard", magnitude: 0.35, duration: 2 }]
      },
      orbitalStrike: {   // Mech Runner: devastating single-target, heavy armor-pierce
        name: "Orbital Strike", enCost: 0, kind: "attack", target: "enemy",
        damageType: "thermal", power: 34, pierce: 0.6, message: "calls down an Orbital Strike on"
      },
      totalHack: {   // Synth Medic: Overload AoE + Disable on every target hit
        name: "Full Override", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "overload", power: 12, message: "unleashes a Full Override on",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      mindsMercy: {   // Psion: full-party heal + cleanse (strips debuffs/DoTs, keeps buffs)
        name: "Mind's Mercy", enCost: 0, kind: "heal", target: "allAllies",
        power: 60, cleanse: true, message: "channels Mind's Mercy into"
      },

      // ---------- DUNGEON 6 "THE CRADLE" (§5.4c, 2026-07-25) ----------
      // --- Sexias (new class, Saboteur) — Corrosive/armor-strip specialist,
      // fights with scavenged, corroded ex-Vossmark gear. Closes the one real
      // dead-type gap in the affinity system (no prior hero could deal
      // Corrosive damage — see §5.4c). ---
      corrodedEdge: {   // signature: reliable heavy single-target, partly armor-piercing
        name: "Corroded Edge", enCost: 9, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 17, pierce: 0.2, message: "drags a corroded blade across"
      },
      acidCharge: {   // signature: the armor-strip gimmick — Corrosive + Sunder
        name: "Acid Charge", enCost: 10, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 6, message: "detonates a charge of scavenged acid across",
        applies: [{ type: "sunder", magnitude: 6, duration: 2 }]
      },
      corrosionField: {   // skill-tree unlock: AoE Corrosive
        name: "Corrosion Field", enCost: 12, kind: "attack", target: "allEnemies",
        damageType: "corrosive", power: 8, message: "unleashes a field of corrosive vapor across"
      },
      acidPurge: {   // Limit Break: massive Corrosive AoE + Sunder
        name: "Acid Purge", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "corrosive", power: 15, message: "unleashes Acid Purge across",
        applies: [{ type: "sunder", magnitude: 8, duration: 2 }]
      },

      // --- Saboteur skill-tree branch (§4.1a, 2026-07-28): his tree was a
      // single root node; fills his one real kit gap (no Weaken — only
      // Sunder via acidCharge) and gives the tree its first branch+keystone.
      corrodingGrip: {   // tree, tier 2 (needs Corrosion Field): Corrosive + Weaken
        name: "Corroding Grip", enCost: 10, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 12, message: "clamps a corroding grip around",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      acidPurgePlus: {   // Corrosive Endgame keystone: Acid Purge, armor-piercing + harder Sunder
        name: "Corrosive Overrun", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "corrosive", power: 15, pierce: 0.25, message: "unleashes a Corrosive Overrun across",
        applies: [{ type: "sunder", magnitude: 10, duration: 2 }]
      },

      // --- Phthora, the Fleshspring (boss — Talos's actual leader/origin
      // point, §5.4c; NOT a reuse of Proteus, D4's boss, already dead) ---
      fleshspringGrasp: {   // basic — Corrosive
        name: "Fleshspring Grasp", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 6, message: "grasps with hands still deciding what they want to be at"
      },
      fleshspringRupture: {   // heavy special — Corrosive burst, partly armor-piercing
        name: "Fleshspring Rupture", enCost: 0, kind: "attack", target: "enemy",
        damageType: "corrosive", power: 24, pierce: 0.3,
        message: "ruptures into something that was never meant to finish becoming, tearing into"
      },
      originUnbinding: {   // AoE status — Weaken (the failed ritual unraveling backward through the lineage)
        name: "Origin Unbinding", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "corrosive", power: 0,
        message: "unravels backward through every generation that led here, and the will of",
        applies: [{ type: "weaken", magnitude: 6, duration: 2 }]
      },

      // --- The caged god (boss, Phase 1 of the D6 finale double boss) — the
      // Loom's true occupant, still bound, straining against Kredex's ritual.
      // No typeName of its own needed distinct from the ENEMIES entry. ---
      boundLash: {   // basic — Void (deliberately more Void than earlier dungeons: this
        // IS the thing the whole reserved damage type has been pointing at)
        name: "Bound Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 8, message: "lashes out with something that hasn't fully arrived yet at"
      },
      fracturingWill: {   // self-buff — Overclock (a crack widening in whatever was holding it)
        name: "Fracturing Will", enCost: 0, kind: "status", target: "self",
        message: "widens a crack in whatever was holding it, and it grows stronger",
        applies: [{ type: "overclock", magnitude: 6, duration: 3 }]
      },

      // --- Chthon, God of the Breach (boss, Phase 2 — the fused Kredex+
      // entity, the true final boss of the game, §5.4c). Psionic weakness
      // (see ENEMIES.chthon) is deliberate: hitting it with Psionic reaches
      // whatever's left of Kredex's mind still trapped inside. ---
      breachLash: {   // basic — Void
        name: "Breach Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 8, message: "reaches through a seam that shouldn't exist to strike at"
      },
      worldUnmaking: {   // heavy special — Void burst, partly armor-piercing
        name: "World Unmaking", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 24, pierce: 0.35,
        message: "opens a wound in the world itself and drags it across"
      },
      chorusOfBreach: {   // AoE status — Weaken
        name: "Chorus of the Breach", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "void", power: 0,
        message: "speaks with a chorus of voices that were never meant to share one throat, and the will of",
        applies: [{ type: "weaken", magnitude: 6, duration: 2 }]
      },
      kredexEcho: {   // status — Disable (something almost human fights for control for one instant)
        name: "Kredex's Echo", enCost: 0, kind: "attack", target: "enemy",
        damageType: "void", power: 0,
        message: "flickers with something almost human fighting for control, and the spasm that follows locks up",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      }
    };

    // Hero call-signs, assigned in pick order at deploy. Player-editable later.
    const HERO_NAMES = ["Casimir Zaab", "Vito", "Nat", "Tupac", "Jaime", "Nero"];

    // CLASS TEMPLATES — the five playable classes.
    // NOTE: Guard/taunt (Dread Knight) and debuffs (Netrunner, Mentalist)
    // need the status-effect engine, so those are added in Phase C. For now
    // each class fights with damage, AoE, and heals only.
    // `affinities`: forward-looking — current enemies only deal Kinetic, so the
    // non-Kinetic entries are dormant until enemies gain those damage types.
    const CLASSES = {
      merc: {
        className: "Merc", race: "Human (Augmented)", role: "Gun DPS · Aimed Shot + AoE",
        nature: "organic",
        baseStats: { hp: 120, en: 30, attack: 18, defense: 10, speed: 12 },
        skills: ["attack", "aimedShot", "fragGrenade"],
        // 2026-07-28 (§4.1a): an augmented human with no special armor.
        affinities: { physical: MILD_WEAK },
        growth: { hp: 12, en: 3, attack: 2, defense: 1, speed: 1 },   // gained per level
        limitBreak: "fullAuto"
      },
      dreadKnight: {
        className: "Dread Knight", race: "Human (Voidborn)", role: "Tank · Guard + heavy hits",
        nature: "organic",
        baseStats: { hp: 160, en: 20, attack: 16, defense: 16, speed: 8 },
        skills: ["attack", "crushingBlow", "guard"],
        // 2026-07-28 (§4.1a): the armored tank of the roster.
        affinities: { physical: RESIST },
        growth: { hp: 18, en: 2, attack: 2, defense: 2, speed: 0 },
        limitBreak: "unbreakableLine"
      },
      mechRunner: {
        className: "Mech Runner", race: "Human (Earth)", role: "Heavy weapons · Burn",
        nature: "organic",
        baseStats: { hp: 130, en: 25, attack: 22, defense: 11, speed: 9 },
        skills: ["attack", "railShot", "incendiaryRounds"],
        // 2026-07-28 (§4.1a): his own blast-resistant heavy-weapons gear.
        affinities: { thermal: RESIST },
        growth: { hp: 14, en: 2, attack: 3, defense: 1, speed: 1 },
        limitBreak: "orbitalStrike"
      },
      netrunner: {
        // 2026-07-28: renamed Netrunner -> Synth Medic (design doc §4.1a's
        // "Hacker/anti-machine" framing retired — see current changelog
        // entry). Internal key/object identity (`netrunner`, `hack`,
        // `heroNetrunner` sprite, save-game classKey) all kept stable —
        // this only changes the display className/role and her kit content.
        className: "Synth Medic", race: "Synthetic", role: "Support caster · Shock attacks + heals",
        nature: "synthetic",
        baseStats: { hp: 95, en: 35, attack: 12, defense: 8, speed: 13 },
        skills: ["attack", "hack", "empBlast", "naniteWeave"],
        affinities: { shock: WEAK, mind: RESIST },   // synthetic
        growth: { hp: 9, en: 4, attack: 2, defense: 1, speed: 1 },
        limitBreak: "totalHack"
      },
      mentalist: {
        // 2026-07-28: renamed Mentalist -> Psion (her own `role` already used
        // this word — promoting it to the class name drops "Mentalist"'s
        // real-world stage-performer connotation for free). Kit unchanged —
        // she already had damage + debuff + heal, unlike Synth Medic.
        className: "Psion", race: "Human (Earth)", role: "Mind caster · damage + debuff + heal",
        nature: "organic",
        baseStats: { hp: 90, en: 40, attack: 10, defense: 8, speed: 11 },
        skills: ["attack", "psiBurst", "mindSpike", "mend"],
        affinities: { shock: RESIST, mind: RESIST },             // organic, trained mind
        growth: { hp: 8, en: 5, attack: 1, defense: 1, speed: 1 },
        limitBreak: "mindsMercy"
      },
      // Saboteur (Sexias, Dungeon 6, §5.4c) — a Vossmark deserter fighting with
      // scavenged, corroded ex-Vossmark gear. Closes the one real dead-type
      // gap the affinity-system audit found: no prior hero could deal
      // Corrosive damage, despite two enemy factions building signature kits
      // around it. `corrosive: WEAK` is a deliberate ironic vulnerability —
      // his own patched-together gear is exactly as fragile to acid/chem as
      // what he deals out.
      saboteur: {
        className: "Saboteur", race: "Human (Vossmark Deserter)",
        role: "Corrosive specialist · armor-strip + AoE",
        nature: "organic",
        baseStats: { hp: 105, en: 30, attack: 17, defense: 9, speed: 13 },
        skills: ["attack", "corrodedEdge", "acidCharge"],
        affinities: { physical: WEAK },
        growth: { hp: 10, en: 3, attack: 2, defense: 1, speed: 1 },
        limitBreak: "acidPurge"
      }
    };

    // SKILL TREES (Phase E: Skill Points; node TYPES added 2026-07-28, design
    // doc §4.1a — "Unlock Pool + Tactic Slots"). Each class has a short tree
    // of distinct, NAMED skills (not "ranks" of one skill) unlocked by
    // spending Skill Points earned on level-up (see SP_PER_LEVEL). `prereq`
    // (a node key within the same tree) must be learned first; `cost` is the
    // SP price to LEARN it (Layer 1, permanent, unchanged mechanism).
    //
    // `type` (defaults to "active" if omitted — every node before this pass
    // was implicitly this type):
    //   "active"         — learning pushes `skillKey` onto hero.skills
    //                       forever, exactly as before. No `effect`/`slotCost`.
    //   "passive"        — a combat-modifier, always-on once SOCKETED
    //                       (Layer 2). Usually `effect.kind: "statMod"`; a
    //                       passive scoped to ONE specific skill (e.g.
    //                       Overcharged Rail, 2026-07-29 — a Rail-Shot-only
    //                       damage bonus) uses `ruleOverride` instead, same
    //                       as a keystone's bespoke rule below — `type`
    //                       governs the socket-budget/SP economy, not which
    //                       `effect.kind` a node is allowed to carry.
    //   "weaknessPayoff" — while socketed, a hero's own hit that lands on the
    //                       target's bucket-weakness (affinity mult >= WEAK)
    //                       grants a bonus. `effect.kind: "weaknessPayoff"`.
    //   "economy"        — a run-meta/economy bonus while socketed (EN cost,
    //                       Limit-gauge rate, Rest-heal amount, loot rarity).
    //                       `effect.kind` varies by subtype, see `effect.sub`.
    //   "keystone"        — one per branch, usually the capstone; rewrites a
    //                       RULE rather than a number. `effect.kind: "ruleOverride"`.
    // `slotCost` (1-3) — SP-Tree Layer 2's socket budget cost; every type
    // EXCEPT "active" has one (actives are never socketed — they're always
    // on once learned, exactly like today). A hero's total slot budget is
    // computed live, not stored — see `tacticSlotsForLevel` (state.js).
    // `effect` — everything except "active" nodes sets this; deliberately
    // generic shapes (not one-off `if (nodeKey === 'x')` engine conditionals)
    // read by shared helpers in engine.js/state.js, same convention as
    // SKILLS/STATUSES/ENEMIES already keeping engine code data-driven:
    //   statMod:        { kind:"statMod", stat, scope:{statusType?}, amount, mode:"flat"|"percent" }
    //   weaknessPayoff: { kind:"weaknessPayoff", bucket, bonus:"enRefund"|"limitGauge"|"forceStatus", amount, forceStatus?:{...} }
    //   ruleOverride:   { kind:"ruleOverride", rule:"limitBreakOverride"|"bonusApplies"|<bespoke>, ... }
    const SKILL_TREES = {
      // Merc (§4.1a, 2026-07-29): the design doc's own worked example, built
      // verbatim. Root kept; one branch is a bigger-pierce active capped by a
      // weakness-payoff passive (Physical hits that land on a weakness also
      // apply Weaken — reuses the existing "forceStatus" weaknessPayoff bonus
      // shape, never exercised by the first 3 trees), the other a flat
      // per-turn Limit trickle capped by the Overwatch keystone (a genuinely
      // new mechanic — a bespoke "overwatchCounter" rule, see engine.js).
      // 9 SP to fully clear (1+2+2+1+3); 5 slots if fully socketed (2+1+2) —
      // deliberately more than the campaign's level-ceiling budget affords,
      // so picking all 3 branch nodes is a real, not-quite-reachable choice.
      merc: [
        { key: "suppressingFire", skillKey: "suppressingFire", name: "Suppressing Fire", cost: 1, prereq: null, type: "active" },
        { key: "armorPiercingRounds", skillKey: "armorPiercingRounds", name: "Armor-Piercing Rounds", cost: 2, prereq: "suppressingFire", type: "active" },
        { key: "exploitWeakspot", name: "Exploit: Weakspot", cost: 2, prereq: "armorPiercingRounds", type: "weaknessPayoff", slotCost: 2,
          effect: { kind: "weaknessPayoff", bucket: "physical", bonus: "forceStatus",
            forceStatus: { type: "weaken", magnitude: 4, duration: 2 } } },
        { key: "adrenalineRush", name: "Adrenaline Rush", cost: 1, prereq: "suppressingFire", type: "passive", slotCost: 1,
          effect: { kind: "statMod", stat: "limitPerTurn", amount: 1, mode: "flat" } },
        { key: "overwatch", name: "Overwatch", cost: 3, prereq: "adrenalineRush", type: "keystone", slotCost: 2,
          effect: { kind: "ruleOverride", rule: "overwatchCounter" } }
      ],
      // Dread Knight (§4.1a, 2026-07-29): the design doc's own worked
      // example. Root kept; one branch finally builds the long-reserved
      // Taunt mechanic (§3.3) into a real aggro tool + Bloodfeed (the first
      // skill to use the `drain` field added in Slice 1), the other adds a
      // Sunder setup active capped by the Unbreaking keystone (bespoke
      // "guardReflect" rule — Guard now punishes attackers, not just
      // absorbs). 8 SP to fully clear (1+1+2+1+3); 4 slots if fully
      // socketed (2 alone from Unbreaking, since Taunt/Crack Armor/Bloodfeed
      // are all actives with no slot cost).
      dreadKnight: [
        { key: "cleave", skillKey: "cleave", name: "Cleave", cost: 1, prereq: null, type: "active" },
        { key: "taunt", skillKey: "taunt", name: "Taunt", cost: 1, prereq: "cleave", type: "active" },
        { key: "bloodfeed", skillKey: "bloodfeed", name: "Bloodfeed", cost: 2, prereq: "taunt", type: "active" },
        { key: "crackArmor", skillKey: "crackArmor", name: "Crack Armor", cost: 1, prereq: "cleave", type: "active" },
        { key: "unbreaking", name: "Unbreaking", cost: 3, prereq: "crackArmor", type: "keystone", slotCost: 2,
          effect: { kind: "ruleOverride", rule: "guardReflect", amount: 0.2 } }
      ],
      // Mech Runner (§4.1a, 2026-07-29): the design doc's own worked
      // example, renamed per the user's own idea. Root kept; one branch adds
      // a Thermal AoE (named "Rocket Barrage" like the design doc — coded as
      // `mechRocketBarrage` to avoid colliding with Security Mech's existing
      // `rocketBarrage` key, see the SKILLS comment above) capped by a Burn-
      // duration passive (reuses the existing "statusDuration" statMod shape
      // verbatim — zero new engine code for this one node), the other a
      // Rail Shot damage passive capped by the Meltdown keystone (bespoke
      // "burnDamageBonus" rule). 8 SP to fully clear (1+2+1+1+3); 4 slots if
      // fully socketed (1+1+2).
      mechRunner: [
        { key: "overclock", skillKey: "overclock", name: "Overclock", cost: 1, prereq: null, type: "active" },
        { key: "mechRocketBarrage", skillKey: "mechRocketBarrage", name: "Rocket Barrage", cost: 2, prereq: "overclock", type: "active" },
        { key: "accelerant", name: "Accelerant", cost: 1, prereq: "mechRocketBarrage", type: "passive", slotCost: 1,
          effect: { kind: "statMod", stat: "statusDuration", scope: { statusType: "burn" }, amount: 1, mode: "flat" } },
        { key: "overchargedRail", name: "Overcharged Rail", cost: 1, prereq: "overclock", type: "passive", slotCost: 1,
          effect: { kind: "ruleOverride", rule: "railShotBoost", amount: 0.2 } },
        { key: "meltdown", name: "Meltdown", cost: 3, prereq: "overchargedRail", type: "keystone", slotCost: 2,
          effect: { kind: "ruleOverride", rule: "burnDamageBonus", amount: 0.25 } }
      ],
      // Synth Medic (§4.1a, 2026-07-28): root kept, 2 branches — the
      // existing Overload Surge branch gains a weakness-payoff leaf; a new
      // branch adds her first AoE heal, capped by a bespoke keystone. 10 SP
      // to fully clear (1+2+2+2+3); 4 slots if fully socketed (2+2).
      netrunner: [
        { key: "systemShock", skillKey: "systemShock", name: "Neural Jolt", cost: 1, prereq: null, type: "active" },
        { key: "firewallBreach", skillKey: "firewallBreach", name: "Overload Surge", cost: 2, prereq: "systemShock", type: "active" },
        { key: "cascadeFailure", name: "Cascade Failure", cost: 2, prereq: "firewallBreach", type: "weaknessPayoff", slotCost: 2,
          effect: { kind: "weaknessPayoff", bucket: "shock", bonus: "enRefund", amount: 4 } },
        { key: "repairSwarm", skillKey: "repairSwarm", name: "Repair Swarm", cost: 2, prereq: "systemShock", type: "active" },
        { key: "adaptiveNanites", name: "Adaptive Nanites", cost: 3, prereq: "repairSwarm", type: "keystone", slotCost: 2,
          effect: { kind: "ruleOverride", rule: "healCleansesDisable" } }
      ],
      // Psion (§4.1a, 2026-07-28): same shape as Synth Medic's tree above —
      // existing Cerebral Overload branch gains a weakness-payoff leaf; a new
      // branch adds a heal+shield hybrid, capped by a bonusApplies keystone.
      // 10 SP to fully clear, 4 slots if fully socketed.
      mentalist: [
        { key: "terror", skillKey: "terror", name: "Terror", cost: 1, prereq: null, type: "active" },
        { key: "cerebralOverload", skillKey: "cerebralOverload", name: "Cerebral Overload", cost: 2, prereq: "terror", type: "active" },
        { key: "shatteredWill", name: "Shattered Will", cost: 2, prereq: "cerebralOverload", type: "weaknessPayoff", slotCost: 2,
          effect: { kind: "weaknessPayoff", bucket: "mind", bonus: "limitGauge", amount: 8 } },
        { key: "calmMind", skillKey: "calmMind", name: "Calm Mind", cost: 2, prereq: "terror", type: "active" },
        { key: "mindscape", name: "Mindscape", cost: 3, prereq: "calmMind", type: "keystone", slotCost: 2,
          effect: { kind: "ruleOverride", rule: "bonusApplies", skillKey: "terror",
            applies: { type: "weaken", magnitude: 4, duration: 2 } } }
      ],
      // Saboteur (§4.1a, 2026-07-28): first class to get a real branching
      // tree — root kept, one branch adds an active + a duration passive,
      // the other an economy node capped by a keystone. 8 SP to fully clear
      // (1+1+2+1+3), matching the design doc's Merc worked example's band;
      // 5 slots if fully socketed (2+1+2, all non-"active" nodes).
      saboteur: [
        { key: "corrosionField", skillKey: "corrosionField", name: "Corrosion Field", cost: 1, prereq: null, type: "active" },
        { key: "corrodingGrip", skillKey: "corrodingGrip", name: "Corroding Grip", cost: 1, prereq: "corrosionField", type: "active" },
        { key: "necroticPayload", name: "Necrotic Payload", cost: 2, prereq: "corrodingGrip", type: "passive", slotCost: 2,
          effect: { kind: "statMod", stat: "statusDuration", scope: { statusType: "sunder" }, amount: 1, mode: "flat" } },
        { key: "scavengersIngenuity", name: "Scavenger's Ingenuity", cost: 1, prereq: "corrosionField", type: "economy", slotCost: 1,
          effect: { kind: "statMod", stat: "lootRarity", amount: 8, mode: "flat" } },
        { key: "corrosiveEndgame", name: "Corrosive Endgame", cost: 3, prereq: "scavengersIngenuity", type: "keystone", slotCost: 2,
          effect: { kind: "ruleOverride", rule: "limitBreakOverride", skillKey: "acidPurgePlus" } }
      ]
    };

    // EQUIPMENT (character-development layer). Six slots, classic RPG paperdoll.
    // Item shape: { name, slot, statBonus: {hp,en,attack,defense,speed}, classRestrict?,
    //               grantsSkill?, spriteKey }
    //   classRestrict — a classKey; only that class may equip it (used on Arms + Ring so
    //                   far, matching their "class-flavored" identity).
    //   grantsSkill   — (Arms items only) a skillKey added to the hero's kit WHILE EQUIPPED.
    //                   Unequip removes it again — a swappable tactical loadout choice,
    //                   distinct from the SKILL_TREES' permanent SP-bought unlocks.
    //   spriteKey     — unused today; a placeholder so items don't need retrofitting once
    //                   the Phase I graphics pass adds a paperdoll.
    const EQUIPMENT_SLOTS = ["head", "body", "legs", "arms", "weapon", "ring"];

    const ITEMS = {
      // --- Head ---
      riotHelm:  { name: "Riot Helm",  slot: "head", statBonus: { hp: 10 }, spriteKey: null },
      visorHud:  { name: "Visor HUD",  slot: "head", statBonus: { en: 5 },  spriteKey: null },
      // --- Body ---
      kevlarMesh: { name: "Kevlar Mesh", slot: "body", statBonus: { defense: 4 },          spriteKey: null },
      voidSuit:   { name: "Void Suit",   slot: "body", statBonus: { hp: 15, defense: 2 },   spriteKey: null },
      // --- Legs ---
      sprintGreaves: { name: "Sprint Greaves", slot: "legs", statBonus: { speed: 3 },   spriteKey: null },
      bracePlates:   { name: "Brace Plates",   slot: "legs", statBonus: { defense: 3 }, spriteKey: null },
      // --- Weapon ---
      tacticalSidearm: { name: "Tactical Sidearm", slot: "weapon", statBonus: { attack: 4 },          spriteKey: null },
      overchargedCore: { name: "Overcharged Core", slot: "weapon", statBonus: { attack: 2, en: 5 },   spriteKey: null },

      // --- Arms (class-restricted; grants a skill only while equipped) ---
      wristRocketRig:    { name: "Wrist Rocket Rig",    slot: "arms", classRestrict: "merc",       statBonus: {}, grantsSkill: "wristRocket",   spriteKey: null },
      powerFistGauntlet: { name: "Power Fist Gauntlet",  slot: "arms", classRestrict: "dreadKnight", statBonus: {}, grantsSkill: "powerFist",     spriteKey: null },
      shoulderRocketPod: { name: "Shoulder Rocket Pod",  slot: "arms", classRestrict: "mechRunner",  statBonus: {}, grantsSkill: "shoulderRocket", spriteKey: null },
      terminalProbeRig:  { name: "Nanite Lance Rig",   slot: "arms", classRestrict: "netrunner",   statBonus: {}, grantsSkill: "terminalProbe",  spriteKey: null },
      psiConduitGlove:   { name: "Psi Conduit Glove",    slot: "arms", classRestrict: "mentalist",   statBonus: {}, grantsSkill: "psiConduit",     spriteKey: null },

      // --- Ring (class-restricted, stat only) ---
      sidearmCharm: { name: "Sidearm Charm",  slot: "ring", classRestrict: "merc",       statBonus: { attack: 2 },          spriteKey: null },
      bulwarkSigil: { name: "Bulwark Sigil",  slot: "ring", classRestrict: "dreadKnight", statBonus: { defense: 2, hp: 5 }, spriteKey: null },
      coolingCore:  { name: "Cooling Core",   slot: "ring", classRestrict: "mechRunner",  statBonus: { en: 5 },              spriteKey: null },
      neuralAmp:    { name: "Neural Amplifier", slot: "ring", classRestrict: "netrunner", statBonus: { en: 4, speed: 1 },   spriteKey: null },
      focusCrystal: { name: "Focus Crystal",  slot: "ring", classRestrict: "mentalist",   statBonus: { en: 5, attack: 1 },  spriteKey: null },

      // --- Rare tier (§5.4 loot variance) — universal slots only (no rare
      // Arms/Ring, avoids needing 5 class variants per item), meaningfully
      // bigger bonuses (~1.5-2x a common item) so pulling one feels like a
      // jackpot. Every item without a `rarity` field defaults to "common"
      // (see pickWeightedLootItem) — only these four are tagged explicitly.
      neuralCrown:    { name: "Neural Crown",     slot: "head",   rarity: "rare", statBonus: { hp: 8, en: 10 },        spriteKey: null },
      bioweaveArmor:  { name: "Bioweave Armor",   slot: "body",   rarity: "rare", statBonus: { hp: 20, defense: 5 },   spriteKey: null },
      kineticBoosters:{ name: "Kinetic Boosters", slot: "legs",   rarity: "rare", statBonus: { speed: 5, defense: 2 }, spriteKey: null },
      precisionRail:  { name: "Precision Rail",   slot: "weapon", rarity: "rare", statBonus: { attack: 6, en: 4 },     spriteKey: null }
    };

    // Loot rarity weights (§5.4). "Heavy" odds are used for Elite-tier combat
    // wins and Unknown-node loot rolls — pushing into danger has a visibly
    // bigger jackpot than the safe, guaranteed map Loot node (normal odds).
    const LOOT_RARITY_WEIGHTS = { common: 85, rare: 15 };
    const LOOT_RARITY_WEIGHTS_HEAVY = { common: 55, rare: 45 };

    // ENEMY TEMPLATES.
    const ENEMIES = {
      // ---------- FODDER (weak, swarm — early nodes) ----------
      // Spider Drone — light synthetic; hits harder than v1, modest HP so AoE clears swarms.
      spiderDrone: {
        typeName: "Spider Drone", role: "Vossmark security bot",
        nature: "synthetic", tier: "fodder",
        baseStats: { hp: 40, en: 0, attack: 15, defense: 7, speed: 11 },
        skills: ["attack"],
        affinities: { shock: WEAK, mind: HARD_RESIST }
      },
      // Hull Roach — organic bug fodder; swarms; burn/psi counter it.
      hullRoach: {
        typeName: "Hull Roach", role: "hull vermin",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 24, en: 0, attack: 12, defense: 4, speed: 12 },
        skills: ["attack"],
        affinities: { thermal: WEAK, mind: WEAK }
      },

      // ---------- STANDARD (one gimmick each — mid nodes) ----------
      // Arc Sentinel — synthetic Shock unit; can Disable a hero. Its Shock hurts the Netrunner.
      arcSentinel: {
        typeName: "Arc Sentinel", role: "Vossmark arc drone",
        nature: "synthetic", tier: "standard",
        baseStats: { hp: 50, en: 0, attack: 14, defense: 9, speed: 12 },
        skills: ["arcBolt", "arcDischarge"],
        // shock is NEUTRAL (not resisted) as of 2026-07-24 — an EMP hitting a
        // drone shouldn't feel bad; Cyber/Hack stays its best (weak) counter.
        affinities: { shock: WEAK, mind: HARD_RESIST }
      },
      // Vossmark Grunt (was "Tiangong Pvt.", 2026-07-25) — organic bruiser; Suppressing Fire applies Weaken.
      vossmarkGrunt: {
        typeName: "Vossmark Grunt", role: "trooper",
        nature: "organic", tier: "standard",
        baseStats: { hp: 60, en: 0, attack: 16, defense: 8, speed: 10 },
        skills: ["attack", "suppressingFire"],
        affinities: { mind: MILD_WEAK, shock: RESIST }
      },

      // ---------- ELITE (mini-boss — late nodes only) ----------
      // Security Mech — armored: shrugs off Kinetic, but Shock/Cyber wreck it.
      securityMech: {
        typeName: "Security Mech", role: "Vossmark heavy unit",
        nature: "synthetic", tier: "elite",
        baseStats: { hp: 120, en: 0, attack: 17, defense: 15, speed: 7 },
        skills: ["attack", "rocketBarrage"],
        affinities: { physical: RESIST, shock: DOUBLE_WEAK, mind: HARD_RESIST }  // 2.0 = doubly weak to hacking
      },
      // Vossmark Officer (was "Tiangong Lt.", originally "Squad Leader") —
      // mini-boss: Command Strike + Mark Target (Sunder) + heal.
      vossmarkOfficer: {
        typeName: "Vossmark Officer", role: "field officer",
        nature: "organic", tier: "elite",
        baseStats: { hp: 100, en: 0, attack: 16, defense: 11, speed: 12 },
        skills: ["attack", "commandStrike", "markTarget", "repairProtocol"],
        affinities: { mind: MILD_WEAK, shock: RESIST }
      },

      // ---------- TALOS SYSTEMS (Phase G, §5.1) ----------
      // Deliberately the opposite of Vossmark: organic, bio-augmented, leaning
      // Corrosive/Thermal, uniformly weak to Psionic — the Mentalist's rival
      // faction the way the Netrunner is Vossmark's.
      // Talos Wraith — fast organic fodder, swarms.
      talosWraith: {
        typeName: "Talos Wraith", role: "Talos infiltrator",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 22, en: 0, attack: 13, defense: 4, speed: 14 },
        skills: ["venomClaws"],
        affinities: { mind: WEAK, thermal: WEAK }
      },
      // Talos Phantom — organic stealth striker; Phantom Strike applies Sunder.
      talosPhantom: {
        typeName: "Talos Phantom", role: "Talos stealth operative",
        nature: "organic", tier: "standard",
        baseStats: { hp: 55, en: 0, attack: 15, defense: 8, speed: 13 },
        skills: ["phantomBlade", "phantomStrike"],
        affinities: { mind: WEAK, physical: RESIST }
      },
      // Talos Vanguard — heavy organic frontliner; Plasma Cleave is a big armor-piercing burst.
      talosVanguard: {
        typeName: "Talos Vanguard", role: "Talos heavy operative",
        nature: "organic", tier: "elite",
        baseStats: { hp: 110, en: 0, attack: 18, defense: 12, speed: 9 },
        skills: ["vanguardEdge", "plasmaCleave"],
        affinities: { mind: DOUBLE_WEAK, physical: RESIST }  // 2.0 = doubly weak to Psionic
      },

      // ---------- DUNGEON 4 "SPECIMEN WING" (§5.4a) ----------
      // Bio-horror side of Talos — the faction's actual "merge with flesh"
      // identity, distinct from the Security Wing's trained-operative feel
      // above. Splice Husk (fodder) -> Bio-Tank (standard, Regen) ->
      // Chimera Specimen (elite, doubly weak Psionic — the hive/precursor
      // lineage echo, §9.2/§9.3, same design language as Erebus's Shaman).
      spliceHusk: {
        typeName: "Splice Husk", role: "failed Talos specimen",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 22, en: 0, attack: 11, defense: 3, speed: 10 },
        skills: ["witheredGrasp"],
        affinities: { mind: WEAK }
      },
      bioTank: {
        typeName: "Bio-Tank", role: "Talos containment specimen",
        nature: "organic", tier: "standard",
        baseStats: { hp: 62, en: 0, attack: 15, defense: 9, speed: 7 },
        skills: ["fusedSlam", "boundedGrowth"],
        affinities: { mind: WEAK, physical: RESIST }
      },
      chimeraSpecimen: {
        typeName: "Chimera Specimen", role: "Talos chimeric specimen",
        nature: "organic", tier: "elite",
        // Softened 2026-07-24 (hp 100->85, chimeraRend 18->14, unmakingHowl
        // weaken 6->4) — isolated single-fight sim was already fine (100%
        // smart win), but a full-chain regression showed this gate failing
        // ~58% of runs vs. the Security Wing's equivalent (Vanguard) at ~20%,
        // because it's reached already worn down from d3p, not fresh. See
        // the gameplay-direction memory for the full diagnosis.
        baseStats: { hp: 85, en: 0, attack: 17, defense: 11, speed: 10 },
        skills: ["chimeraRend", "unmakingHowl"],
        affinities: { mind: DOUBLE_WEAK, physical: RESIST }
      },

      // ---------- BOSS (Phase G, §5.1 — this dungeon's finale) ----------
      // The Warden — a corrupted Vossmark station-defense AI core. Same
      // affinity profile as Security Mech (a proven counter-able tank: resist
      // Kinetic, weak Shock, doubly weak Cyber via the Netrunner's Hack) but
      // scaled well past elite, with a wider single-phase kit.
      warden: {
        typeName: "The Warden", role: "Penal Colony AI",
        nature: "synthetic", tier: "boss",
        baseStats: { hp: 150, en: 0, attack: 18, defense: 14, speed: 9 },
        // No self-heal: sim testing showed a self-sustaining boss on top of
        // hero EN-starvation (no in-combat EN regen) produced 50+ round
        // attrition slogs that were unwinnable rather than hard. A single-phase
        // v1 boss doesn't need it to be a real threat; emergencyRepair stays
        // defined in SKILLS if a later multi-phase pass wants it back.
        skills: ["turretVolley", "overloadCoils", "corePurge", "lockdownProtocol"],
        // NOT Kinetic-resistant, unlike Security Mech (deliberate, found via sim):
        // Kinetic is every class's free EN-less basic Attack, and by the back
        // half of a long boss fight most heroes are EN-starved and reduced to
        // it — resisting the one damage type everyone can always afford turned
        // the fight into an unwinnable attrition spiral. Cyber/Shock remain the
        // reward for a squad that brings (and manages EN for) the counter.
        affinities: { shock: DOUBLE_WEAK, mind: HARD_RESIST },
        // The Warden fights with its station: it opens flanked by hardware and
        // calls a second wave of sentinels + a repair drone at half HP (§1d).
        reinforceAt: 0.5,
        reinforceWave: [{ key: "arcSentinel", count: 1 }, { key: "repairDrone", count: 1 }],
        reinforceMessage: "The Warden seals the deck. More security units drop in!",
        // Enrage (NEW 2026-07-29, §11/§12 difficulty pass) — same 50% HP
        // threshold as reinforceAt, deliberately: adds arrive AND the boss
        // enrages on the same hit, reading as one clear "phase 2 begins"
        // moment rather than two smaller staggered beats.
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "The Warden's core temperature spikes past every safety limit — it stops holding back."
      },
      // ---------- WARDEN BOSS-SUPPORT ADDS (2026-07-24) ----------
      // Sentry Turret — slow, armored, high-damage kinetic emplacement. Punishes
      // ignoring it; can't be out-sped. Synthetic → answered by Cyber/Hack.
      securityTurret: {
        typeName: "Sentry Turret", role: "Station defense emplacement",
        nature: "synthetic", tier: "standard",
        // Glass cannon: hits hard + slow, but soft enough to focus down — the
        // intended counterplay (don't ignore it, but you CAN kill it fast).
        baseStats: { hp: 32, en: 0, attack: 12, defense: 6, speed: 3 },
        skills: ["sentryShot"],
        affinities: { physical: RESIST, shock: WEAK, mind: HARD_RESIST }
      },
      // Repair Drone — squishy heal source. A killable weak point: leave it up
      // and it keeps the Warden alive; the threat-AI also flags it as a priority.
      repairDrone: {
        typeName: "Repair Drone", role: "Station maintenance unit",
        nature: "synthetic", tier: "fodder",
        baseStats: { hp: 22, en: 0, attack: 8, defense: 6, speed: 13 },
        skills: ["attack", "nanoRepair"],
        affinities: { shock: WEAK, mind: HARD_RESIST }
      },

      // ---------- KHARON'S REACH (Phase H3 prologue, §5.2) ----------
      // Quota Enforcer — organic fodder; rank-and-file Vossmark enforcers.
      quotaEnforcer: {
        typeName: "Quota Enforcer", role: "Kharon's Reach enforcer",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 32, en: 0, attack: 10, defense: 5, speed: 9 },
        skills: ["attack", "batonStrike"],
        affinities: { mind: MILD_WEAK }   // consistent with other Vossmark organics
      },
      // ---------- KRELL BOSS-SUPPORT ADD (2026-07-24) ----------
      // Riot Enforcer — tanky organic; braces (self-Guard) and stuns heroes with
      // a shock baton. The heavier cousin of the Quota Enforcer (guardTrooper shape
      // recolored, per the planned Riot Enforcer tier-variant).
      riotEnforcer: {
        typeName: "Riot Enforcer", role: "Kharon's Reach riot squad",
        nature: "organic", tier: "standard",
        // Tuned to sit at Voraxx's side in the L1 duo opener without walling a
        // brand-new player (naive ~75% win / smart ~71% HP) — a beefier guard
        // that braces (self-Guard) and stuns, not a mini-boss.
        baseStats: { hp: 38, en: 0, attack: 10, defense: 8, speed: 8 },
        skills: ["attack", "stunBaton", "braceUp"],
        affinities: { mind: MILD_WEAK }
      },
      // Overseer Voraxx — the colony's chief overseer, hand-tuned finale for a
      // level-1/2 DUO (not derived from Sector 1's depth/level-scaling curve,
      // same "unique fight, tuned directly" treatment as the Warden).
      voraxx: {
        typeName: "Overseer Voraxx", role: "Kharon's Reach chief overseer",
        nature: "organic", tier: "boss",
        baseStats: { hp: 140, en: 0, attack: 20, defense: 10, speed: 10 },
        skills: ["attack", "ironDiscipline", "overseersLash", "overseersCrackdown"],
        affinities: { mind: MILD_WEAK },
        // Voraxx's "add" is a Riot Enforcer at his side from the start (see the
        // p4 encounter) — no mid-fight wave, keeping the L1 duo opener forgiving.
        // Enrage (NEW 2026-07-29, §11/§12 difficulty pass) — no reinforceAt
        // on Voraxx, so this is his only mid-fight escalation beat.
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "Voraxx abandons discipline entirely and just starts swinging harder."
      },

      // ---------- SITE EREBUS (Dungeon 3, planned §5.3) ----------
      // A native hive, not a Vossmark creation — the annex here studied and
      // tried to control it, not build it. Uniformly weak Psionic/Thermal
      // (fire + hive-mind disruption are the hive's classic counters); a mostly
      // Corrosive melee kit with the Shaman/Broodmarshal dealing Psionic
      // instead, deliberately echoing Talos's affinity profile (§5.1) ahead of
      // ever reaching Talos territory.
      erebusRoach: {
        typeName: "Erebus Roach", role: "hive swarmer",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 26, en: 0, attack: 13, defense: 4, speed: 13 },
        skills: ["chitinBite"],
        affinities: { mind: WEAK, thermal: WEAK }
      },
      erebusWarrior: {
        typeName: "Erebus Warrior", role: "hive bruiser",
        nature: "organic", tier: "standard",
        baseStats: { hp: 58, en: 0, attack: 16, defense: 8, speed: 11 },
        skills: ["mandibleStrike", "carapaceRend"],
        affinities: { mind: WEAK, thermal: WEAK }
      },
      // Shaman — the hive-mind caste. Squishy caster body (weak Kinetic, a
      // "just hit it" glass cannon), hard-resists Psionic (its own domain).
      // Hive Shriek's Confuse is organic-only (§ STATUSES) — Nyx, the
      // party's synthetic Netrunner, is immune by construction.
      erebusShaman: {
        typeName: "Erebus Shaman", role: "hive-mind caste",
        nature: "organic", tier: "standard",
        baseStats: { hp: 45, en: 0, attack: 14, defense: 6, speed: 11 },
        skills: ["psiLash", "hiveShriek"],
        affinities: { physical: WEAK, mind: HARD_RESIST }
      },
      // Armored Warrior — the "counter-pick" fight, same design language as
      // the Vossmark Security Mech: resists the one damage type every class
      // gets for free (Kinetic), so the squad has to bring Thermal/Psionic.
      erebusArmoredWarrior: {
        typeName: "Erebus Armored Warrior", role: "hive heavy",
        nature: "organic", tier: "elite",
        baseStats: { hp: 115, en: 0, attack: 18, defense: 13, speed: 8 },
        skills: ["clawSlash", "crushingPincer"],
        affinities: { physical: RESIST, mind: WEAK, thermal: WEAK }
      },
      // The Broodmarshal — leadership caste, wears a fused Vossmark control
      // rig that never worked (§5.3). Hard-resists Psionic (commands it,
      // immune to it, same "resists its own element" shape as Arc Sentinel);
      // deliberately NOT Kinetic-resistant (the Warden lesson, §9: heroes go
      // EN-starved late in a long fight and fall back to Kinetic, so a boss
      // that resists it turns the back half into an unwinnable slog).
      // reinforceAt/reinforceWave: generic boss add-spawn hook (new engine
      // capability, §4 F) — at 50% HP, once, calls in a fresh wave.
      broodmarshal: {
        typeName: "The Broodmarshal", role: "hive leadership caste",
        nature: "organic", tier: "boss",
        baseStats: { hp: 160, en: 0, attack: 17, defense: 12, speed: 9 },
        skills: ["marshalClaws", "hiveCommand", "marshalRend", "psychicDominion"],
        affinities: { thermal: WEAK, mind: HARD_RESIST },
        reinforceAt: 0.5,
        // Trimmed to 2 roaches (was +1 warrior): the global HP/damage knobs made
        // the old wave far deadlier than when it was first tuned pre-knobs.
        reinforceWave: [{ key: "erebusRoach", count: 2 }],
        reinforceMessage: "The Broodmarshal calls the hive! Reinforcements erupt from the tunnels!",
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "The Broodmarshal's control rig sparks and fails — pure hive instinct takes over."
      },

      // ---------- DUNGEON 4 BOSS (§5.4a, 2026-07-24) ----------
      // Proteus — a half-transcended Talos bio-executive, mid-merge with
      // harvested precursor/hive biology (the shapeshifting Greek sea-god
      // name continues the Kharon/Erebus underworld naming vein, and fits a
      // figure defined by literal metamorphosis). No self-heal (same lesson
      // as the Warden, tech-ref §9 — a boss self-heal + EN-starved late
      // rounds produces an attrition spiral, not a hard-but-fair fight); the
      // Regen tension instead lives on his Bio-Tank reinforcement.
      // Stats/wave are a first-pass guess — sim-tune before locking, same
      // discipline as every prior boss.
      proteus: {
        typeName: "Proteus", role: "Talos bio-executive, mid-transcendence",
        nature: "organic", tier: "boss",
        baseStats: { hp: 150, en: 0, attack: 19, defense: 12, speed: 10 },
        skills: ["proteusLash", "proteusBloom", "proteusUnraveling"],
        affinities: { mind: DOUBLE_WEAK, physical: RESIST },
        reinforceAt: 0.5,
        reinforceWave: [{ key: "bioTank", count: 1 }],
        reinforceMessage: "Proteus calls out, and the containment ward's other specimens answer.",
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "Proteus's half-finished transformation lurches forward, mid-fight, without his consent."
      },

      // ---------- HELIOS STATION / DUNGEON 5 (§5.4b, 2026-07-24) ----------
      // Void horrors, nature: "void" (a new tag — falls back to the generic
      // organic-colored blob palette until real sprites exist, and is a free
      // side effect immune to Confuse, requiresNature:"organic": these
      // things don't have minds a mundane fear tactic can grab onto).
      // Family affinities: weak Thermal, resist Kinetic/Psionic (see the
      // SKILLS comment above this roster for the full design rationale).
      poltergeist: {
        typeName: "Void Poltergeist", role: "restless Helios echo",
        nature: "void", tier: "fodder",
        baseStats: { hp: 20, en: 0, attack: 12, defense: 3, speed: 15 },
        skills: ["restlessGrasp"],
        affinities: { thermal: WEAK, physical: RESIST }
      },
      shade: {
        typeName: "Void Shade", role: "Helios wraith",
        nature: "void", tier: "standard",
        baseStats: { hp: 48, en: 0, attack: 15, defense: 7, speed: 13 },
        skills: ["umbralCut", "witherTouch"],
        affinities: { thermal: WEAK, physical: RESIST }
      },
      terror: {
        typeName: "Void Terror", role: "Helios dread-caste",
        nature: "void", tier: "standard",
        baseStats: { hp: 50, en: 0, attack: 13, defense: 7, speed: 10 },
        skills: ["creepingDread", "hollowScream"],
        affinities: { thermal: WEAK, physical: RESIST, mind: RESIST }
      },
      // Void Horror — the counter-pick elite, doubly weak Thermal (the
      // designated "bring the Mech Runner" fight, same shape as Security
      // Mech/Vanguard/Chimera before it). Its special previews Void damage.
      voidHorror: {
        typeName: "Void Horror", role: "Helios abyssal",
        nature: "void", tier: "elite",
        baseStats: { hp: 95, en: 0, attack: 18, defense: 11, speed: 9 },
        skills: ["rendingClaw", "consumeLight"],
        affinities: { thermal: DOUBLE_WEAK, physical: RESIST }
      },
      demon: {
        typeName: "Void Demon", role: "Helios burning horror",
        nature: "void", tier: "elite",
        baseStats: { hp: 105, en: 0, attack: 17, defense: 12, speed: 9 },
        skills: ["clawRake", "hellbrand"],
        affinities: { thermal: WEAK, physical: RESIST }
      },
      devil: {
        typeName: "Void Devil", role: "Helios tormentor caste",
        nature: "void", tier: "elite",
        baseStats: { hp: 100, en: 0, attack: 15, defense: 12, speed: 11 },
        skills: ["tormentLash", "damnationDecree"],
        affinities: { thermal: WEAK, mind: RESIST }
      },
      // ---------- DUNGEON 5 DOUBLE BOSS (§5.4b) ----------
      // Void Soul Eater — the gatekeeper, fought first, no rest before or
      // after. No self-heal, no reinforceWave (the Warden/Proteus lesson —
      // a self-sustaining boss stacked on EN-starved late rounds produces an
      // unwinnable slog, not a hard fight); its whole job is hitting once,
      // hard, and softening the party's Weaken resistance before the Sun
      // God, not grinding them down over a long fight of its own.
      voidSoulEater: {
        typeName: "Void Soul Eater", role: "Helios's gatekeeper",
        nature: "void", tier: "boss",
        baseStats: { hp: 145, en: 0, attack: 19, defense: 12, speed: 10 },
        skills: ["soulRend", "devouringMaw", "witheringGaze"],
        affinities: { thermal: WEAK, physical: RESIST },
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "The Void Soul Eater tastes real hunger for the first time and stops toying with you."
      },
      // Sol's Acolyte — the Sun God's reinforceWave add (2026-07-25): a
      // "reskinned Void" in the literal sense the name implies — a station
      // pilgrim/worker consumed by devotion to the corrupted regulator,
      // still moves with human momentum but none of the will. Modest stats
      // (a fanatic swarm, not a second elite) — the threat is numbers +
      // Overclock stacking, not raw individual damage.
      solAcolyte: {
        typeName: "Sol's Acolyte", role: "Helios cult-thrall",
        nature: "void", tier: "standard",
        baseStats: { hp: 40, en: 0, attack: 12, defense: 6, speed: 12 },
        skills: ["fanaticStrike", "devotedChant"],
        affinities: { thermal: WEAK, physical: RESIST }
      },
      // The Sun God — Helios's own regulator core, corrupted; secretly a
      // machine wearing a god's face, not a literal deity (§5.4b). Fought
      // immediately after the Soul Eater with NO rest node between the two
      // — the double boss's real teeth is the attrition, not either fight
      // alone. nature: "synthetic" (not "void") is deliberate: it makes
      // Confuse fail on it for the right in-fiction reason (it was never
      // organic), and makes Hack's Cyber weakness below land as the
      // mechanical/narrative payoff of the "it's a machine" reveal —
      // closing the loop back to the Netrunner, the original Vossmark
      // specialist.
      // REBALANCED 2026-07-25 (smart-autoplay sim pass, see the dungeon5
      // node comment for the full readout): the 2026-07-25 buff to
      // hp155/atk21/def14 + a 2-Acolyte reinforceWave was tuned against a
      // hypothetical fresh level-7/8 party — a level that never actually
      // occurs (see bossSoul/bossSun node comments — the real chain-arrival
      // level is ~2). Against the REAL arriving party (worn down from
      // Void Soul Eater, no rest), those numbers wiped the party outright.
      // Corrected down to hp100/atk15/def10 (roughly an elite-tier
      // baseline, appropriate once the level tag is fixed too) + trimmed
      // the reinforceWave to 1 Acolyte (keeps the "chorus answers" beat
      // without doubling the escort on an already-thin party). THIS is now
      // the locked number, not the 2026-07-25 buff it replaces.
      sunGod: {
        typeName: "The Sun God", role: "Helios regulator core, corrupted",
        nature: "synthetic", tier: "boss",
        baseStats: { hp: 100, en: 0, attack: 15, defense: 10, speed: 11 },
        skills: ["solarLash", "coronalFlare", "unmakingPulse", "eclipseProtocol"],
        affinities: { shock: DOUBLE_WEAK, thermal: HARD_RESIST },
        reinforceAt: 0.5,
        reinforceWave: [{ key: "solAcolyte", count: 1 }],
        reinforceMessage: "The Sun God's voice splits into a chorus. Sol's Acolytes answer the call.",
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "The Sun God's corrupted core overloads past its own limiters."
      },

      // ---------- DUNGEON 6 "THE CRADLE" (§5.4c, 2026-07-25) ----------
      // Phthora, the Fleshspring — Talos's actual leader and origin-point,
      // NOT a reuse of Proteus (D4's boss, already dead — Proteus paid off
      // §9.4's "Talos figure" beat there). Races Vossmark to the Loom and
      // attempts to complete the lineage's founding transcendence at the
      // source — fails, stopped mid-transformation. The mirror-image ending
      // to Kredex/Chthon below: Talos's doctrine (merge on purpose) fails
      // outright, where Vossmark's doctrine (control it) produces the worst
      // possible outcome. No self-heal (same lesson as every prior boss —
      // Warden/Proteus/Void Soul Eater — a self-sustaining boss on
      // EN-starved late rounds is an attrition slog, not a hard fight).
      // Stats are a first-pass guess — sim-tune before locking, same
      // discipline as every prior boss.
      phthora: {
        typeName: "Phthora, the Fleshspring", role: "Talos's origin, mid-failed-transcendence",
        nature: "organic", tier: "boss",
        // Base stats corrected down (2026-07-25 baseline sim pass) — the
        // original 210/24/15 guess was tuned for a much later encounter
        // than the real chain-arrival level (~4), the same class of error
        // the Sun God fix (D5) already caught once. Not a final locked
        // number — deep balance tuning is its own later roadmap phase.
        baseStats: { hp: 100, en: 0, attack: 14, defense: 9, speed: 11 },
        skills: ["fleshspringGrasp", "fleshspringRupture", "originUnbinding"],
        affinities: { mind: DOUBLE_WEAK, physical: RESIST },
        reinforceAt: 0.5,
        reinforceWave: [{ key: "chimeraSpecimen", count: 1 }],
        reinforceMessage: "Phthora's ritual falters, and the lineage answers anyway. A Chimera " +
          "Specimen claws free of the wreckage to finish what he can't.",
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "Phthora's ritual accelerates past the point of any control at all."
      },
      // The caged god (double-boss Phase 1, §5.4c) — the Loom's true
      // occupant, still bound, straining against Kredex's ritual as it
      // fails. No self-heal/reinforceWave — same "gatekeeper hits, doesn't
      // grind" shape as Void Soul Eater before it; its whole job is setting
      // up the fusion into Chthon, not winning a long fight of its own.
      // nature: "void" — it was never organic, and never will be, even
      // wearing a human's body in Phase 2.
      cagedGod: {
        typeName: "The Caged God", role: "the Loom's true occupant, still bound",
        nature: "void", tier: "boss",
        baseStats: { hp: 140, en: 0, attack: 20, defense: 13, speed: 10 },
        skills: ["boundLash", "fracturingWill"],
        affinities: { thermal: WEAK, physical: RESIST },
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "Whatever restraints were left finally give — the Caged God strains free of even itself."
      },
      // Chthon, God of the Breach (double-boss Phase 2 — the fused
      // Kredex+entity, the TRUE final boss of the game, §5.4c). Fought
      // immediately after the caged god with NO rest — the fusion happens
      // between phases, not off-screen. Psionic weakness is deliberate:
      // hitting it with Psionic reaches whatever's left of Kredex's own mind
      // still trapped inside — a final callback giving the Mentalist (every
      // organic faction's designated counter all game) one last, huge
      // finale moment, the same way Netrunner got the Sun God's Cyber 2.0.
      // Defeating Chthon is the literal, on-screen cause of the Helios
      // wormhole finally tearing open for real (see engine.js's ending
      // sequence + §9.5/§5.4c). Stats are a first-pass guess — sim-tune
      // before locking, same discipline as every prior boss.
      chthon: {
        typeName: "Chthon, God of the Breach", role: "the Loom, fully escaped, wearing what's left of Kredex",
        nature: "void", tier: "boss",
        // Base stats corrected down (2026-07-25 baseline sim pass), same
        // class of fix as the Sun God (D5) and Phthora above — the original
        // 180/26/16 guess wiped a party at the real chain-arrival level
        // (~7) almost every time even under smart play. Not a final locked
        // number — deep balance tuning is its own later roadmap phase.
        baseStats: { hp: 115, en: 0, attack: 18, defense: 12, speed: 12 },
        skills: ["breachLash", "worldUnmaking", "chorusOfBreach", "kredexEcho"],
        affinities: { mind: DOUBLE_WEAK, thermal: WEAK, physical: RESIST },
        reinforceAt: 0.5,
        reinforceWave: [{ key: "voidHorror", count: 1 }],
        reinforceMessage: "A piece of the Breach tears through with it. Something that was never " +
          "meant to be here answers the call.",
        enrageAt: 0.5,
        enrageBuff: { atk: 1.45, speed: 1.2 },
        enrageMessage: "What's left of Kredex stops fighting for control. Only the Breach is driving now."
      }
    };

    // ENEMY POOLS (Phase G, §5.1) — what a node draws from, by tier. Replaces
    // the old single hardcoded ENCOUNTER; mixes both factions so squads have
    // to adapt (Netrunner counters Vossmark's synthetics, Mentalist counters
    // Talos's organics). Drawn from by rollEncounterForNode().
    // Talos units are DEFINED (below) but intentionally NOT pooled here: Talos
    // is a later-arc faction (§5.1), so Sector 1 — the only dungeon that draws
    // from these pools — stays all-Vossmark (+ the unbranded Hull Roach pest).
    // Re-add the talos* keys when a Talos-territory dungeon exists.
    const ENEMY_POOLS = {
      fodder:   ["spiderDrone", "hullRoach"],
      standard: ["arcSentinel", "vossmarkGrunt"],
      elite:    ["securityMech", "vossmarkOfficer"]
    };

    // UNKNOWN NODE OUTCOME TABLE (§5.4, Dungeons 4+): a `type:"unknown"` node's
    // result is rolled at RESOLVE TIME (onNodeClick), not authored per-node —
    // one table, reused by every Unknown node in every dungeon that has them.
    // Weights sum to 100 for readability; resolveUnknownNode() normalizes
    // regardless. "fight" routes into a real battle (rollEncounterForNode,
    // same as a combat node); the other three resolve inline like Loot/Rest.
    const UNKNOWN_NODE_OUTCOMES = [
      { key: "loot",      weight: 35 },   // a cache — grantLoot() (weighted rarity, §5.4)
      { key: "fight",     weight: 25 },   // an optional ambush fight — real XP, real risk
      { key: "trap",      weight: 20 },   // costs HP, no reward
      { key: "narrative", weight: 20 }    // flavor only, no mechanical effect
    ];
    const UNKNOWN_TRAP_HP_FRACTION = 0.12;   // % of max HP lost per hero on a "trap" roll
    const UNKNOWN_TRAP_FLAVOR = [
      "A pressure plate gives way, and a burst of scalding steam catches the squad before anyone can move.",
      "Something in the dark trips a wire. The blast is small, but it isn't nothing.",
      "The floor isn't floor. It takes a few bad seconds to climb back out."
    ];
    const UNKNOWN_NARRATIVE_FLAVOR = [
      "Nothing here but old silence and a dead terminal. Whatever happened, it happened a long time ago.",
      "A supply locker, emptied out and abandoned. Someone else got here first.",
      "The corridor doubles back on itself. A dead end, just a dead end."
    ];

    // SPRITES (Phase I, Slice 1; hero shapes redrawn in a follow-up pass to
    // read more like a classic JRPG battle sprite — see below). A sprite is a
    // `shape` (a grid of palette-key characters, '.' = transparent) plus a
    // `palette` (key -> CSS color). Several classes/enemies can share one
    // SHAPE and just supply a different palette — that's the data-driven win
    // here: adding a sprite for a new class/enemy is usually a palette, not a
    // new grid. drawSpriteFrame() (Section E) is the one function that reads
    // any of these; it derives the "idle bob" frame at draw time by shifting
    // the whole shape up one row within a padded canvas, not by hand-authoring
    // a second frame or relying on the art having its own blank top row.
    // Grids don't all have to be the same size — width/height are read off the shape itself
    // (Section E), which is what lets the hero shapes below be taller/more
    // detailed than the still-16x16 enemy shapes without any engine change.
    //
    // Only classes + a first handful of enemies (one per faction/dungeon) have
    // a bespoke entry this slice — see spriteFor() (Section E) for the
    // nature-colored fallback everyone else gets until they're filled in.
    //
    // Hero shapes (18x28) — redrawn to classic FF4/6-era battle-sprite quality
    // (a big step past the v1 flat-visor blocks). Each of the 5 classes now has
    // its OWN shape (they used to share slim/bulky/robe), so the silhouettes
    // read distinct at a glance. Every shape follows the same recipe:
    //   * a dark outline ('O') around and between every color region, so the
    //     form reads even at small size (the single biggest quality lever);
    //   * a real face — two separate eyes with skin between them (E pupil /
    //     W eye-white, or V for a glowing/augmented eye), NOT a visor bar —
    //     except the Dread Knight, who is fully helmed (a red T-visor) because
    //     a tank hiding behind armor is a deliberate identity cue;
    //   * 3-tone shading ramps per material (base + light + shadow: S/K/D skin,
    //     H/G/J hair, B/L/A cloth, M/P/N metal) for volume instead of flat fill;
    //   * a distinct weapon/identity: Merc rifle, Netrunner cyan circuit-spine,
    //     Dread Knight great-helm + front greatsword, Mech Runner arm cannon,
    //     Mentalist hooded staff with an orb.
    // The engine reads width/height off each grid (spriteCanvasSize), so these
    // being taller than the 16x16 enemy shapes needs no special-casing.
    // Palette key legend (see each class's palette in SPRITES below):
    //   O outline · S/K/D skin base/light/shadow · H/G/J hair(or helm) ·
    //   E eye-pupil · W eye-white · V accent glow · B/L/A cloth base/light/shadow ·
    //   M/P/N metal base/gleam/shadow · C strap · T/U pants · F boot · R robe-rune
    const SPRITE_SHAPES = {
      // Merc — SECOND TOTAL REBUILD (2026-07-27): "tactical operator, closed
      // helmet" — direct request for a from-scratch main-hero rebuild,
      // researched off Starship Troopers M-3 "snooper" helmets / The
      // Expanse MCRN Goliath armor / modern tactical operator gear. Built
      // in two parallel variants sharing one body (face-exposed vs. sealed
      // visor) as a controlled A/B; the sealed-visor version shipped,
      // continuing the pattern that a fully-enclosed head (skull, mask,
      // visor) sidesteps human-face rendering and reads best at this pixel
      // scale — the same lesson behind Dread Knight (best-received hero,
      // literally a skull) and the Saboteur respirator-mask rebuild.
      // Helmet: angular tactical shell (not the old round Apollo bubble)
      // with a full wraparound visor lit by the established Human-
      // Augmented cyber-green glow, a brighter HUD-line accent breaking up
      // the glass so it doesn't read as one flat color block, and a
      // chin/jaw guard with vent-slit detail closing off the bottom. Per
      // follow-up request ("add in some blue eyes... as if you could see
      // them"), two small cooler-blue patches sit inside the green glass at
      // the exact temple/nose-bridge spacing the face-exposed variant used
      // for its real eyes — darker than the surrounding glow so they read
      // as eyes SEEN through the visor, not part of the glow itself, a
      // quiet hint of the person underneath without breaking the seal.
      // Body (identical across both head variants): collar, shoulder
      // radio, chest-rig straps + red stripe accent, rifle with a visible
      // barrel/stock bend + rectangular magazine (a straight uniform
      // diagonal reads as a sword regardless of color — the angle change
      // plus the magazine jutting off it is what flips the read to "gun"),
      // belt, knee-pads, boot straps. Legs centered under the head (a v1
      // had them drifted a full column right — caught via direct column
      // inspection, not eyeballing). Old space-suit bubble-helmet design
      // archived to candidates.json as mercSpaceSuitLegacy; the face-
      // exposed sibling stays staged there too as mercTacticalV1.
      heroMerc: [
        "..........OKKO..........",
        "........OHHHHHHOZ.......",
        ".......OHHHHHHHHOZ......",
        "......OHHHHHHHHHHO......",
        "......OHHHHHHHHHHO......",
        "......OZGGZZZZGGZO......",
        "......OZVVGGGGVVZO......",
        "......OGGIIGGIIGGO......",
        "......OGGGGGGGGGGO......",
        "......OZGGGGGGGGZO......",
        ".......OHHHZZHHHO.......",
        "........OHHHHHHO........",
        "........OSSSSSSO......O.",
        ".....Z..OCCCCCCO.....MPO",
        ".....OZZBCCCCCCBBBOMPO..",
        "....OBZZBBBBBBBBOMPO....",
        "....OBBBBBBBBBOXPOBO....",
        "....OBLBLLBBXOPPOBBO....",
        "....OBLLBBBOOMMMOBBO....",
        "....ORRRRRRNPOOQQORO....",
        "....OAACCOPOAOQQQOAO....",
        "....OBBBPNOBBOPPOBBO....",
        ".....OCCCCCCONNOCCCO....",
        "....OOXOAAAAAAAAAAAO....",
        "....XXOTTTTOOTTTTO......",
        "......OTLLTOOTLLTO......",
        "......OUUUUOOUUUUO......",
        "......OTTTTOOTTTTO......",
        ".....OFFFFFOOFFFFFO.....",
        ".....OFFFFFOOFFFFFO.....",
        ".....OFFFFFOOFFFFFO.....",
        ".....OYYYYYOOYYYYYO....."
      ],
      // Netrunner (Nyx) — TOTAL REBUILD 2026-07-27. Direct request: "do
      // research... make an attempt at a complete rebuild... worst case,
      // focus on making an attractive human female sprite as the
      // baseline." Rendered the old shipped design directly first: the
      // face was a flat pale oval with two horizontal cyan BARS for eyes
      // (no lid curve), a grey smudge for a nose, a grey bar for a mouth —
      // and the body was a straight-sided hooded mass with zero visible
      // waist taper despite this same comment block always having claimed
      // one. Real fixes this time: thin arched eyebrows, curved eyes with
      // a real temple + nose-bridge gap (this session's own Vossmark
      // Officer face lesson), small defined lips. The hourglass silhouette
      // finally reads because the ARMS were fixed too — v1 self-QA found
      // the torso numerically tapering at the waist while the arms sat at
      // a constant distance from the body the whole way down, masking it
      // completely; fixed by holding the arms roughly in place while the
      // torso narrows underneath, opening a real wedge of background
      // between arm and body that grows toward the waist and closes at
      // the hip — confirmed via a cropped close-up render, since it wasn't
      // obvious in the full-body view either. Kept: long hair framing the
      // face and falling past the shoulders, cool pale synthetic skin,
      // glowing cyan eyes + circuit-spine, dark bodysuit family. The
      // previous build is preserved as the `netrunnerLegacy` candidate in
      // tools/sprite-review/candidates.json, not deleted.
      heroNetrunner: [
        "..........OHHHO.........",
        "........OGGHHHHHO.......",
        ".......OGGHHHHHHHO......",
        ".......OHHSSSSSSSO......",
        ".......OHSSSSSSSSO......",
        ".......OHDDDSSDDDO......",
        ".......OHSSSSSSSSO......",
        "......OHSDVSSVDSHO......",
        ".......OSSKSSKSSSO......",
        "........OSSDSSSSO.......",
        "........OSSYYSSO........",
        ".........ODDDDO.........",
        "..........OSSO..........",
        "......H..OSSSSO..H......",
        ".....OHHBBBBBBBBHHO.....",
        "....OOHHBBBBBBBBHHOO....",
        "....H.OBBBBBBBBBBO.H....",
        "....OB.OAAVVVVAAO.BO....",
        "....OB..OBBBBBBO..BO....",
        "....OB...OBBBBO...BO....",
        "....OS...OVVVVO...SO....",
        ".....OSOAABBBBAAOSO.....",
        "......OAAAAAAAAAAO......",
        ".......OAAAAAAAAO.......",
        "........OTTOOTTO........",
        "........OTTOOTTO........",
        "........OUUOOUUO........",
        "........OTTOOTTO........",
        "........OFFOOFFO........",
        "........OFFOOFFO........",
        "........OFFOOFFO........",
        "........................"
      ],
      heroDread: [      // tank: literal exposed skull (glowing red eye-sockets), giant
                         // slab greatsword resting on the shoulder, tip past the head
        "................ONPPMO..",
        "................NPPM....",
        "..........OKKO..NPPM....",
        "........OKKKKKKONPPM....",
        ".......OKKKKKKKKOPM.....",
        "......OKKKKKKKKKKO......",
        "......OKKKKKKKKKKO......",
        "......OJJJKKKKJJJO......",
        "......OJVJKKKKJVJO......",
        "......OJJJDDKKJJJO......",
        "......OKKKKJJKKKKO......",
        ".......ODDDDDDDDO.......",
        "........OKJKJKJKO.......",
        "........ONNNNNNO........",
        "...OMMMMMNNNNNNMMMMMO...",
        "...OPPPPNNNNNNNNPPPPO...",
        "....OMMMNPPMMMMMMMMO....",
        "....OMMMMMMMMMMMMMMO....",
        "....OMMNPPMMMMMMMMMO....",
        "....OMMONNNNOMMMMMMO....",
        "....OOKKOOKKOMMMMMMO....",
        "....OMBBBBBBBBBBBBMO....",
        ".....OBBBBBBBBBBBBO.....",
        ".....OCCCCCCCCCCCCO.....",
        "......OMUUMOOMUUMO......",
        "......OMMMMOOMMMMO......",
        "......OMMMMOOMMMMO......",
        "......OMMMMOOMMMMO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "........................",
        "........................"
      ],
      // Mech Runner (Torque von Bram) — TOTAL REBUILD 2026-07-27 as a
      // standalone "agile digitigrade battle-mech" (direct request: "look
      // up Battle Mechs, Sci-fi content... create something standalone...
      // different from what you currently built"). Archetype confirmed via
      // AskUserQuestion. Research anchor: BattleTech/MechWarrior's reverse-
      // joint "chicken-walker" bipeds (Timber Wolf/Mad Cat, Catapult,
      // Marauder) and Titanfall's Titans — the backward-bending leg is the
      // real convention for "fast mech," a direct payoff of "Runner" as a
      // class name. A reverse-joint bend is a depth-axis thing, invisible
      // in a flat front-facing sprite, so the readable translation is a
      // bold OUTWARD SPLAY at the knee: narrow hip, legs bow wide at the
      // knee, narrow back in at the ankle, with a heel spur and clawed
      // toes — the same bow-legged stance a real digitigrade animal shows
      // even viewed head-on. Deliberately differentiated from this game's
      // own Security Mech (`heavyMech`): that one is a squat no-face robot
      // on stubby straight tank legs. Kept from the old design: the human
      // pilot face on top (his identity marker vs. Security Mech's single
      // sensor lens and Netrunner's synthetic face), amber core-light +
      // rust-joint color identity, and the asymmetric heavy-cannon-arm
      // build (railShot/incendiaryRounds/orbitalStrike are all heavy-
      // weapons-flavored). The previous build is preserved as the
      // `heroMechLegacy` candidate in tools/sprite-review/candidates.json
      // per explicit instruction, not deleted.
      heroMech: [
        ".........OHHHHO.........",
        "........OHHHHHHO........",
        ".......OSSSSSSSSO.......",
        ".......ODDWEDDWEO.......",
        ".......OSSSSSSSSO.......",
        "........ODDDDDDO........",
        ".......ONNNNNNNNO.......",
        "...OMMMMMAAAAAAMMMMO....",
        ".NOMMMMRAAAAAAAARMMOM...",
        ".OMPPPPAAAAAAAAAAPPMO...",
        ".OMMOAAAAAAAAAAAAAAOMMO.",
        ".OPPOOAAAAAAAAAAAAOOPPO.",
        ".OMMO.ONNNVVVVNNNO.OMMO.",
        ".OPPO.ONNNVVVVNNNO.OMMO.",
        ".OMMO.OAAAAAAAAAAO.OMMO.",
        ".ONNO..OAAAAAAAAO..OXXO.",
        ".ONNO...ONNNNNNO..OXXXO.",
        ".OPPO.OAAAAAAAAAAOOX.XO.",
        ".....ONNNNAAAANNNNO.....",
        "......OMMMO..OMMMO......",
        ".....OMMMMO..OMMMMO.....",
        "...OMMMMMO....OMMMMMO...",
        "..RONNNNO......ONNNNOR..",
        "....OMMMO......OMMMO....",
        ".....OMMMO....OMMMO.....",
        ".....OMMMO....OMMMO.....",
        "...ONNOAAO....OAAONNO...",
        "....ONOAAO....OAAONO....",
        "...OFFFOOFFOOFFOOFFFO...",
        "...OFFFOOFFOOFFOOFFFO...",
        "....OFF..FO..OF..FFO....",
        "........................"
      ],
      // Mentalist — REFINEMENT 2026-07-27 leaning into the traditional
      // wizard/sage archetype (direct request + research: "emphasize the
      // hat/robe edges," "iconic elements: staff and hat," a long beard as
      // THE wizened-old-sage cue — also ties to the FF1 Black Mage
      // reference shared this session, whose DNA this design already
      // shared, just under-executed). Rendered the old shipped design
      // directly first: the "eyes" were two thick 3px flat bars with no
      // lid shape, no age/wisdom cue anywhere, and the staff was built
      // entirely from the gold rune color with no wood tone and no real
      // gripping hand despite this same comment block claiming one —
      // same "claimed but not executed" gap as the old Netrunner
      // hourglass. A refinement, not a redraw: hood silhouette, robe
      // shape, rune emblem, and overall pose kept intentionally
      // unchanged. Three fixes: (1) a visible beard poking out below the
      // mouth; (2) two real eyes with a lid-crease and proper temple +
      // nose-bridge gaps, replacing the old wide double-bar; (3) the
      // staff rebuilt in actual wood tone (M, previously an unused
      // palette leftover) with a real 2px gripping hand, replacing a
      // single stray pixel sandwiched between two outline pixels.
      heroMentalist: [
        "........................",
        "........................",
        "...........OHHO.........",
        ".........OHHHHHHO.......",
        "........OHHHHHHHHO......",
        ".......OHHHHHHHHHHO.....",
        ".......OHHHHHHHHHHO.....",
        ".......OHSSSSSSSSHO.....",
        ".......OHDDSSSSDDHO.....",
        ".......OHSVVSSVVSHO.....",
        ".......OHSSSSSSSSHO.....",
        ".......OHSSSSSSSSHO.....",
        ".......OHKKKDDKKKHO.....",
        ".......OHHWWWWWWHHO.....",
        "........OHHWWWWHHO......",
        "......OAAHBBBBBBHAAOOV..",
        ".....OBBBBBBBBBBBBBO.M..",
        ".....OBBBBVVVVBBBBO..M..",
        "....OBBBBBVVVVBBBBBOSSO.",
        "....OBBBBBRRRRBBBBBO.M..",
        "...OBBBBBBBRRBBBBBBBOM..",
        "...OBBBBBBBBBBBBBBBBOM..",
        "..OBBBBBBBBBBBBBBBBBBO..",
        "..OBBBBBBBBBBBBBBBBBBO..",
        ".OBBBBBBBBBBBBBBBBBBBBO.",
        ".OBBBBBBBBBBBBBBBBBBBBO.",
        ".....AAAAAAAAAAAAAA..M..",
        ".....OOOOOOOOOOOOOO.....",
        "........................",
        "........................",
        "........................",
        "........................"
      ],
      // Sexias — TOTAL REBUILD 2026-07-27 as a "corroded deserter"
      // anti-hero. Direct complaint: "he's quite generic... increase the
      // detail." Rendered the old shipped design directly first: the two
      // "eyes" had zero gap between their pupils (read as one smudge),
      // the nose had no shape at all, the rust "decay" patches were clean
      // solid rectangles (read as a color-block pattern, not battle
      // damage), and the two "mismatched" legs used two olive tones close
      // enough in value that they never actually read as different
      // materials despite the code using different palette letters — same
      // "claimed but not executed" gap found in Netrunner/Mentalist.
      // Research: Fallout-style wasteland-mercenary conventions
      // (scavenged mismatched armor, gas/respirator masks, exposed
      // corrosion) are the real anchor for "anti-hero deserter." Core fix
      // builds on this session's single strongest lesson (reconfirmed the
      // same day — "Dread Knight was your best work" — because a skull
      // has no organic face to get wrong): a full respirator mask with
      // glowing acid-green lenses, replacing the bandana + bare eyes.
      // Good in-fiction logic too (a Corrosive specialist needs breathing
      // protection around his own acid weapons), and it ties his
      // signature glow color directly to his face for a much stronger
      // anti-hero/villain read. Also rebuilt: corroded armor with actual
      // jagged holed edges (not clean rectangles), a bandolier strap,
      // a genuinely-contrasting mismatched leg (light tan cloth wrap vs.
      // dark armored greave, not two similar olive tones), and a jagged
      // broken-edge acid blade (was a smooth diagonal wand). The previous
      // build is preserved as the `saboteurLegacy` candidate in
      // tools/sprite-review/candidates.json, not deleted.
      heroSaboteur: [
        ".........OHHHHO.........",
        ".......OHHHHHHHHO.......",
        "......OHHHHHHHHHHO......",
        "......OHHSSSSSSHHO......",
        "......ONSSSSSSSSNO......",
        "......OMMGGMMGGMMO......",
        "......OMMVVNNVVMMO......",
        "......OMMMMMMMMMMO......",
        ".......OMMNNNNMMO.......",
        "........ONNNNNNO........",
        ".........OMMMMO.........",
        "..........OSSO..........",
        "....OLLLLLSSSSCCCCO.....",
        "...OBBRBBBSSSSCCCCCO....",
        "...OBBBBBBBBBBBBBBBOBBO.",
        ".OCOBBBBBBBBBBUBBBBDDDOG",
        "OCCOBBBBBUUBBUBBBBBOODGV",
        "ODDORRRBBBBBAABBBBBO.OVG",
        "ODDOBBFBBBBBBBBBBBBOOGV.",
        "ODDOBFFFBBBBBBBBBBBOVGO.",
        "OSSOFFFBBBBBBBBBBBOGVO..",
        "...OAAAAAAAAAAAAAAOVO...",
        "....OCCCCCCCCCCCCCO.....",
        ".....OTTTTOOBBBBO.......",
        ".....OTTTTOOBBBBO.......",
        ".....OUUUUOORBBRO.......",
        ".....OTTTTOOBBBBO.......",
        ".....OFFFFOOFFFFO.......",
        ".....OFFFFOOFFFFO.......",
        "........................",
        "........................",
        "........................"
      ],
      // Spider Drone — a mechanical spider (not a blob): a rounded metal chassis
      // (B) with highlights (P) and a glowing red optic band (E), and six clearly
      // jointed legs (upper/mid/lower pair) splayed out to feet. O = dark outline
      // + leg base, L = leg mid-segment.
      // Spider Drone -- detail pass: small bladed leg-tips (security-bot
      // read). Repair Drone now has its OWN shape below (one tool accent
      // instead of a blade, reads as maintenance not combat).
      spiderDrone: [
        "................",
        ".E............E.",
        "..OL........LO..",
        "...OL......LO...",
        "....OL....LO....",
        ".....OBBBBO.....",
        "..OLOPPPPPPOLO..",
        ".OLLOPPEEPPOLLO.",
        ".OLLOPPEEPPOLLO.",
        "..OLOPPPPPPOLO..",
        ".....OBBBBO.....",
        "....OL....LO....",
        "...OL......LO...",
        "..OL........LO..",
        ".E............E.",
        "................"
      ],
      spiderDroneRepair: [
        "................",
        ".O............O.",
        "..OL........LO..",
        "...OL......LO...",
        "....OL....LO....",
        ".....OBBBBO.....",
        "..OLOPPPPPPOLO..",
        ".OLLOPPEEPPOLLO.",
        ".OLLOPPEEPPOLLO.",
        "..OLOPPPPPPOLO..",
        ".....OBBBBO.....",
        "....OL....LO....",
        "...OL......LM...",
        "..OL........LM..",
        ".O............O.",
        "................"
      ],
      // Stealth humanoid — Talos Wraith (fodder) + Talos Phantom (standard):
      // hunched, hooded, glowing eyes, claws out at shoulder height. Upgraded
      // from the original v1-quality "wraith" shape with a proper outline pass.
      stealthHumanoid: [
        "................",
        "................",
        "......OHHO......",
        "......OEEO......",
        ".....OHHHHO.....",
        "....OBBBBBBO....",
        "...CBBBBBBBBC...",
        "...CBBBBBBBBC...",
        "....BBBBBBBB....",
        "....BBBBBBBB....",
        ".....BBBBBB.....",
        "......LL..LL....",
        "......LL..LL....",
        "......LL..LL....",
        "................",
        "................"
      ],
      // Hive crawler — Hull Roach + Erebus Roach: small swarming insectoid.
      // Upgraded from the original "roach" shape with an outline pass.
      // Hive crawler — Erebus Roach + Hull Roach (same model, per direction:
      // "use this model for all roaches, color change as needed for
      // types"). Broodmarshal-DNA scaled to fodder size: antennae,
      // mandibles, a ribbed/segmented abdomen (alternating H/J bands, the
      // boss's signature chitin cue), real jointed legs off the sides/rear.
      hiveCrawler: [
        "....A......A....",
        ".....A....A.....",
        "......OHHO......",
        ".....OHHHHO.....",
        "....KOEEEEOK....",
        "...OHHHHHHHHO...",
        "LOOJJJJJJJJJJOOL",
        "..OHHHHHHHHHHO..",
        "LOOJJJJJJJJJJOOL",
        "...OHHHHHHHHO...",
        "....OJJJJJJO....",
        "...LO......OL...",
        "..L..L....L..L..",
        "................",
        "................",
        "................"
      ],
      // Humanoid grunt — Vossmark Grunt, Quota Enforcer: bare-headed fodder/
      // standard organic soldier, rifle-ish weapon hand, same visual recipe
      // as the hero humanoid shapes (outline + visible face + weapon color).
      humanoidGrunt: [
        "................",
        ".....OHHHHO.....",
        "....OSVVVVSO....",
        ".....OSSSSO.....",
        "....OOCCCCOO....",
        ".OAABBBBBBBBAAO.",
        ".OAABBBBBBBBWGO.",
        "..BBBBBBBBWWWW..",
        "..BBBBBBBB.WW...",
        "....OOKKKKOO....",
        "....LLL..LLL....",
        "....LLL..LLL....",
        "....LLL..LLL....",
        "....FFF..FFF....",
        "................",
        "................"
      ],
      // Guard trooper — deliberately DIFFERENTIATED from the human-faced heroes
      // (24x32, hero-scale via §ui scaleFor). An angry helmeted enforcer: combat
      // helmet + rim, heavy scowling brow, glaring eyes, a gritted snarl; a neck
      // gorget and a BOXY armored torso with shoulder pauldrons (a chest plate,
      // not the hero's lean vest); left arm RAISED overhead gripping a glowing
      // stun-baton (matches the Quota Enforcer's Baton Strike), right arm down in
      // a gauntlet. Now Vossmark Grunt's ALONE (Quota Enforcer and Riot Enforcer
      // split off into their own bespoke `laborEnforcer`/`riotShieldTrooper`
      // shapes, 2026-07-27, ending the 3-way recolor economy) — light polish pass
      // same day: the mouth was a 7px-wide solid white block reading as a cartoon
      // grin, narrowed to a 3px closed stern line.
      // Legend: O outline | P helmet G helmet-rim/gorget | S skin K skin-lt D brow/shadow
      //   W eye-white/teeth E eye-dark | C collar/belt | H pauldron B chest-armor
      //   A arm/plate-shadow X gauntlet | M baton-shaft V baton-glow
      //   T greave U greave-shadow F boot
      guardTrooper: [
        "...VV...................",
        "...MM...OPPPPPPO........",
        "...MM..OPPPPPPPPO.......",
        "..XMM.OPPPPPPPPPPO......",
        ".XXX.OGGGGGGGGGGGGO.....",
        ".XXX.OPSSSSSSSSSSPO.....",
        ".SXX.OSDDDDDDDDDSO......",
        ".SSX.OSEESSSSEESSO......",
        ".SSA.OSSSSSDDSSSSO......",
        ".AAA.OKSSSSSSSSSKO......",
        "..AA.OSDDDWWWDDDSO......",
        "..AA.OKSSSSSSSSSKO......",
        "...A..OKSSSSSSKO........",
        ".....OGGGGGGGGGGO.......",
        "......OCCCCCCCCO........",
        "....OHHHHHHHHHHHHHHO....",
        "...OHHBBBBBBBBBBBBHHO...",
        "...OHBBBBBBBBBBBBBBAO...",
        "...OBBBBVVBBVVBBBBXAO...",
        "...OBBBBBBBBBBBBBBXAO...",
        "...OABBBBBBBBBBBBBAO....",
        "...OCCCCCCCCCCCCCCO.....",
        "...OTTTTTTOOTTTTTTO.....",
        "..OTTTTTOOOOTTTTTO......",
        "..OTTTTO....OTTTTO......",
        "..OTTTUO....OUTTTO......",
        "..OTTTTO....OTTTTO......",
        "..OTTTTO....OTTTTO......",
        "..OFFFFO....OFFFFO......",
        "..OFFFFO....OFFFFO......",
        "..OFFFO......OFFFO......",
        "........................"
      ],
      // Quota Enforcer — split off the shared guardTrooper shape
      // (2026-07-27, was tabled as a candidate since 2026-07-26). Redesigned
      // as a corporate labor-enforcer, not a soldier: bare head (no helmet),
      // visible unshadowed face, a lighter vest instead of plate armor, a
      // narrower silhouette overall — still carries the established baton.
      laborEnforcer: [
        "........................",
        "........................",
        "..........OHHO..........",
        "....V....OHHHHO.........",
        "....M...OSSSSSSO........",
        "....M..OSSSSSSSSO.......",
        "...XM..ODDSSSSDDO.......",
        "..SXX..OEESSSSEEO.......",
        "..SSX..OSSSSSSSSO.......",
        "..SSA...ODDDDDDO........",
        "...AA....OKKKKO.........",
        "....AA....OSSO..........",
        ".....AA...OCCO..........",
        "......OBBBBBBBBBBO......",
        "......OBBBBBBBBBBO......",
        "......OBBBVVBBBBBO......",
        "......OBBBBBBBBBBO......",
        "......OBBBBBBBBBBO......",
        "......OBBBBBBBBBBO......",
        "......OAAAAAAAAAAO......",
        ".......OCCCCCCCCO.......",
        "........OTTTOOTTTO......",
        "........OTTTOOTTTO......",
        "........OTTTOOTTTO......",
        "........OTTTOOTTTO......",
        "........OTTTOOTTTO......",
        "........OTTTOOTTTO......",
        "........OFFFOOFFFO......",
        "........OFFFOOFFFO......",
        "........................",
        "........................",
        "........................"
      ],
      // Riot Enforcer — split off the shared guardTrooper shape
      // (2026-07-27, was tabled as a candidate since 2026-07-26). Redesigned
      // as the bulkiest of the Vossmark trio: full face-shield helmet (no
      // visible face at all), a riot shield on one arm, baton on the other,
      // wider shoulders, shin guards.
      riotShieldTrooper: [
        "........................",
        ".........OPPPPO.........",
        "........OPPPPPPO........",
        ".......OPPPPPPPPO.......",
        ".......OGGGGGGGGO.......",
        "......OPPEEEEEEPPO......",
        "......OPPEEEEEEPPO......",
        "......OPPPPPPPPPPO......",
        ".......OGGGGGGGGO.......",
        "........OPPPPPPO........",
        ".........OCCCCO.........",
        "OAAOBBBBBCCCCCCBBBBBOV..",
        "OAAOBBBBBBBBBBBBBBBBMMO.",
        "OAAOBBBBBBBBBBBBBBBO....",
        "OVVOBBBBBBBBBBBBBBBO....",
        "OAAOBBBBBVVBBVVBBBBO....",
        "OAAOBBBBBBBBBBBBBBBO....",
        "OVVOBBBBBBBBBBBBBBBO....",
        "OAAOBBBBBBBBBBBBBBBO....",
        "OAAOBBBBBBBBBBBBBBBO....",
        "....OAAAAAAAAAAAAAAO....",
        ".....OCCCCCCCCCCCCO.....",
        "......OTTTTOOTTTTO......",
        "......OTTTTOOTTTTO......",
        "......OTTTTOOTTTTO......",
        "......OUUUUOOUUUUO......",
        "......OTTTTOOTTTTO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "........................",
        "........................",
        "........................"
      ],
      // Humanoid officer, Vossmark — bespoke (originally split from a
      // shared humanoidOfficer shape; that shape is now unused by anything
      // — Overseer Voraxx moved to its own voraxxFat shape earlier, and
      // Talos Vanguard split off into humanoidOfficerTalos below — so the
      // old shared shape was removed rather than left as dead code).
      // Anchored to the "Commissar Cap" archetype (oversized
      // peaked cap, greatcoat with contrasting trim, gold insignia) at the
      // hero-scale 24x32 grid for real detail: real pupils, angry V-brows,
      // a stern mustache, gold epaulettes, a filled diagonal lapel,
      // sleeved arms to visible hands, and a sheathed saber at the hip
      // (sheathed, not drawn — avoids the floating-held-prop problem that
      // failed on this character twice already).
      humanoidOfficerVossmark: [
        "..........OHHO..........",
        "........OHHHHHHO........",
        ".......OHHHHHHHHO.......",
        "......OKKKNNNNKKKO......",
        ".....OEEEEEEEEEEEEO.....",
        "......OSSDSSSSSSDO......",
        "......OSSSDDSSDDSO......",
        "......OSSSWNSSNWSO......",
        "......OSSSSSSSSSSO......",
        "......OSSSSIISSSSO......",
        ".......ODDDDDDDDO.......",
        "........OYYYYYYO........",
        "........ORRRRRRO........",
        "....OKKKBBBBBBBBKKKO....",
        "...OBBBBBBBBBBBBBBBBO...",
        "...OOLLAAABRRBAAOLLAO...",
        "...OOLLAAAARRAAAOLLAO...",
        "...OOAAABAAKKAABOAAAO...",
        "...OOAABBBBBBBBBBAAOO...",
        "...OOSSBBBBKKBBBBSSOKO..",
        "...OSSBBBBBBBBBBBBSSKO..",
        "...OBBBBBBBKKBBBBBBOKKO.",
        "..OAAAAAAAAAAAAAAAAOPPO.",
        "..OAAAAAAAAAAAAAAAAOPPO.",
        ".OAAAAAAAAACCAAAAAAOPPO.",
        ".OLLLLLLLLLCCLLLLLLOPPO.",
        "..OOOOOOOOO..OOOOOOOPPO.",
        "......OLLLLOOLLLLO.OPPO.",
        "......OLLLLOOLLLLO.OPPO.",
        "......OLLLLOOLLLLO.OPPO.",
        "......OFFFFOOFFFFO..OPO.",
        "......OFFFFOOFFFFO...O.."
      ],
      // ---------- TALOS SECURITY WING (§5.1) ----------
      // Split off the shared stealthHumanoid/humanoidOfficer shapes into
      // bespoke silhouettes (2026-07-26 sprite pass). Research anchor: the
      // Warhammer 40k "Genestealer Hybrid" archetype — per the design doc's
      // own retcon framing the Security Wing reads as "closer to human,
      // soldier-shaped" (the wing-level contrast against the overtly
      // monstrous Specimen Wing), so all three stay recognizably human-
      // soldier silhouettes and push their mutation into ONE escalating
      // tell per tier rather than going full-monster.
      // Talos Wraith — hunched fast infiltrator: ragged grown-cowl hood
      // (uneven hem, not a clean cloth edge), one fused venom-glow claw
      // growing out of the forearm (not held — avoids the floating-prop
      // problem that hit Merc/the Officer twice already), other arm
      // tucked in tight (compact/fast read).
      stealthHumanoidWraith: [
        "................",
        ".......OHH......",
        "......OHHHHO....",
        ".....OHHHHHHO...",
        ".....OJHHHHJO...",
        "....OJJHHHHJO...",
        ".....OJJEJEJO...",
        ".....OJJJJJJO...",
        "....OBBBBBBBO...",
        "...OBBBBBBBBBO..",
        "...OBBBDDBBBBO..",
        "...OBBBBBBBBOVVV",
        "..OBBBBBBBBBOVV.",
        "..OAAAAAAAAONN..",
        "...OFFFOOFFFO...",
        "...OFFFOOFFFO..."
      ],
      // Talos Phantom — sleeker, more composed stealth striker: an angular
      // chitin crest (vs Wraith's rounded ragged hood), a tapered upright
      // waist (vs Wraith's hunched block), fused blade held up in a
      // forward lunge at shoulder height (changes the actual bounding-box
      // silhouette, not just the color) — a genuinely distinct silhouette
      // one tier up, not a recolor of Wraith.
      stealthHumanoidPhantom: [
        "........R.......",
        ".......ORO......",
        "......OHHHHO....",
        ".....ORRRRRRO...",
        ".....OJJEJEJO...",
        ".....OJJJJJJO...",
        ".....OHHHHHHO...",
        "......OCCCCO....",
        "....OBBBBBBBBONN",
        "...OBBBDDBBBBONN",
        "....OBBBBBBBONN.",
        "....OBBBBBBONN..",
        "...OAAAAAAAO....",
        "....OCCCCCCO....",
        ".....OFFOOFFO...",
        ".....OFFOOFFO..."
      ],
      // Talos Vanguard — bulkier heavy operative, hero-scale 24x32 (was
      // sharing humanoidOfficer with Vossmark Officer/Overseer Voraxx).
      // Asymmetric organic-plate pauldrons + a shoulder chitin spike
      // (contrast to the Officer's mirrored gold epaulettes two factions
      // over), Broodmarshal-family ribbed chitin torso banding with a
      // glowing bio-crack, a glowing throat-node marking its 2.0x-weak-
      // Psionic caste (front-facing analogue of Erebus Shaman's antennae),
      // a hidden second clawed limb peeking from under the coat at the hip
      // (direct callback to the Genestealer research anchor — "may hide an
      // extra clawed limb under tattered clothes"), and a plasma-edge
      // blade with a real crossguard + gripping hand (Dread Knight's
      // solid-vertical-blade convention) so it reads as held, not floating.
      humanoidOfficerTalos: [
        ".........OHHHHO.........",
        "........OHHHHHHO........",
        ".......ORRRRRRRRO.......",
        ".......OJJEJJEJJO.......",
        "....O..OJJJJJJJJO.......",
        "...OK...OHHHHHHO........",
        "...OKO...OGGHHO.......O.",
        "...OKK..OCCCCCCO.....OP.",
        "....OKKKKBBBBBBKKKO..PG.",
        "...OKKKKKBBBBBBKKO...PG.",
        "...OBBBBBBBBBBBBBBBBOPG.",
        "...OBDDDDDDDDDDDDDDBOPG.",
        "...OBBBBBBBBBBBBBBBBOPG.",
        "...OBBBBBBVBBBBBBBBBOPG.",
        "...OBDDDDDVVDDDDDDDBOPG.",
        "..OOBBBBBBBVBBBBBBBBOPG.",
        ".OVOBBBBBBBBBBBBBBBBOPG.",
        ".OVOBDDDDDDDDDDDDDDBOPG.",
        ".OVKBBBBBBBBBBBBBBBBOKKO",
        "..OKBBBBBBBBBBBBBBBBOKKO",
        "..OAAAAAAAAAAAAAAAAAAOO.",
        "..OAAAAAAAAAAAAAAAAAAO..",
        "..OCCCCCCCCCCCCCCCCCCO..",
        "...OCCCCCCCCCCCCCCCCO...",
        "......OAAAAOOAAAAO......",
        "......ODDDDOODDDDO......",
        "......OAAAAOOAAAAO......",
        "......OAAAAOOAAAAO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......"
      ],
      // ---------- TALOS SPECIMEN WING (§5.4a) ----------
      // Design doc lock: "unsettling, not graphic" -- wrongness via
      // shape/asymmetry and color (sickly growth, unnatural fusion,
      // restraints, distorted silhouettes), never gore. Anchored to this
      // game's own already-shipped Phthora ("hollow-eyed... bioluminescent
      // rupture") and Proteus ("peeled chest around a glowing core, one
      // wrong arm") bosses, so the mob family reads as smaller-scale
      // echoes of the same origin-point transformation. Reuses Phthora's
      // exact bioluminescent green (#7ae0a0) as the family's throughline
      // glow, escalating in size with tier. Started at 16x16 like the
      // rest of the mob roster, then upscaled to 24x32 (2026-07-27, user:
      // "why are they still 16x16, let's add more detail if we can") --
      // same hero-scale grid guardTrooper/Chimera already used, needs
      // HERO_BATTLE_SCALE in ui.js SHAPE_SCALE_OVERRIDE.
      // Splice Husk — "a failed early test subject, barely held
      // together... these were people." Gaunt hollow-eyed head (one
      // socket a dark void, the other nearly shut -- asymmetry as the
      // wrongness cue), patchy bald hair, one visibly withered/shorter
      // arm, a metal restraint cuff still fused to the other wrist, a
      // torn clinical smock, an uneven dragging stance. Only a single
      // pinprick of glow -- barely a tell yet at this tier.
      spliceWither: [
        "..........OHHO..........",
        ".........OHSHHO.........",
        "........OSSSSSSO........",
        "........OSSSSSSSO.......",
        "........OEESSSDSO.......",
        "........OSSSSSSSO.......",
        ".........OAAAAAO........",
        ".........OSSSSSO........",
        "..........OSSSO.........",
        ".........OWWWWO.........",
        ".......OTTWWWWMMO.......",
        "......OTTWWWWWWMMO......",
        "......OTTWWWWWGMMO......",
        "......OAAWWWWWWDDO......",
        ".......OAOWWWWWDDO......",
        ".........OWWWWWSSO......",
        ".........OAAAAAADO......",
        "..........OAAAAAO.......",
        ".........OWWWOWWO.......",
        "..........OWWWWWO.......",
        "..........OUUOOUUO......",
        "..........OUUOOUUO......",
        "..........OUUOOUUO......",
        "..........OUUOOUUO......",
        "..........OUUOOUUO......",
        "..........OUUOOUUO......",
        "..........OFFOOFFO......",
        "..........OFFO..........",
        "........................",
        "........................",
        "........................",
        "........................"
      ],
      // Bio-Tank — "a restrained containment specimen that breaks
      // loose." Bulkier than Splice Husk with ASYMMETRIC overgrowth on
      // one side (carries the Regen mechanic visually), a broken harness
      // with real buckle detail crossing the chest (one snapped, kept
      // inside the silhouette rather than a separate floating piece), and
      // a bigger bioluminescent rupture with radiating veins than Husk's
      // single pinprick — same Phthora-green family, escalating with
      // tier. Wide braced stance for the "tank" read.
      bioRupture: [
        ".........OHHHHO.........",
        "........OSSSSSSO........",
        ".......OSSSSSSSSO.......",
        ".......OEESSSSDSO.......",
        ".......OSSSSSSSSO.......",
        "........OAAAAAAO........",
        "........OSSSSSSO........",
        "........OWWWWWWO........",
        "....ONNNNWWWWWWWWNNO....",
        "...ONNNNNWWWWWWWWNNO....",
        "...OWWWWWWWWWWWWWWWWO...",
        "...OCCCCCWWWWWWCCCCCO...",
        "...OCCCCCDWWWWDCCCCCO...",
        "...OCCCCDWWWWWWWWWWWO...",
        "...ODWWWWWWWWWWWWWWWO...",
        "...OWWWGGGWWWWWWWWWWO...",
        "...OWWGGGGGWWWWWWWWWO...",
        "...OWWWGGGAAAAAAAAAAO...",
        "...OAAAAAAAAAAAAAAAAO...",
        "....OAAAAAAAAAAAAAAO....",
        ".....OCCCCCCCCCCCCO.....",
        "......OUUUUOOUUUUO......",
        "......OUUUUOOUUUUO......",
        "......OUUUUOOUUUUO......",
        "......OUUUUOOUUUUO......",
        "......OUUUUOOUUUUO......",
        "......OUUUUOOUUUUO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "......OFFFFOOFFFFO......",
        "........................"
      ],
      // Chimera Specimen — design doc explicitly locks this one as fully
      // bespoke, NOT a hive-shape reuse: kept human-adjacent-wrong (a
      // swollen bone-spur claw mass) rather than insectoid, so the Erebus
      // connection stays in flavor text only. Restraint straps have
      // fused INTO the torso (wrapped bands the skin has grown over —
      // unnatural fusion, not gore), one arm still ends in a human hand
      // with a torn cuff (the "these were people" tragic note even at
      // elite tier), the other a fused overgrown claw-limb, the biggest
      // bioluminescent rupture in the family (echoing Phthora's chest
      // rupture at a smaller scale), and one leg ending in a root-like
      // stump instead of a foot (echoing Phthora's root-tendril motif).
      chimeraFusion: [
        ".........OHHHO..........",
        "........OSSSSSSO........",
        ".......OSSSSSSSSO.......",
        ".......OEESSSSDSO.......",
        ".......OSSSSSSSSO.......",
        "........OAAAAAAO........",
        "........OSSSSSSO........",
        ".......OWWWWWWWWO.......",
        ".....ONNNWWWWWWWWON.....",
        "....ONNNWWWWWWWWWWON....",
        "..OOCCCCCCCCCCCCCCCCNO..",
        "..SOWWWWWWWWWWWWWWWWONO.",
        "..SOWWWWWWWWWWWWWWWWONNO",
        "..SOWWWWWWWWWWWWWWWWONBO",
        ".OCOWWWWWWWGGGWWWWWWOOBO",
        ".OSOWWWWWWGGGGGWWWWWOOO.",
        ".OOOCCCCCCCCCCCCCCCCO...",
        "...OWWWWWWWGGWWWWWWWO...",
        "...OAAAAAAAAAAAAAAAAO...",
        "...OWWWWWWWWWWWWWWWWO...",
        "...OAAAAAAAAAAAAAAAAO...",
        "....OAAAAAAAAAAAAAAO....",
        "...OCCCCCCCCCCCCCCCCO...",
        "....OCCCCCCCCCCCCCCO....",
        "......OUUUUO.OUUUO......",
        "......OUUUUO.OUUUO......",
        "......OUUUUO.OUUUO......",
        "......OUUUUO.OUUUO......",
        "......OFFFFO.ORRRO......",
        "......OFFFFO..ORO.......",
        "........................",
        "........................"
      ],
      // Sentry bot, mobile — Arc Sentinel: single big optic, a visible
      // thruster glow spreading below the chassis so it clearly reads as
      // an active hovering drone (Security Turret below is the planted
      // counterpart -- same lens/body, a tripod mount instead of a glow).
      sentryBotMobile: [
        "................",
        "......OOOO......",
        ".......VV.......",
        "......OEEO......",
        ".....OEEEEO.....",
        "....OOOOOOOO....",
        "...OBBBBBBBBO...",
        "..OBBBBBBBBBBO..",
        "..ABBBBBBBBBBA..",
        "...OBBBBBBBBO...",
        "....OOOOOOOO....",
        ".....VVVVVV.....",
        "....EVVVVVVE....",
        ".....EEEEEE.....",
        "................",
        "................"
      ],
      sentryBotFixed: [
        "................",
        "......OOOO......",
        ".......VV.......",
        "......OEEO......",
        ".....OEEEEO.....",
        "....OOOOOOOO....",
        "....OBBBBBBO....",
        "....OBBBBBBO....",
        "....OBBBBBBO....",
        ".....OAAAAO.....",
        ".......OAO......",
        ".....A.OA.A.....",
        "....A..AA..A....",
        "...OOOOOOOOOO...",
        "................",
        "................"
      ],
      // Heavy mech — Security Mech: a blocky armored robot, one wide visor
      // band (no separate eyes, unlike the organic officer shape), a
      // shoulder cannon reading as the heavy weapon. (The Warden used to
      // share this shape recolored — replaced 2026-07-25 by its own bespoke
      // wardenCore shape, see below.)
      // Heavy mech — Security Mech, TOTAL REBUILD: no longer "a person in
      // armor plate." A narrow hexagonal chassis (not a humanoid chest), a
      // single glowing sensor lens (not a human-like visor face), a full
      // boxy rocket pod (two tube openings) replacing one arm entirely, a
      // bold triangular blade replacing the other, stubby wide tank legs,
      // hazard-stripe accents. Rendered larger than default elite scale
      // via SHAPE_SCALE_OVERRIDE (ui.js) — meant to look imposing.
      heavyMech: [
        "................",
        "......ONNO......",
        ".....OHHHHO.....",
        ".....OHHVVO.....",
        "OAAOOCCCCCCO....",
        "OHHOHHHHHHHHOPPO",
        "ONHOAAVVVVAAOPP.",
        "OHHOHHHHHHHHOKP.",
        "ONHOKKNNNNKKOK..",
        "OAAOOAAAAAAOK...",
        ".....OAAAAO.....",
        "....ONN.NNO.....",
        "....ONN.NNO.....",
        "...OFFFFFFFO....",
        "...OOOOOOOOO....",
        "................"
      ],
      // Warden Core — "AI Sentinel Core" redesign (2026-07-25 sprite pass):
      // no longer the same heavyMech chassis as Security Mech. A hovering
      // core orb — antenna, a blazing lens set in a wide red sensor band,
      // four asymmetric mechanical tendrils instead of legs (two short
      // outer, two longer inner, one with a spark accent) — reads as "the
      // station's mind," not a bigger trooper. 22x22, rendered smaller than
      // the default boss tier scale via SHAPE_SCALE_OVERRIDE so its wider
      // grid doesn't dwarf the other bosses.
      // Legend: O outline | X antenna tip | P dome highlight H dome N dome-shadow
      //   V sensor band (red) E lens core (hot white) | C vents
      //   A tendril B tendril-shadow(S) G tendril-tip/glow R spark accent
      wardenCore: [
        "......................",
        "..........XX..........",
        ".........OXXO.........",
        ".......OPPPPPPO.......",
        ".....OPPHHHHHHPPO.....",
        "....OHHHHHHHHHHHHO....",
        "...ONNHHHHHHHHHHNNO...",
        "...OVVVVVVVVVVVVVVO...",
        "...OVVVVVEEEEVVVVVO...",
        "...ONNHHHHHHHHHHNNO...",
        "....OHHHCHHHHCHHHO....",
        ".....OHHHHHHHHHHO.....",
        "......OHHHHHHHHO......",
        "......A..A..A..A......",
        "......A..S..S..A......",
        "......G..S..S..G......",
        ".........S..S.........",
        ".........S..R.........",
        ".........G..S.........",
        "............S.........",
        "............G.........",
        "......................"
      ],
      // Hive brute — Erebus Warrior (standard) ONLY now (Armored Warrior
      // split into its own hiveBruteArmored shape below, per the "genuine
      // silhouette per tier" direction). Broodmarshal DNA: glowing eyes,
      // ribbed thorax, pincer claw-arms (pale highlight I + dark chitin K)
      // pushed out from the body with a visible pincer opening.
      hiveBrute: [
        "................",
        "......OHHO......",
        ".....OHHHHO.....",
        ".....OVHHVO.....",
        ".....OCCCCO.....",
        "..O.OHHHHHHOO...",
        ".OIOCCCCCCCCOIO.",
        "OKKOHHHHHHHHOKKO",
        "IK.OCCCCCCCCO.KI",
        "OK............KO",
        "....OBBBBBBO....",
        "....OBBBBBBO....",
        ".....OAAAAO.....",
        "....L.L..L.L....",
        "................",
        "................"
      ],
      // Hive brute, armored — Erebus Armored Warrior (elite). Same fighter-
      // caste DNA, visibly bulkier: wider plated shoulders, bigger pincers.
      hiveBruteArmored: [
        "................",
        "......OHHO......",
        ".....OHHHHO.....",
        ".....OVHHVO.....",
        "....OCCCCCCO....",
        "..OCCCCCCCCCCO..",
        "OOHHHHHHHHHHHHO.",
        "IOCCCCCCCCCCCCOI",
        "KKOHHHHHHHHHHOKK",
        "OIK..........KIO",
        ".OK..........KO.",
        "...OBBBBBBBBO...",
        "...OAAAAAAAAO...",
        "....OAAAAAAO....",
        "...L..L..L..L...",
        "................"
      ],
      // Hive mystic — Erebus Shaman: an insectoid caster, carapace mantle
      // (not cloth) with big sweeping antennae -- the fighters have none,
      // this is the "hive-sense" psionic-caste read -- mandibles peeking
      // out from under the mantle, glowing psi orb (V) held to one side.
      hiveMystic: [
        "...A........A...",
        "....A.OHHO.A....",
        ".....OHHHHA.....",
        "....OHHHHHHO....",
        "....OKKVVKKO....",
        "...OAAAAAAAAO...",
        "..OBBBBBBBBBBO..",
        "..OAAKAAAAKAAO..",
        ".OVOOBBBBBBO....",
        "..OVOOBBBBO.....",
        ".....OAAAAO.....",
        ".....L.LL.L.....",
        "....L......L....",
        "................",
        "................",
        "................"
      ],
      // Hive lord — the Broodmarshal (boss). REDESIGNED 2026-07-26: a
      // Starship Troopers-style "Reared Warrior Bug" — genuinely insectoid
      // rather than the original humanoid-with-bug-features silhouette.
      // Compound eyes, crossing mandibles, segmented chitin plates on the
      // thorax/abdomen, big raised scythe-claws flanking the body
      // (attaching flush at the thorax — core padding zeroed at rows 10-12
      // specifically so the claw touches, same discipline Chthon's wings
      // needed a second pass to learn), smaller jointed flanking legs
      // lower down, two hind legs planted at the base. Its palette still
      // gives one collar patch a cold-metal tone — the fused Vossmark
      // control rig from its story canon (§5.3) — same detail as before,
      // just carried over into the new silhouette.
      // Legend: O outline | H chitin base K chitin highlight J chitin shadow
      //   E compound eye F eye facet-highlight M mandible C cold-metal rig collar
      //   S claw blade X claw edge highlight L leg segment
      hiveLord: [
        "........................................",
        "..................OHHO..................",
        ".................OHHHHO.................",
        "...............OHHKKKKHHO...............",
        "..............OEEEHHHHEEEO..............",
        ".............OFFEHHHHHHEFFO.............",
        "........X....OHHHHHHHHHHHHO....X........",
        ".......XX....OMMMMHHHHMMMMO....XX.......",
        ".....XSSX..OCCCCCCCCCCCCCCCCO..XSSX.....",
        "...XSSSSX.OHHHHHHHHHHHHHHHHHHO.XSSSSX...",
        ".XSSSSSSXOKKJJJJJJJJJJJJJJJJKKOXSSSSSSX.",
        "XSSSSSSSXOHHHHHHHHHHHHHHHHHHHHOXSSSSSSSX",
        "XSSSSSSSXOHHHHHHHHHHHHHHHHHHHHOXSSSSSSSX",
        "..XSSSSSX.OKKJJJJJJJJJJJJJJKKO.XSSSSSX..",
        "..........OHHHHHHHHHHHHHHHHHHO..........",
        "...........OHHHHHHHHHHHHHHHHO...........",
        "......OLL....OKJJJJJJJJJJKO....LLO......",
        ".....OLL....OHHHHHHHHHHHHHHO....LLO.....",
        "....OLL.......OKJJJJJJJJKO.......LLO....",
        "...............OHHHHHHHHO...............",
        "................OHHHHHHO................",
        "...............LL.HHHH.LL...............",
        "..............LLL..HH..LLL..............",
        "..............LLL......LLL.............."
      ],
      // Overseer Voraxx (boss) — "Ledger & Lash" redesign (2026-07-25 sprite pass,
      // v2 — replaces the original whip-overhead version). A jowly, mustached
      // tyrant in an officer's coat: gold-trimmed cap, rank tufts on the
      // shoulders, a chest medal, a haul-quota ledger gripped in his left hand
      // and a coiled whip held (not mid-crack) in his right — ties into his
      // established "annoyed at the paperwork" lore beat rather than a generic
      // action pose. 32x24, widened from the original 23x22 so the arm/prop
      // geometry gets real space instead of fighting the belly for pixels;
      // rendered via a scale override (§ui SHAPE_SCALE_OVERRIDE, now 4x not 5x).
      // Legend: O outline | P cap crown, Q cap brim gold, V cap band gold
      //   S skin, K forehead highlight, D jowl-shadow, E eye, W eye-white, M mustache
      //   H shoulder tufts, C collar/medal (gold)
      //   B coat base, L coat highlight, A coat shadow
      //   J ledger cover, I ledger page-edge | G whip grip, N whip coil (rope)
      //   R red sash | T pants U boot-shadow
      voraxxFat: [
        "................................",
        "............OPPPPPPO............",
        "..........OPPQQQQQQPPO..........",
        ".........OVVVVVVVVVVO...........",
        ".........OSSKKKKKKSSO...........",
        "........OSSDEWSSWEDSSO..........",
        "........OSSSSSSSSSSSSO..........",
        ".......OSSMMMMMMMMMMSSO.........",
        ".......ODDDSSSSSSSSDDDO.........",
        "......ODDDDSSSSSSSSDDDDO........",
        "......OHHCCCCCCCCCCCCCCCCHHO....",
        ".....OLLBBBBBBBBBBBBBBBBAAO.....",
        "..BLOLLLBBBBBBBBBBBBBBBBAAAOLB..",
        ".BLLOLLLBBBBBBCCCCBBBBBBAAAOLLB.",
        "OJJJOLLLBBBBBBBBBBBBBBBBAAAOGGGO",
        "OJIJOLLLBBBBBBBBBBBBBBBBAAAONNGO",
        "OJJJOBBBBBBBBBBBBBBBBBBBBBBONNNO",
        "OJJJ.OBBBBBBBBBBBBBBBBBBBBO..NGO",
        "O....ORRRRRRRRRRRRRRRRRRRRO....O",
        "......OBBBBBBBBBBBBBBBBBBO......",
        ".......OLLLLLLLLLLLLLLLLO.......",
        "........OTTTTTTTTTTTTTTO........",
        ".........OTTTTTOOTTTTTO.........",
        ".........OUUUUUOOUUUUUO........."
      ],
      // Proteus (D4 boss) — "Open Bloom" v2 (2026-07-25 sprite pass, revised
      // once per feedback: taller/detailed face, torso-to-mass transition
      // broken up with asymmetric jagged growth instead of a clean skirt-
      // like cone, and both the wrong-arm and lower limbs made bigger/
      // clawed). A half-transcended bio-executive: composed human face over
      // an open suit jacket, chest already peeled around a glowing
      // bio-plasma core (his "Proteus Bloom" special, made a permanent
      // visual signature), one arm replaced by a maroon chitin claw
      // ("something that used to be an arm"), lower body an amorphous
      // asymmetric bio-mass with differentiated clawed limbs instead of legs.
      // Legend: O outline | H hair S skin D brow/jaw-shadow E eye M mouth C collar
      //   L lapel highlight B suit/jacket A jacket-shadow
      //   P peeled chest plate G bloom glow (amber, ties to his Thermal Bloom)
      //   W wrong-arm chitin X arm highlight N claw-tip/dark accent
      //   T bio-mass U bio-mass shadow R vein accent
      proteusBloom: [
        ".................................",
        "...........OHHO..................",
        ".........OHHHHHHO................",
        "........OHHSSSSHHO...............",
        ".......OSDDDDDDDDSO..............",
        ".......OSSESSSESSO...............",
        ".......OSSSSDSSSSO...............",
        ".......OSSSMMMSSSO...............",
        ".......ODDSSSSSSDDO..............",
        ".......OCCCSSSSCCCO..............",
        ".......OLLBBBBBBBBBBBBLLO.BWW....",
        ".......OLLBBBPPPPPPBBBLLO.WWWWW..",
        ".......OBBBBPPGGGGPPBBBBO.WXXXW..",
        ".......OBBBBPPPGGPPPBBBBO.WWNWW..",
        ".....OAAAPPPPPPPPPPPPAAAO.WNNNW..",
        ".....OAAABBBBBBBBBBBBAAAO..WNNW..",
        ".....OAABBBBBBBBBBBBBBAAO..WNO...",
        "..TTOBBBBBBBBBBBBBBBBO......NO...",
        ".TTTOTTBBBBBBBBBBBBTTO......N....",
        ".TTTOTTTTBBBBBBBBTTTTOT..........",
        ".TTTOTTTTTTBBBBBTTTTTTOTT........",
        ".TTTOTTTTTTTTTTTTTTTTTTTOT.......",
        ".TTOTTTTTTTTTTTTTTTTTTOTTT.......",
        "..TTTTT...TTTTTTTT...TTTTT.......",
        "...TTTT....TTTTTTT.....TTT.......",
        "....UUU.....TTTTTT......TT.......",
        ".............TTTTT.......T.......",
        ".............UUUU........T......."
      ],
      // Void Soul Eater (D5 double-boss, gatekeeper half) — "Wrong-Angle
      // Maw" v2 (2026-07-25 sprite pass, revised once per feedback: the jaw
      // now visibly flares via a bone-toned bridge connecting hood to mouth
      // instead of reading as two disconnected pieces, teeth are chunkier/
      // tighter interlocking blocks, added a brow ridge + nose-bridge hint,
      // and the robe has real fold-shadow/rim-light dimension). A near-
      // featureless hooded void-wraith whose jaw flares wider than its own
      // hood into a jagged sawtooth maw — direct payoff of its own skill
      // flavor text ("a maw that shouldn't fit inside its own silhouette").
      // Tattered cloth streamers instead of legs, uneven lengths, no clean hem.
      // Legend: O outline | H hood K hood-highlight J hood-interior/shadow
      //   R brow-ridge V/E eyes (asymmetric) N jaw bone-tone
      //   M teeth (dark) G mouth-glow interior | C collar
      //   B robe base L robe rim-light A robe-shadow D fold-shadow accent
      //   T tattered hem U hem-shadow
      voidSoulEaterMaw: [
        "............................",
        "...........OHHHHO...........",
        ".........OHHKKKKHHO.........",
        ".......OHHKKKKKKKKHHO.......",
        "........OJRRJJJJRRJO........",
        ".......OJJVVJJJEJJO.........",
        "........OJJJKKJJJO..........",
        "......ONNJJJJJJNNO..........",
        "....ONNNJJJJJJJJNNNO........",
        "..ONNNNJJJJJJJJJJJJJJNNNNO..",
        "..OMMMGGGMMMGGGMMMGGGMMMGO..",
        ".OGGGGGGGGGGGGGGGGGGGGGGGGO.",
        "..OGGGMMMGGGMMMGGGMMMGGGMO..",
        "......ONNNJJJJJJJJNNNO......",
        "........OCCCCCCCCCCO........",
        ".........OCCCCCCCCO.........",
        ".......OLLBBBBBBBBBBBBAAO...",
        "......OLLBBBDDDDDDDDBBBAAO..",
        ".....OLLBBBBBBBBBBBBBBAAAO..",
        "....OLBBBBDDDDDDDDBBBAAAO...",
        "...OBBBBBBBBBBBBBBBBBBBBAAAO",
        "..OBBBDDDDDDDDDDBBBBBBAAAO..",
        ".OAAABBBBBBBBBBBBBBBBBBAAAAO",
        "OAAAABBBBBBBBBBBBBBBBAAAAAAO",
        "TTOAAABBBBBBBBBBBBBBAAAAAOTT",
        "TTT.OBBBBBBBBBBBBBBBBO.TTTTT",
        ".....TTT...TTTT....TTTT...TT",
        ".....UUU...TTT......TTT...TT"
      ],
      // ---------- VOID WRAITH TRIO (§5.4b) ----------
      // Poltergeist (fodder) / Shade (standard) / Terror (standard) —
      // anchored to the Void Soul Eater boss just above (hooded wraith, a
      // maw wider than its own hood, tattered cloth streamers instead of
      // legs) via its EXACT palette hex values, so the trash family reads
      // as unmistakably the same species as the boss, not just "also
      // purple" — same role Broodmarshal played for Erebus and Phthora/
      // Proteus played for Talos Specimen. External anchor: the FF Kraken/
      // Gigas Worm reference images (tentacle-mass horrors, no legs) plus
      // the general pixel-art-horror lesson that unnatural asymmetric
      // silhouettes read scarier than surface detail. All 24x32 (was
      // built directly at hero-scale this time, per the pattern already
      // set with Splice Husk/Bio-Tank/Chimera Specimen).
      // Poltergeist — the LEAST substantial of the trio on purpose: a
      // small floating scrap of torn cloth high in the frame, thin
      // reaching cloth-tendril arms (restlessGrasp), no legs at all, most
      // of the canvas deliberately left empty (the "barely here" read,
      // same technique as keeping Talos Wraith/Erebus Roach simpler than
      // their standard/elite kin).
      poltergeistWisp: [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "..........OHHO..........",
        ".........OHHHHO.........",
        ".........OVJJVO.........",
        ".........OJJJJO.........",
        "..........OJJO..........",
        "..........OHHO..........",
        ".........OHHHHO.........",
        "......OTTHHHHHO.........",
        ".....OUUUHHHHTTTO.......",
        ".........OHHHHUUUO......",
        "..........OHHHO.........",
        "..........OTTO..........",
        ".........OU..UO.........",
        ".........O....O.........",
        ".............OU.........",
        ".............U..........",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................"
      ],
      // Shade — a proper hooded wraith, one tier up from Poltergeist:
      // fuller robe, real hood, glowing eyes. One arm ends in a fused
      // umbral shadow-blade (umbralCut, angled off centerline — Dread
      // Knight convention), the other in a withered skeletal claw-hand
      // (witherTouch) — asymmetric, matching the "one arm normal, one
      // arm weapon" convention used across this whole pass. Tattered hem
      // instead of legs (family rule).
      shadeWraith: [
        "........................",
        "........................",
        ".........OHHHHO.........",
        "........OHHHHHHO........",
        ".......OKKKKKKKKO.......",
        ".......OJJVJJVJJO.......",
        ".......OJJJJJJJJO.......",
        "........OHHHHHHO........",
        ".........OKKKKO.........",
        "......OBBBBBBBBBBO......",
        ".....OBBBBBBBBBBBBO.....",
        ".....OBBBBBBBBBBBBON....",
        "....OOBAAAAAAAAAABONN...",
        ".....OBBBBBBBBBBBBOONN..",
        ".....OBBBBBBBBBBBBO.ONN.",
        ".....OBAAAAAAAAAABO..ON.",
        "....ONNBBBBBBBBBBBO.....",
        "...ONNOBBBBBBBBBBBO.....",
        "..ONNNOAAAAAAAAAABO.....",
        "..ONNOBBBBBBBBBBBBO.....",
        "...OO.OTTTTTTTTTTO......",
        "......OTTTUTTTUTTO......",
        "......OTT..TT..TTO......",
        ".......U...U....U.......",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................"
      ],
      // Terror — no head, no eyes; the whole upper body IS a screaming
      // maw (hollowScream), the most "wrong"/mindless of the trio (also
      // resists Psionic in its stats — fittingly, nothing there to
      // target). Squat, hunched, asymmetric (creepingDread) with
      // clustered short reaching tendrils instead of two clean arms — the
      // direct Kraken/Gigas Worm callback. Mouth-glow reuses Void Soul
      // Eater's own mouth-glow hex and its interlocking-teeth-block
      // pattern (a flat glow slot read as a visor, not a mouth, before
      // this fix).
      terrorMaw: [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........OHHHHHHHHO......",
        "......OKKKKKKKKKKKKO....",
        ".....OHHHHHHHHHHHHHHO...",
        ".....OHHHMMGGMMGGHHHO...",
        ".....OHHHGGGGGGGGHHHO...",
        ".....OHHHGGMMGGMMHHHO...",
        "......OHHHHHHHHHHHHO....",
        ".......OKKKKKKKKKKO.....",
        ".....OBBBBBBBBBBBBBO....",
        "....OBBBBBBBBBBBBBBBO...",
        "..ONOBBBBBBBBBBBBBBBONO.",
        ".ONNOBAAAAAAAAAAAAABNNO.",
        "..ONOBBBBBBBBBBBBBBBONO.",
        "....OBAAAAAAAAAAAAABONO.",
        "....OBBBBBBBBBBBBBBBO...",
        "...OTTTTTTTTTTTTTTTTTO..",
        "....OTTTTUUUUUUUTTTTO...",
        ".....OUUUUO....OUUUO....",
        "......U..........U......",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................"
      ],
      // ---------- VOID ELITE TRIO (§5.4b) ----------
      // Void Horror / Demon / Devil — same Void Soul Eater palette family
      // as the wraith trio above, but these three start foreshadowing
      // BOTH bosses directly (the eclipse patch and the stolen corona
      // reach toward Void Soul Eater and the Sun God respectively) — the
      // biggest/most detailed unit in every prior family has been the one
      // to pay off the most reference, same pattern here.
      // Void Horror — Kraken-anchored (tentacle-mass body, no legs, a
      // huge fanged mouth). Its doubly-weak-Thermal "bring the Mech
      // Runner" fight gets the family's first direct boss foreshadow: a
      // small "eclipse" patch on the chest (black disc in a violet ring,
      // mirroring the Sun God's own corona-and-eclipsed-disc face) — the
      // visual payoff of consumeLight as an ANTI-glow instead of the glow
      // accent every other faction has used.
      abyssalClaw: [
        "........................",
        ".........OHHHHO.........",
        ".......OHHHHHHHHO.......",
        "......OKKKKKKKKKKO......",
        "......OJJJVJJVJJJO......",
        "......OHHHHHHHHHHO......",
        ".....OMMMGMGMGMMMMO.....",
        ".....OGGGGGGGGGGGGO.....",
        "......OMMGMGMGMKKO......",
        ".......OHHHHHHHHO.......",
        "...OHOBBBBBBBBBBBBOOH...",
        "..OHHBBBBBBBBBBBBBBHHHO.",
        ".OKKOBBBOVVVVVOBBBBOKKKO",
        "OKKOOBBBVMMMMMVBBBBOOKKO",
        "NNO.OBBBVMMMMMVBBBBO.ONN",
        "OO..OBBBOVVVVVOBBBBO..OO",
        "....OBBBBBBBBBBBBBBO....",
        "....OBAAAAAAAAAAAABO....",
        "....OBBBBBBBBBBBBBBO....",
        "....OBBBBBBBBBBBBBBO....",
        ".....OAAAAAAAAAAAAO.....",
        "...OHHHHOHHHHOHHHHHO....",
        "...OKKKKOKKKKOKKKKKO....",
        "......OHOH.OHOH.OH......",
        "......HKHK.HKHK.HK......",
        "......HKHK.HKHK.HK......",
        "......OOOO.HKHK.HK......",
        "...........OOOO.HK......",
        "................OO......",
        "........................",
        "........................",
        "........................"
      ],
      // Demon — more upright/humanoid than Void Horror: asymmetric
      // chitin-spike horns (same technique as Talos Vanguard's shoulder
      // spike), reaching claws (clawRake), and a glowing orange hellbrand
      // mark on the chest (hellbrand) — the ONE unit in the whole Void
      // family with an actual glow accent instead of an anti-glow, for
      // the "burning horror" flavor.
      demonBrand: [
        ".......ON...............",
        "......ONNOOHHO...ON.....",
        "......NNOHHHHHHHHOO.....",
        ".......OKKKKKKKKKO......",
        ".......OJJVJJVJJJO......",
        ".......OJJJJJJJJJO......",
        "........OHHHHHHHO.......",
        ".........OKKKKKO........",
        ".....OKKKKBBBBBBKKO.....",
        "....OKKKKKBBBBBBKKO.....",
        "..NOOBBBBBBBBBBBBBBO....",
        "...NOBAAAAAAAAAAAABO....",
        "..ONOBBBBBBBBBBBBBBO....",
        ".ONNOBBBBOFFFOBBBBBO....",
        "ON..OBAAAFFFFFAAAABO....",
        "....OBBBBOFFFOBBBBBO....",
        "....OBBBBBBBBBBBBBBO....",
        "....OBAAAAAAAAAAAABO....",
        "....OBBBBBBBBBBBBBBOONN.",
        "....OBBBBBBBBBBBBBBONNO.",
        "....OAAAAAAAAAAAAAAONN..",
        "....OBBBBBBBBBBBBBBO....",
        "......OHHHHOOHHHHO......",
        "......OHHHHOOHHHHO......",
        "......OHHHHOOHHHHO......",
        "......OHHHHOOHHHHO......",
        "......OHHHHOOHHHHO......",
        "......OJJJJOOJJJJO......",
        "......OJJJJOOJJJJO......",
        "......OJJJJOOJJJJO......",
        "......OJJJJOOJJJJO......",
        "........................"
      ],
      // Devil — "tormentor caste," the most direct boss foreshadow of the
      // family: a cracked fragment of the Sun God's own corona worn like
      // a stolen crown (damnationDecree — authority/command), gold reused
      // from the Sun God's exact palette. A fused coiled lash-whip
      // extends from one arm in a winding S-curve (tormentLash — not
      // held, avoids the floating-prop problem). Leaner/taller than
      // Demon for a "cruel overseer" read rather than a brute.
      devilCrown: [
        ".........Y....Y.........",
        "........OYHHHHYO........",
        ".......OHHHHHHHHO.......",
        ".......OKKKKKKKKO.......",
        ".......OJJVJJVJJO.......",
        ".......OJJJJJJJJO.......",
        "........OHHHHHHO........",
        ".........OKKKKO.........",
        "......OBBBBBBBBBBO......",
        "....ONBBBBBBBBBBBBON....",
        "....NOBAAAAAAAAAABO.N...",
        "....NOBBBBBBBBBBBBO..N..",
        "....OOBBBBBBBBBBBBO..N..",
        ".....OBAAAAAAAAAABO.N...",
        ".....OBBBBBBBBBBBBON....",
        ".....OBBBBBBBBBBBBON....",
        ".....OBAAAAAAAAAABO.N...",
        ".....OBBBBBBBBBBBBO..N..",
        ".....OBBBBBBBBBBBBO..N..",
        ".....OBAAAAAAAAAABO.N...",
        ".....OBBBBBBBBBBBBO.O...",
        ".....OAAAAAAAAAAAAO.....",
        "......OHHHHHHHHHHO......",
        "........OHHHOOHHHO......",
        "........OHHHOOHHHO......",
        "........OHHHOOHHHO......",
        "........OHHHOOHHHO......",
        "........OHHHOOHHHO......",
        "........OJJJOOJJJO......",
        "........OJJJOOJJJO......",
        "........OJJJOOJJJO......",
        "........................"
      ],
      // Sun God (D5 double-boss, corrupted-regulator half) — "Eclipse Face"
      // v2 (2026-07-25 sprite pass, revised once per feedback: the head is
      // now a literal circular ring with a floating black disc inside it
      // and a visible gap between them, replacing the fused oval-band v1;
      // also added real body dimension — asymmetric shoulder highlights, a
      // fold-shadow band, the dark seam accent). A blazing solar corona
      // (jagged ray crown, golden ring) surrounds a face that's just an
      // eclipsed black disc — no god there, just light hiding a hole.
      // Bronze statuesque body with a subtle dark seam (the "it's a
      // machine" tell — Eclipse Protocol's Disable is the mechanical
      // reveal) and flame-lick tendrils instead of legs, distinct from Void
      // Soul Eater's cloth streamers despite sharing the double-boss slot.
      // Legend: O outline | Y corona ring gold W corona hot-core R ray-shading
      //   K eclipsed disc (black) | C neck/collar
      //   B statue body base L body rim-light A body-shadow
      //   N machine-seam accent D fold-shadow | F flame-lick base U flame-shadow
      sunGodEclipse: [
        "............................",
        "............Y..Y............",
        "..........Y..YY..YY..Y......",
        "..........OYYYYYYO..........",
        ".........OYYYYYYYYO.........",
        "........OYYYYYYYYYYO........",
        ".......OYYY......YYYO.......",
        ".......OYY........YYO.......",
        "......OYY...OKKO...YYO......",
        "......OYY..OKKKKO..YYO......",
        "......OYY..OKKKKO..YYO......",
        "......OYY..OKKKKO..YYO......",
        "......OYY...OKKO...YYO......",
        ".......OYY........YYO.......",
        ".......OYYY......YYYO.......",
        "........OYYYYYYYYYYO........",
        ".........OYYYYYYYYO.........",
        "..........OYYYYYYO..........",
        ".........OCCCCCCCCO.........",
        "........OCCCCCCCCCCO........",
        ".....OLLFFBBBNNNNBBBFFLLO...",
        "....OLLBBBBDDNNDDBBBBAAAO...",
        "....OLLBBBBBBDDDDBBBBBBAAO..",
        "...OLLBBBBBBBBBBBBBBBBBAAO..",
        "....OBBBDDDBBBBBBBDDDBBBO...",
        ".....OBBBBBBBBBBBBBBBBAO....",
        "......OBBBBBBBBBBBBBBO......",
        ".......OFFFFFFFFFFFFO.......",
        ".......FOFFFUUUUUFFFOF......",
        ".........FF..FFFF....FFFF..F"
      ],
      // Phthora, the Fleshspring (D6 boss, Talos's leader/origin-point) —
      // "The Reaching Wreck" (2026-07-25/26 sprite pass). A gaunt, hollow-
      // eyed figure frozen mid-ritual, both arms outstretched (one ending
      // in an open hand, the other a half-formed hybrid tip — "hands still
      // deciding what they want to be"), a wide bioluminescent-green
      // rupture across the chest ("ruptures into something that was never
      // meant to finish becoming"), and root-tendrils fusing him to the
      // ground instead of legs — kneeling/rooted at the ritual site rather
      // than standing. Deliberately differentiated from Proteus (D4's
      // already-shipped "humanoid + wrong limb" boss): cooler decayed
      // tones instead of warm amber, TWO reaching arms instead of one,
      // rooted/kneeling base instead of clawed mobile limbs.
      // Legend: O outline | H patchy hair S gaunt skin D sunken-cheek shadow E hollow eye
      //   C ritual wrap/collar | B torso base A torso/lower shadow
      //   P rupture-edge G bioluminescent glow (green)
      //   W/X arm skin+highlight M hand tip N hybrid "still deciding" tip
      //   R root tendril U root shadow
      phthoraWreck: [
        "..................................",
        "..............OHHHHO..............",
        ".............OHHSSHHO.............",
        "............OSDESSEDSO............",
        "...........ODDSSSSSSDDO...........",
        "...........ODDDSSSSDDDO...........",
        "............OCCCCCCCCO............",
        "...WWBOCCBBBBBBBBBBBBBBBBCCOBWW...",
        "...WWWOBBBBBBBBBBBBBBBBBBBBOWWW...",
        "...WXWOBBBBPGGGGGGGGGGPBBBBOWXW...",
        "...MMOOBBBPGGGGGGGGGGGGPBBBONNO...",
        "....MOOAAAAAAAPGGGGPAAAAAAAOON....",
        "........OAAAAAAAAAAAAAAAAO........",
        ".........OAAAAAAAAAAAAAAO.........",
        "..........OAAAAAAAAAAAAO..........",
        "..........ROAAAAAAAAAAOR..........",
        "..........RROAAAAAAAAORR..........",
        "..........RRROAAAAAAORRR..........",
        ".......RRRRUU..AAAA..UURRRR.......",
        ".......RRRRRUUU....UUURRRRR......."
      ],
      // The Caged God (D6b double-boss, phase 1) — "The Cracking Cocoon"
      // (2026-07-26 sprite pass). A large crystalline-organic containment
      // shell, cracked and glowing from within (void-purple wisps, two
      // glimpse-glow windows where something vast peeks through — pays off
      // its own "lashes out with something that hasn't fully arrived yet"
      // flavor), held down by mechanical restraint bands with amber
      // warning-light accents ("widens a crack in whatever was holding
      // it"). Deliberately non-humanoid, unlike every other boss so far —
      // sets up Chthon (phase 2, §SPRITE_SHAPES chthonBreach) shattering
      // this cocoon open and fusing with Kredex.
      // Legend: O outline | H shell base K shell-facet-highlight J shell-shadow
      //   C crack-glow (void-purple) G glimpse-glow (near-white, "the vast thing")
      //   B restraint band A band-shadow V warning-light (amber) N chain-stub anchor
      cagedGodCocoon: [
        "..........................",
        "..........OHHHHO..........",
        "........OHHKKKKHHO........",
        "......OHHCCKKKKKKHHO......",
        ".....OHHHCKKKCHHHKKKO.....",
        "...OHHGGGCKKKKHHHHCHHO....",
        "...OHHHCHHHHHHCKKKCHHO....",
        "...OKKKKCHHHHGGGGCHHHO....",
        "...OHHHHHCHHHHHHHHCKKKO...",
        "..OKKKCHHHHHHHHHHHHHHCHO..",
        "...OHHHHHHHHHHHHHHHHHHO...",
        "....OJJHHHHHHHHHHHHJJO....",
        ".....OJJJHHHHHHHHJJJO.....",
        "......OJJJJJJJJJJJJO......",
        "..N.BBAAVBBBBBBBBVAABB.N..",
        "...N.BBBBBBBBBBBBBBBB.N...",
        ".......BBBBBBBBBBBB.......",
        "...N.BBVAAAAAAAAAAVBB.N...",
        "....N.BBBBBBBBBBBBBB.N....",
        ".......NN........NN......."
      ],
      // Chthon, God of the Breach (D6b double-boss, phase 2 — the TRUE
      // final boss of the whole game) — "Dimension-Dragon" v3 (2026-07-26
      // sprite pass, 2 revision rounds). Evolves directly from the Caged
      // God: a draconic head (asymmetric glowing eyes — the "almost human
      // fighting for control" tell), Kredex's broken ritual rig worn as a
      // collar (same restraint-band motif/palette as the Caged God's
      // bindings, now a trophy instead of a cage), a single clean glowing
      // chest crack, and shattered cocoon shell shards at the base. Big
      // rib-striped, jagged-edged void-tear wings flow directly into the
      // shoulders at zero padding (rows 9-17 widened to 0 leading/trailing
      // specifically so the wing membrane visibly touches the body — v1/v2
      // had the wings floating because the body rows kept blank padding
      // even at full wing width; width alone doesn't guarantee a visual
      // touch, the body-side padding has to close too).
      // Legend: O outline | Z horn H head-crest D eye-socket-shadow R eye (red-orange)
      //   M/T jaw+teeth (T is its own color, deliberately NOT shared with the chest-crack G)
      //   J neck | N/B/A/V broken rig collar (reused from cagedGodCocoon's restraint bands)
      //   A body-shadow (void-black) G chest-crack glow (single streak) K/H shell-shard debris
      //   K/W (in the wing) rib/membrane striping | C wing-tip glow accent (only 2 rows, not scattered)
      chthonBreach: [
        "............................................................",
        "............................Z..Z............................",
        "...........................ZZ..ZZ...........................",
        "..............OK.........OHHHHHHHHO.........KO..............",
        ".............OKW........OHHDDHHDDHHO........WKO.............",
        "..........OKWWKK.......OHHRRRRHHRRHHO.......KKWWKO..........",
        ".........OKWWKKW.....OHHHHHHHHHHHHHHHHO.....WKKWWKO.........",
        "......OKWWKKWWKK....OMMTTMMTTMMTTMMTTMMO....KKWWKKWWKO......",
        ".....OKWWKKWWKKW....OJJJJJJJJJJJJJJJJJJO....WKKWWKKWWKO.....",
        "..CKWWKKWWKKWWKKOJJJJJJJJJJJJJJJJJJJJJJJJJJOKKWWKKWWKKWWKC..",
        "...OKWWKKWWKKWWKOJJJJJJJJJJJJJJJJJJJJJJJJJJOKWWKKWWKKWWKO...",
        "OKWWKKWWKKWWKKWWOJJJJJJJJJJJJJJJJJJJJJJJJJJOWWKKWWKKWWKKWWKO",
        "..OKWWKKWWKKWWKKOJJJJJJJJJJJJJJJJJJJJJJJJJJOKKWWKKWWKKWWKO..",
        "....OKWWKKWWKKWWN.BBAAVBBBBBBBBBBBBBBVAABB.NWWKKWWKKWWKO....",
        "..OKWWKKWWKKWWKKN.BBBBBBBBBBBBBBBBBBBBBBBB.NKKWWKKWWKKWWKO..",
        "CKWWKKWWKKWWKKWWBBBBBBBBBBBBBBBBBBBBBBBBBBBBWWKKWWKKWWKKWWKC",
        "..OKWWKKWWKKWWKKN.BBVAAAAAAAAAAAAAAAAAAVBB.NKKWWKKWWKKWWKO..",
        "....OKWWKKWWKKWWOAAAAAAAAAAAAAAAAAAAAAAAAAAOWWKKWWKKWWKO....",
        ".......OKWWKKWWK.OAAAAAAAAAAAAAAAAAAAAAAAAO.KWWKKWWKO.......",
        "........OKWWKKWW.OAAAAAAAAAAAGGAAAAAAAAAAAO.WWKKWWKO........",
        "..........OKWWKKOAAAAAAAAAAAAGGAAAAAAAAAAAAOKKWWKO..........",
        "...........OKWWK.OAAAAAAAAAAAGGAAAAAAAAAAAO.KWWKO...........",
        "..............OK..OAAAAAAAAAAGGAAAAAAAAAAO..KO..............",
        "....................OAAAAAAAAAAAAAAAAAAO....................",
        ".....................OAAAAAAAAAAAAAAAAO.....................",
        "......................OAAAAAAAAAAAAAAO......................",
        "......................OHHHHAAAAAAHHHHO......................",
        ".........................KKK....KKK........................."
      ],
      blob: [   // generic fallback (spriteFor()) — nature-colored, no bespoke shape yet
        "................",
        "................",
        "................",
        "......XXXX......",
        ".....XXXXXX.....",
        "....XXXXXXXX....",
        "...XXXXXXXXXX...",
        "...XXXXXXXXXX...",
        "...XXXXXXXXXX...",
        "....XXXXXXXX....",
        ".....XXXXXX.....",
        "......XXXX......",
        "................",
        "................",
        "................",
        "................"
      ]
    };

    const SPRITES = {
      // Merc — tactical closed-helmet REBUILD (§SPRITE_SHAPES heroMerc):
      // angular tactical shell with a full green-glow visor (V bright HUD
      // line over the base glow G), cool blue eye-hint (I) seen through
      // the glass, chest-rig straps + red stripe (R), rifle with visible
      // metal/gleam/magazine-dark/stock-dark tones (M/P/Q/N).
      merc:        { shape: "heroMerc",  palette: {
        O: "#0d1016",
        S: "#d09a63", K: "#f4c890",                      // neck skin / helmet crest highlight
        H: "#454a42", Z: "#26302a",                     // helmet shell / helmet shadow-accent
        G: "#6cff9e", V: "#9cffc0", I: "#4a7fd6",        // visor glow / HUD-line accent / blue eye-hint
        Y: "#6b4530",                                     // boot strap
        C: "#201c18",                                     // collar / strap+belt
        B: "#3a4a3d", A: "#26332a", L: "#4c5c47",        // suit base / shadow / highlight
        R: "#a8342a",                                     // chest-stripe accent (red)
        M: "#727880", P: "#a2a8b0", Q: "#20262c", N: "#171a20",  // rifle metal / gleam / magazine-dark / stock-dark
        X: "#22261e",                                      // gloved hand
        T: "#3a4a3d", U: "#26332a", F: "#171a20"         // pants / pants-shadow / boot
      } },
      // Netrunner — synthetic hacker rebuild (§SPRITE_SHAPES heroNetrunner):
      // thin arched brows, curved cyan-glow eyes with a real temple/nose-
      // bridge gap, small defined lips (Y), cool pale-grey synthetic skin,
      // dark teal hair falling past the shoulders, an hourglass torso taper
      // now actually exposed by the arm positioning (not just claimed).
      netrunner:   { shape: "heroNetrunner",  palette: {
        O: "#0a0f13",
        S: "#b8c2c6", K: "#dbe4e6", D: "#7f8b90",      // pale synthetic "skin"
        H: "#1c2b33", G: "#2f4650", J: "#121c22",      // dark teal hair
        V: "#3dd6e0",                                   // cyan glow (eyes + circuits)
        B: "#1f3640", L: "#2f4e5a", A: "#142027",      // bodysuit base/light/shadow
        C: "#101a1f", T: "#182b32", U: "#101c21", F: "#0c151a",
        Y: "#9e7f8a"                                     // lips
      } },
      // Dread Knight — literal exposed skull (bone-white cranium K/D, hollow
      // eye sockets J with the red glow V now read as embers inside them,
      // visible teeth) over dark steel plate (M/P/N), maroon underlayer
      // (B/L/A), and a giant slab greatsword (4px wide, resting on the
      // shoulder, tip past the head) instead of a centerline blade.
      dreadKnight: { shape: "heroDread",  palette: {
        O: "#0a0a0c",
        M: "#4a4e56", P: "#8f96a0", N: "#2a2d33",      // steel base/gleam/shadow (P also = sword blade)
        V: "#ff3b30",                                   // red glow (visor lore, now the eye-socket embers)
        B: "#3a2226", L: "#4d2e33", A: "#241417",      // maroon underarmor
        K: "#d3c9a8", D: "#8f8568", J: "#170808",       // bone base / bone shadow / eye-socket interior
        C: "#16161a", U: "#34383e", F: "#1a1a1e"
      } },
      // Mech Runner (Torque von Bram) — digitigrade battle-mech rebuild
      // (§SPRITE_SHAPES heroMech): angular pointed shoulders, tapered
      // agile waist, a bow-legged digitigrade stance (heel spurs + clawed
      // toes), amber core-light + rust joint-seam accents kept from the
      // established color identity.
      mechRunner:  { shape: "heroMech",  palette: {
        O: "#0d0d0f",
        S: "#c88a55", D: "#8a5a30", E: "#141414", W: "#e8e0d0",  // face skin / shadow / eyes
        H: "#3a2a1a",                                             // hair
        M: "#6b7078", P: "#9aa0a8", N: "#33383e", A: "#3a3d42",  // mech metal / gleam / cannon-dark / chest panel
        R: "#8a5a2c",                                             // rust joint-seam accent
        V: "#ffb347",                                             // amber power core glow
        X: "#4a5058", F: "#20242a"                                // mech claw-hand / foot
      } },
      // Mentalist — wizened sage refinement (§SPRITE_SHAPES heroMentalist):
      // a real beard (W), two real eyes with a lid-crease and proper
      // spacing, purple robe (B/L/A) with gold runes (R), and a wooden
      // staff (M) with a visible gripping hand. The classic FF mage
      // silhouette, leaned further into the traditional wizard archetype.
      mentalist:   { shape: "heroMentalist",  palette: {
        O: "#0c0812",
        S: "#8a7a9a", K: "#a595b5", D: "#5f5075",      // shadowed in-hood skin
        H: "#3a2c52", J: "#281c3a",                    // hood cloth base/shadow
        V: "#c77dff",                                   // purple glow (eyes + orb)
        B: "#4b3866", L: "#5e4a7e", A: "#33254a",      // robe base/light/shadow
        R: "#ffe08a",                                   // gold runes
        M: "#7a5a3a", N: "#4a3624",                     // staff wood
        W: "#c9c2d6"                                    // beard
      } },
      // Saboteur (Sexias) — corroded-deserter rebuild (§SPRITE_SHAPES
      // heroSaboteur): a full respirator mask (M/N) with glowing acid-
      // green lenses (G/V) instead of a bandana + bare eyes, asymmetric
      // scavenged armor (one intact olive pauldron L, one bare/bandaged
      // arm), jagged corrosion holes (F) breaking up the plating instead
      // of clean rust rectangles, a bandolier strap, a jagged broken-edge
      // acid blade, and genuinely mismatched legs (light tan cloth wrap T
      // vs. dark armored greave B — real value contrast now, not two
      // similar olive tones).
      saboteur:    { shape: "heroSaboteur",  palette: {
        O: "#0d1210",
        S: "#a8825c", K: "#c9a17a", D: "#6b4d34",      // weathered skin base/light/shadow
        H: "#2e2a20", J: "#1c1912",                    // scruffy hair
        M: "#454a3c", N: "#2a2e24",                     // respirator mask base / dark (filter, straps)
        G: "#7ae05a", V: "#9cff6b",                     // acid glow (lenses + blade)
        B: "#4d5140", A: "#383c2e", L: "#63684f",      // olive Vossmark armor base/shadow/highlight
        R: "#6b4023", Y: "#8a5a30",                    // rust decay base/light
        C: "#232018", T: "#c9b896", U: "#8a7458",      // rag wrap / light cloth-wrapped leg / leg shadow
        F: "#141610"
      } },
      // Spider Drone — gunmetal chassis, red optic band, bladed leg-tips
      // (security-bot read, added in the detail pass).
      spiderDrone: { shape: "spiderDrone",   palette: {
        E: "#ff5a44", O: "#2f353c", B: "#6b7580", P: "#9aa5b0", L: "#454d56"
      } },

      // ---------- TIANGONG (Sector 1 roster, §5.1) ----------
      // Hull Roach — unbranded pest, not Vossmark-issue; grimy grey/rust vs.
      // the hive's organic olive-green, so it still reads as "station vermin."
      hullRoach:    { shape: "hiveCrawler",     palette: {
        A: "#6b5a4a", H: "#5c4a3a", O: "#3a3128", B: "#7a6a55", L: "#4a3f30",
        J: "#2e2620", K: "#8a7a68", E: "#0f0d0a"                // rib-shadow / mandible-lt / eye-dark
      } },
      // Arc Sentinel — small hovering shock-drone, amber/yellow arc glow,
      // now with a visible thruster glow (its own sentryBotMobile shape,
      // split from Security Turret's fixed-mount sentryBotFixed).
      arcSentinel:  { shape: "sentryBotMobile",        palette: {
        O: "#14140a", V: "#fff27a", E: "#ffcc33", B: "#55524a", A: "#6b6a5e"
      } },
      // Vossmark Grunt — rank-and-file enforcer: drab khaki armor + olive helmet,
      // faction-green stun-baton glow. The differentiated guardTrooper (§5.1).
      vossmarkGrunt:  { shape: "guardTrooper",     palette: {
        O: "#12140f", P: "#4d5140", G: "#6b7052",                 // helmet shell / rim + gorget
        S: "#c9a071", K: "#e0b98a", D: "#7a5f38", W: "#eef0ea", E: "#141414",  // skin / brow / teeth / eyes
        C: "#24241a", H: "#5a5f45",                               // collar+belt / pauldron accent
        B: "#565640", A: "#3d3d2c", X: "#2a2a24",                 // chest armor / shadow / gauntlet
        M: "#7a828a", V: "#8fe36b",                               // baton shaft / green glow
        T: "#4a4a36", U: "#2e2e20", F: "#1a1a12"                  // greaves / boots
      } },
      // Security Mech — armored heavy unit, warning-yellow visor + red belt trim.
      securityMech: { shape: "heavyMech",        palette: {
        O: "#0e1012", H: "#454b52", V: "#ffcc33", C: "#33383d", A: "#4a5158",
        B: "#5a6169", W: "#2b2f33", G: "#4a5158", K: "#b23a2e", L: "#454b52", F: "#262a2d",
        N: "#1c1e21", P: "#c9d0d6"                                 // deep vent shadow / blade gleam
      } },
      // Vossmark Officer — TOTAL REBUILD, own bespoke humanoidOfficerVossmark
      // shape (research-anchored to the "Commissar Cap" archetype): oversized
      // peaked cap w/ gold insignia, angry V-brows, mustache, epaulettes,
      // greatcoat w/ lapels, sheathed saber. 24x32 hero-scale grid, needs
      // HERO_BATTLE_SCALE in ui.js SHAPE_SCALE_OVERRIDE (same as guardTrooper).
      vossmarkOfficer:   { shape: "humanoidOfficerVossmark",  palette: {
        O: "#14140f", H: "#3f3f30", V: "#8a8f6a", S: "#c9a071", C: "#2e2e22",
        A: "#454533", B: "#565640", W: "#c9ccd1", G: "#c9a071", K: "#6b2b22", L: "#3d3d2c", F: "#1e1e15",
        E: "#1a1810", D: "#7a5f3f", R: "#8a2f24", N: "#141410", I: "#5f4a2f", Y: "#3f2e1c", P: "#8f96a0"
      } },
      // The Warden — "AI Sentinel Core" v1 (§SPRITE_SHAPES wardenCore): a
      // hovering core orb with a blazing red-banded lens and asymmetric
      // mechanical tendrils, no longer a recolored Security Mech chassis.
      warden:       { shape: "wardenCore",       palette: {
        O: "#0a0a0c", X: "#e0533d",
        P: "#4a5158", H: "#33383d", N: "#22262a",
        V: "#e0533d", E: "#fff2c0",
        C: "#1c1e21",
        A: "#3a3f45", S: "#282c30", G: "#e0533d", R: "#ffcc33"
      } },

      // ---------- TALOS SYSTEMS (§5.1) ----------
      // Talos Wraith — bespoke stealthHumanoidWraith shape (2026-07-26,
      // research-anchored to the Genestealer Hybrid archetype): fast fodder
      // infiltrator, ragged hood, raw red-eyed, one venom-glow fused claw.
      talosWraith:  { shape: "stealthHumanoidWraith",  palette: {
        O: "#0d0808", H: "#6b2530", J: "#2e1418", E: "#ff5a4d",
        B: "#7a2f38", D: "#4a1c22", A: "#5a232a", N: "#3a1418",
        V: "#a8d94a", F: "#1a0d0e"
      } },
      // Talos Phantom — bespoke stealthHumanoidPhantom shape: sleeker,
      // cooler cyan-glow operative one tier up from Wraith — an angular
      // chitin crest, tapered waist, blade held high in a forward lunge
      // (a genuinely distinct silhouette, not a recolor of Wraith).
      talosPhantom: { shape: "stealthHumanoidPhantom",  palette: {
        O: "#0d1216", H: "#33505f", J: "#1c2e38", E: "#6fe0ff",
        B: "#3d5a68", D: "#578098", A: "#2e4652", C: "#2a4048",
        R: "#578098", N: "#aef0ff", F: "#0e1418"
      } },
      // Talos Vanguard — bespoke humanoidOfficerTalos shape (24x32, own
      // shape split from the now-Voraxx-only humanoidOfficer): asymmetric
      // organic-plate pauldrons + shoulder spike, ribbed chitin torso
      // banding with a glowing bio-crack, a glowing throat-node (its
      // 2.0x-weak-Psionic tell), a hidden second clawed limb at the hip,
      // and a plasma blade with a real crossguard + gripping hand.
      talosVanguard:{ shape: "humanoidOfficerTalos",  palette: {
        O: "#0d0808", H: "#5c2029", R: "#7a2f38", J: "#2e1418",
        E: "#ff5a4d", C: "#3a1418", K: "#6b2530", B: "#5a232a",
        D: "#3a1418", A: "#5a232a", F: "#1a0d0e",
        P: "#ff6a4d", G: "#ffb347", V: "#a8d94a"
      } },
      // Splice Husk — bespoke spliceWither shape (24x32, was 100% blob).
      // Sickly pale skin, a metal restraint cuff (M) still fused to one
      // wrist, Phthora-green (G) glow just a pinprick at this tier.
      spliceHusk: { shape: "spliceWither", palette: {
        O: "#0d0f0c", H: "#3a3f34", S: "#8a9280", E: "#141614",
        D: "#454d40", A: "#5a6250", W: "#c4c8ba", T: "#6b7360",
        G: "#7ae0a0", U: "#454d40", F: "#1c1e18", M: "#8a8f96"
      } },
      // Bio-Tank — bespoke bioRupture shape (24x32, was 100% blob).
      // Asymmetric overgrowth, a broken harness (C) across the chest,
      // a bigger Phthora-green rupture than Splice Husk's pinprick.
      bioTank: { shape: "bioRupture", palette: {
        O: "#0d0f0c", H: "#3a3f34", S: "#8a9280", E: "#141614",
        D: "#454d40", A: "#5a6250", W: "#c4c8ba", N: "#6b7360",
        C: "#3a3f34", G: "#7ae0a0", U: "#454d40", F: "#1c1e18"
      } },
      // Chimera Specimen — bespoke chimeraFusion shape (24x32, was 100%
      // blob; design doc locks this one as NOT a hive-shape reuse). Straps
      // fused into the skin (C), a fused claw-limb (N/B), the family's
      // biggest Phthora-green rupture, a root-stump leg (R).
      chimeraSpecimen: { shape: "chimeraFusion", palette: {
        O: "#0d0f0c", H: "#3a3f34", S: "#8a9280", E: "#141614",
        D: "#454d40", A: "#5a6250", W: "#c4c8ba", N: "#6b7360",
        C: "#3a3f34", G: "#7ae0a0", U: "#454d40", F: "#1c1e18",
        B: "#2e3428", R: "#454d40"
      } },
      // Proteus — "Open Bloom" v2 (§SPRITE_SHAPES proteusBloom): half-
      // transcended bio-executive, composed human face over a peeled-open
      // chest revealing a glowing bio-plasma core, one arm already a maroon
      // chitin claw, lower body an amorphous asymmetric bio-mass.
      proteus:      { shape: "proteusBloom",     palette: {
        O: "#0b0808",
        H: "#2a221c",
        S: "#c08a5c", D: "#8a5f3c", E: "#141210", M: "#5c3a28",
        C: "#1c1614",
        B: "#3a3d42", L: "#4d5158", A: "#26282c",
        P: "#26140f", G: "#ff8a3d",
        W: "#6b2426", X: "#8f3a2e", N: "#2a1210",
        T: "#4a1f1c", U: "#33130f", R: "#c9503a"
      } },

      // ---------- KHARON'S REACH (§5.2a) ----------
      // Quota Enforcer — rough militia enforcer: dull worn brown armor + tan
      // skin/highlight, dull amber baton glow (scavenged colony gear, no
      // faction color). Bespoke `laborEnforcer` shape now (split off the
      // shared guardTrooper 2026-07-27) — same established color identity
      // carried over onto the new silhouette's own keys.
      quotaEnforcer:  { shape: "laborEnforcer",     palette: {
        O: "#100d0a", S: "#c9a071", K: "#e0b98a", D: "#7a5330", E: "#141414",
        C: "#2e2318", H: "#4a3c2a", B: "#5c4a34", A: "#3f3222", X: "#241a12",
        M: "#6b6158", V: "#d9a94e", T: "#4a3c2a", F: "#1a140d"
      } },
      // Overseer Voraxx — "Ledger & Lash" v2 (§SPRITE_SHAPES voraxxFat): a fat,
      // jowly tyrant in an olive-drab officer's coat with a deep-red sash,
      // gold cap/collar trim, a ledger in one hand and a coiled whip in the other.
      voraxx:        { shape: "voraxxFat",         palette: {
        O: "#0c0a08", P: "#5a1e1e", Q: "#c9a53d", V: "#8a2f2f",   // cap crown (maroon) / brim gold / band
        S: "#c9a071", K: "#e0b98a", D: "#8a6b45",                 // skin base / forehead highlight / jowl shadow
        E: "#141414", W: "#eef0ea", M: "#3a2a1a",                 // pupil / eye-white / mustache
        H: "#c9a53d", C: "#c9a53d",                               // shoulder tufts / collar+medal (gold)
        B: "#565640", L: "#7a7a5c", A: "#3d3d2c",                 // coat base / highlight / shadow
        J: "#3a2e1c", I: "#c9b98a",                               // ledger cover / page-edge
        G: "#5a4530", N: "#a68a5a",                               // whip grip (leather) / coil (rope)
        R: "#8a2f2f", T: "#3d3d2c", U: "#2a2a1e"                  // sash / pants / boot-shadow
      } },

      // ---------- SITE EREBUS (§5.3) ----------
      // Erebus Roach — same hiveCrawler model as Hull Roach (per direction:
      // one roach model, colors differentiate faction/type). Broodmarshal-
      // DNA: antennae, mandibles, ribbed abdomen, jointed legs.
      erebusRoach:  { shape: "hiveCrawler",      palette: {
        A: "#5a6b2e", H: "#6b4423", O: "#3a2812", B: "#7a8f3a", L: "#4a3618",
        J: "#4a2f18", K: "#8a6b3f", E: "#1a0f08"                 // rib-shadow / mandible-lt / eye-dark
      } },
      // Erebus Warrior — standard hive bruiser: olive-green carapace, faint
      // psi-green compound eyes, pincer claw-arms (Broodmarshal DNA).
      erebusWarrior:{ shape: "hiveBrute",        palette: {
        O: "#100d08", H: "#6b4423", V: "#a8f7c8", C: "#4a3018", A: "#5a3d1e",
        B: "#7a8f3a", W: "#9aa84a", G: "#5a3d1e", K: "#3a2812", L: "#4a3018", F: "#241a0d",
        I: "#c9f7d8"                                              // pale claw-edge highlight
      } },
      // Erebus Shaman — hive-mind caste, the psionic caster: the same
      // psi-purple glow as the Mentalist (deliberate echo — see §5.3/§5.1's
      // Psionic-affinity design note) over an olive-brown carapace mantle,
      // now with big sweeping antennae distinguishing it from the fighters.
      erebusShaman: { shape: "hiveMystic",       palette: {
        O: "#0d0a12", H: "#4a3820", V: "#c77dff", A: "#5a4a26", B: "#6b5a2e",
        W: "#d9b8ff", G: "#5a4a26", K: "#3a2e18", L: "#2e2410"
      } },
      // Erebus Armored Warrior — the counter-pick elite: its OWN
      // hiveBruteArmored shape now (split from Warrior per the "genuine
      // silhouette per tier" direction) — steel-grey armor plating, wider
      // shoulders, bigger pincers than the base Warrior.
      erebusArmoredWarrior: { shape: "hiveBruteArmored", palette: {
        O: "#0c0a08", H: "#5a5f66", V: "#a8f7c8", C: "#3a3d42", A: "#454a50",
        B: "#565c63", W: "#7a8f3a", G: "#454a50", K: "#2c2e30", L: "#3a3d42", F: "#1e2023",
        I: "#d8dce0"                                              // pale claw-edge highlight, cooler tone
      } },
      // The Broodmarshal — hive leadership caste, boss scale: same species
      // colors as Warrior/Roach (olive carapace), a commanding gold multi-eye
      // band, and a cold-metal collar patch — the fused, non-functional
      // Vossmark control rig from its story canon (§5.3), no extra geometry
      // needed, just one palette key reading as metal instead of chitin.
      // The Broodmarshal — "Reared Warrior Bug" (§SPRITE_SHAPES hiveLord):
      // genuinely insectoid Starship Troopers-style redesign, cold-metal
      // collar patch still marking the fused, never-worked control rig.
      broodmarshal: { shape: "hiveLord",         palette: {
        O: "#0e1206",
        H: "#3a4a1e", K: "#5c7028", J: "#242e10",
        E: "#1a1408", F: "#e0c94a",
        M: "#1c1408",
        C: "#6b7078",
        S: "#6b5a20", X: "#a68a3a",
        L: "#3a4a1e"
      } },
      // --- Boss-support adds (2026-07-24): reuse existing shapes, recolored.
      // (Placeholder art — flag for bespoke sprites later if desired.)
      // Security Turret — fixed emplacement (own sentryBotFixed shape,
      // tripod mount instead of a hover glow): gunmetal + red optic.
      securityTurret: { shape: "sentryBotFixed", palette: {
        O: "#0c0e10", V: "#e0533d", E: "#ff5a44", B: "#4a5058", A: "#5a6169"
      } },
      // Repair Drone — own spiderDroneRepair shape (a small tool accent
      // instead of Spider Drone's bladed tips): medical green.
      repairDrone: { shape: "spiderDroneRepair", palette: {
        E: "#5affa0", O: "#1a2a22", B: "#3a6b52", P: "#7ad6a8", L: "#2a4a3a",
        M: "#9ad6b0"                                              // tool-accent highlight
      } },
      // Riot Enforcer — the bulkiest of the Vossmark trio: black armor,
      // hot-white baton glow. Bespoke `riotShieldTrooper` shape now (split
      // off the shared guardTrooper 2026-07-27, was tabled as a candidate
      // since 2026-07-26): full face-shield helmet (no visible face at
      // all), a riot shield on one arm, baton on the other, shin guards.
      riotEnforcer: { shape: "riotShieldTrooper", palette: {
        O: "#080808", P: "#2a2a2e", G: "#3a3a40", E: "#141414",
        C: "#18181c", B: "#26262b", A: "#1a1a1e", M: "#6b6158",
        V: "#f4f8ff", T: "#26262b", U: "#141416", F: "#0a0a0c"
      } },

      // ---------- HELIOS STATION / DUNGEON 5 (§5.4b) ----------
      // Void wraith trio — bespoke shapes (was 100% blob), all reusing
      // the exact same palette so the family reads as one species,
      // escalating from Poltergeist's bare scrap of cloth to Terror's
      // full screaming maw.
      poltergeist: { shape: "poltergeistWisp", palette: {
        O: "#0d0812", H: "#2e1f3d", K: "#3d2a52", J: "#1a1226",
        V: "#c9a8ff", N: "#5c4a70", T: "#2e1f3d", U: "#1a1226"
      } },
      shade: { shape: "shadeWraith", palette: {
        O: "#0d0812", H: "#2e1f3d", K: "#3d2a52", J: "#1a1226",
        V: "#c9a8ff", N: "#5c4a70", B: "#3d2a52", A: "#241832",
        T: "#2e1f3d", U: "#1a1226"
      } },
      terror: { shape: "terrorMaw", palette: {
        O: "#0d0812", H: "#2e1f3d", K: "#3d2a52", N: "#5c4a70",
        M: "#120a1a", G: "#d8f5e0", B: "#3d2a52", A: "#241832",
        T: "#2e1f3d", U: "#1a1226"
      } },
      // Sol's Acolyte — "a reskinned Void in the literal sense the name
      // implies" (design doc): a station pilgrim consumed by devotion,
      // still human-shaped and grounded (unlike the legless wraith trio
      // above). Reuses the orphaned `stealthHumanoid` shape (zero users
      // left after Talos Wraith/Phantom split into their own bespoke
      // shapes) recolored into the Sun God's own bronze/gold family —
      // cheap on purpose, matching the doc's "swarm add, not raw damage"
      // framing. Blank blinding-white eyes (E) instead of a normal color
      // are the "none of the will" tell.
      solAcolyte: { shape: "stealthHumanoid", palette: {
        O: "#1a0e05", H: "#c98a3a", E: "#fff2c0",
        B: "#8a5a20", C: "#5c3a14", L: "#3a2410"
      } },
      // Void Horror — bespoke abyssalClaw shape (24x32, was 100% blob).
      // Kraken-anchored fanged maw, an "eclipse" chest patch foreshadowing
      // the Sun God (consumeLight as anti-glow).
      voidHorror: { shape: "abyssalClaw", palette: {
        O: "#0d0812", H: "#2e1f3d", K: "#3d2a52", J: "#1a1226",
        V: "#c9a8ff", N: "#5c4a70", M: "#120a1a", G: "#d8f5e0",
        B: "#3d2a52", A: "#241832"
      } },
      // Demon — bespoke demonBrand shape (24x32, was 100% blob).
      // Asymmetric horns, a glowing orange hellbrand mark (the family's
      // one real glow accent, not an anti-glow).
      demon: { shape: "demonBrand", palette: {
        O: "#0d0812", H: "#2e1f3d", K: "#3d2a52", J: "#1a1226",
        V: "#c9a8ff", N: "#5c4a70", B: "#3d2a52", A: "#241832",
        F: "#ff8a3d"
      } },
      // Devil — bespoke devilCrown shape (24x32, was 100% blob). A
      // cracked fragment of the Sun God's own corona worn as a crown
      // (damnationDecree), a fused coiled lash-whip (tormentLash).
      devil: { shape: "devilCrown", palette: {
        O: "#0d0812", H: "#2e1f3d", K: "#3d2a52", J: "#1a1226",
        V: "#c9a8ff", N: "#5c4a70", B: "#3d2a52", A: "#241832",
        Y: "#f4b12e"
      } },
      // Void Soul Eater — "Wrong-Angle Maw" v2 (§SPRITE_SHAPES
      // voidSoulEaterMaw): hooded void-wraith, jaw flared wide into a
      // jagged sawtooth maw, tattered robe streamers instead of legs.
      voidSoulEater: { shape: "voidSoulEaterMaw", palette: {
        O: "#0d0812",
        H: "#2e1f3d", K: "#3d2a52",
        J: "#1a1226",
        R: "#5c4270",
        V: "#c9a8ff", E: "#8a6fc9",
        N: "#5c4a70",
        M: "#120a1a", G: "#d8f5e0",
        C: "#251a33",
        B: "#3d2a52", L: "#57406e", A: "#241832", D: "#2e2040",
        T: "#2e1f3d", U: "#1a1226"
      } },
      // The Sun God — "Eclipse Face" v2 (§SPRITE_SHAPES sunGodEclipse):
      // blazing corona ring around an eclipsed black disc, bronze
      // statuesque body, flame-lick base.
      sunGod: { shape: "sunGodEclipse", palette: {
        O: "#1a0e05",
        Y: "#f4b12e", W: "#fff2c0", R: "#e07a1e",
        K: "#0c0810",
        C: "#3a2410",
        B: "#8a5a20", L: "#c98a3a", A: "#5c3a14", F: "#e0682e",
        N: "#4a1e3a", D: "#5c3a14",
        U: "#5c2410"
      } },
      // Phthora, the Fleshspring — "The Reaching Wreck" (§SPRITE_SHAPES
      // phthoraWreck): gaunt origin-figure, two mismatched reaching arms,
      // a glowing green chest rupture, rooted to the ground.
      phthora: { shape: "phthoraWreck", palette: {
        O: "#100a08",
        H: "#4a3830", S: "#a8896a", D: "#6b4d3a", E: "#1a1410",
        C: "#2a1e18",
        B: "#5c4030", A: "#3a281e",
        P: "#1a3020", G: "#7ae0a0",
        W: "#a8896a", X: "#c9a880", M: "#4a3830",
        N: "#6b5548",
        R: "#4a3020", U: "#2a1810"
      } },
      // The Caged God — "The Cracking Cocoon" (§SPRITE_SHAPES
      // cagedGodCocoon): a cracked containment shell restrained by
      // mechanical bands, glowing void-purple from within.
      cagedGod: { shape: "cagedGodCocoon", palette: {
        O: "#0a0812",
        H: "#3a2c50", K: "#5c4880", J: "#241a38",
        C: "#c9a8ff", G: "#f0e8ff",
        B: "#5a5a62", A: "#33333a", V: "#e0a83a",
        N: "#3a3a40"
      } },
      // Chthon, God of the Breach — "Dimension-Dragon" v3 (§SPRITE_SHAPES
      // chthonBreach): draconic head, void-tear wings flowing into the
      // shoulders, Kredex's broken rig worn as a collar.
      chthon: { shape: "chthonBreach", palette: {
        O: "#0a0812",
        Z: "#1c1420",
        H: "#3a2c50", K: "#5c4880", J: "#1a1226", D: "#241a38",
        R: "#e0533d",
        M: "#120a1a", T: "#7ae0a0", G: "#c9a8ff",
        N: "#3a3a40", B: "#5a5a62", A: "#33333a", V: "#e0a83a",
        C: "#a888e0", W: "#241832"
      } }
    };

    // Fallback palette (by nature) for any enemy without a SPRITES entry above
    // yet — most of the roster, this slice. Keeps the rest of the cast reading
    // as organic/synthetic instead of rendering blank; swap in a real entry
    // any time with no engine change (spriteFor() just stops falling through).
    const GENERIC_PALETTES = {
      organic:   { X: "#6b7a3a" },
      synthetic: { X: "#5a6b7a" },
      // Void (§5.4b, Dungeon 5) — dark violet, distinct from the organic/
      // synthetic blobs, pending real sprites (sprite workflow memory).
      void:      { X: "#4a2f5e" }
    };

    // THE DUNGEONS REGISTRY (Phase H3, §5.2 — was a single hardcoded
    // DUNGEON_MAP). Each entry is a small hand-authored branching tree, keyed
    // by `currentDungeonKey` (state, §3). `title` labels the Map screen;
    // `nextDungeonKey` is what a BOSS-node win advances to (renderEndbar
    // reads it) — `null` means nothing built past this dungeon yet.
    const DUNGEONS = {
      // Kharon's Reach (Phase H3) — the story-mode prologue: a short, mostly
      // solo escape from a Vossmark mining colony. Linear on purpose (an
      // escape, not a dungeon crawl) and much shorter than Sector 1 — see
      // gridfall-design.md §5.2 for the story this dungeon tells.
      prologue: {
        start: "p1",
        title: "ESCAPE FROM KHARON'S REACH",
        region: "mining",   // map backdrop theme (Phase I): asteroid mining colony
        nextDungeonKey: "sector1",
        nodes: {
          p1: { id: "p1", type: "combat", depth: 1, connectsTo: ["p2"],
                enterText: "Security drones scramble to Thiel's last position!" },
          p2: { id: "p2", type: "combat", depth: 2, connectsTo: ["p3"],
                enterText: "Guards flood the shaft ahead!" },
          // recruit: a non-combat story beat, not drawn from ENEMY_POOLS —
          // resolved by resolveRecruitNode(), same treatment as Loot/Rest.
          p3: { id: "p3", type: "recruit", depth: 3, connectsTo: ["p4"],
                recruitClass: "mechRunner", recruitName: "Torque von Bram", recruitButtonLabel: "Move out.",
                recruitText: [
                  "A side tunnel, half-collapsed. Torque is elbow-deep in a stalled loader rig, " +
                    "sweating over a jam that won't clear.",
                  "They see the rifle in your hands and the alarm lights just starting to strobe " +
                    "red down the shaft, and they don't ask a single question.",
                  "\"Hangar bay,\" Torque says, already pulling a salvaged mining laser off the " +
                    "loader's mount. \"I know a way through the drill line. Try to keep up.\""
                ] },
          p4: { id: "p4", type: "boss", depth: 4, connectsTo: [],
                enterText: "Overseer Voraxx doesn't look surprised to see you, just annoyed at the " +
                  "paperwork this is going to cause. \"Thiel's replacement will have to process a " +
                  "body sooner than expected,\" he says, already sounding bored. \"The Prison AI " +
                  "doesn't care which of you makes quota. Only that quota gets made.\"" }
        }
      },
      // Vossmark Station Sector 1 (Phase G, §5.1) — a genuine branch (safer
      // Combat+Rest vs riskier Elite+Loot) that reconverges before a final
      // Elite gate, a Rest stop, then the Boss. (n8 was added during Slice G4
      // balance testing: with no free heal between fights, going straight
      // from the Elite gate into the Boss left the party too depleted to have
      // a real shot — a rest stop right before a boss is also a standard
      // genre beat, so this earns its spot over strict 8-node math.)
      sector1: {
        start: "n1",
        title: "VOSSMARK DIRECTORATE MINING STATION 4",
        region: "station",   // map backdrop theme (Phase I): orbital space station
        nextDungeonKey: "erebus",
        // The Warden's fixed boss composition (§1d) — moved here from engine
        // logic (2026-07-24) so rollEncounterForNode can stay generic and be
        // reused by Dungeons 4-6 (§5.4) instead of being Sector-1-hardcoded.
        bossEncounter: [
          { key: "warden", level: 4 }, { key: "securityTurret", level: 4 }, { key: "spiderDrone", level: 4 }
        ],
        nodes: {
          // n1 stays the entry node (unchanged from Phase G); recruit1 (Phase
          // H4, §5.2a) sits right after it, so every playthrough fights the
          // breach corridor alone first and meets Nyx once it's clear,
          // still before the branch point, so she's never missable. Every
          // OTHER node's RENDER depth shifted +1 to make room (n2/n3 2→3,
          // n4/n5 3→4, n6 4→5, n7 5→6, n8 6→7, boss 7→8) — the branch
          // topology itself is unchanged, just pushed back one row. But
          // `depthLevel(depth)` also drives enemy-level SCALING, and a sim
          // comparison showed a shift like this alone drops the risky
          // branch's clear rate by a lot (~53%→~32% in testing) for the
          // story's fixed, tank/healer-less starting trio (Merc/Mech Runner/
          // Netrunner) — too punishing for a mandatory story gate with no
          // comp choice yet. Fix: every shifted node also carries
          // `levelDepth`, its ORIGINAL pre-shift depth — `rollEncounterForNode`
          // scales off THAT, not the render `depth` — so recruit1 changes
          // where nodes sit on the map without changing how hard anything
          // hits. See §5.2b/§9 for the sim numbers.
          n1:   { id: "n1",   type: "combat", depth: 1, connectsTo: ["recruit1"],
                  enterText: "The breach corridor is still hot from the entry charges. Whatever's " +
                    "on the other side already knows you're here." },
          recruit1: { id: "recruit1", type: "recruit", depth: 2, connectsTo: ["n2", "n3"],
                      recruitClass: "netrunner", recruitName: "Nyx", recruitButtonLabel: "Move in.",
                      recruitText: [
                        "The corridor past the breach is quiet again, drones sparking on the deck " +
                          "plating where you left them. A side hatch hangs open a few meters " +
                          "ahead, forced from the inside.",
                        "Nyx steps out before you reach it, still holding a remote trigger in " +
                          "one hand. \"Wondering when Kharon's Reach would finally bite back,\" " +
                          "she says. \"I've been bleeding this station's systems for months. Could " +
                          "use some backup that isn't a badly written script.\"",
                        "Three operators against a station isn't great odds, but it beats the " +
                          "two you walked in with."
                      ] },
          n2:   { id: "n2",   type: "combat", depth: 3, levelDepth: 2, connectsTo: ["n4"],
                  enterText: "The corridor opens into a maintenance level nobody's supposed to " +
                    "walk through unescorted." },
          n3:   { id: "n3",   type: "elite",  depth: 3, levelDepth: 2, connectsTo: ["n5"],
                  enterText: "A heavier patrol holds this stretch of the ring, armor plating built " +
                    "for a war nobody here expected to fight this early." },
          n4:   { id: "n4",   type: "rest",   depth: 4, levelDepth: 3, connectsTo: ["n6"] },
          n5:   { id: "n5",   type: "loot",   depth: 4, levelDepth: 3, connectsTo: ["n6"] },
          n6:   { id: "n6",   type: "combat", depth: 5, levelDepth: 4, connectsTo: ["n7"],
                  enterText: "Both halls funnel into the same access ring, and Vossmark's response " +
                    "has had time to organize." },
          n7:   { id: "n7",   type: "elite",  depth: 6, levelDepth: 5, connectsTo: ["n8"],
                  enterText: "The last checkpoint before the command deck is a full security " +
                    "detail, mechs and all. Whoever's coordinating them from here knows exactly " +
                    "how many of you there are." },
          n8:   { id: "n8",   type: "rest",   depth: 7, levelDepth: 6, connectsTo: ["boss"] },
          boss: { id: "boss", type: "boss",   depth: 8, levelDepth: 7, connectsTo: [],
                  enterText: "The command deck doesn't have a door, just an interface throne " +
                    "fused into the floor, cables feeding into it from every direction like it " +
                    "grew there instead of being built. This is what Thiel was trying to call. " +
                    "This is what Voraxx answered to. The Warden doesn't need a voice to make " +
                    "itself understood: every debt on Kharon's Reach, every quota, every name in " +
                    "its ledgers, is still open on a screen behind it, and yours is the only one " +
                    "still moving." }
        }
      },
      // Site Erebus (Dungeon 3, planned §5.3) — the bug-planet crash. Hand-
      // scripted per node (rollErebusEncounter), same "unique fight, tuned
      // directly" treatment as the prologue — a one-dungeon story detour
      // doesn't need ENEMY_POOLS/depthLevel's randomized composition. Shape
      // mirrors Sector 1 (a branch that reconverges, a final push, a Rest
      // stop, then the Boss) since it seats five distinct hive castes.
      // No recruit node — deliberate scope call, §5.3 ("no new companion
      // recruited here").
      erebus: {
        start: "e1",
        title: "SITE EREBUS",
        region: "hive",   // map backdrop theme (Phase I): organic bug-planet hive
        nextDungeonKey: "dungeon4",   // Dungeon 4 (§5.4a) built + sim-verified 2026-07-24
        nodes: {
          e1: { id: "e1", type: "combat", depth: 1, connectsTo: ["e2"],
                enterText: "The wreck is still smoking. Something with too many legs is already " +
                  "crawling out of the treeline." },
          e2: { id: "e2", type: "combat", depth: 2, connectsTo: ["e3", "e4"],
                enterText: "The tunnel ahead reeks of resin and rust, old conduit chewed straight " +
                  "through, half of it fused with cable runs that were never hive-grown." },
          // Safe branch: a standard-tier fight (Warrior + Shaman), then Rest.
          e3: { id: "e3", type: "combat", depth: 3, connectsTo: ["e5"],
                enterText: "A chittering call echoes off the tunnel walls. Whatever's answering it " +
                  "isn't alone." },
          e5: { id: "e5", type: "rest", depth: 4, connectsTo: ["e7"] },
          // Risky branch: an Elite gate (Armored Warrior), then Loot.
          e4: { id: "e4", type: "elite", depth: 3, connectsTo: ["e6"],
                enterText: "The passage widens into what used to be a loading bay. Something " +
                  "heavy is waiting in the dark, armor-plated and patient." },
          e6: { id: "e6", type: "loot", depth: 4, connectsTo: ["e7"] },
          e7: { id: "e7", type: "combat", depth: 5, connectsTo: ["e8"],
                enterText: "Vossmark ID plates, half dissolved, are bolted to a door the hive " +
                  "tore open a long time ago. The annex is close now." },
          e8: { id: "e8", type: "rest", depth: 6, connectsTo: ["boss"] },
          boss: { id: "boss", type: "boss", depth: 7, connectsTo: [],
                  enterText: "The chamber opens into a cavern lit by a dead terminal's glow. " +
                    "Something enormous uncoils from the dark, a corroded collar still fused into " +
                    "its shell." }
        }
      },
      // Dungeon 4 — Talos bio-foundry (§5.4/§5.4a, shipped 2026-07-24). 14
      // nodes, fog of war, two faction-differentiated pools (the branch
      // choice IS the squad-composition test), 3 Unknown-node spurs, the
      // Regen debut, and Proteus as a genuinely harder Act II boss. Full
      // end-to-end chain regression + naive/smart sim (gameplay-direction
      // memory has the numbers) before wiring into the real story chain.
      dungeon4: {
        start: "d1",
        title: "TALOS BIO-FOUNDRY",
        region: "biofoundry",   // map backdrop theme (§5.4a): clinical lab corrupted by growth
        nextDungeonKey: "dungeon5",   // Dungeon 5 "Helios Station" (§5.4b) shipped 2026-07-24
        foggy: true,   // §5.4 fog of war — Dungeons 4+ only, Sector1/Erebus untouched
        // Two faction-differentiated pools (§5.4a) — the branch choice IS the
        // squad-composition test: Security Wing (existing Talos stubs, human
        // operatives) vs Specimen Wing (new bio-horror, built around Regen).
        // `mixed` (converge node) reuses both wings' rosters — no new content,
        // just recomposing what already exists once both wings have converged.
        pools: {
          security: {
            fodder:   ["talosWraith"],
            standard: ["talosPhantom"],
            elite:    ["talosVanguard"]
          },
          specimen: {
            fodder:   ["spliceHusk"],
            standard: ["bioTank"],
            elite:    ["chimeraSpecimen"]
          },
          mixed: {
            fodder:   ["talosWraith", "spliceHusk"],
            standard: ["talosPhantom", "bioTank"],
            elite:    ["talosVanguard", "chimeraSpecimen"]
          }
        },
        // Proteus opens with a Security Wing escort; calls a Bio-Tank (Regen)
        // at half HP. Level FIXED at 6 (not 7) — a full end-to-end chained
        // regression (real control-flow, not an isolated fight) showed the
        // party only naturally reaches level 6 by this point in the graph;
        // an isolated level-7 test looked fine (96%+ smart win) but masked
        // that the real chain was fighting a level-7 Proteus with a
        // level-6 party, collapsing the true chained win rate to ~40%. See
        // the gameplay-direction memory for the full diagnosis.
        bossEncounter: [{ key: "proteus", level: 6 }, { key: "talosPhantom", level: 6 }],
        nodes: {
          // Entry: a taste of the Security Wing before the branch choice, so
          // the fog-of-war decision at d2 is at least informed by one wing.
          d1: { id: "d1", type: "combat", depth: 1, levelDepth: 7, poolBranch: "security",
                connectsTo: ["d2"],
                enterText: "Motion sensors flare red the moment you breach the outer seal. The " +
                  "foundry's perimeter guard doesn't wait to ask who you are." },
          // Recruit: Six, the Psionic Mentalist ally teased since Site Erebus
          // (§5.3/§9.4 — "a Psionic-leaning Mentalist recruit would pay off
          // the Shaman caste"). A freed test subject, not a soldier — the
          // tragic note the Splice Husk fodder was designed to set up.
          d2: { id: "d2", type: "recruit", depth: 2, connectsTo: ["d3s", "d3p", "d3x"],
                recruitClass: "mentalist", recruitName: "Six", recruitButtonLabel: "Get them out.",
                recruitText: [
                  "A holding cell door hangs open at the end of a service corridor, its lock burned " +
                    "through from the inside. Whoever did it left a trail of scorched carpet and " +
                    "nothing else.",
                  "You find her sitting very still in the dark, staring at her own hands like " +
                    "she doesn't fully trust what those hands will do next. A specimen tag is still " +
                    "fused to one wrist: SUBJECT SIX. She doesn't offer another name.",
                  "\"They were trying to teach it to listen,\" Six says, finally looking up. \"It " +
                    "listened to me instead. I can hear the ones still in the tanks, screaming " +
                    "without mouths. I want to make it stop. All of it.\""
                ] },

          // --- Security Wing arm ---
          // Mandatory critical path is d1(shared) -> d3s -> d5s -> rest — TWO
          // guaranteed unrested fights, matching Sector 1's proven density
          // (n1 shared + one branch fight -> rest). d4s is now a genuinely
          // OPTIONAL side-spur off d3s (also a dead end), not a mandatory
          // third fight — fixed 2026-07-24 after a full-arm sim regression
          // showed the original 3-fights-then-rest sequence (d1->d3->d4->d5)
          // collapsing to ~9-21% full clears even under smart play; see the
          // gameplay-direction memory for the numbers.
          d3s: { id: "d3s", type: "combat", depth: 3, levelDepth: 7, poolBranch: "security",
                 connectsTo: ["d4s", "d5s"],
                 enterText: "Clean white corridors, too clean. A patrol rounds the corner and " +
                   "doesn't break stride before opening fire." },
          d4s: { id: "d4s", type: "unknown", depth: 4, levelDepth: 7, poolBranch: "security",
                 connectsTo: [] },
          d5s: { id: "d5s", type: "elite", depth: 5, levelDepth: 8, poolBranch: "security",
                 connectsTo: ["restS"],
                 enterText: "The security substation is sealed behind a blast door that's already " +
                   "been forced open from the inside. Whoever did that is still in there." },
          restS: { id: "restS", type: "rest", depth: 6, connectsTo: ["converge"] },

          // --- Specimen Wing arm --- (same restructure as Security Wing above)
          d3p: { id: "d3p", type: "combat", depth: 3, levelDepth: 7, poolBranch: "specimen",
                 connectsTo: ["d4p", "d5p"],
                 enterText: "The air changes past this point, warmer, wetter, wrong. Something " +
                   "in the dark has been listening to you argue about which way to go." },
          d4p: { id: "d4p", type: "unknown", depth: 4, levelDepth: 7, poolBranch: "specimen",
                 connectsTo: [] },
          d5p: { id: "d5p", type: "elite", depth: 5, levelDepth: 8, poolBranch: "specimen",
                 connectsTo: ["restP"],
                 enterText: "A containment ward, half-flooded with something that isn't quite " +
                   "water. The restraints on the largest tank are already broken." },
          restP: { id: "restP", type: "rest", depth: 6, connectsTo: ["converge"] },

          // --- Dead-end / loot spur (§5.4) — a genuine detour, not required
          // for either arm; connectsTo: [] is what marks it a dead end. ---
          d3x: { id: "d3x", type: "unknown", depth: 3, levelDepth: 7, poolBranch: "specimen",
                 connectsTo: [] },

          // --- Convergence (only ONE arm's Rest node is required to unlock
          // this — unlockedNodeIds is OR'd, same mechanic as Sector 1's
          // safe/risky branch) ---
          converge: { id: "converge", type: "combat", depth: 7, levelDepth: 9, poolBranch: "mixed",
                      connectsTo: ["restFinal"],
                      enterText: "Both wings of the foundry answer the alarm at once, security " +
                        "drones and something far worse, closing from opposite ends of the same hall." },
          restFinal: { id: "restFinal", type: "rest", depth: 8, connectsTo: ["boss"] },
          boss: { id: "boss", type: "boss", depth: 9, connectsTo: [],
                  enterText: "The executive suite doesn't look like a throne room. It looks like an " +
                    "operating theater. Proteus is already mid-procedure, and doesn't stop when you " +
                    "walk in." }
        }
      },
      // Dungeon 5 — Helios Station (§5.4b, shipped 2026-07-24). A circular
      // map (`mapShape: "radial"`, ui.js computeMapLayoutRadial): depth 1 is
      // the outer rim, depth = maxDepth is dead center, where the double
      // boss lives (Void Soul Eater, then the Sun God, back to back with NO
      // rest node between the two — the attrition IS the fight). Narrowly
      // previews the reserved Void/Entropy damage type (§3.2/§5.4) and is
      // where the endless-mode wormhole gets cracked open (in-fiction only
      // so far — no engine hook yet, that's Phase P3). Shape mirrors the
      // proven Sector 1 / Dungeon 4 diamond (shared entry -> one arm's fight
      // -> rest -> converge -> rest -> boss) rather than inventing a new
      // fight-density curve — the D4 postmortem (gameplay-direction memory)
      // was explicit that guessing a new density from scratch collapsed win
      // rates hard, so this reuses the exact proven "2 unrested fights before
      // the first rest" shape instead.
      dungeon5: {
        start: "h1",
        title: "HELIOS STATION",
        region: "helios",   // map backdrop theme (§5.4b): blinding solar glare vs. the dark
        mapShape: "radial", // circular layout (§5.4b) — the boss sits at the center, not a row
        nextDungeonKey: "dungeon6",   // Dungeon 6 "the Cradle" (§5.4c) — the finale
        foggy: true,   // §5.4 fog of war, same as Dungeons 4+
        pools: {
          void: {
            fodder:   ["poltergeist"],
            standard: ["shade", "terror"],
            elite:    ["voidHorror", "demon", "devil"]
          }
        },
        nodes: {
          h1: { id: "h1", type: "combat", depth: 1, poolBranch: "void", connectsTo: ["h2a", "h2b", "h2x"],
                enterText: "Helios Station's outer ring is a graveyard of scorched hull plating and " +
                  "ships that never left. Something that used to be a boarding party still moves in " +
                  "the dark, and it hasn't noticed you're breathing yet." },

          // --- Ring 2: a genuine 3-way branch (§5.4 sizing target) — one
          // combat arm, one Unknown-node arm, one Unknown dead-end spur.
          // Only ONE arm's Rest node is required to unlock convergence
          // (unlockedNodeIds is OR'd, same mechanic as every prior branch). ---
          h2a: { id: "h2a", type: "combat", depth: 2, poolBranch: "void", connectsTo: ["restA"],
                 enterText: "The reactor causeway hums with a light that has no source down here. " +
                   "Whatever answers it doesn't so much walk toward you as simply arrive." },
          h2b: { id: "h2b", type: "unknown", depth: 2, poolBranch: "void", connectsTo: ["restB"] },
          h2x: { id: "h2x", type: "unknown", depth: 2, poolBranch: "void", connectsTo: [] },

          restA: { id: "restA", type: "rest", depth: 3, connectsTo: ["converge"] },
          restB: { id: "restB", type: "rest", depth: 3, connectsTo: ["converge"] },

          converge: { id: "converge", type: "combat", depth: 4, poolBranch: "void", connectsTo: ["restFinal"],
                      enterText: "Both halls empty into the same collapsed atrium at once, and for a " +
                        "moment neither swarm seems to notice the other is also hunting you." },
          restFinal: { id: "restFinal", type: "rest", depth: 5, connectsTo: ["bossSoul"] },

          // --- The double boss (§5.4b) — bossSoul connects onward to
          // bossSun instead of connectsTo: [], so clearing it is a normal
          // resolveNodeVictory() unlock, not the dungeon's terminal clear
          // (engine.js renderEndbar's isBossClear now checks connectsTo.
          // length === 0). No rest node between the two fights — deliberate. ---
          // Guards added 2026-07-25: one Void Shade escort from the START of
          // the fight (not a mid-fight reinforceWave — that's the Sun God's
          // rhythm below). Gives the double boss two distinct shapes: the
          // gatekeeper arrives with an entourage, the thing at the center
          // doesn't need one until it's already hurting.
          // LEVEL FIXED 2026-07-25 (deferred smart-autoplay balance pass,
          // finally run): both boss nodes were hardcoded level 7/8, but a
          // full-chain sim (h1->h2a->restA->converge->restFinal->bossSoul,
          // real XP, no manual level-setting) showed the party actually
          // arrives around level 2 — only 3 real fights precede this boss,
          // fewer than Sector 1's Warden (level 4, 4 pre-boss fights) or
          // Dungeon 4's Proteus (level 6). The 7/8 tags were guessed, never
          // checked against the graph's own XP curve — the exact Proteus-
          // postmortem mismatch (gameplay-direction memory), just much
          // bigger. Corrected to level 1 (2 guards trimmed to 1 to match —
          // see ENEMIES.sunGod for the matching Sun God fix). Isolated
          // smart-play at the real arrival level (Lv2, full HP): 100% win /
          // 54% HP remaining — back in the project's normal target band.
          bossSoul: { id: "bossSoul", type: "boss", depth: 6, connectsTo: ["bossSun"],
                      bossEncounter: [
                        { key: "voidSoulEater", level: 1 }, { key: "shade", level: 1 }
                      ],
                      enterText: "The atrium floor isn't floor anymore, just an absence with a shape, " +
                        "and the shape is hungry. It has been waiting here longer than the station has " +
                        "had a name. It hasn't been waiting alone." },
          // LEVEL FIXED 2026-07-25 (same pass as bossSoul above): fixed
          // level 8 -> 1, matched to the party's real arrival level. Full
          // chain (both bosses back to back, no rest — the intended
          // attrition): smart-play 92% win / 47% HP remaining, naive floor
          // ~0-3% (same "mashing dies" doctrine as every other boss).
          bossSun:  { id: "bossSun", type: "boss", depth: 7, connectsTo: [],
                      bossEncounter: [{ key: "sunGod", level: 1 }],
                      enterText: "The dark clears in one instant, not gradually, the way night breaks " +
                        "over a horizon that shouldn't exist this close to a star. Something wearing " +
                        "the shape of Helios's own regulator core opens eyes that were never built to " +
                        "see with." }
        }
      },

      // Dungeon 6 — dead Earth, "the Cradle" (§5.4c, finale, 2026-07-25). One
      // continuous fog-of-war descent through 6 zones (a `region` per NODE,
      // not just per dungeon — see ui.js renderCombatants — so the backdrop
      // visibly changes as the crew descends: burnt city -> undercity ->
      // frozen wastes -> [a forest side-arm] -> the deep descent -> the
      // Core). Reuses the radial "dive to center" map shape from Dungeon 5.
      // Zones 1-3 need ZERO new trash enemies (§5.4c) — the "mixed
      // Vossmark+Talos pools in the same encounters" intent, locked since
      // the original D4/5/6 differentiation pass, means real new content is
      // concentrated in Sexias, Phthora, and the Chthon double boss.
      // Split into dungeon6 (zones 1-5) + dungeon6b (zone 6, the Core)
      // 2026-07-25 after a real playtest found the map badly broken —
      // several DIFFERENT nodes rendered at the exact same pixel position.
      // Root cause: the radial "dive to center" layout (computeMapLayoutRadial,
      // ui.js) was designed and proven at D5's scale (10 nodes, 7 depths) —
      // stretched across the original single dungeon6's 22 nodes/18 depths,
      // the fixed 300° sweep had to cram so many depth-bands together that a
      // sibling branch's wedge offset could exactly cancel the angular step
      // between depths (confirmed by literally computing every node's
      // {x,y} and checking pairwise distance — several pairs came out at
      // 0.0px apart). A wedge-auto-shrink safety fix was added to
      // computeMapLayoutRadial regardless (see its comment in ui.js) — real
      // improvement, but the ROOT fix is architectural: radial layout is
      // only actually a good fit for a SHORT, tightly-converging sequence
      // (which is all D5 ever was, and all the Core alone needs to be), not
      // a long branching 17-node zone. So: zones 1-5 now use the STANDARD
      // row layout (no `mapShape` override — same as Sector 1/D4, already
      // proven at this scale, zero angular-budget constraint to violate),
      // and the radial "dive to center" is reserved for the Core alone
      // (dungeon6b, 4 nodes — exactly the tight scale it's good at). This
      // also gave the user's own suggested fix a home: clearing Phthora now
      // shows a real "go deeper" transition into a genuinely separate map,
      // instead of one 22-node graph trying to be both a sprawling crawl
      // and a climactic descent at once.
      dungeon6: {
        start: "s1",
        title: "THE CRADLE",
        region: "burntcity",   // dungeon-wide fallback (map screen); battlefield uses per-node region
        nextDungeonKey: "dungeon6b",   // the Core — a short, separate map (see comment above)
        foggy: true,
        pools: {
          // Zones 1-3: both Vossmark's expedition and what's left of Talos
          // are already here, fighting the environment and each other —
          // mixed encounters from fight one, no wing-differentiation (unlike
          // D4's Security/Specimen split — that split IS the caste system
          // reveal now, not a repeatable structure).
          // Trimmed 2026-07-25 (baseline sim pass): dropped bioTank —
          // Regen's whole design is an attrition race, which is brutal
          // against a party that's still level 1-4 and can't out-DPS it yet
          // (it's tuned for D4's later position). Elite tier is currently
          // unused (no D6 node rolls type:"elite" in this first pass — f2/d2
          // were both downgraded to "combat" after securityMech-caliber
          // elites proved way too strong this early), kept defined for when
          // the later balance pass revisits zone-by-zone difficulty scaling.
          mixed: {
            fodder:   ["talosWraith", "spliceHusk"],
            standard: ["vossmarkGrunt", "talosPhantom"],
            elite:    ["vossmarkOfficer", "talosVanguard", "chimeraSpecimen", "securityMech"]
          }
        },
        nodes: {
          // --- Zone 1: Surface — burnt city ruins ---
          s1: { id: "s1", type: "combat", depth: 1, levelDepth: 1, poolBranch: "mixed", region: "burntcity",
                connectsTo: ["s2", "s2x"],
                enterText: "The shuttle sets down in what used to be a boulevard, ash drifting instead " +
                  "of snow. Vossmark strike teams and something wearing Talos's shape are already " +
                  "killing each other three blocks over, and neither side has noticed you yet." },
          s2: { id: "s2", type: "combat", depth: 2, levelDepth: 2, poolBranch: "mixed", region: "burntcity",
                connectsTo: ["restS"],
                enterText: "A collapsed transit station, its old maps still legible under generations " +
                  "of soot. Something in the dark below decides you're worth the trouble of coming up " +
                  "for." },
          s2x: { id: "s2x", type: "unknown", depth: 2, levelDepth: 2, poolBranch: "mixed", region: "burntcity",
                 connectsTo: [] },
          restS: { id: "restS", type: "rest", depth: 3, region: "burntcity", connectsTo: ["u1"] },

          // --- Zone 2: Undercity / caves ---
          u1: { id: "u1", type: "combat", depth: 4, levelDepth: 3, poolBranch: "mixed", region: "undercity",
                connectsTo: ["u2"],
                enterText: "Below the ash line the city keeps going, service tunnels, flooded rail, " +
                  "the bones of a subway that never got its evacuation finished. Something down here " +
                  "has been surviving on worse than you for a long time." },
          // Moro's recruit gate (§5.4c) — initially reads as an obstacle,
          // not a rescue. Also carries the Talos-origin-on-Earth reveal
          // (folded in here rather than a separate node/mechanic — Moro,
          // a native descendant, is the one person who'd actually know it).
          u2: { id: "u2", type: "recruit", depth: 5, connectsTo: ["restU", "forestGate"],
                recruitClass: "dreadKnight", recruitName: "Moro",
                recruitButtonLabel: "Stand with him.",
                recruitText: [
                  "The tunnel narrows into a chokepoint, and something already standing there doesn't " +
                    "step aside. Armor built from a dozen different eras of scrap, a weapon that's " +
                    "clearly killed things far worse than you. It's been watching you fight your way " +
                    "down for longer than you realized.",
                  "\"You're not Vossmark. You're not what's left of the flesh-things either.\" He " +
                    "doesn't lower the weapon, but he doesn't raise it either. \"Nobody's come down " +
                    "here in three generations who wasn't one or the other.\"",
                  "\"My people never left,\" he says, when you ask. \"Voidborn, we call ourselves, " +
                    "born into what the sky looked like after. We remember what the flesh-things " +
                    "were, before they were that. People. Some company's experiment that outlived the " +
                    "company. It started here, on this dirt, before whatever was left of them ever got " +
                    "off-world.\" He finally lowers the weapon. \"You're going to the center of this. " +
                    "So am I. Might as well be for the same reasons.\""
                ] },
          // Forest side-arm (§5.4c): a short detour off Moro's node, not a
          // full zone. Gates Sexias behind a fixed Vossmark loyalist fight
          // (type "boss" so the encounter is authored, not pool-rolled — a
          // real one-off "story fight" like the prologue's, same pattern the
          // engine already supports; connectsTo is non-empty so it's NOT
          // treated as a terminal boss clear, just a normal unlock).
          forestGate: { id: "forestGate", type: "boss", depth: 5, region: "forest",
                        connectsTo: ["forestRecruit"],
                        bossEncounter: [{ key: "vossmarkOfficer", level: 1 }, { key: "riotEnforcer", level: 1 }],
                        enterText: "The tree line here burned black years ago and never grew back " +
                          "right, charred trunks, a wrongness of color low in the canopy. A Vossmark " +
                          "holding cell sits in the middle of it, and the enforcers guarding it aren't " +
                          "here to keep anything out." },
          forestRecruit: { id: "forestRecruit", type: "recruit", depth: 5, connectsTo: [],
                           recruitClass: "saboteur", recruitName: "Sexias",
                           recruitButtonLabel: "Cut him loose.",
                           recruitText: [
                             "The cell reeks of scavenged chem and worse. The man inside has already " +
                               "half-dismantled the lock himself, corroded tools, a Vossmark sidearm " +
                               "stripped down to something that barely resembles its manual anymore.",
                             "\"Took you long enough,\" he says, like he'd been expecting a rescue " +
                               "he'd already stopped counting on. \"Deserted three weeks before the " +
                               "landing. Command wanted to know what 'securing the Loom' meant hard " +
                               "enough that I didn't want to be there when they found out.\"",
                             "He kicks the cell door the rest of the way open. \"I know what their gear " +
                               "does to a body when it fails. Figure that's worth something to whoever's " +
                               "still walking down there.\""
                           ] },
          restU: { id: "restU", type: "rest", depth: 6, region: "undercity", connectsTo: ["f1"] },

          // --- Zone 3: Frozen wastes ---
          f1: { id: "f1", type: "combat", depth: 7, levelDepth: 4, poolBranch: "mixed", region: "frozen",
                connectsTo: ["f2", "f2x"],
                enterText: "The ash gives way to ice without warning, like the planet itself couldn't " +
                  "decide how it wanted to die. Whatever's still moving out here has had a very long " +
                  "time to get used to the cold." },
          f2: { id: "f2", type: "combat", depth: 8, levelDepth: 5, poolBranch: "mixed", region: "frozen",
                connectsTo: ["restF"],
                enterText: "A frozen convoy, decades dead, its cargo still strapped down under the " +
                  "frost. Something has been nesting in the wreckage, and it doesn't appreciate the " +
                  "company." },
          f2x: { id: "f2x", type: "unknown", depth: 8, levelDepth: 5, poolBranch: "mixed", region: "frozen",
                 connectsTo: [] },
          restF: { id: "restF", type: "rest", depth: 9, region: "frozen", connectsTo: ["d1"] },

          // --- Zone 4: Deep descent — crust into mantle ---
          d1: { id: "d1", type: "combat", depth: 10, levelDepth: 6, poolBranch: "mixed", region: "descent",
                connectsTo: ["d2"],
                enterText: "The ice ends at a fault line that shouldn't exist, a wound in the crust " +
                  "leading straight down. The air gets warmer with every step, and the dark gets more " +
                  "certain of itself." },
          d2: { id: "d2", type: "combat", depth: 11, levelDepth: 7, poolBranch: "mixed", region: "descent",
                connectsTo: ["restD"],
                enterText: "A structure that isn't rock and isn't quite metal either, half-grown into " +
                  "the tunnel wall, humming with a current no one laid the cable for. Something is " +
                  "already very interested in why you're still walking." },
          restD: { id: "restD", type: "rest", depth: 12, region: "descent", connectsTo: ["bossPhthora"] },
          // Phthora, the Fleshspring (§5.4c) — Talos's own leader, racing
          // the crew here, attempting to complete the lineage's founding
          // transcendence at the source. NOW dungeon6's own terminal boss
          // (connectsTo: [] — see the split comment above the dungeon6
          // object): clearing him triggers a real "go deeper" transition
          // into dungeon6b (the Core), exactly the same pattern every other
          // dungeon boundary already uses (full heal via startDungeon(),
          // no need for a redundant rest node after this). Level is a
          // first-pass placeholder, sim-tuned once already (2026-07-25
          // baseline pass) but not the final locked number — deep balance
          // tuning is its own later roadmap phase.
          bossPhthora: { id: "bossPhthora", type: "boss", depth: 13, region: "descent",
                         connectsTo: [],
                         bossEncounter: [{ key: "phthora", level: 4 }],
                         enterText: "The tunnel opens into a cavern lit by something that used to be " +
                           "bioluminescence and is now just wrong. Phthora is already mid-ritual, and " +
                           "whatever he's reaching for, he got here first." }
        }
      },

      // Dungeon 6b — the Core (§5.4c, split from the original dungeon6 —
      // see the comment above that object). A short, tight, climactic
      // sequence — exactly the shape the radial "dive to center" layout is
      // actually good at (this is the shape D5's whole dungeon had). Starts
      // fresh depths 1-4, independent of dungeon6's own numbering — `depth`
      // here only drives THIS dungeon's own layout, never shared across a
      // dungeon boundary. Party XP/level and roster carry over normally
      // (same as every other dungeon-to-dungeon handoff); startDungeon()
      // fully heals on entry, same as every prior boundary.
      dungeon6b: {
        start: "core1",
        title: "THE CRADLE: THE CORE",
        region: "core",
        mapShape: "radial",
        nextDungeonKey: null,   // this IS the finale — no Dungeon 7
        foggy: true,
        pools: {
          // Human factions are behind you now — pure Void-touched
          // territory, reuses D5's roster wholesale.
          voidTouched: {
            fodder:   ["poltergeist"],
            standard: ["shade", "terror"],
            elite:    ["voidHorror", "chimeraSpecimen"]
          }
        },
        nodes: {
          core1: { id: "core1", type: "combat", depth: 1, levelDepth: 8, poolBranch: "voidTouched",
                   connectsTo: ["restCore"],
                   enterText: "Human territory ends here, whatever's left of it. The walls stop " +
                     "pretending to be rock. Whatever shaped them wasn't human, and didn't need to " +
                     "be. The dark answers back." },
          restCore: { id: "restCore", type: "rest", depth: 2, connectsTo: ["bossCagedGod"] },
          // The double-boss finale (§5.4c) — bossCagedGod connects onward to
          // bossChthon instead of connectsTo: [], same generalized pattern
          // D5's double boss already proved out (renderEndbar's isBossClear
          // requires connectsTo.length === 0, so this correctly falls
          // through to a normal resolveNodeVictory() unlock, not the
          // dungeon's terminal clear). No rest between phases — the fusion
          // happens live, on-screen, not off-screen exposition. Levels are
          // sim-tuned once already (2026-07-25 baseline pass), not final.
          bossCagedGod: { id: "bossCagedGod", type: "boss", depth: 3,
                          connectsTo: ["bossChthon"],
                          bossEncounter: [{ key: "cagedGod", level: 6 }],
                          enterText: "Kredex is already here, and he's not alone. Something is here " +
                            "WITH him, still mostly bound, straining against a rig that was never " +
                            "built to hold something that never agreed to be caged. \"You're too " +
                            "late,\" he says, and he isn't wrong, just not in the way he thinks." },
          bossChthon: { id: "bossChthon", type: "boss", depth: 4, connectsTo: [],
                        bossEncounter: [{ key: "chthon", level: 7 }],
                        enterText: "Kredex stops screaming before the shape finishes changing, which " +
                          "is somehow worse than if he hadn't. Whatever answers to Chthon now was " +
                          "never a god, and was never really Kredex either. Just the last honest " +
                          "thing left standing where both of them used to be." }
        }
      }
    };
    const NODE_TYPE_LABEL = {
      combat: "Combat", elite: "Elite", loot: "Loot", rest: "Rest",
      recruit: "Recruit", boss: "BOSS", unknown: "Unknown"
    };
    // Hex-node icon glyph per type (Phase I map pass). Monochrome symbols,
    // colored by CSS per type — deliberately not emoji, to stay cohesive with
    // the pixel/terminal aesthetic.
    const NODE_TYPE_ICON = {
      combat: "⚔",   // crossed swords
      elite:  "✦",   // heavy four-point star
      loot:   "◈",   // diamond-in-square (a crate/cache)
      rest:   "✚",   // heavy cross (heal)
      recruit:"⊕",   // circled plus (a new ally)
      boss:   "☠",   // skull & crossbones
      unknown:"?"    // §5.4 — outcome rolled at resolve time, see UNKNOWN_NODE_OUTCOMES
    };


