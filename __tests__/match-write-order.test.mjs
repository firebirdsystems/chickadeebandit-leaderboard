/**
 * The batch order that the rating fold depends on, asserted against the source
 * that has to keep it.
 *
 * "fold_participant_ratings" and "fold_ratings" read
 * `lb_participants WHERE match_id = :new.id`, and they run when the MATCH row
 * lands. A batch that writes the match row before its participants therefore
 * folds an empty roster: no error, no warning, a match on the board that moved
 * nobody's rating. Comments at both writers say so, and a comment is not a
 * check — this file is.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "../src/index.html"), "utf-8");

const MATCH_INSERT = "INSERT INTO app_leaderboard__lb_matches";
const PARTICIPANT_INSERT = "INSERT INTO app_leaderboard__lb_participants";

/** Each place that builds a match batch: from the builder to the send. */
function batchBuilders() {
  const out = [];
  const re = /const statements = participantStatements\(/g;
  for (const m of SRC.matchAll(re)) {
    const end = SRC.indexOf("await dbBatchOnce(", m.index);
    expect(end, "a batch builder that never reaches dbBatchOnce").toBeGreaterThan(m.index);
    out.push(SRC.slice(m.index, end));
  }
  return out;
}

describe("a match batch puts its participants before the match row", () => {
  it("has exactly the two writers this app is known to have", () => {
    // writeMatch (imported game.completed events) and submitMatch (the form).
    // A third would need the same order and should fail here until it is read.
    expect(batchBuilders().length).toBe(2);
    expect(SRC.split(MATCH_INSERT).length - 1).toBe(2);
  });

  it("seeds every batch from participantStatements(), never the match row", () => {
    // The participant rows are the batch's FIRST elements because the builder
    // starts as their array. Anything that instead started from the match row
    // and appended participants would fold an empty roster.
    for (const block of batchBuilders()) {
      const match = block.indexOf(MATCH_INSERT);
      expect(match, "builder does not write a match row at all").toBeGreaterThan(-1);
      expect(block.slice(0, match)).not.toContain(PARTICIPANT_INSERT);
    }
  });

  it("never puts a statement in front of the participants after the fact", () => {
    // unshift/splice would move the match row ahead of the participants while
    // leaving the source reading top-to-bottom in the right order.
    for (const block of batchBuilders()) {
      expect(block).not.toMatch(/statements\.(unshift|splice|reverse|sort)\b/);
    }
  });

  it("builds participant rows and nothing else in participantStatements()", () => {
    const start = SRC.indexOf("function participantStatements(");
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, SRC.indexOf("\n}", start));
    expect(body).toContain(PARTICIPANT_INSERT);
    expect(body).not.toContain(MATCH_INSERT);
    // The zeroes the effect overwrites — see zero_client_supplied_ratings.
    expect(body).toMatch(/rating_before, rating_after\)\s*\n?\s*VALUES \(\?, \?, \?, \?, \?, 0, 0\)/);
  });

  it("refuses an oversized batch rather than splitting it", () => {
    // A split commits participants in one transaction and the match row that
    // scores them in another. source_event_id is unique, so the retry reads as
    // "already imported" and the half-written match is never repaired.
    expect(SRC).toContain("async function dbBatchOnce(statements)");
    expect(SRC).not.toMatch(/\bdbBatchAll\b/);
  });
});
