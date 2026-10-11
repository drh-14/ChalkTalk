import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type ComposeService = {
  image?: string;
  command?: string[] | string;
  profiles?: string[];
  environment?: Record<string, string>;
  ports?: Array<{ host_ip?: string; published: string; target: number }>;
  volumes?: Array<{ source: string; target: string; type: string }>;
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
        COMPOSE_PROFILES: "",
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
