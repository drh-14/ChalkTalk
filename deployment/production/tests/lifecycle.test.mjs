import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, after } from "node:test";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../../..");
test("production lifecycle roles have separate private mounts, exact identities and >=150s grace", () => {
  const env = {
    ...process.env,
    LIFECYCLE_RELEASE_ID: "a".repeat(40),
    LIFECYCLE_API_IMAGE_DIGEST: `sha256:${"1".repeat(64)}`,
    LIFECYCLE_WORKER_IMAGE_DIGEST: `sha256:${"2".repeat(64)}`,
    LIFECYCLE_COLLABORATION_IMAGE_DIGEST: `sha256:${"3".repeat(64)}`,
  };
  const config = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "deployment/production/.env.example",
        "-f",
        "deployment/production/compose.yml",
        "config",
        "--no-env-resolution",
        "--format",
        "json",
      ],
      { cwd: root, env, encoding: "utf8" },
    ),
  );
  for (const role of ["api", "worker", "collaboration"]) {
    const service = config.services[role];
    const duration = String(service.stop_grace_period);
    const seconds = [...duration.matchAll(/([0-9.]+)(h|m|s)/g)].reduce(
      (sum, [, n, unit]) => sum + Number(n) * { h: 3600, m: 60, s: 1 }[unit],
      0,
    );
    assert.ok(seconds >= 150, "container grace covers application deadline");
    assert.equal(
      service.environment.LIFECYCLE_RELEASE_ID,
      env.LIFECYCLE_RELEASE_ID,
    );
    assert.equal(
      service.environment.LIFECYCLE_IMAGE_DIGEST,
      env[`LIFECYCLE_${role.toUpperCase()}_IMAGE_DIGEST`],
    );
    const request = service.volumes.find(
      (volume) => volume.target === "/run/chalktalk-lifecycle/requests",
    );
    const evidence = service.volumes.find(
      (volume) => volume.target === "/var/lib/chalktalk-lifecycle/evidence",
    );
    assert.equal(request.type, "bind");
    assert.equal(request.read_only, true);
    assert.equal(evidence.type, "bind");
    assert.equal(evidence.read_only, undefined);
    assert.ok(request.source.endsWith(`/lifecycle/${role}/requests`));
    assert.ok(evidence.source.endsWith(`/lifecycle/${role}/evidence`));
    assert.equal(request.bind.create_host_path, false);
    assert.equal(evidence.bind.create_host_path, false);
  }
});

test("Linux host setup is idempotent, private, non-root writable and survives container removal", () => {
  const volume = `ct-lifecycle-permissions-${process.pid}-${Date.now()}`;
  const script = resolve(root, "deployment/production/setup-lifecycle.sh");
  const docker = (args) =>
    execFileSync("docker", ["run", "--rm", ...args], { encoding: "utf8" });
  execFileSync("docker", ["volume", "create", volume]);
  const path = execFileSync(
    "docker",
    ["volume", "inspect", "--format", "{{.Mountpoint}}", volume],
    { encoding: "utf8" },
  ).trim();
  const fixture = ["--mount", `type=volume,src=${volume},dst=/fixture`];
  try {
    for (let i = 0; i < 2; i++)
      docker([
        ...fixture,
        "-v",
        `${script}:/setup.sh:ro`,
        "node:22-bookworm-slim",
        "bash",
        "/setup.sh",
        "/fixture/lifecycle",
        "1000",
        "1000",
      ]);
    assert.equal(
      docker([
        ...fixture,
        "node:22-bookworm-slim",
        "stat",
        "-c",
        "%a:%u:%g",
        "/fixture/lifecycle/api/evidence",
      ]).trim(),
      "700:1000:1000",
    );
    // Bind the Linux host filesystem directly, not a macOS shared directory
    // whose ownership mapping would conceal Linux UID failures.
    const evidence = [
      "--mount",
      `type=bind,src=${path}/lifecycle/api/evidence,dst=/evidence`,
    ];
    docker([
      "--user",
      "1000:1000",
      ...evidence,
      "node:22-bookworm-slim",
      "node",
      "-e",
      `const fs=require('node:fs');const f=fs.openSync('/evidence/terminal-test','wx',0o600);fs.writeSync(f,'durable');fs.fsyncSync(f);fs.closeSync(f);const d=fs.openSync('/evidence','r');fs.fsyncSync(d);fs.closeSync(d);`,
    ]);
    assert.equal(
      docker([
        "--user",
        "1000:1000",
        ...evidence,
        "node:22-bookworm-slim",
        "cat",
        "/evidence/terminal-test",
      ]),
      "durable",
    );
    assert.throws(() =>
      docker([
        "--user",
        "1000:1000",
        "--mount",
        `type=bind,src=${path}/lifecycle/api/requests,dst=/requests,readonly`,
        "node:22-bookworm-slim",
        "touch",
        "/requests/forbidden",
      ]),
    );
    docker([
      ...fixture,
      "node:22-bookworm-slim",
      "bash",
      "-c",
      "ln -s /tmp /fixture/unsafe",
    ]);
    assert.throws(() =>
      docker([
        ...fixture,
        "-v",
        `${script}:/setup.sh:ro`,
        "node:22-bookworm-slim",
        "bash",
        "/setup.sh",
        "/fixture/unsafe/lifecycle",
        "1000",
        "1000",
      ]),
    );
  } finally {
    execFileSync("docker", ["volume", "rm", volume]);
  }
});

