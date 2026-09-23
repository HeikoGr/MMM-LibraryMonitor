const openAdapter = require("./open");

/**
 * Registry of supported OPAC systems. Adding a library system means adding an
 * adapter module here; nothing else in the module needs to change.
 *
 * An adapter exposes:
 *   api            - value matched against `libraryConfig.api`
 *   label          - human readable name, used in error messages
 *   validateConfig - throws when the library config is unusable
 *   resumeSession  - returns parsed data when an existing cookie jar is still
 *                    logged in, or null when a full login is required
 *   login          - performs the full login and returns parsed data
 */
const adapters = new Map([[openAdapter.api, openAdapter]]);

function listAdapters() {
  return [...adapters.keys()];
}

function resolveAdapter(api) {
  const adapter = adapters.get(api);
  if (!adapter) {
    throw new Error(`Unsupported OPAC api "${api}". Supported: ${listAdapters().join(", ")}.`);
  }

  return adapter;
}

module.exports = {
  listAdapters,
  resolveAdapter,
};
