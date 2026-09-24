const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("../lib/mmm-shared/mmm-shared");
const { loadModuleDefinition } = require("./helpers/module-loader");

const EVENT = "MMM-LibraryMonitor_EVENT";

/** The real frontend with the real lifecycle, started hidden (e.g. by MMM-Carousel). */
function startHiddenModule() {
  const definition = loadModuleDefinition();
  const sent = [];
  const module = {
    ...definition,
    name: "MMM-LibraryMonitor",
    identifier: "module_0_MMM-LibraryMonitor",
    config: { ...definition.defaults },
    hidden: true,
    data: {},
    sendSocketNotification: (_notification, payload) => sent.push(payload),
    updateDom() {},
    translate: (key) => key,
  };
  globalThis.MMModuleShared = shared;
  module.start();
  return { module, sent };
}

test("after INIT_REQUIRED a hidden display sends CONFIGURE and reports paused again", (t) => {
  const { module, sent } = startHiddenModule();
  t.after(() => {
    module.lifecycle.stop();
    delete globalThis.MMModuleShared;
  });
  assert.deepEqual(
    sent.map((p) => p.action),
    ["CONFIGURE", "SESSION_STATE"],
  );

  // The server restarted: its new hub knows neither the config nor the state.
  sent.length = 0;
  module.socketNotificationReceived(EVENT, { identifier: "*", action: "INIT_REQUIRED" });

  assert.deepEqual(
    sent.map((p) => p.action),
    ["CONFIGURE", "SESSION_STATE"],
  );
  assert.equal(sent[1].data.state, "paused");
});
