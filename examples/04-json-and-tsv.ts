/**
 * JSON and TSV load through the same Dataset abstraction.
 *
 * Run with: npx tsx examples/04-json-and-tsv.ts
 */
import { loadJSON, loadTSV } from "@munachi-me/numiq";

const users = await loadJSON("users.json");
console.log(users.table());

const people = await loadTSV("people.tsv");
console.log(people.table());

console.log("JSON shape:", users.shape, "TSV shape:", people.shape);
