import { createEmailSender } from "./auth/email.js";
import { AuthService } from "./auth/service.js";
import { loadEnvironment, requireDatabaseUrl } from "./config/environment.js";
import { createPool } from "./database/pool.js";
import { createApp } from "./http/app.js";

const environment = loadEnvironment();
const { port } = environment;
const pool = createPool(requireDatabaseUrl(environment));
const app = createApp({
  environment,
  authService: new AuthService(
    pool,
    environment,
    createEmailSender(environment),
  ),
});

app.listen(port, () => {
  console.info(`ChalkTalk API listening on port ${port}`);
});
