/**
 * Writes the header row. Run once, after creating the Sheet and sharing it
 * with the service account:
 *
 *   npm run sheet:init
 *
 * Its real job is proving the Google auth chain works before we depend on it
 * from a webhook, where failures are much harder to read.
 */
import { COLUMNS, writeHeaderRow } from "../lib/sheets";

async function main() {
  await writeHeaderRow();
  console.log(`✓ Header row written — ${COLUMNS.length} columns`);
  console.log(`  ${COLUMNS.join(" | ")}`);
  console.log(
    `\nNext: add conditional formatting on the Status column ` +
      `(Qualified = green, Follow-up = amber, Reject = red).`,
  );
}

main().catch((error) => {
  console.error("✗ Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
