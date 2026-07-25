"use strict";

    /* ================================================================
       D) TITLE, SAVE & SELECT — the title screen, the save/load engine,
          and the character-select screen. (Renamed in Phase H1 — this
          section used to be just "SELECT"; Title + Save were added ahead
          of it since they're what you see before Select now.)
       ================================================================ */

    // Minimal scene manager (Phase F, extended Phase H1). Exactly one of
    // title/select/map/battle is ever visible; SCENE_DISPLAY gives each
    // container its "shown" display value (battle is a flex column, the
    // others are block). Note the HTML element id is "title-scene" (not
    // "title" — that id is already the always-visible "GRIDFALL" masthead).
    const SCENE_DISPLAY = {
      "title-scene": "block", "naming-scene": "block", "story-scene": "block",
      "town-scene": "block", select: "block", map: "block", battle: "flex"
    };
    function goToScene(name) {
      Object.keys(SCENE_DISPLAY).forEach(function (scene) {
        document.getElementById(scene).style.display =
          (scene === name) ? SCENE_DISPLAY[scene] : "none";
      });
    }

    function showTitle() {
      goToScene("title-scene");
      renderTitleScreen();
    }

    function showNaming() {
      goToScene("naming-scene");
      renderNamingScreen();
    }

    // Generic reusable "narrative beat" screen (Phase H3, §5.2): a stack of
    // paragraphs + one Continue-style button. Used for the prologue's intro,
    // the mid-dungeon recruit beat, and the escape epilogue — one small,
    // data-driven component instead of a separate screen (or a full dialogue
    // engine) for each story moment.
    function showStoryScene(paragraphs, buttonLabel, onContinue) {
      goToScene("story-scene");
      const el = document.getElementById("story-scene");
      el.innerHTML =
        "<div id='story-box'>" +
          paragraphs.map(function (p) { return "<p class='story-p'>" + p + "</p>"; }).join("") +
          "<button id='story-continue-btn'>" + buttonLabel + "</button>" +
        "</div>";
      document.getElementById("story-continue-btn").onclick = onContinue;
    }

    function showTown() {
      goToScene("town-scene");
      renderTown();
      lastCheckpointScene = "town";
      saveGame();   // checkpoint: arriving in Town = a safe, resumable point (§5.2, was Map-only)
    }

    function showSelect() {
      goToScene("select");
      renderSelectScreen();
    }

    // "Return to base" (Phase H4) — Retire/New-squad/Abandon/a no-next-dungeon
    // boss-clear all land here now. Town doesn't exist yet during the
    // prologue itself (you haven't escaped), so that specific case still
    // goes straight to the squad-builder; everything past it goes to Town.
    function returnToHub() {
      if (currentDungeonKey === "prologue") { showSelect(); } else { showTown(); }
    }

    function showBattle() {
      goToScene("battle");
    }

    function showMap() {
      goToScene("map");
      renderMap();
      lastCheckpointScene = "map";
      saveGame();   // checkpoint: arriving on the Map = a safe, resumable point (§5.2)
    }


    /* ----------------------------------------------------------------
       SAVE / LOAD (Phase H1). One JSON blob under one localStorage key.
       We only ever save while on the Map (see the showMap() checkpoint
       above), so a save never has to capture mid-battle turn state —
       loading always resumes straight onto the Map.
       ---------------------------------------------------------------- */

    const SAVE_KEY = "gridfallSave";

    // Everything needed to resume a run: the whole recruited roster, which of
    // them are currently deployed, the shared bag/loot, and how far through
    // the dungeon map the player has gotten.
    //
    // We save `roster` (every hero, full data) and `activePartyIds` (just the
    // ids of who's deployed) rather than saving `party` directly. `party`'s
    // entries are meant to be the SAME objects as their `roster` entries
    // (§5.2 Phase H2 — so combat progress written on a deployed hero is
    // automatically also roster's copy) — but JSON.stringify/parse always
    // makes independent copies, so saving both `roster` and `party` as full
    // objects would silently break that sharing on reload. Saving ids and
    // re-linking them to roster in loadGame() keeps the invariant intact.
    function buildSaveData() {
      return {
        roster: roster,
        activePartyIds: party.map(function (h) { return h.id; }),
        lastSquad: lastSquad,
        partyItems: partyItems,
        partyOwnedItems: partyOwnedItems,
        currentDungeonKey: currentDungeonKey,
        unlockedNodeIds: unlockedNodeIds,
        visitedNodeIds: visitedNodeIds,
        lastMapMessage: lastMapMessage,
        lastTownMessage: lastTownMessage,
        sector1BriefingShown: sector1BriefingShown,
        lastCheckpointScene: lastCheckpointScene,
        nextIdCounter: nextIdCounter
      };
    }

    function saveGame() {
      localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveData()));
    }

    function hasSave() {
      return localStorage.getItem(SAVE_KEY) !== null;
    }

    // Restores globals from localStorage and returns true/false for success,
    // so the caller can tell the player if a save was missing or corrupt.
    function loadGame() {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return false;   // corrupt save data — treat like no save
      }

      roster = data.roster;
      party = data.activePartyIds
        .map(function (id) { return roster.find(function (h) { return h.id === id; }); })
        .filter(Boolean);   // defensive: drop any id that no longer matches a roster hero
      lastSquad = data.lastSquad;
      partyItems = data.partyItems;
      partyOwnedItems = data.partyOwnedItems;
      currentDungeonKey = data.currentDungeonKey;
      unlockedNodeIds = data.unlockedNodeIds;
      visitedNodeIds = data.visitedNodeIds;
      lastMapMessage = data.lastMapMessage;
      lastTownMessage = data.lastTownMessage;
      sector1BriefingShown = data.sector1BriefingShown;
      lastCheckpointScene = data.lastCheckpointScene;
      nextIdCounter = data.nextIdCounter;
      currentNodeId = null;   // we only ever save on Map/Town, never mid-battle — always resume there
      return true;
    }

    function clearSave() {
      localStorage.removeItem(SAVE_KEY);
    }


    /* ----------------------------------------------------------------
       TITLE SCREEN (Phase H1, routing updated Phase H2). Start always
       begins a brand-new story: confirm-overwrite any existing save,
       reset the roster to empty, then send the player to name their
       first operative. Saved Game loads and resumes on the Map.
       ---------------------------------------------------------------- */

    function renderTitleScreen() {
      const el = document.getElementById("title-scene");
      const saveExists = hasSave();
      el.innerHTML =
        "<p class='select-help'>A gritty space-core RPG.</p>" +
        "<div id='title-buttons'>" +
          "<button id='start-btn'>Start</button>" +
          "<button id='continue-btn'" + (saveExists ? "" : " disabled") + ">Saved Game</button>" +
        "</div>" +
        (saveExists ? "" : "<p class='title-flavor'>No saved game yet.</p>");

      document.getElementById("start-btn").onclick = onStartClicked;
      document.getElementById("continue-btn").onclick = onContinueClicked;
    }

    function onStartClicked() {
      if (hasSave()) {
        const proceed = confirm("Starting a new game will overwrite your saved game. Continue?");
        if (!proceed) return;
        clearSave();
      }
      // Fresh story start (§5.2): empty roster, no squad, no items/loot carried
      // over from a previous game. Map progress resets too — startDungeon()
      // handles that once a squad is actually deployed.
      roster = [];
      party = [];
      selectedHeroIds = [];
      lastSquad = [];
      partyItems = {};
      partyOwnedItems = {};
      currentDungeonKey = null;
      lastTownMessage = "";
      sector1BriefingShown = false;
      lastCheckpointScene = "map";
      showNaming();
    }

    function onContinueClicked() {
      const ok = loadGame();
      if (!ok) {
        alert("No saved game found.");
        renderTitleScreen();   // refresh in case the button state was stale
        return;
      }
      // Resume onto whichever of Map/Town was actually checkpointed (H4 —
      // was always the Map, back when Town didn't exist yet).
      if (lastCheckpointScene === "town") { showTown(); } else { showMap(); }
    }


    /* ----------------------------------------------------------------
       NAME-YOUR-HERO SCREEN (Phase H2). Shown once, right after Start on
       a brand-new game. Creates the starting Merc with the player's chosen
       call-sign and adds them to the (empty) roster, then moves on to the
       squad-builder. This same "name it" step is reused later for recruit
       events (Phase H3) — new companions get named the same way.
       ---------------------------------------------------------------- */

    function renderNamingScreen() {
      const el = document.getElementById("naming-scene");
      el.innerHTML =
        "<p class='select-help'>Name your operative. A Merc, freshly off a supply run, " +
        "about to have a very bad day.</p>" +
        "<div id='naming-box'>" +
          "<input type='text' id='name-input' maxlength='16' placeholder='e.g. " + HERO_NAMES[0] + "'>" +
          "<button id='confirm-name-btn'>Confirm</button>" +
        "</div>";

      const input = document.getElementById("name-input");
      input.focus();
      // Enter key confirms too, same as clicking the button.
      input.onkeydown = function (e) { if (e.key === "Enter") onConfirmName(); };
      document.getElementById("confirm-name-btn").onclick = onConfirmName;
    }

    function onConfirmName() {
      const typed = document.getElementById("name-input").value.trim();
      const name = typed || HERO_NAMES[0];   // blank input falls back to a default call-sign
      const hero = createHero("merc", name);
      roster.push(hero);
      showIntroScene(hero);
    }


    /* ----------------------------------------------------------------
       PROLOGUE INTRO (Phase H3, §5.2). Kharon's Reach — a Vossmark asteroid
       mining colony. The hero's brother Dez is executed by Foreman Voss for
       sabotaging a haul-quota terminal; while Voss turns to radio it in, the
       hero kills him and takes his rifle. This is the literal opening of the
       game. No combat here — it's an ambush, not a fair fight, so playing it
       out as combat would undercut it (matches the locked H3 decision).
       Continuing skips the squad-builder entirely (only one possible pick —
       solo, forced) and drops straight into the prologue dungeon.
       ---------------------------------------------------------------- */

    function showIntroScene(hero) {
      showStoryScene([
        "Kharon's Reach never had exits, only debts. You were born owing Vossmark before " +
          "you ever saw daylight, same as every serf on this rock, same as your brother Dez.",
        "Dez rerouted a haul-quota terminal today so the gang could get one rest shift " +
          "instead of another death march. Foreman Voss made an example of him for it, " +
          "right in front of everyone.",
        "Voss turned away to call it in before he'd even checked the crowd. He didn't get " +
          "the chance to finish; " + hero.name + " was already moving.",
        "The rifle is still warm in your hands, and somewhere above you the alarms are " +
          "starting up. The only way off Kharon's Reach runs through the hangar bay, and " +
          "Overseer Voraxx has no intention of opening that door for you."
      ], "Move.", function () {
        currentDungeonKey = "prologue";
        startDungeon([hero.id], "prologue");
      });
    }

    // Build the squad-builder screen from the player's ROSTER (Phase H2 —
    // used to be a fixed pick-3-of-5 built straight from CLASSES).
    function renderSelectScreen() {
      // Pre-select the previous squad, if any, for quick rematches — but only
      // ids that still exist in the roster (a hero could in principle be gone).
      selectedHeroIds = lastSquad.filter(function (id) {
        return roster.some(function (h) { return h.id === id; });
      });

      const sel = document.getElementById("select");
      sel.innerHTML =
        "<p class='select-help'>Select up to 3 operatives, then Deploy. " +
        "Pick order = turn/party order.</p>" +
        "<div id='class-cards'></div>" +
        "<div id='deploy-row'></div>";

      const cards = document.getElementById("class-cards");
      roster.forEach(function (h) {
        const card = document.createElement("div");
        card.className = "class-card";
        card.id = "card-" + h.id;
        card.innerHTML =
          "<span class='pick-badge' id='badge-" + h.id + "'></span>" +
          "<h3>" + h.name + "</h3>" +
          "<div class='card-sub'>" + h.className + " · Lv " + h.level + "</div>" +
          "<div class='card-stats'>HP " + h.stats.hp + "/" + h.stats.maxHp +
            " · EN " + h.stats.en + "/" + h.stats.maxEn +
            " · ATK " + h.stats.attack + " · DEF " + h.stats.defense +
            " · SPD " + h.stats.speed + "</div>" +
          "<div class='card-skills'>" +
            h.skills.map(function (k) { return SKILLS[k].name; }).join(" · ") +
          "</div>";
        card.onclick = function () { toggleSelect(h.id); };
        cards.appendChild(card);
      });

      refreshCardStates();
      updateDeployRow();
    }

    // Select or deselect a roster hero for the upcoming deploy (max 3).
    function toggleSelect(heroId) {
      const i = selectedHeroIds.indexOf(heroId);
      if (i >= 0) {
        selectedHeroIds.splice(i, 1);
      } else {
        if (selectedHeroIds.length >= 3) return;   // party cap
        selectedHeroIds.push(heroId);
      }
      refreshCardStates();
      updateDeployRow();
    }

    // Update each card's highlight and pick-order badge.
    function refreshCardStates() {
      roster.forEach(function (h) {
        const card = document.getElementById("card-" + h.id);
        const badge = document.getElementById("badge-" + h.id);
        const pick = selectedHeroIds.indexOf(h.id);
        if (pick >= 0) {
          card.classList.add("selected");
          badge.textContent = String(pick + 1);
        } else {
          card.classList.remove("selected");
          badge.textContent = "";
        }
      });
    }

    // Build the Deploy button + a live count.
    function updateDeployRow() {
      const row = document.getElementById("deploy-row");
      row.innerHTML = "";

      const deployBtn = document.createElement("button");
      deployBtn.textContent = "Deploy";
      deployBtn.disabled = selectedHeroIds.length < 1;
      deployBtn.onclick = deploy;
      row.appendChild(deployBtn);

      const count = document.createElement("span");
      count.className = "count";
      count.textContent = selectedHeroIds.length + " / 3 selected";
      row.appendChild(count);
    }

    // Deploy the chosen squad — lands on the dungeon Map, not straight into battle.
    function deploy() {
      if (selectedHeroIds.length < 1) return;
      lastSquad = selectedHeroIds.slice();
      // Redeploy into whichever dungeon is currently active (Phase H3) — set
      // once by showIntroScene() (prologue) or a boss-clear epilogue
      // (sector1); this screen is reached after a retry/retire/abandon
      // within THAT dungeon, never a fresh pick between dungeons.
      startDungeon(lastSquad, currentDungeonKey);
    }


    /* ================================================================
       D2) MAP — the dungeon map screen (Phase G, §5.1).
       ================================================================ */

    // Render every node, grouped into rows by depth. v1 stays plain/text-driven
    // per the design doc ("graphics stay deferred") — hex-marker art is a later
    // Phase I pass, this just needs to be legible and clickable.
    // Map layout constants (Phase I). The graph is drawn in a fixed virtual
    // pixel space so the SVG connector lines and the absolutely-positioned hex
    // nodes share one coordinate system; the container is centered and scrolls
    // if the viewport is narrower.
    const MAP_GRAPH_W = 300;   // virtual width (px) — non-foggy dungeons (Sector1/Erebus/prologue)
    const MAP_GRAPH_W_FOGGY = 440;   // wider (§5.4 rebuild, 2026-07-24): foggy dungeons can have
    // several simultaneously-unlocked mystery nodes in one row, and need real room so a busier
    // fogged reveal doesn't cramp.
    const MAP_ROW_H = 82;      // vertical spacing between depth rows (px)
    const MAP_TOP_PAD = 12;    // top padding before the first row (px)
    // Radial layout (§5.4b, Dungeon 5 "Helios Station" — a circle with the
    // double boss at the center, not depth-column rows). Opt in per dungeon
    // via `mapShape: "radial"`; every other dungeon is unaffected.
    const MAP_RADIAL_SIZE = 460;   // virtual diameter (px) — square canvas
    const MAP_RADIAL_MARGIN = 40;  // keep the outermost ring's hexcells inside the frame
    // How far around the rim the path sweeps before diving inward (2026-07-25
    // rebuild — the first version mapped EVERY depth to its own radius, which
    // reads fine when a depth has several simultaneous nodes, but this graph's
    // critical path is mostly one node per depth, so those nodes all landed on
    // the same angle (dead top) and the "circle" was actually a straight spoke
    // to the center. Fixed shape: depths walk AROUND the rim at a constant
    // radius (this sweep), then the last `radialDiveDepths` depths (the double
    // boss) collapse straight to the center at a frozen angle.
    const MAP_RADIAL_SWEEP = 2 * Math.PI * (300 / 360);   // 300° around the rim
    const MAP_RADIAL_BRANCH_WEDGE = 2 * Math.PI * (40 / 360);  // spread for simultaneous nodes at one depth

    // Compute each node's (x, y) center in the virtual space: rows by depth,
    // evenly spread horizontally within a depth. Returns { id: {x, y, node} }.
    // Computes a STABLE position for every node in the dungeon (the full
    // graph, known or not) so a sibling never visually shifts position the
    // moment a fogged neighbor is discovered — `renderMap` below decides
    // which of these positions actually get drawn. Unchanged since Phase I;
    // true fog of war (§5.4 rebuild, 2026-07-24) is a RENDER-time concern,
    // not a layout one.
    function computeMapLayout(dungeon) {
      if (dungeon.mapShape === "radial") return computeMapLayoutRadial(dungeon);
      const w = dungeon.foggy ? MAP_GRAPH_W_FOGGY : MAP_GRAPH_W;
      const byDepth = {};
      let maxDepth = 0;
      Object.keys(dungeon.nodes).forEach(function (id) {
        const d = dungeon.nodes[id].depth;
        (byDepth[d] = byDepth[d] || []).push(id);
        if (d > maxDepth) maxDepth = d;
      });
      const pos = {};
      for (let d = 1; d <= maxDepth; d++) {
        const ids = byDepth[d] || [];
        ids.forEach(function (id, i) {
          pos[id] = {
            x: w * (i + 1) / (ids.length + 1),
            y: MAP_TOP_PAD + (d - 0.5) * MAP_ROW_H,
            node: dungeon.nodes[id]
          };
        });
      }
      return { pos: pos, height: MAP_TOP_PAD * 2 + maxDepth * MAP_ROW_H, width: w };
    }

    // Radial counterpart to computeMapLayout above: same input/output shape
    // (`{ pos, height, width }`, one stable {x,y} per node keyed by id) so
    // renderMap/fog-of-war/edge-drawing don't need to know which shape they're
    // looking at — only the POSITIONING math differs.
    //
    // Two phases (2026-07-25 rebuild, after the first version read as a
    // straight line — see the MAP_RADIAL_SWEEP comment above):
    //   1) RIM phase (depths 1..arcDepths): radius stays fixed at the outer
    //      rim; angle sweeps around MAP_RADIAL_SWEEP as depth increases, so
    //      walking the critical path reads as walking around a circle.
    //      Nodes sharing a depth (a branch) spread across a small wedge
    //      around that depth's angle, instead of scattering across the
    //      whole ring.
    //   2) DIVE phase (the last `dungeon.radialDiveDepths || 2` depths — the
    //      double boss): angle freezes at wherever the rim phase ended, and
    //      radius collapses straight to 0 — "aim the line into the center."
    function computeMapLayoutRadial(dungeon) {
      const size = MAP_RADIAL_SIZE;
      const cx = size / 2, cy = size / 2;
      const rOuter = size / 2 - MAP_RADIAL_MARGIN;
      const byDepth = {};
      let maxDepth = 0;
      Object.keys(dungeon.nodes).forEach(function (id) {
        const d = dungeon.nodes[id].depth;
        (byDepth[d] = byDepth[d] || []).push(id);
        if (d > maxDepth) maxDepth = d;
      });
      const diveDepths = Math.min(maxDepth - 1, dungeon.radialDiveDepths || 2);
      const arcDepths = Math.max(1, maxDepth - diveDepths);

      // Safety fix (2026-07-25, found by a real playtest of Dungeon 6):
      // a fixed branch wedge can eat into the gap between adjacent rim
      // depths when many depth-bands are packed into the sweep — worst
      // case, two sibling nodes in NEIGHBORING depth-bands both get pushed
      // toward each other by up to half the wedge each, closing the gap by
      // the full wedge. With enough depths (D6's original single-dungeon6
      // had 16), that closure could exactly cancel the angular step between
      // depths, landing two DIFFERENT nodes on the exact same pixel.
      // Clamping the wedge to (step - minGap) guarantees at least minGap
      // survives even in that worst case, regardless of graph size — D5's
      // proven 5-depth shape never hit this (step=75°, comfortably under
      // the clamp), so it's unaffected; a dense future radial dungeon won't
      // silently regress the same way D6 did.
      const stepAngle = arcDepths > 1 ? MAP_RADIAL_SWEEP / (arcDepths - 1) : MAP_RADIAL_SWEEP;
      const MIN_GAP_RAD = 20 * Math.PI / 180;   // ~66px at this canvas's rOuter — clears a 64px hexcell
      const wedge = Math.min(MAP_RADIAL_BRANCH_WEDGE, Math.max(8 * Math.PI / 180, stepAngle - MIN_GAP_RAD));

      const pos = {};
      let finalRimAngle = -Math.PI / 2;
      for (let d = 1; d <= maxDepth; d++) {
        const ids = byDepth[d] || [];
        let r, baseAngle;
        if (d <= arcDepths) {
          const progress = arcDepths > 1 ? (d - 1) / (arcDepths - 1) : 0;
          baseAngle = -Math.PI / 2 + progress * MAP_RADIAL_SWEEP;
          r = rOuter;
          finalRimAngle = baseAngle;
        } else {
          const diveIndex = d - arcDepths;               // 1..diveDepths
          r = rOuter * (1 - diveIndex / diveDepths);      // collapses to 0 at maxDepth
          baseAngle = finalRimAngle;                      // frozen — "aim the line inward"
        }
        ids.forEach(function (id, i) {
          const n = ids.length;
          const angle = n > 1
            ? baseAngle + (i - (n - 1) / 2) * (wedge / Math.max(1, n - 1))
            : baseAngle;
          pos[id] = {
            x: r === 0 ? cx : cx + r * Math.cos(angle),
            y: r === 0 ? cy : cy + r * Math.sin(angle),
            node: dungeon.nodes[id]
          };
        });
      }
      return { pos: pos, height: size, width: size };
    }

    function renderMap() {
      const wrap = document.getElementById("map");
      wrap.innerHTML = "";

      const dungeon = DUNGEONS[currentDungeonKey];

      const heading = document.createElement("p");
      heading.className = "map-title";
      heading.textContent = dungeon.title;
      wrap.appendChild(heading);

      if (lastMapMessage) {
        const msg = document.createElement("p");
        msg.className = "map-message";
        msg.textContent = lastMapMessage;
        wrap.appendChild(msg);
      }

      const layout = computeMapLayout(dungeon);
      const foggy = !!dungeon.foggy;

      // TRUE fog of war (§5.4 rebuilt 2026-07-24, after a playtest found the
      // previous version leaked the whole graph shape — see the changelog).
      // A node is "known" once unlocked (reachable); anything not yet
      // unlocked isn't rendered AT ALL on a foggy dungeon — no hex, no edge,
      // not even a placeholder — so its existence, position, and (critically)
      // whether it's a dead end are genuinely unknown until you're standing
      // one step away from it. Non-foggy dungeons (Sector1/Erebus/prologue)
      // are completely unaffected: `known` is just "true" for them, same as
      // the original always-show-everything behavior.
      function known(id) { return !foggy || unlockedNodeIds.indexOf(id) !== -1; }

      // The visible graph only grows as deep as what's actually been
      // discovered on a foggy dungeon — revealing "how big is this place"
      // is itself part of the fog, not just node contents.
      let revealedMaxDepth = 0;
      Object.keys(dungeon.nodes).forEach(function (id) {
        if (known(id)) revealedMaxDepth = Math.max(revealedMaxDepth, dungeon.nodes[id].depth);
      });
      // Radial dungeons (§5.4b) skip the "shrink to revealed depth" formula
      // below — that math assumes rows growing downward. A circle's frame is
      // a fixed size regardless of how much of it is unlocked; fog there
      // means fewer dots on a same-size canvas, not a shorter canvas.
      const visibleHeight = (foggy && dungeon.mapShape !== "radial")
        ? MAP_TOP_PAD * 2 + revealedMaxDepth * MAP_ROW_H
        : layout.height;

      // The graph container carries the per-region backdrop theme class
      // (mining / station / hive) so each dungeon reads as its own locale.
      const graph = document.createElement("div");
      graph.id = "map-graph";
      graph.className = "region-" + (dungeon.region || "station") +
        (dungeon.mapShape === "radial" ? " map-radial" : "");
      graph.style.width = layout.width + "px";
      graph.style.height = visibleHeight + "px";

      // Decorative backdrop layer (stars / dust / spores, drawn by CSS).
      const backdrop = document.createElement("div");
      backdrop.className = "map-backdrop";
      graph.appendChild(backdrop);

      // SVG connector lines behind the nodes. On a foggy dungeon, a node's
      // OUTGOING edges only draw once that node has been VISITED (not
      // merely unlocked) — you can see a fork exists once you're standing at
      // it, but not what's past nodes you haven't actually explored yet.
      // This is what makes a dead end genuinely indistinguishable from a
      // real path until you commit to it (the previous version's dashed
      // "spur" styling was a predictive leak — removed).
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("class", "map-edges");
      svg.setAttribute("width", layout.width);
      svg.setAttribute("height", visibleHeight);
      Object.keys(layout.pos).forEach(function (id) {
        const sourceVisited = visitedNodeIds.indexOf(id) !== -1;
        if (foggy && !sourceVisited) return;   // haven't explored FROM here yet
        const from = layout.pos[id];
        from.node.connectsTo.forEach(function (tid) {
          if (!known(tid)) return;
          const to = layout.pos[tid];
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", from.x); line.setAttribute("y1", from.y);
          line.setAttribute("x2", to.x);   line.setAttribute("y2", to.y);
          const targetUnlocked = unlockedNodeIds.indexOf(tid) !== -1;
          line.setAttribute("class", "map-edge" +
            (sourceVisited ? " taken" : targetUnlocked ? " open" : ""));
          svg.appendChild(line);
        });
      });
      graph.appendChild(svg);

      // Hex nodes on top — only the known ones exist in the DOM at all.
      Object.keys(layout.pos).forEach(function (id) {
        if (!known(id)) return;
        const p = layout.pos[id];
        const node = p.node;
        const visited = visitedNodeIds.indexOf(id) !== -1;
        const unlocked = unlockedNodeIds.indexOf(id) !== -1;
        const reachable = unlocked && !visited;

        const cell = document.createElement("div");
        cell.className = "hexcell";
        cell.style.left = p.x + "px";
        cell.style.top = p.y + "px";

        // On a NON-foggy dungeon every node is always rendered (unchanged
        // behavior) — but one that isn't unlocked YET must still show as
        // locked (🔒), not reveal its type. On a foggy dungeon this branch
        // never actually fires (an unknown-but-not-yet-unlocked node never
        // reaches here at all, filtered out by `known()` above), so
        // `unlocked` is always true here for foggy dungeons.
        const btn = document.createElement("button");
        btn.className = "hexnode node-" + node.type +
          (visited ? " visited" : "") + (reachable ? " reachable" : "") +
          (unlocked ? "" : " locked");
        btn.disabled = !reachable;
        btn.innerHTML =
          "<span class='hex-icon'>" +
            (visited ? "✓" : unlocked ? (NODE_TYPE_ICON[node.type] || "?") : "🔒") +
          "</span>";
        btn.onclick = function () { onNodeClick(id); };
        cell.appendChild(btn);

        const label = document.createElement("span");
        label.className = "hex-label";
        label.textContent = NODE_TYPE_LABEL[node.type];
        cell.appendChild(label);

        // Dead-end / loot spur sub-label — gated to VISITED, not merely
        // unlocked: a post-hoc "yep, that was a dead end" acknowledgment,
        // never a pre-visit spoiler.
        const isDeadEnd = node.connectsTo.length === 0 && node.type !== "boss";
        if (isDeadEnd && visited) {
          const spurTag = document.createElement("span");
          spurTag.className = "hex-spur-tag";
          spurTag.textContent = "Dead End";
          cell.appendChild(spurTag);
        }

        graph.appendChild(cell);
      });

      wrap.appendChild(graph);

      const backRow = document.createElement("div");
      backRow.id = "map-back-row";
      const abandon = document.createElement("button");
      abandon.className = "cancel";
      abandon.textContent = "Abandon run";
      abandon.onclick = function () { returnToHub(); };
      backRow.appendChild(abandon);
      wrap.appendChild(backRow);
    }

    // Combat/Elite/Boss nodes roll a real encounter and enter battle (visiting/
    // unlocking happens on victory, via resolveNodeVictory). Loot/Rest resolve
    // their effect inline via resolvePassiveNode; Recruit (Phase H3) resolves
    // via resolveRecruitNode — a story beat, not a battle or an item.
    function onNodeClick(nodeId) {
      if (unlockedNodeIds.indexOf(nodeId) === -1) return;   // locked
      if (visitedNodeIds.indexOf(nodeId) !== -1) return;    // already resolved

      const node = DUNGEONS[currentDungeonKey].nodes[nodeId];
      if (node.type === "combat" || node.type === "elite" || node.type === "boss") {
        enterNode(nodeId);
      } else if (node.type === "recruit") {
        resolveRecruitNode(nodeId);
      } else if (node.type === "unknown") {
        resolveUnknownNode(nodeId);
      } else {
        resolvePassiveNode(nodeId);
      }
    }

    /* ----------------------------------------------------------------
       UNKNOWN NODE (§5.4, Dungeons 4+). Outcome rolled HERE, at click time,
       from UNKNOWN_NODE_OUTCOMES — not authored per-node, so every Unknown
       node in every dungeon shares one tunable table. "fight" hands off to
       the real battle flow (enterNode); the other three resolve inline like
       Loot/Rest (resolvePassiveNode's pattern, duplicated rather than shared
       since the two need different post-outcome messages).
       ---------------------------------------------------------------- */
    function resolveUnknownNode(nodeId) {
      const node = DUNGEONS[currentDungeonKey].nodes[nodeId];
      const outcome = pickWeighted(UNKNOWN_NODE_OUTCOMES).key;

      if (outcome === "fight") {
        enterNode(nodeId);   // visited/unlock happens on victory, same as any combat node
        return;
      }

      currentNodeId = nodeId;
      visitedNodeIds.push(nodeId);

      if (outcome === "loot") {
        lastMapMessage = grantLoot(true);   // heavy odds — you took the gamble
      } else if (outcome === "trap") {
        party.forEach(function (h) {
          const dmg = Math.round(h.stats.maxHp * UNKNOWN_TRAP_HP_FRACTION);
          h.stats.hp = clamp(h.stats.hp - dmg, 0, h.stats.maxHp);
        });
        lastMapMessage = UNKNOWN_TRAP_FLAVOR[randomBetween(0, UNKNOWN_TRAP_FLAVOR.length - 1)];
      } else {
        lastMapMessage = UNKNOWN_NARRATIVE_FLAVOR[randomBetween(0, UNKNOWN_NARRATIVE_FLAVOR.length - 1)];
      }

      node.connectsTo.forEach(function (id) {
        if (unlockedNodeIds.indexOf(id) === -1) unlockedNodeIds.push(id);
      });
      currentNodeId = null;
      renderMap();
    }

    // Weighted item pick (§5.4 loot variance): rolls a rarity tier first
    // (LOOT_RARITY_WEIGHTS / _HEAVY), then a random unowned item within that
    // tier; falls back to any remaining unowned item if the rolled tier is
    // fully owned. Shared by grantLoot() and rollLootDrop() (engine.js).
    function pickWeightedLootItem(heavy) {
      const weights = heavy ? LOOT_RARITY_WEIGHTS_HEAVY : LOOT_RARITY_WEIGHTS;
      const byRarity = {};
      Object.keys(ITEMS).forEach(function (k) {
        if (partyOwnedItems[k]) return;
        const r = ITEMS[k].rarity || "common";
        (byRarity[r] = byRarity[r] || []).push(k);
      });
      const tier = pickWeighted(Object.keys(weights).map(function (r) {
        return { key: r, weight: weights[r] };
      })).key;
      let pool = byRarity[tier];
      if (!pool || pool.length === 0) {
        pool = Object.keys(byRarity).reduce(function (all, r) { return all.concat(byRarity[r]); }, []);
      }
      if (!pool || pool.length === 0) return null;
      return pool[randomBetween(0, pool.length - 1)];
    }

    // Loot: grants one guaranteed random unowned item (reuses the same ITEMS
    // pool as the interim combat-win drop, but guaranteed, not a chance roll).
    // `heavy` (Unknown-node loot rolls, §5.4) shifts the odds toward rare.
    function grantLoot(heavy) {
      const key = pickWeightedLootItem(heavy);
      if (!key) return "Loot cache is empty. You already own everything here.";
      partyOwnedItems[key] = (partyOwnedItems[key] || 0) + 1;
      return "Found: " + ITEMS[key].name + "!";
    }

    // Rest: restores a fraction of max HP/EN — the real recovery path now that
    // fights no longer free-heal between nodes (design §4.2) — and clears
    // active status effects.
    function restParty() {
      party.forEach(function (h) {
        h.stats.hp = clamp(h.stats.hp + Math.round(h.stats.maxHp * REST_HEAL_FRACTION), 0, h.stats.maxHp);
        h.stats.en = clamp(h.stats.en + Math.round(h.stats.maxEn * REST_HEAL_FRACTION), 0, h.stats.maxEn);
        h.effects = [];
      });
      return "The squad rests. HP and EN are partially restored.";
    }

    // Loot/Rest nodes: resolve their effect inline (no battle scene), mark
    // visited, unlock what they connect to, and show the result on the Map.
    function resolvePassiveNode(nodeId) {
      currentNodeId = nodeId;
      visitedNodeIds.push(nodeId);
      const node = DUNGEONS[currentDungeonKey].nodes[nodeId];

      if (node.type === "loot") lastMapMessage = grantLoot();
      else if (node.type === "rest") lastMapMessage = restParty();

      node.connectsTo.forEach(function (id) {
        if (unlockedNodeIds.indexOf(id) === -1) unlockedNodeIds.push(id);
      });
      currentNodeId = null;
      renderMap();
    }


    /* ----------------------------------------------------------------
       RECRUIT NODE (Phase H3, §5.2). A non-combat story beat: the node's
       `recruitClass`/`recruitName` (see DUNGEONS.prologue.nodes.p3) create a
       new hero, added to BOTH the roster (persists) and the active party
       (fights alongside you immediately — no squad-builder step needed for
       a forced-duo prologue). Gets the full-screen story treatment (like the
       intro/epilogue), not just the small Loot/Rest map banner — recruiting
       a permanent companion is a bigger beat than finding an item.
       ---------------------------------------------------------------- */

    // Generalized (Phase H4 — was Kade-only hardcoded text). Reads the
    // node's own recruitText/recruitButtonLabel (see DUNGEONS.prologue.p3
    // and DUNGEONS.sector1.recruit1), so adding another recruit event later
    // is a data entry, not new logic. The new companion always joins the
    // ROSTER, but only joins the ACTIVE PARTY if there's a free slot (cap 3,
    // §2 "Max party size" — a squad that deployed already full stays full;
    // the companion is still available next time via the squad-builder).
    function resolveRecruitNode(nodeId) {
      currentNodeId = nodeId;
      const node = DUNGEONS[currentDungeonKey].nodes[nodeId];

      const companion = createHero(node.recruitClass, node.recruitName);
      roster.push(companion);
      // Cap 3 (§2) — if the party's already full, the companion joins the
      // ROSTER only for now; showSquadSwapPrompt (below) offers an immediate
      // in-place swap right after the story beat, since otherwise a mid-
      // dungeon recruit like Six is completely unusable until the whole
      // dungeon ends (no squad-builder mid-run — deploy() would reset the
      // attempt). A party with a free slot still auto-joins, unchanged.
      const partyWasFull = party.length >= 3;
      if (!partyWasFull) party.push(companion);

      visitedNodeIds.push(nodeId);
      node.connectsTo.forEach(function (id) {
        if (unlockedNodeIds.indexOf(id) === -1) unlockedNodeIds.push(id);
      });
      currentNodeId = null;

      showStoryScene(node.recruitText, node.recruitButtonLabel, function () {
        if (partyWasFull) showSquadSwapPrompt(companion);
        else showMap();
      });
    }

    // Mid-dungeon squad swap (added 2026-07-24, playtest feedback: "the new
    // addition cannot be added to the team... we should have a method to
    // swap her in"). A minimal, targeted fix — not a full mid-run squad-
    // builder — reusing the story-scene container for one more beat: pick
    // who's benched, or skip and swap later at Town. Swapping only mutates
    // the `party` array in place (both the old and new member stay in
    // `roster` by reference, so no state is lost either way — the benched
    // hero keeps their current HP/EN/level, ready to swap back in later).
    function showSquadSwapPrompt(companion) {
      goToScene("story-scene");
      const el = document.getElementById("story-scene");
      el.innerHTML = "";

      const box = document.createElement("div");
      box.id = "story-box";

      const p = document.createElement("p");
      p.className = "story-p";
      p.textContent = companion.name + " is ready to fight, but the squad's already full. " +
        "Swap someone out to bring them in right now, or leave them in reserve until you're " +
        "back between dungeons.";
      box.appendChild(p);

      party.forEach(function (h) {
        const btn = document.createElement("button");
        btn.textContent = "Swap in " + companion.name + " for " + h.name +
          " (" + h.className + " · Lv " + h.level + ")";
        btn.onclick = function () {
          const idx = party.indexOf(h);
          party[idx] = companion;
          lastMapMessage = companion.name + " joins the active squad — " + h.name + " falls back to reserve.";
          showMap();
        };
        box.appendChild(btn);
      });

      const skip = document.createElement("button");
      skip.className = "cancel";
      skip.textContent = "Not now — keep the current squad";
      skip.onclick = function () {
        lastMapMessage = companion.name + " joins the roster, ready to swap in at Town.";
        showMap();
      };
      box.appendChild(skip);

      el.appendChild(box);
    }


    /* ================================================================
       D3) TOWN — the general hub between dungeons (Phase H4, §5.2).
       Today it's "the Long Shot," the prologue's escape ship; later towns
       (space stations, other ships, an asteroid base — per the design
       doc's regions arc) reuse this same scene, just different content.
       ================================================================ */

    function renderTown() {
      const wrap = document.getElementById("town-scene");
      wrap.innerHTML = "";

      const name = document.createElement("p");
      name.className = "town-ship-name";
      name.textContent = "THE LONG SHOT";
      wrap.appendChild(name);

      const flavor = document.createElement("p");
      flavor.className = "town-flavor";
      flavor.textContent = "A battered long-haul shuttle, yours now. Somewhere behind you, " +
        "Kharon's Reach is still burning mad.";
      wrap.appendChild(flavor);

      if (lastTownMessage) {
        const msg = document.createElement("p");
        msg.className = "town-message";
        msg.textContent = lastTownMessage;
        wrap.appendChild(msg);
      }

      const rosterList = document.createElement("div");
      rosterList.id = "town-roster";
      roster.forEach(function (h) {
        const row = document.createElement("div");
        row.className = "town-roster-row";
        row.innerHTML =
          "<span class='name'>" + h.name + "</span>" +
          "<span class='sub'>" + h.className + " · Lv " + h.level +
            " · HP " + h.stats.hp + "/" + h.stats.maxHp + "</span>";
        rosterList.appendChild(row);
      });
      wrap.appendChild(rosterList);

      const buttons = document.createElement("div");
      buttons.id = "town-buttons";

      const rosterBtn = document.createElement("button");
      rosterBtn.textContent = "Roster & Equipment";
      rosterBtn.onclick = function () { showCharacterPanel(undefined, roster, "town"); };
      buttons.appendChild(rosterBtn);

      const invBtn = document.createElement("button");
      invBtn.textContent = "Party Inventory";
      invBtn.onclick = function () { showInventoryPanel(); };
      buttons.appendChild(invBtn);

      const missionBtn = document.createElement("button");
      if (currentDungeonKey === "sector1" && !sector1BriefingShown) {
        missionBtn.textContent = "Head to the Station";
        missionBtn.onclick = onHeadToStation;
      } else {
        missionBtn.textContent = "Prep Squad";
        missionBtn.onclick = showSelect;
      }
      buttons.appendChild(missionBtn);

      const saveBtn = document.createElement("button");
      saveBtn.className = "cancel";
      saveBtn.textContent = "Save";
      saveBtn.onclick = function () {
        saveGame();
        lastTownMessage = "Progress saved.";
        renderTown();
      };
      buttons.appendChild(saveBtn);

      wrap.appendChild(buttons);
    }

    // The "why we're attacking the station" story beat (Phase H3/H4) — shown
    // once, the first time the player commits to the Sector 1 mission from
    // Town. Hand-authored like the prologue's beats; only one such briefing
    // exists today so a generic per-dungeon "briefing text" table would be
    // speculative infrastructure for a single use case.
    function onHeadToStation() {
      sector1BriefingShown = true;
      showStoryScene([
        "The Long Shot's sensors don't lie. Kharon's Reach answers to a station in high " +
          "orbit, Vossmark Station Sector 1. Every quota, every guard rotation, every debt " +
          "ledger on the colony runs through it.",
        "Kade already knows the approach vectors. Running isn't enough anymore, not with " +
          "Dez's name still fresh, and if Vossmark wants a fight, this crew isn't going to " +
          "keep hiding from one.",
        "Sector 1 is bigger and better defended, and whatever's waiting up there won't be " +
          "the only thing that wants you dead. Time to gear up."
      ], "Breach the station.", function () {
        showSelect();
      });
    }


    /* ================================================================
       E) UI — battlefield panels, the log, the action bar.
       ================================================================ */

    // SPRITE ENGINE (Phase I, Slice 1). Reads the SPRITES/SPRITE_SHAPES data
    // above; nothing here is per-class/per-enemy — adding a new sprite is a
    // data change (see §A), not a change here.
    const SPRITE_SCALE = 4;             // pixel-grid cell -> canvas px, chunky/8-bit
    // Heroes render at a smaller scale than enemies on the battlefield (Phase I
    // FF1 UI): the party is a compact column and enemies are the visual focus,
    // the FF small-party/big-enemy convention. Integer so cells stay crisp.
    const HERO_BATTLE_SCALE = 3;        // 18x28 grid -> 54x84 px
    // Enemies render bigger by tier — a real JRPG convention (bosses tower
    // over the party). Values stay integer so every grid cell still lands on a
    // whole pixel (no blurry fractional scaling).
    const TIER_SPRITE_SCALE = { fodder: SPRITE_SCALE, standard: SPRITE_SCALE, elite: 5, boss: 6 };
    // Per-shape scale override (wins over tier scale). Some enemies borrow a
    // 24x32 HERO grid (e.g. guardTrooper = the Merc reskinned as a guard); at
    // the fodder/standard tier scale of 4 that would render huge, so pin them to
    // the hero battle scale so a humanoid guard reads the same size as a hero.
    const SHAPE_SCALE_OVERRIDE = { guardTrooper: HERO_BATTLE_SCALE, voraxxFat: 5 };
    const SPRITE_FLASH_MS = 150;        // hit-flash duration
    const spriteFlashUntil = {};        // combatant id -> timestamp, drives the flash
    let spriteAnimFrame = 0;            // 0 or 1, swapped on the idle-bob timer
    let spriteAnimTimer = null;

    // A second "idle bob" frame, generated from the base grid instead of
    // hand-authored twice: shift every row up one and pad a blank row at the
    // bottom. Every shape has blank padding rows at top/bottom, so this reads
    // as a subtle 1px "alive" bob rather than actually clipping the art.
    // Blank-row width matches the shape's own width, not a fixed constant —
    // hero shapes (16x22) and enemy shapes (16x16) can differ.
    function bobShape(shape) {
      const blankRow = ".".repeat(shape[0].length);
      return shape.slice(1).concat([blankRow]);
    }

    // Which sprite a combatant draws: its own class/enemy entry if one exists
    // yet, else the nature-colored generic blob (see GENERIC_PALETTES above).
    function spriteFor(c) {
      const key = c.classKey || c.typeKey;
      if (SPRITES[key]) return SPRITES[key];
      return { shape: "blob", palette: GENERIC_PALETTES[c.nature] || GENERIC_PALETTES.organic };
    }

    // Per-combatant sprite scale: heroes always draw at the base scale;
    // enemies scale up by tier (TIER_SPRITE_SCALE above).
    function scaleFor(c) {
      // Heroes render smaller than enemies on the battlefield (Phase I FF1 UI):
      // the party is a compact column on the right (FF party-is-small,
      // enemy-is-big convention), and it keeps the hero column from getting
      // tall again now that the sprites — not stat cards — set its height.
      if (c.side === "heroes") return HERO_BATTLE_SCALE;
      const shapeKey = spriteFor(c).shape;
      if (SHAPE_SCALE_OVERRIDE[shapeKey]) return SHAPE_SCALE_OVERRIDE[shapeKey];
      return TIER_SPRITE_SCALE[c.tier] || SPRITE_SCALE;
    }

    // Pixel canvas size (in CSS px) for a given sprite at a given scale — read
    // off its own grid rather than a fixed constant, since hero shapes are
    // taller than enemy shapes and elite/boss enemies render bigger still.
    // Used both to size the <canvas> element (panelHtml) and to clear it
    // correctly before each redraw.
    function spriteCanvasSize(spriteData, scale) {
      scale = scale || SPRITE_SCALE;
      const shape = SPRITE_SHAPES[spriteData.shape];
      return { w: shape[0].length * scale, h: shape.length * scale };
    }

    function drawSpriteFrame(ctx, spriteData, frameIndex, flash, scale) {
      scale = scale || SPRITE_SCALE;
      const shape = SPRITE_SHAPES[spriteData.shape];
      const rows = frameIndex === 0 ? shape : bobShape(shape);
      const size = spriteCanvasSize(spriteData, scale);
      ctx.clearRect(0, 0, size.w, size.h);
      rows.forEach(function (line, row) {
        for (let col = 0; col < line.length; col++) {
          const ch = line[col];
          if (ch === ".") continue;
          ctx.fillStyle = flash ? "#f4fff8" : spriteData.palette[ch];
          ctx.fillRect(col * scale, row * scale, scale, scale);
        }
      });
    }

    function redrawAllSprites() {
      allCombatants().forEach(function (c) {
        const canvas = document.getElementById("sprite-" + c.id);
        // Guard, not just a null check: the headless balance-sim's DOM stub
        // (§9 of the tech reference) fakes getElementById but not a real
        // <canvas>, so this also has to no-op there rather than throw.
        if (!canvas || typeof canvas.getContext !== "function") return;
        const flash = (spriteFlashUntil[c.id] || 0) > Date.now();
        drawSpriteFrame(canvas.getContext("2d"), spriteFor(c), spriteAnimFrame, flash, scaleFor(c));
      });
    }

    // Started/stopped alongside a battle (renderCombatants / endBattle) rather
    // than running globally — nothing to animate on the Map/Town screens.
    function startSpriteAnimation() {
      // The headless balance-sim's JavaScriptCore environment (§9 of the tech
      // reference) has no real timer loop — it stubs setTimeout only, queued
      // and drained manually. No visible canvas to animate there anyway, so
      // just no-op instead of throwing on a missing setInterval.
      if (spriteAnimTimer || typeof setInterval !== "function") return;
      spriteAnimTimer = setInterval(function () {
        spriteAnimFrame = spriteAnimFrame === 0 ? 1 : 0;
        redrawAllSprites();
      }, 500);
    }

    function stopSpriteAnimation() {
      if (spriteAnimTimer) clearInterval(spriteAnimTimer);
      spriteAnimTimer = null;
    }

    // Called from applyToTarget on a damaging hit: draws an all-white
    // silhouette for SPRITE_FLASH_MS, then reverts (the idle timer would
    // eventually redraw it anyway, but a hit should flash immediately, not
    // wait up to 500ms for the next tick).
    function flashCombatant(id) {
      spriteFlashUntil[id] = Date.now() + SPRITE_FLASH_MS;
      redrawAllSprites();
      setTimeout(redrawAllSprites, SPRITE_FLASH_MS + 20);
    }

    // Battlefield tile (Phase I — FF1-style combat UI overhaul). Sprites ONLY:
    // the old tall per-combatant stat cards are gone. Hero HP/EN/Limit now live
    // in the compact bottom party-status window (pstatRowHtml); the battlefield
    // is just figures over the region backdrop, FF-style. Enemies keep a small
    // name + HP bar on the tile so targeting stays informed; heroes show only
    // the sprite (+ status pips + the active-turn glow). The tile keeps
    // id="panel-<id>", so targeting (highlightTargets) and the active/down
    // toggles are unchanged.
    function tileHtml(c) {
      const spriteSize = spriteCanvasSize(spriteFor(c), scaleFor(c));
      const isEnemy = c.side === "enemies";
      return '' +
        '<div class="sprite-tile" id="panel-' + c.id + '">' +
          '<span class="tile-down" id="downtag-' + c.id + '" style="display:none;">DOWN</span>' +
          '<canvas class="sprite-canvas' + (isEnemy ? "" : " flip") + '" ' +
            'id="sprite-' + c.id + '" width="' + spriteSize.w + '" ' +
            'height="' + spriteSize.h + '"></canvas>' +
          (isEnemy ?
            '<div class="tile-name">' + c.name + '</div>' +
            // Notable units (elite/boss) show their role/title under the name so
            // set-pieces like the Warden read clearly on the battlefield.
            ((c.tier === "elite" || c.tier === "boss")
              ? '<div class="tile-sub">' + c.subtitle + '</div>' : '') +
            '<div class="tile-hp"><span class="tile-hp-fill" id="hp-bar-' + c.id + '"></span></div>'
            : '') +
          '<div class="tile-status" id="status-' + c.id + '"></div>' +
        '</div>';
    }

    // One compact row in the bottom party-status window (FF1 style): name +
    // class/Lv, then thin HP / EN / Limit bars with small numbers. This is what
    // replaced the tall per-hero battlefield card — the fix for "the hero
    // column is too tall."
    function pstatRowHtml(h) {
      const hasEn = h.stats.maxEn > 0;
      return '' +
        '<div class="pstat-row" id="pstat-' + h.id + '">' +
          '<div class="pstat-head">' +
            '<span class="pstat-name">' + h.name + '</span>' +
            '<span class="pstat-sub" id="sub-' + h.id + '">' + h.subtitle + '</span>' +
          '</div>' +
          '<div class="pstat-line">' +
            '<span class="pstat-tag">HP</span>' +
            '<span class="pstat-track"><span class="pstat-fill hp" id="hp-bar-' + h.id + '"></span></span>' +
            '<span class="pstat-num" id="hp-text-' + h.id + '"></span>' +
          '</div>' +
          (hasEn ?
            '<div class="pstat-line">' +
              '<span class="pstat-tag">EN</span>' +
              '<span class="pstat-track"><span class="pstat-fill en" id="en-bar-' + h.id + '"></span></span>' +
              '<span class="pstat-num" id="en-text-' + h.id + '"></span>' +
            '</div>'
            : '') +
          '<div class="pstat-line">' +
            '<span class="pstat-tag limit">✦</span>' +
            '<span class="pstat-track thin"><span class="pstat-fill limit" id="limit-bar-' + h.id + '"></span></span>' +
            '<span class="pstat-num" id="limit-text-' + h.id + '"></span>' +
          '</div>' +
        '</div>';
    }

    function renderCombatants() {
      // Skin the battlefield with the current NODE's region backdrop if it
      // sets one (§5.4c, Dungeon 6 — lets one dungeon visually transition
      // through zones as you descend, e.g. burnt city -> frozen wastes ->
      // the Core), falling back to the dungeon-wide region (every dungeon
      // before D6, unaffected) and finally "station" if neither is set.
      const dungeon = DUNGEONS[currentDungeonKey];
      const node = dungeon && currentNodeId ? dungeon.nodes[currentNodeId] : null;
      const region = (node && node.region) || (dungeon && dungeon.region) || "station";
      document.getElementById("battlefield").className = "region-" + region;

      document.getElementById("enemies").innerHTML = enemies.map(tileHtml).join("");
      document.getElementById("party").innerHTML = party.map(tileHtml).join("");
      document.getElementById("party-status").innerHTML = party.map(pstatRowHtml).join("");
      redrawAllSprites();
      startSpriteAnimation();
    }

    function updateScreen() {
      // Elements are spread across the battlefield tile and the party-status
      // row now, so every lookup is null-guarded (a hero's HP bar lives in the
      // status window; an enemy has no EN/Limit/status-row; etc.).
      function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
      function setWidth(id, pct) { const el = document.getElementById(id); if (el) el.style.width = pct + "%"; }

      allCombatants().forEach(function (c) {
        setText("hp-text-" + c.id, c.stats.hp + " / " + c.stats.maxHp);
        setWidth("hp-bar-" + c.id, c.stats.hp / c.stats.maxHp * 100);

        if (c.stats.maxEn > 0) {
          setText("en-text-" + c.id, c.stats.en + " / " + c.stats.maxEn);
          setWidth("en-bar-" + c.id, c.stats.en / c.stats.maxEn * 100);
        }

        if (c.side === "heroes") {
          setText("limit-text-" + c.id, Math.floor(c.limit) + "%");
          setWidth("limit-bar-" + c.id, clamp(c.limit, 0, 100));
          setText("sub-" + c.id, c.subtitle);   // class · Lv N, live on level-up
        }

        const down = !isAlive(c);
        const active = activeCombatant !== null && c.id === activeCombatant.id && !down;

        const tile = document.getElementById("panel-" + c.id);
        if (tile) { tile.classList.toggle("down", down); tile.classList.toggle("active", active); }
        const row = document.getElementById("pstat-" + c.id);   // heroes only
        if (row) { row.classList.toggle("down", down); row.classList.toggle("active", active); }
        const dtag = document.getElementById("downtag-" + c.id);
        if (dtag) dtag.style.display = down ? "block" : "none";

        // Status-effect pips (e.g. "BURN 3", "ATK↓ 2") on the battlefield tile.
        const statusEl = document.getElementById("status-" + c.id);
        if (statusEl) {
          statusEl.innerHTML = c.effects.map(function (e) {
            return '<span class="pip pip-' + e.type + '">' +
                   STATUSES[e.type].pip + " " + e.duration + '</span>';
          }).join("");
        }
      });
    }

    // `flag` may be: true (→ "important" green), or a class string
    // ("super" / "resist"), or omitted for a normal line.
    function log(text, flag) {
      const line = document.createElement("p");
      let cls = "log-line";
      if (flag === true) cls += " important";
      else if (typeof flag === "string") cls += " " + flag;
      line.className = cls;
      line.textContent = text;
      const box = document.getElementById("log");
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    }

    function setBanner(text) {
      document.getElementById("turn-banner").textContent = text;
    }
    function clearActions() {
      document.getElementById("actions").innerHTML = "";
    }

    function renderActions(hero) {
      const bar = document.getElementById("actions");
      bar.innerHTML = "";

      hero.skills.forEach(function (skillKey) {
        const skill = SKILLS[skillKey];
        // Label shows the damage type (so players can reason about weaknesses)
        // and the EN cost, e.g. "EMP Blast · Shock (12 EN)".
        let label = skill.name;
        if (skill.kind === "attack" && skill.damageType) {
          label += " · " + capitalize(skill.damageType);
        }
        if (skill.enCost > 0) label += " (" + skill.enCost + " EN)";

        const btn = document.createElement("button");
        btn.textContent = label;
        btn.disabled = hero.stats.en < skill.enCost;
        btn.onclick = function () { chooseSkill(skillKey); };
        bar.appendChild(btn);
      });

      // Limit Break button: shows charge progress, only clickable at 100%.
      const lbSkillKey = CLASSES[hero.classKey].limitBreak;
      const lbSkill = SKILLS[lbSkillKey];
      const lbBtn = document.createElement("button");
      lbBtn.className = "limit-btn";
      lbBtn.textContent = hero.limit >= 100
        ? "LIMIT BREAK: " + lbSkill.name
        : "Limit · " + lbSkill.name + " (" + Math.floor(hero.limit) + "%)";
      lbBtn.disabled = hero.limit < 100;
      lbBtn.onclick = chooseLimitBreak;
      bar.appendChild(lbBtn);

      const itemBtn = document.createElement("button");
      const stimCount = partyItems.stim || 0;
      itemBtn.textContent = "Item · Stim ×" + stimCount;
      itemBtn.disabled = stimCount <= 0;
      itemBtn.onclick = function () { chooseItem("stim"); };
      bar.appendChild(itemBtn);

      // The Broodmarshal fight only (Site Erebus, §5.3): a one-time
      // interactable, the annex's dead console. Reuses the SAME `reinforced`
      // flag the HP-threshold add-spawn checks (applyToTarget) — jamming it
      // early marks the boss as already-reinforced, so the natural trigger
      // never fires; the button just disappears once either happens. Costs
      // the whole turn, like any other completed action.
      const broodmarshal = enemies.find(function (e) { return e.typeKey === "broodmarshal"; });
      if (broodmarshal && !broodmarshal.reinforced) {
        const jamBtn = document.createElement("button");
        jamBtn.className = "cancel";
        jamBtn.textContent = "Jam the Relay (annex console)";
        jamBtn.onclick = function () {
          broodmarshal.reinforced = true;
          log(hero.name + " overrides the annex console. The relay dies — whatever the " +
              "Broodmarshal was about to call, it isn't coming.", true);
          finishHeroAction();
        };
        bar.appendChild(jamBtn);
      }

      const runBtn = document.createElement("button");
      runBtn.textContent = "Run";
      runBtn.onclick = onRun;
      bar.appendChild(runBtn);
    }


