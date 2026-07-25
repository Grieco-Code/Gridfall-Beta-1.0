    "use strict";

    /* ================================================================
       A) DATA
       ================================================================ */

    // DAMAGE TYPES & AFFINITIES (Phase B).
    // Core six types: kinetic, shock, thermal, corrosive, psionic, cyber.
    // Each combatant has an `affinities` table of multipliers; any type NOT
    // listed defaults to NEUTRAL (x1). Named tiers keep the tables readable and
    // let us retune the whole game's affinities from one place.
    // Affinity ladder: 2.0 doubly-weak · 1.5 weak · 1.0 neutral · 0.5 resist · 0.2 hard-resist.
    // Nothing is fully immune — even a hard-resisted hit chips for at least 1, so no class is
    // ever dead weight. (Status effects, Phase C, give resisted classes other ways to contribute.)
    const NEUTRAL     = 1.0;
    const WEAK        = 1.5;   // takes extra damage ("Super effective!")
    const RESIST      = 0.5;   // takes reduced damage ("Resisted.")
    const HARD_RESIST = 0.2;   // barely a scratch — the floor for "immune-flavored" matchups

    // STATUS EFFECTS (Phase C). Each status is data: skills apply them via an
    // `applies: [{ type, magnitude, duration }]` field; they tick at the start
    // of the afflicted's turn (see tickEffects). `pip` is the panel badge,
    // `buff` flags a good effect, `requiresNature` locks it to organic/synthetic.
    //   burn    — magnitude = damage per turn (DoT)
    //   weaken  — magnitude = ATK reduction
    //   sunder  — magnitude = DEF reduction
    //   guard   — magnitude = incoming-damage multiplier (e.g. 0.5)  [buff]
    //   disable — skip the turn (magnitude unused)
    //   confuse — magnitude = chance to strike a random target; organic minds only
    //   overclock — magnitude = ATK increase  [buff]
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
      regen:     { name: "Regen",     pip: "REGEN", buff: true }
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

      // --- Netrunner ---
      hack: {   // signature: Cyber burst — the designated Security Mech killer (x2.0)
        name: "Hack", enCost: 12, kind: "attack", target: "enemy",
        damageType: "cyber", power: 16, message: "breaches the systems of"
      },
      empBlast: {   // utility: Shock AoE (anti-swarm)
        name: "EMP Blast", enCost: 12, kind: "attack", target: "allEnemies",
        damageType: "shock", power: 8, message: "blasts"
      },
      systemShock: {   // GATED (level / skill-tree later): shock hit + Disable (skip a turn)
        name: "System Shock", enCost: 14, kind: "attack", target: "enemy",
        damageType: "shock", power: 4, message: "jolts",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
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
      suppressingFire: {   // Tiangong Pvt special — Kinetic + Weaken
        name: "Suppressing Fire", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 0, message: "lays down suppressing fire on",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      repairProtocol: {
        name: "Repair Protocol", enCost: 0, kind: "heal", target: "ally",
        power: 24, message: "runs Repair Protocol on"
      },

      // --- Kharon's Reach colony (Phase H3 prologue, §5.2) ---
      batonStrike: {   // Colony Guard special — Kinetic
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
      ironDiscipline: {   // Overseer Krell special — Kinetic + Weaken
        name: "Iron Discipline", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 8, message: "barks iron discipline at",
        applies: [{ type: "weaken", magnitude: 5, duration: 2 }]
      },
      overseersLash: {   // Overseer Krell special — heavy single-target, partly armor-piercing
        name: "Overseer's Lash", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 22, pierce: 0.2, message: "lashes out at"
      },
      overseersCrackdown: {   // Overseer Krell special — Kinetic AoE (a duo has no one to hide behind)
        name: "Overseer's Crackdown", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "kinetic", power: 6, message: "cracks down on the whole squad, hitting"
      },

      // --- Talos Systems skills (Phase G, §5.1 — organic, Corrosive/Thermal, the
      //     Mentalist's designated rival faction the way Netrunner is Tiangong's) ---
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

      // --- The Warden (boss) — corrupted Tiangong station AI core, §5.1 ---
      turretVolley: {   // basic — Kinetic
        name: "Turret Volley", enCost: 0, kind: "attack", target: "enemy",
        damageType: "kinetic", power: 4, message: "opens fire with a turret volley on"
      },
      overloadCoils: {   // special — Shock AoE, station-wide hazard (extra bite vs the Netrunner)
        name: "Overload Coils", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "shock", power: 9, message: "floods the deck with overload coils, hitting"
      },
      corePurge: {   // special — heavy single-target Cyber burst, partly armor-piercing
        name: "Core Purge", enCost: 0, kind: "attack", target: "enemy",
        // power 22→16 (2026-07-24): with add-support the Warden fight runs longer,
        // giving it more nuke turns — softened so the longer fight stays fair.
        damageType: "cyber", power: 16, pierce: 0.3, message: "unleashes a Core Purge into"
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
      hiveShriek: {   // Erebus Shaman special — Psionic + Confuse (organic-only; Wren's synthetic
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
      firewallBreach: {   // Netrunner tree, tier 2 (needs System Shock): Cyber + Sunder
        name: "Firewall Breach", enCost: 10, kind: "attack", target: "enemy",
        damageType: "cyber", power: 6, message: "breaches the firewall of",
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
      terminalProbe: {   // Netrunner: Terminal Probe Rig
        name: "Terminal Probe", enCost: 12, kind: "attack", target: "enemy",
        damageType: "cyber", power: 20, message: "drives a terminal probe into"
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
      totalHack: {   // Netrunner: Cyber AoE + Disable on every target hit
        name: "Total Hack", enCost: 0, kind: "attack", target: "allEnemies",
        damageType: "cyber", power: 12, message: "unleashes Total Hack on",
        applies: [{ type: "disable", magnitude: 1, duration: 1 }]
      },
      mindsMercy: {   // Mentalist: full-party heal + cleanse (strips debuffs/DoTs, keeps buffs)
        name: "Mind's Mercy", enCost: 0, kind: "heal", target: "allAllies",
        power: 60, cleanse: true, message: "channels Mind's Mercy into"
      }
    };

    // Hero call-signs, assigned in pick order at deploy. Player-editable later.
    const HERO_NAMES = ["Matteo", "Vito", "Nat", "Tupac", "Jaime", "Nero"];

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
        affinities: {},
        growth: { hp: 12, en: 3, attack: 2, defense: 1, speed: 1 },   // gained per level
        limitBreak: "fullAuto"
      },
      dreadKnight: {
        className: "Dread Knight", race: "Human (Voidborn)", role: "Tank · Guard + heavy hits",
        nature: "organic",
        baseStats: { hp: 160, en: 20, attack: 16, defense: 16, speed: 8 },
        skills: ["attack", "crushingBlow", "guard"],
        affinities: {},
        growth: { hp: 18, en: 2, attack: 2, defense: 2, speed: 0 },
        limitBreak: "unbreakableLine"
      },
      mechRunner: {
        className: "Mech Runner", race: "Human (Earth)", role: "Heavy weapons · Burn",
        nature: "organic",
        baseStats: { hp: 130, en: 25, attack: 22, defense: 11, speed: 9 },
        skills: ["attack", "railShot", "incendiaryRounds"],
        affinities: {},
        growth: { hp: 14, en: 2, attack: 3, defense: 1, speed: 1 },
        limitBreak: "orbitalStrike"
      },
      netrunner: {
        className: "Netrunner", race: "Synthetic", role: "Hacker · anti-machine + Disable",
        nature: "synthetic",
        baseStats: { hp: 95, en: 35, attack: 12, defense: 8, speed: 13 },
        skills: ["attack", "hack", "empBlast"],
        affinities: { shock: WEAK, cyber: WEAK, psionic: RESIST },   // synthetic
        growth: { hp: 9, en: 4, attack: 2, defense: 1, speed: 1 },
        limitBreak: "totalHack"
      },
      mentalist: {
        className: "Mentalist", race: "Human (Earth)", role: "Psion · damage + debuff + heal",
        nature: "organic",
        baseStats: { hp: 90, en: 40, attack: 10, defense: 8, speed: 11 },
        skills: ["attack", "psiBurst", "mindSpike", "mend"],
        affinities: { cyber: HARD_RESIST, psionic: RESIST },             // organic, trained mind
        growth: { hp: 8, en: 5, attack: 1, defense: 1, speed: 1 },
        limitBreak: "mindsMercy"
      }
    };

    // SKILL TREES (Phase E: Skill Points). Each class has a short tree of
    // distinct, NAMED skills (not "ranks" of one skill) unlocked by spending
    // Skill Points earned on level-up (see SP_PER_LEVEL). `prereq` (a node
    // key within the same tree) must be learned first; `cost` is the SP
    // price. Learning a node pushes `skillKey` onto the hero's skills, so it
    // appears in combat immediately — no extra wiring needed.
    const SKILL_TREES = {
      merc: [
        { key: "suppressingFire", skillKey: "suppressingFire", name: "Suppressing Fire", cost: 1, prereq: null }
      ],
      dreadKnight: [
        { key: "cleave", skillKey: "cleave", name: "Cleave", cost: 1, prereq: null }
      ],
      mechRunner: [
        { key: "overclock", skillKey: "overclock", name: "Overclock", cost: 1, prereq: null }
      ],
      netrunner: [
        { key: "systemShock", skillKey: "systemShock", name: "System Shock", cost: 1, prereq: null },
        { key: "firewallBreach", skillKey: "firewallBreach", name: "Firewall Breach", cost: 2, prereq: "systemShock" }
      ],
      mentalist: [
        { key: "terror", skillKey: "terror", name: "Terror", cost: 1, prereq: null },
        { key: "cerebralOverload", skillKey: "cerebralOverload", name: "Cerebral Overload", cost: 2, prereq: "terror" }
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
      terminalProbeRig:  { name: "Terminal Probe Rig",   slot: "arms", classRestrict: "netrunner",   statBonus: {}, grantsSkill: "terminalProbe",  spriteKey: null },
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
        typeName: "Spider Drone", role: "Tiangong security bot",
        nature: "synthetic", tier: "fodder",
        baseStats: { hp: 40, en: 0, attack: 15, defense: 7, speed: 11 },
        skills: ["attack"],
        affinities: { shock: WEAK, cyber: WEAK, psionic: HARD_RESIST }
      },
      // Hull Roach — organic bug fodder; swarms; burn/psi counter it.
      hullRoach: {
        typeName: "Hull Roach", role: "hull vermin",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 24, en: 0, attack: 12, defense: 4, speed: 12 },
        skills: ["attack"],
        affinities: { thermal: WEAK, psionic: WEAK }
      },

      // ---------- STANDARD (one gimmick each — mid nodes) ----------
      // Arc Sentinel — synthetic Shock unit; can Disable a hero. Its Shock hurts the Netrunner.
      arcSentinel: {
        typeName: "Arc Sentinel", role: "Tiangong arc drone",
        nature: "synthetic", tier: "standard",
        baseStats: { hp: 50, en: 0, attack: 14, defense: 9, speed: 12 },
        skills: ["arcBolt", "arcDischarge"],
        // shock is NEUTRAL (not resisted) as of 2026-07-24 — an EMP hitting a
        // drone shouldn't feel bad; Cyber/Hack stays its best (weak) counter.
        affinities: { cyber: WEAK, psionic: HARD_RESIST }
      },
      // Tiangong Pvt. — organic bruiser; Suppressing Fire applies Weaken.
      tiangongPvt: {
        typeName: "Tiangong Pvt.", role: "Tiangong trooper",
        nature: "organic", tier: "standard",
        baseStats: { hp: 60, en: 0, attack: 16, defense: 8, speed: 10 },
        skills: ["attack", "suppressingFire"],
        affinities: { psionic: 1.25, cyber: HARD_RESIST }
      },

      // ---------- ELITE (mini-boss — late nodes only) ----------
      // Security Mech — armored: shrugs off Kinetic, but Shock/Cyber wreck it.
      securityMech: {
        typeName: "Security Mech", role: "Tiangong heavy unit",
        nature: "synthetic", tier: "elite",
        baseStats: { hp: 120, en: 0, attack: 17, defense: 15, speed: 7 },
        skills: ["attack", "rocketBarrage"],
        affinities: { kinetic: RESIST, shock: WEAK, cyber: 2.0, psionic: HARD_RESIST }  // 2.0 = doubly weak to hacking
      },
      // Tiangong Lt. (was Squad Leader) — mini-boss: Command Strike + Mark Target (Sunder) + heal.
      tiangongLt: {
        typeName: "Tiangong Lt.", role: "Tiangong field officer",
        nature: "organic", tier: "elite",
        baseStats: { hp: 100, en: 0, attack: 16, defense: 11, speed: 12 },
        skills: ["attack", "commandStrike", "markTarget", "repairProtocol"],
        affinities: { psionic: 1.25, cyber: HARD_RESIST }
      },

      // ---------- TALOS SYSTEMS (Phase G, §5.1) ----------
      // Deliberately the opposite of Tiangong: organic, bio-augmented, leaning
      // Corrosive/Thermal, uniformly weak to Psionic — the Mentalist's rival
      // faction the way the Netrunner is Tiangong's.
      // Talos Wraith — fast organic fodder, swarms.
      talosWraith: {
        typeName: "Talos Wraith", role: "Talos infiltrator",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 22, en: 0, attack: 13, defense: 4, speed: 14 },
        skills: ["venomClaws"],
        affinities: { psionic: WEAK, thermal: WEAK }
      },
      // Talos Phantom — organic stealth striker; Phantom Strike applies Sunder.
      talosPhantom: {
        typeName: "Talos Phantom", role: "Talos stealth operative",
        nature: "organic", tier: "standard",
        baseStats: { hp: 55, en: 0, attack: 15, defense: 8, speed: 13 },
        skills: ["phantomBlade", "phantomStrike"],
        affinities: { psionic: WEAK, kinetic: RESIST }
      },
      // Talos Vanguard — heavy organic frontliner; Plasma Cleave is a big armor-piercing burst.
      talosVanguard: {
        typeName: "Talos Vanguard", role: "Talos heavy operative",
        nature: "organic", tier: "elite",
        baseStats: { hp: 110, en: 0, attack: 18, defense: 12, speed: 9 },
        skills: ["vanguardEdge", "plasmaCleave"],
        affinities: { psionic: 2.0, corrosive: RESIST }  // 2.0 = doubly weak to Psionic
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
        affinities: { psionic: WEAK }
      },
      bioTank: {
        typeName: "Bio-Tank", role: "Talos containment specimen",
        nature: "organic", tier: "standard",
        baseStats: { hp: 62, en: 0, attack: 15, defense: 9, speed: 7 },
        skills: ["fusedSlam", "boundedGrowth"],
        affinities: { psionic: WEAK, kinetic: RESIST }
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
        affinities: { psionic: 2.0, kinetic: RESIST }
      },

      // ---------- BOSS (Phase G, §5.1 — this dungeon's finale) ----------
      // The Warden — a corrupted Tiangong station-defense AI core. Same
      // affinity profile as Security Mech (a proven counter-able tank: resist
      // Kinetic, weak Shock, doubly weak Cyber via the Netrunner's Hack) but
      // scaled well past elite, with a wider single-phase kit.
      warden: {
        typeName: "The Warden", role: "Station Security AI",
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
        affinities: { shock: WEAK, cyber: 2.0, psionic: HARD_RESIST },
        // The Warden fights with its station: it opens flanked by hardware and
        // calls a second wave of sentinels + a repair drone at half HP (§1d).
        reinforceAt: 0.5,
        reinforceWave: [{ key: "arcSentinel", count: 1 }, { key: "repairDrone", count: 1 }],
        reinforceMessage: "The Warden seals the deck — more security units drop in!"
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
        affinities: { kinetic: RESIST, cyber: WEAK, psionic: HARD_RESIST }
      },
      // Repair Drone — squishy heal source. A killable weak point: leave it up
      // and it keeps the Warden alive; the threat-AI also flags it as a priority.
      repairDrone: {
        typeName: "Repair Drone", role: "Station maintenance unit",
        nature: "synthetic", tier: "fodder",
        baseStats: { hp: 22, en: 0, attack: 8, defense: 6, speed: 13 },
        skills: ["attack", "nanoRepair"],
        affinities: { cyber: WEAK, psionic: HARD_RESIST }
      },

      // ---------- KHARON'S REACH (Phase H3 prologue, §5.2) ----------
      // Colony Guard — organic fodder; rank-and-file Tiangong enforcers.
      colonyGuard: {
        typeName: "Colony Guard", role: "Kharon's Reach enforcer",
        nature: "organic", tier: "fodder",
        baseStats: { hp: 32, en: 0, attack: 10, defense: 5, speed: 9 },
        skills: ["attack", "batonStrike"],
        affinities: { psionic: 1.25 }   // consistent with other Tiangong organics
      },
      // ---------- KRELL BOSS-SUPPORT ADD (2026-07-24) ----------
      // Riot Enforcer — tanky organic; braces (self-Guard) and stuns heroes with
      // a shock baton. The heavier cousin of the Colony Guard (guardTrooper shape
      // recolored, per the planned Riot Enforcer tier-variant).
      riotEnforcer: {
        typeName: "Riot Enforcer", role: "Kharon's Reach riot squad",
        nature: "organic", tier: "standard",
        // Tuned to sit at Krell's side in the L1 duo opener without walling a
        // brand-new player (naive ~75% win / smart ~71% HP) — a beefier guard
        // that braces (self-Guard) and stuns, not a mini-boss.
        baseStats: { hp: 38, en: 0, attack: 10, defense: 8, speed: 8 },
        skills: ["attack", "stunBaton", "braceUp"],
        affinities: { psionic: 1.25 }
      },
      // Overseer Krell — the colony's chief overseer, hand-tuned finale for a
      // level-1/2 DUO (not derived from Sector 1's depth/level-scaling curve,
      // same "unique fight, tuned directly" treatment as the Warden).
      krell: {
        typeName: "Overseer Krell", role: "Kharon's Reach chief overseer",
        nature: "organic", tier: "boss",
        baseStats: { hp: 140, en: 0, attack: 20, defense: 10, speed: 10 },
        skills: ["attack", "ironDiscipline", "overseersLash", "overseersCrackdown"],
        affinities: { psionic: 1.25 }
        // Krell's "add" is a Riot Enforcer at his side from the start (see the
        // p4 encounter) — no mid-fight wave, keeping the L1 duo opener forgiving.
      },

      // ---------- SITE EREBUS (Dungeon 3, planned §5.3) ----------
      // A native hive, not a Tiangong creation — the annex here studied and
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
        affinities: { psionic: WEAK, thermal: WEAK }
      },
      erebusWarrior: {
        typeName: "Erebus Warrior", role: "hive bruiser",
        nature: "organic", tier: "standard",
        baseStats: { hp: 58, en: 0, attack: 16, defense: 8, speed: 11 },
        skills: ["mandibleStrike", "carapaceRend"],
        affinities: { psionic: WEAK, thermal: WEAK }
      },
      // Shaman — the hive-mind caste. Squishy caster body (weak Kinetic, a
      // "just hit it" glass cannon), hard-resists Psionic (its own domain).
      // Hive Shriek's Confuse is organic-only (§ STATUSES) — Wren, the
      // party's synthetic Netrunner, is immune by construction.
      erebusShaman: {
        typeName: "Erebus Shaman", role: "hive-mind caste",
        nature: "organic", tier: "standard",
        baseStats: { hp: 45, en: 0, attack: 14, defense: 6, speed: 11 },
        skills: ["psiLash", "hiveShriek"],
        affinities: { kinetic: WEAK, psionic: HARD_RESIST }
      },
      // Armored Warrior — the "counter-pick" fight, same design language as
      // the Tiangong Security Mech: resists the one damage type every class
      // gets for free (Kinetic), so the squad has to bring Thermal/Psionic.
      erebusArmoredWarrior: {
        typeName: "Erebus Armored Warrior", role: "hive heavy",
        nature: "organic", tier: "elite",
        baseStats: { hp: 115, en: 0, attack: 18, defense: 13, speed: 8 },
        skills: ["clawSlash", "crushingPincer"],
        affinities: { kinetic: RESIST, psionic: WEAK, thermal: WEAK }
      },
      // The Broodmarshal — leadership caste, wears a fused Tiangong control
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
        affinities: { thermal: WEAK, psionic: HARD_RESIST },
        reinforceAt: 0.5,
        // Trimmed to 2 roaches (was +1 warrior): the global HP/damage knobs made
        // the old wave far deadlier than when it was first tuned pre-knobs.
        reinforceWave: [{ key: "erebusRoach", count: 2 }],
        reinforceMessage: "The Broodmarshal calls the hive! Reinforcements erupt from the tunnels!"
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
        affinities: { psionic: 2.0, kinetic: RESIST },
        reinforceAt: 0.5,
        reinforceWave: [{ key: "bioTank", count: 1 }],
        reinforceMessage: "Proteus calls out, and the containment ward's other specimens answer."
      },

      // ---------- HELIOS STATION / DUNGEON 5 (§5.4b, 2026-07-24) ----------
      // Void horrors, nature: "void" (a new tag — falls back to the generic
      // organic-colored blob palette until real sprites exist, and is a free
      // side effect immune to Confuse, requiresNature:"organic": these
      // things don't have minds a mundane fear tactic can grab onto).
      // Family affinities: weak Thermal, resist Kinetic/Psionic (see the
      // SKILLS comment above this roster for the full design rationale).
      poltergeist: {
        typeName: "Poltergeist", role: "restless Helios echo",
        nature: "void", tier: "fodder",
        baseStats: { hp: 20, en: 0, attack: 12, defense: 3, speed: 15 },
        skills: ["restlessGrasp"],
        affinities: { thermal: WEAK, kinetic: RESIST }
      },
      shade: {
        typeName: "Shade", role: "Helios wraith",
        nature: "void", tier: "standard",
        baseStats: { hp: 48, en: 0, attack: 15, defense: 7, speed: 13 },
        skills: ["umbralCut", "witherTouch"],
        affinities: { thermal: WEAK, kinetic: RESIST }
      },
      terror: {
        typeName: "Terror", role: "Helios dread-caste",
        nature: "void", tier: "standard",
        baseStats: { hp: 50, en: 0, attack: 13, defense: 7, speed: 10 },
        skills: ["creepingDread", "hollowScream"],
        affinities: { thermal: WEAK, kinetic: RESIST, psionic: RESIST }
      },
      // Void Horror — the counter-pick elite, doubly weak Thermal (the
      // designated "bring the Mech Runner" fight, same shape as Security
      // Mech/Vanguard/Chimera before it). Its special previews Void damage.
      voidHorror: {
        typeName: "Void Horror", role: "Helios abyssal",
        nature: "void", tier: "elite",
        baseStats: { hp: 95, en: 0, attack: 18, defense: 11, speed: 9 },
        skills: ["rendingClaw", "consumeLight"],
        affinities: { thermal: 2.0, kinetic: RESIST }
      },
      demon: {
        typeName: "Demon", role: "Helios burning horror",
        nature: "void", tier: "elite",
        baseStats: { hp: 105, en: 0, attack: 17, defense: 12, speed: 9 },
        skills: ["clawRake", "hellbrand"],
        affinities: { thermal: WEAK, kinetic: RESIST, corrosive: RESIST }
      },
      devil: {
        typeName: "Devil", role: "Helios tormentor caste",
        nature: "void", tier: "elite",
        baseStats: { hp: 100, en: 0, attack: 15, defense: 12, speed: 11 },
        skills: ["tormentLash", "damnationDecree"],
        affinities: { thermal: WEAK, psionic: RESIST }
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
        affinities: { thermal: WEAK, kinetic: RESIST }
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
        affinities: { thermal: WEAK, kinetic: RESIST }
      },
      // The Sun God — Helios's own regulator core, corrupted; secretly a
      // machine wearing a god's face, not a literal deity (§5.4b). Fought
      // immediately after the Soul Eater with NO rest node between the two
      // — the double boss's real teeth is the attrition, not either fight
      // alone. Strengthened 2026-07-25 (hp 135->155, atk 20->21, def 13->14)
      // + given a reinforceWave (Sol's Acolytes x2 at 50% HP) per direct
      // request — this DOES stack on top of an already-brutal chain fight
      // (naive floor already wiped the party pre-buff, gameplay-direction
      // memory), so treat this as even more explicitly first-pass/needs-the-
      // smart-autoplay-tuning-pass than before, not a locked number.
      // nature: "synthetic" (not "void") is deliberate: it makes Confuse
      // fail on it for the right in-fiction reason (it was never organic),
      // and makes Hack's Cyber weakness below land as the mechanical/
      // narrative payoff of the "it's a machine" reveal — closing the loop
      // back to the Netrunner, the original Tiangong specialist.
      sunGod: {
        typeName: "The Sun God", role: "Helios regulator core, corrupted",
        nature: "synthetic", tier: "boss",
        baseStats: { hp: 155, en: 0, attack: 21, defense: 14, speed: 11 },
        skills: ["solarLash", "coronalFlare", "unmakingPulse", "eclipseProtocol"],
        affinities: { cyber: 2.0, thermal: HARD_RESIST },
        reinforceAt: 0.5,
        reinforceWave: [{ key: "solAcolyte", count: 2 }],
        reinforceMessage: "The Sun God's voice splits into a chorus. Sol's Acolytes answer the call."
      }
    };

    // ENEMY POOLS (Phase G, §5.1) — what a node draws from, by tier. Replaces
    // the old single hardcoded ENCOUNTER; mixes both factions so squads have
    // to adapt (Netrunner counters Tiangong's synthetics, Mentalist counters
    // Talos's organics). Drawn from by rollEncounterForNode().
    // Talos units are DEFINED (below) but intentionally NOT pooled here: Talos
    // is a later-arc faction (§5.1), so Sector 1 — the only dungeon that draws
    // from these pools — stays all-Tiangong (+ the unbranded Hull Roach pest).
    // Re-add the talos* keys when a Talos-territory dungeon exists.
    const ENEMY_POOLS = {
      fodder:   ["spiderDrone", "hullRoach"],
      standard: ["arcSentinel", "tiangongPvt"],
      elite:    ["securityMech", "tiangongLt"]
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
      "A pressure plate gives way — a burst of scalding steam catches the squad before anyone can move.",
      "Something in the dark trips a wire. The blast is small, but it isn't nothing.",
      "The floor isn't floor. It takes a few bad seconds to climb back out."
    ];
    const UNKNOWN_NARRATIVE_FLAVOR = [
      "Nothing here but old silence and a dead terminal. Whatever happened, it happened a long time ago.",
      "A supply locker, emptied out and abandoned. Someone else got here first.",
      "The corridor doubles back on itself. A dead end — just a dead end."
    ];

    // SPRITES (Phase I, Slice 1; hero shapes redrawn in a follow-up pass to
    // read more like a classic JRPG battle sprite — see below). A sprite is a
    // `shape` (a grid of palette-key characters, '.' = transparent) plus a
    // `palette` (key -> CSS color). Several classes/enemies can share one
    // SHAPE and just supply a different palette — that's the data-driven win
    // here: adding a sprite for a new class/enemy is usually a palette, not a
    // new grid. drawSpriteFrame() (Section E) is the one function that reads
    // any of these; a second "idle bob" frame is derived from the grid at
    // draw time (bobShape()), not hand-authored twice. Grids don't all have
    // to be the same size — width/height are read off the shape itself
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
      // Merc — REDRAWN 24x32 (Phase I "more human" pass): a gritty augmented
      // human soldier with a full FF1-style face (hair, brows, two eyes — one
      // a green cyber-augment (VV), one normal (WE) — nose, mouth, jaw), a
      // space-tactical vest with a diagonal bandolier, and a rifle held across
      // the body. The other 4 heroes are still 18x28 until this style is
      // approved and rolled out to them. (Engine reads each grid's own size.)
      heroMerc: [
        "........................",
        ".........JOOOOJ.........",
        ".......OJHHHHHHJO.......",
        "......OJHHHHHHHHJO......",
        ".....OJHHGGHHGGHHJO.....",
        ".....OHHHHHHHHHHHHO.....",
        ".....OHSSSSSSSSSSHO.....",
        ".....OHSSKSSSSKSSHO.....",
        ".....OSSDDSSSSDDSSO.....",
        ".....OSSVVSSSSWESSO.....",
        ".....OSSSSSDDSSSSSO.....",
        ".....OKSSSSSSSSSSKO.....",
        ".....OSSSSDDDDSSSSO.....",
        ".....OKSSSSSSSSSSKO.....",
        "......OKSSSSSSSSKO......",
        "........OCCCCCCO........",
        "...OMMMMBBBBBBBBMMMMO...",
        "...OAAOBBBBBBBBBBOAAO...",
        "...OSAOBBBBBBBBBBOASO...",
        "...OSSOBBBBBBBBBBOSSO...",
        "...OXXMMMMMMMMMMXXMNNNNN",
        "...OBBBBBBBBBBBBBBBBO...",
        "...OCCCCCCCCCCCCCCCCO...",
        "....OTTTTTTOOTTTTTTO....",
        "....OTTTTTTOOTTTTTTO....",
        "....OTTTUTTOOTTUTTTO....",
        "....OTTTTTTOOTTTTTTO....",
        "....OUTTTTUOOUTTTTUO....",
        "....OFFFFFFOOFFFFFFO....",
        "....OFFFFFFOOFFFFFFO....",
        "....OFFFFFOOOOFFFFFO....",
        "........................"
      ],
      // Netrunner (Wren) — REDRAWN 24x32 as a FEMALE synthetic/android. Female
      // cues: long hair framing the face and falling to the shoulders, narrow
      // shoulders + a waist taper (hourglass), slim limbs. Synthetic cues kept:
      // glowing cyan eyes (both), cool pale skin, a cyan circuit line (V) down
      // the bodysuit.
      heroNetrunner: [
        "........................",
        ".......OHHHHHHHHO.......",
        "......OHHHHHHHHHHO......",
        ".....OHHHHHHHHHHHHO.....",
        ".....OHHSSSSSSSSHHO.....",
        ".....OHSSSSSSSSSSHO.....",
        ".....OHSVVSSSSVVSHO.....",
        ".....OHSSSSDDSSSSHO.....",
        ".....OHKSSSSSSSSKHO.....",
        ".....OHSSSDDDDSSSHO.....",
        ".....OHHSSSSSSSSHHO.....",
        "......OHHKSSSSKHHO......",
        "......OHHHOOOOHHHO......",
        ".....OHHHO....OHHHO.....",
        "......OABBBBBBBBAO......",
        "......OABBBBBBBBAO......",
        ".....OSABBVVVVBBASO.....",
        ".....OSABBVVVVBBASO.....",
        "......OABBVVVVBBAO......",
        "........OBBVVBBO........",
        "......OBBBBVVBBBBO......",
        ".....OBBBBBVVBBBBBO.....",
        ".....OTTTTOOOOTTTTO.....",
        ".....OTTTTOOOOTTTTO.....",
        ".....OTTTUOOOOUTTTO.....",
        ".....OTTTTOOOOTTTTO.....",
        "......OTTTOOOOTTTO......",
        "......OFFFOOOOFFFO......",
        "......OFFFOOOOFFFO......",
        "......OFFFO..OFFFO......",
        "........................",
        "........................"
      ],
      heroDread: [      // tank: horned great-helm, red T-visor, heavy plate, front greatsword
        "..................",
        ".......OMMO.......",
        "......OMPPMO......",
        ".....OMPMMPMO.....",
        "....OMMMMMMMMO....",
        "...OMMPMMMMPMMO...",
        "...OMMMMMMMMMMO...",
        "...OMMMVVVVMMMO...",
        "...OMMMVVVVMMMO...",
        "...OMMMMVVMMMMO...",
        "...OMPMMMMMMPMO...",
        "....OMMMMMMMMO....",
        "..ONMMMPPMMMMNO...",
        ".OMPMMMPPMMMMPMO..",
        ".OMPMMBPPBBMMPMO..",
        ".ONMMBBPPBBBMMNO..",
        "..OMMBBPPBBBMMO...",
        "...OMBOPPOBBMO....",
        "...OMBBOOBBBMO....",
        "....OBBBBBBBO.....",
        "....OCBBBBBCO.....",
        "....OMMMOOMMMO....",
        "....OMMMOOMMMO....",
        "....OMMUOOUMMO....",
        "....OFFFOOFFFO....",
        "...OFFFO..OFFFO...",
        "..................",
        ".................."
      ],
      // Mech Runner (Kade) — REDRAWN 24x32 as a HUMAN FACE + FULL MECH BODY
      // (per user direction: "more mech than human body"). A small human head
      // sits atop a bulky mechanical exo-frame: wide angular shoulders, a
      // glowing amber power core (V) in the chest, an asymmetric build (right
      // arm is a heavy cannon (N barrel), left ends in a mech hand (X)), rust
      // joints (R), thick mech legs + big feet. Reads as "the machine" of the
      // party vs. the Merc's human body — the two are now clearly different.
      heroMech: [
        "........................",
        "......OHHHHHHHHHHO......",
        "......OHSSSSSSSSHO......",
        "......OSSDDDDDDSSO......",
        "......OSWESSSSWESO......",
        "......OSSSSDDSSSSO......",
        "......OKSSSSSSSSKO......",
        "......OSSDDDDDDSSO......",
        ".......OKSSSSSSKO.......",
        "........OCCCCCCO........",
        ".....ORMMMMMMMMMMRO.....",
        "..OMMMMMMMMMMMMMMMMMMO..",
        "..OMPMMORMMMMMMRMOMMPMO.",
        "..OMMMMOMAAAAAAAAMOMMMMO",
        "..OMMMMOMAAAVVAAAMOMMMMO",
        "..OMPMMOMAAAVVAAAMOMMPMO",
        "..OMMMMOMAAAAAAAAMOMMNNN",
        "..OMMMMOMMMMMMMMMMOMMNNN",
        "...ORROMMMMMMMMMMORRO...",
        "...OMMMOMMMMMMMMOMMMO...",
        "...OXXMOMMMMMMMMOMXXO...",
        "....OMMMMMMMMMMMMMMO....",
        "....OMMMNMMOOMMNMMMO....",
        "....OMMMMMMOOMMMMMMO....",
        "....ORMMMMMOORMMMMMRO...",
        "....OMMMNMMOOMMNMMMO....",
        "....OMMMMMMOOMMMMMMO....",
        "....ONMMMMNOONMMMMNO....",
        "...OFFFFFFFOOFFFFFFFO...",
        "...OFFFFFFFOOFFFFFFFO...",
        "...OFFFFFFOOOOFFFFFFO...",
        "........................"
      ],
      heroMentalist: [  // psion: staff + orb, deep hood, two glowing purple eyes, runed robe
        "..................",
        "..V......OOOO.....",
        ".VVO...OOJHHJOO...",
        ".OMO..OJHHHHHHJO..",
        ".OMO.OJHHHHHHHHJO.",
        ".OMO.OHHHHHHHHHHO.",
        ".OMO.OHHOOOOOOHHO.",
        ".OMO.OHOSSSSSSOHO.",
        ".NMO.OHOSSSSSSOHO.",
        ".OMO.OHOVVSSVVOHO.",
        ".OMO.OHOSSSSSSOHO.",
        ".OMO.OHOKSDDSKOHO.",
        ".NMO.OHHOOOOOOHHO.",
        ".OMO..OHHHHHHHHO..",
        ".OMO..OAHBBBBHAO..",
        ".NMO.OABBBBBBBBAO.",
        ".OMO.OABBRRRRBBAO.",
        ".OO..OBBBRRRRBBBO.",
        "....OBBBBRRRRBBBBO",
        "....OBBBBBRRBBBBBO",
        "....OABBBBRRBBBBAO",
        "...OABBBBBBBBBBBAO",
        "...OABBBBBBBBBBBAO",
        "..OAABBBBBBBBBBAAO",
        "..OAABBBBBBBBBBAAO",
        "..OOAAAAAAAAAAAAO.",
        "...OOOOOOOOOOOOO..",
        ".................."
      ],
      // Spider Drone — a mechanical spider (not a blob): a rounded metal chassis
      // (B) with highlights (P) and a glowing red optic band (E), and six clearly
      // jointed legs (upper/mid/lower pair) splayed out to feet. O = dark outline
      // + leg base, L = leg mid-segment.
      spiderDrone: [
        "................",
        "..O..........O..",
        "..OL........LO..",
        "...OL......LO...",
        "....OL....LO....",
        ".....OBBBBO.....",
        "..OL.BPPPPB.LO..",
        ".OLLOBPEEPBOLLO.",
        ".OLLOBPEEPBOLLO.",
        "..OL.BPPPPB.LO..",
        ".....OBBBBO.....",
        "....OL....LO....",
        "...OL......LO...",
        "..OL........LO..",
        "..O..........O..",
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
      hiveCrawler: [
        "................",
        "................",
        "....AA....AA....",
        "......OHHO......",
        ".....OHHHHO.....",
        "....OOBBBBOO....",
        "...OBBBBBBBBO...",
        "..LOBBBBBBBBOL..",
        "..LOBBBBBBBBOL..",
        "...OBBBBBBBBO...",
        "....OOBBBBOO....",
        "....OLL..LLO....",
        "................",
        "................",
        "................",
        "................"
      ],
      // Humanoid grunt — Tiangong Pvt., Colony Guard: bare-headed fodder/
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
      // stun-baton (matches the Colony Guard's Baton Strike), right arm down in
      // a gauntlet. Modular accent zones for later-tier reskins: H = pauldron /
      // heavy-plate accent, V = glow accent (baton tip / a visor glow) — recolor
      // for riot / heavy variants. Used by Colony Guard + Tiangong Pvt.
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
        "..AA.OSDWWWWWWWDSO......",
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
      // Humanoid officer — Tiangong Lt., Talos Vanguard, Overseer Krell
      // (boss — same shape, bigger via tier-based scale, own palette): a
      // bigger, more ornate humanoid for elite/boss-tier organic enemies.
      humanoidOfficer: [
        "................",
        "....OHHHHHHO....",
        "...OHVVVVVVHO...",
        "....OSSSSSSO....",
        "...OOCCCCCCOO...",
        ".OAAABBBBBBAAAO.",
        ".OAABBBBBBBBAAO.",
        ".OAABBBBBBBBWGO.",
        "..BBBBBBBBWWWWWW",
        "..BBBBBBBB.WWWW.",
        "...OOKKKKKKOO...",
        "..OLLLLLLLLLLO..",
        "...LLLL..LLLL...",
        "...LLLL..LLLL...",
        "...FFFF..FFFF...",
        "................"
      ],
      // Sentry bot — Arc Sentinel: a small hovering drone/turret, single big
      // optic, an emitter coil on top, stabilizer fins instead of legs.
      sentryBot: [
        "................",
        "......OOOO......",
        ".......VV.......",
        "......OEEO......",
        ".....OEEEEO.....",
        "....OOOOOOOO....",
        "...OBBBBBBBBO...",
        "..OBBBBBBBBBBO..",
        "..ABBBBBBBBBBA..",
        "...ABBBBBBBBA...",
        "....OOOOOOOO....",
        ".....OVVVVO.....",
        "................",
        "................",
        "................",
        "................"
      ],
      // Heavy mech — Security Mech, the Warden (boss — same shape, bigger via
      // tier scale, own palette): a blocky armored robot, one wide visor band
      // (no separate eyes, unlike the organic officer shape), a shoulder
      // cannon reading as the heavy weapon.
      heavyMech: [
        "................",
        "....OHHHHHHO....",
        "...OHVVVVVVHO...",
        "....OHHHHHHO....",
        "...OOCCCCCCOO...",
        ".OAAABBBBBBAAAO.",
        "OAABBBBBBBBBBAAO",
        "OAABBBBBBBWWWWGO",
        "BBBBBBBBBBWWWWWW",
        "BBBBBBBBBB.WWWW.",
        "..OOKKKKKKKKOO..",
        ".OLLLLLLLLLLLLO.",
        "..LLLL....LLLL..",
        "..LLLL....LLLL..",
        "..FFFF....FFFF..",
        "................"
      ],
      // Hive brute — Erebus Warrior (standard) + Erebus Armored Warrior
      // (elite, same shape + an armor-plate accent color): upright insectoid
      // with compound eyes and claws out at shoulder height.
      hiveBrute: [
        "................",
        "......OHHO......",
        ".....OHVVHO.....",
        "....OHHHHHHO....",
        "...OOCCCCCCOO...",
        ".OAAABBBBBBAAAO.",
        "WOAABBBBBBBBAAOW",
        ".OAABBBBBBBBAAO.",
        "..BBBBBBBBBBBB..",
        "..BBBBBBBBBBBB..",
        "...OOKKKKKKOO...",
        "..OLLLLLLLLLLO..",
        "...LLLL..LLLL...",
        "...LLLL..LLLL...",
        "...FFFF..FFFF...",
        "................"
      ],
      // Hive mystic — Erebus Shaman: an insectoid caster, carapace flaring
      // out like a mage's hood (the same silhouette trick as the Mentalist's
      // mageRobe, in carapace instead of cloth), glowing psi eyes, a rune/
      // staff hand.
      hiveMystic: [
        "................",
        ".......HH.......",
        ".....OHHHHO.....",
        "....OOHVVHOO....",
        "...OHHHHHHHHO...",
        "..OHHHHHHHHHHO..",
        ".OAABBBBBBBBAAO.",
        ".OAABBBBBBBBWGO.",
        "..BBBBBBBBWWWW..",
        "..BBBBBBBB.WW...",
        "..OBBBBBBBBBBO..",
        "..OBBBBBBBBBBO..",
        ".OBBBBBBBBBBBBO.",
        "OBBBBBBBBBBBBBBO",
        "OKKKKKKKKKKKKKKO",
        "................"
      ],
      // Hive lord — the Broodmarshal (boss): the biggest, most ornate hive
      // shape — jagged crown spikes, a wide glowing multi-eye band, claws
      // both sides. Its palette (below) gives one collar patch a cold metal
      // tone — the fused Tiangong control rig from its story canon (§5.3) —
      // without needing extra geometry.
      hiveLord: [
        "................",
        "....OH.HH.HO....",
        "...OHHHHHHHHO...",
        "..OOHHVVVVHHOO..",
        "..OHHHHHHHHHHO..",
        "..OOCCCCCCCCOO..",
        "OAAABBBBBBBBAAAO",
        "WOAABBBBBBBBAAOW",
        "OAABBBBBBBBBBAAO",
        "OAABBBBBBBBBBWGO",
        "BBBBBBBBBBBBWWWW",
        "BBBBBBBBBBBB.WWW",
        "..OOKKKKKKKKOO..",
        ".OLLLLLLLLLLLLO.",
        "OLLLLLLLLLLLLLLO",
        "OKKKKKKKKKKKKKKO"
      ],
      // Overseer Krell (boss) — a bespoke fat, jowly tyrant in an officer's coat,
      // cracking a whip overhead. Small capped head, huge belly straining a red
      // sash, stubby legs; the lash (N) arcs up from his raised grip (W) and
      // curls at the top-right. 22x22, rendered a touch bigger than other bosses
      // via a scale override (§ui SHAPE_SCALE_OVERRIDE).
      // Legend: O outline | P cap V gold-brim | S skin D jowl-shadow E eye M mustache
      //   C collar | B coat A coat-shadow/arm | R red sash | W whip-grip N whip-lash
      //   L coat-hem T pants F boot
      krellFat: [
        "...............NNN....",
        "......OPPPPPPPPO..N.N.",
        "......OPPPPPPPPO...N.N",
        ".....OVVVVVVVVVVO...N.",
        ".....OSSSSSSSSSSO..N..",
        ".....OSSEESSEESSO.N...",
        ".....OSSSSDDSSSSON....",
        ".....OMMMMMMMMMMWN....",
        ".....OSDDDDDDDDSWO....",
        "....OSDDDDDDDDDDSO....",
        "....OCCCCCCCCCCCCO....",
        "..OAABBBBBBBBBBBBAAO..",
        ".OABBBBBBBBBBBBBBBBBAO",
        ".OABBBBBBBBBBBBBBBBBAO",
        ".ORRRRRRRRRRRRRRRRRRO.",
        ".OABBBBBBBBBBBBBBBBAO.",
        "..OBBBBBBBBBBBBBBBBO..",
        "..OLLLLLLLLLLLLLLLLO..",
        "...OTTTTTTOOTTTTTTO...",
        "...OTTTTTTOOTTTTTTO...",
        "...OFFFFFFOOFFFFFFO...",
        "......................"
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
      // Merc — augmented trooper: warm skin with a green cyber-augment eye
      // (V, one side only — the "Human (Augmented)" fiction), brown hair,
      // olive tactical vest with a dark bandolier, gunmetal rifle (M/N/P).
      merc:        { shape: "heroMerc",  palette: {
        O: "#0d1016",
        S: "#d09a63", K: "#f4c890", D: "#9c6b3d",      // skin base/light/shadow (D = brows/nose/mouth)
        H: "#4a3a28", G: "#6b5238", J: "#2e2418",      // hair base/light/shadow
        E: "#141414", W: "#eef0ea", V: "#6cff9e",      // eye pupil / white / green augment glow
        B: "#3a4a3d", A: "#26332a",                    // olive vest base / shadow (arms)
        M: "#727880", P: "#a2a8b0", N: "#2e333a",      // rifle metal / gleam / dark
        C: "#201c18", X: "#2a2a2c",                    // strap+belt+stock / glove
        T: "#35402f", U: "#232b1e", F: "#1a1f16"       // pants / pants-shadow / boot
      } },
      // Netrunner — synthetic hacker (per CLASSES.netrunner.nature): cool
      // pale-grey "skin," dark teal hair, BOTH eyes glowing cyan (no whites —
      // it's a machine), a cyan circuit-spine running down the bodysuit (V).
      netrunner:   { shape: "heroNetrunner",  palette: {
        O: "#0a0f13",
        S: "#b8c2c6", K: "#dbe4e6", D: "#7f8b90",      // pale synthetic "skin"
        H: "#1c2b33", G: "#2f4650", J: "#121c22",      // dark teal hair
        V: "#3dd6e0",                                   // cyan glow (eyes + circuits)
        B: "#1f3640", L: "#2f4e5a", A: "#142027",      // bodysuit base/light/shadow
        C: "#101a1f", T: "#182b32", U: "#101c21", F: "#0c151a"
      } },
      // Dread Knight — fully helmed tank (no bare face by design): dark steel
      // plate (M/P/N), a glowing red T-visor (V), a maroon underlayer (B/L/A),
      // and a pale steel greatsword blade held down the center front (the PP
      // column). "Voidborn" reads as grim black-and-red.
      dreadKnight: { shape: "heroDread",  palette: {
        O: "#0a0a0c",
        M: "#4a4e56", P: "#8f96a0", N: "#2a2d33",      // steel base/gleam/shadow (P also = sword blade)
        V: "#ff3b30",                                   // red visor glow
        B: "#3a2226", L: "#4d2e33", A: "#241417",      // maroon underarmor
        C: "#16161a", U: "#34383e", F: "#1a1a1e"
      } },
      // Mech Runner (Kade) — HUMAN FACE + FULL MECH BODY. Weathered human skin
      // on the face only; the body is gunmetal mech (M/P/N) with dark chest
      // panels (A), rust joints (R), a glowing amber power core (V), a mech
      // hand (X) and cannon arm (N). No cloth/pants — it's a machine.
      mechRunner:  { shape: "heroMech",  palette: {
        O: "#0d0d0f",
        S: "#c88a55", K: "#e8b078", D: "#8a5a30",      // face skin base/light/shadow
        H: "#3a2a1a",                                   // hair
        E: "#141414", W: "#e8e0d0",                    // eyes
        M: "#6b7078", P: "#9aa0a8", N: "#33383e",      // mech metal / gleam / dark (N = cannon)
        A: "#3a3d42",                                   // dark mech chest panel
        R: "#8a5a2c",                                   // rust joints / trim
        V: "#ffb347",                                   // amber power core glow
        C: "#241c14", X: "#565c64", F: "#1a1a1e"        // collar / mech hand / mech foot
      } },
      // Mentalist — hooded psion (its own robe shape): face sunk in hood
      // shadow with two glowing purple eyes (V), purple robe (B/L/A) with gold
      // runes (R) down the front, and a wooden staff topped with a psi-orb
      // (V) held at the side. The classic FF mage silhouette, re-skinned.
      mentalist:   { shape: "heroMentalist",  palette: {
        O: "#0c0812",
        S: "#8a7a9a", K: "#a595b5", D: "#5f5075",      // shadowed in-hood skin
        H: "#3a2c52", J: "#281c3a",                    // hood cloth base/shadow
        V: "#c77dff",                                   // purple glow (eyes + orb)
        B: "#4b3866", L: "#5e4a7e", A: "#33254a",      // robe base/light/shadow
        R: "#ffe08a",                                   // gold runes
        M: "#7a5a3a", N: "#4a3624"                      // staff wood
      } },
      // Spider Drone — gunmetal chassis, red optic band, darker jointed legs.
      spiderDrone: { shape: "spiderDrone",   palette: {
        E: "#ff5a44", O: "#2f353c", B: "#6b7580", P: "#9aa5b0", L: "#454d56"
      } },

      // ---------- TIANGONG (Sector 1 roster, §5.1) ----------
      // Hull Roach — unbranded pest, not Tiangong-issue; grimy grey/rust vs.
      // the hive's organic olive-green, so it still reads as "station vermin."
      hullRoach:    { shape: "hiveCrawler",     palette: {
        A: "#6b5a4a", H: "#5c4a3a", O: "#3a3128", B: "#7a6a55", L: "#4a3f30"
      } },
      // Arc Sentinel — small hovering shock-drone, amber/yellow arc glow.
      arcSentinel:  { shape: "sentryBot",        palette: {
        O: "#14140a", V: "#fff27a", E: "#ffcc33", B: "#55524a", A: "#6b6a5e"
      } },
      // Tiangong Pvt. — rank-and-file enforcer: drab khaki armor + olive helmet,
      // faction-green stun-baton glow. The differentiated guardTrooper (§5.1).
      tiangongPvt:  { shape: "guardTrooper",     palette: {
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
        B: "#5a6169", W: "#2b2f33", G: "#4a5158", K: "#b23a2e", L: "#454b52", F: "#262a2d"
      } },
      // Tiangong Lt. — field officer: richer khaki + a red rank sash.
      tiangongLt:   { shape: "humanoidOfficer",  palette: {
        O: "#14140f", H: "#3f3f30", V: "#8a8f6a", S: "#c9a071", C: "#2e2e22",
        A: "#454533", B: "#565640", W: "#c9ccd1", G: "#c9a071", K: "#6b2b22", L: "#3d3d2c", F: "#1e1e15"
      } },
      // The Warden — corrupted station AI core: same heavy-mech chassis as
      // Security Mech, gone dark and glowing red (malfunction), boss scale.
      warden:       { shape: "heavyMech",        palette: {
        O: "#0a0a0b", H: "#2c2f33", V: "#e0533d", C: "#222426", A: "#383b3f",
        B: "#43474c", W: "#1c1e21", G: "#383b3f", K: "#e0533d", L: "#2c2f33", F: "#17181a"
      } },

      // ---------- TALOS SYSTEMS (§5.1) ----------
      // Talos Wraith — fast fodder infiltrator, raw red-eyed and hunched.
      talosWraith:  { shape: "stealthHumanoid",  palette: {
        O: "#0d0808", H: "#3a1418", E: "#ff4d4d", B: "#5c1f24", C: "#d94f4f", L: "#3a1418"
      } },
      // Talos Phantom — standard stealth operative: sleeker, cooler blue-glow
      // variant of the same silhouette (a step up from Wraith, not a copy).
      talosPhantom: { shape: "stealthHumanoid",  palette: {
        O: "#0d1216", H: "#1c2731", E: "#5fd6ff", B: "#2a3742", C: "#24303a", L: "#1c2731"
      } },
      // Talos Vanguard — elite heavy operative: bio-augmented (visible skin),
      // maroon/black armor, matches Wraith/Phantom's red-glow family.
      talosVanguard:{ shape: "humanoidOfficer",  palette: {
        O: "#0d0808", H: "#3a1418", V: "#ff4d4d", S: "#b5773f", C: "#2a1012",
        A: "#4a1c1f", B: "#5c1f24", W: "#d94f4f", G: "#b5773f", K: "#1a1010", L: "#3a1418", F: "#1a0d0e"
      } },

      // ---------- KHARON'S REACH (§5.2a) ----------
      // Colony Guard — rough militia enforcer: dull worn brown armor + tan
      // helmet, dull amber baton glow (scavenged colony gear, no faction color).
      // Same guardTrooper shape as the Tiangong Pvt., recolored (§5.2a).
      colonyGuard:  { shape: "guardTrooper",     palette: {
        O: "#100d0a", P: "#5c4a34", G: "#7a6547",                 // helmet shell / rim + gorget
        S: "#c9a071", K: "#e0b98a", D: "#7a5330", W: "#c9c6be", E: "#141414",  // skin / brow / teeth / eyes
        C: "#2e2318", H: "#4a3c2a",                               // collar+belt / pauldron accent
        B: "#5c4a34", A: "#3f3222", X: "#241a12",                 // brown armor / shadow / gauntlet
        M: "#6b6158", V: "#d9a94e",                               // baton shaft / amber glow
        T: "#4a3c2a", U: "#2e2418", F: "#1a140d"                  // greaves / boots
      } },
      // Overseer Krell — chief overseer, boss scale: a fat, jowly tyrant in a
      // brown/gold officer coat with a deep-red sash, cracking a leather whip.
      // Bespoke krellFat shape (§SPRITE_SHAPES).
      krell:        { shape: "krellFat",         palette: {
        O: "#0c0a08", P: "#2a2318", V: "#ffcf5c",                 // cap / gold brim
        S: "#d8a878", D: "#b07850", E: "#141414", M: "#3a2c1c",   // ruddy skin / jowls / beady eyes / mustache
        C: "#4a3520",                                             // collar
        B: "#6b5238", A: "#4a3820", R: "#8a1f1f",                 // coat / coat-shadow / red sash
        W: "#c9a05a", N: "#3a2410",                               // whip grip / lash (leather)
        L: "#4a3820", T: "#3f3020", F: "#221a12"                  // hem / pants / boots
      } },

      // ---------- SITE EREBUS (§5.3) ----------
      erebusRoach:  { shape: "hiveCrawler",      palette: {
        A: "#5a6b2e", H: "#6b4423", O: "#3a2812", B: "#7a8f3a", L: "#4a3618"
      } },
      // Erebus Warrior — standard hive bruiser: olive-green carapace, faint
      // psi-green compound eyes.
      erebusWarrior:{ shape: "hiveBrute",        palette: {
        O: "#100d08", H: "#6b4423", V: "#a8f7c8", C: "#4a3018", A: "#5a3d1e",
        B: "#7a8f3a", W: "#9aa84a", G: "#5a3d1e", K: "#3a2812", L: "#4a3018", F: "#241a0d"
      } },
      // Erebus Shaman — hive-mind caste, the psionic caster: the same
      // psi-purple glow as the Mentalist (deliberate echo — see §5.3/§5.1's
      // Psionic-affinity design note) over an olive-brown carapace-hood.
      erebusShaman: { shape: "hiveMystic",       palette: {
        O: "#0d0a12", H: "#4a3820", V: "#c77dff", A: "#5a4a26", B: "#6b5a2e",
        W: "#d9b8ff", G: "#5a4a26", K: "#3a2e18"
      } },
      // Erebus Armored Warrior — the counter-pick elite: same hiveBrute
      // silhouette as Warrior, but steel-grey armor plating over the
      // carapace instead of bare olive chitin (the "armored" read).
      erebusArmoredWarrior: { shape: "hiveBrute", palette: {
        O: "#0c0a08", H: "#5a5f66", V: "#a8f7c8", C: "#3a3d42", A: "#454a50",
        B: "#565c63", W: "#7a8f3a", G: "#454a50", K: "#2c2e30", L: "#3a3d42", F: "#1e2023"
      } },
      // The Broodmarshal — hive leadership caste, boss scale: same species
      // colors as Warrior/Roach (olive carapace), a commanding gold multi-eye
      // band, and a cold-metal collar patch — the fused, non-functional
      // Tiangong control rig from its story canon (§5.3), no extra geometry
      // needed, just one palette key reading as metal instead of chitin.
      broodmarshal: { shape: "hiveLord",         palette: {
        O: "#0a0806", H: "#6b4423", V: "#ffcf5c", C: "#5a6169", A: "#5a3d1e",
        B: "#7a8f3a", W: "#9aa84a", G: "#5a3d1e", K: "#3a2812", L: "#4a3018"
      } },
      // --- Boss-support adds (2026-07-24): reuse existing shapes, recolored.
      // (Placeholder art — flag for bespoke sprites later if desired.)
      securityTurret: { shape: "sentryBot", palette: {   // gunmetal + red optic
        O: "#0c0e10", V: "#e0533d", E: "#ff5a44", B: "#4a5058", A: "#5a6169"
      } },
      repairDrone: { shape: "spiderDrone", palette: {    // medical green
        E: "#5affa0", O: "#1a2a22", B: "#3a6b52", P: "#7ad6a8", L: "#2a4a3a"
      } },
      riotEnforcer: { shape: "guardTrooper", palette: {  // black armor / hot-white baton
        O: "#080808", P: "#2a2a2e", G: "#3a3a40",
        S: "#c9a071", K: "#e0b98a", D: "#7a5330", W: "#e8e8e8", E: "#141414",
        C: "#18181c", H: "#dfe8ff",
        B: "#26262b", A: "#1a1a1e", X: "#0e0e10",
        M: "#6b6158", V: "#f4f8ff",
        T: "#26262b", U: "#141416", F: "#0a0a0c"
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
      // solo escape from a Tiangong mining colony. Linear on purpose (an
      // escape, not a dungeon crawl) and much shorter than Sector 1 — see
      // gridfall-design.md §5.2 for the story this dungeon tells.
      prologue: {
        start: "p1",
        title: "ESCAPE FROM KHARON'S REACH",
        region: "mining",   // map backdrop theme (Phase I): asteroid mining colony
        nextDungeonKey: "sector1",
        nodes: {
          p1: { id: "p1", type: "combat", depth: 1, connectsTo: ["p2"],
                enterText: "Security drones scramble to Voss's last position!" },
          p2: { id: "p2", type: "combat", depth: 2, connectsTo: ["p3"],
                enterText: "Guards flood the shaft ahead!" },
          // recruit: a non-combat story beat, not drawn from ENEMY_POOLS —
          // resolved by resolveRecruitNode(), same treatment as Loot/Rest.
          p3: { id: "p3", type: "recruit", depth: 3, connectsTo: ["p4"],
                recruitClass: "mechRunner", recruitName: "Kade", recruitButtonLabel: "Move out.",
                recruitText: [
                  "A side tunnel, half-collapsed. Kade is elbow-deep in a stalled loader rig, " +
                    "muttering about Tiangong's maintenance budget.",
                  "They see the rifle in your hands and the alarm lights just starting to strobe " +
                    "red down the shaft, and they don't ask a single question.",
                  "\"Hangar bay,\" Kade says, already pulling a salvaged mining laser off the " +
                    "loader's mount. \"I know a way through the drill line. Try to keep up.\""
                ] },
          p4: { id: "p4", type: "boss", depth: 4, connectsTo: [],
                enterText: "Overseer Krell blocks the hangar door!" }
        }
      },
      // Tiangong Station Sector 1 (Phase G, §5.1) — a genuine branch (safer
      // Combat+Rest vs riskier Elite+Loot) that reconverges before a final
      // Elite gate, a Rest stop, then the Boss. (n8 was added during Slice G4
      // balance testing: with no free heal between fights, going straight
      // from the Elite gate into the Boss left the party too depleted to have
      // a real shot — a rest stop right before a boss is also a standard
      // genre beat, so this earns its spot over strict 8-node math.)
      sector1: {
        start: "n1",
        title: "TIANGONG STATION SECTOR 1",
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
          // breach corridor alone first and meets Wren once it's clear,
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
          n1:   { id: "n1",   type: "combat", depth: 1, connectsTo: ["recruit1"] },
          recruit1: { id: "recruit1", type: "recruit", depth: 2, connectsTo: ["n2", "n3"],
                      recruitClass: "netrunner", recruitName: "Wren", recruitButtonLabel: "Move in.",
                      recruitText: [
                        "The corridor past the breach is quiet again, drones sparking on the deck " +
                          "plating where you left them. A side hatch hangs open a few meters " +
                          "ahead, forced from the inside.",
                        "Wren steps out before you reach it, still holding a remote trigger in " +
                          "one hand. \"Wondering when Kharon's Reach would finally bite back,\" " +
                          "they say. \"I've been bleeding this station's systems for months. Could " +
                          "use some backup that isn't a badly written script.\"",
                        "Three operators against a station isn't great odds, but it beats the " +
                          "two you walked in with."
                      ] },
          n2:   { id: "n2",   type: "combat", depth: 3, levelDepth: 2, connectsTo: ["n4"] },
          n3:   { id: "n3",   type: "elite",  depth: 3, levelDepth: 2, connectsTo: ["n5"] },
          n4:   { id: "n4",   type: "rest",   depth: 4, levelDepth: 3, connectsTo: ["n6"] },
          n5:   { id: "n5",   type: "loot",   depth: 4, levelDepth: 3, connectsTo: ["n6"] },
          n6:   { id: "n6",   type: "combat", depth: 5, levelDepth: 4, connectsTo: ["n7"] },
          n7:   { id: "n7",   type: "elite",  depth: 6, levelDepth: 5, connectsTo: ["n8"] },
          n8:   { id: "n8",   type: "rest",   depth: 7, levelDepth: 6, connectsTo: ["boss"] },
          boss: { id: "boss", type: "boss",   depth: 8, levelDepth: 7, connectsTo: [] }
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
                  "through." },
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
                enterText: "Tiangong ID plates, half dissolved, are bolted to a door the hive " +
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
                enterText: "Motion sensors flare red the moment you breach the outer seal — the " +
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
                  "You find them sitting very still in the dark, staring at their own hands like " +
                    "they don't fully trust what those hands will do next. A specimen tag is still " +
                    "fused to one wrist: SUBJECT SIX. They don't offer another name.",
                  "\"They were trying to teach it to listen,\" Six says, finally looking up. \"It " +
                    "listened to me instead. I can hear the ones still in the tanks — screaming " +
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
                 enterText: "The air changes past this point — warmer, wetter, wrong. Something " +
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
                      enterText: "Both wings of the foundry answer the alarm at once — security " +
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
        nextDungeonKey: null,   // Dungeon 6 "the Cradle" not yet built
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
          bossSoul: { id: "bossSoul", type: "boss", depth: 6, connectsTo: ["bossSun"],
                      bossEncounter: [{ key: "voidSoulEater", level: 7 }],
                      enterText: "The atrium floor isn't floor anymore, just an absence with a shape, " +
                        "and the shape is hungry. It has been waiting here longer than the station has " +
                        "had a name." },
          bossSun:  { id: "bossSun", type: "boss", depth: 7, connectsTo: [],
                      bossEncounter: [{ key: "sunGod", level: 8 }],
                      enterText: "The dark clears in one instant, not gradually, the way night breaks " +
                        "over a horizon that shouldn't exist this close to a star. Something wearing " +
                        "the shape of Helios's own regulator core opens eyes that were never built to " +
                        "see with." }
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


