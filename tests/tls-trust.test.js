const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { fetch: undiciFetch } = require("undici");

const {
  TLS_MODE_INSECURE,
  TLS_MODE_PINNED,
  TLS_MODE_SYSTEM,
  getDispatcher,
  resolveTlsTrust,
} = require("../lib/tls-trust");
const { getSession, clearSessions, sessionCount } = require("../lib/opac-client");

function libraryConfig(data = {}) {
  return {
    api: "open",
    data: {
      baseurl: "https://bibliotheken.example/stadt/de-de",
      urls: { account: "Mein-Konto" },
      ...data,
    },
  };
}

/** Self-signed localhost certificate, or null when openssl is unavailable. */
function createSelfSignedCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-libmon-tls-"));
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");

  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyFile,
        "-out",
        certFile,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    return {
      dir,
      certFile,
      key: fs.readFileSync(keyFile, "utf8"),
      cert: fs.readFileSync(certFile, "utf8"),
    };
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

test("the default is full certificate verification", () => {
  assert.equal(resolveTlsTrust(libraryConfig()).mode, TLS_MODE_SYSTEM);
  assert.equal(getDispatcher(resolveTlsTrust(libraryConfig())), undefined);
});

test("only a literal customssl: true switches verification off", () => {
  assert.equal(resolveTlsTrust(libraryConfig({ customssl: true })).mode, TLS_MODE_INSECURE);
  for (const value of [false, "true", "false", 1]) {
    assert.equal(
      resolveTlsTrust(libraryConfig({ customssl: value })).mode,
      TLS_MODE_SYSTEM,
      `customssl: ${JSON.stringify(value)} must not disable verification`,
    );
  }
});

test("a pinned CA wins over customssl and rejects unusable input", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
  const trust = resolveTlsTrust(libraryConfig({ ca: pem, customssl: true }));
  assert.equal(trust.mode, TLS_MODE_PINNED);
  assert.equal(trust.ca, pem);

  assert.throws(
    () => resolveTlsTrust(libraryConfig({ ca: "does/not/exist.pem" })),
    /Could not read CA certificate file/,
  );
  assert.throws(() => resolveTlsTrust(libraryConfig({ ca: "package.json" })), /not PEM encoded/);
});

test("a self-signed OPAC is refused by default and accepted when pinned", async (t) => {
  const certificate = createSelfSignedCertificate();
  if (!certificate) {
    t.skip("openssl is not available");
    return;
  }
  t.after(() => fs.rmSync(certificate.dir, { recursive: true, force: true }));

  const server = https.createServer({ key: certificate.key, cert: certificate.cert }, (_req, res) => res.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `https://localhost:${server.address().port}/`;

  const request = (data) =>
    undiciFetch(url, {
      dispatcher: getDispatcher(resolveTlsTrust(libraryConfig(data))),
    });

  await assert.rejects(request({}), "system trust must refuse a self-signed certificate");

  const pinned = await request({ ca: certificate.certFile });
  assert.equal(await pinned.text(), "ok");

  const insecure = await request({ customssl: true });
  assert.equal(await insecure.text(), "ok");
});

test("expired sessions are pruned instead of accumulating", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  t.after(() => clearSessions());
  clearSessions();

  getSession("removed-account");
  assert.equal(sessionCount(), 1);

  t.mock.timers.tick(31 * 60 * 1000);
  getSession("current-account");
  assert.equal(sessionCount(), 1, "the expired entry is gone");
});
