# Troubleshooting

## Common Issues

### Login fails

- Re-check the account path configured under `libraryConfig.data.urls.account`.
- Verify the OPAC host URL.
- Look for `OPAC TLS certificate problem` in the log. If the library really uses
  a self-signed certificate, pin it with `libraryConfig.data.ca` (see
  [Configuration → TLS](Configuration#tls)) rather than setting `customssl`.

### "Last known data" notice stays visible

The OPAC could not be reached or refused the login on the last refresh; the
module keeps showing what it had. The notice names the reason. It disappears on
the next successful refresh. When no account could be refreshed, the backend retries
within minutes; when only some accounts failed, it waits for the next regular refresh
(up to `updateInterval` later).

### No items are shown

- Confirm the account actually has active loans or reservations.
- Check `hideEmptyAccounts` if you are testing a multi-account setup.

### Parsing or display issues

- Some OPAC systems change markup without notice.
- The backend logs every update cycle with a per-account summary at `info` level; check
  `pm2 logs`. Debug output in the backend and the browser console appears when the global
  `logLevel` in `config.js` contains `DEBUG` (and the module's own `logLevel` is unset or `debug`).

### Localized text looks unexpected

Frontend strings come from the translation files, while backend validation or remote OPAC messages may still appear as plain text from the upstream service.