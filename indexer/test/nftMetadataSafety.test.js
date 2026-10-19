/**
 * Unit tests for nftMetadataSafety.js NFT metadata safety indicators.
 * Closes #1064
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { assessNftMetadata } from "../src/nftMetadataSafety.js";

const IPFS_IMAGE = "ipfs://bafybeigdyrzt/image.png";
const HTTPS_IMAGE = "https://cdn.example.com/nft/1.png";

describe("assessNftMetadata — normal path", () => {
  it("reports no flags for IPFS-hosted image metadata with a known image type", () => {
    const result = assessNftMetadata({ image: IPFS_IMAGE, mime_type: "image/png" });
    assert.deepEqual(result.flags, []);
    assert.equal(result.media.status, "available");
  });

  it("flags external HTTPS metadata without loading it", () => {
    const result = assessNftMetadata({ image: HTTPS_IMAGE, mime_type: "image/png" });
    assert.ok(result.flags.includes("external_metadata"));
    assert.equal(result.media.status, "not_loaded");
  });
});

describe("assessNftMetadata — unsafe and unavailable media", () => {
  it("flags javascript: URIs as unsafe", () => {
    const result = assessNftMetadata({ image: "javascript:alert(1)" });
    assert.ok(result.flags.includes("unsafe_scheme"));
    assert.equal(result.media.status, "blocked");
  });

  it("flags non-image media types", () => {
    const result = assessNftMetadata({ image: IPFS_IMAGE, mime_type: "text/html" });
    assert.ok(result.flags.includes("unsafe_media_type"));
  });

  it("flags missing image as unavailable", () => {
    const result = assessNftMetadata({ name: "Token #1" });
    assert.ok(result.flags.includes("media_unavailable"));
    assert.equal(result.media.status, "unavailable");
  });
});

describe("assessNftMetadata — empty and boundary input", () => {
  it("returns a missing-media flag for an empty metadata object", () => {
    const result = assessNftMetadata({});
    assert.deepEqual(result.flags, ["media_unavailable"]);
  });

  it("treats a blank image string the same as a missing image", () => {
    const result = assessNftMetadata({ image: "   " });
    assert.equal(result.media.status, "unavailable");
  });
});

describe("assessNftMetadata — invalid input and no automatic fetching", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch must not be called");
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("throws TypeError when metadata is not an object", () => {
    assert.throws(() => assessNftMetadata("not-json"), TypeError);
  });

  it("never fetches external media while assessing HTTPS metadata", () => {
    assessNftMetadata({ image: HTTPS_IMAGE, mime_type: "image/png" });
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
