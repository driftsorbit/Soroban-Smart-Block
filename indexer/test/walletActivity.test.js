import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIELDS_USED,
  isPublicAccountAddress,
  parseInterval,
  summarizeActivity,
  compareAccountActivity,
  extractCounterparties,
  summarizeCounterparties,
  parseSummaryLimit,
  parseWorkspaceAddresses,
  buildWorkspaceSummary,
} from "../src/walletActivity.js";

const ACCOUNT_A = "G" + "A".repeat(55);
const ACCOUNT_B = "G" + "B".repeat(55);

const event = (contract_id, fn, ledger) => ({ contract_id, function: fn, ledger, created_at: "2026-01-01" });

describe("isPublicAccountAddress", () => {
  it("accepts a G-prefixed 56-character base32 key", () => {
    assert.equal(isPublicAccountAddress(ACCOUNT_A), true);
  });

  it("rejects contract (C), malformed, and non-string values", () => {
    assert.equal(isPublicAccountAddress("C" + "A".repeat(55)), false);
    assert.equal(isPublicAccountAddress("GABC"), false);
    assert.equal(isPublicAccountAddress(undefined), false);
    assert.equal(isPublicAccountAddress(["G" + "A".repeat(55)]), false);
  });
});

describe("parseInterval", () => {
  it("returns nulls when no interval is given", () => {
    assert.deepEqual(parseInterval({}), { from: null, to: null });
  });

  it("passes through a valid YYYY-MM-DD range", () => {
    assert.deepEqual(parseInterval({ from: "2026-01-01", to: "2026-01-31" }), {
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("rejects malformed dates", () => {
    assert.throws(() => parseInterval({ from: "01/01/2026" }), RangeError);
    assert.throws(() => parseInterval({ to: "2026-13-45" }), RangeError);
  });

  it("rejects a from date after the to date", () => {
    assert.throws(() => parseInterval({ from: "2026-02-01", to: "2026-01-01" }), /on or before/);
  });
});

describe("summarizeActivity", () => {
  it("returns zeroed figures and null ledgers for an empty account", () => {
    assert.deepEqual(summarizeActivity([]), {
      event_count: 0,
      contract_count: 0,
      contract_ids: [],
      function_counts: {},
      first_ledger: null,
      last_ledger: null,
    });
  });

  it("counts events, distinct contracts, functions, and the ledger span", () => {
    const summary = summarizeActivity([
      event("CB", "transfer", 30),
      event("CA", "transfer", 10),
      event("CA", "mint", 20),
    ]);
    assert.equal(summary.event_count, 3);
    assert.equal(summary.contract_count, 2);
    assert.deepEqual(summary.contract_ids, ["CA", "CB"]);
    assert.deepEqual(summary.function_counts, { transfer: 2, mint: 1 });
    assert.equal(summary.first_ledger, 10);
    assert.equal(summary.last_ledger, 30);
  });

  it("coerces string ledger values from Postgres BIGINT columns", () => {
    const summary = summarizeActivity([event("CA", "transfer", "42")]);
    assert.equal(summary.first_ledger, 42);
    assert.equal(summary.last_ledger, 42);
  });
});

describe("compareAccountActivity", () => {
  it("lists shared contracts and discloses the fields used", () => {
    const result = compareAccountActivity(
      { address: ACCOUNT_A, events: [event("CA", "transfer", 1), event("CX", "swap", 2)] },
      { address: ACCOUNT_B, events: [event("CA", "mint", 5)] },
    );
    assert.equal(result.accounts[0].address, ACCOUNT_A);
    assert.equal(result.accounts[0].event_count, 2);
    assert.equal(result.accounts[1].address, ACCOUNT_B);
    assert.equal(result.accounts[1].event_count, 1);
    assert.deepEqual(result.shared_contract_ids, ["CA"]);
    assert.deepEqual(result.fields_used, FIELDS_USED);
  });

  it("returns no shared contracts when either account is empty", () => {
    const result = compareAccountActivity(
      { address: ACCOUNT_A, events: [] },
      { address: ACCOUNT_B, events: [event("CA", "mint", 5)] },
    );
    assert.deepEqual(result.shared_contract_ids, []);
    assert.equal(result.accounts[0].event_count, 0);
  });
});

const COUNTERPARTY_X = "G" + "X".repeat(55);
const COUNTERPARTY_Y = "C" + "Y".repeat(55);

const richEvent = (seq, contract_id, raw_topics, raw_data, tx_hash = `tx${seq}`) => ({
  seq,
  contract_id,
  function: "transfer",
  ledger: seq,
  tx_hash,
  raw_topics,
  raw_data,
});

describe("extractCounterparties", () => {
  it("finds addresses in topics and data but not the account itself", () => {
    const found = extractCounterparties(
      richEvent(1, "CA", [{ address: COUNTERPARTY_X }], `payee ${COUNTERPARTY_Y} from ${ACCOUNT_A}`),
      ACCOUNT_A,
    );
    assert.deepEqual(found.sort(), [COUNTERPARTY_X, COUNTERPARTY_Y].sort());
  });

  it("returns an empty list when the event carries no addresses", () => {
    assert.deepEqual(extractCounterparties(richEvent(1, "CA", null, null), ACCOUNT_A), []);
  });
});

describe("summarizeCounterparties", () => {
  it("returns empty lists for an account with no events", () => {
    assert.deepEqual(summarizeCounterparties([], ACCOUNT_A), { contracts: [], counterparties: [] });
  });

  it("ranks contracts and counterparties by count, then by id", () => {
    const events = [
      richEvent(1, "CB", null, COUNTERPARTY_X),
      richEvent(2, "CA", null, COUNTERPARTY_X),
      richEvent(3, "CA", null, COUNTERPARTY_Y),
    ];
    const summary = summarizeCounterparties(events, ACCOUNT_A);
    assert.deepEqual(
      summary.contracts.map((c) => [c.contract_id, c.count]),
      [["CA", 2], ["CB", 1]],
    );
    assert.deepEqual(
      summary.counterparties.map((c) => [c.address, c.count]),
      [[COUNTERPARTY_X, 2], [COUNTERPARTY_Y, 1]],
    );
  });

  it("gives each entry tx_hashes and event_seqs for drill-down", () => {
    const summary = summarizeCounterparties(
      [richEvent(7, "CA", null, COUNTERPARTY_X, "hashA"), richEvent(9, "CA", null, COUNTERPARTY_X, "hashB")],
      ACCOUNT_A,
    );
    assert.deepEqual(summary.contracts[0].tx_hashes, ["hashA", "hashB"]);
    assert.deepEqual(summary.contracts[0].event_seqs, [7, 9]);
    assert.deepEqual(summary.counterparties[0].event_seqs, [7, 9]);
  });

  it("caps drill-down ids at 10 per entry while still counting every event", () => {
    const events = Array.from({ length: 15 }, (_, i) => richEvent(i + 1, "CA", null, null, `h${i}`));
    const [contract] = summarizeCounterparties(events, ACCOUNT_A).contracts;
    assert.equal(contract.count, 15);
    assert.equal(contract.tx_hashes.length, 10);
    assert.equal(contract.event_seqs.length, 10);
  });

  it("honours the limit", () => {
    const events = [richEvent(1, "CA", null, null), richEvent(2, "CB", null, null)];
    assert.equal(summarizeCounterparties(events, ACCOUNT_A, { limit: 1 }).contracts.length, 1);
  });
});

describe("parseSummaryLimit", () => {
  it("defaults to 10 when absent", () => {
    assert.equal(parseSummaryLimit(undefined), 10);
  });

  it("accepts integers from 1 to 50", () => {
    assert.equal(parseSummaryLimit("1"), 1);
    assert.equal(parseSummaryLimit("50"), 50);
  });

  it("rejects zero, overflow, fractions, and non-numeric values", () => {
    for (const bad of ["0", "51", "2.5", "abc"]) {
      assert.throws(() => parseSummaryLimit(bad), RangeError);
    }
  });
});

const ACCOUNT_C = "G" + "C".repeat(55);

describe("parseWorkspaceAddresses", () => {
  it("returns a valid list of two to ten distinct public accounts", () => {
    assert.deepEqual(parseWorkspaceAddresses([ACCOUNT_A, ACCOUNT_B]), [ACCOUNT_A, ACCOUNT_B]);
  });

  it("rejects a non-array body", () => {
    assert.throws(() => parseWorkspaceAddresses(undefined), /must be an array/);
    assert.throws(() => parseWorkspaceAddresses(ACCOUNT_A), /must be an array/);
  });

  it("rejects fewer than two or more than ten accounts", () => {
    assert.throws(() => parseWorkspaceAddresses([ACCOUNT_A]), /between 2 and 10/);
    const eleven = Array.from({ length: 11 }, (_, i) => "G" + String.fromCharCode(65 + i).repeat(55));
    assert.throws(() => parseWorkspaceAddresses(eleven), /between 2 and 10/);
  });

  it("rejects malformed addresses and reports which ones", () => {
    assert.throws(() => parseWorkspaceAddresses([ACCOUNT_A, "CNOTANACCOUNT"]), /CNOTANACCOUNT/);
  });

  it("rejects duplicate addresses", () => {
    assert.throws(() => parseWorkspaceAddresses([ACCOUNT_A, ACCOUNT_A]), /distinct/);
  });
});

describe("buildWorkspaceSummary", () => {
  it("returns one entry per account with activity and counterparties", () => {
    const result = buildWorkspaceSummary([
      { address: ACCOUNT_A, events: [richEvent(1, "CA", null, COUNTERPARTY_X)] },
      { address: ACCOUNT_C, events: [] },
    ]);
    assert.deepEqual(
      result.accounts.map((account) => account.address),
      [ACCOUNT_A, ACCOUNT_C],
    );
    assert.equal(result.accounts[0].activity.event_count, 1);
    assert.equal(result.accounts[0].contracts[0].contract_id, "CA");
    assert.equal(result.accounts[0].counterparties[0].address, COUNTERPARTY_X);
    assert.equal(result.accounts[1].activity.event_count, 0);
    assert.deepEqual(result.accounts[1].contracts, []);
    assert.deepEqual(result.fields_used, FIELDS_USED);
  });
});
