/**
 * Loads .env.local into process.env for scripts run outside Next.js.
 *
 * Next's own dev/build server loads .env.local automatically; a bare `tsx
 * scripts/foo.ts` does not. Import this first, for its side effect, in any
 * script that touches lib/env.ts.
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    process.env[match[1]] ??= value;
  }
} catch {
  console.warn("No .env.local found — continuing without it");
}
