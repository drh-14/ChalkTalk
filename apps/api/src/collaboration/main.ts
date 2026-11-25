import { loadEnvironment, requireDatabaseUrl } from "../config/environment.js";
import { createPool } from "../database/pool.js";
import { createProcessLifecycle } from "../lifecycle/process.js";
import { createCollaborationServer } from "./server.js";

const application = createProcessLifecycle("collaboration");
const lifecycle = application.runtime;
let collaboration: ReturnType<typeof createCollaborationServer> | undefined;
lifecycle.onCutoff(() => collaboration?.cutoff());
lifecycle.forceCancel.addEventListener("abort", () =>
  collaboration?.server.forceClose(),
);
await application.start(async () => {
  const environment = loadEnvironment();
  const databaseUrl = requireDatabaseUrl(environment);
  const pool = createPool(databaseUrl);
  lifecycle.closeResource("dependency", () => pool.end());
  collaboration = createCollaborationServer({
    pool,
    databaseUrl,
    frontendOrigins: environment.frontendOrigins,
    port: environment.collaboration.port,
    idleEndMinutes: environment.collaboration.idleEndMinutes,
    metricsToken: environment.observability.metricsToken,
    ready: () => lifecycle.ready,
  });
  lifecycle.closeResource("transport", () => collaboration!.stop());
  await collaboration.start();
});
