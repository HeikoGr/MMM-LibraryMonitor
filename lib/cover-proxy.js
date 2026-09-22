const crypto = require("node:crypto");
const { fetch: undiciFetch } = require("undici");
const { USER_AGENT } = require("./user-agent");

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

function isProxyableUrl(value) {
  if (typeof value !== "string" || value === "") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function idForUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
}

/**
 * Serves book covers through the mirror instead of letting the browser load
 * them from the library's cover supplier directly.
 *
 * Two reasons: the supplier no longer learns which titles the household has on
 * loan (it otherwise sees one request per title from the home IP), and covers
 * stay available over https even when the OPAC hands out http URLs.
 *
 * Only URLs that were seen in a scraped OPAC page can be requested - the route
 * resolves an opaque id, never a caller-supplied URL - so this is not an open
 * proxy and cannot be used to reach anything else on the network.
 * @param {object} options - { expressApp, moduleName, logger, ttlMs, maxEntries }
 * @returns {object} { register, size, clear }
 */
function createCoverProxy(options = {}) {
  const moduleName = options.moduleName || "MMM-LibraryMonitor";
  const logger = options.logger || null;
  const ttlMs = Number(options.ttlMs) || DEFAULT_TTL_MS;
  const maxEntries = Number(options.maxEntries) || DEFAULT_MAX_ENTRIES;
  const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const basePath = `/${moduleName}/cover`;

  /** id -> source URL, populated only from parsed OPAC pages */
  const known = new Map();
  /** id -> { body, contentType, fetchedAt } */
  const cache = new Map();

  function evictIfNeeded(store) {
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
  }

  function register(url) {
    if (!isProxyableUrl(url)) {
      return "";
    }

    const id = idForUrl(url);
    if (!known.has(id)) {
      known.set(id, url);
      evictIfNeeded(known);
    }

    return `${basePath}/${id}`;
  }

  async function loadCover(id, sourceUrl) {
    const cached = cache.get(id);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return cached;
    }

    // Deliberately always the default, verifying dispatcher: neither
    // `customssl` nor `data.ca` apply here. Covers usually come from a
    // separate supplier, and a cover that fails verification just falls back
    // to the placeholder - there is nothing worth weakening TLS for.
    const response = await undiciFetch(sourceUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "image/*",
        "user-agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`cover request failed (${response.status})`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`unexpected cover content type "${contentType}"`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`cover exceeds ${maxBytes} bytes`);
    }

    const entry = { body: buffer, contentType, fetchedAt: Date.now() };
    cache.set(id, entry);
    evictIfNeeded(cache);
    return entry;
  }

  if (options.expressApp) {
    options.expressApp.get(`${basePath}/:id`, async (req, res) => {
      const sourceUrl = known.get(req.params.id);
      if (!sourceUrl) {
        res.status(404).end();
        return;
      }

      try {
        const entry = await loadCover(req.params.id, sourceUrl);
        res.set("content-type", entry.contentType);
        res.set("cache-control", `public, max-age=${Math.floor(ttlMs / 1000)}`);
        res.send(entry.body);
      } catch (error) {
        logger?.debug("cover proxy failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        // The frontend falls back to its placeholder on any error status.
        res.status(502).end();
      }
    });
  }

  return {
    register,
    clear() {
      known.clear();
      cache.clear();
    },
    get size() {
      return known.size;
    },
  };
}

module.exports = {
  createCoverProxy,
  isProxyableUrl,
};
