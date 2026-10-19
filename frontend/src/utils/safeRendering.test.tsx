import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { safeText, isSafeUrl, safeUrl, formatDecodedValue, SafeText, SafeLink } from "./safeRendering";

describe("Safe Rendering for Untrusted Contract Metadata (#1120)", () => {
  describe("safeText", () => {
    it("handles normal text unchanged", () => {
      expect(safeText("Normal Contract Name")).toBe("Normal Contract Name");
    });

    it("handles markup payloads as literal text without rendering HTML", () => {
      const markup = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      const result = safeText(markup);
      expect(result).toBe(markup);
    });

    it("strips harmful unprintable control characters", () => {
      const payload = "Contract\u0000\u0007\u001fName\u007f";
      expect(safeText(payload)).toBe("ContractName");
    });

    it("handles empty, null, and undefined with fallbacks", () => {
      expect(safeText(null, "fallback")).toBe("fallback");
      expect(safeText(undefined, "fallback")).toBe("fallback");
      expect(safeText("", "fallback")).toBe("fallback");
      expect(safeText("   ", "fallback")).toBe("fallback");
    });

    it("safely stringifies numbers, booleans, and bigints", () => {
      expect(safeText(12345)).toBe("12345");
      expect(safeText(true)).toBe("true");
      expect(safeText(BigInt(9007199254740991))).toBe("9007199254740991");
    });

    it("safely stringifies object metadata", () => {
      expect(safeText({ token: "USDC", version: 1 })).toBe('{"token":"USDC","version":1}');
    });
  });

  describe("isSafeUrl and safeUrl", () => {
    it("accepts valid https, http, and mailto URLs", () => {
      expect(isSafeUrl("https://stellar.org")).toBe(true);
      expect(isSafeUrl("http://example.com/api/metadata")).toBe(true);
      expect(isSafeUrl("mailto:support@example.com")).toBe(true);
      expect(safeUrl("https://stellar.org")).toBe("https://stellar.org");
    });

    it("accepts safe relative internal paths", () => {
      expect(isSafeUrl("/contract/CA3D5KRYMCM")).toBe(true);
      expect(isSafeUrl("/event/123")).toBe(true);
    });

    it("rejects javascript: script execution payloads", () => {
      expect(isSafeUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeUrl("javascript:void(0)")).toBe(false);
      expect(isSafeUrl("JAVASCRIPT:alert('xss')")).toBe(false);
      expect(isSafeUrl("  javascript:alert(1)  ")).toBe(false);
      expect(safeUrl("javascript:alert(1)", "#blocked")).toBe("#blocked");
    });

    it("rejects data: URI payloads", () => {
      expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
      expect(isSafeUrl("data:image/svg+xml;base64,PHN2Zw==")).toBe(false);
      expect(safeUrl("data:text/html;base64,...")).toBe("#");
    });

    it("rejects vbscript: and file: URLs", () => {
      expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
      expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    });

    it("rejects protocol-relative URLs", () => {
      expect(isSafeUrl("//evil.com/phish")).toBe(false);
    });

    it("rejects HTML entity and whitespace obfuscated javascript: URLs", () => {
      expect(isSafeUrl("jav&#x09;ascript:alert(1)")).toBe(false);
      expect(isSafeUrl("jav&#65;script:alert(1)")).toBe(false);
      expect(isSafeUrl("java\u0000script:alert(1)")).toBe(false);
    });

    it("handles empty or non-string inputs safely", () => {
      expect(isSafeUrl("")).toBe(false);
      expect(isSafeUrl(null)).toBe(false);
      expect(isSafeUrl(undefined)).toBe(false);
      expect(isSafeUrl({})).toBe(false);
    });
  });

  describe("formatDecodedValue", () => {
    it("formats primitives and complex decoded types safely", () => {
      expect(formatDecodedValue("hello")).toBe("hello");
      expect(formatDecodedValue(42)).toBe("42");
      expect(formatDecodedValue(false)).toBe("false");
      expect(formatDecodedValue(BigInt(1000000000))).toBe("1000000000");
      expect(formatDecodedValue(null)).toBe("null");
      expect(formatDecodedValue(undefined)).toBe("—");
      expect(formatDecodedValue([1, 2, "three"])).toBe("[1, 2, three]");
      expect(formatDecodedValue({ amount: 100, recipient: "GABC..." })).toBe('{"amount":100,"recipient":"GABC..."}');
    });

    it("handles decoded values containing script and markup payloads safely", () => {
      const malicious = '<svg onload=alert("xss")>';
      expect(formatDecodedValue(malicious)).toBe(malicious);
    });
  });

  describe("SafeText component", () => {
    it("renders text safely without executing markup", () => {
      render(<SafeText data-testid="contract-name" value='<script>alert("xss")</script>Token' />);
      const el = screen.getByTestId("contract-name");
      expect(el.textContent).toBe('<script>alert("xss")</script>Token');
      expect(document.querySelector("script")).toBeNull();
    });

    it("renders fallback when value is empty or missing", () => {
      render(<SafeText data-testid="empty-desc" value="" fallback="No description" />);
      expect(screen.getByTestId("empty-desc").textContent).toBe("No description");
    });
  });

  describe("SafeLink component", () => {
    it("renders safe link with appropriate attributes", () => {
      render(
        <SafeLink data-testid="safe-link" href="https://stellar.org">
          Stellar
        </SafeLink>,
      );
      const link = screen.getByTestId("safe-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("https://stellar.org");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    });

    it("neutralizes malicious javascript: URLs", () => {
      render(
        <SafeLink data-testid="dangerous-link" href="javascript:alert('xss')" fallbackHref="#blocked">
          Click Here
        </SafeLink>,
      );
      const link = screen.getByTestId("dangerous-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("#blocked");
    });
  });
});
