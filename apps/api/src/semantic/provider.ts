import { createHash } from "node:crypto";

export type EmbeddingConfig = {
  key: string;
  endpoint: string;
  model: string;
  generation: string;
};

export function readEmbeddingConfig(
  source: NodeJS.ProcessEnv = process.env,
): EmbeddingConfig | undefined {
  const key = source.EMBEDDING_API_KEY?.trim();
  if (!key) return undefined;
  const base = new URL(
    source.EMBEDDING_BASE_URL ?? "https://api.openai.com/v1/",
  );
  if (!["https:", "http:"].includes(base.protocol))
    throw new Error("EMBEDDING_BASE_URL must use HTTP or HTTPS");
  if (
    base.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new Error("EMBEDDING_BASE_URL must use HTTPS outside localhost");
  const model = source.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  if (model.length > 200) throw new Error("EMBEDDING_MODEL is too long");
  const endpoint = new URL(
    "embeddings",
    base.href.endsWith("/") ? base : `${base.href}/`,
  ).href;
  return {
    key,
    endpoint,
    model,
    generation: createHash("sha256")
      .update(`${endpoint}\0${model}`)
      .digest("hex"),
  };
}

export class EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  async embedMany(inputs: string[], timeoutMs = 10_000): Promise<number[][]> {
    if (inputs.length < 1 || inputs.length > 8)
      throw new Error("Embedding batch size is invalid");
    return this.request(inputs, timeoutMs);
  }

  private async request(
    inputs: string[],
    timeoutMs: number,
  ): Promise<number[][]> {
    const count = inputs.length;
    if (inputs.some((item) => !item.trim() || item.length > 8_192))
      throw new Error("Embedding input is invalid");
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: inputs,
        model: this.config.model,
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("Embedding provider failed");
    if (Number(response.headers.get("Content-Length") ?? 0) > 1_000_000)
      throw new Error("Embedding response is too large");
    const bytes: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Embedding response is empty");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new Error("Embedding response is too large");
      }
      bytes.push(value);
    }
    const body = JSON.parse(Buffer.concat(bytes).toString("utf8")) as {
      data?: { index?: number; embedding?: unknown }[];
    };
    if (!Array.isArray(body.data) || body.data.length !== count)
      throw new Error("Embedding provider returned an invalid batch");
    const ordered = new Array<number[]>(count);
    for (const item of body.data) {
      const vector = item.embedding;
      if (
        !Number.isInteger(item.index) ||
        item.index! < 0 ||
        item.index! >= count ||
        ordered[item.index!] ||
        !Array.isArray(vector) ||
        vector.length < 1 ||
        vector.length > 16_000 ||
        vector.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        ) ||
        vector.every((value) => value === 0)
      )
        throw new Error("Embedding provider returned an invalid vector");
      ordered[item.index!] = vector as number[];
    }
    if (
      ordered.some((vector) => !vector || vector.length !== ordered[0]!.length)
    )
      throw new Error(
        "Embedding provider returned inconsistent vector dimensions",
      );
    return ordered;
  }
}
