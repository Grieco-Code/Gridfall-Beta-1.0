"use strict";

    /* ================================================================
       F) COMBAT CORE
       ================================================================ */

    function resolveSkill(skillKey, actor, targets) {
      const skill = SKILLS[skillKey];
      actor.stats.en = clamp(actor.stats.en - skill.enCost, 0, actor.stats.maxEn);
      targets.forEach(function (t) { applyToTarget(skill, actor, t); });
    }

    function applyToTarget(skill, actor, target) {
      if (skill.kind === "attack") {
        // Base damage uses EFFECTIVE stats (Weaken lowers attack, Sunder lowers defense).
        // `pierce` ignores a fraction of the target's defense (armor-piercing hits).
        const def = effectiveDefense(target) * (1 - (skill.pierce || 0));
        const base = effectiveAttack(actor) + skill.power - def;
        let damage = Math.max(1, base + randomBetween(-2, 2));

        // Affinity multiplier — always ≥1, so a hard-resisted hit still chips.
        const mult = affinityMultiplier(target, skill.damageType);
        damage = Math.max(1, Math.round(damage * mult));

        // Guard on the target reduces incoming damage.
        damage = Math.max(1, Math.round(damage * guardMultiplier(target)));

        // Global enemy-damage difficulty knob (Phase 1c) — only enemy hits, and
        // not set-piece bosses (they're individually tuned; see createEnemy).
        if (actor.side === "enemies" && actor.tier !== "boss") {
          damage = Math.max(1, Math.round(damage * ENEMY_DAMAGE_MULT));
        }

        // Feedback text/color: only call out non-neutral affinity results.
        let feedback = "", cls;
        if (mult > 1)         { feedback = " Super effective!"; cls = "super"; }
        else if (mult <= 0.25){ feedback = " Barely a scratch."; cls = "resist"; }
        else if (mult < 1)    { feedback = " Resisted."; cls = "resist"; }

        target.stats.hp = clamp(target.stats.hp - damage, 0, target.stats.maxHp);
        flashCombatant(target.id);
        log(actor.name + " " + skill.message + " " + target.name +
            " — " + damage + " damage!" + feedback, cls);

        // Limit Break gauge: dealing damage (attacker) and taking damage (target),
        // heroes only — enemies don't have a functional Limit Break yet.
        if (actor.side === "heroes") gainLimit(actor, damage * GAUGE_PER_DAMAGE_DEALT);
        if (target.side === "heroes") gainLimit(target, damage * GAUGE_PER_DAMAGE_TAKEN);

        if (!isAlive(target)) {
          log(target.name +
              (target.side === "enemies" ? " is destroyed!" : " goes down!"),
              target.side === "enemies");
          if (actor.side === "heroes") gainLimit(actor, GAUGE_PER_KILL);
        } else if (skill.applies) {
          let applied = false;
          skill.applies.forEach(function (spec) { if (addEffect(target, spec)) applied = true; });
          if (applied && actor.side === "heroes") gainLimit(actor, GAUGE_PER_STATUS_APPLIED);
        }

        // Boss reinforcement hook (Site Erebus, §5.3 — generic, not
        // Broodmarshal-specific): fires once, the first time an enemy with a
        // reinforceWave drops to/below reinforceAt.
        if (isAlive(target) && target.side === "enemies" && target.reinforceWave &&
            !target.reinforced && target.stats.hp <= target.stats.maxHp * target.reinforceAt) {
          target.reinforced = true;
          spawnReinforcements(target);
        }

      } else if (skill.kind === "heal") {
        // Cleanse (Limit Break support ultimates): strip negative effects first,
        // keeping buffs, before the heal amount/log below.
        if (skill.cleanse) {
          target.effects = target.effects.filter(function (e) { return STATUSES[e.type].buff; });
        }

        const before = target.stats.hp;
        target.stats.hp = clamp(target.stats.hp + skill.power, 0, target.stats.maxHp);
        const healed = target.stats.hp - before;
        const who = (target.id === actor.id) ? "themselves" : target.name;
        log(actor.name + " " + skill.message + " " + who +
            " — restores " + healed + " HP!" + (skill.cleanse ? " Cleansed!" : ""));
        if (actor.side === "heroes") gainLimit(actor, healed * GAUGE_PER_HEAL);
        if (skill.applies) skill.applies.forEach(function (spec) { addEffect(target, spec); });

      } else if (skill.kind === "status") {
        // Pure status skill: no damage/heal, just applies its effects.
        const who = (target.id === actor.id) ? "" : (" " + target.name);
        log(actor.name + " " + skill.message + who + ".");
        let applied = false;
        if (skill.applies) skill.applies.forEach(function (spec) { if (addEffect(target, spec)) applied = true; });
        if (applied && actor.side === "heroes") gainLimit(actor, GAUGE_PER_STATUS_APPLIED);
      }
    }


    /* ================================================================
       G) TARGETING (player turns only)
       ================================================================ */

    function validTargets(skill, actor) {
      if (skill.target === "self") return [actor];
      if (skill.target === "enemy" || skill.target === "allEnemies")
        return living(opponentsOf(actor));
      if (skill.target === "ally" || skill.target === "allAllies")
        return living(alliesOf(actor));
      return [];
    }

    function chooseSkill(skillKey) {
      const skill = SKILLS[skillKey];
      if (activeCombatant.stats.en < skill.enCost) {
        log("Not enough EN for " + skill.name + ".");
        return;
      }
      pendingAction = { key: skillKey, isItem: false };
      enterTargeting(skill);
    }

    function chooseItem(itemKey) {
      if ((partyItems[itemKey] || 0) <= 0) {
        log("No " + SKILLS[itemKey].name + " left.");
        return;
      }
      pendingAction = { key: itemKey, isItem: true };
      enterTargeting(SKILLS[itemKey]);
    }

    // Spend a full (100%) Limit Break gauge on its class ultimate.
    function chooseLimitBreak() {
      const hero = activeCombatant;
      if (hero.limit < 100) return;   // guard; the button is disabled below 100 anyway
      const skillKey = CLASSES[hero.classKey].limitBreak;
      pendingAction = { key: skillKey, isItem: false, isLimit: true };
      enterTargeting(SKILLS[skillKey]);
    }

    function enterTargeting(skill) {
      const targets = validTargets(skill, activeCombatant);
      if (skill.target === "self") { performPendingAction([activeCombatant]); return; }
      if (skill.target === "allEnemies" || skill.target === "allAllies") {
        performPendingAction(targets);
        return;
      }
      highlightTargets(targets);
      setBanner("Choose a target");
      showCancelOnly();
    }

    function highlightTargets(targets) {
      targets.forEach(function (t) {
        const panel = document.getElementById("panel-" + t.id);
        panel.classList.add("targetable");
        panel.onclick = function () { onTargetClicked(t.id); };
      });
    }

    function clearTargeting() {
      allCombatants().forEach(function (c) {
        const panel = document.getElementById("panel-" + c.id);
        if (!panel) return;
        panel.classList.remove("targetable");
        panel.onclick = null;
      });
    }

    function onTargetClicked(targetId) {
      const target = findById(targetId);
      clearTargeting();
      performPendingAction([target]);
    }

    function performPendingAction(targets) {
      const action = pendingAction;
      pendingAction = null;
      if (action.isItem) {
        partyItems[action.key] = (partyItems[action.key] || 0) - 1;
      }
      targets = applyConfusion(activeCombatant, SKILLS[action.key], targets);
      resolveSkill(action.key, activeCombatant, targets);
      if (action.isLimit) activeCombatant.limit = 0;   // always fully spent, regardless of any gauge gained during resolution
      updateScreen();
      finishHeroAction();
    }

    function showCancelOnly() {
      const bar = document.getElementById("actions");
      bar.innerHTML = "";
      const cancel = document.createElement("button");
      cancel.className = "cancel";
      cancel.textContent = "Cancel";
      cancel.onclick = cancelTargeting;
      bar.appendChild(cancel);
    }

    function cancelTargeting() {
      pendingAction = null;
      clearTargeting();
      beginHeroChoice(activeCombatant);
    }

    function finishHeroAction() {
      clearActions();
      setBanner("");
      setTimeout(endTurn, 500);
    }


    /* ================================================================
       H) TURN FLOW — initiative, turns, enemy AI, win/lose.
       ================================================================ */

    // Status effects tick at the START of a combatant's turn:
    //   1) apply start-of-turn effects (Burn damage, Regen healing; note if Disabled),
    //   2) count every effect's duration down and expire the finished ones.
    // Returns true if the combatant is Disabled (and so should skip its turn).
    function tickEffects(combatant) {
      if (combatant.effects.length === 0) return false;

      let disabled = false;
      combatant.effects.forEach(function (e) {
        if (e.type === "burn") {
          combatant.stats.hp = clamp(combatant.stats.hp - e.magnitude, 0, combatant.stats.maxHp);
          log(combatant.name + " takes " + e.magnitude + " burn damage.", "resist");
        }
        if (e.type === "regen" && isAlive(combatant)) {
          combatant.stats.hp = clamp(combatant.stats.hp + e.magnitude, 0, combatant.stats.maxHp);
          log(combatant.name + " regenerates " + e.magnitude + " HP.", "super");
        }
        if (e.type === "disable") disabled = true;
      });

      const keep = [];
      combatant.effects.forEach(function (e) {
        e.duration -= 1;
        if (e.duration > 0) keep.push(e);
        else log(combatant.name + "'s " + STATUSES[e.type].name + " wears off.");
      });
      combatant.effects = keep;

      return disabled;
    }

    function turnOrder(combatants) {
      return combatants.slice().sort(function (a, b) {
        return b.stats.speed - a.stats.speed;
      });
    }

    function startRound() {
      if (battleOver) return;
      initiative = turnOrder(living(allCombatants()));
      turnIndex = 0;
      nextTurn();
    }

    function nextTurn() {
      if (battleOver) return;
      while (turnIndex < initiative.length && !isAlive(initiative[turnIndex])) {
        turnIndex++;
      }
      if (turnIndex >= initiative.length) { startRound(); return; }
      beginTurn(initiative[turnIndex]);
    }

    function beginTurn(combatant) {
      if (battleOver) return;
      activeCombatant = combatant;

      const disabled = tickEffects(combatant);   // Burn ticks; durations count down
      updateScreen();

      // Died to a damage-over-time effect at the start of the turn?
      if (!isAlive(combatant)) {
        log(combatant.name +
            (combatant.side === "enemies" ? " is destroyed!" : " goes down!"),
            combatant.side === "enemies");
        setTimeout(endTurn, 500);
        return;
      }

      // Disabled — skip the turn entirely.
      if (disabled) {
        clearActions();
        setBanner(combatant.name + " is disabled!");
        log(combatant.name + " is disabled and can't act!", "resist");
        setTimeout(endTurn, 800);
        return;
      }

      if (combatant.side === "heroes") {
        beginHeroChoice(combatant);
      } else {
        clearActions();
        setBanner(combatant.name + " is moving...");
        setTimeout(function () { enemyAct(combatant); }, 700);
      }
    }

    function beginHeroChoice(hero) {
      setBanner(hero.name + "'s turn — choose an action");
      renderActions(hero);
    }

    // --- Enemy target selection (Phase 1a, 2026-07-24) ---
    // Rough, rng-free damage estimate an enemy uses to weigh targets (mirrors
    // applyToTarget's formula minus the ±2 jitter) — lets the AI spot kills.
    function estimateEnemyDamage(actor, foe, skill) {
      if (!skill || skill.kind !== "attack") return 0;
      const def = effectiveDefense(foe) * (1 - (skill.pierce || 0));
      const base = Math.max(1, effectiveAttack(actor) + (skill.power || 0) - def);
      const mult = affinityMultiplier(foe, skill.damageType) * guardMultiplier(foe);
      return Math.max(1, Math.round(base * mult));
    }

    // How attractive is `foe` as a target for `actor` using `skill`? Higher =
    // better. Encodes real tactics: finish the wounded, secure kills, prioritise
    // squishies + the medic, exploit affinity weakness, avoid resistances.
    function enemyThreatScore(actor, foe, skill) {
      let s = 1;
      const hpFrac = foe.stats.hp / foe.stats.maxHp;
      s += (1 - hpFrac) * 1.5;                                   // focus the wounded
      if (estimateEnemyDamage(actor, foe, skill) >= foe.stats.hp) s += 3;  // can secure a KILL
      s += clamp((160 - foe.stats.maxHp) / 160, 0, 1) * 0.6;    // squishier = juicier
      s += clamp((14 - effectiveDefense(foe)) / 14, 0, 1) * 0.5; // lower DEF = softer
      if (foe.skills.some(function (k) { return SKILLS[k].kind === "heal"; })) s += 0.8; // kill the medic
      const mult = affinityMultiplier(foe, skill.damageType);
      if (mult > 1) s += 0.7; else if (mult < 1) s -= 0.4;      // exploit weak / dodge resist
      return Math.max(0.05, s);
    }

    // Weighted pick over threat scores. "Sharpness" scales with tier so fodder
    // stays loose (semi-random, not oppressive) while elites/bosses focus hard —
    // this is the difficulty dial the design doc asked for (§3.5).
    function pickEnemyTarget(actor, foes, skill) {
      const sharp = (actor.tier === "elite" || actor.tier === "boss") ? 3.5
                  : actor.tier === "standard" ? 2.2 : 1.2;
      const weights = foes.map(function (f) {
        return Math.pow(enemyThreatScore(actor, f, skill), sharp);
      });
      let sum = weights.reduce(function (a, b) { return a + b; }, 0);
      let r = Math.random() * sum;
      for (let i = 0; i < foes.length; i++) { r -= weights[i]; if (r <= 0) return foes[i]; }
      return foes[foes.length - 1];
    }

    // Decide what an enemy does this turn.
    //   1) If it can heal and (by chance) an ally is badly hurt, heal the worst.
    //      The CHANCE matters: a guaranteed heal makes a healer unkillable, so
    //      it only heals sometimes — a threat, not an infinite regen wall.
    //   2) Otherwise attack: sometimes a special, sometimes a basic shot,
    //      then pick the smartest target (Phase 1a).
    function chooseEnemyAction(enemy) {
      const skills = enemy.skills;

      // 1) Sometimes heal a badly wounded ally, if this enemy can.
      const healKey = skills.find(function (k) { return SKILLS[k].kind === "heal"; });
      if (healKey && Math.random() < AI_HEAL_CHANCE) {
        const wounded = living(alliesOf(enemy)).filter(function (a) {
          return a.stats.hp < a.stats.maxHp * AI_HEAL_THRESHOLD;
        });
        if (wounded.length > 0) {
          wounded.sort(function (a, b) {
            return (a.stats.hp / a.stats.maxHp) - (b.stats.hp / b.stats.maxHp);
          });
          return { key: healKey, targets: [wounded[0]] };
        }
      }

      // 1b) Sometimes use a STATUS skill (Phase 1b — makes the status engine
      //     two-sided). Self-buffs: Guard when hurt, Overclock when healthy and
      //     not already buffed. Pure debuffs: land a fresh one on a smart target.
      const statusSkills = skills.filter(function (k) { return SKILLS[k].kind === "status"; });
      if (statusSkills.length > 0) {
        const selfBuff = statusSkills.find(function (k) { return SKILLS[k].target === "self"; });
        if (selfBuff) {
          const spec = SKILLS[selfBuff].applies && SKILLS[selfBuff].applies[0];
          const btype = spec && spec.type;
          if (btype && !hasStatus(enemy, btype)) {
            const hpFrac = enemy.stats.hp / enemy.stats.maxHp;
            const wantGuard = btype === "guard" && hpFrac < 0.55 && Math.random() < 0.6;
            const wantOther = btype !== "guard" && hpFrac > 0.5 && Math.random() < 0.3;
            if (wantGuard || wantOther) return { key: selfBuff, targets: [enemy] };
          }
        }
        const debuff = statusSkills.find(function (k) {
          return SKILLS[k].target === "enemy" || SKILLS[k].target === "allEnemies";
        });
        if (debuff && Math.random() < AI_SPECIAL_CHANCE) {
          const dfoes = living(opponentsOf(enemy));
          if (dfoes.length > 0) {
            const dsk = SKILLS[debuff];
            if (dsk.target === "allEnemies") return { key: debuff, targets: dfoes };
            const dtype = dsk.applies && dsk.applies[0] && dsk.applies[0].type;
            const fresh = dfoes.filter(function (f) { return !(dtype && hasStatus(f, dtype)); });
            const pool = fresh.length > 0 ? fresh : dfoes;
            return { key: debuff, targets: [pickEnemyTarget(enemy, pool, dsk)] };
          }
        }
      }

      // 2) Attack. The enemy's FIRST attack skill is its basic (so a unit can
      //    have a non-Kinetic basic, e.g. the Arc Sentinel's Shock bolt); any
      //    further attack skills are "specials" used at AI_SPECIAL_CHANCE.
      const attackSkills = skills.filter(function (k) {
        return SKILLS[k].kind === "attack";
      });
      const basic = attackSkills[0] || "attack";
      const specials = attackSkills.slice(1);
      const foes = living(opponentsOf(enemy));
      if (foes.length === 0) return null;

      let key = basic;
      if (specials.length > 0 && Math.random() < AI_SPECIAL_CHANCE) {
        // Prefer an AoE special when it would actually hit 2+ heroes; otherwise
        // a random single-target special.
        const aoe = specials.filter(function (k) { return SKILLS[k].target === "allEnemies"; });
        const single = specials.filter(function (k) { return SKILLS[k].target !== "allEnemies"; });
        if (aoe.length > 0 && foes.length >= 2) {
          key = aoe[randomBetween(0, aoe.length - 1)];
        } else if (single.length > 0) {
          key = single[randomBetween(0, single.length - 1)];
        } else {
          key = specials[randomBetween(0, specials.length - 1)];
        }
      }

      const skill = SKILLS[key];
      if (skill.target === "allEnemies") return { key: key, targets: foes };
      return { key: key, targets: [pickEnemyTarget(enemy, foes, skill)] };
    }

    function enemyAct(enemy) {
      if (battleOver) return;
      const decision = chooseEnemyAction(enemy);
      if (decision) {
        const targets = applyConfusion(enemy, SKILLS[decision.key], decision.targets);
        resolveSkill(decision.key, enemy, targets);
        updateScreen();
      }
      setTimeout(endTurn, 600);
    }

    function endTurn() {
      if (battleOver) return;
      if (checkBattleEnd()) return;
      turnIndex++;
      nextTurn();
    }

    function checkBattleEnd() {
      if (living(enemies).length === 0) {
        log("All hostiles destroyed. Victory!", true);
        endBattle("win");
        return true;
      }
      if (living(party).length === 0) {
        log("The squad is down. Defeat...", true);
        endBattle("lose");
        return true;
      }
      return false;
    }

    function onRun() {
      clearActions();
      setBanner("");
      if (Math.random() < 0.5) {
        log(activeCombatant.name + " calls the retreat — the squad breaks contact!", true);
        endBattle("flee");
      } else {
        log(activeCombatant.name + " looks for an opening to flee — none!");
        setTimeout(endTurn, 500);
      }
    }


    /* ================================================================
       I) STARTUP & RESET
       ================================================================ */

    // Build the enemy list from a pre-resolved [{key, level}, ...] roll,
    // lettering duplicates A/B/C... Each entry carries its OWN level (Phase G
    // replaces the old single shared `level` — enemies in one squad can differ).
    function buildEnemies(rolled) {
      const totals = {};
      rolled.forEach(function (e) { totals[e.key] = (totals[e.key] || 0) + 1; });

      const seen = {};
      return rolled.map(function (e) {
        const t = ENEMIES[e.key];
        seen[e.key] = (seen[e.key] || 0) + 1;
        let name = t.typeName;
        if (totals[e.key] > 1) {
          name += " " + String.fromCharCode(64 + seen[e.key]);  // 65 = "A"
        }
        return createEnemy(e.key, name, e.level);
      });
    }

    // Boss reinforcement hook (Site Erebus, §5.3): pushes a fresh wave of
    // enemies into the LIVE `enemies` array mid-battle. They don't act this
    // round (initiative is only rebuilt at startRound(), i.e. next round) —
    // deliberate: gives the party one round's warning, not an ambush inside
    // an ambush. Lettering continues from whatever's already in play (a
    // second Erebus Roach group becomes C/D..., not another A/B).
    function spawnReinforcements(boss) {
      const counts = {};
      enemies.forEach(function (e) {
        if (e.typeKey) counts[e.typeKey] = (counts[e.typeKey] || 0) + 1;
      });
      boss.reinforceWave.forEach(function (entry) {
        for (let i = 0; i < entry.count; i++) {
          const e = createEnemy(entry.key, null, boss.level);
          counts[entry.key] = (counts[entry.key] || 0) + 1;
          e.name = ENEMIES[entry.key].typeName + " " + String.fromCharCode(64 + counts[entry.key]);
          e.subtitle = ENEMIES[entry.key].role + (e.level > 1 ? " · Lv " + e.level : "");
          enemies.push(e);
        }
      });
      log(boss.reinforceMessage || (boss.name + " calls in reinforcements!"), true);
      renderCombatants();
      updateScreen();
    }

    function pickRandom(list) { return list[randomBetween(0, list.length - 1)]; }

    // Prologue encounters (Phase H3, §5.2) — hand-scripted per node, NOT
    // drawn from ENEMY_POOLS/depthLevel like Sector 1. This is a short,
    // tightly-authored escape sequence, not a dungeon crawl that needs
    // randomized composition — same "unique fight, tuned directly" treatment
    // the boss roster already gets. p3 (the recruit beat) has no encounter;
    // it's resolved by resolveRecruitNode() instead.
    function rollPrologueEncounter(node) {
      if (node.id === "p1") return [{ key: "spiderDrone", level: 1 }];
      if (node.id === "p2") return [{ key: "quotaEnforcer", level: 1 }, { key: "quotaEnforcer", level: 1 }];
      if (node.id === "p4") return [{ key: "voraxx", level: 1 }, { key: "riotEnforcer", level: 1 }];
      return [];
    }

    // Site Erebus encounters (Dungeon 3, §5.3) — hand-scripted per node, same
    // treatment as the prologue: a short, tightly-authored detour doesn't
    // need ENEMY_POOLS/depthLevel's randomized composition. Levels are a
    // first-pass guess (the party arrives here already leveled from Sector 1)
    // — tune via sim like every other dungeon (§9). Rest/Loot nodes return [].
    function rollErebusEncounter(node) {
      if (node.id === "e1") return [
        { key: "erebusRoach", level: 3 }, { key: "erebusRoach", level: 3 }, { key: "erebusRoach", level: 3 }
      ];
      if (node.id === "e2") return [
        { key: "erebusWarrior", level: 3 }, { key: "erebusWarrior", level: 3 }, { key: "erebusRoach", level: 3 }
      ];
      if (node.id === "e3") return [{ key: "erebusWarrior", level: 4 }, { key: "erebusShaman", level: 4 }];
      if (node.id === "e4") return [{ key: "erebusArmoredWarrior", level: 4 }, { key: "erebusRoach", level: 4 }];
      if (node.id === "e7") return [
        { key: "erebusWarrior", level: 4 }, { key: "erebusWarrior", level: 4 }, { key: "erebusRoach", level: 4 }
      ];
      if (node.id === "boss") return [{ key: "broodmarshal", level: 5 }];
      return [];
    }

    // Per-node encounter roll (Phase G, §5.1): composition + level scale with
    // node.depth, mixing both factions' pools; Elite nodes guarantee an elite.
    // Numbers here are a first pass, same as every prior roster — tune via sim.
    // node.depth -> baseline enemy level. Sub-linear on purpose: a party only
    // reaches ~Lv2-3 within this dungeon's 5-6 fights (small XP pool, split 3
    // ways), so 1:1 depth==level badly outpaced them by the back half during
    // testing — this keeps the escalation real without racing past the party.
    function depthLevel(depth) { return Math.max(1, Math.ceil(depth * 0.7)); }

    // Generalized (2026-07-24, §5.4) so Dungeons 4-6 can reuse the same
    // pools+depthLevel machinery Sector 1 pioneered, instead of each needing
    // its own hand-rolled version:
    //  - boss composition now comes from `dungeon.bossEncounter` (content),
    //    not a hardcoded Warden-shaped return here.
    //  - the pool a node draws from is `dungeon.pools[node.poolBranch]` when
    //    both are present (a multi-branch dungeon with faction-differentiated
    //    pools, §5.4a); otherwise falls back to the original global
    //    ENEMY_POOLS (Sector 1's shape, unchanged — no regression).
    function rollEncounterForNode(node) {
      const dungeon = DUNGEONS[currentDungeonKey];
      if (node.type === "boss") {
        // A fixed level/composition rather than the depth formula — a unique
        // one-off fight, tuned directly against where a party sits by the end
        // of this dungeon, not derived from the same curve as pooled trash.
        // `node.bossEncounter` overrides the dungeon-wide default (§5.4b —
        // Dungeon 5's "double boss": two boss-type nodes, Void Soul Eater
        // then the Sun God, each needs its OWN composition, so a single
        // dungeon.bossEncounter can't cover both).
        return node.bossEncounter || dungeon.bossEncounter;
      }

      const pools = (dungeon.pools && node.poolBranch) ? dungeon.pools[node.poolBranch] : ENEMY_POOLS;

      // No upward jitter: elite-tier enemies already hit harder purely from
      // their own (higher) base stats, so stacking a level bump on top of
      // that made Elite nodes spike well past what a same-depth party could
      // handle during testing. Jitter only ever eases a fight, never spikes it.
      // Uses `levelDepth` (the pre-Phase-H4 depth) when present, so the
      // recruit1 render-depth shift doesn't also reshape the level curve —
      // see the comment on DUNGEONS.sector1 for why.
      function levelFor() {
        return Math.max(1, depthLevel(node.levelDepth || node.depth) + randomBetween(-1, 0));
      }

      const rolled = [];
      if (node.type === "elite") {
        rolled.push({ key: pickRandom(pools.elite), level: levelFor() });
        const tier = Math.random() < 0.5 ? "fodder" : "standard";
        rolled.push({ key: pickRandom(pools[tier]), level: levelFor() });
      } else {   // "combat", or an Unknown node's "fight" outcome (§5.4)
        const count = randomBetween(2, 3);
        for (let i = 0; i < count; i++) {
          const tier = (node.depth >= 3 && Math.random() < 0.5) ? "standard" : "fodder";
          rolled.push({ key: pickRandom(pools[tier]), level: levelFor() });
        }
      }
      return rolled;
    }

    // Look up the chosen heroes BY REFERENCE from the roster (Phase H2) — NOT
    // fresh createHero() copies. That's what makes level/xp/equipment/limit
    // persist across dungeons: a party member and its roster entry are the
    // literal same object, so combat mutates roster automatically.
    function buildParty(heroIds) {
      return heroIds
        .map(function (id) { return roster.find(function (h) { return h.id === id; }); })
        .filter(Boolean);
    }

    // Interim loot source (Phase D½) until the map's real loot nodes exist (Phase G):
    // a chance of a random unowned item dropping after each win.
    function rollLootDrop() {
      if (Math.random() >= LOOT_DROP_CHANCE) return;
      // Heavy odds (§5.4) if the just-fought enemies included an elite/boss —
      // tougher fights, better jackpot odds.
      const heavy = enemies.some(function (e) { return e.tier === "elite" || e.tier === "boss"; });
      const key = pickWeightedLootItem(heavy);
      if (!key) return;
      partyOwnedItems[key] = (partyOwnedItems[key] || 0) + 1;
      log("Loot found: " + ITEMS[key].name + "!", true);
    }

    // Award XP after a victory, then apply any level-ups.
    function awardXp() {
      const total = enemies.reduce(function (sum, e) { return sum + (e.xpReward || 0); }, 0);
      const share = Math.max(1, Math.round(total / party.length));
      log("Victory! Each operative earns " + share + " XP.", true);
      party.forEach(function (h) {
        h.xp += share;
        while (h.xp >= h.xpToNext) { h.xp -= h.xpToNext; levelUp(h); }
      });
    }

    function levelUp(h) {
      h.level += 1;
      h.xpToNext = xpForNext(h.level);
      h.sp += SP_PER_LEVEL;
      const g = CLASSES[h.classKey].growth;
      h.stats.maxHp += g.hp;   h.stats.hp += g.hp;
      h.stats.maxEn += g.en;   h.stats.en += g.en;
      h.stats.attack += g.attack;
      h.stats.defense += g.defense;
      h.stats.speed += g.speed;
      h.subtitle = h.className + " · Lv " + h.level;
      log(h.name + " reaches Lv " + h.level + "! (+" + g.hp + " HP, +" + g.attack +
          " ATK, +" + g.defense + " DEF) — +" + SP_PER_LEVEL + " Skill Point", true);
    }

    // --- Skill tree spending (Phase E) ---

    // Can this hero learn this tree node right now?
    function canLearnNode(hero, nodeKey) {
      const tree = SKILL_TREES[hero.classKey] || [];
      const node = tree.find(function (n) { return n.key === nodeKey; });
      if (!node) return false;
      if (hero.unlockedNodes.indexOf(nodeKey) >= 0) return false;             // already learned
      if (node.prereq && hero.unlockedNodes.indexOf(node.prereq) < 0) return false;  // prereq missing
      if (hero.sp < node.cost) return false;                                  // can't afford
      return true;
    }

    // Spend SP to learn a tree node; the unlocked skill joins the hero's kit immediately.
    function learnNode(hero, nodeKey) {
      if (!canLearnNode(hero, nodeKey)) return false;
      const node = SKILL_TREES[hero.classKey].find(function (n) { return n.key === nodeKey; });
      hero.sp -= node.cost;
      hero.unlockedNodes.push(nodeKey);
      hero.skills.push(node.skillKey);
      log(hero.name + " learns " + node.name + "!", true);
      return true;
    }

    // --- Equipment (Phase E character-development layer) ---

    // Apply (sign +1) or remove (sign -1) an item's flat stat bonus. Current
    // HP/EN move with their max so equipping/unequipping feels consistent
    // with how level-up growth already works.
    function applyStatBonus(hero, bonus, sign) {
      if (!bonus) return;
      if (bonus.hp)      { hero.stats.maxHp += sign * bonus.hp; hero.stats.hp = clamp(hero.stats.hp + sign * bonus.hp, 0, hero.stats.maxHp); }
      if (bonus.en)      { hero.stats.maxEn += sign * bonus.en; hero.stats.en = clamp(hero.stats.en + sign * bonus.en, 0, hero.stats.maxEn); }
      if (bonus.attack)  hero.stats.attack  += sign * bonus.attack;
      if (bonus.defense) hero.stats.defense += sign * bonus.defense;
      if (bonus.speed)   hero.stats.speed   += sign * bonus.speed;
    }

    function addItemEffects(hero, item) {
      applyStatBonus(hero, item.statBonus, 1);
      if (item.grantsSkill && hero.skills.indexOf(item.grantsSkill) < 0) {
        hero.skills.push(item.grantsSkill);
      }
    }

    function removeItemEffects(hero, item) {
      applyStatBonus(hero, item.statBonus, -1);
      if (item.grantsSkill) {
        const idx = hero.skills.indexOf(item.grantsSkill);
        if (idx >= 0) hero.skills.splice(idx, 1);
      }
    }

    // Is any hero currently wearing this item? Returns { hero, slot } or null.
    // Equipment is a party-owned, SHARED pool — a given found item can only be
    // worn by one hero at a time (equipping it elsewhere transfers it away).
    // Scans the whole ROSTER (Phase H4 — was `party` only), since Town lets
    // the player equip any recruited hero, not just whoever's actively
    // deployed; a benched hero's gear must still show as worn, not free.
    function findWornBy(itemKey) {
      for (let i = 0; i < roster.length; i++) {
        for (let s = 0; s < EQUIPMENT_SLOTS.length; s++) {
          const slot = EQUIPMENT_SLOTS[s];
          if (roster[i].equipment[slot] === itemKey) return { hero: roster[i], slot: slot };
        }
      }
      return null;
    }

    // Equip an item into its slot, swapping out whatever was there. Enforces
    // ownership (must be found first, see partyOwnedItems) and class
    // restriction (Arms/Ring items belong to one class). Returns { ok, reason? }.
    function equipItem(hero, itemKey) {
      const item = ITEMS[itemKey];
      if (!item) return { ok: false, reason: "Unknown item." };
      if (!partyOwnedItems[itemKey]) return { ok: false, reason: "The party doesn't own " + item.name + " yet." };
      if (item.classRestrict && item.classRestrict !== hero.classKey) {
        return { ok: false, reason: item.name + " can't be equipped by a " + hero.className + "." };
      }
      const slot = item.slot;
      if (hero.equipment[slot] === itemKey) return { ok: false, reason: "Already equipped." };

      const wornBy = findWornBy(itemKey);
      if (wornBy) {
        removeItemEffects(wornBy.hero, ITEMS[itemKey]);
        wornBy.hero.equipment[wornBy.slot] = null;
        log(wornBy.hero.name + "'s " + item.name + " is reassigned to " + hero.name + ".");
      }

      if (hero.equipment[slot]) removeItemEffects(hero, ITEMS[hero.equipment[slot]]);
      hero.equipment[slot] = itemKey;
      addItemEffects(hero, item);
      log(hero.name + " equips " + item.name + ".", true);
      return { ok: true };
    }

    // Unequip whatever is in a slot. Returns { ok, reason? }.
    function unequipItem(hero, slot) {
      const itemKey = hero.equipment[slot];
      if (!itemKey) return { ok: false, reason: "Nothing equipped." };
      removeItemEffects(hero, ITEMS[itemKey]);
      hero.equipment[slot] = null;
      log(hero.name + " unequips " + ITEMS[itemKey].name + ".");
      return { ok: true };
    }

    let lastOutcome = null;   // so the Character panel's "Done" can rebuild the right endbar

    function endBattle(outcome) {
      battleOver = true;
      activeCombatant = null;
      clearTargeting();
      clearActions();
      stopSpriteAnimation();
      lastOutcome = outcome;

      if (outcome === "win") { awardXp(); rollLootDrop(); }   // once per battle — NOT re-run when reopening the endbar
      updateScreen();
      setBanner("");

      renderEndbar(outcome);
    }

    // Build the post-battle button row. Split out from endBattle() so the
    // Skills panel can return to it without re-awarding XP.
    function renderEndbar(outcome) {
      removeEndbar();
      const bar = document.createElement("div");
      bar.id = "endbar";

      if (outcome === "win") {
        // Phase H3: a boss node is identified by its TYPE now (data-driven),
        // not a hardcoded "boss" id — the prologue's boss node is "p4".
        // isBossClear ALSO requires an empty connectsTo (§5.4b, Dungeon 5's
        // "double boss"): a boss-type node that connects onward to ANOTHER
        // boss node (Void Soul Eater -> the Sun God) is not the dungeon's
        // true final clear yet — it falls through to the normal
        // resolveNodeVictory() path below like any other node, just one that
        // happens to fight a boss-tier encounter. Every OTHER boss node in
        // the game already has connectsTo: [], so this is unchanged for them.
        const clearedDungeon = DUNGEONS[currentDungeonKey];
        const clearedNode = clearedDungeon.nodes[currentNodeId];
        const isBossClear = clearedNode.type === "boss" && clearedNode.connectsTo.length === 0;
        const nextDungeonKey = clearedDungeon.nextDungeonKey;

        if (isBossClear) {
          let clearLine;
          if (currentDungeonKey === "prologue") clearLine = "Overseer Voraxx falls. The hangar is clear!";
          else if (currentDungeonKey === "sector1") clearLine = "The Warden collapses. Sector 1 is clear!";
          else if (currentDungeonKey === "erebus") clearLine = "The Broodmarshal collapses. The hive scatters!";
          else if (currentDungeonKey === "dungeon4") clearLine = "Proteus finally stops moving. Whatever it was becoming, it's over.";
          else if (currentDungeonKey === "dungeon5") clearLine = "The Sun God goes still. Helios finally goes dark.";
          else if (currentDungeonKey === "dungeon6") clearLine = "Phthora finally stops moving. The lineage's founding transcendence dies with him.";
          else if (currentDungeonKey === "dungeon6b") clearLine = "Chthon goes still. Whatever it was wearing, it isn't anymore.";
          else clearLine = "Victory!";
          log(clearLine, true);
        } else if (clearedNode.type === "boss") {
          // The non-terminal half of a double boss (Dungeon 5's Void Soul
          // Eater, Dungeon 6b's caged god) — dungeon-specific flavor line,
          // generalized 2026-07-25 (was hardcoded to Void Soul Eater only).
          let midLine;
          if (currentDungeonKey === "dungeon6b") midLine = "The caged god tears free of the ritual holding it. Kredex is already screaming.";
          else midLine = "The Void Soul Eater unravels. Something colder is still waiting at the center of the station.";
          log(midLine, true);
        }

        // Non-boss win: back to the Map, next nodes unlocked. Boss win: each
        // dungeon gets its own showXEpilogue() handoff (extension recipe,
        // §10) dispatched by the SOURCE dungeon (currentDungeonKey), not just
        // by whether nextDungeonKey is set — Erebus's epilogue plays even
        // though nothing is built past it yet (§5.3: the escape-and-return-
        // to-Town beat still needs telling).
        const next = document.createElement("button");
        if (isBossClear) {
          if (currentDungeonKey === "prologue") next.textContent = "Escape to the ship →";
          else if (currentDungeonKey === "sector1") next.textContent = "Break for open space →";
          else if (currentDungeonKey === "erebus") next.textContent = "Get off this rock →";
          else if (currentDungeonKey === "dungeon4") next.textContent = "Get out before more come →";
          else if (currentDungeonKey === "dungeon5") next.textContent = "Turn back toward the dark →";
          else if (currentDungeonKey === "dungeon6") next.textContent = "Go deeper →";
          else if (currentDungeonKey === "dungeon6b") next.textContent = "Face what's left →";
          else next.textContent = "Dungeon Clear! ✓";
        } else {
          next.textContent = "Continue →";
        }
        next.onclick = function () {
          removeEndbar();
          if (isBossClear) {
            if (currentDungeonKey === "prologue") showPrologueEpilogue(nextDungeonKey);
            else if (currentDungeonKey === "sector1") showSector1Epilogue(nextDungeonKey);
            else if (currentDungeonKey === "erebus") showErebusEpilogue(nextDungeonKey);
            else if (currentDungeonKey === "dungeon4") showDungeon4Epilogue(nextDungeonKey);
            else if (currentDungeonKey === "dungeon5") showDungeon5Epilogue(nextDungeonKey);
            else if (currentDungeonKey === "dungeon6") showDungeon6Epilogue(nextDungeonKey);
            else if (currentDungeonKey === "dungeon6b") showDungeon6bEpilogue(nextDungeonKey);
            else returnToHub();
          } else {
            resolveNodeVictory();
          }
        };
        bar.appendChild(next);

        const charBtn = document.createElement("button");
        charBtn.className = "cancel";
        charBtn.textContent = "Character";
        // Explicit heroList/returnTo — always resets to THIS context, so a
        // previously Town-opened panel's state (roster/"town") never leaks
        // into a battle-opened one, or vice versa.
        charBtn.onclick = function () { showCharacterPanel(undefined, party, "battle"); };
        bar.appendChild(charBtn);

        if (!isBossClear) {
          const retire = document.createElement("button");
          retire.className = "cancel";
          retire.textContent = "Retire (new squad)";
          retire.onclick = function () { removeEndbar(); returnToHub(); };
          bar.appendChild(retire);
        }
      } else {
        // Defeat or flee — the run ends.
        const again = document.createElement("button");
        again.textContent = "New squad";
        again.onclick = function () { removeEndbar(); returnToHub(); };
        bar.appendChild(again);
      }

      document.getElementById("battle").appendChild(bar);
    }

    function removeEndbar() {
      const b = document.getElementById("endbar");
      if (b) b.remove();
    }

    // Prologue → next-dungeon transition (Phase H3, §5.2). Hand-authored like
    // the intro/recruit beats — there's only this one dungeon-to-dungeon
    // transition today, so a generic per-dungeon "epilogue text" data table
    // would be speculative infrastructure for a single use case. Sets
    // currentDungeonKey to the next dungeon, then lands on the squad-builder
    // (now meaningfully a 2-person roster) to prep for it.
    function showPrologueEpilogue(nextDungeonKey) {
      showStoryScene([
        "The hangar door grinds open on a battered long-haul shuttle that has no business " +
          "still flying, and somehow it flies anyway.",
        "Behind you, Kharon's Reach is waking up: floodlights, sirens, someone on the comm " +
          "still shouting Voraxx's name like he's going to answer.",
        "He's not going to. Two debts are paid, but there's still a long way to go, and the " +
          "ship is only the first part of getting there."
      ], "Break atmosphere.", function () {
        currentDungeonKey = nextDungeonKey;
        lastTownMessage = grantShipStartingItems();
        showTown();
      });
    }

    // Sector 1 → Site Erebus transition (Dungeon 3, §5.3). Unlike the
    // prologue's handoff, this does NOT route through Town — the ship never
    // lands safely, it gets shot down mid-flight, so there's no "prep squad"
    // beat between dungeons. Deploys the SAME live `party` that just cleared
    // the Warden straight into Erebus (mirrors showIntroScene's direct
    // startDungeon call, not the Town-then-showSelect flow).
    function showSector1Epilogue(nextDungeonKey) {
      showStoryScene([
        "The Warden's wreckage is still sparking behind you when the shuttle clears Sector 1's " +
          "outer ring, alarms finally quiet for the first time in what feels like days.",
        "Nobody up top even knows you're out here. That's the whole point of running dark, " +
          "which is why it doesn't make sense when the proximity alarm screams half a system " +
          "later and the empty black ahead lights up with turret fire that was never meant to " +
          "see a living target.",
        "It isn't Vossmark retaliating. It's older than that: a blockade nobody's manned in " +
          "years, still doing the one job it was ever given. The shuttle takes three hits before " +
          "anyone gets a hand back on the stick, and by then it doesn't matter whose fault it is.",
        "The ship goes down hard, atmosphere howling through a hull breach, tree cover rushing " +
          "up too fast to read as anything but a crash."
      ], "Brace for impact.", function () {
        currentDungeonKey = nextDungeonKey;
        startDungeon(party.map(function (h) { return h.id; }), nextDungeonKey);
      });
    }

    // Site Erebus → Town handoff (Dungeon 3 boss clear, §5.3). Routes through
    // Town (not a direct dungeon-to-dungeon handoff like Sector 1 → Erebus)
    // — the crew patches the Long Shot with salvaged annex parts and regroups
    // rather than getting shot down mid-flight, so Town's existing "the Long
    // Shot" identity (§5.2c) doesn't need to change.
    // BUG FIX (2026-07-24): this used to take no argument and always call
    // showTown() WITHOUT updating currentDungeonKey — harmless while
    // erebus.nextDungeonKey was null (nothing built past Erebus yet), but
    // once Dungeon 4 shipped and nextDungeonKey became "dungeon4",
    // currentDungeonKey stayed stuck on "erebus" forever, so deploy()
    // (which redeploys into whatever currentDungeonKey currently is) sent
    // the player right back into Erebus instead of Dungeon 4. Now matches
    // showPrologueEpilogue's pattern: accept nextDungeonKey, set it before
    // showTown().
    function showErebusEpilogue(nextDungeonKey) {
      showStoryScene([
        "The Broodmarshal doesn't get up again. For a long moment neither does anyone else. " +
          "The cavern is quiet in a way this planet hasn't been since the crash.",
        "What's left of the control rig comes away from the shell easier than it should, wiring " +
          "still warm, half of it stamped with a Vossmark asset tag someone tried hard to scrub " +
          "off. Whatever this thing was supposed to become, it never finished becoming it.",
        "The Long Shot isn't flying on its own parts anymore by the time the annex is stripped " +
          "for anything that still works, but it's flying. Kharon's Reach feels like a long time " +
          "ago. Vossmark feels smaller than it did yesterday, and somehow that's worse."
      ], "Get off this rock.", function () {
        currentDungeonKey = nextDungeonKey;
        showTown();
      });
    }

    // Talos bio-foundry -> Helios Station transition (Dungeon 4 boss clear,
    // §5.4a/§5.4b). Routes through Town, same shape as showErebusEpilogue:
    // the crew patches up rather than crash-landing again. Proteus's fall
    // yields the 2nd key fragment, which combines with Erebus's to point
    // at Sol's star, not the outer system — the "assembled key" beat §9.4
    // already promised. This was a `returnToHub()` fallthrough with no
    // currentDungeonKey update until this session (the exact landmine
    // pattern flagged after the Erebus bug, §5.2's gameplay-direction
    // memory) — now fixed the same way, before it could ever bite.
    function showDungeon4Epilogue(nextDungeonKey) {
      showStoryScene([
        "Proteus doesn't scream on the way down. Whatever was still human in there goes quiet " +
          "first, and the rest just stops a moment later, mid-transformation, like a sentence " +
          "that never finds its verb.",
        "Six doesn't look away from it. \"That was supposed to be a mercy,\" she says, prying a " +
          "data core loose from the ruin of the executive suite. \"Nobody gave it one.\"",
        "The core's fragment locks against the one pulled from the Broodmarshal's rig months ago, " +
          "two broken halves of the same key finally admitting they were always one piece. What " +
          "they point at isn't a place in the outer dark where a corp could hide a black site. " +
          "It's the system's own star, and something built into it that was never supposed to be found."
      ], "Chart a course for the sun.", function () {
        if (nextDungeonKey) currentDungeonKey = nextDungeonKey;
        showTown();
      });
    }

    // Helios Station -> Town/finale transition (Dungeon 5 double-boss clear,
    // §5.4b). `nextDungeonKey` stays null until Dungeon 6 is built — the
    // `if (nextDungeonKey)` guard is deliberate, not a placeholder omission:
    // blindly assigning `currentDungeonKey = nextDungeonKey` here would set
    // it to null and break deploy() (`startDungeon(lastSquad,
    // currentDungeonKey)` -> `DUNGEONS[null]`), reproducing the exact class
    // of bug the Erebus epilogue fix (§5.2) already documented, just
    // pre-emptively instead of by omission. Staying on "dungeon5" lets
    // Town's "Prep Squad" replay Helios in the interim, same interim shape
    // Dungeon 4 sat in before this session.
    function showDungeon5Epilogue(nextDungeonKey) {
      showStoryScene([
        "The Sun God's light doesn't fade so much as it stops arguing with the dark. For the " +
          "first time since the breach, Helios Station is just wreckage: dead metal, dead " +
          "circuitry, a regulator core that spent longer being worshipped than understood.",
        "What's left of it isn't divine and was never really a god. It's a caretaker's machine, " +
          "the last honest piece of something built to keep a dying system fed, corrupted by " +
          "whatever got loose down here long before anyone came looking.",
        "The coordinates it was guarding aren't out here at all. They're keyed to a world both " +
          "Vossmark and Talos wrote off generations ago, the one place scarred badly enough that " +
          "nobody thought to fight over it. Home, if the word still means anything by now."
      ], "Set course for Earth.", function () {
        if (nextDungeonKey) currentDungeonKey = nextDungeonKey;
        showTown();
      });
    }

    // Dungeon 6 -> 6b handoff (§5.4c, split 2026-07-25 after a real playtest
    // found the original single-dungeon6 map badly broken — see the data.js
    // comment above the dungeon6 object for the full root-cause). Phthora's
    // defeat is dungeon6's own terminal boss clear; this is the "go deeper"
    // beat carrying the crew from the sprawling surface-to-crust crawl into
    // the Core's short, tight, climactic sequence (dungeon6b).
    function showDungeon6Epilogue(nextDungeonKey) {
      showStoryScene([
        "Phthora doesn't finish becoming anything. Whatever the ritual was reaching for collapses " +
          "back into meat and failure, and the cavern goes quiet in the specific way only something " +
          "that was trying very hard to stop being human can go quiet.",
        "Past the wreckage of his rig, the rock stops pretending to be rock. A passage drops away " +
          "into something too smooth, too deliberate, lit by a light that doesn't have a source — " +
          "the kind of architecture that was never built by hands that needed to explain themselves " +
          "to anyone.",
        "This is the last door. Whatever's actually running this world's dead engine is down there, " +
          "and Kredex already has a head start."
      ], "Go deeper.", function () {
        if (nextDungeonKey) currentDungeonKey = nextDungeonKey;
        startDungeon(lastSquad, nextDungeonKey);
      });
    }

    // Dungeon 6b finale (§5.4c) — the game's first real branching ending.
    // Chthon's defeat is the literal, on-screen CAUSE of the Helios seal
    // finally breaking (locked design decision, not a coincidental parallel
    // event) — that consequence plays FIRST, before the player ever sees the
    // ending choice, so the choice itself is made already knowing what its
    // own victory cost. The precursor Psionic lattice (§9.3 — already canon)
    // is the in-fiction reason the crew can feel/perceive something happening
    // at the Sun instantly from dead Earth.
    function showDungeon6bEpilogue(nextDungeonKey) {
      showStoryScene([
        "Kredex doesn't finish dying so much as stop being separate from what killed him. Whatever " +
          "answered to Chthon a moment ago goes still, and the quiet that's left behind doesn't feel " +
          "like an ending. It feels like something letting go of a held breath.",
        "That's when the lattice screams. Not a sound — every psion in the squad feels it at once, a " +
          "signal running through the same precursor thread the Erebus fragment was always a piece " +
          "of, out past the dead ground overhead, out past Sol's dark, all the way to a wound the " +
          "crew tore open themselves at Helios months ago. It stops pretending to be sealed. " +
          "Whatever was holding it shut just died down here, wearing a corporate title.",
        "The Loom is still standing at the center of the chamber, patient in the specific way only " +
          "something built to outlast its makers can be. Nobody planted a flag on it. Nobody's told " +
          "it what happens next. That part's still yours to decide."
      ], "Decide what happens to the Loom.", function () {
        showEndingChoice();
      });
    }

    // Three-way branching capstone (§9.5, locked 2026-07-23, finalized
    // 2026-07-25). Reuses the story-scene container the way
    // showSquadSwapPrompt() does for a multi-button beat, rather than
    // showStoryScene's single-continue shape. All three endings ship — see
    // §5.4c for why "curate to two" was considered and rejected.
    function showEndingChoice() {
      goToScene("story-scene");
      const el = document.getElementById("story-scene");
      el.innerHTML = "";

      const box = document.createElement("div");
      box.id = "story-box";

      const p = document.createElement("p");
      p.className = "story-p";
      p.textContent = "Vossmark threw this world away. Talos was born from it and forgot. The " +
        "precursors built it and lost control of it twice over. Whatever you do here is the first " +
        "thing that's happened to the Loom that wasn't someone trying to own it.";
      box.appendChild(p);

      const options = [
        { key: "reseed", label: "Reseed — bring the homeworld back." },
        { key: "destroy", label: "Destroy — make sure no one ever owns this." },
        { key: "deny", label: "Deny — leave it buried, and walk away." }
      ];
      options.forEach(function (opt) {
        const btn = document.createElement("button");
        btn.textContent = opt.label;
        btn.onclick = function () { showEndingEpilogue(opt.key); };
        box.appendChild(btn);
      });

      el.appendChild(box);
    }

    // The three divergent endings (§9.5/§5.4c). Each acknowledges the
    // freshly-cracked Breach in its own way — the choice was never made in
    // a vacuum, it was made already knowing what defeating Chthon cost.
    function showEndingEpilogue(choice) {
      const ENDING_TEXT = {
        reseed: [
          "The engine doesn't wake up so much as remember how. Something moves through the dead " +
            "rock overhead that hasn't moved in this world's favor in longer than anyone alive can " +
            "measure — not fast, not dramatic, just patient the way growing things are patient.",
          "It'll be generations before anyone calls this world green again, and the squad already " +
            "knows they won't live to see it finished. That was never really the point. The corps " +
            "threw this place away because it stopped being profitable to want. Wanting it back for " +
            "free is the whole answer.",
          "Out past Sol's dark, the Breach doesn't care what you chose. It's open regardless, and " +
            "something is going to come through it eventually. But that's a fight for whoever's still " +
            "standing when it happens — not a reason to let this one go unfinished."
        ],
        destroy: [
          "The Loom doesn't scream when it dies. It just stops being a question anyone can ask " +
            "again — no seed, no scour, no second Chancellor with a better rig and a worse reason. " +
            "The chamber goes dark in a way that feels less like an ending and more like a door " +
            "finally shutting all the way.",
          "Earth stays dead. That was always going to be true either way, whether the squad wrecked " +
            "the engine or let someone else eventually find it and try again. At least this time " +
            "it's not for sale, not to Vossmark, not to whatever's left of Talos, not to the next " +
            "flag-planter who thinks they'll be the one who finally controls it right.",
          "Out past Sol's dark, the Breach doesn't care what you chose. It's already open, a wound " +
            "with no engine left on this end to ever close it again. That's someone else's problem " +
            "now — the squad just made sure it isn't also someone's weapon."
        ],
        deny: [
          "Nobody throws a switch. Nobody plants a flag, and nobody detonates anything either. The " +
            "squad just walks back out the way they came, and leaves the Loom exactly as they found " +
            "it — patient, buried, undecided, the one thing in this whole system nobody gets to own " +
            "because nobody took it.",
          "It's the smallest possible ending, and it might be the only honest one. Every hand that's " +
            "ever reached for this thing — the precursors, both corps, Phthora's whole lineage, " +
            "Kredex right up until it wasn't his hand anymore — reached for it wanting something. " +
            "The squad is the first to walk away wanting nothing at all.",
          "Out past Sol's dark, the Breach doesn't care what you chose. It's open either way, waiting " +
            "on something the squad never met and can't un-open. But whatever comes through it, it " +
            "won't be able to say Earth's own engine handed it the way in."
        ]
      };
      showStoryScene(ENDING_TEXT[choice], "This is where it ends.", function () {
        showTown();
      });
    }

    // Limited, hand-picked salvage found aboard the Long Shot (Phase H4) —
    // not a loot roll, a fixed one-time grant so the party isn't starting
    // Town with a completely empty equipment pool.
    function grantShipStartingItems() {
      const names = SHIP_STARTING_ITEMS.map(function (key) {
        partyOwnedItems[key] = (partyOwnedItems[key] || 0) + 1;
        return ITEMS[key].name;
      });
      return "Salvaged from the ship's lockers: " + names.join(", ") + ".";
    }

    let selectedCharHero = null;   // which hero's tab is active in the Character panel
    // Which hero list the panel's tabs iterate, and where "Done" returns to.
    // Set explicitly on the FIRST call (from the win endbar or from Town);
    // internal re-render calls (`showCharacterPanel(h.id)` from Learn/Equip/
    // Unequip handlers) omit these and reuse whatever was already set.
    let charPanelHeroList = null;
    let charPanelReturnTo = "battle";   // "battle" | "town"

    // Minimal debug/testing Character Sheet: per-hero tabs, then Stats / Skills
    // / Equipment sections. Text/button-driven — the graphical paperdoll (using
    // each item's `spriteKey`) arrives with the Phase I graphics pass.
    // Phase H4: generalized beyond the post-battle endbar — Town opens it
    // with `heroList = roster` (review/equip ANY recruited hero, not just
    // whoever's in the active party) and `returnTo = "town"`.
    function showCharacterPanel(heroId, heroList, returnTo) {
      removeEndbar();
      removeCharacterPanel();
      if (heroList) charPanelHeroList = heroList;
      if (!charPanelHeroList) charPanelHeroList = party;   // first-ever call safety net
      if (returnTo) charPanelReturnTo = returnTo;

      const list = charPanelHeroList;
      if (heroId === undefined || !list.some(function (m) { return m.id === heroId; })) {
        heroId = list[0].id;
      }
      selectedCharHero = heroId;

      const h = list.find(function (m) { return m.id === selectedCharHero; });
      const wrap = document.createElement("div");
      wrap.id = "character-panel";

      // Hero tabs.
      const tabs = document.createElement("div");
      tabs.className = "char-tabs";
      list.forEach(function (member) {
        const tab = document.createElement("button");
        tab.className = "char-tab" + (member.id === h.id ? " active" : "");
        tab.textContent = member.name;
        tab.onclick = function () { showCharacterPanel(member.id); };
        tabs.appendChild(tab);
      });
      wrap.appendChild(tabs);

      const body = document.createElement("div");
      body.className = "char-body";
      body.innerHTML = statsSectionHtml(h) + skillsSectionHtml(h) + equipmentSectionHtml(h);
      wrap.appendChild(body);

      // Wire up every interactive control inside the freshly-built body.
      body.querySelectorAll(".learn-btn:not(:disabled)").forEach(function (btn) {
        btn.onclick = function () { learnNode(h, btn.dataset.node); showCharacterPanel(h.id); };
      });
      body.querySelectorAll(".equip-btn").forEach(function (btn) {
        btn.onclick = function () {
          const r = equipItem(h, btn.dataset.item);
          if (!r.ok) log(r.reason);
          showCharacterPanel(h.id);
        };
      });
      body.querySelectorAll(".unequip-btn").forEach(function (btn) {
        btn.onclick = function () { unequipItem(h, btn.dataset.slot); showCharacterPanel(h.id); };
      });

      const doneBtn = document.createElement("button");
      doneBtn.textContent = "Done";
      doneBtn.onclick = function () {
        removeCharacterPanel();
        if (charPanelReturnTo === "town") { showTown(); } else { renderEndbar(lastOutcome); }
      };
      wrap.appendChild(doneBtn);

      const hostId = charPanelReturnTo === "town" ? "town-scene" : "battle";
      document.getElementById(hostId).appendChild(wrap);
    }

    // "+4 DEF, +10 HP" style text from a statBonus object — shared by the
    // Equipment section and Party Inventory (Phase H5) so item choices are
    // informed at a glance instead of requiring the player to remember or
    // look up what an item does elsewhere.
    function statBonusText(bonus) {
      if (!bonus) return "";
      const parts = [];
      if (bonus.hp) parts.push("+" + bonus.hp + " HP");
      if (bonus.en) parts.push("+" + bonus.en + " EN");
      if (bonus.attack) parts.push("+" + bonus.attack + " ATK");
      if (bonus.defense) parts.push("+" + bonus.defense + " DEF");
      if (bonus.speed) parts.push("+" + bonus.speed + " SPD");
      return parts.join(", ");
    }

    // A short label for what an item DOES, for display next to its name —
    // its stat bonus if it has one, or what skill it grants (Arms items).
    function itemEffectText(item) {
      const bonus = statBonusText(item.statBonus);
      if (bonus) return bonus;
      if (item.grantsSkill) return "grants " + SKILLS[item.grantsSkill].name;
      return "";
    }

    // Phase H5: a real overview, not just the core combat numbers — class/
    // race/nature/level, then stats, then the Limit gauge (checkable outside
    // combat now) and any non-neutral affinities (the "why" behind a weak/
    // resist call in the log).
    function statsSectionHtml(h) {
      const t = CLASSES[h.classKey];
      const affinityKeys = Object.keys(h.affinities || {}).filter(function (k) { return h.affinities[k] !== 1; });
      const affinityText = affinityKeys.map(function (k) {
        return capitalize(k) + " ×" + h.affinities[k];
      }).join(", ");

      return "<div class='char-section'><h4>Stats</h4>" +
        "<div class='char-stats'>" + t.className + " · " + t.race +
          " (" + h.nature + ") · Lv " + h.level + "</div>" +
        "<div class='char-stats'>HP " + h.stats.hp + "/" + h.stats.maxHp +
        " · EN " + h.stats.en + "/" + h.stats.maxEn +
        " · ATK " + h.stats.attack + " · DEF " + h.stats.defense +
        " · SPD " + h.stats.speed + "</div>" +
        "<div class='char-stats'>Limit: " + Math.floor(h.limit) + "%" +
          (affinityText ? " · Affinities: " + affinityText : "") + "</div>" +
        "</div>";
    }

    function skillsSectionHtml(h) {
      const tree = SKILL_TREES[h.classKey] || [];
      let html = "<div class='char-section'><h4>Skills · SP: " + h.sp + "</h4>";
      if (tree.length === 0) html += "<p class='char-empty'>No skills available yet.</p>";
      tree.forEach(function (node) {
        const learned = h.unlockedNodes.indexOf(node.key) >= 0;
        const can = !learned && canLearnNode(h, node.key);
        const prereqNode = node.prereq && tree.find(function (n) { return n.key === node.prereq; });
        html +=
          "<div class='skill-node'>" +
            "<span>" + node.name + " <em>(" + node.cost + " SP" +
              (prereqNode ? ", needs " + prereqNode.name : "") + ")</em></span>" +
            "<button class='learn-btn' data-node='" + node.key + "'" +
              (learned || !can ? " disabled" : "") + ">" +
              (learned ? "Learned" : "Learn") +
            "</button>" +
          "</div>";
      });
      return html + "</div>";
    }

    function equipmentSectionHtml(h) {
      let html = "<div class='char-section'><h4>Equipment</h4>";
      EQUIPMENT_SLOTS.forEach(function (slot) {
        const equippedKey = h.equipment[slot];
        const equippedItem = equippedKey ? ITEMS[equippedKey] : null;
        const equippedEffect = equippedItem ? itemEffectText(equippedItem) : "";

        html += "<div class='equip-row'>" +
          "<span class='equip-slot-label'>" + capitalize(slot) + "</span>" +
          "<span class='equip-current'>" + (equippedItem ? equippedItem.name : "Empty") +
            (equippedEffect ? " <em>(" + equippedEffect + ")</em>" : "") + "</span>";

        if (equippedItem) {
          html += "<button class='unequip-btn' data-slot='" + slot + "'>Unequip</button>";
        }

        // Only OWNED + eligible items show up as options — nothing is available
        // until the party has actually found it (see partyOwnedItems).
        let any = false;
        Object.keys(ITEMS).forEach(function (key) {
          const it = ITEMS[key];
          if (it.slot !== slot || key === equippedKey) return;
          if (it.classRestrict && it.classRestrict !== h.classKey) return;
          if (!partyOwnedItems[key]) return;
          any = true;
          const effect = itemEffectText(it);
          html += "<button class='equip-btn' data-item='" + key + "'>Equip " + it.name +
            (effect ? " (" + effect + ")" : "") + "</button>";
        });
        if (!any && !equippedItem) html += "<span class='equip-none'>Nothing found yet</span>";

        html += "</div>";
      });
      return html + "</div>";
    }

    function removeCharacterPanel() {
      const p = document.getElementById("character-panel");
      if (p) p.remove();
    }

    // Party-wide inventory review (Phase H4) — the "shared party inventory
    // screen" the design doc (§7.1) flagged as still-open. Read-only: it
    // shows everything the party owns and who (if anyone) is wearing each
    // piece of equipment; actually equipping/unequipping still happens on
    // the per-hero Character Sheet (Roster & Equipment), which already does
    // that job well — this just answers "what do we have," at a glance,
    // across the whole roster rather than one hero's slots at a time.
    function showInventoryPanel() {
      removeInventoryPanel();
      const wrap = document.createElement("div");
      wrap.id = "inventory-panel";

      let html = "<div class='inv-section'><h4>Consumables</h4>";
      const itemKeys = Object.keys(partyItems).filter(function (k) { return partyItems[k] > 0; });
      if (itemKeys.length === 0) {
        html += "<p class='char-empty'>Nothing in the bag.</p>";
      } else {
        itemKeys.forEach(function (k) {
          html += "<div class='inv-row'><span>" + SKILLS[k].name + "</span><span>×" +
            partyItems[k] + "</span></div>";
        });
      }
      html += "</div>";

      // Equipment (Phase H5: actionable, not just a list). An unequipped
      // item gets one small button per eligible roster hero — equipping
      // right from here instead of forcing a trip to that hero's own
      // Character Sheet to find the right slot. A worn item's "worn by X"
      // becomes a jump straight to that hero's sheet instead.
      html += "<div class='inv-section'><h4>Equipment</h4>";
      const ownedKeys = Object.keys(partyOwnedItems).filter(function (k) { return partyOwnedItems[k] > 0; });
      if (ownedKeys.length === 0) {
        html += "<p class='char-empty'>Nothing found yet.</p>";
      } else {
        ownedKeys.forEach(function (k) {
          const it = ITEMS[k];
          const worn = findWornBy(k);
          const effect = itemEffectText(it);
          html += "<div class='inv-row'><span>" + it.name + " ×" + partyOwnedItems[k] +
            (effect ? " <em>(" + effect + ")</em>" : "") + "</span>";

          if (worn) {
            html += "<button class='inv-worn-btn' data-hero='" + worn.hero.id + "'>worn by " +
              worn.hero.name + "</button>";
          } else {
            const eligible = roster.filter(function (h) {
              return !it.classRestrict || it.classRestrict === h.classKey;
            });
            if (eligible.length === 0) {
              html += "<span class='unworn'>no eligible hero</span>";
            } else {
              html += "<span class='inv-equip-choices'>" + eligible.map(function (h) {
                return "<button class='inv-equip-btn' data-item='" + k + "' data-hero='" +
                  h.id + "'>&rarr; " + h.name + "</button>";
              }).join("") + "</span>";
            }
          }
          html += "</div>";
        });
      }
      html += "</div>";

      wrap.innerHTML = html;

      wrap.querySelectorAll(".inv-equip-btn").forEach(function (btn) {
        btn.onclick = function () {
          const hero = roster.find(function (h) { return h.id === Number(btn.dataset.hero); });
          const r = equipItem(hero, btn.dataset.item);
          if (!r.ok) log(r.reason);
          showInventoryPanel();
        };
      });
      wrap.querySelectorAll(".inv-worn-btn").forEach(function (btn) {
        btn.onclick = function () {
          removeInventoryPanel();
          showCharacterPanel(Number(btn.dataset.hero), roster, "town");
        };
      });

      const doneBtn = document.createElement("button");
      doneBtn.textContent = "Done";
      doneBtn.onclick = function () { removeInventoryPanel(); };
      wrap.appendChild(doneBtn);

      document.getElementById("town-scene").appendChild(wrap);
    }

    function removeInventoryPanel() {
      const p = document.getElementById("inventory-panel");
      if (p) p.remove();
    }

    // Enter a dungeon with the chosen squad and reset dungeon-map progress —
    // NOT the roster or its persistent stuff (Phase H2: heroes/equipment now
    // persist across dungeons, only map position resets per attempt).
    // partyOwnedItems is NOT reset here: a hero's equipped gear (persisted on
    // their roster entry) has to stay consistent with what the party still
    // "owns," or the Character Sheet would show them wearing unowned items.
    // partyItems (the consumable bag) DOES still reset — that's a balance/
    // economy call, not a correctness one; revisit once Town/Shop exist (H4+).
    //
    // Full HP/EN heal + clear effects on EVERY fresh dungeon attempt (Phase
    // H3, new — was untested territory in H2 since only one dungeon existed).
    // This does NOT touch the no-heal-between-NODES-within-a-dungeon rule
    // (§4.2, still enforced by enterNode's lack of refill) — it only applies
    // at a dungeon-attempt BOUNDARY: starting fresh, retrying after a loss,
    // or moving on to the next dungeon. Necessary now that heroes persist
    // across dungeons (H2): without it, redeploying after a wipe would field
    // an already-dead (0 HP) party and instant-lose again — a real soft-lock
    // risk for the prologue specifically, since it's mostly solo with no Rest
    // node. Also just standard genre logic: "you regroup and try again."
    function startDungeon(heroIds, dungeonKey) {
      currentDungeonKey = dungeonKey;
      party = buildParty(heroIds);
      party.forEach(function (h) {
        h.stats.hp = h.stats.maxHp;
        h.stats.en = h.stats.maxEn;
        h.effects = [];
      });
      partyItems = { stim: 3 };
      visitedNodeIds = [];
      unlockedNodeIds = [DUNGEONS[dungeonKey].start];
      currentNodeId = null;
      lastMapMessage = "";
      showMap();
    }

    // Enter a Combat/Elite/Boss node: roll its encounter and start the fight.
    // HP/EN do NOT refill here (design §4.2) — Rest nodes and items are the
    // only recovery between fights. Status effects still clear: those are
    // combat-scoped, not run-scoped, unlike HP/EN/items.
    function enterNode(nodeId) {
      currentNodeId = nodeId;
      const node = DUNGEONS[currentDungeonKey].nodes[nodeId];
      const rolled = (currentDungeonKey === "prologue") ? rollPrologueEncounter(node)
        : (currentDungeonKey === "erebus") ? rollErebusEncounter(node)
        : rollEncounterForNode(node);
      enemies = buildEnemies(rolled);

      party.forEach(function (h) { h.effects = []; });

      battleOver = false;
      activeCombatant = null;
      pendingAction = null;
      document.getElementById("log").innerHTML = "";

      showBattle();
      renderCombatants();
      updateScreen();

      // Prologue nodes carry their own flavor line (enterText); Sector 1
      // nodes fall back to the original generic lines.
      log(node.enterText || (node.type === "boss" ? "The Warden activates!" :
          node.type === "unknown" ? "An ambush — this one wasn't a false alarm!" :
          "Hostiles engage!"), true);
      const order = turnOrder(living(allCombatants()));
      log("Turn order (by Speed): " +
          order.map(function (c) { return c.name; }).join(" → "));

      startRound();
    }

    // Called from the post-win endbar for a non-boss node: mark it visited,
    // unlock what it connects to, and return to the Map.
    function resolveNodeVictory() {
      const node = DUNGEONS[currentDungeonKey].nodes[currentNodeId];
      visitedNodeIds.push(currentNodeId);
      node.connectsTo.forEach(function (id) {
        if (unlockedNodeIds.indexOf(id) === -1) unlockedNodeIds.push(id);
      });
      currentNodeId = null;
      showMap();
    }

