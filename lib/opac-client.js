const { fetch: undiciFetch } = require("undici");
const fetchCookieModule = require("fetch-cookie");
const { CookieJar } = require("tough-cookie");
const { resolveAccountConfigs } = require("./library-config");
const { resolveAdapter } = require("./adapters");
const { describeCertificateProblem, probeCertificate } = require("./tls-probe");
const { TLS_MODE_INSECURE, getDispatcher, resolveTlsTrust } = require("./tls-trust");
const { USER_AGENT } = require("./user-agent");

const fetchCookie = fetchCookieModule.default || fetchCookieModule;

const DEFAULT_MAX_CONCURRENT_ACCOUNTS = 2;
const DEFAULT_ACCOUNT_STAGGER_MS = 750;
/** Most OPAC sessions die well before this; the TTL is only a safety net. */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Per-account outcome. `unavailable` means this refresh produced nothing for
 * the account, so the frontend keeps what it showed before instead of
 * replacing it with an empty, errored account.
 */
const ACCOUNT_STATUS_OK = "ok";
const ACCOUNT_STATUS_UNAVAILABLE = "unavailable";

/** accountKey -> { jar, createdAt, authenticated } */
const sessions = new Map();

/**
 * The certificate check is diagnostic only, so once per host and TLS setting a
 * day is enough - a certificate does not change between two refreshes, and
 * each probe is an extra TLS handshake plus, with customssl, a log warning.
 */
const PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** probe key -> epoch ms of the last probe */
const lastProbeAt = new Map();

/**
 * @param {string} key - Host plus TLS setting
 * @param {number} [now] - Epoch ms
 * @returns {boolean} True when this key is due for a probe (and records it)
 */
