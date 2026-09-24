# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Added Biome linting and project metadata for MagicMirror module checks.
- Switched the backend HTTP client from node-fetch to the built-in fetch API.
- Added documentation and community support files.

## [0.5.1](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.5.0...v0.5.1) (2026-09-24)


### 🐛 Fixes

* re-report the paused state on a backend restart (mmm-shared 0.3.0 c310517) ([84423b2](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/84423b2767fc42e5a4026a93a1de3a027981ac7e))


### 🔧 Tooling

* assign release-please's PR to HeikoGr ([103037c](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/103037cbe0265edf0de357a4a7a8baf993ecf43d))

## [0.5.0](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.4.0...v0.5.0) (2026-09-23)


### 🔌 Features

* backend-owned updates with retry, logLevel instead of debug, MagicMirror's Log ([78b3dcf](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/78b3dcfb0b4444c03fbce6702b093f8d4cc76672))


### 🧱 Refactoring

* load backend-session.js from the mmm-shared submodule (S5) ([26a2cb5](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/26a2cb5948ae057d3d9a993d37b28955fcbf2acc))

## [0.4.0](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.3.0...v0.4.0) (2026-09-22)


### 🔌 Features

* **lifecycle:** enhance module lifecycle management and configuration options ([9a4c0ba](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/9a4c0ba6e9719c4aee67c9954c6af7167f057c4e))
* **tests:** add comprehensive tests for open adapter and rendering logic ([c7080aa](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/c7080aa09c6b1e1d936d91f2d6c602069ccdf813))

## [0.3.0](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.2.0...v0.3.0) (2026-08-17)


### 🔌 Features

* **lifecycle:** implement lifecycle management for module updates ([0f265af](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/0f265af856a302168bf5601858b95f585f6631f5))

## [0.2.0](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.1.7...v0.2.0) (2026-08-16)


### 🔌 Features

* **parser:** handle leading checkbox in header rows for account parsing ([70db6ec](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/70db6ec23e937bd05745c5ab5dc0ac511fbf7691))


### 🐛 Fixes

* **opac-client:** correct regex pattern ([75c57ad](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/75c57ad13a7c735e4e40b45b90ed256b79211528))

## [0.1.7](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.1.6...v0.1.7) (2026-08-15)


### 🧱 Refactoring

* **config:** improve account configuration handling in resolveAccountConfigs function ([73fc1af](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/73fc1afc6a3c7009af6192fe59b05032b6b0afa8))


### 🔧 Tooling

* bump Node.js version from 20 to 22.22.2 in CI configuration ([61ba11e](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/61ba11ee8af3fe9a2f1d28a63ef1aaaa9873c988))

## 0.1.0

- Initial release of MMM-LibraryMonitor.
