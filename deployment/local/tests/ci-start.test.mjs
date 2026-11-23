import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { invoke } from "./launcher-fixture.mjs";
test("CI harness preserves canonical phases and uses an explicit isolated mail transport", () => {
  const result = invoke(
    {},
    {
      ciHarness: true,
      realRender: true,
      args: ["--project-name", "ct-modular-ci-test"],
    },
  );
  assert.equal(result.status, 0, result.stderr + result.renderError);
  for (const [service, entry] of [
    ["api", "apps/api/src/server.ts"],
    ["worker", "apps/api/src/jobs/main.ts"],
  ]) {
    assert.deepEqual(result.model.services[service].command, [
      "node",
      "--import",
      "./deployment/local/tests/mail-preload.mjs",
      "--import",
      "tsx",
      entry,
    ]);
    assert.equal(
      result.model.services[service].environment.EMAIL_PROVIDER,
      "resend",
    );
  }
  assert.match(result.calls, /runtime.ts check/);
  assert.match(result.calls, /runtime.ts prepare/);
});
test("test-only transport prevents provider network handoff and preserves unrelated fetches", () => {
  const preload = new URL("./mail-preload.mjs", import.meta.url).href;
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
 let calls=0;globalThis.fetch=async()=>{calls++;return new Response('unrelated')};
 await import(${JSON.stringify(preload)});
 const accepted=await fetch('https://api.resend.com/emails',{method:'POST',body:'private-content'});
 if(accepted.status!==200 || !(await accepted.json()).id || calls!==0)throw new Error('mail was not intercepted');
 const ordinary=await fetch('http://fixture.invalid/health');
 if(await ordinary.text()!=='unrelated'||calls!==1)throw new Error('unrelated fetch changed');
 console.log('verified');
 `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(output.trim(), "verified");
});
