// Sprite-review data dump. Run concatenated AFTER data.js + state.js + ui.js
// (shared top-level script scope, same convention every sim harness in this
// project uses):
//   cat ../../data.js ../../state.js ../../ui.js dump_sprites.js | jsc
// Prints one JSON blob to stdout. This is the SOURCE OF TRUTH extraction —
// build.py never hand-copies sprite data, so the review doc can't drift from
// the live game (real scale constants included, not guessed).

function gridDims(shapeKey) {
  var rows = SPRITE_SHAPES[shapeKey];
  if (!rows) return null;
  return { w: rows[0].length, h: rows.length };
}

// How many roster entries draw each shape key — a shape used by exactly one
// entry reads as bespoke; used by 2+ reads as a shared/recolored family
// (fine for trash mobs by design, but flagged for bosses).
var shapeUsers = {};
Object.keys(SPRITES).forEach(function (key) {
  var shapeKey = SPRITES[key].shape;
  (shapeUsers[shapeKey] = shapeUsers[shapeKey] || []).push(key);
});

function buildEntry(key, kind, e) {
  var sprite = SPRITES[key];
  var entry = {
    key: key,
    kind: kind,                                  // "hero" | "enemy"
    name: kind === "hero" ? e.className : e.typeName,
    role: e.role || "",
    nature: e.nature || null,
    tier: kind === "enemy" ? e.tier : null
  };
  if (!sprite) {
    entry.status = "blob";
    entry.shapeKey = null;
    entry.dims = null;
    entry.sharedWith = [];
  } else {
    var users = shapeUsers[sprite.shape].filter(function (k) { return k !== key; });
    entry.status = users.length > 0 ? "shared" : "bespoke";
    entry.shapeKey = sprite.shape;
    entry.dims = gridDims(sprite.shape);
    entry.sharedWith = users;
    entry.palette = sprite.palette;
  }
  return entry;
}

var rosterDump = [];
Object.keys(CLASSES).forEach(function (key) {
  rosterDump.push(buildEntry(key, "hero", CLASSES[key]));
});
Object.keys(ENEMIES).forEach(function (key) {
  rosterDump.push(buildEntry(key, "enemy", ENEMIES[key]));
});

print(JSON.stringify({
  roster: rosterDump,
  spriteShapes: SPRITE_SHAPES,
  genericPalettes: GENERIC_PALETTES,
  scale: {
    base: SPRITE_SCALE,
    heroBattle: HERO_BATTLE_SCALE,
    byTier: TIER_SPRITE_SCALE,
    overrideByShape: SHAPE_SCALE_OVERRIDE
  }
}));
