import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../../..");

function adaptedCaddyfile(file) {
  const path = resolve(root, file);
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--env",
        "DOMAIN=localhost",
        "--volume",
        `${path}:/etc/caddy/Caddyfile:ro`,
        "caddy:2.10-alpine",
        "caddy",
        "adapt",
        "--config",
        "/etc/caddy/Caddyfile",
        "--adapter",
        "caddyfile",
      ],
      { encoding: "utf8" },
    ),
  );
}

function encoders(value, inheritedMatch = []) {
  if (!value || typeof value !== "object") return [];
  const match = value.match ?? inheritedMatch;
  const own = value.handler === "encode" ? [{ match, value }] : [];
  return [
    ...own,
    ...Object.entries(value)
      .filter(([key]) => key !== "match")
      .flatMap(([, child]) =>
        Array.isArray(child)
          ? child.flatMap((item) => encoders(item, match))
          : encoders(child, match),
      ),
  ];
}

function excludesApi(match) {
  return (
    Array.isArray(match) &&
    match.some(
      (entry) =>
        Array.isArray(entry.not) &&
        entry.not.some(
          (excluded) =>
            Array.isArray(excluded.path) && excluded.path.includes("/api/*"),
        ),
    )
  );
}

for (const file of [
  "deployment/local/Caddyfile",
  "deployment/production/Caddyfile",
]) {
  test(`${file} keeps API revision ETags outside response encoding`, () => {
    const routes = encoders(adaptedCaddyfile(file));
    assert.ok(routes.length > 0, "non-API compression stays configured");
    for (const route of routes)
      assert.ok(excludesApi(route.match), "every encoder must exclude /api/*");
  });
}
