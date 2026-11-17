import { readFileSync } from "node:fs";

export function verifyInventory(inventory) {
  const counts = inventory?.counts;
  if (
    !counts ||
    !Array.isArray(inventory.violations) ||
    inventory.violations.length ||
    counts.organizations !== 1 ||
    counts.courses !== 1 ||
    counts.users !== 20 ||
    !Number.isInteger(counts.posts) ||
    counts.posts < 2 ||
    counts.posts > 11
  )
    throw new Error(
      "Fixture inventory is incomplete or unsafe; manual review required",
    );
  return counts;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    verifyInventory(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(
      "Reviewed fixture roots and dependencies are within bounds\n",
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
