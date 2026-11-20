import type { NormalizationPolicy } from "../../core/types.js";

const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const BOOLEAN = /^(?:true|false)$/i;

/** Outcome of normalizing one cell, including any warning the caller should record. */
export interface NormalizedCell {
  value: unknown;
  issue?: "unsafe-integer";
}

/**
 * Apply the normalization policy to a single cell.
 *
 * Numeric inference never silently loses precision: an integer outside the safe range
 * is kept as its original string and reported via `issue`.
 */
export function normalizeCell(input: unknown, policy: NormalizationPolicy): NormalizedCell {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== "string") return { value: input };

  const text = policy.trimStrings ? input.trim() : input;

  if (text === "" && policy.emptyStringAsNull) return { value: null };
  if (policy.nullValues.length > 0 && policy.nullValues.includes(text.toLowerCase())) return { value: null };
  if (!policy.inferTypes) return { value: text };

  if (BOOLEAN.test(text)) return { value: text.toLowerCase() === "true" };

  // A leading `+` marks a phone number or an explicitly signed identifier far more often
  // than it marks a quantity, so such values stay strings. Leading zeros are identifiers
  // too (`007`, `0012`).
  if (!text.startsWith("+") && !/^[-+]?0\d/.test(text) && NUMERIC.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      if (Number.isInteger(numeric) && !Number.isSafeInteger(numeric)) {
        return { value: text, issue: "unsafe-integer" };
      }
      return { value: numeric };
    }
  }

  return { value: text };
}
