import * as React from "react";

/**
 * Safe rendering utilities for untrusted contract metadata (#1120)
 *
 * Treats names, descriptions, parameters, and decoded values as untrusted inputs,
 * preventing markup injection, script execution, and dangerous URL protocols.
 */

// eslint-disable-next-line no-control-regex
const DANGEROUS_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Normalize and convert any untrusted value into a safe plain string.
 */
export function safeText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const cleaned = value.replace(DANGEROUS_CONTROL_CHARS, "");
    return cleaned.trim() === "" ? fallback : cleaned;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Check if a URL string is safe to use in href attributes.
 * Allows only http:, https:, mailto:, and relative internal paths (/path, but not //protocol-relative).
 * Strictly rejects javascript:, data:, vbscript:, and obfuscated variants.
 */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Reject protocol-relative URLs (//example.com) and control characters
  if (trimmed.startsWith("//")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return false;

  // Decode common URL entities / escapes to prevent obfuscation bypasses
  const decoded = trimmed
    .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\s+/g, "");

  const lower = decoded.toLowerCase();

  // Explicitly deny dangerous schemes
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return false;
  }

  // Allow relative URLs starting with a single '/'
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Return a safe URL for href attributes or fallback if unsafe.
 */
export function safeUrl(url: unknown, fallback = "#"): string {
  return isSafeUrl(url) ? String(url).trim() : fallback;
}

/**
 * Format any decoded parameter or event value safely for UI display.
 */
export function formatDecodedValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return safeText(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatDecodedValue(v)).join(", ")}]`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
      return "[Complex Value]";
    }
  }
  return String(value);
}

interface SafeTextProps extends React.HTMLAttributes<HTMLElement> {
  value: unknown;
  fallback?: string;
  as?: React.ElementType;
}

/**
 * React component for safely rendering untrusted text nodes.
 * Guarantees content is never executed as HTML or script.
 */
export function SafeText({ value, fallback = "—", as: Component = "span", ...props }: SafeTextProps) {
  const content = safeText(value, fallback);
  return React.createElement(Component, props, content);
}

interface SafeLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: unknown;
  fallbackHref?: string;
  children?: React.ReactNode;
}

/**
 * Safe anchor component that guards against malicious URLs.
 */
export function SafeLink({ href, fallbackHref = "#", children, ...props }: SafeLinkProps) {
  const safe = isSafeUrl(href);
  const targetHref = safe ? String(href).trim() : fallbackHref;
  const isExternal = typeof href === "string" && /^https?:\/\//i.test(href);

  return (
    <a href={targetHref} rel={isExternal ? "noreferrer noopener" : props.rel} {...props}>
      {children ?? (safe ? String(href) : "Unsafe link blocked")}
    </a>
  );
}
