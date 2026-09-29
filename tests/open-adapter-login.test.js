const test = require("node:test");
const assert = require("node:assert/strict");

const adapter = require("../lib/adapters/open");

const libraryConfig = { data: { baseurl: "https://opac.example/", urls: { account: "Mein-Konto" } } };

function loginPage(viewstate, error = "") {
  return `<html><body><form action="/Mein-Konto">
    <input type="hidden" name="__VIEWSTATE" value="${viewstate}">
    <input type="text" name="ctl00$Main$txtUsername"><input type="password" name="ctl00$Main$txtPassword">
    <input type="submit" name="ctl00$Main$cmdLogin" value="Anmelden">
    ${error ? `<div class="dnnFormValidationSummary">${error}</div>` : ""}
  </form></body></html>`;
}

const OVERVIEW = `<html><body><table id="ctl00_tpnlLoans_ucLoansView_grdViewLoans"><tr><th>Titel</th></tr></table></body></html>`;

/**
 * Fake OPAC: every page load hands out a new __VIEWSTATE; a POST is accepted with any
 * viewstate the server issued since `validSince`, like ASP.NET until its keys change.
 */
function createOpac({ staleAnswer = "error" } = {}) {
  const opac = { issued: [], validSince: 0, requests: [] };
  opac.fetch = async (_url, options = {}) => {
    const method = options.method || "GET";
    opac.requests.push(method);
    const respond = (status, text) => ({
      ok: status < 400,
      status,
      statusText: String(status),
      text: async () => text,
    });

    if (method === "GET") {
      opac.issued.push(`vs${opac.issued.length}`);
      return respond(200, loginPage(opac.issued.at(-1)));
    }

    const body = new URLSearchParams(options.body);
    const index = opac.issued.indexOf(body.get("__VIEWSTATE"));
    if (index < opac.validSince) {
      // ASP.NET answers an invalid viewstate with an error page; some setups show the login page again.
      return staleAnswer === "error" ? respond(500, "Invalid viewstate") : respond(200, loginPage("vsX"));
    }
    if (body.get("ctl00$Main$txtPassword") !== "right") {
      return respond(200, loginPage("vsY", "Anmeldung fehlgeschlagen"));
    }
    return respond(200, OVERVIEW);
  };
  return opac;
}

test.beforeEach(() => adapter.clearLoginForms());

test("the login form is loaded once and posted for every further login", async () => {
  const opac = createOpac();
  const credentials = { username: "1", password: "right" };

  await adapter.login({ libraryConfig, credentials, fetch: opac.fetch });
  await adapter.login({ libraryConfig, credentials: { username: "2", password: "right" }, fetch: opac.fetch });
  await adapter.login({ libraryConfig, credentials, fetch: opac.fetch });

  assert.deepEqual(opac.requests, ["GET", "POST", "POST", "POST"]);
});

for (const staleAnswer of ["error", "login page"]) {
  test(`a kept form the server no longer accepts (${staleAnswer}) is replaced by a fresh one`, async () => {
    const opac = createOpac({ staleAnswer });
    const credentials = { username: "1", password: "right" };
    await adapter.login({ libraryConfig, credentials, fetch: opac.fetch });

    opac.validSince = opac.issued.length; // the server's keys changed
    opac.requests.length = 0;
    const data = await adapter.login({ libraryConfig, credentials, fetch: opac.fetch });

    assert.deepEqual(opac.requests, ["POST", "GET", "POST"]);
    assert.ok(data);
    opac.requests.length = 0;
    await adapter.login({ libraryConfig, credentials, fetch: opac.fetch });
    assert.deepEqual(opac.requests, ["POST"], "the fresh form is kept");
  });
}

test("wrong credentials are never retried, with a kept form or a fresh one", async () => {
  const opac = createOpac();
  await adapter.login({ libraryConfig, credentials: { username: "1", password: "right" }, fetch: opac.fetch });

  opac.requests.length = 0;
  await assert.rejects(
    adapter.login({ libraryConfig, credentials: { username: "2", password: "wrong" }, fetch: opac.fetch }),
    /Anmeldung fehlgeschlagen/,
  );
  assert.deepEqual(opac.requests, ["POST"], "one attempt, no second POST");

  adapter.clearLoginForms();
  opac.requests.length = 0;
  await assert.rejects(
    adapter.login({ libraryConfig, credentials: { username: "2", password: "wrong" }, fetch: opac.fetch }),
    /Anmeldung fehlgeschlagen/,
  );
  assert.deepEqual(opac.requests, ["GET", "POST"]);
});

test("the kept form carries no credentials", async () => {
  const opac = createOpac();
  const bodies = [];
  const recording = async (url, options = {}) => {
    if (options.body) bodies.push(options.body);
    return opac.fetch(url, options);
  };
  await adapter.login({ libraryConfig, credentials: { username: "alice", password: "right" }, fetch: recording });
  await adapter.login({ libraryConfig, credentials: { username: "bob", password: "right" }, fetch: recording });

  assert.doesNotMatch(bodies[1], /alice/);
});
