## MODIFIED Requirements

### Requirement: Smoke before success

For each new successful SHA, deployment SHALL verify the migration ledger, private Storage write/read/delete with cleanup, one Resend-accepted synthetic email to `chalktalk602@gmail.com`, and external HTTPS web/API. It SHALL mark success only after those checks; repeat of an already successful SHA SHALL not resend the synthetic email. A successful provider smoke SHALL leave the release eligible for finalization even when the deployment script is streamed over SSH and the smoke command otherwise accepts stdin.

#### Scenario: Successful deployment and repeat

Given a current, tested main SHA, when all checks pass, then it becomes the successful SHA and a repeated run skips provider smoke.

#### Scenario: Streamed script reaches finalization

Given a deployment script streamed over SSH into Bash, when provider smoke succeeds and attempts to read its stdin, then the stage still persists the pending release marker and the finish phase marks that SHA successful.
