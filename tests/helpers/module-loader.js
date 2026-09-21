const shared = require("../../lib/mmm-shared/mmm-shared");

const modulePath = require.resolve("../../MMM-LibraryMonitor.js");

/** Capture the object passed to `Module.register`. */
function loadModuleDefinition() {
  let definition = null;

  global.Module = {
    register(_name, moduleDefinition) {
      definition = moduleDefinition;
    },
  };

  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  delete global.Module;

  if (!definition) {
    throw new Error("Failed to load MMM-LibraryMonitor module definition");
  }

  return definition;
}

/**
 * A module instance wired up just far enough to call `getDom()` and to feed it
 * socket notifications. The lifecycle is stubbed out because rendering must not
 * depend on timers; `translate` echoes the key so assertions do not depend on
 * the translation files.
 */
function createRenderer(configOverrides = {}) {
  const definition = loadModuleDefinition();

  return {
    ...definition,
    name: "MMM-LibraryMonitor",
    identifier: "module_0_MMM-LibraryMonitor",
    config: { ...definition.defaults, ...configOverrides },
    notifications: shared.buildNotifications("MMM-LibraryMonitor"),
    lifecycle: {
      renders: 0,
      dataReceived: 0,
      fetchFailures: 0,
      markDataReceived() {
        this.dataReceived += 1;
      },
      markFetchFailed() {
        this.fetchFailures += 1;
      },
      render() {
        this.renders += 1;
      },
    },
    loaded: true,
    error: null,
    accountData: null,
    lastSuccessfulData: null,
    translate: (key) => key,
  };
}

module.exports = {
  createRenderer,
  loadModuleDefinition,
};
