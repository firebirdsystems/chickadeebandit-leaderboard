/**
 * The event cursor's two writers, and which one each recovery path uses.
 *
 * The cursor is (epoch, sequence) in one member_writable row, so its value is
 * attacker-reachable: any member can store an epoch larger than anything the
 * hub will ever report. Everything below exists so that a cursor which has
 * become meaningless — poisoned, or renumbered under a household by a rowid
 * reuse — is written back rather than defended by a guard that compares
 * against the very value being discarded.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "../src/index.html"), "utf-8");

/** The body of a named async function, up to its closing brace at column 0. */
function fn(name) {
  const start = SRC.indexOf(`async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n}", start);
  return SRC.slice(start, end);
}

describe("event cursor writers", () => {
  it("writeEventCursor keeps both halves of the (epoch, sequence) guard", () => {
    // The guard is what stops a stale tab in an OLD generation from restoring
    // a position that no longer exists.
    const body = fn("writeEventCursor");
    expect(body).toMatch(/excluded\.epoch > app_leaderboard__lb_sync\.epoch/);
    expect(body).toMatch(/excluded\.value > app_leaderboard__lb_sync\.value/);
  });

  it("resetEventCursor writes unconditionally", () => {
    // No WHERE on the DO UPDATE arm: this is the escape hatch, and a guard on
    // it would defeat the only thing it is for.
    const body = fn("resetEventCursor");
    expect(body).toMatch(/ON CONFLICT \(key\) DO UPDATE SET value = 0, epoch = excluded\.epoch/);
    expect(body).not.toMatch(/\bWHERE\b/);
  });

  it("the epoch-mismatch branch forces the write instead of guarding it", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. A different epoch means the stored
    // cursor is meaningless, so it can never be "ahead" of what we write — and
    // the guarded write loses outright whenever the stored epoch is the larger
    // number. Since lb_sync is member_writable, a member can make it larger
    // than any epoch the hub will report; every later pass then re-reads the
    // poisoned row, fails to correct it, and continues into the same state.
    // Ingestion stalls for the whole household until the row is repaired by
    // hand. Forcing the write makes the next pass self-heal.
    const branch = SRC.slice(SRC.indexOf("if (epoch !== storedEpoch"));
    const body = branch.slice(0, branch.indexOf("continue;"));
    expect(body).toMatch(/await resetEventCursor\(epoch\)/);
    expect(body, "the guarded write cannot correct a cursor it compares against")
      .not.toMatch(/await writeEventCursor\(/);
  });

  it("the rowid-reuse detector also forces the write", () => {
    // Same argument from the other direction: a page at or below the sequence
    // we asked past is evidence the stored position no longer exists, and the
    // guard would refuse the lower sequence that corrects it.
    const branch = SRC.slice(SRC.indexOf("if (afterSequence > 0 && lowest <= afterSequence) {"));
    expect(branch.slice(0, branch.indexOf("handled = 0;"))).toMatch(/await resetEventCursor\(epoch\)/);
  });

  it("only a non-negative safe integer counts as a usable cursor", () => {
    // Extracted and run, not just matched: the predicate is the whole defence
    // and `Number(x) || 0` — what it replaced — passes -1, 1e300 and 1.5.
    const src = SRC.slice(SRC.indexOf("function usableCursorNumber("));
    const body = src.slice(0, src.indexOf("\n}") + 2);
    const usable = new Function(`${body}; return usableCursorNumber;`)();

    for (const good of [0, 1, 42, Number.MAX_SAFE_INTEGER, "7"]) {
      expect(usable(good), `${good} is a real position`).toBe(Number(good));
    }
    for (const bad of [-1, "-1", 1.5, 1e300, Infinity, -Infinity, NaN, "abc", null, undefined, ""]) {
      // -1 is the sharp one: the hub answers a negative after_sequence with a
      // 400, and the fetch returns on any non-2xx before the epoch header is
      // read — so both reset paths sit behind the early return.
      expect(usable(bad), `${String(bad)} must not be sent as after_sequence`).toBeNull();
    }
  });

  it("an unusable cursor takes the forced-reset branch", () => {
    // Reading it as 0 is not on its own enough: the guarded write compares
    // against the STORED value, so a poisoned 1e300 refuses every advance and
    // the app re-reads the whole backlog from the floor on every launch.
    expect(SRC).toMatch(/usable: cursorUsable \} = await readEventCursor\(\)/);
    expect(SRC).toMatch(/if \(epoch !== storedEpoch \|\| !cursorUsable\) \{/);
  });

  it("a missing row and a failed read are not treated as damage", () => {
    // First run has no row, and a read that threw says nothing about the row's
    // contents — neither should trigger a repair write.
    const body = fn("readEventCursor");
    expect(body).toMatch(/if \(!rows\?\.\[0\]\) return \{ sequence: 0, epoch: 0, usable: true \}/);
    expect(body).toMatch(/catch \{ return \{ sequence: 0, epoch: 0, usable: true \}; \}/);
  });

  it("both forced writes pass a real epoch, never zero", () => {
    // A zero epoch reads as a mismatch on the next launch and resets again,
    // every launch, forever.
    for (const m of SRC.matchAll(/resetEventCursor\(([^)]*)\)/g)) {
      if (m[0].includes("async function")) continue;
      expect(m[1].trim(), "resetEventCursor(0) would loop forever").toMatch(/^epoch$/);
    }
  });
});
