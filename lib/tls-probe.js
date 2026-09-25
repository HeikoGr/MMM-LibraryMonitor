const tls = require("node:tls");

const DEFAULT_TIMEOUT_MS = 5000;

function certificateCommonName(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return entry.CN || entry.O || null;
}

function inspectSocket(socket, host) {
  const certificate = socket.getPeerCertificate();
  const hasCertificate = !!certificate && Object.keys(certificate).length > 0 && !!certificate.subject;
  const subject = hasCertificate ? certificateCommonName(certificate.subject) : null;
  const issuer = hasCertificate ? certificateCommonName(certificate.issuer) : null;

  return {
    host,
    hasCertificate,
    authorized: socket.authorized === true,
    authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
    subject,
    issuer,
    validFrom: hasCertificate ? certificate.valid_from || null : null,
    validTo: hasCertificate ? certificate.valid_to || null : null,
    selfSigned: hasCertificate && !!subject && subject === issuer,
  };
}

function failedProbe(host, reason) {
  return {
    host,
    hasCertificate: false,
    authorized: false,
    authorizationError: reason,
    subject: null,
    issuer: null,
    validFrom: null,
    validTo: null,
    selfSigned: false,
  };
}

/**
 * Inspect the TLS certificate of an OPAC host without changing how requests are
 * made. The connection deliberately does not reject unauthorized certificates:
 * the point is to *observe* a broken or missing certificate so it can be logged,
 * not to enforce anything here.
 * @param {string} urlString - Any URL on the host to inspect
 * @param {object} [options] - { timeoutMs, ca } where `ca` is a pinned PEM
 *   certificate that the verdict should be based on
 * @returns {Promise<object|null>} Probe result, or null for non-TLS URLs
 */
async function probeCertificate(urlString, options = {}) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const port = url.port ? Number(url.port) : 443;
  const host = `${url.hostname}:${port}`;
  // No cache here: the caller (opac-client.js, shouldProbe) decides how often to probe, once
  // per host and day, so a certificate that expires or is replaced later is still noticed.
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket?.destroy();
      } catch {
        // the probe result is already decided
      }
      resolve(value);
    };

    try {
      socket = tls.connect(
        {
          host: url.hostname,
          port,
          servername: url.hostname,
          ...(options.ca ? { ca: options.ca } : {}),
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        () => finish(inspectSocket(socket, host)),
      );
    } catch (error) {
      finish(failedProbe(host, error instanceof Error ? error.message : String(error)));
      return;
    }

    socket.on("timeout", () => finish(failedProbe(host, "TLS handshake timed out")));
    socket.on("error", (error) => finish(failedProbe(host, error instanceof Error ? error.message : String(error))));
  });
}

/**
 * @returns {string|null} A human readable problem description, or null when the
 *   certificate is present and trusted.
 */
function describeCertificateProblem(probe) {
  if (!probe) {
    return null;
  }

  if (!probe.hasCertificate) {
    return `no TLS certificate could be read (${probe.authorizationError || "unknown reason"})`;
  }

  if (!probe.authorized) {
    if (probe.selfSigned) {
      return `self-signed certificate (${probe.authorizationError || "not trusted"})`;
    }
    return `untrusted certificate (${probe.authorizationError || "not trusted"})`;
  }

  return null;
}

module.exports = {
  describeCertificateProblem,
  probeCertificate,
};
