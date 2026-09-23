const { buildLoginRequest, hasAccountOverview, parseAccountHtml } = require("./parser");

const api = "open";
const label = "OPEN / OCLC OPAC";

function buildAccountUrl(libraryConfig) {
  const baseurl = libraryConfig.data.baseurl.endsWith("/")
    ? libraryConfig.data.baseurl
    : `${libraryConfig.data.baseurl}/`;
  return new URL(libraryConfig.data.urls.account, baseurl).toString();
}

function validateConfig(libraryConfig) {
  const baseurl = libraryConfig?.data?.baseurl || "";

  let url;
  try {
    url = new URL(baseurl);
  } catch {
    throw new Error("The OPAC config contains an invalid base URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) OPAC base URLs are supported.");
  }

  if (!libraryConfig?.data?.urls?.account) {
    throw new Error("The OPAC config does not contain an account page.");
  }
}

async function readTextResponse(response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`OPAC request failed (${response.status} ${response.statusText}).`);
  }

  return text;
}

/**
 * OPEN renders login errors into a DNN validation summary instead of using a
 * status code, so a "successful" response can still be a failed login.
 */
function ensureLoggedInOverview(html) {
  if (html.includes("dnnFormValidationSummary")) {
    const match = html.match(/<[^>]*class=["'][^"']*\bdnnFormValidationSummary\b[^"']*["'][^>]*>([\s\S]*?)<\//i);
    if (match) {
      const message = match[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(message || "OPAC login failed.");
    }
  }
}

/**
 * Reuse an existing session when the cookie jar still carries a valid login, so
 * a refresh costs one GET instead of a full login round trip.
 * @returns {Promise<object|null>} Parsed account data, or null when a login is required
 */
async function resumeSession({ libraryConfig, fetch }) {
  const accountUrl = buildAccountUrl(libraryConfig);
  const html = await readTextResponse(await fetch(accountUrl));

  if (!hasAccountOverview(html)) {
    return null;
  }

  return parseAccountHtml(html);
}

async function login({ libraryConfig, credentials, fetch }) {
  const accountUrl = buildAccountUrl(libraryConfig);

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

module.exports = {
  api,
  label,
  validateConfig,
  buildAccountUrl,
  resumeSession,
  login,
};
