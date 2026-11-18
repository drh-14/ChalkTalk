## Context

The current static HTML generator in `deployment/load-test/report.mjs` builds legend rows with a final value and adds a source footer. The report is self-contained with no client scripts.

## Goals / Non-Goals

**Goals:** Remove redundant visual text while preserving point data, color association, and the production-wide scope label.

**Non-Goals:** Change Prometheus queries, chart data, hover mechanics, or production workload.

## Decisions

Render legend rows as swatch plus name only, and remove the legend heading rather than retaining a one-column table header. Remove only the footer starting “Source:”; keep the short database scope label because it distinguishes production-wide telemetry from k6-only series. Point tooltips remain unchanged as the place to read individual values.

## Risks / Trade-offs

[Last value is no longer visible without hovering] → Point hover exposes values and remains covered by browser and generator tests.
