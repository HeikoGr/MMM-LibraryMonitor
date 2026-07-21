const NodeHelper = require("node_helper");
const { fetchAccountData } = require("./lib/opac-client");
const shared = require("./lib/mmm-shared/mmm-shared");

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
    });
    this.instanceRegistry = shared.createInstanceRegistry({ mode: "auto" });
    this.pendingRequests = new Map();
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== this.notifications.REQUEST) {
      return;
    }

    if (payload?.action !== "FETCH_ACCOUNTS") {
      return;
    }

    const moduleId = this.instanceRegistry.resolveKey(payload?.identifier, payload);
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
    const data = await fetchAccountData(config || {});
    const durationMs = Date.now() - startedAt;
    const summaries = Array.isArray(data?.accounts)
      ? data.accounts.map((account) => summarizeAccount(account)).join(" | ")
      : "no accounts";

    this.logger.info("update finished", {
      moduleId,
      durationMs,
      totalLoans: Number(data?.totalItems) || 0,
      totalReservations: Number(data?.totalReservations) || 0,
      accounts: summaries,
    });

    this.instanceRegistry.set(moduleId, { updatedAt: Date.now() });
    this.transport.sendSuccess(requestEnvelope, data);
  },
});
