/* global process, fetch, AbortSignal, URL */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:19090/api/v1/query_range";
const RUN_ID = /^load-[0-9]{8}-[a-z0-9]{8,32}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const STEP = 15;
const METRICS = [
  {
    key: "p50",
    title: "Mean tagged P50",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p50{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "p90",
    title: "Mean tagged P90",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p90{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "p95",
    title: "Mean tagged P95",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p95{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "p99",
    title: "Mean tagged P99",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p99{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "rate",
    title: "Requests",
    panel: "rate",
    unit: "req/s",
    expression: (id) => `sum(rate(k6_http_reqs_total{testid="${id}"}[1m]))`,
    scale: 1,
  },
  {
    key: "errors",
    title: "Maximum tagged failure fraction",
    panel: "errors",
    unit: "%",
    expression: (id) => `100 * max(k6_http_req_failed_rate{testid="${id}"})`,
    scale: 1,
  },
  {
    key: "vus",
    title: "Users",
    panel: "vus",
    unit: "VUs",
    expression: (id) => `sum(k6_vus{testid="${id}"})`,
    scale: 1,
  },
];

function windowBounds(window) {
  if (!ISO.test(window?.start ?? "") || !ISO.test(window?.end ?? ""))
    throw new Error("Invalid report UTC window");
  const start = Date.parse(window.start) / 1000;
  const end = Date.parse(window.end) / 1000;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > 900
  )
    throw new Error("Report UTC window is outside bounds");
  return { start, end };
}

export async function queryRunSeries(runId, window, fetcher = fetch) {
  if (!RUN_ID.test(runId)) throw new Error("Invalid report run ID");
  const { start, end } = windowBounds(window);
  const output = {};
  for (const metric of METRICS) {
    const url = new URL(BASE);
    url.searchParams.set("query", metric.expression(runId));
    url.searchParams.set("start", String(start));
    url.searchParams.set("end", String(end));
    url.searchParams.set("step", String(STEP));
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok)
      throw new Error(`Report metrics query failed: ${response.status}`);
    const payload = await response.json();
    const result = payload?.data?.result;
    if (
      payload?.status !== "success" ||
      payload.data?.resultType !== "matrix" ||
      !Array.isArray(result)
    )
      throw new Error(`Report ${metric.key}: invalid metrics response`);
    if (result.length !== 1 || !Array.isArray(result[0]?.values))
      throw new Error(`Report ${metric.key}: missing or ambiguous series`);
    if (Object.keys(result[0].metric ?? {}).length)
      throw new Error(`Report ${metric.key}: unexpected labels`);
    const values = result[0].values;
    if (values.length < 2 || values.length > 80)
      throw new Error(`Report ${metric.key}: missing or unbounded data points`);
    let previous = -Infinity;
    output[metric.key] = values.map(([time, value]) => {
      const timestamp = Number(time),
        numeric = Number(value);
      if (
        !Number.isFinite(timestamp) ||
        timestamp < start - STEP ||
        timestamp > end + STEP ||
        timestamp <= previous ||
        !Number.isFinite(numeric) ||
        numeric < 0
      )
        throw new Error(
          `Report ${metric.key}: invalid or unbounded data point`,
        );
      previous = timestamp;
      return [timestamp, numeric * metric.scale];
    });
  }
  return output;
}

function panelSvg(series, start, end, unit) {
  const colors = ["#436f5e", "#d68c44", "#3162a2", "#9a578e"];
  const values = series.flatMap(({ points }) =>
    points.map((point) => point[1]),
  );
  const high = Math.max(1, ...values) * 1.08;
  const x = (time) => 42 + ((time - start) / Math.max(1, end - start)) * 718;
  const y = (value) => 208 - (value / high) * 170;
  const lines = series
    .map(({ title, points }, index) => {
      const path = points
        .map(([time, value]) => `${x(time).toFixed(1)},${y(value).toFixed(1)}`)
        .join(" ");
      const latest = points.at(-1)[1];
      return `<polyline fill="none" stroke="${colors[index]}" stroke-width="2.5" points="${path}"/><text x="${50 + index * 185}" y="24" fill="${colors[index]}" font-size="13">${title}: ${Number(latest.toFixed(2))} ${unit}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 800 245" role="img" aria-label="${unit} time series"><line x1="42" y1="38" x2="42" y2="208" stroke="#8b978e"/><line x1="42" y1="208" x2="760" y2="208" stroke="#8b978e"/><text x="0" y="44" font-size="11">${Number(high.toFixed(1))}</text><text x="12" y="207" font-size="11">0</text>${lines}</svg>`;
}

export function buildReport(runId, window, data, summary) {
  if (!RUN_ID.test(runId)) throw new Error("Invalid report run ID");
  const { start, end } = windowBounds(window);
  const panels = [
    {
      key: "latency",
      title: "Mean of tagged expected-response latency percentiles (ms)",
      unit: "ms",
    },
    { key: "rate", title: "Request rate (req/s)", unit: "req/s" },
    { key: "errors", title: "Maximum tagged HTTP failure fraction (%)", unit: "%" },
    { key: "vus", title: "Active users (VUs)", unit: "VUs" },
  ];
  const sections = panels
    .map((panel) => {
      const selected = METRICS.filter(
        (metric) => metric.panel === panel.key,
      ).map((metric) => ({ title: metric.title, points: data[metric.key] }));
      if (
        selected.some(
          (item) => !Array.isArray(item.points) || item.points.length < 2,
        )
      )
        throw new Error(`Report ${panel.key}: missing required series`);
      return `<section><h2>${panel.title}</h2>${panelSvg(selected, start, end, panel.unit)}</section>`;
    })
    .join("\n");
  const count = summary?.metrics?.http_reqs?.values?.count;
  const aggregate = Number.isFinite(count)
    ? `<p>Completed requests: ${count}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>ChalkTalk load test report</title><style>body{font:16px system-ui,sans-serif;color:#1c392f;background:#f7f7f1;max-width:1000px;margin:auto;padding:32px}h1{font-size:32px}section{background:white;padding:20px;margin:20px 0;border:1px solid #ced8cc;border-radius:12px}h2{font-size:20px}svg{width:100%;height:auto}</style></head><body><h1>ChalkTalk load test</h1><p>Run ${runId} · ${window.start} to ${window.end}</p><p>Source: private Prometheus k6 remote-write; duration data converted once from seconds to milliseconds. Each chart has one unit and one Y axis.</p>${aggregate}${sections}</body></html>`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [runId, windowPath, summaryPath, outputPath] = process.argv.slice(2);
  try {
    const window = JSON.parse(readFileSync(windowPath, "utf8"));
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const data = await queryRunSeries(runId, window);
    writeFileSync(outputPath, buildReport(runId, window, data, summary), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    process.stderr.write(`Load report unavailable: ${error.message}\n`);
    process.exitCode = 1;
  }
}
