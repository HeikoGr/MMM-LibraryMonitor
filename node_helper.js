const NodeHelper = require("node_helper");
const { ACCOUNT_STATUS_UNAVAILABLE, fetchAccountData } = require("./lib/opac-client");
const { createInstanceHub, formatLogEntry } = require("./lib/mmm-shared/backend-session");
const { resolveAccountConfigs } = require("./lib/library-config");
const { createCoverProxy } = require("./lib/cover-proxy");
const shared = require("./lib/mmm-shared/mmm-shared");
const { REDACTED_LOG_KEYS } = require("./lib/log-redaction");

// MagicMirror's logger carries the global logLevel; outside MagicMirror (tests) console.
const Log = (() => {
  try {
    return require("logger");
  } catch {
    return console;
  }
})();

// One line per entry. Defined in this file on purpose: MagicMirror tags each line
// with the folder of the file that calls Log, so it reads [MMM-...], not [mmm-shared].
const logSink = Object.fromEntries(
  ["debug", "info", "warn", "error"].map((method) => [method, (entry) => Log[method](formatLogEntry(entry))]),
);

function getAccountName(account) {
  return account?.label || account?.id || "account";
}

function summarizeAccount(account) {
  if (account?.error) {
    return `${getAccountName(account)}: error=${account.error}`;
  }

  return [
    `${getAccountName(account)}: loans=${Number(account?.totalItems) || 0}`,
    `reservations=${Number(account?.totalReservations) || 0}`,
    `fees=${account?.pendingFees || "0,00 EUR"}`,
    `validUntil=${account?.validUntil || "-"}`,
    `warning=${account?.warning || "-"}`,
  ].join(", ");
}

/** Two displays of one instance must read the same library accounts. */
const CRITICAL_CONFIG_KEYS = Object.freeze([
  "libraryConfig",
  "libraryConfigFile",
  "accounts",
  "username",
  "password",
  "account",
]);

/**
 * Nothing usable came back: every account is unavailable. The data still goes
 * out (the frontend keeps each account's previous state), but it counts as a
 * failed fetch for the backoff and the retry.
 */
function isTotalFailure(data) {
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  return accounts.length > 0 && accounts.every((account) => account?.status === ACCOUNT_STATUS_UNAVAILABLE);
}

/**
 * Send at most maxItems loans and reservations per account (MODULE-PLAN C2);
 * the frontend only needs the number of the rest for its "+N more" line.
 */
function limitItems(data, maxItems) {
  const limit = Number(maxItems);
  if (!Number.isFinite(limit) || limit < 0 || !Array.isArray(data?.accounts)) {
    return data;
  }

  const cut = (list) => (Array.isArray(list) ? list.slice(0, limit) : list);
  const rest = (list) => (Array.isArray(list) ? Math.max(0, list.length - limit) : 0);

  return {
    ...data,
    accounts: data.accounts.map((account) => ({
      ...account,
      items: cut(account.items),
      reservations: cut(account.reservations),
      moreItems: rest(account.items),
      moreReservations: rest(account.reservations),
    })),
  };
}

module.exports = NodeHelper.create({
  start() {
    // One logger per instance: its logLevel (from CONFIGURE) narrows the global
    // level for that instance only. Until CONFIGURE only the global level applies.
    this.loggers = new Map();
    this.logLevels = new Map();
    this.logger = this.getLogger("node_helper");
    this.coverProxy = createCoverProxy({
      expressApp: this.expressApp,
      moduleName: this.name,
      logger: this.logger,
    });

    /*
     * The frontend sends its config once (CONFIGURE) and reports whether it is
     * visible (SESSION_STATE). The hub runs one backend schedule per instance
     * (6 h anchored grid by default), retries a failed refresh with backoff and
     * pushes the result as DATA events.
     */
    this.hub = createInstanceHub({
      moduleName: "MMM-LibraryMonitor",
      sendSocketNotification: this.sendSocketNotification.bind(this),
      logger: this.logger,
      criticalKeys: CRITICAL_CONFIG_KEYS,
      prepareConfig: (config) => {
        // Throws for an unsupported or incomplete library config.
        resolveAccountConfigs(config);
        if (config.resultCacheTtl !== undefined) {
          this.logger.warn("resultCacheTtl is no longer used and can be removed from config.js");
        }
        return { ...config };
      },
      lifecycleOptions: (config) => ({
        updateInterval: config.updateInterval,
        minUpdateInterval: 60 * 1000,
        anchorHour: config.updateAnchorHour,
        backgroundRefresh: config.backgroundRefresh !== false,
        quietHours: config.quietHours,
      }),
      isFailure: isTotalFailure,
      onConfigured: (identifier, config) => {
        this.logLevels.set(identifier, config.logLevel);
      },
      fetch: ({ identifier, config, reason }) => this.updateAccount(identifier, config, reason),
      // Tests inject a clock and timers here.
      ...this.hubOptions,
    });
    this.hub.attach(this.io);
  },

  stop() {
    this.hub?.stop();
  },

  getLogger(identifier) {
    if (!this.loggers.has(identifier)) {
      this.loggers.set(
        identifier,
        shared.createLogger({
          moduleName: "MMM-LibraryMonitor",
          identifier,
          consoleRef: logSink,
          getLevel: () => this.logLevels.get(identifier),
          structured: true,
          redact: true,
          redactedKeys: REDACTED_LOG_KEYS,
        }),
      );
    }
    return this.loggers.get(identifier);
  },

  /**
   * Replace supplier cover URLs with local proxy paths, so the browser never
   * talks to the cover supplier directly. The cached payload is left untouched.
   */
  applyCoverProxy(data, config) {
    if (config?.proxyBookCovers === false || !Array.isArray(data?.accounts)) {
      return data;
    }

    const mapItem = (item) => {
      if (!item?.coverImageUrl) {
        return item;
      }

      const proxied = this.coverProxy.register(item.coverImageUrl);
      return proxied ? { ...item, coverImageUrl: proxied } : item;
    };

    return {
      ...data,
      accounts: data.accounts.map((account) => ({
        ...account,
        items: Array.isArray(account.items) ? account.items.map(mapItem) : account.items,
        reservations: Array.isArray(account.reservations) ? account.reservations.map(mapItem) : account.reservations,
      })),
    };
  },

  socketNotificationReceived(notification, payload) {
    // CONFIGURE and SESSION_STATE are the only requests the frontend sends.
    this.hub.socketNotificationReceived(notification, payload);
  },

  async updateAccount(moduleId, config, reason) {
    const logger = this.getLogger(moduleId);
    const startedAt = Date.now();
    const data = await fetchAccountData(config || {}, { logger });

    const durationMs = Date.now() - startedAt;
    const summaries = Array.isArray(data?.accounts)
      ? data.accounts.map((account) => summarizeAccount(account)).join(" | ")
      : "no accounts";

    logger.info("update finished", {
      moduleId,
      reason,
      durationMs,
      totalLoans: Number(data?.totalItems) || 0,
      totalReservations: Number(data?.totalReservations) || 0,
      accounts: summaries,
    });

    return limitItems(this.applyCoverProxy(data, config), config.maxItems);
  },
});
