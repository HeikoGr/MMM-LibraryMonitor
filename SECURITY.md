# Security Policy

## Supported versions

Only the latest release on `main` receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately through GitHub:
**Security → Report a vulnerability** on
[this repository](https://github.com/HeikoGr/MMM-LibraryMonitor/security/advisories/new).

Include what an attacker can reach (the mirror's web port, the local machine, the library account),
the steps to reproduce and the module version. Never attach your `config.js`, card numbers,
passwords or unredacted logs.

You will get an answer within two weeks. Fixes are released as a patch version, and the advisory is
published once a fixed version is available.

## Sensitive data the module handles

- library card numbers and passwords; the login sends them to the library's OPAC
- the titles each account has on loan or reserved, due dates and fees - often children's accounts
- book covers are fetched by the mirror (`proxyBookCovers`), so the cover supplier does not see
  which titles the household borrows

Keep certificate verification on: `customssl: true` lets anyone on the network path read the
credentials. See [Configuration](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki/Configuration)
in the wiki for `data.ca`, the safe alternative for a library with a private certificate.
