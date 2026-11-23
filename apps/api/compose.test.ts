import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15_000 });

type ComposeService = {
  image?: string;
  build?: { context: string; dockerfile: string };
  command?: string[] | string;
  profiles?: string[];
  environment?: Record<string, string>;
  ports?: Array<{ host_ip?: string; published: string; target: number }>;
  volumes?: Array<{ source: string; target: string; type: string }>;
  restart?: string;
  healthcheck?: { test: string[] };
  depends_on?: Record<string, { condition: string }>;
};

function renderCompose(
  credentials?: { accessKey: string; secretKey: string },
  ambientAws?: { accessKey?: string; secretKey?: string },
) {
  const output = execFileSync(
    process.execPath,
    [
      "deployment/local/tests/render-compose.mjs",
      JSON.stringify({
        ...(credentials
          ? {
              LOCAL_OBJECT_STORE_ACCESS_KEY_ID: credentials.accessKey,
              LOCAL_OBJECT_STORE_SECRET_ACCESS_KEY: credentials.secretKey,
            }
          : {}),
        ...(ambientAws?.accessKey
          ? { AWS_ACCESS_KEY_ID: ambientAws.accessKey }
          : {}),
        ...(ambientAws?.secretKey
          ? { AWS_SECRET_ACCESS_KEY: ambientAws.secretKey }
          : {}),
      }),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as {
    name: string;
    services: Record<string, ComposeService>;
    volumes: Record<string, { name: string }>;
  };
}

function renderProductionCompose() {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      "deployment/production/.env.example",
      "-f",
      "deployment/production/compose.yml",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        COMPOSE_ENV_FILE: ".env.example",
        GRAFANA_ENV_FILE: resolve(
          process.cwd(),
          "deployment/production/grafana.env.example",
        ),
      },
    },
  );
  return JSON.parse(output) as { services: Record<string, ComposeService> };
}

describe("canonical local Compose", () => {
  it("retains every service and stable persistence identities without profiles", () => {
    const model = renderCompose();
    expect(Object.keys(model.services).sort()).toEqual([
      "alloy",
      "api",
      "collaboration",
      "gateway",
      "grafana",
      "loki",
      "migrate",
      "node-exporter",
      "node-exporter-network",
      "postgres",
      "prometheus",
      "seaweedfs",
      "web",
      "worker",
    ]);
    expect(model.name).toBe("chalktalk");
    for (const volume of ["postgres-data", "seaweedfs-data", "caddy-data"])
      expect(model.volumes[volume].name).toBe(`chalktalk_${volume}`);
    for (const service of Object.values(model.services))
      expect(service.profiles).toBeUndefined();
  });
  it("keeps data private and process Dockerfiles unchanged", () => {
    const { services } = renderCompose();
    expect(services.postgres.image).toBe("pgvector/pgvector:pg17");
    expect(services.seaweedfs.image).toBe("chrislusf/seaweedfs:4.48");
    expect(services.postgres.ports).toBeUndefined();
    expect(services.seaweedfs.ports).toBeUndefined();
    for (const [service, dockerfile] of Object.entries({
      api: "api",
      migrate: "api",
      worker: "worker",
      collaboration: "collaboration",
      web: "frontend",
    }))
      expect(services[service].build).toMatchObject({
        context: process.cwd(),
        dockerfile: `deployment/local/Dockerfile.${dockerfile}`,
      });
  });
  it("passes resolved application inputs rather than provisioning flags or ambient demo credentials", () => {
    for (const service of ["api", "worker", "collaboration"]) {
      const config = renderCompose().services[service];
      expect(config.environment).toMatchObject({
        EMAIL_PROVIDER: "resend",
        S3_ENDPOINT: "http://seaweedfs:8333",
      });
      for (const key of [
        "LOCAL_DATABASE_ENABLED",
        "LOCAL_OBJECT_STORE_ENABLED",
        "LOCAL_DATABASE_PASSWORD",
        "MOCK_DATA",
        "PIAZZA_DEMO_PASSWORD",
      ])
        expect(config.environment).not.toHaveProperty(key);
      expect(config.depends_on?.postgres).toBeUndefined();
      expect(config.depends_on?.seaweedfs).toBeUndefined();
    }
  });
  it("uses only the distinct bundled store namespace, independently of complete AWS credentials", () => {
    expect(
      renderCompose(undefined, {
        accessKey: "aws-key",
        secretKey: "aws-secret",
      }).services.seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "chalktalk-local",
      AWS_SECRET_ACCESS_KEY: "chalktalk-local-secret",
    });
    expect(
      renderCompose({ accessKey: "local-key", secretKey: "local-secret" })
        .services.seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "local-key",
      AWS_SECRET_ACCESS_KEY: "local-secret",
    });
  });
  it("retains gateway collaboration readiness and independent workers", () => {
    const { services } = renderCompose();
    expect(services.gateway.depends_on?.collaboration?.condition).toBe(
      "service_healthy",
    );
    expect(services.worker.restart).toBe("unless-stopped");
    expect(services.worker.command).toEqual([
      "npm",
      "run",
      "dev:worker",
      "--workspace=@chalktalk/api",
    ]);
  });
});

describe("production Compose", () => {
  it("uses application and private monitoring services with production validation and Resend", () => {
    const services = renderProductionCompose().services;
    expect(Object.keys(services).sort()).toEqual([
      "alloy",
      "api",
      "collaboration",
      "grafana",
      "loki",
      "migrate",
      "node-exporter",
      "node-exporter-network",
      "prometheus",
      "web",
      "worker",
    ]);
    for (const name of ["api", "worker", "collaboration", "migrate"]) {
      expect(services[name].environment).toMatchObject({
        NODE_ENV: "production",
      });
      expect(services[name].environment).toHaveProperty("RESEND_API_KEY");
      expect(services[name].environment).toMatchObject({
        SUPABASE_STORAGE_ENDPOINT:
          "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
        SUPABASE_STORAGE_BUCKET: "chalktalk-resources",
        SUPABASE_STORAGE_REGION: "us-east-1",
      });
      expect(services[name].environment).toHaveProperty(
        "SUPABASE_STORAGE_ACCESS_KEY_ID",
      );
      expect(services[name].environment).toHaveProperty(
        "SUPABASE_STORAGE_SECRET_ACCESS_KEY",
      );
      expect(services[name].environment).not.toHaveProperty("S3_ENDPOINT");
    }
    expect(services.web.environment).not.toHaveProperty("RESEND_API_KEY");
    for (const name of ["migrate", "api", "worker", "collaboration"])
      expect(services[name].environment).not.toHaveProperty(
        "GRAFANA_ADMIN_PASSWORD",
      );
    expect(services.grafana.environment).toHaveProperty(
      "GRAFANA_ADMIN_PASSWORD",
    );
    expect(services.api.ports).toBeUndefined();
  });
});
