const https = require("node:https");
const fetchCookieModule = require("fetch-cookie");
const nodeFetch = require("node-fetch");
const { CookieJar } = require("tough-cookie");
const {
  resolveAccountConfigs,
} = require("./library-config");
const {
  buildLoginRequest,
  hasAccountOverview,
  parseAccountHtml,
} = require("./open-account-parser");

const fetchCookie = fetchCookieModule.default || fetchCookieModule;

function buildAccountUrl(libraryConfig) {
  const baseurl = libraryConfig.data.baseurl.endsWith("/")
    ? libraryConfig.data.baseurl
    : `${libraryConfig.data.baseurl}/`;
  return new URL(libraryConfig.data.urls.account, baseurl).toString();
}

function createFetch(libraryConfig, requestTimeout) {
  const cookieJar = new CookieJar();
  const wrappedFetch = fetchCookie(nodeFetch, cookieJar);
  const insecureAgent = libraryConfig?.data?.customssl
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  return async function fetchWithDefaults(url, options = {}) {
    const response = await wrappedFetch(url, {
      redirect: "follow",
      timeout: requestTimeout,
      agent: insecureAgent,
      headers: {
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        "user-agent": "MMM-LibraryMonitor/0.1 (+MagicMirror2)",
        ...(options.headers || {}),
      },
      ...options,
    });

    return response;
  };
}

async function readTextResponse(response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`OPAC request failed (${response.status} ${response.statusText}).`);
  }

  return text;
}

function ensureLoggedInOverview(html) {
  if (html.includes("dnnFormValidationSummary")) {
    const match = html.match(/<[^>]*class=["']dnnFormValidationSummary["'][^>]*>([\s\S]*?)<\//i);
    if (match) {
      const message = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(message || "OPAC login failed.");
    }
  }
}

async function fetchSingleAccountData(accountConfig) {
  const { libraryConfig, credentials, requestTimeout } = accountConfig;
  const accountUrl = buildAccountUrl(libraryConfig);
  const fetch = createFetch(libraryConfig, requestTimeout);

  const loginPageHtml = await readTextResponse(await fetch(accountUrl));
  const loginRequest = buildLoginRequest(loginPageHtml, accountUrl, credentials);

  const accountHtmlAfterLogin = await readTextResponse(
    await fetch(loginRequest.postUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: loginRequest.body,
    }),
  );

  ensureLoggedInOverview(accountHtmlAfterLogin);

  let finalAccountHtml = accountHtmlAfterLogin;
  if (!hasAccountOverview(accountHtmlAfterLogin)) {
    finalAccountHtml = await readTextResponse(await fetch(accountUrl));
  }

  if (!hasAccountOverview(finalAccountHtml)) {
    throw new Error("The account page could not be recognized after login.");
  }

  return parseAccountHtml(finalAccountHtml);
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
    pendingFees: "",
    validUntil: "",
    warning: "",
  };
}

async function fetchAccountData(moduleConfig = {}) {
  const accountConfigs = resolveAccountConfigs(moduleConfig);
  const accounts = await Promise.all(
    accountConfigs.map(async (accountConfig) => {
      try {
        const data = await fetchSingleAccountData(accountConfig);
        return createAccountResult(accountConfig, data);
      } catch (error) {
        return createAccountError(accountConfig, error);
      }
    }),
  );

  return {
    accounts,
    totalAccounts: accounts.length,
    totalItems: accounts.reduce((sum, account) => sum + (Number(account.totalItems) || 0), 0),
  };
}

module.exports = {
  fetchAccountData,
};