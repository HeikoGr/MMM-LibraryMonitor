# MMM-LibraryMonitor

## Preview

![MMM-LibraryMonitor preview](preview.png)

MagicMirror module to show which media are currently borrowed from the local library OPAC account and when they are due.

## Current scope

This module currently focuses on OPAC account overviews:

- account overview only
- borrowed media and due dates only
- reservations from the account overview
- no media search
- no profile management
- no renewal workflow

## Installation

Clone the module into your MagicMirror modules directory:

```bash
git clone https://github.com/HeikoGr/MMM-LibraryMonitor
cd MMM-LibraryMonitor
```

Install dependencies inside the module folder:

```bash
npm install
```

## Configuration

Like the other MagicMirror modules, the primary setup path is the central MagicMirror configuration file in [config/config.js](config/config.js). A template is provided in [config/config.template.js](config/config.template.js).

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
					account: "Mein-Konto",
				},
			},
		},
		username: "12345678",
		password: "geheim",
	},
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
						account: "Mein-Konto",
					},
				},
		},
		accounts: [
			{
				label: "Kind 1",
				username: "12345678",
					password: "geheim-1",
			},
			{
				label: "Kind 2",
				username: "87654321",
					password: "geheim-2",
			},
			{
				label: "Eltern",
				username: "11223344",
					password: "geheim-3",
				},
		],
		updateInterval: 15 * 60 * 1000,
		maxItems: 8,
		showAuthor: false,
		showFormat: true,
		showBranch: true,
		showFees: true,
		showValidUntil: true,
		showNotices: false,
			hideEmptyAccounts: false,
		},
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
					account: "Mein-Konto",
				},
			},
		},
		username: "12345678",
		password: "geheim",
	},
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
		password: "geheim",
	},
}
```

## Update

To update an existing installation, run the following inside the module directory:

```bash
git pull
npm install
node --run lint
```

Restart MagicMirror after the update so the new backend code is loaded.

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
| `debug` | boolean | `false` | Write lightweight backend debug logs for update cycles and loaded account summaries. |
| `dateLocale` | string | `"de-DE"` | Locale used for due-date formatting in the frontend. |
| `urgencyThresholdDays` | number | `3` | Highlight items due soon. |

## Notes

- In the shipped local config/template, the OPAC host and account path are defined explicitly in `libraryConfig`, so library-specific values can be edited without touching module code.
- When `accounts` is used, each account is rendered in its own section with its own summary and loan list.
- The default UI is read-only and suppresses OPAC notices such as renewal prompts unless `showNotices` is enabled.
- Frontend strings are localized via the translation files. The module's own backend errors are emitted as plain English strings. Raw validation messages returned by the remote OPAC are shown as-is.
- Renewals are intentionally not exposed in this version.