# GitHub Copilot repository instructions (strict)

## Scope and safety

- Only change code and files inside this repository.
- Keep changes minimal and directly related to the request/issue.
- Do not introduce new dependencies unless explicitly required; if you do, update `package.json` (and existing lockfiles).
- Never commit secrets (tokens, API keys, session cookies, personal data). Library card
  numbers and passwords count as secrets; they must never reach a log (`REDACTED_LOG_KEYS` in
  `lib/log-redaction.js`, loaded by both the frontend and the node_helper).

## MagicMirror module conventions

- Preserve the standard MagicMirror module structure and naming (e.g., `MMM-*.js`, `node_helper.js`, `translations/`, `*.css`).
- Keep the public module API stable (`Module.register`, notification handling, config schema) unless the request requires a breaking change.
- Every refresh is a login plus HTML scrape against a public library OPAC: keep the request
  count low and predictable.

## This module's architecture

- Shared infrastructure comes from the `lib/mmm-shared` submodule (`createTransport`,
  `createLogger`, `createLifecycle`). Do not change it here.
- The backend owns the schedule (MODULE-PLAN C1-C3): the frontend sends `CONFIGURE` once and
  `SESSION_STATE` (active/paused). `lib/mmm-shared/backend-session.js` runs a `createLifecycle` per
  instance in `node_helper` (6 h grid anchored at `updateAnchorHour`, jitter, `quietHours`),
  retries a refresh in which every account failed with a growing backoff, and pushes the
  result as a `DATA` event. The frontend lifecycle has no `onFetch`; it only gates rendering
  (`lifecycle.render()`). Do not add own timers or suspend/resume logic.
- `backend-session.js` comes from the `lib/mmm-shared` submodule (tests there); change it in the
  mmm-shared repo.
- One adapter per library system under `lib/adapters/<system>/` (`validateConfig`,
  `buildAccountUrl`, `resumeSession`, `login`, parser), registered in `lib/adapters/index.js`.
  Adapters return the normalised item shape; frontend and scheduler stay unchanged.
- `lib/opac-client.js` reuses one cookie session per account, fetches accounts with limited
  parallelism (`maxConcurrentAccounts`, `accountStaggerMs`) and marks an unreachable account
  `unavailable` instead of returning it empty. The frontend keeps each unavailable account's
  previous state.
- The backend decides what is sent (C2): at most `maxItems` loans and reservations per
  account, plus `moreItems`/`moreReservations` for the "+N more" line.
- TLS: full verification by default, `libraryConfig.data.ca` pins a certificate,
  `customssl: true` disables verification (discouraged; `lib/tls-trust.js`). The certificate
  probe in `lib/tls-probe.js` is diagnostic only and runs once per host and day (the cadence is
  `shouldProbe()` in `lib/opac-client.js`; the probe itself does not cache).
- Book covers go through `lib/cover-proxy.js` (only URLs seen in a scraped page, image
  content types, size limit), so the cover supplier does not see the household's loans.
- The DOM is built with `createElement`/`textContent`; scraped values never go through
  `innerHTML`.

## Quality bar

- Follow the repository's existing Biome configuration.
- Avoid broad refactors “for cleanliness”; do focused edits.
- Parser changes need a fixture test in `tests/open-adapter-parser.test.js`; cadence changes a
  test in `tests/lifecycle-integration.test.js`. Run `node --run test` and `node --run lint`.

## References

- GitHub Copilot repository instructions: https://docs.github.com/de/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- MagicMirror² documentation: https://docs.magicmirror.builders/
- MagicMirror² module development: https://docs.magicmirror.builders/development/module-development.html
- Node.js documentation: https://nodejs.org/en/docs
