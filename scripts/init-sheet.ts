/**
 * Writes the header rows. Run once, after creating the Sheet and sharing it
 * with the service account:
 *
 *   npm run sheet:init
 *
 * Its real job is proving the Google auth chain works before we depend on it
 * from a webhook, where failures are much harder to read.
 *
 * Needs three tabs to already exist in the Sheet — the Sheets API can't
 * create one: "Leads" (already there from Day 1), plus new "Approvals" and
 * "Research" tabs for the business-research stage. Add the two new tabs by
 * hand (bottom-left "+" in Google Sheets) before running this.
 */
import "./load-env";
import { APPROVAL_COLUMNS, COLUMNS, RESEARCH_COLUMNS, writeHeaderRow, writeSecondaryHeaderRows } from "../lib/sheets";

async function main() {
  await writeHeaderRow();
  console.log(`✓ Leads header row written — ${COLUMNS.length} columns`);
  console.log(`  ${COLUMNS.join(" | ")}`);

  await writeSecondaryHeaderRows();
  console.log(`✓ Approvals header row written — ${APPROVAL_COLUMNS.join(" | ")}`);
  console.log(`✓ Research header row written — ${RESEARCH_COLUMNS.join(" | ")}`);

  console.log(
    `\nNext: add conditional formatting on the Status column ` +
      `(Qualified = green, Follow-up = amber, Reject = red).`,
  );
}

main().catch((error) => {
  console.error("✗ Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
