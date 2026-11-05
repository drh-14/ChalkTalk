# Context

The qpdf wrapper currently rejects every nonzero exit code. qpdf documents 3 as completion with warnings and 2 as failure. The supplied PDF reconstructs its xref, yields 18 pages and contains no forbidden names.

# Decision

Accept exit codes 0 and 3 from each existing qpdf invocation. Continue rejecting scanner failures, fatal/nonstandard exits, missing processes and signals. Keep all existing header/trailer, page count, output bounds and timeout checks. Recovery is in-memory parser behavior: do not rewrite stored or downloaded originals.

# Validation

Generate a small PDF with a deliberately wrong startxref offset, prove qpdf exits 3, and test acceptance. Test the same structural defect with a JavaScript action remains rejected, alongside existing malformed-PDF coverage. Add an HTTP round-trip case to prove original bytes and download headers are preserved. Verify the supplied PDF directly in the running API container.

# Delivery

User requested demo testing first and explicitly deferred no-mistakes. Keep the branch local and defer the gate, commit/publication and archival until delivery work resumes.
