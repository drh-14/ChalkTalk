import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type ComposeService = {
  image?: string;
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
  profile?: string,
) {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      ...(profile ? ["--profile", profile] : []),
      "config",
      "--format",
      "json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        COMPOSE_PROFILES: profile,
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

describe("default Compose object storage", () => {
  it("starts a pinned single-node SeaweedFS service with localhost S3 and a named data volume", () => {
    const configuration = renderCompose();
    const seaweedfs = configuration.services.seaweedfs;

    expect(Object.keys(configuration.services).sort()).toEqual([
      "mailpit",
      "postgres",
      "seaweedfs",
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
    const configuration = renderCompose(undefined, undefined, "app");
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
  it("runs only in the app profile, after migrations, with independent restart and dependencies", () => {
    expect(renderCompose().services.worker).toBeUndefined();
    const configuration = renderCompose(undefined, undefined, "app");
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
