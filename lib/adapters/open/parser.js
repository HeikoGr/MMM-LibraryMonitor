// cheerio takes about 0.1 s to load (more on a Pi) and MagicMirror loads every
// node_helper before it starts the server, so it is loaded on the first parse.
let cheerio = null;
function loadHtml(html) {
  cheerio ||= require("cheerio");
  return cheerio.load(html);
}

const COVER_IMAGE_PATTERN = /((?:https?:)?\/\/[^|"'\s]+\.(?:jpe?g|png|gif|bmp|webp)(?:\?[^|"'\s]*)?)/gi;

function textFromCell(cell) {
  const cloned = cell.clone();
  cloned.find(".oclc-module-label").remove();
  return cloned.text().replace(/\s+/g, " ").trim();
}

function extractItemId(cell) {
  const href = cell.find("a").first().attr("href");
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, "https://placeholder.invalid");
    return url.searchParams.get("id");
  } catch {
    return null;
  }
}

function isPlaceholderCoverUrl(url) {
  return /emptyURL\.gif/i.test(url);
}

function normalizeCoverUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

function extractCoverImageUrl(cell) {
  const img = cell.find("img").first();
  if (img.length === 0) {
    return "";
  }

  const candidates = [];
  const src = img.attr("src") || "";
  const dataSources = img.attr("data-sources") || "";
  const dataDevSources = img.attr("data-devsources") || "";

  for (const source of [src, dataSources, dataDevSources]) {
    const matches = source.match(COVER_IMAGE_PATTERN) || [];
    matches.forEach((match) => {
      candidates.push(normalizeCoverUrl(match));
    });
  }

  return candidates.find((candidate) => candidate.startsWith("http") && !isPlaceholderCoverUrl(candidate)) || "";
}

function parseGermanDate(value) {
  if (!value) {
    return null;
  }

  const match = String(value)
    .trim()
    .match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function computeDayDelta(isoDate) {
  if (!isoDate) {
    return Number.POSITIVE_INFINITY;
  }

  const today = new Date();
  const startOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.round((due - startOfToday) / 86400000);
}

function createDateFields(rawDateText) {
  const dateText = rawDateText || "";
  const date = parseGermanDate(dateText);
  const daysRemaining = computeDayDelta(date);

  return {
    date,
    dateText,
    daysRemaining,
    isOverdue: Number.isFinite(daysRemaining) && daysRemaining < 0,
  };
}

function parseHeaderMap($, row) {
  const map = new Map();
  // Some OPAC skins put a "select all" checkbox in a leading <td> before the
  // <th> columns, which shifts every column index by one. Walking th and td
  // together keeps the index aligned with the <td> columns of the data rows.
  row.children("th, td").each((index, element) => {
    const cell = $(element);
    const html = cell.html() || "";
    const text = textFromCell(cell);

    if (html.includes("Sort$Author") || text.includes("Author") || text.includes("Autor")) {
      map.set("author", index);
    } else if (html.includes("Sort$MediaGroup") || text.includes("MediaGroup") || text.includes("Mediengruppe")) {
      map.set("format", index);
    } else if (
      html.includes("Sort$DueDate") ||
      text.includes("DueDate") ||
      text.includes("Frist") ||
      text.includes("Fällig")
    ) {
      map.set("deadline", index);
    } else if (html.includes("Sort$Branch") || text.includes("Branch") || text.includes("Zweig")) {
      map.set("branch", index);
    } else if (text.includes("Titel") || text.includes("Title")) {
      map.set("title", index);
    } else if (text.includes("Cover")) {
      map.set("cover", index);
    }
  });

  if (!map.has("cover")) {
    map.set("cover", Math.max((map.get("title") ?? 1) - 1, 0));
  }

  return map;
}

function parseMediaTable($, table, options = {}) {
  const items = [];
  let columnMap = null;
  const dateFieldName = options.dateFieldName || "dueDate";
  const dateTextFieldName = options.dateTextFieldName || "dueDateText";
  const itemType = options.itemType || "loan";
  const itemStatus = options.itemStatus || "loan";

  table.find("tr").each((_, rowElement) => {
    const row = $(rowElement);
    if (row.find("th").length > 0) {
      columnMap = parseHeaderMap($, row);
      return;
    }

    const cells = row.children("td");
    if (cells.length === 0) {
      return;
    }

    if (!columnMap) {
      columnMap = new Map([
        ["cover", 1],
        ["title", 2],
        ["author", 3],
        ["format", 4],
        ["branch", 5],
        ["deadline", 6],
      ]);
    }

    const titleCell = cells.eq(columnMap.get("title"));
    let title = textFromCell(titleCell);
    if (!title) {
      title = textFromCell(row.find("a").first().parent());
    }

    const dateText = columnMap.has("deadline") ? textFromCell(cells.eq(columnMap.get("deadline"))) : "";
    const dateFields = createDateFields(dateText);

    const item = {
      id: extractItemId(titleCell) || extractItemId(row),
      title,
      type: itemType,
      status: itemStatus,
      coverImageUrl: extractCoverImageUrl(cells.eq(columnMap.get("cover"))),
      author: columnMap.has("author") ? textFromCell(cells.eq(columnMap.get("author"))) : "",
      format: columnMap.has("format") ? textFromCell(cells.eq(columnMap.get("format"))) : "",
      branch: columnMap.has("branch") ? textFromCell(cells.eq(columnMap.get("branch"))) : "",
    };

    item[dateFieldName] = dateFields.date;
    item[dateTextFieldName] = dateFields.dateText;
    item.daysRemaining = dateFields.daysRemaining;
    item.isOverdue = dateFields.isOverdue;

    items.push(item);
  });

  return items.filter((item) => item.title);
}

function parseLoanTable($, table) {
  return parseMediaTable($, table, {
    itemType: "loan",
    itemStatus: "loan",
    dateFieldName: "dueDate",
    dateTextFieldName: "dueDateText",
  });
}

function parseReservationTable($, table, options = {}) {
  return parseMediaTable($, table, {
    itemType: "reservation",
    itemStatus: options.itemStatus || "reserved",
    dateFieldName: options.dateFieldName || "reservationDate",
    dateTextFieldName: options.dateTextFieldName || "reservationDateText",
  });
}

function selectText($, selector) {
  return $(selector).first().text().replace(/\s+/g, " ").trim();
}

function isHiddenElement($, element) {
  const style = ($(element).attr("style") || "").toLowerCase();
  return /display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style);
}

