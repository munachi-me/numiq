/**
 * Normalization is conservative by default; opt in to more aggressive rules.
 *
 * Run with: npx tsx examples/03-normalization.ts
 */
import { parseDelimited } from "numiq";

const text = "country,phone,code,note\nNA,+26481234,007,\n";

const defaults = parseDelimited(text, { format: "csv" });
console.log("defaults:", defaults.data);
// NA stays a country code, the phone number keeps its +, the code keeps its zeros.

const aggressive = parseDelimited(text, {
  format: "csv",
  normalization: { trimStrings: true, nullValues: ["", "NA"] },
});
console.log("aggressive:", aggressive.data);
