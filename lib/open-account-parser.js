const cheerio = require("cheerio");

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
    matches.forEach((match) => candidates.push(normalizeCoverUrl(match)));
  }

  return candidates.find((candidate) => candidate.startsWith("http") && !isPlaceholderCoverUrl(candidate)) || "";
}

function parseGermanDate(value) {
  if (!value) {
    return null;
  }

  const match = String(value).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
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
  const startOfToday = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const due = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.round((due - startOfToday) / 86400000);
}

function parseHeaderMap($, row) {
  const map = new Map();
  row.find("th").each((index, element) => {
    const cell = $(element);
    const html = cell.html() || "";
    const text = textFromCell(cell);

    if (html.includes("Sort$Author") || text.includes("Author") || text.includes("Autor")) {
      map.set("author", index);
    } else if (
      html.includes("Sort$MediaGroup") ||
      text.includes("MediaGroup") ||
      text.includes("Mediengruppe")
    ) {
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
    }
  });

  const hasSelectionColumn = row.find("th").first().find("input[type='checkbox']").length > 0;
  map.set("cover", hasSelectionColumn ? 1 : 0);
  if (!map.has("title")) {
    map.set("title", hasSelectionColumn ? 2 : 1);
  }

  return map;
}

function parseLoanTable($, table) {
  const items = [];
  let columnMap = null;

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

    const dueText = textFromCell(cells.eq(columnMap.get("deadline")));
    const dueDate = parseGermanDate(dueText);
    const daysRemaining = computeDayDelta(dueDate);

    items.push({
      id: extractItemId(titleCell) || extractItemId(row),
      title,
      coverImageUrl: extractCoverImageUrl(cells.eq(columnMap.get("cover"))),
      author: columnMap.has("author") ? textFromCell(cells.eq(columnMap.get("author"))) : "",
      format: columnMap.has("format") ? textFromCell(cells.eq(columnMap.get("format"))) : "",
      branch: columnMap.has("branch") ? textFromCell(cells.eq(columnMap.get("branch"))) : "",
      dueDate,
      dueDateText: dueText,
      daysRemaining,
      isOverdue: Number.isFinite(daysRemaining) && daysRemaining < 0,
    });
  });

  return items.filter((item) => item.title);
}

function selectText($, selector) {
  return $(selector).first().text().replace(/\s+/g, " ").trim();
}

function ensureLoadedDocument(input) {
  if (typeof input === "string") {
    return cheerio.load(input);
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

  let items = [];
  if (mainLoanTable.length > 0) {
    items = items.concat(parseLoanTable($, mainLoanTable));
  }
  if (remoteLoanTable.length > 0) {
    items = items.concat(parseLoanTable($, remoteLoanTable));
  }

  items.sort((left, right) => {
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

  const warning =
    selectText($, ".dnnFormWarning:not([style*='display: none'])") ||
    selectText($, "[id$='patronAccountExtensionMessage']");

  return {
    items,
    totalItems: items.length,
    pendingFees,
    validUntil: selectText($, "[id$='ucPatronAccountView_LblMembershipValidUntilData']"),
    warning,
  };
}

function buildLoginRequest(html, accountUrl, credentials) {
  const $ = cheerio.load(html);
  const form = $("form").first();

  if (form.length === 0) {
    throw new Error("Login form not found on the OPAC page.");
  }

  const params = new URLSearchParams();

  form.find("input[type='hidden']").each((_, element) => {
    const field = $(element);
    const name = field.attr("name");
    if (!name) {
      return;
    }

    params.set(name, field.val() || "");
  });

  const usernameField = form.find("input[name$='txtUsername']").first();
  const passwordField = form.find("input[name$='txtPassword']").first();
  const loginButton = form.find("input[name$='cmdLogin']").first();

  if (usernameField.length === 0 || passwordField.length === 0) {
    throw new Error("Login fields were not found on the OPAC page.");
  }

  params.set(usernameField.attr("name"), credentials.username);
  params.set(passwordField.attr("name"), credentials.password);

  if (loginButton.length > 0) {
    params.set(loginButton.attr("name"), loginButton.attr("value") || loginButton.val() || "Login");
  }

  const action = form.attr("action") || accountUrl;
  const postUrl = new URL(action, accountUrl).toString();

  return {
    postUrl,
    body: params.toString(),
  };
}

module.exports = {
  buildLoginRequest,
  hasAccountOverview,
  parseAccountHtml,
  parseGermanDate,
};