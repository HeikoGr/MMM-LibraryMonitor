const { buildLoginBody, hasAccountOverview, parseAccountHtml, parseLoginForm } = require("./parser");

/*
 * Login form per account page URL (no credentials). __VIEWSTATE and
 * __EVENTVALIDATION change with every page load but are not bound to the
 * session, so one copy serves every account and later logins: a login then
 * costs the POST alone instead of loading the ~100 KB login page first.
 */
const loginForms = new Map();

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
    throw Object.assign(new Error(`OPAC request failed (${response.status} ${response.statusText}).`), {
      code: "OPAC_HTTP_STATUS",
    });
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
      throw Object.assign(new Error(message || "OPAC login failed."), { code: "OPAC_LOGIN_REJECTED" });
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

async function postLogin(loginForm, credentials, fetch) {
  const request = buildLoginBody(loginForm, credentials);
  const html = await readTextResponse(
    await fetch(request.postUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: request.body,
    }),
  );

  ensureLoggedInOverview(html);
  return html;
}

/**
 * Log in with the kept login form. Returns null when the server did not accept
 * the form (an error status, or the login page again without a login error), so
 * the caller loads a fresh one. A rejected login (wrong credentials) is thrown
 * and never retried: a second attempt would count as another failed login.
 */
async function loginWithKeptForm(accountUrl, credentials, fetch) {
  const loginForm = loginForms.get(accountUrl);
  if (!loginForm) {
    return null;
  }

  try {
    const html = await postLogin(loginForm, credentials, fetch);
    if (hasAccountOverview(html)) {
      return html;
    }
  } catch (error) {
    if (error?.code !== "OPAC_HTTP_STATUS") {
      throw error;
    }
  }

  loginForms.delete(accountUrl);
  return null;
}

async function login({ libraryConfig, credentials, fetch }) {
  const accountUrl = buildAccountUrl(libraryConfig);

  const keptFormHtml = await loginWithKeptForm(accountUrl, credentials, fetch);
  if (keptFormHtml) {
    return parseAccountHtml(keptFormHtml);
  }

  const loginPageHtml = await readTextResponse(await fetch(accountUrl));
  // A kept form the server turned away may still have logged this session in.
  if (hasAccountOverview(loginPageHtml)) {
    return parseAccountHtml(loginPageHtml);
  }

  const loginForm = parseLoginForm(loginPageHtml, accountUrl);
  loginForms.set(accountUrl, loginForm);

  const accountHtmlAfterLogin = await postLogin(loginForm, credentials, fetch);

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
  // Tests start from an empty form cache.
  clearLoginForms: () => loginForms.clear(),
};
