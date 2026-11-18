#!/bin/sh
set -eu

COMPOSE_ENV_FILE=deployment/local/.env.example docker compose -f deployment/local/compose.yml --env-file deployment/local/.env.example config --format json | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const services = JSON.parse(input).services;
    const expected = [
      "alloy", "api", "collaboration",
      "gateway", "grafana", "loki", "migrate", "node-exporter",
      "node-exporter-network", "postgres", "prometheus",
      "seaweedfs", "web", "worker"
    ];
    if (JSON.stringify(Object.keys(services).sort()) !== JSON.stringify(expected) ||
        Object.values(services).some((service) => service.profiles?.length)) {
      console.error("Default local stack must include every service without profiles or seeding");
      process.exitCode = 1;
    }
    if (!services.collaboration.healthcheck?.test ||
        services.gateway.depends_on?.collaboration?.condition !== "service_healthy") {
      console.error("Gateway must wait for a healthy collaboration WebSocket upstream");
      process.exitCode = 1;
    }
  });
'
