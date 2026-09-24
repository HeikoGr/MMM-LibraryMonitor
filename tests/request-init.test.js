const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRequestInit } = require("../lib/opac-client");
const { USER_AGENT } = require("../lib/user-agent");

test("the login POST keeps the default user-agent and language next to its own content-type", () => {
  const init = buildRequestInit(
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" },
    null,
    30000,
  );

  assert.equal(init.method, "POST");
  assert.equal(init.body, "a=1");
  assert.deepEqual(init.headers, {
    "accept-language": "de-DE,de;q=0.9,en;q=0.8",
    "user-agent": USER_AGENT,
    "content-type": "application/x-www-form-urlencoded",
  });
});

test("a plain GET gets the defaults, a timeout signal and follows redirects", () => {
  const init = buildRequestInit({}, null, 30000);

  assert.equal(init.redirect, "follow");
  assert.equal(init.headers["user-agent"], USER_AGENT);
  assert.ok(init.signal instanceof AbortSignal);
});
