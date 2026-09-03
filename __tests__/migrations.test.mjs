/**
 * Limits the hub enforces at admission, checked here so they fail on `make
 * test` rather than on a release — an app push IS a release, and a migration
 * the hub refuses takes the whole publish with it.
 *
 * 007 was written over the 8000-character limit twice while the fold in it was
 * being worked out, and nothing local said so.
 */
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "../migrations");
const FILES = readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
const sqlOf = (file) => readFileSync(join(DIR, file), "utf-8");
/**
 * Comments out. Every pattern below has to be asked of the CODE: these files
 * explain themselves at length, and the header of 007 contains the words
 * "CREATE UNIQUE INDEX" — enough to make a scan of the raw text answer that the
 * index is the file's first statement.
 */
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");

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

describe("migrations — the hub's admission limits", () => {
  it("keeps every file within the 8000-character cap", () => {
    for (const file of FILES) {
      // Measured the way the hub measures it: JS string length, so an em-dash
      // costs one, not the three bytes `wc -c` reports.
      expect(sqlOf(file).length, `${file} exceeds the per-migration cap`).toBeLessThanOrEqual(8000);
    }
  });

  it("stays under the 200-statement ceiling for the bundle", () => {
    const total = FILES.reduce((sum, f) => sum + splitStatements(sqlOf(f)).length, 0);
    expect(total).toBeLessThanOrEqual(200);
  });

  it("makes every creating statement idempotent", () => {
    // Migrations run with no enclosing transaction and the version is recorded
    // only after the last statement, so a partial failure replays the file from
    // the top. Without IF NOT EXISTS that replay fails forever.
    for (const file of FILES) {
      for (const statement of splitStatements(sqlOf(file))) {
        if (/^\s*create\s+(unique\s+)?(table|index)\b/im.test(code(statement))) {
          expect(statement, `${file}: creating statement must use IF NOT EXISTS`).toMatch(/if\s+not\s+exists/i);
        }
      }
    }
  });
});

