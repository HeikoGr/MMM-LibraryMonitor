const test = require("node:test");
const assert = require("node:assert/strict");

const { createRenderer } = require("./helpers/module-loader");
const { find, findAll, findByTag, withDocument } = require("./helpers/dom-stub");

function loan(overrides = {}) {
  return {
    id: "l1",
    title: "Geheimnis auf dem Ponyhof",
    type: "loan",
    status: "loan",
    coverImageUrl: "",
    author: "Ambach, Jule",
    format: "Belletristik KiJu",
    branch: "",
    dueDate: "2026-10-16",
    dueDateText: "16.10.2026",
    daysRemaining: 25,
    isOverdue: false,
    ...overrides,
  };
}

function reservation(overrides = {}) {
  return {
    id: "r1",
    title: "Vorgemerkter Titel",
    type: "reservation",
    status: "reserved",
    coverImageUrl: "",
    author: "",
    format: "",
    branch: "",
    reservationDate: "2026-09-11",
    reservationDateText: "11.09.2026",
    // A pending reservation carries the date it was *placed*, so the delta is
    // always negative. This is exactly the shape that used to be misread.
    daysRemaining: -10,
    isOverdue: true,
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    id: "a1",
    label: "child 1",
    status: "ok",
    error: null,
    items: [],
    totalItems: 0,
    reservations: [],
    totalReservations: 0,
    pendingFees: "",
    validUntil: "",
    warning: "",
    ...overrides,
  };
}

function payload(accounts) {
  return {
    accounts,
    totalAccounts: accounts.length,
    totalItems: accounts.reduce((sum, a) => sum + a.items.length, 0),
    totalReservations: accounts.reduce((sum, a) => sum + a.reservations.length, 0),
  };
}

function render(instanceSetup, configOverrides = {}) {
  return withDocument(() => {
    const module = createRenderer(configOverrides);
    instanceSetup(module);
    return { module, dom: module.getDom() };
  });
}

/** Push account data the way the backend does (DATA event). */
function respond(module, data) {
  module.socketNotificationReceived(module.notifications.EVENT, {
    identifier: module.identifier,
    action: "DATA",
    data,
  });
}

function rowClasses(dom) {
  return findAll(dom, "mmm-library-monitor__row").map((row) => row.className);
}

test("a failed refresh keeps the last good data and marks it stale", () => {
  const good = payload([account({ items: [loan()], totalItems: 1 })]);

  const { dom } = render((module) => {
    respond(module, good);
    module.socketNotificationReceived(module.notifications.EVENT, {
      identifier: module.identifier,
      action: "FETCH_FAILED",
      error: { message: "OPAC request failed (503 Service Unavailable)." },
    });
  });

  assert.ok(
    dom.textContent.includes("Geheimnis auf dem Ponyhof"),
    "the last successful loans must survive a failed refresh",
  );
  assert.ok(find(dom, "mmm-library-monitor__stale"), "a stale notice is shown");
  assert.equal(
    dom.classList.contains("mmm-library-monitor--error"),
    false,
    "stale data is a notice, not a full error screen",
  );
});

function unavailable(overrides = {}) {
  return account({
    status: "unavailable",
    error: "OPAC request failed (503 Service Unavailable).",
    ...overrides,
  });
}

test("an OPAC outage on every account keeps the last good data", () => {
  const good = payload([account({ items: [loan()], totalItems: 1 })]);

  const { module, dom } = render((module) => {
    respond(module, good);
    // The backend reports account errors inside a success envelope, so this is
    // the path a real outage takes - not the ERROR notification.
    respond(module, payload([unavailable()]));
  });

  assert.ok(
    dom.textContent.includes("Geheimnis auf dem Ponyhof"),
    "yesterday's loans must survive an unreachable OPAC",
  );
  assert.ok(find(dom, "mmm-library-monitor__stale"), "a stale notice is shown");
  assert.equal(find(dom, "mmm-library-monitor__account-error"), null);
  assert.equal(module.lastSuccessfulData.accounts[0].items[0].title, loan().title);
});

