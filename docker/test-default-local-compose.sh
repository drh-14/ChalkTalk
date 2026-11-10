#!/bin/sh
set -eu

COMPOSE_ENV_FILE=.env.example docker compose --env-file .env.example config --format json | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const services = JSON.parse(input).services;
    const expected = [
      "api", "collaboration", "elasticsearch", "elasticsearch-init",
      "grafana", "logstash", "migrate", "postgres", "prometheus",
      "seaweedfs", "web", "worker"
    ];
    if (JSON.stringify(Object.keys(services).sort()) !== JSON.stringify(expected) ||
        Object.values(services).some((service) => service.profiles?.length)) {
      console.error("Default local stack must include every service without profiles or seeding");
      process.exitCode = 1;
    }
  });
'