function shouldProbe(key, now = Date.now()) {
  const last = lastProbeAt.get(key);
  if (last !== undefined && now - last < PROBE_INTERVAL_MS) {
    return false;
  }
  lastProbeAt.set(key, now);
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpClient(tlsTrust, requestTimeout, cookieJar) {
  const wrappedFetch = fetchCookie(undiciFetch, cookieJar);
  const dispatcher = getDispatcher(tlsTrust);

  return async function request(url, options = {}) {
    return wrappedFetch(url, {
      redirect: "follow",
      dispatcher,
      signal: AbortSignal.timeout(requestTimeout),
      headers: {
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
        ...(options.headers || {}),
      },
      ...options,
    });
  };
}

function buildSessionKey(accountConfig, accountUrl) {
  // Credentials are deliberately not part of the key; the username is enough to
  // separate accounts, and a changed password is caught by a failed resume.
  return `${accountConfig.id}|${accountUrl}|${accountConfig.credentials.username}`;
}

function pruneExpiredSessions(now) {
  for (const [key, session] of sessions) {
    if (now - session.createdAt >= SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}

function getSession(sessionKey) {
  const now = Date.now();
  // Expired entries of accounts that were removed from the config would
  // otherwise stay in the map for the lifetime of the process.
  pruneExpiredSessions(now);

  const existing = sessions.get(sessionKey);
  if (existing) {
    return existing;
  }

  const session = {
    jar: new CookieJar(),
    createdAt: now,
    authenticated: false,
  };
  sessions.set(sessionKey, session);
  return session;
}

function resetSession(sessionKey) {
  sessions.delete(sessionKey);
}

function clearSessions() {
  sessions.clear();
  lastProbeAt.clear();
}

function sessionCount() {
  return sessions.size;
}

/**
 * Log-only transport inspection. This never changes whether a request is made;
 * the TLS trust setting decides that. It exists so plain http, a broken
 * certificate or a needless `customssl` shows up in the log instead of going
 * unnoticed.
 */
async function reportTransportSecurity(accountUrl, tlsTrust, requestTimeout, logger) {
  if (!logger) {
    return;
  }

  let probeKey = accountUrl;
  try {
    probeKey = `${new URL(accountUrl).host}|${tlsTrust.mode}|${tlsTrust.ca ? "ca" : ""}`;
  } catch {
    // keep the full URL as key
  }
  if (!shouldProbe(probeKey)) {
    return;
  }

  if (accountUrl.startsWith("http:")) {
    logger.warn("OPAC is configured over plain http", {
      url: accountUrl,
      problem: "card number and password are sent unencrypted",
    });
    return;
  }

  try {
    const probe = await probeCertificate(accountUrl, {
      timeoutMs: Math.min(Number(requestTimeout) || 30000, 10000),
      ca: tlsTrust.ca,
    });
    const problem = describeCertificateProblem(probe);
    const insecure = tlsTrust.mode === TLS_MODE_INSECURE;

    if (insecure && probe && !problem) {
      logger.warn("customssl disables certificate checks needlessly", {
        host: probe.host,
        problem: "the certificate is trusted; remove customssl from the library config",
      });
      return;
    }

    if (problem) {
      logger.warn("OPAC TLS certificate problem", {
        host: probe.host,
        problem,
        consequence: insecure ? "accepted only because customssl is set; prefer data.ca" : "requests will be refused",
        subject: probe.subject,
        issuer: probe.issuer,
        validTo: probe.validTo,
      });
    }
  } catch {
    // A failed probe must never break the actual fetch.
  }
}

async function fetchSingleAccountData(accountConfig, options = {}) {
  const logger = options.logger || null;
  const { libraryConfig, credentials, requestTimeout } = accountConfig;
  const adapter = accountConfig.adapter || resolveAdapter(libraryConfig.api);
  const accountUrl = adapter.buildAccountUrl(libraryConfig);
  const tlsTrust = resolveTlsTrust(libraryConfig);

  await reportTransportSecurity(accountUrl, tlsTrust, requestTimeout, logger);

  const sessionKey = buildSessionKey(accountConfig, accountUrl);
  let session = getSession(sessionKey);

  if (session.authenticated) {
    try {
      const resumed = await adapter.resumeSession({
        libraryConfig,
        fetch: createHttpClient(tlsTrust, requestTimeout, session.jar),
      });

      if (resumed) {
        logger?.debug("reused OPAC session", { account: accountConfig.id });
        return resumed;
      }
    } catch (error) {
      logger?.debug("session resume failed, logging in again", {
        account: accountConfig.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // The old jar is useless now, so start from a clean one.
    resetSession(sessionKey);
    session = getSession(sessionKey);
  }

  const data = await adapter.login({
    libraryConfig,
    credentials,
    fetch: createHttpClient(tlsTrust, requestTimeout, session.jar),
  });

  session.authenticated = true;
  return data;
}

function createAccountResult(accountConfig, data) {
  return {
    id: accountConfig.id,
    label: accountConfig.label,
    ...data,
    status: ACCOUNT_STATUS_OK,
    error: null,
  };
}

function createAccountError(accountConfig, error) {
  return {
    id: accountConfig.id,
    label: accountConfig.label,
    status: ACCOUNT_STATUS_UNAVAILABLE,
    error: error instanceof Error ? error.message : String(error),
    items: [],
    totalItems: 0,
    reservations: [],
    totalReservations: 0,
    pendingFees: "",
    validUntil: "",
    warning: "",
  };
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Each worker slot
 * starts `staggerMs` later than the previous one, so a family of accounts does
 * not hit the same OPAC with simultaneous logins.
 */
async function runWithConcurrency(items, limit, staggerMs, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runSlot(slot) {
    if (staggerMs > 0 && slot > 0) {
      await delay(slot * staggerMs);
    }

    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  }

  const slots = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: slots }, (_, slot) => runSlot(slot)));

  return results;
}

function resolvePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function fetchAccountData(moduleConfig = {}, options = {}) {
  const logger = options.logger || null;
  const accountConfigs = resolveAccountConfigs(moduleConfig);

  const maxConcurrent = Math.max(
    1,
    Math.floor(resolvePositiveNumber(moduleConfig.maxConcurrentAccounts, DEFAULT_MAX_CONCURRENT_ACCOUNTS)),
  );
  const staggerMs = resolvePositiveNumber(moduleConfig.accountStaggerMs, DEFAULT_ACCOUNT_STAGGER_MS);

  const accounts = await runWithConcurrency(accountConfigs, maxConcurrent, staggerMs, async (accountConfig) => {
    try {
      const data = await fetchSingleAccountData(accountConfig, { logger });
      return createAccountResult(accountConfig, data);
    } catch (error) {
      return createAccountError(accountConfig, error);
    }
  });

  return {
    accounts,
    totalAccounts: accounts.length,
    totalItems: accounts.reduce((sum, account) => sum + (Number(account.totalItems) || 0), 0),
    totalReservations: accounts.reduce((sum, account) => sum + (Number(account.totalReservations) || 0), 0),
  };
}

module.exports = {
  ACCOUNT_STATUS_OK,
  ACCOUNT_STATUS_UNAVAILABLE,
  clearSessions,
  fetchAccountData,
  getSession,
  runWithConcurrency,
  sessionCount,
  shouldProbe,
};