test("a single failed account keeps its own previous state", () => {
  const good = payload([
    account({ id: "a1", label: "child 1", items: [loan()], totalItems: 1 }),
    account({
      id: "a2",
      label: "child 2",
      items: [loan({ id: "l2", title: "Zweites Buch" })],
      totalItems: 1,
    }),
  ]);

  const { module, dom } = render((module) => {
    respond(module, good);
    respond(
      module,
      payload([
        account({
          id: "a1",
          label: "child 1",
          items: [loan({ title: "Neues Buch" })],
          totalItems: 1,
        }),
        unavailable({ id: "a2", label: "child 2" }),
      ]),
    );
  });

  assert.ok(dom.textContent.includes("Neues Buch"), "a1 is refreshed");
  assert.ok(dom.textContent.includes("Zweites Buch"), "a2 keeps its loans");
  assert.equal(findAll(dom, "mmm-library-monitor__stale").length, 1);
  assert.equal(find(dom, "mmm-library-monitor__account-error"), null);
  assert.equal(module.accountData.totalItems, 2);
  assert.equal(module.lifecycle.dataReceived, 2);

  // A later full success clears the stale marker again.
  withDocument(() => {
    respond(module, good);
    const fresh = module.getDom();
    assert.equal(find(fresh, "mmm-library-monitor__stale"), null);
  });
});

test("an unavailable account with nothing to keep shows its error", () => {
  const { module, dom } = render((module) => {
    respond(module, payload([unavailable()]));
  });

  assert.ok(find(dom, "mmm-library-monitor__account-error"));
  assert.equal(find(dom, "mmm-library-monitor__stale"), null);
  assert.equal(module.lifecycle.dataReceived, 0);
});

test("a failure with nothing cached still shows the error", () => {
  const { dom } = render((module) => {
    module.socketNotificationReceived(module.notifications.EVENT, {
      identifier: module.identifier,
      action: "CONFIG_INVALID",
      error: { message: "Library account password is missing." },
    });
  });

  assert.ok(dom.classList.contains("mmm-library-monitor--error"));
  assert.equal(dom.textContent, "Library account password is missing.");
});

test("a pending reservation is never treated as urgent", () => {
  const { dom } = render((module) => {
    module.accountData = payload([account({ reservations: [reservation()], totalReservations: 1 })]);
  });

  const classes = rowClasses(dom);
  assert.equal(classes.length, 1);
  assert.ok(
    !classes[0].includes("--soon") && !classes[0].includes("--overdue"),
    `a reservation placed in the past must not be urgent, got "${classes[0]}"`,
  );
});

test("a reservation ready for pickup follows its pickup deadline", () => {
  const { dom } = render((module) => {
    module.accountData = payload([
      account({
        reservations: [
          reservation({
            id: "r-soon",
            status: "readyForPickup",
            pickupDeadline: "2026-09-23",
            daysRemaining: 2,
            isOverdue: false,
          }),
          reservation({
            id: "r-late",
            status: "readyForPickup",
            pickupDeadline: "2026-09-19",
            daysRemaining: -2,
            isOverdue: true,
          }),
        ],
        totalReservations: 2,
      }),
    ]);
  });

  const classes = rowClasses(dom);
  assert.ok(classes[0].includes("--soon"), "an expiring pickup is urgent");
  assert.ok(classes[1].includes("--overdue"), "a missed pickup is overdue");
});

test("loans are marked by how much of the loan period is left", () => {
  const { dom } = render((module) => {
    module.accountData = payload([
      account({
        items: [
          loan({ id: "far", daysRemaining: 25, isOverdue: false }),
          loan({ id: "soon", daysRemaining: 2, isOverdue: false }),
          loan({ id: "late", daysRemaining: -4, isOverdue: true }),
        ],
        totalItems: 3,
      }),
    ]);
  });

  const classes = rowClasses(dom);
  assert.ok(!classes[0].includes("--soon") && !classes[0].includes("--overdue"));
  assert.ok(classes[1].includes("--soon"));
  assert.ok(classes[2].includes("--overdue"));
});

test("only http(s) and mirror-local cover URLs reach img.src", () => {
  const covers = [
    "https://images.example/cover.jpg",
    "/MMM-LibraryMonitor/cover/abc123",
    "javascript:alert(1)",
    "//evil.example/cover.jpg",
    "data:image/svg+xml,<svg/>",
    "",
  ];

  const { dom } = render((module) => {
    module.accountData = payload([
      account({
        items: covers.map((coverImageUrl, index) => loan({ id: `c${index}`, coverImageUrl })),
        totalItems: covers.length,
      }),
    ]);
  });

  const images = findAll(dom, "mmm-library-monitor__cover");
  assert.equal(images.length, covers.length);

  assert.equal(images[0].src, "https://images.example/cover.jpg");
  assert.equal(images[1].src, "/MMM-LibraryMonitor/cover/abc123");

  for (const index of [2, 3, 4, 5]) {
    assert.ok(
      images[index].classList.contains("mmm-library-monitor__cover--placeholder"),
      `cover "${covers[index]}" must fall back to the placeholder`,
    );
    assert.ok(
      !String(images[index].src).startsWith(covers[index] || "\u0000"),
      `cover "${covers[index]}" must never be assigned to src`,
    );
  }
});

