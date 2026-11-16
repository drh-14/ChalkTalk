/* global AbortSignal, URL, console, fetch, module, process, require */
const checks = [
  ...[
    "chalktalk-api",
    "chalktalk-worker",
    "chalktalk-collaboration",
    "chalktalk-vm",
    "chalktalk-vm-network",
  ].map((job) => ({
    label: job,
    expression: `up{job="${job}"}`,
    up: true,
  })),
  {
    label: "HTTP duration",
    expression:
      'chalktalk_http_request_duration_seconds_bucket{job="chalktalk-api"}',
  },
  {
    label: "DB query duration",
    expression:
      'chalktalk_db_query_duration_seconds_bucket{job="chalktalk-api"}',
  },
  {
    label: "DB pool duration",
    expression:
      'chalktalk_db_pool_acquire_duration_seconds_bucket{job="chalktalk-api"}',
  },
  {
    label: "host CPU",
    expression: 'node_cpu_seconds_total{job="chalktalk-vm",mode="idle"}',
  },
  {
    label: "host memory available",
    expression: 'node_memory_MemAvailable_bytes{job="chalktalk-vm"}',
  },
  {
    label: "host memory total",
    expression: 'node_memory_MemTotal_bytes{job="chalktalk-vm"}',
  },
  {
    label: "host network receive",
    expression:
      'node_network_receive_bytes_total{job="chalktalk-vm-network",device!~"lo|veth.*"}',
  },
  {
    label: "host network transmit",
    expression:
      'node_network_transmit_bytes_total{job="chalktalk-vm-network",device!~"lo|veth.*"}',
  },
  {
    label: "host disk read",
    expression:
      'node_disk_read_bytes_total{job="chalktalk-vm",device!~"loop.*|ram.*"}',
  },
  {
    label: "host disk write",
    expression:
      'node_disk_written_bytes_total{job="chalktalk-vm",device!~"loop.*|ram.*"}',
  },
  {
    label: "host filesystem available",
    expression:
      'node_filesystem_avail_bytes{job="chalktalk-vm",fstype!~"tmpfs|overlay|squashfs",mountpoint!~"/run.*|/host_mnt.*|/oldroot.*|/var/lib/docker/.+"}',
  },
];

async function verifyMetrics(query, now = Math.floor(Date.now() / 1000)) {
  for (const { label, expression, up } of checks) {
    const response = await query(expression, now);
    if (
      response.status !== "success" ||
      response.data?.resultType !== "matrix"
    ) {
      throw new Error(`${label}: Prometheus query failed`);
    }
    const fresh = response.data.result.some(({ values }) => {
      const samples = values.filter(
        ([time, value]) =>
          time >= now - 150 &&
          time <= now + 15 &&
          Number.isFinite(Number(value)),
      );
      return samples.length >= 2 && (!up || Number(samples.at(-1)[1]) === 1);
    });
    if (!fresh)
      throw new Error(
        `${label}: ${up ? "up=1 not observed with fresh samples" : "fewer than two fresh samples"}`,
      );
    process.stdout.write(`${label}: two fresh samples${up ? ", up=1" : ""}\n`);
  }
}

async function queryPrometheus(expression, now) {
  const url = new URL("http://prometheus:9090/api/v1/query");
  url.searchParams.set("query", `${expression}[3m]`);
  url.searchParams.set("time", String(now));
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Prometheus returned ${response.status}`);
  return response.json();
}

module.exports = { queryPrometheus, verifyMetrics };
if (require.main === module || process.argv[1] === "-") {
  verifyMetrics(queryPrometheus).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
