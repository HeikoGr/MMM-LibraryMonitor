# Changelog

All notable changes to this project will be documented in this file.

## [0.7.2](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.7.1...v0.7.2) (2026-10-07)


### 🔧 Tooling

* ship releases via auto-merged release-ship PR and drop commit hooks ([#44](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/44)) ([b1221d4](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/b1221d4e0a7c84e85b927399a03559cb37cfb7d6))

## [0.7.1](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.7.0...v0.7.1) (2026-10-04)


### 📦 Build & Dependencies

* **deps:** update Biome and group weekly dependency updates ([9309030](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/9309030b61ae1883828ea21a3775081b51be5296))

## [0.7.0](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.6.0...v0.7.0) (2026-09-29)


### 🔌 Features

* show the loading state and each account as soon as it arrived ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))


### ⚡ Performance

* load cheerio on first use ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))
* log in without loading the login page first ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))
* start the second account 250 ms after the first instead of 750 ms ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))


### 🧱 Refactoring

* describe the current behavior in comments ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))
* name the instance identifier the same everywhere ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))


### 🧪 Testing

* wait for the socket close in the cover proxy test instead of sleeping ([#37](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/37)) ([a1d6b59](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/a1d6b5957aa827139abed65685f6a5bd5a99a455))


### 📦 Build & Dependencies

* **deps:** bump mmm-shared to 0.4.0 ([8d49ca6](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/8d49ca670cdeac4dea0666a81964a4502c021d33))
* **deps:** replace commitlint with a built-in commit message check ([#33](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/33)) ([b67d16d](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/b67d16d3ee85538f9b4b02a777554e7284d54902))


### 🔧 Tooling

* keep ci-only commits out of releases and the changelog ([#31](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/31)) ([10e53bf](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/10e53bf6838be64f80df8962f72ff2dc5d8f9807))
* skip the commit message check on the release PR ([#29](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/29)) ([73a01ff](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/73a01ff12640340bb657e226407eb92838c049c3))
* treat the mmm-shared submodule pointer as a dependency in the commit scope check ([8d49ca6](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/8d49ca670cdeac4dea0666a81964a4502c021d33))


### 🔧 Maintenance

* **deps-dev:** bump lint-staged from 17.5.1 to 17.6.0 ([#35](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/35)) ([802c294](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/802c294a335b95d0035b86944344fcb3b149beb2))
* drop the stale Unreleased section from the changelog ([#32](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/32)) ([ac95704](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/ac95704c404afff6b37ea344b3c9f99a0783d85a))
* list ci and chore commits in the changelog ([f3794a8](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/f3794a8b9cc9b7544bc8633e4baecbeab3bee9c0))
* restart instead of stop in the pm2 clean task, warn about PID 1 ([#36](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/36)) ([ef7c77b](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/ef7c77bf3a034b752c17333c1b3ca5720e4c93d0))

## [0.6.0](https://github.com/HeikoGr/MMM-LibraryMonitor/compare/v0.5.1...v0.6.0) (2026-09-25)


### 🔌 Features

* follow MagicMirror's locale for dates and log each instance at its own logLevel ([67539e3](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/67539e349c4cdaee353b911a92c601b76c35127d))


### 🐛 Fixes

* **opac:** keep user-agent and language headers on the login request ([7f7d5b6](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/7f7d5b6942adec9bfd96e0fe322d239d83782e07))
* re-probe certificates daily, show due dates correctly across time zones and midnight ([#26](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/26)) ([543153c](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/543153caa8fd824b4f536e4909e440b74f1056de))
* update image link in Home.md to use raw GitHub URL ([211cc41](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/211cc418d44878865be6dfa9e1f6c20c72b7aa56))


### 📚 Documentation

* add an anonymized screenshot under img/ ([396a989](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/396a9893d1c6cbafb610779bfc63851ae780c050))
* **config:** document animationSpeed ([d41e658](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/d41e658b24547d8b92fd315dc3fbdbdef76f2d9f))


### 📦 Build & Dependencies

* **deps:** require MagicMirror's node version ([58de159](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/58de159fbb251a6e91d0d14bf1b4d1dea1c08f80))


### 🔧 Tooling

* develop branch model and PR title check ([8956a32](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/8956a32f5b7c5c349e95e1b390b4f42441c17d01))
* fix the parser path and describe the pinned node version correctly ([55f9df4](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/55f9df494111c2c5cf312a6d59bb4eb825cb3513))
* open the release PR to the default branch automatically, use RELEASE_TOKEN ([#27](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/27)) ([b720d5a](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/b720d5ae0da09ec8dca01b3bc5cc02deb2e6de76))
* prepare releases on develop, ship them with one merge to the default branch ([#24](https://github.com/HeikoGr/MMM-LibraryMonitor/issues/24)) ([2c17525](https://github.com/HeikoGr/MMM-LibraryMonitor/commit/2c17525bdb5bda40bc63ae8d2407ed2917daa566))

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
