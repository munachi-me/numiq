import type { NormalizationPolicy } from "../../core/types.js";

/**
 * Default cell policy.
 *
 * `nullValues` deliberately contains only the empty string. Treating tokens such as
 * `NA`, `N/A`, or `null` as missing by default destroys real data (`NA` is Namibia's
 * country code, `null` is a surname), so those markers must be opted into per import.
 */
export const DEFAULT_NORMALIZATION: Readonly<NormalizationPolicy> = Object.freeze({
  trimStrings: false,
  emptyStringAsNull: true,
  inferTypes: true,
  nullValues: Object.freeze([""]) as readonly string[],
});

/** Merge a caller's partial policy over the defaults, normalising the null markers. */
export function resolveNormalization(partial: Partial<NormalizationPolicy> | undefined): NormalizationPolicy {
  const policy = { ...DEFAULT_NORMALIZATION, ...(partial ?? {}) };
  const markers = Array.isArray(policy.nullValues) ? policy.nullValues : [policy.nullValues];
  return {
    trimStrings: policy.trimStrings,
    emptyStringAsNull: policy.emptyStringAsNull,
    inferTypes: policy.inferTypes,
    nullValues: Object.freeze(markers.map((marker) => String(marker).toLowerCase())),
  };
}
