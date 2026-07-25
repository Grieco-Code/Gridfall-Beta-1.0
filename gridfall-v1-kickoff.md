# Project Kickoff: GRIDFALL — a gritty space-core turn-based RPG (v1)

*(Working title "GRIDFALL" is a placeholder — rename anytime.)*

---

## Read this first (context for you, Claude Code)

I'm a complete beginner — this is my first coding project. As we work, please:

- Explain what you're doing in plain language as you go.  
- Prefer clean, well-commented, readable code over clever or compact code.  
- Don't over-engineer. Build the smallest thing that works, then we iterate.  
- **Before writing any code, restate the plan and the file structure you intend to create, and check it with me first.**

---

## What we're building (the big picture)

A turn-based RPG in the style of classic Final Fantasy, re-themed as **gritty space opera / cyberpunk — "space-core."** Long term this becomes a *repeatable mini-dungeon crawler*: pick a character, fight through a short series of encounters, with an expanding roster of races, classes, enemies, and status effects.

We are **not** building all of that now. This document is **v1 only**. But please build v1 so it extends cleanly toward that vision (see Architecture below).

The eventual roster we're growing toward (for context, **do not build these yet**):

- **Races:** Human — Earth / Augmented / Voidborn, plus Synthetic and Space Squid.  
- **Classes:** Mech Runner, Merc, Dread Knight, Netrunner, Mentalist.

---

## Platform

- A single, self-contained HTML file named `game.html`, using plain vanilla **HTML, CSS, and JavaScript**.  
- **No frameworks, no build tools, no libraries, no installs.** I want to run it by double-clicking the file to open it in a browser, and eventually host that one file so I can play it on my phone.

---

## v1 scope — exactly this, nothing more

**One battle: my hero versus a single Spider Drone.** Turn-based. When it ends, I can fight again.

### The hero — Augmented Human Merc

- **Race:** Human (Augmented) — a street-runner boosted with combat implants.  
- **Class:** Merc — a reliable gun-for-hire.  
- **Starting stats** (tune freely; keep them round and simple):  
  - HP **120**, Energy (EN) **30**, Attack **18**, Defense **10**, Speed **12**  
- **Actions:**  
  - **Attack** — basic gunfire. Costs nothing. Damage ≈ Attack − enemy Defense, with small random variance, minimum 1\.  
  - **Tech — "Frag Grenade"** — costs 10 EN, deals notably more damage than a basic attack.  
  - **Item — "Stim"** — restores \~40 HP. Start with 3\.  
  - **Run** — a chance to flee and end the battle.

### The enemy — Spider Drone

- A skittering corporate security bot.  
- **Starting stats:** HP **45**, Attack **12**, Defense **6**, Speed **10**  
- **Behavior for v1:** on its turn it simply uses a basic attack. (We'll give it a special / status move later.)

### Combat rules

- **Turn order by Speed** (higher acts first). Trivial in a 1v1 — but build it so it generalizes to more combatants.  
- On my turn I click an action button → resolve it → the drone takes its turn → repeat.  
- A **message log** at the bottom narrates each action (e.g. "Merc fires — 11 damage\!", "Spider Drone bites — 6 damage\!").  
- Battle ends when either side reaches 0 HP. Show a win/lose message and a **"Fight again"** button that resets both sides to full.

### The screen (keep it simple and readable)

- A **hero panel** (name, HP bar, EN bar) and an **enemy panel** (name, HP bar), clearly laid out.  
- A row of **action buttons**: Attack / Tech / Item / Run.  
- A **scrolling message log**.  
- A grimy, dark "space terminal" look is welcome, but keep it lightweight — **no images needed, CSS only.**

---

## Architecture — build v1 so it grows (important)

Please lay these foundations even though v1 is tiny, because they're what make v2+ easy:

- Represent the hero and the enemy as **data objects**, e.g. `{ name, race, class, stats: { hp, maxHp, en, maxEn, attack, defense, speed }, skills: [...], effects: [] }`. The combat code should read from these objects — never hard-code "the hero" or "the drone."  
- Represent **skills/actions as data** too, e.g. `{ name, enCost, kind: "attack" | "heal" | ..., power }`, with **one function** that applies a skill based on its data. Adding a new skill later should mean adding a data entry, not rewriting logic.  
- Structure a turn as **"an actor takes an action against a target."** Even though v1 is 1v1, writing it this way means adding a party or multiple enemies (with targeting) later is an *extension*, not a rewrite.  
- Leave a clean, **empty seam for status effects**: give each combatant an `effects: []` array and a clearly-marked spot in the turn cycle where effects would "tick" each round — but do **not** implement any status effects in v1. Just leave the hook and a comment.  
- Keep all data (hero, enemy, skills) grouped near the **top of the file** so it's easy to find and tweak.

---

## Explicitly OUT of scope for v1 (do not build these yet)

- Multiple party members; multiple enemies / target selection (v1 is strictly **1 vs 1**)  
- Leveling, XP, or a deeper inventory  
- The dungeon map, multiple encounters, or progression between fights  
- Saving / loading  
- Sprites, animation, or sound

---

## How I'd like us to work

1. First, **restate the plan and the file layout**, and confirm it with me.  
2. Then build it in **small, explained steps**.  
3. Once it runs and is fun, we'll plan **v2**: a swarm of Spider Drones \+ targeting → then status effects → then the repeatable dungeon loop.

