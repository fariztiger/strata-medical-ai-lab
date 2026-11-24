import { getDb } from "../src/db.js";

const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
  .all("table")
  .map((row) => row.name);
const version = db.prepare("SELECT sqlite_version() AS v").get();
console.log("tables:", tables.join(", "));
console.log("sqlite:", version.v);
