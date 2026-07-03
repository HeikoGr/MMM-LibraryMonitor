const NodeHelper = require("node_helper");
const { fetchAccountData } = require("./lib/opac-client");

function isDebugEnabled(config) {
  return Boolean(config?.debug);
}

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

function debugLog(config, message) {
  if (!isDebugEnabled(config)) {
    return;
  }

  console.log(`[MMM-LibraryMonitor][debug] ${message}`);
}

module.exports = NodeHelper.create({
  start() {
    this.pendingRequests = new Map();
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "MMM-LibraryMonitor_FETCH") {
      return;
    }

    const moduleId = payload?.id || "default";
    if (this.pendingRequests.has(moduleId)) {
      debugLog(payload?.config, `skip overlapping update for module=${moduleId}`);
      return;
    }

    debugLog(
      payload?.config,
      `update requested for module=${moduleId} interval=${payload?.config?.updateInterval || "n/a"}ms`,
    );

    this.pendingRequests.set(moduleId, true);
    this.updateAccount(moduleId, payload?.config)
      .catch((error) => {
        debugLog(
          payload?.config,
          `update failed for module=${moduleId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.sendSocketNotification(
          `MMM-LibraryMonitor_ERROR#${moduleId}`,
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.pendingRequests.delete(moduleId);
      });
  },

  async updateAccount(moduleId, config) {
    const startedAt = Date.now();
    const data = await fetchAccountData(config || {});
    const durationMs = Date.now() - startedAt;
    const summaries = Array.isArray(data?.accounts)
      ? data.accounts.map((account) => summarizeAccount(account)).join(" | ")
      : "no accounts";

    debugLog(
      config,
      `update finished for module=${moduleId} in ${durationMs}ms totalLoans=${Number(data?.totalItems) || 0} totalReservations=${Number(data?.totalReservations) || 0} accounts=[${summaries}]`,
    );

    this.sendSocketNotification(`MMM-LibraryMonitor_DATA#${moduleId}`, data);
  },
});
