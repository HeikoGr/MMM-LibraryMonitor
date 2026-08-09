const fs = require("node:fs");
const path = require("node:path");

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function readLibraryConfigFile(filePath) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(__dirname, "..", filePath);

  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, "utf8");
  } catch {
    throw new Error(`Could not read library config file: ${filePath}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse library config file: ${filePath}`);
  }
}

function resolveLibraryConfig(moduleConfig = {}) {
  if (
    moduleConfig.libraryConfig &&
    typeof moduleConfig.libraryConfig === "object"
  ) {
    return cloneConfig(moduleConfig.libraryConfig);
  }

  if (moduleConfig.libraryConfigFile) {
    return readLibraryConfigFile(moduleConfig.libraryConfigFile);
  }

  throw new Error("Library config is required.");
}

function resolveCredentials(moduleConfig = {}) {
  const nestedAccount = moduleConfig.account || {};
  const username = nestedAccount.username || moduleConfig.username || "";
  const password = nestedAccount.password || moduleConfig.password || "";

  if (!username) {
    throw new Error("Library account username is missing.");
  }
  if (!password) {
    throw new Error("Library account password is missing.");
  }

  return { username, password };
}

function resolveAccountConfigs(moduleConfig = {}) {
  const hasAccountList =
    Array.isArray(moduleConfig.accounts) && moduleConfig.accounts.length > 0;
  const accountEntries = hasAccountList
    ? moduleConfig.accounts
    : [moduleConfig];

  const sharedAccountOptions = {
    libraryConfig: moduleConfig.libraryConfig || null,
    libraryConfigFile: moduleConfig.libraryConfigFile || null,
    requestTimeout: moduleConfig.requestTimeout,
  };

  return accountEntries.map((entry, index) => {
    const accountConfig = hasAccountList
      ? {
        ...sharedAccountOptions,
        ...(entry || {}),
        account: entry?.account || {},
      }
      : {
        ...sharedAccountOptions,
        ...moduleConfig,
        account: moduleConfig.account || {},
      };

    const libraryConfig = resolveLibraryConfig(accountConfig);
    validateSupportedLibrary(libraryConfig);

    return {
      id: accountConfig.id || `account-${index + 1}`,
      label:
        typeof accountConfig.label === "string" && accountConfig.label.trim()
          ? accountConfig.label.trim()
          : "",
      requestTimeout: Number(accountConfig.requestTimeout) || 30000,
      credentials: resolveCredentials(accountConfig),
      libraryConfig,
    };
  });
}

function validateSupportedLibrary(libraryConfig) {
  if (!libraryConfig || typeof libraryConfig !== "object") {
    throw new Error("Invalid OPAC config.");
  }

  if (libraryConfig.api !== "open") {
    throw new Error("Only OPEN-OPAC configs are supported.");
  }

  const baseurl = libraryConfig?.data?.baseurl || "";
  try {
    new URL(baseurl);
  } catch {
    throw new Error("The OPAC config contains an invalid base URL.");
  }

  if (!libraryConfig?.data?.urls?.account) {
    throw new Error("The OPAC config does not contain an account page.");
  }
}

module.exports = {
  resolveAccountConfigs,
  resolveCredentials,
  resolveLibraryConfig,
  validateSupportedLibrary,
};
