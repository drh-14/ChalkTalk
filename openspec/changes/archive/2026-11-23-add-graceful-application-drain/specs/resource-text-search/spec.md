## ADDED Requirements

### Requirement: Graceful drain separates extraction claim stop from active cancellation

Worker graceful drain SHALL stop new extraction and searchable-PDF claims without immediately cancelling admitted attempts. Active attempts SHALL retain required lease heartbeats, child-process ownership, storage publication fences and temporary cleanup through confirmed outcome settlement. In-flight heartbeat queries SHALL settle before dependency closure and SHALL NOT revive released work. Existing job deadlines and lease-loss cancellation SHALL remain effective. Application deadline expiry MAY force cancellation/child termination but SHALL produce failed timeout drain, not fake success or unconditional lease reset/requeue. A failed or zero-row ownership fence SHALL fail drain.

#### Scenario: Extraction continues while claims stop

- **WHEN** SIGTERM arrives while an OCR child is active and another extraction job is queued
- **THEN** no new claim starts, the active child and lease heartbeat continue until confirmed outcome, and pool closure waits for outstanding heartbeat queries and child close

#### Scenario: Lease loss during drain

- **WHEN** an active extraction attempt loses its lease while draining
- **THEN** cancellation and fenced publication rules remain enforced and successful drain is prohibited

#### Scenario: Long extraction exceeds application deadline

- **WHEN** extraction or searchable-PDF generation cannot settle by the application deadline
- **THEN** cancellation/child termination and required cleanup are attempted, the process exits 2, and neither lease reset nor a queued row is represented as successful drain
