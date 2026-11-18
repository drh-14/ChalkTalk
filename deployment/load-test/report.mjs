/* global process, fetch, AbortSignal, URL */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:19090/api/v1/query_range";
const RUN_ID = /^load-[0-9]{8}-[a-z0-9]{8,32}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const STEP = 15;
const METRICS = [
  {
    key: "p50",
    title: "Average tagged P50",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p50{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "p90",
    title: "Average tagged P90",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p90{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "p95",
    title: "Average tagged P95",
    panel: "latency",
    unit: "ms",
    expression: (id) =>
      `avg(k6_http_req_duration_p95{testid="${id}",expected_response="true"})`,
    scale: 1000,
  },
  {
    key: "p99",
    title: "Average tagged P99",
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
  ...[
    [
      "dbQueryP50",
      "Database query time",
      "db-p50",
      "chalktalk_db_query_duration_seconds_bucket",
      "0.5",
    ],
    [
      "dbQueryP95",
      "Database query time",
      "db-p95",
      "chalktalk_db_query_duration_seconds_bucket",
      "0.95",
    ],
    [
      "poolAcquireP50",
      "Pool acquire time",
      "db-p50",
      "chalktalk_db_pool_acquire_duration_seconds_bucket",
      "0.5",
    ],
    [
      "poolAcquireP95",
      "Pool acquire time",
      "db-p95",
      "chalktalk_db_pool_acquire_duration_seconds_bucket",
      "0.95",
    ],
  ].map(([key, title, panel, histogram, quantile]) => ({
    key,
    title,
    panel,
    unit: "ms",
    productionWide: true,
    expression: () =>
      `histogram_quantile(${quantile}, sum by (le) (rate(${histogram}{job="chalktalk-api"}[5m])))`,
    scale: 1000,
  })),
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
    output[metric.key] = values.flatMap(([time, value]) => {
      const timestamp = Number(time),
        numeric = Number(value);
      if (
        !Number.isFinite(timestamp) ||
        timestamp < start - STEP ||
        timestamp > end + STEP ||
        timestamp <= previous
      )
        throw new Error(
          `Report ${metric.key}: invalid or unbounded data point`,
        );
      previous = timestamp;
      // Idle API histograms can yield NaN before the first request. Do not
      // turn those absent observations into zero-latency measurements.
      if (metric.productionWide && value === "NaN") return [];
      if (!Number.isFinite(numeric) || numeric < 0)
        throw new Error(
          `Report ${metric.key}: invalid or unbounded data point`,
        );
      return [[timestamp, numeric * metric.scale]];
    });
    if (output[metric.key].length < 2)
      throw new Error(`Report ${metric.key}: missing telemetry samples`);
  }
  return output;
}

function format(value) {
  return Number(value.toFixed(2)).toString();
}

function panelSvg(series, start, end, unit, title) {
  const colors = ["#19a88f", "#4a78cb", "#9d6bdf", "#8762c9"];
  const values = series.flatMap(({ points }) =>
    points.map((point) => point[1]),
  );
  const high = Math.max(1, ...values) * 1.08;
  const left = 43,
    right = 493,
    top = 27,
    bottom = 171;
  const x = (time) =>
    left + ((time - start) / Math.max(1, end - start)) * (right - left);
  const y = (value) => bottom - (value / high) * (bottom - top);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const row = bottom - fraction * (bottom - top);
      return `<line x1="${left}" y1="${row}" x2="${right}" y2="${row}" class="gridline"/><text x="36" y="${row + 3}" text-anchor="end" class="axis-label">${format(high * fraction)}</text>`;
    })
    .join("");
  const verticalGrid = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const column = left + fraction * (right - left);
      return `<line x1="${column}" y1="${top}" x2="${column}" y2="${bottom}" class="gridline vertical-grid"/>`;
    })
    .join("");
  const lines = series
    .map(({ points }, index) => {
      const path = points
        .map(([time, value]) => `${x(time).toFixed(1)},${y(value).toFixed(1)}`)
        .join(" ");
      const fill =
        series.length === 1
          ? `<polygon points="${x(points[0][0]).toFixed(1)},${bottom} ${path} ${x(points.at(-1)[0]).toFixed(1)},${bottom}" fill="${colors[index]}" fill-opacity=".14"/>`
          : "";
      return `${fill}<polyline fill="none" stroke="${colors[index]}" stroke-width="2" stroke-linejoin="round" points="${path}"/>`;
    })
    .join("");
  const timeLabel = (time) => new Date(time * 1000).toISOString().slice(11, 16);
  const hoverPoints = new Map();
  series.forEach(({ title: seriesTitle, points }, index) => {
    points.forEach(([time, value]) => {
      const key = `${time}:${value}`;
      const point = hoverPoints.get(key);
      if (point) point.titles.push(seriesTitle);
      else hoverPoints.set(key, { time, value, index, titles: [seriesTitle] });
    });
  });
  const orderedPoints = [...hoverPoints.values()]
    .map((point) => ({ ...point, row: y(point.value) }))
    .sort((a, b) => a.time - b.time || a.row - b.row);
  const hoverGroups = [];
  for (const point of orderedPoints) {
    const group = hoverGroups.at(-1);
    if (
      group &&
      group.at(-1).time === point.time &&
      point.row - group.at(-1).row <= 10
    )
      group.push(point);
    else hoverGroups.push([point]);
  }
  const hoverTargets = hoverGroups
    .flatMap((group) => {
      const timestamp = new Date(group[0].time * 1000)
        .toISOString()
        .slice(11, 19);
      const values = group.flatMap(({ value, titles }) =>
        titles.map((seriesTitle) => `${seriesTitle}: ${format(value)} ${unit}`),
      );
      const tooltip = `${timestamp} UTC · ${values.join(" · ")}`;
      return group.map(({ time, index, row }) => {
        const column = x(time).toFixed(1);
        return `<g class="hover-target"><line x1="${column}" y1="${top}" x2="${column}" y2="${bottom}" class="crosshair"/><circle cx="${column}" cy="${row.toFixed(1)}" r="2" fill="${colors[index]}" class="dot"/><ellipse cx="${column}" cy="${row.toFixed(1)}" rx="3.5" ry="5" fill="transparent" pointer-events="all"><title>${tooltip}</title></ellipse></g>`;
      });
    })
    .join("");
  const timeTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const timestamp = start + fraction * (end - start);
      const column = left + fraction * (right - left);
      return `<text x="${column}" y="198" text-anchor="middle" class="axis-label">${timeLabel(timestamp)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 520 222" role="img" aria-label="${title}: ${unit} over time"><title>${title}: ${unit} over time</title>${verticalGrid}${grid}<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"/>${lines}${hoverTargets}${timeTicks}<text x="${right}" y="214" text-anchor="end" class="axis-label">UTC</text></svg>`;
}

