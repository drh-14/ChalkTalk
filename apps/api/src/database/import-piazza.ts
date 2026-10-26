import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { isValidPassword } from "../auth/crypto.js";
import { PiazzaClient } from "../piazza-import/client.js";
import { convertExport, type PiazzaExport } from "../piazza-import/convert.js";
import { importPiazzaCourse } from "../piazza-import/importer.js";

const usage = `Usage: npm run db:import:piazza -- --owner <chalktalk email> (--class <name> | --from <file>) [--save <file>]

  --owner   Existing ChalkTalk account that becomes the course instructor.
  --class   Piazza class to fetch, matched against its course number or name (e.g. "CSE 416").
  --from    Import a previously saved export instead of fetching from Piazza.
  --save    Also write the fetched Piazza export to this file.

Environment: DATABASE_URL; PIAZZA_EMAIL and PIAZZA_PASSWORD when fetching;
PIAZZA_DEMO_PASSWORD (optional) makes every imported account log in with that password.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      owner: { type: "string" },
      class: { type: "string" },
      from: { type: "string" },
      save: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !values.owner || !(values.class || values.from)) {
    process.stdout.write(`${usage}\n`);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const demoPassword = process.env.PIAZZA_DEMO_PASSWORD || undefined;
  if (demoPassword !== undefined && !isValidPassword(demoPassword))
    throw new Error("PIAZZA_DEMO_PASSWORD must be 12 to 128 characters");

  let data: PiazzaExport;
  if (values.from)
    data = JSON.parse(readFileSync(values.from, "utf8")) as PiazzaExport;
  else {
    const { PIAZZA_EMAIL: email, PIAZZA_PASSWORD: password } = process.env;
    if (!email || !password)
      throw new Error(
        "PIAZZA_EMAIL and PIAZZA_PASSWORD are required to fetch from Piazza",
      );
    const client = new PiazzaClient();
    await client.login(email, password);
    data = await client.exportClass(values.class!, (message) =>
      process.stderr.write(`${message}\n`),
    );
    if (values.save) writeFileSync(values.save, JSON.stringify(data));
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const summary = await importPiazzaCourse(pool, convertExport(data), {
      ownerEmail: values.owner,
      ...(demoPassword ? { demoPassword } : {}),
    });
    const line = (
      label: string,
      c: { created: number; updated: number; skipped: number },
    ) =>
      `  ${label.padEnd(10)} ${c.created} new, ${c.updated} updated, ${c.skipped} skipped\n`;
    process.stdout.write(
      `Imported "${summary.courseName}" (course ${summary.courseId}, join code ${summary.joinCode})\n` +
        line("posts", summary.posts) +
        line("answers", summary.answers) +
        line("followups", summary.followups) +
        `  people     ${summary.people.length} (${summary.people.filter((p) => p.created).length} new)\n`,
    );
    if (demoPassword)
      for (const person of summary.people)
        process.stdout.write(
          `  ${person.role.padEnd(10)} ${person.name.padEnd(30)} ${person.email}\n`,
        );
  } finally {
    await pool.end();
  }
}

await main();