function isPopupElement($, element) {
  const popupAncestor = $(element).closest("[id*='Popup'], [class*='popup'], [class*='Popup'], [role='dialog']");
  return popupAncestor.length > 0;
}

function isIgnoredNoticeElement($, element) {
  const id = ($(element).attr("id") || "").toLowerCase();
  const ignoredIdPatterns = [
    "nodatareturned",
    "noloanesreturned",
    "noreservationsreturned",
    "watchlist",
    "passwordchangesuccesspopup",
  ];

  return ignoredIdPatterns.some((pattern) => id.includes(pattern));
}

function selectVisibleAccountNotice($) {
  const messages = $(".dnnFormWarning, .dnnFormInfo, .dnnFormMessage").toArray();

  for (const element of messages) {
    if (isHiddenElement($, element) || isPopupElement($, element) || isIgnoredNoticeElement($, element)) {
      continue;
    }

    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function ensureLoadedDocument(input) {
  if (typeof input === "string") {
    return loadHtml(input);
  }

  return input;
}

function hasAccountOverview(input) {
  const $ = ensureLoadedDocument(input);
  return $("[id$='tpnlLoans_ucLoansView_grdViewLoans']").length > 0;
}

function parseAccountHtml(html) {
  const $ = ensureLoadedDocument(html);
  const mainLoanTable = $("[id$='tpnlLoans_ucLoansView_grdViewLoans']").first();
  const remoteLoanTable = $("[id$='tpnlRemoteLoans_ucRemoteLoansView_grdViewRemoteLoans']").first();
  const reservationsTable = $("[id$='tpnlReservations_ucReservationsView_grdViewReservations']").first();
  const readyForPickupsTable = $("[id$='tpnlReservations_ucReservationsView_grdViewReadyForPickups']").first();
  const ekzReservationsTable = $("[id$='tpnlEkz_ucekzView_ekzreservations']").first();

  let items = [];
  if (mainLoanTable.length > 0) {
    items = items.concat(parseLoanTable($, mainLoanTable));
  }
  if (remoteLoanTable.length > 0) {
    items = items.concat(parseLoanTable($, remoteLoanTable));
  }

  let reservations = [];
  if (reservationsTable.length > 0) {
    reservations = reservations.concat(
      parseReservationTable($, reservationsTable, {
        itemStatus: "reserved",
        dateFieldName: "reservationDate",
        dateTextFieldName: "reservationDateText",
      }),
    );
  }
  if (readyForPickupsTable.length > 0) {
    reservations = reservations.concat(
      parseReservationTable($, readyForPickupsTable, {
        itemStatus: "readyForPickup",
        dateFieldName: "pickupDeadline",
        dateTextFieldName: "pickupDeadlineText",
      }),
    );
  }
  if (ekzReservationsTable.length > 0) {
    reservations = reservations.concat(
      parseReservationTable($, ekzReservationsTable, {
        itemStatus: "reserved",
        dateFieldName: "reservationDate",
        dateTextFieldName: "reservationDateText",
      }),
    );
  }

  items.sort((left, right) => {
    if (left.daysRemaining !== right.daysRemaining) {
      return left.daysRemaining - right.daysRemaining;
    }
    return left.title.localeCompare(right.title, "de");
  });

  reservations.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "readyForPickup" ? -1 : 1;
    }
    if (left.daysRemaining !== right.daysRemaining) {
      return left.daysRemaining - right.daysRemaining;
    }
    return left.title.localeCompare(right.title, "de");
  });

  const pendingFeesRaw = selectText($, "[id$='tpnlFees_ucFeesView_lblTotalSaldoData']");
  let pendingFees = pendingFeesRaw;
  if (pendingFeesRaw.startsWith("-")) {
    pendingFees = pendingFeesRaw.slice(1);
  } else if (pendingFeesRaw && /[1-9]/.test(pendingFeesRaw)) {
    pendingFees = `-${pendingFeesRaw}`;
  }

  const warning = selectVisibleAccountNotice($);

  return {
    items,
    totalItems: items.length,
    reservations,
    totalReservations: reservations.length,
    pendingFees,
    validUntil: selectText($, "[id$='ucPatronAccountView_LblMembershipValidUntilData']"),
    warning,
  };
}

