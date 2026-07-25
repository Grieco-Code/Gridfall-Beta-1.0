# GRIDFALL v2 — Approved Plan

*Companion to `gridfall-v1-kickoff.md`. v1 (single Merc vs. single Spider Drone) is complete in `game.html`.*

**Theme of v2:** build out the *guts* of the game — characters, combat, and systems — before touching visuals or wider expansion. Same working style as v1: everything data-driven, built in small explained steps, each phase playable and reviewed before the next.

---

## Locked decisions

- **Party selection:** a pre-battle character-select screen. All **5 classes are selectable**; player picks up to **3**.
- **Max party size:** 3.
- **Max enemy group size:** 6 (an encounter holds 1–6 enemies).
- **Inventory:** a single **shared party bag**.
- **Resource:** **one EN pool per character**, doubling as skill points *and* mana points. No separate MP.
- **Status effects:** included in v2 (they're core to class identity, not an afterthought).
- **Mentalist:** the heaviest magic user — strongest direct psi attacks *and* the best at applying negative status effects (debuffs) to enemies.

---

## Core architectural shift

v1 uses two fixed variables (`hero`, `enemy`). v2's foundation is that **everyone lives in lists**:

- `party` — array of hero objects (up to 3)
- `enemies` — array of enemy objects (up to 6)

This is an **extension** of the v1 design, not a rewrite: `turnOrder()` already sorts a list by Speed, and `applySkill(skill, actor, target)` already thinks in "actor acts on target."

Two new concepts skills need:
- **Target type:** `enemy`, `ally`, `self`, `allEnemies`, `allAllies` — controls who an action may point at.
- **Persistent party state:** party HP/EN/XP/level carry *between* fights, in memory. (No save-to-disk — that stays out of scope.)

---

## Selectable class roster

Party of up to 3 chosen from these 5. Full skill kits are finalized (as data tables) in Phase C; only what we wire up gets built.

| Class | Race (default) | Identity | EN use |
|-------|------|----------|--------|
| **Merc** | Human (Augmented) | Reliable gun DPS, AoE grenade | light |
| **Dread Knight** | Human (Voidborn) | Tank — high HP/DEF, Guard, taunt | light |
| **Mech Runner** | Human (Earth) | Heavy-weapons platform, big single-target hits, self-overclock | medium |
| **Netrunner** | Synthetic | Hacker/control — EMP (strong vs. machines), disable/stun, defense-down debuffs | medium |
| **Mentalist** | Human (Earth) | Heaviest mage — strong direct psi attacks + best enemy debuffs (weaken, fear, confuse) | heavy |

**Netrunner vs. Mentalist:** Netrunner debuffs are *tech/EMP* (disable machines, shred defense — control/utility). Mentalist debuffs are *psionic* (weaken attack, fear, confusion) on top of the strongest raw magic damage.

---

## Build order (each phase playable and reviewed)

| Phase | What we add |
|------|-------------|
| **A. Multi-combatant combat + targeting** | Party & enemy *lists*, initiative order by Speed, click-to-target UI, party-select screen, enemy panels that scale to a group of up to 6 |
| **B. Status-effect engine** | Fill `tickEffects()`: effects with type / magnitude / duration that tick each round (DoT, buffs, debuffs, stun) |
| **C. Classes & skills** | All 5 class kits as data — Mentalist gets the deepest psi + debuff set; heals/buffs target allies |
| **D. Enemies & encounters** | More mob types at scaling difficulty; an encounter = a defined group |
| **E. XP & leveling** | Difficulty-scaled XP rewards, level-ups raise stats, party persists between fights; ability-unlock hook left for later |
| **F. Inventory & items** | Shared party bag; items as data with IDs (Stim, EN Cell, throwables, revive); use in combat |

A must come first; C depends on B; D before E. Order can otherwise flex.

---

## Explicitly out of scope for v2

Saving to disk · equipment/gear · dungeon map & travel between encounters · sprites/animation/sound · classes/races beyond the 5 starters.

---

## Proposed starting stats (tunable)

| Class | HP | EN | ATK | DEF | SPD |
|-------|----|----|----|-----|-----|
| Merc | 120 | 30 | 18 | 10 | 12 |
| Dread Knight | 160 | 20 | 16 | 16 | 8 |
| Mech Runner | 130 | 25 | 22 | 11 | 9 |
| Netrunner | 95 | 35 | 12 | 8 | 13 |
| Mentalist | 90 | 40 | 10 | 8 | 11 |

Enemy roster and XP values are defined in Phase D.
