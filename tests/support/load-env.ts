import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Integration tests use the LOCAL database from .env.local (never a production URL).
const file = path.join(process.cwd(), ".env.local");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
}
const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  throw new Error("Integration tests only run against a local DATABASE_URL (localhost).");
}
