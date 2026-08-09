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
| `updateInterval` | Refresh interval in milliseconds. |
| `requestTimeout` | Backend request timeout in milliseconds. |
| `maxItems` | Maximum number of loans shown per account. |
| `urgencyThresholdDays` | Highlight items due soon. |

## Display Options

| Option | Description |
| --- | --- |
| `showAuthor` | Show author information. |
| `showFormat` | Show media group or format. |
| `showBranch` | Show library branch. |
| `showFees` | Show pending fees. |
| `showValidUntil` | Show card validity. |
| `showNotices` | Show account notices from the OPAC page. |
| `hideEmptyAccounts` | Hide accounts without loans and without errors. |
| `debug` | Enable lightweight backend debug logs. |
| `dateLocale` | Locale used for due-date formatting. |

## Behavior Notes

- When `accounts` is used, each account gets its own summary and loan list.
- The default UI is read-only.
- Renewal workflows are intentionally not part of this module version.