/**
 * Read the login form: target URL, hidden fields (__VIEWSTATE, __EVENTVALIDATION, ...)
 * and the names of the credential fields. Holds no credentials, so it can be kept and
 * posted again for another account or a later login.
 * @returns {{postUrl: string, hiddenFields: Array<[string, string]>, usernameName: string,
 *   passwordName: string, loginButton: [string, string]|null}}
 */
function parseLoginForm(html, accountUrl) {
  const $ = loadHtml(html);
  const form = $("form").first();

  if (form.length === 0) {
    throw new Error("Login form not found on the OPAC page.");
  }

  const hiddenFields = [];
  form.find("input[type='hidden']").each((_, element) => {
    const field = $(element);
    const name = field.attr("name");
    if (name) {
      hiddenFields.push([name, field.val() || ""]);
    }
  });

  const usernameField = form.find("input[name$='txtUsername']").first();
  const passwordField = form.find("input[name$='txtPassword']").first();
  const loginButton = form.find("input[name$='cmdLogin']").first();

  if (usernameField.length === 0 || passwordField.length === 0) {
    throw new Error("Login fields were not found on the OPAC page.");
  }

  const action = form.attr("action") || accountUrl;

  return {
    postUrl: new URL(action, accountUrl).toString(),
    hiddenFields,
    usernameName: usernameField.attr("name"),
    passwordName: passwordField.attr("name"),
    loginButton:
      loginButton.length > 0
        ? [loginButton.attr("name"), loginButton.attr("value") || loginButton.val() || "Login"]
        : null,
  };
}

/**
 * @param {object} loginForm - As returned by parseLoginForm
 * @param {{username: string, password: string}} credentials - Account credentials
 * @returns {{postUrl: string, body: string}} The login POST
 */
function buildLoginBody(loginForm, credentials) {
  const params = new URLSearchParams(loginForm.hiddenFields);
  params.set(loginForm.usernameName, credentials.username);
  params.set(loginForm.passwordName, credentials.password);
  if (loginForm.loginButton) {
    params.set(...loginForm.loginButton);
  }

  return { postUrl: loginForm.postUrl, body: params.toString() };
}

function buildLoginRequest(html, accountUrl, credentials) {
  return buildLoginBody(parseLoginForm(html, accountUrl), credentials);
}

module.exports = {
  buildLoginBody,
  buildLoginRequest,
  parseLoginForm,
  hasAccountOverview,
  parseAccountHtml,
  parseGermanDate,
};