test("an unusable date renders a fallback instead of throwing", () => {
  withDocument(() => {
    const module = createRenderer();

    assert.equal(module.formatDate("not-a-date"), "UNKNOWN_DATE");
    assert.equal(module.formatDate(null), "UNKNOWN_DATE");
    assert.equal(module.formatDate(""), "UNKNOWN_DATE");
    assert.equal(module.formatDate(undefined), "UNKNOWN_DATE");

    module.config.dateLocale = "not a locale";
    assert.equal(module.formatDate("2026-10-16"), "2026-10-16");

    module.config.dateLocale = "de-DE";
    module.accountData = payload([
      account({
        items: [loan({ dueDate: "31.02.2026", daysRemaining: 3 })],
        totalItems: 1,
      }),
    ]);
    assert.doesNotThrow(() => module.getDom());
  });
});

test("the loan table exposes row headers, a caption and a text status", () => {
  const { dom } = render((module) => {
    module.accountData = payload([
      account({
        items: [loan({ daysRemaining: -4, isOverdue: true })],
        totalItems: 1,
      }),
    ]);
  });

  assert.equal(dom.getAttribute("aria-live"), "polite");

  const captions = findByTag(dom, "CAPTION");
  assert.equal(captions.length, 1);
  assert.equal(captions[0].textContent, "TABLE_CAPTION_LOANS");
  assert.ok(captions[0].classList.contains("mmm-library-monitor__sr-only"));

  const headerCells = findByTag(dom, "TH");
  assert.equal(headerCells.length, 1);
  assert.equal(headerCells[0].getAttribute("scope"), "row");

  const due = find(dom, "mmm-library-monitor__due");
  assert.ok(due.textContent.includes("STATUS_OVERDUE"), "urgency must be readable as text, not only as a colour");
});

test("covers are marked decorative so the title is not announced twice", () => {
  const { dom } = render((module) => {
    module.accountData = payload([
      account({
        items: [loan({ coverImageUrl: "https://images.example/cover.jpg" })],
        totalItems: 1,
      }),
    ]);
  });

  const cover = find(dom, "mmm-library-monitor__cover");
  assert.equal(cover.alt, "");
  assert.equal(cover.getAttribute("aria-hidden"), "true");
});

test("the '+N more' lines come from the counts the backend sends", () => {
  const { dom } = render((module) => {
    respond(
      module,
      payload([
        account({
          items: [loan()],
          totalItems: 13,
          moreItems: 12,
          reservations: [],
          moreReservations: 0,
        }),
      ]),
    );
  });

  const more = findAll(dom, "mmm-library-monitor__more");
  assert.equal(more.length, 1, "no line for reservations without a rest");
  assert.ok(more[0].textContent.includes("MORE_ITEMS"));
});

test("dates follow MagicMirror's locale unless dateLocale is set", () => {
  const module = createRenderer();
  globalThis.config = { language: "en", locale: "en-US" };
  try {
    assert.equal(module.formatDate("2026-10-16"), "10/16/2026");

    globalThis.config = { language: "de" };
    assert.equal(module.formatDate("2026-10-16"), "16.10.2026", "the language when no locale is set");

    module.config.dateLocale = "en-GB";
    assert.equal(module.formatDate("2026-10-16"), "16/10/2026", "dateLocale overrides MagicMirror");
  } finally {
    delete globalThis.config;
  }
});

test("a plain date keeps its day in a time zone west of UTC", () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const renderer = createRenderer({ dateLocale: "de-DE" });
    assert.equal(renderer.formatDate("2026-10-01"), "01.10.2026");
  } finally {
    process.env.TZ = previousTz;
  }
});

test("after midnight a loan due today reads as overdue without a new fetch", () => {
  const renderer = createRenderer();
  const yesterday = renderer.todayUtc() - 86400000;
  const item = loan({ dueDate: "2026-10-16", daysRemaining: 0, isOverdue: false, receivedDay: yesterday });

  assert.equal(renderer.daysRemaining(item), -1);
  assert.equal(renderer.resolveUrgency(item, "loan"), "overdue");
  assert.equal(renderer.formatDueDate(item), "OVERDUE_ON");
});

test("fresh items are stamped with the day they arrived", () => {
  const renderer = createRenderer();
  renderer.handleAccountsResponse({ accounts: [account({ items: [loan()] })] });

  assert.equal(renderer.accountData.accounts[0].items[0].receivedDay, renderer.todayUtc());
});
