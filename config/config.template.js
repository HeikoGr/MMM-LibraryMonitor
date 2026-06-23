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
            customssl: false, // for libraries with self-signed certificates
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
        dateLocale: "de-DE",
        urgencyThresholdDays: 3,
      },
    },
  ],
};

if (typeof module !== "undefined") {
  module.exports = config;
}