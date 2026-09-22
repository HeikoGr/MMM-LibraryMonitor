const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Agent } = require("undici");

/**
 * How the OPAC's TLS certificate is checked. The login POSTs the card number
 * and password over this connection, so the default is the strictest mode and
 * every relaxation has to be spelled out in the library config.
 *
 *   system   - default; the certificate must chain to a CA Node trusts.
 *   pinned   - `data.ca`: the certificate must chain to the given PEM
 *              certificate. Verification, hostname check included, stays on.
 *              This is the right answer for a self-signed OPAC certificate.
 *   insecure - `data.customssl: true`; no verification at all. Anyone on the
 *              path can read the credentials. Kept for compatibility only.
 */
const TLS_MODE_SYSTEM = "system";
const TLS_MODE_PINNED = "pinned";
const TLS_MODE_INSECURE = "insecure";

const PEM_CERTIFICATE_MARKER = "-----BEGIN CERTIFICATE-----";

/** One dispatcher per trust setting, instead of a new pool per request. */
const dispatchers = new Map();

function loadCa(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("libraryConfig.data.ca must be a PEM string or file path.");
  }

  if (value.includes(PEM_CERTIFICATE_MARKER)) {
    return value;
  }

  const resolvedPath = path.isAbsolute(value)
    ? value
    : path.resolve(__dirname, "..", value);

  let pem;
  try {
    pem = fs.readFileSync(resolvedPath, "utf8");
  } catch {
    throw new Error(`Could not read CA certificate file: ${value}`);
  }

  if (!pem.includes(PEM_CERTIFICATE_MARKER)) {
    throw new Error(`CA certificate file is not PEM encoded: ${value}`);
  }

  return pem;
}

/**
 * @param {object} libraryConfig - Resolved library config
 * @returns {{mode: string, ca?: string}} Trust setting for the OPAC host
 */
function resolveTlsTrust(libraryConfig) {
  const data = libraryConfig?.data || {};

  // A pinned CA wins over customssl: it is the strict way to reach the same
  // self-signed host, so there is no reason to switch verification off.
  if (data.ca) {
    return { mode: TLS_MODE_PINNED, ca: loadCa(data.ca) };
  }

  // Only a literal `true` switches verification off; "false" or 1 do not.
  if (data.customssl === true) {
    return { mode: TLS_MODE_INSECURE };
  }

  return { mode: TLS_MODE_SYSTEM };
}

/**
 * @param {{mode: string, ca?: string}} trust - From resolveTlsTrust()
 * @returns {Agent|undefined} Dispatcher for undici, or undefined for the
 *   default (system CA) dispatcher
 */
function getDispatcher(trust) {
  if (!trust || trust.mode === TLS_MODE_SYSTEM) {
    return undefined;
  }

  const key =
    trust.mode === TLS_MODE_PINNED
      ? `${TLS_MODE_PINNED}|${crypto.createHash("sha256").update(trust.ca).digest("hex")}`
      : TLS_MODE_INSECURE;

  if (!dispatchers.has(key)) {
    dispatchers.set(
      key,
      new Agent({
        connect:
          trust.mode === TLS_MODE_PINNED
            ? { ca: trust.ca, rejectUnauthorized: true }
            : { rejectUnauthorized: false },
      }),
    );
  }

  return dispatchers.get(key);
}

module.exports = {
  TLS_MODE_INSECURE,
  TLS_MODE_PINNED,
  TLS_MODE_SYSTEM,
  getDispatcher,
  resolveTlsTrust,
};
