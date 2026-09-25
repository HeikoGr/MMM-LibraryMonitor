# Configuration

## Connection Options

| Option | Description |
| --- | --- |
| `libraryConfigFile` | Path to an OPAC JSON config file. |
| `libraryConfig` | Inline OPAC config object, including host and account path data. |
| `username` | Single-account username. |
| `password` | Single-account password. |
| `account.username` | Nested alternative to `username`. |
| `account.password` | Nested alternative to `password`. |
| `accounts` | Array of account objects for multi-account setups. |

## TLS

The login sends your card number and password to the OPAC, so the certificate
is fully verified by default. Most libraries need nothing here —
`bibliotheken.komm.one`, for example, has a regular publicly trusted
certificate.

| Option | Description |
| --- | --- |
| `libraryConfig.data.ca` | Trust this certificate for the OPAC, for a library with a self-signed or private-CA certificate. A PEM string, or a path to a PEM file (relative paths resolve against the module directory). Verification, including the host name check, stays on. Takes precedence over `customssl`. |
| `libraryConfig.data.customssl` | **Insecure, not recommended.** `true` switches certificate verification off entirely; anyone on the network path can read your credentials. Only a literal `true` has this effect. Kept for compatibility — prefer `ca`. While it is set, the backend logs a warning once a day per host: that the certificate is trusted and `customssl` is needless, or which certificate problem `customssl` is papering over. |

Book covers are always fetched with full verification; neither option applies to
the cover proxy. A cover that fails verification falls back to the placeholder.
An OPAC configured over plain `http://` works, but the backend logs a warning (once a
day per host) because credentials then travel unencrypted.

## Refresh And Limits

| Option | Description |
| --- | --- |
| `updateInterval` | Refresh interval in milliseconds. Default: 6 h — loan periods change at most once a day and every fetch is a login plus scrape against the OPAC. |
| `updateAnchorHour` | Hour of day the refresh grid is anchored to (default `7` → 07:00, 13:00, 19:00, 01:00). `null` disables anchoring. |
| `backgroundRefresh` | Keep refreshing while the module is hidden (e.g. under MMM-Carousel). Default `true`, so showing the module never causes a request. With `false`, the backend pauses while every display hides the module. |
| `quietHours` | Optional window without any polling, e.g. `{ from: "23:00", to: "06:00" }`. |
| `requestTimeout` | Backend request timeout in milliseconds. |
| `maxItems` | Maximum number of loans shown per account; the same limit applies separately to reservations. Hidden entries are summarized as "+N more". |
| `urgencyThresholdDays` | Highlight items whose deadline is this many days away or closer. Applies to loans and to reservations that are ready for pickup; a pending reservation has no deadline and is never highlighted. |
| `maxConcurrentAccounts` | How many accounts may be fetched at the same time. Default `2`, so a family of cards does not hit the OPAC with simultaneous logins. |
| `accountStaggerMs` | Delay between the start of each parallel fetch slot. Default `750`. |

## Display Options

| Option | Description |
| --- | --- |
| `showAuthor` | Show author information. |
| `showFormat` | Show media group or format. |
| `showBranch` | Show library branch. |
| `showFees` | Show pending fees. |
| `showValidUntil` | Show card validity. |
| `showNotices` | Show account notices from the OPAC page. |
| `showBookCovers` | Show cover images next to each title. |
| `proxyBookCovers` | Load covers through the mirror instead of letting the browser fetch them from the library's cover supplier. Default `true`. Turning this off means the supplier sees one request per borrowed title from your IP address. |
| `hideEmptyAccounts` | Hide accounts without loans and without errors. |
| `logLevel` | Optional: `none`, `error`, `warn`, `info` or `debug`. All output goes through MagicMirror's `Log`, so the global `logLevel` in `config.js` decides (debug output such as session reuse and cover proxy failures needs `DEBUG` there); this option can only narrow it for this module. Unset means the global level alone. Applies per instance, also in the backend. Replaces the former `debug` option. |
| `dateLocale` | Locale used for due-date formatting, e.g. `"de-DE"`. Unset (default) follows MagicMirror's `locale`, or its `language` when no locale is set. |
| `animationSpeed` | Fade duration in milliseconds when the display redraws after new data or an error. Default `1000`. |

## Behavior Notes

- When `accounts` is used, each account gets its own summary and loan list.
- The default UI is read-only.
- Renewal workflows are intentionally not part of this module version.
- A failed refresh does not clear the display. This covers both a failed request
  and an OPAC that answers but cannot be logged into: each account keeps its last
  successful state with a "last known data" notice, while accounts that did
  refresh are updated. Only an account with nothing shown yet displays its error.
  When no account could be refreshed (e.g. the network was not up yet after a
  reboot), the backend retries after 1, 2, 4 … up to 30 minutes instead of waiting
  for the next 6 h slot. A single failed account waits for the next regular refresh.
- The refresh schedule runs in the backend. The browser sends its config once and
  only reports whether the module is visible; several displays of one instance
  share one schedule. The backend sends at most `maxItems` loans and reservations
  per account plus the number of the rest.
- A browser reload does not trigger a new fetch: the backend sends the last result
  it has. Two module instances with the same accounts each log in on their own
  schedule; the former `resultCacheTtl` option is ignored (the backend logs a warning).
- Sessions are reused between refreshes. A refresh costs one request while the
  OPAC session is still valid, and falls back to a full login when it is not.
- If an OPAC host presents a missing, expired or untrusted TLS certificate, the
  backend logs a warning naming the problem (checked once a day per host). This is diagnostic only; whether
  such a certificate is accepted is decided by the [TLS](#tls) options.

## Supported Library Systems

`libraryConfig.api` selects the adapter used to talk to the library system.

| Value | System |
| --- | --- |
| `open` | OPEN / OCLC OPAC |

Adapters live in `lib/adapters/<name>/`. Each one exports `validateConfig`,
`buildAccountUrl`, `resumeSession` and `login`, and is registered in
`lib/adapters/index.js`. Adding a system means adding an adapter there; the
frontend, the scheduler and the rendering layer stay unchanged, because every
adapter returns the same normalised item shape (`title`, `dueDate`,
`daysRemaining`, `isOverdue`, `status`).