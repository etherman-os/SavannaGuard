# Security Policy

SavannaGuard is security software. Please report vulnerabilities carefully and
avoid publishing working bypasses before maintainers have had time to respond.

## Supported Versions

Security fixes target the current `main` branch and the latest published release
or tag when one exists.

## Scope

In scope:

- Public challenge and token APIs
- Admin authentication, CSRF protection, and admin APIs
- Browser widget behavior that affects verification
- Federation peer authentication, sync, and SSRF protections
- Docker and deployment defaults that materially weaken security

Out of scope:

- Attacks that require full server filesystem or database access
- Denial-of-service reports without a practical mitigation path
- Vulnerabilities only present in modified forks
- Social engineering or attacks against third-party infrastructure

## Reporting

For sensitive reports, use a private channel instead of opening a public issue.
If GitHub private vulnerability reporting is enabled for the repository, use it.
Otherwise contact the maintainers through the repository owner's published
security contact.

Include:

- Affected version or commit
- Impact and affected endpoint or component
- Reproduction steps
- Any logs, payloads, or proof-of-concept code needed to validate the issue
- Suggested mitigation, if known

## Disclosure

Maintainers should acknowledge valid reports within 7 days when possible. Public
disclosure should wait until a fix or mitigation is available, unless there is
active exploitation or another clear user-safety reason to disclose sooner.

## Secrets

Never include real `SECRET_KEY`, `ADMIN_PASSWORD`, federation PSKs, production
tokens, raw IP addresses, or customer data in public issues or pull requests.
