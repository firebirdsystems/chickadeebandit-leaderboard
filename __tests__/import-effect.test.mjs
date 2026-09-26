/**
 * The write effects on lb_matches, run for real against this app's migrations.
 *
 * Imported games reach the leaderboard as ONE match insert from the hub's
 * automation lane, carrying the roster in import_results_json (ranked) or
 * import_winner_id / import_loser_id (1v1). "expand_participants" turns that
 * into lb_participants rows, and the two folds then score them — all three in
 * the insert's transaction, in declaration order. Nothing else checks that the
 * expansion reproduces the ranked mapping the browser used to apply (lowest
 * rank = team 0 'win', everyone else = team 1 'loss'), or that it stays inert
 * on a match logged by hand; a mistake in either moves ratings, which no later
 * match can correct.
 *
 * The effects run here in declaration order with `:new.<col>` bound to the
 * inserted row, which is what the hub does. SQLite's json1 and math functions
 * are built into node:sqlite as they are into D1.
 */
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf-8"));
const EFFECTS = manifest.write_effects.lb_matches.insert;
const MIGRATIONS = readdirSync(join(ROOT, "migrations")).filter(f => f.endsWith(".sql")).sort()
  .map(f => readFileSync(join(ROOT, "migrations", f), "utf-8"));

/** The hub's splitter: `--` comments are skipped, so a `;` inside one is not a break. */
function splitStatements(sql) {
  const out = [];
  let start = 0, i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < sql.length && sql[i] !== q) i++; i++; continue; }
    if (c === ";") { out.push(sql.slice(start, i)); i++; start = i; continue; }
    i++;
  }
  out.push(sql.slice(start));
  return out.filter(s => s.split("\n").some(l => l.trim() && !l.trim().startsWith("--")));
}

let db;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const sql of MIGRATIONS) for (const statement of splitStatements(sql)) db.exec(statement);
  db.prepare(`INSERT INTO app_leaderboard__lb_categories (id, name, icon, game_type, created_at, created_by)
              VALUES ('cat', 'Quiet Time', '', 'ranked', '2026-09-26', '')`).run();
});

