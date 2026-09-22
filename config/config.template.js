const config = {
  address: "0.0.0.0",
  port: 8080,
  basePath: "/",
  ipWhitelist: [],
  useHttps: false,
  language: "de",
  timeFormat: 24,
  units: "metric",
  modules: [
    { module: "alert" },
    {
      module: "MMM-Cursor",
      config: {
        timeout: 1500,
      },
    },
    { module: "clock", position: "top_left" },
    {
      module: "MMM-LibraryMonitor",
      position: "top_right",
      header: "Bibliothek",
      config: {
        libraryConfig: {
          api: "open",
          data: {
            baseurl: "https://bibliotheken.komm.one/mannheim/de-de",
            // For a self-signed OPAC certificate, pin it instead of disabling checks:
            // ca: "config/opac-ca.pem",
            urls: {
              account: "Mein-Konto", // path to the account page, relative to baseurl
            },
          },
        },
        accounts: [
          {
            label: "child 1",
            username: "<cardnumber>",
            password: "<password>",
          },
          {
            label: "child 2",
            username: "",
            password: "<password-2>",
          },
        ].filter((account) => account.username && account.password),
        updateInterval: 15 * 60 * 1000,
        requestTimeout: 30 * 1000,
        maxItems: 8,
        showAuthor: false,
        showFormat: true,
        showBranch: true,
        showFees: true,
        showValidUntil: true,
        showNotices: false,
        showBookCovers: true,
        hideEmptyAccounts: false,
        debug: false,
        dateLocale: "de-DE",
        urgencyThresholdDays: 3,
        // Load book covers through the mirror instead of letting the browser
        // fetch them from the library's cover supplier.
        proxyBookCovers: true,
        // Keep parallel OPAC logins low so a family of cards does not look like
        // a burst of login attempts to the library server.
        maxConcurrentAccounts: 2,
        accountStaggerMs: 750,
        // Serve a recent result instead of logging in again (0 disables).
        resultCacheTtl: 5 * 60 * 1000,
      },
    },
  ],
};

if (typeof module !== "undefined") {
  module.exports = config;
}
