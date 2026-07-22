# MMM-LibraryMonitor

MagicMirror module to display borrowed library items, due dates, reservations, and account summaries from supported OPAC systems.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/HeikoGr/MMM-LibraryMonitor
cd MMM-LibraryMonitor
npm ci --omit=dev
```

## Update

```bash
cd ~/MagicMirror/modules/MMM-LibraryMonitor
git pull
npm ci --omit=dev
```

## Configuration

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
},
```

## Documentation

User-facing documentation now lives in the project wiki:

- [Wiki Home](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki)
- [Installation](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki/Installation)
- [Update](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki/Update)
- [Quick Start](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki/Quick-Start)
- [Configuration](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki/Configuration)
- [Troubleshooting](https://github.com/HeikoGr/MMM-LibraryMonitor/wiki/Troubleshooting)