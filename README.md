# MMM-LibraryMonitor

MagicMirror module to show which media are currently borrowed from the local library OPAC account and when they are due.

## Current scope

This module currently focuses on OPEN-OPAC account overviews:

- account overview only
- borrowed media and due dates only
- no media search
- no profile management
- no renewal workflow

The backend is intentionally modeled after the module structure used in MMM-CalDAV-Tasks and MMM-Webuntis, while the account parsing follows the OPEN account scraper approach used by opacclient.

## Installation

Install dependencies inside the module folder:

```bash
npm install
```

For browser-based testing in the same style as the reference modules, this repository now also ships a `.devcontainer` setup that starts MagicMirror in `serveronly` mode under PM2.

## Configuration

The module supports three ways to select the library configuration:

1. Exact OPAC JSON file via `libraryConfigFile`
2. Inline JSON object via `libraryConfig`

For real-world setups, keeping the target OPAC host and account path directly in the module config via `libraryConfig` is recommended so the library-specific values stay visible in one place.

Like the other MagicMirror modules, the primary setup path is now the central MagicMirror configuration file in [config/config.js](config/config.js). A template is provided in [config/config.template.js](config/config.template.js).

Optional runtime overrides can also be supplied through [config/.env.template](config/.env.template) and [config/.env](config/.env). In particular, `MMM_LIBRARY_MONITOR_USERNAME` and `MMM_LIBRARY_MONITOR_PASSWORD` can override the values from the central config for local tests.

Minimal config:

```js
{
	module: "MMM-LibraryMonitor",
	position: "top_left",
	config: {
		libraryConfig: {
			api: "open",
			data: {
				baseurl: "https://bibliotheken.komm.one/mannheim/de-de",
				customssl: true,
				urls: {
					account: "Mein-Konto"
				}
			}
		},
		username: "12345678",
		password: "geheim"
	}
}
```

Example with multiple accounts:

```js
{
	module: "MMM-LibraryMonitor",
	position: "top_left",
	header: "Bibliothek",
	config: {
		libraryConfig: {
			api: "open",
			data: {
				baseurl: "https://bibliotheken.komm.one/mannheim/de-de",
				customssl: true,
				urls: {
					account: "Mein-Konto"
				}
			}
		},
		accounts: [
			{
				label: "Kind 1",
				username: "12345678",
				password: "geheim-1"
			},
			{
				label: "Kind 2",
				username: "87654321",
				password: "geheim-2"
			},
			{
				label: "Eltern",
				username: "11223344",
				password: "geheim-3"
			}
		],
		updateInterval: 15 * 60 * 1000,
		maxItems: 8,
		showAuthor: false,
		showFormat: true,
		showBranch: true,
		showFees: true,
		showValidUntil: true,
		showNotices: false,
		hideEmptyAccounts: false
	}
}
```

Single-account configuration remains valid:

```js
{
	module: "MMM-LibraryMonitor",
	position: "top_left",
	config: {
		libraryConfig: {
			api: "open",
			data: {
				baseurl: "https://bibliotheken.komm.one/mannheim/de-de",
				customssl: true,
				urls: {
					account: "Mein-Konto"
				}
			}
		},
		username: "12345678",
		password: "geheim"
	}
}
```

If you want to use an external OPAC JSON file directly, you can point to it with `libraryConfigFile` as long as the file is present inside the module directory or you pass an absolute path:

```js
{
	module: "MMM-LibraryMonitor",
	position: "top_left",
	config: {
		libraryConfigFile: "config/bibs/meine-bibliothek.json",
		username: "12345678",
		password: "geheim"
	}
}
```

## Browser Test With PM2

The repository now includes the same basic PM2/devcontainer system used in the reference projects:

- [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json)
- [.devcontainer/Dockerfile](.devcontainer/Dockerfile)
- [.devcontainer/entrypoint.sh](.devcontainer/entrypoint.sh)
- [.devcontainer/ecosystem.config.js](.devcontainer/ecosystem.config.js)
- [.vscode/tasks.json](.vscode/tasks.json)
- [scripts/live-account-fetch.js](scripts/live-account-fetch.js)
- [scripts/require-devcontainer.sh](scripts/require-devcontainer.sh)

Behavior:

- `config/config.js` is linked into the MagicMirror root config path.
- `config/custom.css` is linked into the MagicMirror root CSS path.
- `config/.env` is linked into the MagicMirror root and sourced during container startup.
- PM2 starts `/opt/magic_mirror/serveronly/index.js` on port `8080`.
- The browser target is `http://localhost:8080` when the devcontainer is running.

Useful tasks:

- `pm2: restart all`
- `pm2: logs (follow)`
- `pm2: restart & logs (clean)`
- `mmm-librarymonitor: live account fetch`
- `npm: test`

For a direct backend-only live check without opening the browser, run:

```bash
npm run debug:live
```

If you open this repository in the devcontainer, the startup flow mirrors the reference repositories: dependencies install, MagicMirror config is validated, and PM2 launches the server automatically.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `libraryConfigFile` | string | `null` | Path to an OPAC JSON config file. |
| `libraryConfig` | object | `null` | Inline OPAC JSON config object, e.g. with `data.baseurl` and `data.urls.account` for the target library. |
| `username` | string | `""` | Library account username. |
| `password` | string | `""` | Library account password. |
| `account.username` | string | `""` | Nested alternative to `username`. |
| `account.password` | string | `""` | Nested alternative to `password`. |
| `accounts` | array | `[]` | Optional list of account objects with `label`, `username`, `password`, and optional per-account library config overrides. |
| `updateInterval` | number | `900000` | Refresh interval in milliseconds. |
| `requestTimeout` | number | `30000` | Timeout per backend request in milliseconds. |
| `maxItems` | number | `10` | Maximum number of loans shown per account in the frontend. |
| `showAuthor` | boolean | `false` | Show author in the meta line. |
| `showFormat` | boolean | `true` | Show media group / format in the meta line. |
| `showBranch` | boolean | `true` | Show branch in the meta line. |
| `showFees` | boolean | `true` | Show pending fees in the summary line. |
| `showValidUntil` | boolean | `true` | Show card validity in the summary line. |
| `showNotices` | boolean | `false` | Show informational account notices from the OPAC page. |
| `hideEmptyAccounts` | boolean | `false` | Hide accounts that currently have no borrowed media and no error. |
| `dateLocale` | string | `"de-DE"` | Locale used for due-date formatting in the frontend. |
| `urgencyThresholdDays` | number | `3` | Highlight items due soon. |

## Notes

- In the shipped local config/template, the OPAC host and account path are defined explicitly in `libraryConfig`, so library-specific values can be edited without touching module code.
- When `accounts` is used, each account is rendered in its own section with its own summary and loan list.
- The default UI is read-only and suppresses OPAC notices such as renewal prompts unless `showNotices` is enabled.
- Frontend strings are localized via the translation files. The module's own backend errors are emitted as plain English strings. Raw validation messages returned by the remote OPAC are shown as-is.
- Renewals are intentionally not exposed in this first version, even though the upstream OPAC system contains the necessary account mechanisms.