const capturedInstances = [];
const capturedInventory = [];
let compiled = false;
after(() => {
  if (process.env.LIFECYCLE_TEST_CAPTURE)
    writeFileSync(
      process.env.LIFECYCLE_TEST_CAPTURE,
      JSON.stringify(
        {
          evidence: {
            instances: capturedInstances,
            inventory: capturedInventory,
            externalWritersFenced: true,
          },
          expected: {
            operationId: "00000000-0000-4000-8000-000000000001",
            requestNonce: "00000000-0000-4000-8000-000000000002",
            releaseId: "a".repeat(40),
            inventory: capturedInventory,
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
});
for (const role of ["api", "api", "collaboration", "worker"]) {
  test(`Linux ${role} non-root SIGTERM publishes a bound receipt before exit and survives container removal`, () => {
    // Compile the actual application modules; the fixture adds no implementation.
    if (!compiled)
      execFileSync("npm", ["run", "build", "--workspace=@chalktalk/api"], {
        cwd: root,
        stdio: "pipe",
      });
    compiled = true;
    const volume = `ct-lifecycle-signal-${process.pid}-${Date.now()}`;
    const container = `${volume}-writer`;
    const run = (args) => execFileSync("docker", args, { encoding: "utf8" });
    run(["volume", "create", volume]);
    const mount = ["--mount", `type=volume,src=${volume},dst=/fixture`];
    try {
      run([
        "run",
        "--rm",
        ...mount,
        "-v",
        `${resolve(root, "deployment/production/setup-lifecycle.sh")}:/setup.sh:ro`,
        "node:22-bookworm-slim",
        "bash",
        "/setup.sh",
        "/fixture/lifecycle",
        "1000",
        "1000",
      ]);
      const hostPath = run([
        "volume",
        "inspect",
        "--format",
        "{{.Mountpoint}}",
        volume,
      ]).trim();
      const source = `import {createProcessLifecycle} from '/lifecycle/process.js';
      const app=createProcessLifecycle('${role}');
      await app.start(async()=>{const timer=setInterval(()=>{},1000);app.runtime.closeResource('transport',async()=>clearInterval(timer));});
      const release=app.runtime.admit('job');
      app.runtime.onCutoff(()=>setTimeout(release,250));
      console.log('ready');`;
      run([
        "run",
        "-d",
        "--name",
        container,
        "--stop-timeout",
        "150",
        "--user",
        "1000:1000",
        "--mount",
        `type=bind,src=${hostPath}/lifecycle/${role}/evidence,dst=/evidence`,
        "--mount",
        `type=bind,src=${hostPath}/lifecycle/${role}/requests,dst=/requests,readonly`,
        "-v",
        `${resolve(root, "apps/api/dist/lifecycle")}:/lifecycle:ro`,
        "-e",
        "LIFECYCLE_EVIDENCE_DIRECTORY=/evidence",
        "-e",
        "LIFECYCLE_REQUEST_DIRECTORY=/requests",
        "-e",
        `LIFECYCLE_RELEASE_ID=${"a".repeat(40)}`,
        "-e",
        `LIFECYCLE_IMAGE_DIGEST=${run(["image", "inspect", "--format", "{{.Id}}", "node:22-bookworm-slim"]).trim()}`,
        "node:22-bookworm-slim",
        "node",
        "--input-type=module",
        "-e",
        source,
      ]);
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (run(["logs", container]).includes("ready")) {
          ready = true;
          break;
        }
        execFileSync("sleep", ["0.1"]);
      }
      assert.equal(ready, true);
      const binding = JSON.parse(
        run([
          "run",
          "--rm",
          ...mount,
          "node:22-bookworm-slim",
          "node",
          "-e",
          `const fs=require('node:fs'),dir='/fixture/lifecycle/${role}';const file=fs.readdirSync(dir+'/evidence').find(x=>x.endsWith('.boot.json'));const boot=JSON.parse(fs.readFileSync(dir+'/evidence/'+file));delete boot.bootStartedAt;const request={...boot,operationId:'00000000-0000-4000-8000-000000000001',requestNonce:'00000000-0000-4000-8000-000000000002'};const target=dir+'/requests/'+boot.bootId+'.json';fs.writeFileSync(target,JSON.stringify(request),{mode:0o600});fs.chownSync(target,1000,1000);console.log(JSON.stringify(request));`,
        ]),
      );
      const before = JSON.parse(
        run(["inspect", "--format", "{{json .}}", container]),
      );
      const boot = JSON.parse(
        run([
          "run",
          "--rm",
          ...mount,
          "node:22-bookworm-slim",
          "cat",
          `/fixture/lifecycle/${role}/evidence/${binding.bootId}.boot.json`,
        ]),
      );
      const inventory = {
        containerId: before.Id,
        observedImageDigest: before.Image,
        observedRestartCount: before.RestartCount,
        bootId: boot.bootId,
        role,
        releaseId: "a".repeat(40),
      };
      run(["stop", container]);
      const observed = JSON.parse(
        run(["inspect", "--format", "{{json .State}}", container]),
      );
      assert.equal(observed.ExitCode, 0);
      assert.equal(observed.OOMKilled, false);
      const terminal = JSON.parse(
        run([
          "run",
          "--rm",
          ...mount,
          "node:22-bookworm-slim",
          "cat",
          `/fixture/lifecycle/${role}/evidence/${binding.bootId}.terminal.json`,
        ]),
      );
      capturedInstances.push({
        containerId: before.Id,
        observedImageDigest: before.Image,
        observedRestartCount: before.RestartCount,
        observedExitCode: observed.ExitCode,
        observedOOMKilled: observed.OOMKilled,
        boot,
        request: binding,
        terminal,
      });
      const afterExit = JSON.parse(
        run(["inspect", "--format", "{{json .}}", container]),
      );
      assert.equal(afterExit.Image, inventory.observedImageDigest);
      assert.equal(afterExit.RestartCount, inventory.observedRestartCount);
      capturedInventory.push(inventory);
      run(["rm", container]);
      assert.deepEqual(
        JSON.parse(
          run([
            "run",
            "--rm",
            ...mount,
            "node:22-bookworm-slim",
            "cat",
            `/fixture/lifecycle/${role}/evidence/${binding.bootId}.terminal.json`,
          ]),
        ),
        terminal,
      );
      assert.equal(Number.isSafeInteger(terminal.elapsedMs), true);
      assert.equal(terminal.operationId, binding.operationId);
      assert.equal(terminal.requestNonce, binding.requestNonce);
      assert.equal(terminal.result, "success");
      assert.equal(terminal.deadlineMs, 120000);
      assert.equal(terminal.trigger, "SIGTERM");
      assert.ok(terminal.elapsedMs >= 200);
      assert.ok(
        Object.values(terminal.remaining).every((value) => value === 0),
      );
    } finally {
      try {
        run(["rm", "-f", container]);
      } catch {
        /* Already removed. */
      }
      run(["volume", "rm", volume]);
    }
  });
}