function panelMarkup(panel, data, start, end) {
  const selected = METRICS.filter((metric) => metric.panel === panel.key).map(
    (metric) => ({ title: metric.title, points: data[metric.key] }),
  );
  if (
    selected.some(
      (item) => !Array.isArray(item.points) || item.points.length < 2,
    )
  )
    throw new Error(`Report ${panel.key}: missing required series`);
  const colors = ["#19a88f", "#4a78cb", "#9d6bdf", "#8762c9"];
  const legend = selected
    .map(
      ({ title }, index) =>
        `<li><span class="legend-name"><span class="swatch" style="background:${colors[index]}"></span>${title}</span></li>`,
    )
    .join("");
  return `<article class="chart-card"><h3>${panel.title}</h3>${panelSvg(selected, start, end, panel.unit, panel.title)}<ul class="legend">${legend}</ul></article>`;
}

export function buildReport(runId, window, data, summary) {
  if (!RUN_ID.test(runId)) throw new Error("Invalid report run ID");
  const { start, end } = windowBounds(window);
  const overview = [
    {
      key: "latency",
      title: "Average of tagged expected-response latency percentiles (ms)",
      unit: "ms",
    },
    { key: "rate", title: "Request rate (req/s)", unit: "req/s" },
    {
      key: "errors",
      title: "Maximum tagged HTTP failure fraction (%)",
      unit: "%",
    },
    { key: "vus", title: "Active users (VUs)", unit: "VUs" },
  ];
  const timings = [
    { key: "db-p50", title: "P50 database latency (ms)", unit: "ms" },
    { key: "db-p95", title: "P95 database latency (ms)", unit: "ms" },
  ];
  const count = summary?.metrics?.http_reqs?.values?.count;
  const aggregate = Number.isFinite(count)
    ? `<div class="request-count">Completed requests: <strong>${count}</strong></div>`
    : "";
  const cards = (panels) =>
    panels.map((panel) => panelMarkup(panel, data, start, end)).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>ChalkTalk load test report</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#2f3437;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}.report{max-width:1180px;margin:0 auto;padding:24px 28px 56px}.masthead{display:flex;align-items:center;gap:12px;border-bottom:1px solid #e9eaed;padding-bottom:14px}.brand{display:inline-grid;place-items:center;width:27px;height:27px;background:#7d55d9;color:#fff;border-radius:5px;font-size:13px;font-weight:800}.masthead h1{font-size:22px;font-weight:650;margin:0}.metadata{color:#6d7379;margin:12px 0 26px}.request-count{background:#f7f7f9;border:1px solid #e8e8ed;border-radius:6px;display:inline-block;padding:8px 12px;margin:0 0 14px}.chapter{margin-top:23px}.chapter-head{border-left:4px solid #e2e2e7;padding-left:10px;margin:0 0 16px}.chapter h2{font-size:21px;line-height:1.2;margin:0 0 3px}.chapter p{color:#747a80;margin:0}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.chart-card{border:1px solid #e8e9ed;border-radius:6px;padding:16px 16px 12px;min-width:0}.chart-card h3{font-size:14px;font-weight:630;margin:0 0 12px;min-height:42px}.chart-card svg{display:block;width:100%;height:auto}.gridline{stroke:#e6e8ec;stroke-width:1}.vertical-grid{stroke:#f0f1f3}.crosshair{stroke:#75849a;stroke-width:1;stroke-dasharray:3 3;opacity:0;pointer-events:none}.dot{opacity:.8;pointer-events:none}.hover-target:hover .crosshair,.hover-target:hover .dot{opacity:1}.axis{stroke:#aeb6bb;stroke-width:1}.axis-label{fill:#8c9297;font-size:11px}.legend{list-style:none;margin:0;padding:4px 0 0;color:#626970;font-size:11px}.legend li{padding:3px 0;border-bottom:1px solid #f1f2f3}.legend li:last-child{border-bottom:0}.legend-name{min-width:0}.swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}.source-label{color:#747a80;font-size:12px;margin:0 0 12px!important}@media(max-width:720px){.report{padding:18px 14px 40px}.masthead h1{font-size:19px}.charts{grid-template-columns:1fr}.chart-card{padding:13px}.chart-card h3{min-height:0}.legend-name{overflow-wrap:anywhere}}
</style></head><body><main class="report"><header class="masthead"><span class="brand" aria-hidden="true">k6</span><h1>Report: ChalkTalk load test</h1></header><p class="metadata">Run ${runId} · ${window.start} to ${window.end}</p>${aggregate}<section class="chapter" aria-labelledby="overview-title"><div class="chapter-head"><h2 id="overview-title">Overview</h2><p>Client requests, response time, failures, and active users during this run</p></div><div class="charts">${cards(overview)}</div></section><section class="chapter" aria-labelledby="timings-title"><div class="chapter-head"><h2 id="timings-title">Timings</h2><p>API database-client latency alongside the load-test window</p></div><p class="source-label">Production-wide API metrics · Prometheus · milliseconds</p><div class="charts">${cards(timings)}</div></section></main></body></html>`;
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