/** Insert one match row and run every declared effect for it, as the hub does. */
function insertMatch(row) {
  const full = {
    id: row.id, category_id: row.category_id ?? "cat", played_at: "2026-09-26T00:00:00.000Z",
    notes: null, source_event_id: row.source_event_id ?? null, source_event_seq: 0, logged_by: "",
    visibility: "everyone", import_results_json: row.import_results_json ?? null,
    import_winner_id: row.import_winner_id ?? null, import_loser_id: row.import_loser_id ?? null,
  };
  db.exec("BEGIN");
  try {
    const cols = Object.keys(full);
    db.prepare(`INSERT INTO app_leaderboard__lb_matches (${cols.join(", ")}) VALUES (${cols.map(c => `:${c}`).join(", ")})`).run(full);
    for (const effect of EFFECTS) {
      const sql = effect.statement.replace(/:new\.([a-z_]+)/g, ":new_$1");
      const names = [...new Set([...sql.matchAll(/:new_([a-z_]+)/g)].map(m => m[1]))];
      db.prepare(sql).run(Object.fromEntries(names.map(n => [`new_${n}`, full[n]])));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const participants = (matchId) => db.prepare(
  `SELECT member_id, team, result FROM app_leaderboard__lb_participants WHERE match_id = ? ORDER BY team, member_id`,
).all(matchId).map(r => ({ ...r }));
const ratings = (category = "cat") => Object.fromEntries(db.prepare(
  `SELECT member_id, rating, games_played, wins, losses FROM app_leaderboard__lb_ratings WHERE category_id = ? ORDER BY member_id`,
).all(category).map(r => [r.member_id, { rating: r.rating, games_played: r.games_played, wins: r.wins, losses: r.losses }]));

describe("write_effects on lb_matches — declaration order", () => {
  it("expands the roster before either fold reads it", () => {
    expect(EFFECTS.map(e => e.label)).toEqual(["expand_participants", "fold_participant_ratings", "fold_ratings"]);
  });
});

describe("expand_participants — an imported ranked game", () => {
  it("makes the lowest rank team 0 'win' and everyone else team 1 'loss', whatever the array order", () => {
    insertMatch({
      id: "m-ranked", source_event_id: "ev-1",
      import_results_json: JSON.stringify([
        { member_id: "b", rank: 2, avg_db: 41.5 },
        { member_id: "c", rank: 3 },
        { member_id: "a", rank: 1 },
      ]),
    });
    expect(participants("m-ranked")).toEqual([
      { member_id: "a", team: 0, result: "win" },
      { member_id: "b", team: 1, result: "loss" },
      { member_id: "c", team: 1, result: "loss" },
    ]);
  });

  it("folds the same ratings as the same match written by hand", () => {
    // The browser used to write this exact shape itself; the ratings an
    // imported game produces must not depend on which path recorded it.
    insertMatch({
      id: "m-import", source_event_id: "ev-1",
      import_results_json: JSON.stringify([{ member_id: "a", rank: 1 }, { member_id: "b", rank: 2 }, { member_id: "c", rank: 3 }]),
    });
    db.prepare(`INSERT INTO app_leaderboard__lb_categories (id, name, icon, game_type, created_at, created_by)
                VALUES ('cat-hand', 'By hand', '', 'ranked', '2026-09-26', '')`).run();
    const add = db.prepare(`INSERT INTO app_leaderboard__lb_participants (id, match_id, member_id, team, result, rating_before, rating_after)
                            VALUES (?, 'm-hand', ?, ?, ?, 0, 0)`);
    add.run("p1", "a", 0, "win"); add.run("p2", "b", 1, "loss"); add.run("p3", "c", 1, "loss");
    insertMatch({ id: "m-hand", category_id: "cat-hand" });
    expect(ratings("cat")).toEqual(ratings("cat-hand"));
    expect(ratings("cat").a.rating).toBeGreaterThan(1000);
    expect(ratings("cat").b.rating).toBeLessThan(1000);
  });
});

describe("expand_participants — an imported 1v1 game", () => {
  it("writes the winner and the loser, and folds them", () => {
    insertMatch({ id: "m-1v1", source_event_id: "ev-2", import_winner_id: "a", import_loser_id: "b" });
    expect(participants("m-1v1")).toEqual([
      { member_id: "a", team: 0, result: "win" },
      { member_id: "b", team: 1, result: "loss" },
    ]);
    expect(ratings()).toEqual({
      a: { rating: 1016, games_played: 1, wins: 1, losses: 0 },
      b: { rating: 984, games_played: 1, wins: 0, losses: 1 },
    });
  });

  it("fails the whole insert when the loser is missing, rather than scoring half a game", () => {
    expect(() => insertMatch({ id: "m-half", source_event_id: "ev-3", import_winner_id: "a" })).toThrow();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM app_leaderboard__lb_matches`).get().n).toBe(0);
  });

  it("fails the whole insert when the winner is also the loser, instead of scoring them twice", () => {
    // The hub checks each member param on its own, so only this index stops a
    // household rule that maps one field to both.
    expect(() => insertMatch({ id: "m-self", source_event_id: "ev-5", import_winner_id: "a", import_loser_id: "a" }))
      .toThrow(/UNIQUE/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM app_leaderboard__lb_ratings`).get().n).toBe(0);
  });
});

describe("expand_participants — a ranked roster of one", () => {
  it("adds nobody: a lone player has no one to beat, and would gain rating from nothing", () => {
    // The trigger's catalog schema requires two results, but a household rule
    // can map any field, and the hub's items gate has no length floor.
    insertMatch({ id: "m-solo", source_event_id: "ev-6", import_results_json: JSON.stringify([{ member_id: "a", rank: 1 }]) });
    expect(participants("m-solo")).toEqual([]);
    expect(ratings()).toEqual({});
  });
});

describe("expand_participants — a match logged by hand", () => {
  it("adds nothing: the client already wrote the participants", () => {
    const add = db.prepare(`INSERT INTO app_leaderboard__lb_participants (id, match_id, member_id, team, result, rating_before, rating_after)
                            VALUES (?, 'm-hand', ?, ?, ?, 0, 0)`);
    add.run("p1", "a", 0, "win"); add.run("p2", "b", 1, "loss");
    insertMatch({ id: "m-hand" });
    expect(participants("m-hand")).toHaveLength(2);
    expect(ratings().a.rating).toBe(1016);
  });
});

describe("expand_participants — a roster naming someone twice", () => {
  it("fails the whole insert on the (match_id, member_id) index instead of scoring them twice", () => {
    expect(() => insertMatch({
      id: "m-dup", source_event_id: "ev-4",
      import_results_json: JSON.stringify([{ member_id: "a", rank: 1 }, { member_id: "a", rank: 2 }]),
    })).toThrow(/UNIQUE/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM app_leaderboard__lb_ratings`).get().n).toBe(0);
  });
});
