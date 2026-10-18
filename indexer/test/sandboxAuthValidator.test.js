import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { xdr, StrKey } from "@stellar/stellar-sdk";
import {
  isValidContractId,
  isValidAccountId,
  validateAuthRequirements,
  deduceRequiredAuthorizations,
} from "../src/sandboxAuthValidator.js";

const VALID_CONTRACT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const ACCOUNT_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const ACCOUNT_B = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA";

/**
 * Helper to build a valid base64 SorobanAuthorizationEntry for an account
 */
function buildMockAuthEntry(accountAddr, contractId, fnName) {
  const accountRaw = StrKey.decodeEd25519PublicKey(accountAddr);
  const contractRaw = StrKey.decodeContract(contractId);

  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: xdr.ScAddress.scAddressTypeContract(contractRaw),
        functionName: fnName,
        args: [],
      }),
    ),
    subInvocations: [],
  });

  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: xdr.ScAddress.scAddressTypeAccount(xdr.AccountId.publicKeyTypeEd25519(accountRaw)),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100000,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });

  return entry.toXDR("base64");
}

describe("sandboxAuthValidator (#1093)", () => {
  describe("Address format validation", () => {
    it("validates contract IDs and account public keys", () => {
      assert.equal(isValidContractId(VALID_CONTRACT), true);
      assert.equal(isValidContractId("invalid-contract"), false);
      assert.equal(isValidContractId(ACCOUNT_A), false);

      assert.equal(isValidAccountId(ACCOUNT_A), true);
      assert.equal(isValidAccountId(ACCOUNT_B), true);
      assert.equal(isValidAccountId("G123"), false);
      assert.equal(isValidAccountId(VALID_CONTRACT), false);
    });
  });

  describe("Required authorization deduction", () => {
    it("deduces that read-only functions require no authorization", () => {
      assert.equal(deduceRequiredAuthorizations(VALID_CONTRACT, "balance", [ACCOUNT_A]).length, 0);
      assert.equal(deduceRequiredAuthorizations(VALID_CONTRACT, "name", []).length, 0);
      assert.equal(deduceRequiredAuthorizations(VALID_CONTRACT, "decimals", []).length, 0);
      assert.equal(deduceRequiredAuthorizations(VALID_CONTRACT, "get_total_supply", []).length, 0);
      assert.equal(deduceRequiredAuthorizations(VALID_CONTRACT, "is_paused", []).length, 0);
    });

    it("deduces token transfer requires authorization from sender 'from'", () => {
      const reqs = deduceRequiredAuthorizations(VALID_CONTRACT, "transfer", [ACCOUNT_A, ACCOUNT_B, 100]);
      assert.equal(reqs.length, 1);
      assert.equal(reqs[0].signer, ACCOUNT_A);
      assert.equal(reqs[0].scope, `${VALID_CONTRACT}:transfer`);
      assert.ok(reqs[0].reason.includes("must authorize token transfer"));
    });

    it("deduces token approve requires owner authorization", () => {
      const reqs = deduceRequiredAuthorizations(VALID_CONTRACT, "approve", [ACCOUNT_A, ACCOUNT_B, 500, 10000]);
      assert.equal(reqs.length, 1);
      assert.equal(reqs[0].signer, ACCOUNT_A);
    });

    it("deduces token transfer_from requires spender authorization", () => {
      const reqs = deduceRequiredAuthorizations(VALID_CONTRACT, "transfer_from", [
        ACCOUNT_B,
        ACCOUNT_A,
        ACCOUNT_B,
        200,
      ]);
      assert.equal(reqs.length, 1);
      assert.equal(reqs[0].signer, ACCOUNT_B);
    });
  });

  describe("Validation before simulation", () => {
    it("passes when read-only call is validated without auth", () => {
      const res = validateAuthRequirements({
        contractId: VALID_CONTRACT,
        fn: "balance",
        args: [ACCOUNT_A],
      });
      assert.equal(res.valid, true);
      assert.equal(res.missing.length, 0);
      assert.equal(res.malformed.length, 0);
      assert.ok(res.explanation.includes("Ready to simulate"));
    });

    it("passes when required authorization entry is provided", () => {
      const authEntry = buildMockAuthEntry(ACCOUNT_A, VALID_CONTRACT, "transfer");
      const res = validateAuthRequirements({
        contractId: VALID_CONTRACT,
        fn: "transfer",
        args: [ACCOUNT_A, ACCOUNT_B, 100],
        auth: [authEntry],
      });
      assert.equal(res.valid, true);
      assert.equal(res.requiredEntries[0].status, "present");
      assert.equal(res.missing.length, 0);
      assert.equal(res.malformed.length, 0);
      assert.ok(res.explanation.includes("All 1 required authorization entries are present"));
    });

    it("flags missing authorization entry with clear explanation", () => {
      const res = validateAuthRequirements({
        contractId: VALID_CONTRACT,
        fn: "transfer",
        args: [ACCOUNT_A, ACCOUNT_B, 100],
        auth: [],
      });
      assert.equal(res.valid, false);
      assert.equal(res.missing.length, 1);
      assert.equal(res.missing[0].signer, ACCOUNT_A);
      assert.equal(res.requiredEntries[0].status, "missing");
      assert.ok(res.explanation.includes("Missing 1 required authorization entry"));
    });

    it("identifies malformed authorization entries and inputs", () => {
      const res = validateAuthRequirements({
        contractId: "invalid-id",
        fn: "transfer",
        args: "invalid-json[",
        auth: ["not-a-valid-base64-xdr!"],
        sourceAccount: "not-a-g-address",
      });
      assert.equal(res.valid, false);
      assert.ok(res.malformed.length >= 3);
      assert.ok(res.malformed.some((m) => m.field === "contractId"));
      assert.ok(res.malformed.some((m) => m.field === "args"));
      assert.ok(res.malformed.some((m) => m.field === "sourceAccount"));
      assert.ok(res.malformed.some((m) => m.index === 0));
    });

    it("throws on empty or missing required contractId or fn", () => {
      assert.throws(() => validateAuthRequirements({}), /contractId is required/);
      assert.throws(() => validateAuthRequirements({ contractId: VALID_CONTRACT }), /fn.*is required/);
    });
  });
});
