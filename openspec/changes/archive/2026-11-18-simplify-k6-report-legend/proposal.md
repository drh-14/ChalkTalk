## Why

The k6 report repeats the last plotted value in every legend and displays a verbose source footer. These elements add clutter without helping identify series or read point values.

## What Changes

- Show only colored series names in chart legends, without a “Last” column or numeric values.
- Remove the “Source:” footer from the downloadable HTML report while retaining the short production-wide API metrics label and point-hover values.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bounded-load-testing`: simplify the downloadable report's visible legend and footer.

## Impact

Only the generated `deployment/load-test/report.mjs` HTML, its tests, and the report specification change. No load generation, query, or application behavior changes.
