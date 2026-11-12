/**
 * Session reuse and the transport warnings of lib/opac-client.js.
 *
 * The OPAC itself is replaced by mocking login/resumeSession on the real
 * "open" adapter; the certificate probe is stubbed, so no test touches the
 * network.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const openAdapter = require("../lib/adapters/open");
const { describeCertificateProblem } = require("../lib/tls-probe");

const ACCOUNT_DATA = { items: [], totalItems: 0, reservations: [], totalReservations: 0 };

/**
 * Load a fresh opac-client whose certificate probe answers with `probe`.
 * @param {object|null} probe - What probeCertificate() resolves to
 * @returns {object} the opac-client exports plus `probes` (number of probe calls)
 */
function loadClient(probe = null) {
  const clientPath = require.resolve("../lib/opac-client");
  const stats = { probes: 0 };
  const probeStub = {
    describeCertificateProblem,
    probeCertificate: async () => {
      stats.probes += 1;
      return probe;
    },
  };

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "./tls-probe") {
      return probeStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[clientPath];
  try {
    return Object.assign(require(clientPath), { stats });
  } finally {
    Module._load = originalLoad;
    delete require.cache[clientPath];
  }
}

function moduleConfig(data = {}) {
  return {
    libraryConfig: {
      api: "open",
      data: { baseurl: "https://opac.example/webopac/", urls: { account: "Mein-Konto" }, ...data },
    },
    username: "12345678",
    password: "secret",
  };
}

function captureLogger() {
  const warnings = [];
  const noop = () => {};
  return {
    warnings,
    logger: { debug: noop, info: noop, error: noop, warn: (msg, meta) => warnings.push({ msg, meta }) },
  };
}

test("a second refresh within the session resumes it instead of logging in again", async (t) => {
  const login = t.mock.method(openAdapter, "login", async () => ACCOUNT_DATA);
  const resume = t.mock.method(openAdapter, "resumeSession", async () => ACCOUNT_DATA);
  const client = loadClient();

  const first = await client.fetchAccountData(moduleConfig());
  const second = await client.fetchAccountData(moduleConfig());

  assert.equal(first.accounts[0].status, client.ACCOUNT_STATUS_OK);
  assert.equal(second.accounts[0].status, client.ACCOUNT_STATUS_OK);
  assert.equal(login.mock.callCount(), 1, "one login for both refreshes");
  assert.equal(resume.mock.callCount(), 1, "the first refresh has nothing to resume");
  assert.equal(client.sessionCount(), 1);
});

for (const [name, failResume] of [
  ["throws", async () => Promise.reject(new Error("session expired"))],
  ["finds no account page", async () => null],
]) {
  test(`a resume that ${name} logs in exactly once more with a fresh cookie jar`, async (t) => {
    const login = t.mock.method(openAdapter, "login", async () => ACCOUNT_DATA);
    const resume = t.mock.method(openAdapter, "resumeSession", failResume);
    const client = loadClient();
    const config = moduleConfig();
    const sessionKey = `account-1|${openAdapter.buildAccountUrl(config.libraryConfig)}|12345678`;

    await client.fetchAccountData(config);
    const firstSession = client.getSession(sessionKey);
    const second = await client.fetchAccountData(config);
    const secondSession = client.getSession(sessionKey);

    assert.equal(second.accounts[0].status, client.ACCOUNT_STATUS_OK);
    assert.equal(resume.mock.callCount(), 1);
    assert.equal(login.mock.callCount(), 2);
    assert.notEqual(secondSession, firstSession, "the old session was dropped");
    assert.notEqual(secondSession.jar, firstSession.jar, "the new login starts with an empty cookie jar");
    assert.equal(secondSession.authenticated, true);
    assert.equal(client.sessionCount(), 1);
  });
}

test("a plain http OPAC is reported once, without a certificate probe", async (t) => {
  t.mock.method(openAdapter, "login", async () => ACCOUNT_DATA);
  const client = loadClient();
  const { warnings, logger } = captureLogger();
  const config = moduleConfig({ baseurl: "http://opac.example/webopac/" });

  await client.fetchAccountData(config, { logger });
  await client.fetchAccountData(config, { logger });

  assert.deepEqual(
    warnings.map((w) => w.msg),
    ["OPAC is configured over plain http"],
    "the daily probe cadence also limits the http warning",
  );
  assert.equal(client.stats.probes, 0);
});

test("customssl on a trusted certificate is reported as needless", async (t) => {
  t.mock.method(openAdapter, "login", async () => ACCOUNT_DATA);
  const client = loadClient({ host: "opac.example", hasCertificate: true, authorized: true });
  const { warnings, logger } = captureLogger();

  await client.fetchAccountData(moduleConfig({ customssl: true }), { logger });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].msg, "customssl disables certificate checks needlessly");
  assert.equal(warnings[0].meta.host, "opac.example");
});

test("a certificate problem is reported with its consequence for the TLS setting", async (t) => {
  t.mock.method(openAdapter, "login", async () => ACCOUNT_DATA);
  const selfSigned = {
    host: "opac.example",
    hasCertificate: true,
    authorized: false,
    selfSigned: true,
    authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
  };

  for (const [data, consequence] of [
    [{}, "requests will be refused"],
    [{ customssl: true }, "accepted only because customssl is set; prefer data.ca"],
  ]) {
    const client = loadClient(selfSigned);
    const { warnings, logger } = captureLogger();
    await client.fetchAccountData(moduleConfig(data), { logger });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].msg, "OPAC TLS certificate problem");
    assert.match(warnings[0].meta.problem, /^self-signed certificate/);
    assert.equal(warnings[0].meta.consequence, consequence);
  }
});

test("a trusted certificate without customssl stays silent", async (t) => {
  t.mock.method(openAdapter, "login", async () => ACCOUNT_DATA);
  const client = loadClient({ host: "opac.example", hasCertificate: true, authorized: true });
  const { warnings, logger } = captureLogger();

  await client.fetchAccountData(moduleConfig(), { logger });

  assert.equal(client.stats.probes, 1);
  assert.deepEqual(warnings, []);
});
