#!/usr/bin/env node
// Development/CI instrumentation, not the operator entrypoint. Only explicitly
// owned fixtures can inject a controlled transport; start.sh remains unchanged.
import {
  accessSync,
  constants,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";
const args = process.argv.slice(2);
const index = args.indexOf("--project-name");
if (index < 0 || !args[index + 1]?.startsWith("ct-modular-"))
  throw new Error("CI requires an explicitly owned ct-modular-* project");
const realDocker = process.env.PATH.split(":")
  .map((path) => join(path, "docker"))
  .find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
if (!realDocker) throw new Error("Docker is required for CI");
const privateDir = mkdtempSync(join(tmpdir(), "chalktalk-ci-transport-"));
try {
  const overlay = join(privateDir, "transport.yml");
  writeFileSync(
    overlay,
    JSON.stringify({
      services: {
        api: {
          command: [
            "node",
            "--import",
            "./deployment/local/tests/mail-preload.mjs",
            "--import",
            "tsx",
            "apps/api/src/server.ts",
          ],
        },
        worker: {
          command: [
            "node",
            "--import",
            "./deployment/local/tests/mail-preload.mjs",
            "--import",
            "tsx",
            "apps/api/src/jobs/main.ts",
          ],
        },
      },
    }),
    { mode: 0o600 },
  );
  const instrumenter = join(privateDir, "docker.mjs");
  writeFileSync(
    instrumenter,
    `import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
if(args[0]==='compose'){
 const command=args.findIndex((value,index)=>index>0&&['config','build','stop','up','run'].includes(value));
 if(command<0)throw new Error('Unexpected fixture Compose operation');
 args.splice(command,0,'-f',${JSON.stringify(overlay)});
}
const result=spawnSync(${JSON.stringify(realDocker)},args,{stdio:'inherit',env:process.env});
if(result.error)throw result.error;process.exit(result.status??1);
`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(privateDir, "docker"),
    `#!/bin/sh\nexec '${process.execPath}' '${instrumenter}' "$@"\n`,
    { mode: 0o700 },
  );
  const result = spawnSync(
    "/bin/sh",
    [join(dirname(fileURLToPath(import.meta.url)), "../start.sh"), ...args],
    {
      stdio: "inherit",
      env: { ...process.env, PATH: `${privateDir}:${process.env.PATH}` },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(privateDir, { recursive: true, force: true });
}
