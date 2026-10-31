## Decision

The Threads view stops importing and invoking the attachment-upload client. It continues rendering the attachment list returned by the existing message API. The upload API stays available for compatibility and existing files remain downloadable. A Threads-scoped CSS override scales button minimum height and padding to about 80% of their current values; global buttons are unchanged.
