## ADDED Requirements

### Requirement: Bounded package waits and managed host maintenance

Bootstrap SHALL retain its existing supported-host, noninteractive sudo, input/secret, firewall and idempotence safeguards while establishing and verifying the production maintenance policy on Ubuntu 22.04, 24.04 and 26.04. Every bootstrap APT operation SHALL explicitly wait at most 300 seconds for native package locks and fail safely on contention without deleting locks, killing package processes or stopping an active transaction. Before package mutations, bootstrap SHALL establish its own persistent root-controlled automatic-maintenance hold under the existing host flock with a 600-second acquisition bound. It SHALL clear only its own hold after successful verification, leave it on failure, and preserve preexisting operator holds. It SHALL install and verify effective security-only policy, timers, reboot/restart safety and status tooling without starting app containers, migrations, changing live-restore or requiring live production testing.

#### Scenario: Unrelated package process owns the native lock

- **WHEN** any bootstrap package operation encounters a native lock held beyond 300 seconds
- **THEN** bootstrap reports timeout without deleting the lock, killing the process or claiming maintenance readiness

#### Scenario: Successful repeat application

- **WHEN** bootstrap maintenance configuration is applied twice with unchanged inputs on a supported release
- **THEN** the second application preserves managed configuration contents, permissions, existing operator holds, production secrets and Docker live-restore, without a new application release or reboot

#### Scenario: Unsafe effective policy during bootstrap

- **WHEN** later APT configuration permits a forbidden origin or automatic reboot
- **THEN** bootstrap fails verification before enabling automatic maintenance, retains its failure hold and reports the conflict without deleting operator files
