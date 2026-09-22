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
the next successful refresh.

### No items are shown

- Confirm the account actually has active loans or reservations.
- Check `hideEmptyAccounts` if you are testing a multi-account setup.

### Parsing or display issues

- Some OPAC systems change markup without notice.
- Enable `debug: true` to log loaded account summaries and update cycles.

### Localized text looks unexpected

Frontend strings come from the translation files, while backend validation or remote OPAC messages may still appear as plain text from the upstream service.