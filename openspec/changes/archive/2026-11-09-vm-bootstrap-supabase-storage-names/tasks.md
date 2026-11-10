## 1. Contract and tests

- [x] 1.1 Record and validate the new VM-bootstrap contract.
- [x] 1.2 Write tests first and verify failures for renamed Storage keys and fixed SSH 22.

## 2. Implementation

- [x] 2.1 Rename the five Actions, validation, playbook, fixture, and env-file keys with no legacy aliases; scope all inputs to the production environment secrets except DOMAIN.
- [x] 2.2 Remove configurable SSH port and update host-key, inventory, UFW, and operator documentation.

## 3. Verification and delivery

- [x] 3.1 Run focused tests, Ansible syntax/lint, actionlint, formatting, and OpenSpec validation; no live VM run.
- [ ] 3.2 Update the existing draft PR #186 as one commit, run no-mistakes, and verify final CI.
