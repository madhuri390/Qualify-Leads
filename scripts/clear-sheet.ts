/**
 * Wipes every lead row, keeping the header. For resetting between demo takes.
 *
 *   npm run sheet:clear -- --yes
 *
 * Requires the flag on purpose: this is the one destructive script in the repo,
 * and a stray `npm run sheet:clear` mid-demo is not a recoverable mistake.
 */
import "./load-env";
import { clearDataRows } from "../lib/sheets";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to clear without --yes:  npm run sheet:clear -- --yes");
    process.exit(1);
  }

  await clearDataRows();
  console.log("Cleared every data row. Header intact.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
