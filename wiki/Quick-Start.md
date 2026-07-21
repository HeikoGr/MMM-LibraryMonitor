# Quick Start

Add a minimal config block to your MagicMirror `config/config.js`:

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

## Multiple Accounts

You can later switch to an `accounts` array if you want to show multiple family accounts in separate sections.

## External Library Config Files

If your OPAC definition already exists as JSON, you can use `libraryConfigFile` instead of embedding the whole `libraryConfig` object directly in your MagicMirror config.