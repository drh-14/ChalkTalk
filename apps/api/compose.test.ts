import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
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
    "docker",
    ["compose", "--env-file", ".env.example", "config", "--format", "json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        COMPOSE_ENV_FILE: ".env.example",
        SEAWEEDFS_ACCESS_KEY_ID: credentials?.accessKey ?? "",
        SEAWEEDFS_SECRET_ACCESS_KEY: credentials?.secretKey ?? "",
        AWS_ACCESS_KEY_ID: ambientAws?.accessKey ?? "",
        AWS_SECRET_ACCESS_KEY: ambientAws?.secretKey ?? "",
      },
    },
  );
  return JSON.parse(output) as {
    services: Record<string, ComposeService>;
    volumes: Record<string, unknown>;
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
      },
    },
  );
  return JSON.parse(output) as { services: Record<string, ComposeService> };
}

describe("default Compose object storage", () => {
  it("resolves default and overridden environment files from the repository root", () => {
    for (const envFile of [undefined, ".env.example"]) {
      const output = execFileSync(
        "docker",
        [
          "compose",
          "--env-file",
          ".env.example",
          "config",
          "--no-env-resolution",
          "--format",
          "json",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, COMPOSE_ENV_FILE: envFile ?? "" },
        },
      );
      const configuration = JSON.parse(output) as {
        services: Record<string, { env_file: Array<{ path: string }> }>;
      };
      for (const service of [
        "migrate",
        "api",
        "worker",
        "collaboration",
        "web",
      ])
        expect(configuration.services[service].env_file).toEqual([
          { path: resolve(process.cwd(), envFile ?? ".env") },
        ]);
    }
  });

  it("keeps checkout-derived project and volume names for local commands", () => {
    for (const files of [[], ["-f", "docker-compose.yml"]]) {
      const output = execFileSync(
        "docker",
        [
          "compose",
          "--env-file",
          ".env.example",
          ...files,
          "config",
          "--format",
          "json",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            COMPOSE_PROJECT_NAME: "",
            COMPOSE_ENV_FILE: ".env.example",
          },
        },
      );
      const configuration = JSON.parse(output) as {
        name: string;
        volumes: Record<string, { name: string }>;
      };
      const project = basename(process.cwd()).toLowerCase();
      expect(configuration.name).toBe(project);
      expect(configuration.volumes["postgres-data"].name).toBe(
        `${project}_postgres-data`,
      );
      expect(configuration.volumes["seaweedfs-data"].name).toBe(
        `${project}_seaweedfs-data`,
      );
    }
  });

  it("provisions pgvector and runs its schema migration in the main local stack", () => {
    const configuration = renderCompose();
    expect(configuration.services.postgres.image).toBe(
      "pgvector/pgvector:pg17",
    );
    expect(configuration.services.migrate.command).toEqual([
      "sh",
      "-c",
      "npm run db:migrate && npm run migrate:semantic --workspace=@chalktalk/api",
    ]);
  });

  it("uses named local Dockerfiles for each application process", () => {
    const services = renderCompose().services;
    for (const [service, dockerfile] of Object.entries({
      api: "Dockerfile.api",
      migrate: "Dockerfile.api",
      worker: "Dockerfile.worker",
      collaboration: "Dockerfile.collaboration",
      web: "Dockerfile.frontend",
    })) {
      expect(services[service].build).toMatchObject({
        context: process.cwd(),
        dockerfile: `deployment/local/${dockerfile}`,
      });
    }
  });

  it("starts a pinned single-node SeaweedFS service with localhost S3 and a named data volume", () => {
    const configuration = renderCompose();
    const seaweedfs = configuration.services.seaweedfs;

    expect(Object.keys(configuration.services).sort()).toEqual([
      "api",
      "collaboration",
      "elasticsearch",
      "elasticsearch-init",
      "grafana",
      "logstash",
      "migrate",
      "postgres",
      "prometheus",
      "seaweedfs",
      "web",
      "worker",
    ]);
    expect(seaweedfs.image).toBe("chrislusf/seaweedfs:4.48");
    expect(seaweedfs.command).toContain("mini");
    expect(seaweedfs.profiles).toBeUndefined();
    expect(seaweedfs.ports).toContainEqual(
      expect.objectContaining({
        host_ip: "127.0.0.1",
        published: "8333",
        target: 8333,
      }),
    );
    expect(seaweedfs.volumes).toContainEqual(
      expect.objectContaining({
        source: "seaweedfs-data",
        target: "/data",
        type: "volume",
      }),
    );
    expect(configuration.volumes).toHaveProperty("seaweedfs-data");
  });

  it("supplies local S3 credentials by default and accepts overrides", () => {
    expect(renderCompose().services.seaweedfs.environment).toMatchObject({
      AWS_ACCESS_KEY_ID: "chalktalk-local",
      AWS_SECRET_ACCESS_KEY: "chalktalk-local-secret",
    });
    expect(
      renderCompose({ accessKey: "custom-key", secretKey: "custom-secret" })
        .services.seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "custom-key",
      AWS_SECRET_ACCESS_KEY: "custom-secret",
    });
  });

  it("waits for authenticated S3 readiness before starting the API", () => {
    const configuration = renderCompose();
    expect(configuration.services.api.depends_on?.seaweedfs).toMatchObject({
      condition: "service_healthy",
    });
    expect(configuration.services.seaweedfs.healthcheck?.test).toEqual([
      "CMD-SHELL",
      expect.any(String),
    ]);
  });

  it("keeps ambient AWS account credentials out of the SeaweedFS credential pair", () => {
    expect(
      renderCompose(undefined, {
        accessKey: "aws-account-key",
        secretKey: "aws-account-secret",
      }).services.seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "chalktalk-local",
      AWS_SECRET_ACCESS_KEY: "chalktalk-local-secret",
    });
    expect(
      renderCompose(undefined, { accessKey: "aws-account-key" }).services
        .seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "chalktalk-local",
      AWS_SECRET_ACCESS_KEY: "chalktalk-local-secret",
    });
    expect(
      renderCompose(undefined, { secretKey: "aws-account-secret" }).services
        .seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "chalktalk-local",
      AWS_SECRET_ACCESS_KEY: "chalktalk-local-secret",
    });
    expect(
      renderCompose(
        { accessKey: "custom-key", secretKey: "custom-secret" },
        { accessKey: "aws-account-key", secretKey: "aws-account-secret" },
      ).services.seaweedfs.environment,
    ).toMatchObject({
      AWS_ACCESS_KEY_ID: "custom-key",
      AWS_SECRET_ACCESS_KEY: "custom-secret",
    });
  });
});

