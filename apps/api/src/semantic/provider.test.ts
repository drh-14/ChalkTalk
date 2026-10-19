import { afterEach, expect, it, vi } from "vitest";
import { EmbeddingProvider, readEmbeddingConfig } from "./provider.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps embeddings disabled without a deployment key", () => {
  expect(readEmbeddingConfig({})).toBeUndefined();
});

it("allows local HTTP embedding servers but rejects sending a key over remote plaintext HTTP", () => {
  expect(
    readEmbeddingConfig({
      EMBEDDING_API_KEY: "key",
      EMBEDDING_BASE_URL: "http://localhost:8080/v1",
    })?.endpoint,
  ).toBe("http://localhost:8080/v1/embeddings");
  expect(() =>
    readEmbeddingConfig({
      EMBEDDING_API_KEY: "key",
      EMBEDDING_BASE_URL: "http://embeddings.example/v1",
    }),
  ).toThrow(/HTTPS/i);
});

it("changes the vector generation when endpoint or model changes", () => {
  const first = readEmbeddingConfig({
    EMBEDDING_API_KEY: "key",
    EMBEDDING_MODEL: "m1",
  })!;
  const model = readEmbeddingConfig({
    EMBEDDING_API_KEY: "key",
    EMBEDDING_MODEL: "m2",
  })!;
  const endpoint = readEmbeddingConfig({
    EMBEDDING_API_KEY: "key",
    EMBEDDING_MODEL: "m1",
    EMBEDDING_BASE_URL: "https://other.example/v1",
  })!;
  expect(first.generation).not.toBe(model.generation);
  expect(first.generation).not.toBe(endpoint.generation);
  expect(first.generation).not.toContain("key");
});

it("sends only bounded text and model to a configurable compatible endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const config = readEmbeddingConfig({
    EMBEDDING_API_KEY: "secret-key",
    EMBEDDING_BASE_URL: "https://embeddings.example/v1/",
    EMBEDDING_MODEL: "course-model",
  })!;
  const provider = new EmbeddingProvider(config);
  expect(await provider.embed("related question")).toEqual([1, 0]);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://embeddings.example/v1/embeddings",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer secret-key" }),
      body: JSON.stringify({
        input: "related question",
        model: "course-model",
        encoding_format: "float",
      }),
    }),
  );
});

it("rejects invalid vectors rather than passing them to SQL", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [1, null] }] }),
        {
          status: 200,
        },
      ),
    ),
  );
  const provider = new EmbeddingProvider(
    readEmbeddingConfig({ EMBEDDING_API_KEY: "secret", EMBEDDING_MODEL: "m" })!,
  );
  await expect(provider.embed("query")).rejects.toThrow(/embedding/i);
});

it("validates ordering and dimensions of bounded batch embeddings", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  const provider = new EmbeddingProvider(
    readEmbeddingConfig({ EMBEDDING_API_KEY: "secret", EMBEDDING_MODEL: "m" })!,
  );
  await expect(provider.embedMany(["first", "second"])).resolves.toEqual([
    [1, 0],
    [0, 1],
  ]);
});

it("rejects a streamed provider response above one MiB", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response("x".repeat(1_000_001), { status: 200 })),
  );
  const provider = new EmbeddingProvider(
    readEmbeddingConfig({ EMBEDDING_API_KEY: "secret", EMBEDDING_MODEL: "m" })!,
  );
  await expect(provider.embed("query")).rejects.toThrow(/too large/i);
});
