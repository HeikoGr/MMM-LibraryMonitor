const { version } = require("../package.json");

/** Sent with every OPAC and cover request, so the library can identify us. */
const USER_AGENT = `MMM-LibraryMonitor/${version} (+MagicMirror²)`;

module.exports = {
  USER_AGENT,
};
