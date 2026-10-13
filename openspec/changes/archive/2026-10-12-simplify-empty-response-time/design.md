## Context

The statistics view currently renders a sentence for a null average response time. Both that sentence and numeric values use the same `statistics-metric-value` class, which applies a 2rem, bold style.

## Goals / Non-Goals

**Goals:** Replace the long empty-state sentence with a compact value while keeping the two metric cards visually consistent.

**Non-Goals:** Change the API's null response, the response time calculation, or other metric styles.

## Decisions

Use the API's existing null value to render “No answers” while retaining the existing numeric formatting for non-null values. Keep the shared metric value class on both cards, so both values have the same size and bold weight. No CSS override or new component is needed.

## Risks / Trade-offs

- “No answers” can be read as no answer cards at all, even when unendorsed cards exist. The caption establishes that this metric measures time to an endorsed answer; the API remains null so data consumers retain the distinction.
