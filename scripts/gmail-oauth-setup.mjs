#!/usr/bin/env node
/* global process, URL, URLSearchParams, Buffer, fetch, AbortSignal, setTimeout */
// Run locally once. Never expose this loopback callback on the deployed app.
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  process.stderr.write(
    "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your local environment.\n",
  );
  process.exitCode = 1;
} else {
  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const authorizationBase = "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenUrl =
    process.env.GMAIL_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Loopback callback failed");
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const authorization = new URL(authorizationBase);
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    process.stdout.write(
      `Open this URL in your browser, authorize your sending account, and return here:\n${authorization.href}\n`,
    );
    server.once("request", async (request, response) => {
      try {
        const callback = new URL(request.url ?? "/", redirectUri);
        const receivedState = Buffer.from(
          callback.searchParams.get("state") ?? "",
        );
        const expectedState = Buffer.from(state);
        if (
          callback.pathname !== "/callback" ||
          receivedState.length !== expectedState.length ||
          !timingSafeEqual(receivedState, expectedState)
        )
          throw new Error("OAuth callback state was invalid");
        const code = callback.searchParams.get("code");
        if (!code) throw new Error("OAuth authorization was not granted");
        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const tokens = await tokenResponse.json();
        if (
          !tokenResponse.ok ||
          typeof tokens.refresh_token !== "string" ||
          !tokens.refresh_token ||
          // OAuth tokens must not contain control bytes in the dotenv file.
          // eslint-disable-next-line no-control-regex
          /[\u0000-\u001f\u007f]/.test(tokens.refresh_token)
        )
          throw new Error("Google did not return an offline refresh token");
        await writeFile(
          ".env.gmail.local",
          `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`,
          { flag: "wx", mode: 0o600 },
        );
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(
          "Authorization complete. A local ignored secret file was created; close this tab.",
        );
        process.stdout.write(
          "Saved refresh token to ignored .env.gmail.local with owner-only permissions. Transfer it to your deployment secret store, then remove the local file when no longer needed.\n",
        );
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Authorization failed. Check the terminal and retry.");
        process.stderr.write(
          `${error instanceof Error ? error.message : "Authorization failed"}\n`,
        );
        process.exitCode = 1;
      } finally {
        server.close();
      }
    });
  });
  setTimeout(() => server.close(), 5 * 60_000).unref();
}
