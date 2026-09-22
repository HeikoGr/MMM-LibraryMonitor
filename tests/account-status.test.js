const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");

const {
  ACCOUNT_STATUS_UNAVAILABLE,
  clearSessions,
  fetchAccountData,
} = require("../lib/opac-client");

/** A port nothing listens on, so the login fails fast with ECONNREFUSED. */
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("an unreachable OPAC yields an unavailable account, not an empty one", async () => {
  clearSessions();
  const port = await closedPort();

  const data = await fetchAccountData({
    libraryConfig: {
      api: "open",
      data: {
        baseurl: `http://127.0.0.1:${port}/opac/`,
        urls: { account: "Mein-Konto" },
      },
    },
    username: "12345678",
    password: "secret",
    requestTimeout: 2000,
  });

  assert.equal(data.accounts.length, 1);
  assert.equal(data.accounts[0].status, ACCOUNT_STATUS_UNAVAILABLE);
  assert.ok(data.accounts[0].error, "the failure reason is kept");
  clearSessions();
});
