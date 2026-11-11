import assert from "node:assert/strict";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import WebSocket from "ws";

const domain = process.env.VITE_GATEWAY_DOMAIN ?? "localhost";
const port = process.env.VITE_GATEWAY_PORT ?? "5173";
const options = {
  servername: domain,
  rejectUnauthorized: false, // The isolated test has not installed Caddy's local CA.
  headers: { Host: domain, Origin: `https://${domain}:${port}` },
};

async function probe(path, expectedStatus) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://gateway${path}`, options);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${path} WebSocket timed out`));
    }, 5_000);
    socket.on("open", () => {
      clearTimeout(timeout);
      socket.terminate();
      try {
        assert.equal(expectedStatus, 101, `${path} unexpectedly upgraded`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    socket.on("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      socket.terminate();
      try {
        assert.equal(response.statusCode, expectedStatus);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}

await probe("/api/v1/thread-events", 401);
await probe("/collaboration", 101);
