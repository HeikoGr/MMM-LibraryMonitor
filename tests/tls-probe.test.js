const test = require("node:test");
const assert = require("node:assert/strict");
const tls = require("node:tls");
const { EventEmitter } = require("node:events");
const { probeCertificate } = require("../lib/tls-probe");

test("every probe does a real handshake - the daily cadence lives in opac-client, not in a cache", async (t) => {
  let handshakes = 0;
  t.mock.method(tls, "connect", () => {
    handshakes += 1;
    const socket = new EventEmitter();
    socket.destroy = () => {};
    setImmediate(() => socket.emit("error", new Error("certificate has expired")));
    return socket;
  });

  await probeCertificate("https://opac.example/");
  await probeCertificate("https://opac.example/");

  assert.equal(handshakes, 2, "a certificate that changed since the first probe must be seen");
});
