-- Lets one processor claim an inbox event atomically. A PROCESSING event whose
-- claim is older than the takeover window (crashed processor) can be claimed
-- again; a fresh claim cannot, so two processors never evaluate one event.
ALTER TABLE event_inbox ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