describe("007 — the duplicate-category fold", () => {
  const sql = sqlOf("007_category_identity.sql");
  const statements = splitStatements(sql).map(code);

  it("folds before it constrains", () => {
    // CREATE UNIQUE INDEX against a household that already holds duplicates
    // fails every time, forever: the version is never recorded, so the app is
    // stuck on its previous version with no operator action available. The fold
    // is what makes the constraint reachable, so it has to come first.
    const index = statements.findIndex(s => /create\s+unique\s+index/i.test(s));
    expect(index, "the unique index must be the last statement").toBe(statements.length - 1);
    expect(index).toBeGreaterThan(0);
  });

  it("replays the merged rating from the participant rows", () => {
    // Keeping one half's rating and deleting the other's row throws that half's
    // movement away while the counter beside it counts both halves. Each
    // participant row carries the before and after of its own match, so the
    // differences are the movement the member actually earned.
    expect(code(sql)).toMatch(/SUM\(p\.rating_after - p\.rating_before\)/);
    expect(code(sql)).not.toMatch(/ORDER BY x\.games_played DESC/);
  });

  it("recounts the merged totals instead of adding them", () => {
    // A sum that includes the survivor's own row is not replayable: once it
    // holds the total, a replay adds the duplicates again. The counters are
    // therefore recounted from the participant rows, which this file never
    // writes. If this assertion is ever relaxed, the replay-safety argument in
    // the file's header goes with it.
    expect(code(sql)).toMatch(/games_played = \(SELECT COUNT\(\*\)/);
    expect(code(sql)).not.toMatch(/games_played = games_played \+/);
    expect(code(sql)).not.toMatch(/SUM\(x\.games_played\)/);
  });
});

describe("008 — the recompute the fold assumes", () => {
  const sql = sqlOf("008_server_side_elo_backfill.sql");

  it("derives every column from the participant rows", () => {
    // The same replay-safety argument as 007, for the same reason: a migration
    // file replays from the top after a partial failure, and this one has no
    // guard clause of its own. Every value it writes is read out of
    // lb_participants, so running it twice lands on the numbers running it
    // once did. An accumulating form would inflate every rating in the
    // household a little more on each retry, permanently.
    expect(code(sql)).toMatch(/SUM\(p\.rating_after - p\.rating_before\)/);
    expect(code(sql)).toMatch(/games_played = \(SELECT COUNT\(\*\)/);
    expect(code(sql)).not.toMatch(/rating = rating \+/);
    expect(code(sql)).not.toMatch(/games_played = games_played \+/);
  });

  it("recomputes from history it has already deduplicated", () => {
    // Order is the whole point. The recompute counts participant rows, so it
    // has to run after the duplicates are gone or it counts them; and the
    // UNIQUE index has to be created after the DELETE or it fails against the
    // rows that violate it — permanently, since a failed migration is one the
    // app never gets past.
    const statements = splitStatements(sql).map(code).filter(s => s.trim());
    const at = (re) => statements.findIndex(s => re.test(s));
    const dedup = at(/^\s*DELETE FROM app_leaderboard__lb_participants/);
    const index = at(/^\s*CREATE UNIQUE INDEX/);
    const recompute = at(/^\s*UPDATE app_leaderboard__lb_ratings/);
    expect(dedup, "008 must deduplicate participants").toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(dedup);
    expect(recompute).toBeGreaterThan(index);
  });

  it("removes only participant rows that duplicate an earlier one", () => {
    // The history the recompute is derived from must otherwise survive
    // untouched, or the recompute stops being a recompute. The one row this
    // may drop is a second row for a member already listed in that match —
    // never a match, a category, or the first row of any pairing.
    const dedup = splitStatements(sql).map(code)
      .find(s => /^\s*DELETE FROM/.test(s.trim()));
    expect(dedup).toMatch(/q\.match_id = app_leaderboard__lb_participants\.match_id/);
    expect(dedup).toMatch(/q\.member_id = app_leaderboard__lb_participants\.member_id/);
    expect(dedup, "must keep the earliest row, not an arbitrary one")
      .toMatch(/q\.rowid < app_leaderboard__lb_participants\.rowid/);
  });

  it("writes nothing but lb_ratings and the participant dedup", () => {
    const allowed = /^\s*(UPDATE app_leaderboard__lb_ratings|DELETE FROM app_leaderboard__lb_participants|CREATE UNIQUE INDEX)/;
    for (const statement of splitStatements(sql).map(code)) {
      if (!statement.trim()) continue;
      expect(statement, "008 wrote a table it has no business writing").toMatch(allowed);
    }
  });
});

describe("009 — the table the freeze made necessary", () => {
  const sql = sqlOf("009_participant_ratings_table.sql");

  it("creates the table and its read index idempotently", () => {
    // Both must carry IF NOT EXISTS or a replay after a partial failure fails
    // forever and the app becomes permanently un-updatable.
    expect(code(sql)).toMatch(/CREATE TABLE IF NOT EXISTS app_leaderboard__lb_participant_ratings/);
    expect(code(sql)).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  it("backfills from the participant rows without accumulating on replay", () => {
    // The values are COPIED from the row each one describes, so a second run
    // writes what the first did; the conflict arm makes it a no-op rather than
    // a primary-key error.
    expect(code(sql)).toMatch(/SELECT p\.id, p\.match_id, p\.member_id, p\.rating_before, p\.rating_after/);
    expect(code(sql)).toMatch(/ON CONFLICT \(participant_id\) DO NOTHING/);
  });

  it("runs after 008, so it copies deduplicated history", () => {
    // 008 removes participant rows duplicating an (match_id, member_id) pair.
    // Backfilling first would carry a duplicate into the new table and leave it
    // there, since the conflict arm would then refuse to correct it.
    expect(FILES.indexOf("009_participant_ratings_table.sql"))
      .toBeGreaterThan(FILES.indexOf("008_server_side_elo_backfill.sql"));
  });

  it("never writes lb_participants or lb_ratings", () => {
    // It carries history across; it does not restate it. 008 owns the rating
    // repair and this file must not have a second opinion about it.
    for (const statement of splitStatements(sql).map(code)) {
      if (!statement.trim()) continue;
      expect(statement).not.toMatch(/^\s*(UPDATE|DELETE FROM) /);
      expect(statement).not.toMatch(/INSERT INTO app_leaderboard__lb_(participants|ratings)\b/);
    }
  });
});

describe("the build's own migration scan", () => {
  /**
   * build.mjs applies these to the RAW file — comments included — and exits
   * non-zero on a hit. Every other check in this file deliberately asks the
   * question of `code(sql)` instead, because these migrations explain
   * themselves at length and a header that quotes a statement it is describing
   * would trip a naive scan.
   *
   * That difference is exactly how a migration whose PROSE mentioned a
   * forbidden statement passed `npm test` and then failed `node build.mjs` —
   * the phrase was in a comment explaining why a column could not be removed.
   * The hub's own validateMigrationSql strips comments first, so the build is
   * the stricter of the two; it fails closed, which is the safe direction, and
   * the cost is that prose has to avoid the literal phrases. This test moves
   * that cost from the build to `npm test`, where it is cheap to notice.
   *
   * Kept in sync with build.mjs by hand: 119 app repos carry a copy of that
   * scanner, so it is not something this file can import.
   */
  const FORBIDDEN = [
    [/\bdrop\s+table\b/i, "DROP TABLE"],
    [/\bdrop\s+column\b/i, "DROP COLUMN"],
    [/\brename\s+column\b/i, "RENAME COLUMN"],
    [/\balter\s+table\b[^;]+\brename\s+to\b/i, "RENAME TABLE"],
    [/\btruncate\b/i, "TRUNCATE"],
  ];

  for (const file of FILES) {
    it(`${file} passes the raw scan the build runs`, () => {
      const raw = sqlOf(file);
      for (const [pattern, name] of FORBIDDEN) {
        expect(pattern.test(raw), `${file} contains "${name}" — in a comment, that still fails the build`).toBe(false);
      }
    });
  }
});
