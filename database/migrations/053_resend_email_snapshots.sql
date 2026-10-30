-- Exact provider payloads survive a worker/network failure. They are cleared on
-- success or cancellation and contain sensitive email bodies and inline images.
ALTER TABLE jobs ADD COLUMN frozen_email jsonb;
ALTER TABLE digest_outbox ADD COLUMN frozen_email jsonb;
