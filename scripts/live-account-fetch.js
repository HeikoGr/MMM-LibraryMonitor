const config = require("../config/config.js");
const { fetchAccountData } = require("../lib/opac-client");

function resolveModuleConfig() {
  const moduleEntry = config.modules.find(
    (entry) => entry.module === "MMM-LibraryMonitor",
  );
  if (!moduleEntry?.config) {
    throw new Error(
      "MMM-LibraryMonitor module configuration not found in config/config.js.",
    );
  }

  return {
    ...moduleEntry.config,
    username:
      process.env.MMM_LIBRARY_MONITOR_USERNAME || moduleEntry.config.username,
    password:
      process.env.MMM_LIBRARY_MONITOR_PASSWORD || moduleEntry.config.password,
  };
}

async function main() {
  const accountData = await fetchAccountData(resolveModuleConfig());
  const summary = {
    totalAccounts: accountData.totalAccounts,
    totalItems: accountData.totalItems,
    totalReservations: accountData.totalReservations,
    accounts: Array.isArray(accountData.accounts)
      ? accountData.accounts.map((account) => ({
          label: account.label || null,
          error: account.error || null,
          totalItems: account.totalItems,
          totalReservations: account.totalReservations,
          pendingFees: account.pendingFees,
          validUntil: account.validUntil,
          warning: account.warning || null,
          items: Array.isArray(account.items)
            ? account.items.slice(0, 5).map((item) => ({
                title: item.title,
                coverImageUrl: item.coverImageUrl || null,
                dueDate: item.dueDate,
                branch: item.branch,
                isOverdue: item.isOverdue,
              }))
            : [],
          reservations: Array.isArray(account.reservations)
            ? account.reservations.slice(0, 5).map((item) => ({
                title: item.title,
                status: item.status,
                coverImageUrl: item.coverImageUrl || null,
                branch: item.branch,
                reservationDate: item.reservationDate || null,
                pickupDeadline: item.pickupDeadline || null,
              }))
            : [],
        }))
      : [],
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  main,
  resolveModuleConfig,
};
