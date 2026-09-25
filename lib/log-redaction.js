/* global module */

/**
 * Log keys whose values are redacted, for the frontend (getScripts) and the backend (require).
 * The shared default list stops at `password`, but a library card number is a personal
 * identifier in its own right and must not reach the log either.
 */
const REDACTED_LOG_KEYS = Object.freeze([
  "password",
  "token",
  "apikey",
  "secret",
  "qrcode",
  "refreshtoken",
  "username",
  "cardnumber",
  "credentials",
]);

if (typeof module !== "undefined" && module.exports) {
  module.exports = { REDACTED_LOG_KEYS };
} else {
  globalThis.LibraryMonitorLogRedaction = { REDACTED_LOG_KEYS };
}
