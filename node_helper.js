const NodeHelper = require("node_helper");
const { fetchAccountData } = require("./lib/opac-client");
const { createCoverProxy } = require("./lib/cover-proxy");
const { createResultCache } = require("./lib/result-cache");
const shared = require("./lib/mmm-shared/mmm-shared");

/**
 * The shared default list stops at `password`, but a library card number is a
 * personal identifier in its own right and must not reach the log either.
 */
const REDACTED_LOG_KEYS = [
  "password",
  "token",
  "apikey",
  "secret",
  "qrcode",
  "refreshtoken",
  "username",
  "cardnumber",
  "credentials",
];

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

module.exports = NodeHelper.create({
  start() {
    this.notifications = shared.buildNotifications("MMM-LibraryMonitor");
    this.transport = shared.createNodeTransport({
      moduleName: "MMM-LibraryMonitor",
      sendSocketNotification: this.sendSocketNotification.bind(this),
    });
    this.errorFactory = shared.createErrorFactory();
    this.logger = shared.createLogger({
      moduleName: "MMM-LibraryMonitor",
      identifier: "node_helper",
      getLevel: () => "info",
      structured: true,
      redact: true,
      redactedKeys: REDACTED_LOG_KEYS,
    });
    this.instanceRegistry = shared.createInstanceRegistry({ mode: "auto" });
    this.pendingRequests = new Map();
    this.resultCache = createResultCache();
    this.coverProxy = createCoverProxy({
      expressApp: this.expressApp,
      moduleName: this.name,
      logger: this.logger,
    });
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
        items: Array.isArray(account.items)
          ? account.items.map(mapItem)
          : account.items,
        reservations: Array.isArray(account.reservations)
          ? account.reservations.map(mapItem)
          : account.reservations,
      })),
    };
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== this.notifications.REQUEST) {
      return;
    }

    if (payload?.action !== "FETCH_ACCOUNTS") {
      return;
    }

    const moduleId = this.instanceRegistry.resolveKey(
      payload?.identifier,
      payload,
    );
    const moduleConfig = payload?.data?.config || {};
    if (this.pendingRequests.has(moduleId)) {
      this.logger.debug("skip overlapping update", {
        moduleId,
        action: payload?.action,
      });
      return;
    }

    this.logger.info("update requested", {
      moduleId,
      intervalMs: moduleConfig.updateInterval || null,
      requestId: payload?.requestId,
    });

    this.pendingRequests.set(moduleId, true);
    this.updateAccount(moduleId, moduleConfig, payload)
      .catch((error) => {
        this.logger.error("update failed", {
          moduleId,
          message: error instanceof Error ? error.message : String(error),
          requestId: payload?.requestId,
        });
        this.transport.sendError(
          payload,
          this.errorFactory.fromException(error, {
            code: "FETCH_FAILED",
            retryable: true,
            details: { moduleId },
          }),
        );
      })
      .finally(() => {
        this.pendingRequests.delete(moduleId);
      });
  },

  async updateAccount(moduleId, config, requestEnvelope) {
    const startedAt = Date.now();
    this.resultCache.setTtl(config?.resultCacheTtl);
    const cacheKey = this.resultCache.buildCacheKey(config);

    let data = this.resultCache.get(cacheKey);
    const fromCache = data !== null;

    if (!fromCache) {
      data = await fetchAccountData(config || {}, { logger: this.logger });
      this.resultCache.set(cacheKey, data);
    }

    const durationMs = Date.now() - startedAt;
    const summaries = Array.isArray(data?.accounts)
      ? data.accounts.map((account) => summarizeAccount(account)).join(" | ")
      : "no accounts";

    this.logger.info("update finished", {
      moduleId,
      durationMs,
      fromCache,
      totalLoans: Number(data?.totalItems) || 0,
      totalReservations: Number(data?.totalReservations) || 0,
      accounts: summaries,
    });

    this.instanceRegistry.set(moduleId, { updatedAt: Date.now() });
    this.transport.sendSuccess(
      requestEnvelope,
      this.applyCoverProxy(data, config),
    );
  },
});
