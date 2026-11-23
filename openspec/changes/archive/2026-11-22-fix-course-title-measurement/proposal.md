## Why

A fractional intrinsic-width measurement can ellipsize a short course name even when the approved desktop header has ample room. The user explicitly approved correcting this regression without changing typography or introducing a fixed title cap.

## What Changes

- Preserve enough fractional measurement space for short titles while retaining the approved content-fit two-stage navigation.
- Strengthen real-App browser assertions so visible title clipping cannot hide behind integer scroll-width equality.
- Correct the selected-detail test fixture to provide valid followup metadata before screenshots.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `responsive-course-ui`: explicitly cover avoidable fractional short-title clipping within the existing adaptive-header requirement.

## Impact

A small local header measurement correction and mocked browser regression/fixture changes. No API, dependency, typography, mobile layout, navigation guard or runtime configuration changes.
