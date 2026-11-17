import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeProfile, validateTargetIdentity } from "./profile.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("Private runner directory required");
const profile = normalizeProfile(process.env);
const { projectRef, databaseHost } = validateTargetIdentity(
  process.env.SUPABASE_STORAGE_ENDPOINT,
  process.env.DATABASE_URL,
);
const nonce = randomBytes(16).toString("hex");
const mac = createHmac("sha256", process.env.DATABASE_URL)
  .update(nonce)
  .digest("hex");
writeFileSync(resolve(directory, "profile.json"), JSON.stringify(profile), {
  mode: 0o600,
  flag: "wx",
});
writeFileSync(
  resolve(directory, "identity.json"),
  JSON.stringify({ projectRef, databaseHost, nonce, mac }),
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(
  "Validated bounded profile and same-project Supabase target\n",
);
