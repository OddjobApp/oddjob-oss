# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: the repository's **Security** tab →
**Report a vulnerability**. If that is unavailable to you, email
**admin@oddjob.app** with "SECURITY" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with
it. We aim to acknowledge a report within three working days and to agree a
disclosure date with you once a fix is ready.

## Scope

Oddjob runs many organizations in one deployment, stores their credentials, and
executes agent- and tenant-authored code, so we especially want to hear about:

- reading or writing another organization's data (missing or bypassable org
  scoping);
- reading a stored credential or provider key, or a secret reaching a log, an
  API response, or a tenant process's environment;
- escaping the code sandbox, or tenant code reaching the server's environment;
- server-side request forgery past the egress firewall;
- approval or governance gates that can be skipped, so an agent acts without the
  approval it requires;
- authentication and session flaws.

[AGENTS.md](AGENTS.md) and
[Keys and credentials](docs/developer-guides/KEYS_AND_CREDENTIALS.md) describe
the boundaries these rules are meant to hold.

## Supported versions

Fixes land on the default branch. There are no maintained release branches yet.
