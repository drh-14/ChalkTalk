## Approach

Change only the provisioned Grafana JSON and its dashboard verification. Reuse the existing p50/p95 histogram-quantile expressions and legends for p90/p99, substituting 0.9 and 0.99. Keep panel IDs 3, 4, and 5 stable; add a new ID for p90. Place the four panels in a two-by-two grid above the existing remaining panels. Set Grafana's `showLegend` false on the single-series 5xx fraction panel. Remove panel 6 rather than disabling its query.

No new metrics, dependencies, or application behavior are required. Existing endpoint-specific chart queries and layout stay unchanged.

Set explicit Grafana `legendFormat` labels for all visible time-series targets, including existing endpoint charts. Keep route or process distinctions and percentile information while replacing jargon (`HTTP`, `DB pool`) with `Response`, `Database query`, and `Connection wait` language. The log panel is not a time series and needs no legend.
