import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("permissions.requires_approval is boolean", () => {
    expect(typeof manifest.permissions.requires_approval).toBe("boolean");
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });
});

// ── ai_access SQL file validation ─────────────────────────────────────────────
if (manifest.ai_access) {
  const ai = manifest.ai_access;

  const SQL_TYPES = [
    { field: "db_exports",   dir: "queries",   keyword: /^(SELECT|WITH)\b/i, label: "SELECT or WITH" },
    { field: "db_mutations", dir: "mutations",  keyword: /^UPDATE\b/i,        label: "UPDATE"         },
    { field: "db_inserts",   dir: "inserts",    keyword: /^INSERT\b/i,        label: "INSERT"         },
    { field: "db_deletes",   dir: "deletes",    keyword: /^DELETE\b/i,        label: "DELETE"         },
  ];

  for (const { field, dir, keyword, label } of SQL_TYPES) {
    const names = ai[field] ?? [];
    if (names.length === 0) continue;

    describe(`ai_access.${field}`, () => {
      it(`each name has a src/${dir}/{name}.sql file`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          expect(existsSync(path), `missing: src/${dir}/${name}.sql`).toBe(true);
        }
      });

      it(`each SQL file starts with ${label}`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          if (!existsSync(path)) continue;
          const sql = readFileSync(path, "utf-8").trim();
          expect(keyword.test(sql), `src/${dir}/${name}.sql must start with ${label}, got: ${sql.slice(0, 50)}`).toBe(true);
        }
      });

      it(`each SQL file is a single statement (no semicolons)`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          if (!existsSync(path)) continue;
          const sql = readFileSync(path, "utf-8");
          expect(sql.includes(";"), `src/${dir}/${name}.sql must not contain semicolons`).toBe(false);
        }
      });
    });
  }

  if (ai.db_inserts?.length) {
    describe("ai_access.db_inserts schemas", () => {
      it("each insert has a src/schemas/{name}.json file", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          expect(existsSync(path), `missing: src/schemas/${name}.json`).toBe(true);
        }
      });

      it("each schema file is valid JSON", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(path)) continue;
          expect(() => JSON.parse(readFileSync(path, "utf-8")), `src/schemas/${name}.json must be valid JSON`).not.toThrow();
        }
      });
    });
  }
}

// ── write_effects: the server-side Elo fold ───────────────────────────────────
//
// The rules asserted here are the ones whose breach is SILENT. A fold that
// reads no participants writes no ratings and raises nothing; an ACL quietly
// dropped from the manifest re-opens `rating = 9999` with every existing test
// still green. The hub validates the SQL at publish — an app push IS a release,
// so a refusal there is a failed release; these keep the app's own promises
// checkable on `make test`.
describe("write_effects — server-side Elo", () => {
  const effects = manifest.write_effects?.lb_matches?.insert ?? [];
  const byLabel = Object.fromEntries(effects.map(e => [e.label, e.statement]));

  it("settles a participant row the moment its match exists", () => {
    // The freeze is what makes a participant row evidence rather than a note
    // anyone may revise. It is declared against the PARENT: at insert time the
    // match does not exist yet (participants are written first), so the row
    // goes in; from the moment the match row lands, UPDATE and DELETE are
    // scoped to nothing and a late INSERT is refused outright.
    const frozen = manifest.row_policies?.lb_participants?.frozen_when;
    expect(frozen?.parent_table).toBe("lb_matches");
    expect(frozen?.fk_column).toBe("match_id");
    expect(frozen?.status_column).toBe("played_at");
    expect(frozen?.locked_when_not_null).toBe(true);
  });

  it("keeps the fold off lb_participants so the freeze is declarable at all", () => {
    // These cannot coexist: admission refuses any non-INSERT effect against a
    // table the manifest declares frozen, because the effect lane runs without
    // row policies and would walk past the freeze. The fold therefore writes
    // lb_participant_ratings instead of updating lb_participants — that is the
    // whole reason the second table exists.
    expect(manifest.write_effects?.lb_participants).toBeUndefined();
    for (const e of effects) {
      expect(e.statement, `${e.label} must not write lb_participants`)
        .not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM) app_leaderboard__lb_participants\b/);
    }
  });

  it("locks every column of the ratings table against clients, and freezes it", () => {
    const policy = manifest.row_policies?.lb_participant_ratings;
    for (const column of ["participant_id", "match_id", "member_id", "rating_before", "rating_after"]) {
      expect(policy?.column_write_acls?.[column]?.writable_by, `lb_participant_ratings.${column}`).toEqual([]);
      // No `actions`, so the lock covers INSERT as well as UPDATE: a client
      // never writes this table at all, only the effect lane does.
      expect(policy?.column_write_acls?.[column]?.actions).toBeUndefined();
    }
    // match_id is NOT NULL, so every row is frozen from the moment it exists.
    expect(policy?.frozen_when?.locked_when_not_null).toBe(true);
    expect(policy?.frozen_when?.status_column).toBe("match_id");
  });

  it("stays inside the hub's per-statement budget", () => {
    // MAX_WRITE_EFFECT_STATEMENT_CHARS. Over it the manifest is refused at
    // publish, which is a failed release rather than a failed test.
    for (const e of effects) {
      expect(e.statement.length, `${e.label} exceeds 2000 characters`).toBeLessThanOrEqual(2000);
    }
  });

  it("binds the triggering match by :new, never by a bare placeholder", () => {
    // Bare `?` is refused by the hub: effect params come only from the
    // triggering row's column list.
    for (const e of effects) {
      expect(e.statement.includes("?"), `${e.label} may not contain ? placeholders`).toBe(false);
      expect(e.statement, `${e.label} must bind the row that fired it`).toMatch(/:new\.id\b/);
    }
    // The category is the match's, so only the match folds can name it — a
    // participant row has no category_id column for :new to resolve against.
    for (const e of effects) {
      expect(e.statement).toMatch(/:new\.category_id\b/);
    }
  });

  it("scopes both folds to the triggering match's participants", () => {
    // The whole safety of the fold is that it touches ONE match. A statement
    // that lost this clause would rewrite every participant row in the
    // household with hub authority and no row policy in the way.
    for (const e of effects) {
      expect(e.statement, `${e.label} must be scoped to the match`)
        .toMatch(/match_id = :new\.id/);
    }
  });

  it("touches only this app's own tables", () => {
    for (const e of effects) {
      for (const table of e.statement.match(/\bapp_[a-z0-9_]+/g) ?? []) {
        expect(table.startsWith("app_leaderboard__"), `${e.label} references ${table}`).toBe(true);
      }
    }
  });

  it("scores cooperative games against the baseline, not against teammates", () => {
    // A cooperative result is every player vs. a notional 1000 — individually,
    // which is what the old calcMatchDeltas did. Team modes average the side.
    // The distinction is carried by the category's game_type, so losing this
    // reference silently rescores every co-op category as a one-sided team game.
    expect(byLabel.fold_participant_ratings).toMatch(/game_type FROM app_leaderboard__lb_categories/);
    expect(byLabel.fold_participant_ratings).toMatch(/'cooperative'/);
  });

  it("recomputes the counters instead of trusting what the client sent", () => {
    expect(byLabel.fold_ratings).toMatch(/ON CONFLICT \(member_id, category_id\) DO UPDATE/);
    expect(byLabel.fold_ratings).toMatch(/rating = excluded\.rating/);
  });
});

