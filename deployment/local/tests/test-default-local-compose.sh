#!/bin/sh
set -eu

COMPOSE_ENV_FILE=deployment/local/.env.example docker compose -f deployment/local/compose.yml --env-file deployment/local/.env.example config --format json | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const services = JSON.parse(input).services;
    const expected = [
      "alloy", "api", "collaboration",
      "grafana", "loki", "migrate", "postgres", "prometheus",
      "seaweedfs", "web", "worker"
    ];
    if (JSON.stringify(Object.keys(services).sort()) !== JSON.stringify(expected) ||
        Object.values(services).some((service) => service.profiles?.length)) {
      console.error("Default local stack must include every service without profiles or seeding");
      process.exitCode = 1;
    }
  });
'
