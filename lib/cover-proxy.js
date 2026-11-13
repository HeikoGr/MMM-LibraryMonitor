const crypto = require("node:crypto");
const { fetch: undiciFetch } = require("undici");
const { USER_AGENT } = require("./user-agent");

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
// The entry limit alone would allow 300 x 3 MB in memory; this caps what the cache holds in total.
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
// A cover CDN may send one redirect (e.g. to a storage host). The source URL comes from a scraped
// page, so every further hop is a chance to be sent somewhere else. Addresses in the home network
// are deliberately not refused: a local proxy or cover server in front of the OPAC is legitimate,
// and only a response typed image/* is ever passed on.
const MAX_REDIRECTS = 1;

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
 * Two reasons: the supplier does not learn which titles the household has on
 * loan (it otherwise sees one request per title from the home IP), and covers
 * stay available over https even when the OPAC hands out http URLs.
 *
 * Only URLs that were seen in a scraped OPAC page can be requested - the route
 * resolves an opaque id, never a caller-supplied URL - so this is not an open
 * proxy and cannot be used to reach anything else on the network.
 * @param {object} options - { expressApp, moduleName, logger, ttlMs, maxEntries, maxBytes, maxTotalBytes, timeoutMs }
 * @returns {object} { register, has, size, cachedBytes, clear }
 */
function createCoverProxy(options = {}) {
  const moduleName = options.moduleName || "MMM-LibraryMonitor";
  const logger = options.logger || null;
  const ttlMs = Number(options.ttlMs) || DEFAULT_TTL_MS;
  const maxEntries = Number(options.maxEntries) || DEFAULT_MAX_ENTRIES;
  const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;
  const maxTotalBytes = Number(options.maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const basePath = `/${moduleName}/cover`;

  /** id -> source URL, populated only from parsed OPAC pages */
  const known = new Map();
  /** id -> { body, contentType, fetchedAt }, oldest first */
  const cache = new Map();
  /** id -> the fetch already under way, so several displays asking at once cost one request */
  const loading = new Map();
  let cachedBytes = 0;

  function evictIfNeeded(store) {
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
  }

  function dropCached(id) {
    const entry = cache.get(id);
    if (entry) {
      cachedBytes -= entry.body.length;
      cache.delete(id);
    }
  }

  function storeCover(id, entry) {
    // Re-insert so a refreshed cover counts as the newest.
    dropCached(id);
    cache.set(id, entry);
    cachedBytes += entry.body.length;
    while (cache.size > maxEntries || cachedBytes > maxTotalBytes) {
      dropCached(cache.keys().next().value);
    }
  }

  function register(url) {
    if (!isProxyableUrl(url)) {
      return "";
    }

    // Re-insert a known URL: a cover seen in the latest scrape counts as the newest,
    // so eviction drops covers that are no longer on any account first.
    const id = idForUrl(url);
    known.delete(id);
    known.set(id, url);
    evictIfNeeded(known);

    return `${basePath}/${id}`;
  }

  /**
   * Fetch with at most MAX_REDIRECTS redirects, each to http(s) only. One timeout covers all hops.
   * @param {string} sourceUrl - URL seen in a scraped OPAC page
   * @returns {Promise<Response>} The first response that is not a redirect
   */
  async function fetchFollowingOneRedirect(sourceUrl) {
    const signal = AbortSignal.timeout(timeoutMs);
    let url = sourceUrl;
    for (let redirects = 0; ; redirects += 1) {
      const response = await undiciFetch(url, {
        redirect: "manual",
        signal,
        headers: {
          accept: "image/*",
          "user-agent": USER_AGENT,
        },
      });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) {
        return response;
      }

      await response.body?.cancel();
      if (redirects >= MAX_REDIRECTS) {
        throw new Error(`cover request redirected more than ${MAX_REDIRECTS} time(s)`);
      }
      const next = new URL(location, url).href;
      if (!isProxyableUrl(next)) {
        throw new Error("cover request redirected to a non-http(s) URL");
      }
      url = next;
    }
  }

  function loadCover(id, sourceUrl) {
    const cached = cache.get(id);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return Promise.resolve(cached);
    }
    if (!loading.has(id)) {
      loading.set(
        id,
        fetchCover(id, sourceUrl).finally(() => loading.delete(id)),
      );
    }
    return loading.get(id);
  }

  async function fetchCover(id, sourceUrl) {
    // Deliberately always the default, verifying dispatcher: neither
    // `customssl` nor `data.ca` apply here. Covers usually come from a
    // separate supplier, and a cover that fails verification just falls back
    // to the placeholder - there is nothing worth weakening TLS for.
    const response = await fetchFollowingOneRedirect(sourceUrl);

    // Every early exit releases the body: undici keeps the connection until it is read or
    // cancelled, otherwise until garbage collection.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`cover request failed (${response.status})`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      await response.body?.cancel();
      throw new Error(`unexpected cover content type "${contentType}"`);
    }

    // Refuse an announced oversize body before reading it into memory.
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > maxBytes) {
      await response.body?.cancel();
      throw new Error(`cover exceeds ${maxBytes} bytes`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`cover exceeds ${maxBytes} bytes`);
    }

    const entry = { body: buffer, contentType, fetchedAt: Date.now() };
    storeCover(id, entry);
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
    has(url) {
      return known.has(idForUrl(url));
    },
    clear() {
      known.clear();
      cache.clear();
      cachedBytes = 0;
    },
    get cachedBytes() {
      return cachedBytes;
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