describe("row policies — the columns the fold owns", () => {
  // Effects exist to write what clients must not. Without the locks below the
  // fold is decoration: lb_ratings was member_writable, so any member could
  // write themselves rating = 9999, and no server-side computation changes that.
  const acl = (table, column) =>
    manifest.row_policies?.[table]?.column_write_acls?.[column];

  it("locks every rating column against client writes", () => {
    for (const column of ["rating", "games_played", "wins", "losses"]) {
      expect(acl("lb_ratings", column)?.writable_by, `lb_ratings.${column} must be client-immutable`).toEqual([]);
    }
  });

  it("locks every participant column against client UPDATE", () => {
    // A participant row is EVIDENCE: who played, on which side, and what
    // happened. The fold reads it once, when the match row lands, and never
    // looks again — so an UPDATE afterwards moves the history out from under a
    // rating that has already been computed, with nothing to recompute it.
    // Reassigning member_id is the sharpest form: the match keeps its
    // logged_by, so the altered result stays attributed to whoever recorded it.
    //
    // Every column is listed because an UPDATE has to SET at least one of
    // them; leaving a single column writable leaves the statement legal and
    // the row mutable. A new column added to lb_participants must be added
    // here too, which is what this test is really guarding.
    for (const column of ["id", "match_id", "member_id", "team", "result"]) {
      const cfg = acl("lb_participants", column);
      expect(cfg?.writable_by, `lb_participants.${column} must be UPDATE-locked`).toEqual([]);
      expect(cfg?.actions, `lb_participants.${column}`).toEqual(["update"]);
    }
  });

  it("leaves INSERT open on lb_participants, which is what the app needs", () => {
    // Locking these on INSERT too would be wrong twice over: the client is the
    // only thing that knows the roster, and `frozen_when` — the modifier that
    // would make the table append-only — cannot be used here at all, because
    // admission refuses any non-INSERT effect against a frozen table and
    // "fold_participant_ratings" is an UPDATE. So DELETE, and adding a player
    // to a match already folded, remain reachable by hand-written SQL. Neither
    // can move a rating: lb_ratings is locked outright and the fold does not
    // re-run. See README.
    for (const column of ["id", "match_id", "member_id", "team", "result", "rating_before", "rating_after"]) {
      expect(acl("lb_participants", column)?.actions).not.toContain("insert");
    }
  });

  it("locks participant ratings against client UPDATE", () => {
    // Only `update`. Both columns are NOT NULL with no default, so an INSERT
    // has to name them — the client sends zeroes and
    // fold_participant_ratings overwrites them in the same transaction.
    for (const column of ["rating_before", "rating_after"]) {
      const cfg = acl("lb_participants", column);
      expect(cfg?.writable_by, `lb_participants.${column}`).toEqual([]);
      expect(cfg?.actions, `lb_participants.${column}`).toEqual(["update"]);
    }
  });

  it("leaves lb_ratings writable enough for the effect to reach it", () => {
    // NOT endpoint_only: the hub refuses an effect whose target declares a flat
    // "app SQL may never write this" gate, because an effect IS app-authored
    // SQL. Column ACLs are the right instrument — the effect lane bypasses
    // those, and nothing else does.
    expect(manifest.row_policies.lb_ratings.kind).toBe("member_writable");
  });
});
