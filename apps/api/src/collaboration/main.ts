import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "../database/pool.js";
import { createCollaborationServer } from "./server.js";

const environment = loadEnvironment();
const databaseUrl = requireDatabaseUrl(environment);
const pool = createPool(databaseUrl);
const collaboration = createCollaborationServer({
  pool,
  databaseUrl,
  frontendOrigins: environment.frontendOrigins,
  port: environment.collaboration.port,
});

await collaboration.start();
console.log(`ChalkTalk collaboration server listening on port ${environment.collaboration.port}`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void collaboration
      .stop()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
