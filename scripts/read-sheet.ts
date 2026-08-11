/**
 * Prints the last N rows of the Leads tab — a fast way to confirm the
 * pipeline actually wrote something, without needing Vercel log access.
 *
 *   npm run sheet:read           # last 5 rows
 *   npm run sheet:read -- 20     # last 20 rows
 */
import "./load-env";
import { JWT } from "google-auth-library";
import { requireEnv, requirePrivateKey } from "../lib/env";
import { COLUMNS } from "../lib/sheets";

async function main() {
  const count = Number(process.argv[2] ?? 5);

  const auth = new JWT({
    email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requirePrivateKey("GOOGLE_PRIVATE_KEY"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const { token } = await auth.getAccessToken();

  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Leads";
  const sheetId = requireEnv("GOOGLE_SHEET_ID");
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A2:T`);

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    throw new Error(`Sheets API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { values?: string[][] };
  const rows = data.values ?? [];

  if (rows.length === 0) {
    console.log("No data rows yet — only the header row exists.");
    return;
  }

  console.log(`${rows.length} row(s) total. Showing the last ${Math.min(count, rows.length)}:\n`);
  for (const row of rows.slice(-count)) {
    for (let i = 0; i < COLUMNS.length; i++) {
      const value = row[i];
      if (value) console.log(`  ${COLUMNS[i]}: ${value}`);
    }
    console.log("  ---");
  }
}

main().catch((error) => {
  console.error("✗ Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
