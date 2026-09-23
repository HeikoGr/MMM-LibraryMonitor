const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Stable cache key for a resolved module config. Credentials are hashed rather
 * than stored, so a changed password invalidates the entry without the key ever
 * holding the secret.
 * @param {object} moduleConfig - The module config as received from the frontend
 * @returns {string} Hash key
 */
function buildCacheKey(moduleConfig = {}) {
  const relevant = {
    libraryConfig: moduleConfig.libraryConfig || null,
    libraryConfigFile: moduleConfig.libraryConfigFile || null,
    requestTimeout: moduleConfig.requestTimeout || null,
    accounts: Array.isArray(moduleConfig.accounts) ? moduleConfig.accounts : null,
    username: moduleConfig.username || null,
    password: moduleConfig.password || null,
    account: moduleConfig.account || null,
  };

  return crypto.createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

/**
 * Short-lived cache for fetched account data, so a browser reload or a second
 * mirror client does not trigger another OPAC login.
 * @param {object} [options] - { ttlMs, now }
 * @returns {object} { get, set, clear, buildCacheKey }
 */
function createResultCache(options = {}) {
  let ttlMs = Number.isFinite(Number(options.ttlMs)) ? Math.max(0, Number(options.ttlMs)) : DEFAULT_TTL_MS;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const entries = new Map();

  return {
    /** The TTL is a module config option, which only arrives with a request. */
    setTtl(value) {
      if (!Number.isFinite(Number(value))) {
        return;
      }

      const next = Math.max(0, Number(value));
      if (next !== ttlMs) {
        ttlMs = next;
        entries.clear();
      }
    },
    get(key) {
      if (ttlMs === 0) {
        return null;
      }

      const entry = entries.get(key);
      if (!entry) {
        return null;
      }

      if (now() - entry.storedAt >= ttlMs) {
        entries.delete(key);
        return null;
      }

      return entry.value;
    },
    set(key, value) {
      if (ttlMs === 0) {
        return;
      }
      entries.set(key, { value, storedAt: now() });
    },
    clear() {
      entries.clear();
    },
    buildCacheKey,
  };
}

module.exports = {
  buildCacheKey,
  createResultCache,
};
