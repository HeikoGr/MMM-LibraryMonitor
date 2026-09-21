const { Agent, fetch: undiciFetch } = require("undici");
const fetchCookieModule = require("fetch-cookie");
const { CookieJar } = require("tough-cookie");
const { resolveAccountConfigs } = require("./library-config");
const { resolveAdapter } = require("./adapters");
const { describeCertificateProblem, probeCertificate } = require("./tls-probe");

const fetchCookie = fetchCookieModule.default || fetchCookieModule;

const DEFAULT_MAX_CONCURRENT_ACCOUNTS = 2;
const DEFAULT_ACCOUNT_STAGGER_MS = 750;
/** Most OPAC sessions die well before this; the TTL is only a safety net. */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** accountKey -> { jar, createdAt, authenticated } */
const sessions = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpClient(libraryConfig, requestTimeout, cookieJar) {
  const wrappedFetch = fetchCookie(undiciFetch, cookieJar);
  const insecureDispatcher = libraryConfig?.data?.customssl
    ? new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      })
    : undefined;

  return async function request(url, options = {}) {
    return wrappedFetch(url, {
      redirect: "follow",
      dispatcher: insecureDispatcher,
      signal: AbortSignal.timeout(requestTimeout),
      headers: {
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        "user-agent": "MMM-LibraryMonitor/0.1 (+MagicMirror²)",
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

function getSession(sessionKey) {
  const existing = sessions.get(sessionKey);
  if (existing && Date.now() - existing.createdAt < SESSION_TTL_MS) {
    return existing;
  }

  const session = {
    jar: new CookieJar(),
    createdAt: Date.now(),
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
}

/**
 * Log-only certificate inspection. This never changes whether a request is
 * made; `customssl` still decides that. It exists so a broken or missing
 * certificate shows up in the log instead of failing silently.
 */
async function reportCertificate(accountUrl, requestTimeout, logger) {
  if (!logger) {
    return;
  }

  try {
    const probe = await probeCertificate(accountUrl, {
      timeoutMs: Math.min(Number(requestTimeout) || 30000, 10000),
    });
    const problem = describeCertificateProblem(probe);
    if (problem) {
      logger.warn("OPAC TLS certificate problem", {
        host: probe.host,
        problem,
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
  const adapter = resolveAdapter(libraryConfig.api);
  const accountUrl = adapter.buildAccountUrl(libraryConfig);

  await reportCertificate(accountUrl, requestTimeout, logger);

  const sessionKey = buildSessionKey(accountConfig, accountUrl);
  let session = getSession(sessionKey);

  if (session.authenticated) {
    try {
      const resumed = await adapter.resumeSession({
        libraryConfig,
        fetch: createHttpClient(libraryConfig, requestTimeout, session.jar),
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
    fetch: createHttpClient(libraryConfig, requestTimeout, session.jar),
  });

  session.authenticated = true;
  return data;
}

function createAccountResult(accountConfig, data) {
  return {
    id: accountConfig.id,
    label: accountConfig.label,
    error: null,
    ...data,
  };
}

function createAccountError(accountConfig, error) {
  return {
    id: accountConfig.id,
    label: accountConfig.label,
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
    Math.floor(
      resolvePositiveNumber(
        moduleConfig.maxConcurrentAccounts,
        DEFAULT_MAX_CONCURRENT_ACCOUNTS,
      ),
    ),
  );
  const staggerMs = resolvePositiveNumber(
    moduleConfig.accountStaggerMs,
    DEFAULT_ACCOUNT_STAGGER_MS,
  );

  const accounts = await runWithConcurrency(
    accountConfigs,
    maxConcurrent,
    staggerMs,
    async (accountConfig) => {
      try {
        const data = await fetchSingleAccountData(accountConfig, { logger });
        return createAccountResult(accountConfig, data);
      } catch (error) {
        return createAccountError(accountConfig, error);
      }
    },
  );

  return {
    accounts,
    totalAccounts: accounts.length,
    totalItems: accounts.reduce(
      (sum, account) => sum + (Number(account.totalItems) || 0),
      0,
    ),
    totalReservations: accounts.reduce(
      (sum, account) => sum + (Number(account.totalReservations) || 0),
      0,
    ),
  };
}

module.exports = {
  clearSessions,
  fetchAccountData,
  runWithConcurrency,
};
