import process from "node:process";
import { invoke } from "./launcher-fixture.mjs";
const result = invoke(JSON.parse(process.argv[2] ?? "{}"), {
  realRender: true,
});
if (result.status !== 0) throw new Error(result.stderr + result.renderError);
process.stdout.write(JSON.stringify(result.model));
