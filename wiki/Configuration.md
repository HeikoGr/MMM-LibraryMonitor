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

## Refresh And Limits

| Option | Description |
| --- | --- |
| `updateInterval` | Refresh interval in milliseconds. Default: 6 h — loan periods change at most once a day and every fetch is a login plus scrape against the OPAC. |
| `updateAnchorHour` | Hour of day the refresh grid is anchored to (default `7` → 07:00, 13:00, 19:00, 01:00). `null` disables anchoring. |
| `backgroundRefresh` | Keep refreshing while the module is hidden (e.g. under MMM-Carousel). Default `true`, so showing the module never causes a request. |
| `quietHours` | Optional window without any polling, e.g. `{ from: "23:00", to: "06:00" }`. |
| `requestTimeout` | Backend request timeout in milliseconds. |
| `maxItems` | Maximum number of loans shown per account. |
| `urgencyThresholdDays` | Highlight items whose deadline is this many days away or closer. Applies to loans and to reservations that are ready for pickup; a pending reservation has no deadline and is never highlighted. |
| `maxConcurrentAccounts` | How many accounts may be fetched at the same time. Default `2`, so a family of cards does not hit the OPAC with simultaneous logins. |
| `accountStaggerMs` | Delay between the start of each parallel fetch slot. Default `750`. |
| `resultCacheTtl` | How long a fetched result is reused before the module logs in again, in milliseconds. Default `5 min`; `0` disables the cache. A browser reload or a second mirror client is served from this cache. |

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
| `debug` | Enable lightweight backend debug logs. |
| `dateLocale` | Locale used for due-date formatting. |

## Behavior Notes

- When `accounts` is used, each account gets its own summary and loan list.
- The default UI is read-only.
- Renewal workflows are intentionally not part of this module version.
- A failed refresh does not clear the display: the last successful result stays
  visible with a "last known data" notice above it. Only a failure with nothing
  cached yet shows a bare error message.
- Sessions are reused between refreshes. A refresh costs one request while the
  OPAC session is still valid, and falls back to a full login when it is not.
- If an OPAC host presents a missing, expired or untrusted TLS certificate, the
  backend logs a warning naming the problem. This is diagnostic only; whether
  such a certificate is accepted is still decided by `customssl`.

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