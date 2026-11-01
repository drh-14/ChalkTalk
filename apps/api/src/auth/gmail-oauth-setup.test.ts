import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const helper = fileURLToPath(
  new URL("../../../../scripts/gmail-oauth-setup.mjs", import.meta.url),
);
const processes: Array<ReturnType<typeof spawn>> = [];
const servers: Array<ReturnType<typeof createServer>> = [];
const directories: string[] = [];

afterEach(async () => {
  for (const process of processes) process.kill();
  for (const server of servers)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
  processes.length = 0;
  servers.length = 0;
  directories.length = 0;
});

async function start(refreshToken = "fake-private-refresh-token") {
  const received: URLSearchParams[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push(new URLSearchParams(Buffer.concat(chunks).toString()));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ refresh_token: refreshToken }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No mock port");
  const directory = await mkdtemp(join(tmpdir(), "gmail-oauth-helper-"));
  directories.push(directory);
  const child = spawn(process.execPath, [helper], {
    cwd: directory,
    env: {
      ...process.env,
      GMAIL_CLIENT_ID: "local-id",
      GMAIL_CLIENT_SECRET: "local-secret",
      GMAIL_TOKEN_URL: `http://127.0.0.1:${address.port}/token`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);
  let stdout = "";
  const authorization = await new Promise<URL>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("OAuth URL was not printed")),
      5000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(
        /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?[^\n]+/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(new URL(match[0]));
      }
    });
    child.once("error", reject);
  });
  return { authorization, child, directory, received, stdout: () => stdout };
}

describe("local Gmail OAuth bootstrap", () => {
  it("uses PKCE, verifies state, and saves the refresh token only to an owner-readable ignored env file", async () => {
    const { authorization, child, directory, received, stdout } = await start();
    expect(authorization.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.send",
    );
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get("state")!,
      code: "test-code",
    }).toString();
    expect((await fetch(callback)).status).toBe(200);
    expect((await once(child, "exit"))[0]).toBe(0);
    expect(received).toHaveLength(1);
    const verifier = received[0]!.get("code_verifier");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(authorization.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier!).digest("base64url"),
    );
    expect(await readFile(join(directory, ".env.gmail.local"), "utf8")).toBe(
      "GMAIL_REFRESH_TOKEN=fake-private-refresh-token\n",
    );
    expect((await stat(join(directory, ".env.gmail.local"))).mode & 0o777).toBe(
      0o600,
    );
    expect(stdout()).not.toContain("fake-private-refresh-token");
  });

  it("rejects a forged state without exchanging a code or writing a token", async () => {
    const { authorization, child, directory, received } = await start();
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: "forged",
      code: "test-code",
    }).toString();
    expect((await fetch(callback)).status).toBe(400);
    expect((await once(child, "exit"))[0]).toBe(1);
    expect(received).toHaveLength(0);
    await expect(
      stat(join(directory, ".env.gmail.local")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a token containing control characters instead of writing additional env entries", async () => {
    const { authorization, child, directory } = await start(
      "safe-token\nEMAIL_PROVIDER=evil",
    );
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get("state")!,
      code: "test-code",
    }).toString();
    expect((await fetch(callback)).status).toBe(400);
    expect((await once(child, "exit"))[0]).toBe(1);
    await expect(
      stat(join(directory, ".env.gmail.local")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
