const test = require("node:test");
const assert = require("node:assert/strict");

const { listAdapters, resolveAdapter } = require("../lib/adapters");
const { validateSupportedLibrary } = require("../lib/library-config");
const { runWithConcurrency } = require("../lib/opac-client");
const { createCoverProxy, isProxyableUrl } = require("../lib/cover-proxy");
const { describeCertificateProblem } = require("../lib/tls-probe");

function openConfig(overrides = {}) {
  return {
    api: "open",
    data: {
      baseurl: "https://bibliotheken.example/stadt/de-de",
      urls: { account: "Mein-Konto" },
      ...overrides,
    },
  };
}

test("the adapter registry exposes the open adapter and rejects unknown systems", () => {
  assert.deepEqual(listAdapters(), ["open"]);

  const adapter = resolveAdapter("open");
  for (const method of ["validateConfig", "buildAccountUrl", "resumeSession", "login"]) {
    assert.equal(typeof adapter[method], "function", `adapter must provide ${method}()`);
  }

  assert.throws(() => resolveAdapter("koha"), /Unsupported OPAC api "koha".*open/s);
});

test("the open adapter builds the account URL from base and path", () => {
  const adapter = resolveAdapter("open");

  assert.equal(adapter.buildAccountUrl(openConfig()), "https://bibliotheken.example/stadt/de-de/Mein-Konto");
  assert.equal(
    adapter.buildAccountUrl(openConfig({ baseurl: "https://x.example/a/" })),
    "https://x.example/a/Mein-Konto",
  );
});

test("library validation only accepts http(s) OPAC URLs", () => {
  assert.equal(validateSupportedLibrary(openConfig()).api, "open");

  assert.throws(() => validateSupportedLibrary(openConfig({ baseurl: "file:///etc/passwd" })), /Only http\(s\)/);
  assert.throws(() => validateSupportedLibrary(openConfig({ baseurl: "not-a-url" })), /invalid base URL/);
  assert.throws(
    () =>
      validateSupportedLibrary({
        api: "open",
        data: { baseurl: "https://x.example/" },
      }),
    /does not contain an account page/,
  );
  assert.throws(() => validateSupportedLibrary(null), /Invalid OPAC config/);
});

test("accounts are fetched with a bounded number of parallel logins", async () => {
  const items = [1, 2, 3, 4, 5, 6];
  let inFlight = 0;
  let peak = 0;

  const results = await runWithConcurrency(items, 2, 0, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return value * 2;
  });

  assert.equal(peak, 2, `at most two logins may run at once, saw ${peak}`);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12], "results keep their input order");
});

test("a single account is not delayed by the stagger", async () => {
  const startedAt = Date.now();
  const results = await runWithConcurrency([1], 2, 5000, async (value) => value);

  assert.deepEqual(results, [1]);
  assert.ok(Date.now() - startedAt < 1000, "the first slot must start immediately");
});

test("the cover proxy only accepts URLs scraped from an OPAC page", () => {
  const proxy = createCoverProxy({ moduleName: "MMM-LibraryMonitor" });

  const path = proxy.register("https://images.example/cover.jpg");
  assert.match(path, /^\/MMM-LibraryMonitor\/cover\/[a-f0-9]{32}$/);
  assert.equal(proxy.register("https://images.example/cover.jpg"), path, "the same cover keeps the same id");
  assert.notEqual(path, proxy.register("https://images.example/other.jpg"));

  for (const unsafe of ["javascript:alert(1)", "file:///etc/passwd", "//evil.example/x.jpg", "", null]) {
    assert.equal(proxy.register(unsafe), "", `must refuse ${JSON.stringify(unsafe)}`);
  }

  assert.equal(isProxyableUrl("http://images.example/c.png"), true);
  assert.equal(isProxyableUrl("data:image/png;base64,AAAA"), false);
});

test("certificate problems are described only when something is wrong", () => {
  assert.equal(describeCertificateProblem({ hasCertificate: true, authorized: true }), null);
  assert.equal(describeCertificateProblem(null), null, "a non-TLS host is not a problem");

  assert.match(
    describeCertificateProblem({
      hasCertificate: true,
      authorized: false,
      selfSigned: true,
      authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
    }),
    /self-signed/,
  );
  assert.match(
    describeCertificateProblem({
      hasCertificate: false,
      authorized: false,
      authorizationError: "ECONNRESET",
    }),
    /no TLS certificate/,
  );
});

test("frontend and node_helper redact the same log keys from one file", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const { REDACTED_LOG_KEYS } = require("../lib/log-redaction");

  assert.ok(REDACTED_LOG_KEYS.includes("cardnumber"));
  assert.match(read("node_helper.js"), /require\("\.\/lib\/log-redaction"\)/);
  assert.match(read("MMM-LibraryMonitor.js"), /this\.file\("lib\/log-redaction\.js"\)/);
  assert.doesNotMatch(read("MMM-LibraryMonitor.js"), /const REDACTED_LOG_KEYS/);
});
