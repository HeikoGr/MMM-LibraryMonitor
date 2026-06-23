const NodeHelper = require("node_helper");
const { fetchAccountData } = require("./lib/opac-client");

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
      return;
    }

    this.pendingRequests.set(moduleId, true);
    this.updateAccount(moduleId, payload?.config)
      .catch((error) => {
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
    const data = await fetchAccountData(config || {});
    this.sendSocketNotification(`MMM-LibraryMonitor_DATA#${moduleId}`, data);
  },
});