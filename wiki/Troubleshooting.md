# Troubleshooting

## Common Issues

### Login fails

- Re-check the account path configured under `libraryConfig.data.urls.account`.
- Verify the OPAC host URL and whether the account needs special SSL handling.

### No items are shown

- Confirm the account actually has active loans or reservations.
- Check `hideEmptyAccounts` if you are testing a multi-account setup.

### Parsing or display issues

- Some OPAC systems change markup without notice.
- Enable `debug: true` to log loaded account summaries and update cycles.

### Localized text looks unexpected

Frontend strings come from the translation files, while backend validation or remote OPAC messages may still appear as plain text from the upstream service.