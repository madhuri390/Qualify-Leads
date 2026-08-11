/**
 * Env access with a loud failure mode.
 *
 * Read lazily, never at module top level — importing a module must not crash
 * the build just because a key is unset. Never log the value, only the name.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `${name} is not set. Add it to .env.local (see .env.local.example) ` +
        `and to Vercel → Settings → Environment Variables.`,
    );
  }
  return value;
}

/**
 * Service-account private keys carry literal "\n" once they've been through
 * a .env file or a Vercel form field. Restore the real newlines.
 */
export function requirePrivateKey(name: string): string {
  return requireEnv(name).replace(/\\n/g, "\n");
}