describe("application Compose worker", () => {
  it("runs by default after migrations, with independent restart and dependencies", () => {
    const configuration = renderCompose();
    const worker = configuration.services.worker;
    expect(worker).toBeDefined();
    expect(worker.command).toEqual([
      "npm",
      "run",
      "dev:worker",
      "--workspace=@chalktalk/api",
    ]);
    expect(worker.restart).toBe("unless-stopped");
    expect(worker.depends_on?.migrate.condition).toBe(
      "service_completed_successfully",
    );
    expect(worker.depends_on?.seaweedfs.condition).toBe("service_healthy");
    expect(worker.environment).toMatchObject({
      EMAIL_PROVIDER: "resend",
      NODE_ENV: "development",
      S3_ENDPOINT: "http://seaweedfs:8333",
      S3_BUCKET: "chalktalk-resources",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "chalktalk-local",
      S3_SECRET_ACCESS_KEY: "chalktalk-local-secret",
    });
    expect(worker.volumes).toContainEqual(
      expect.objectContaining({
        source: "worker-node-modules",
        target: "/app/node_modules",
      }),
    );
  });
});

describe("production Compose", () => {
  it("uses only application services with production validation and Resend", () => {
    const services = renderProductionCompose().services;
    expect(Object.keys(services).sort()).toEqual([
      "api",
      "collaboration",
      "migrate",
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
    expect(services.api.ports).toBeUndefined();
  });
});
