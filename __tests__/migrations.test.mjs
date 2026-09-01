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
