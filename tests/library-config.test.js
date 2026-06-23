const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAccountConfigs,
  resolveLibraryConfig,
} = require("../lib/library-config");

test("resolveLibraryConfig returns the inline config object", () => {
  const libraryConfig = resolveLibraryConfig({
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
  });

  assert.equal(libraryConfig.api, "open");
  assert.equal(libraryConfig.data.baseurl, "https://bibliotheken.komm.one/mannheim/de-de");
  assert.equal(libraryConfig.data.urls.account, "Mein-Konto");
});

test("resolveLibraryConfig requires explicit config input", () => {
  assert.throws(() => resolveLibraryConfig(), /Library config is required/);
});

test("resolveAccountConfigs supports multiple labeled accounts", () => {
  const accounts = resolveAccountConfigs({
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
    requestTimeout: 12345,
    accounts: [
      {
        label: "Kind 1",
        username: "child-1",
        password: "secret-1",
      },
      {
        label: "Kind 2",
        account: {
          username: "child-2",
          password: "secret-2",
        },
      },
    ],
  });

  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].label, "Kind 1");
  assert.equal(accounts[0].credentials.username, "child-1");
  assert.equal(accounts[0].requestTimeout, 12345);
  assert.equal(accounts[1].label, "Kind 2");
  assert.equal(accounts[1].credentials.username, "child-2");
});

test("resolveAccountConfigs does not leak top-level credentials into an accounts array", () => {
  assert.throws(
    () =>
      resolveAccountConfigs({
        libraryConfig: {
          api: "open",
          data: {
            baseurl: "https://bibliotheken.komm.one/mannheim/de-de",
            urls: {
              account: "Mein-Konto",
            },
          },
        },
        username: "parent",
        password: "secret",
        accounts: [
          {
            label: "Kind 1",
          },
        ],
      }),
    /Library account credentials are missing/,
  );
});