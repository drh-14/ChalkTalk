import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "../database/pool.js";
import { createCollaborationServer } from "./server.js";
import { CollaborationStore } from "./store.js";

const environment = loadEnvironment();
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for collaboration");
const port = Number(process.env.COLLABORATION_PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("COLLABORATION_PORT must be an integer between 1 and 65535");

const pool = createPool(requireDatabaseUrl(environment));
const server = createCollaborationServer({
  store: new CollaborationStore(pool),
  redisUrl,
  allowedOrigins: environment.frontendOrigins,
  port,
  address: process.env.COLLABORATION_ADDRESS ?? "0.0.0.0",
});
await server.listen();
console.info(`ChalkTalk collaboration listening on port ${port}`);

async function shutdown() {
  await server.destroy();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
