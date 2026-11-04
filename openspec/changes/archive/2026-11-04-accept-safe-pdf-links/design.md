## Approach

Keep qpdf's integrity check and page-count verification. Read only structural JSON (no stream data) into a bounded buffer, then walk its parsed objects. Allow `/URI` actions only for absolute HTTP/HTTPS links; allow `/GoTo` actions only for internal destinations. Resolve catalog `/OpenAction` references and reject any action chain or unsupported action kind. Retain the existing forbidden-name policy for all other active features.

## Boundaries

The parser rejects structural output above 128 MiB, even for an otherwise valid PDF smaller than the 100 MiB upload limit. This is an intentional memory bound. It never executes actions or follows links. A separate copy of the supplied syllabus will omit its relative link; the original remains untouched.
