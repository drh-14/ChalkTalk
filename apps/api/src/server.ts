import { loadEnvironment } from "./config/environment.js";
import { createApp } from "./http/app.js";

const { port } = loadEnvironment();
const app = createApp();

app.listen(port, () => {
  console.info(`ChalkTalk API listening on port ${port}`);
});
