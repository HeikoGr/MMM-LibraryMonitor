/* global Module */

const PLACEHOLDER_COVER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 46"><rect width="32" height="46" rx="3" fill="#202632"/><rect x="5" y="6" width="22" height="34" rx="2" fill="#425064"/><rect x="8" y="6" width="2" height="34" rx="1" fill="#d8b36a"/><path d="M12 15h10M12 20h10M12 25h7" stroke="#dce4f0" stroke-width="1.5" stroke-linecap="round"/></svg>',
)}`;

/**
 * The shared default list stops at `password`, but a library card number is a
 * personal identifier in its own right and must not reach the log either.
 */
const REDACTED_LOG_KEYS = [
  "password",
  "token",
  "apikey",
  "secret",
  "qrcode",
  "refreshtoken",
  "username",
  "cardnumber",
  "credentials",
];

Module.register("MMM-LibraryMonitor", {
  defaults: {
    libraryConfig: null,
    libraryConfigFile: null,
    accounts: [],
    // Loan periods change at most once a day and every fetch is a login + scrape
    // against a public OPAC, so four anchored fetches a day are plenty.
    updateInterval: 6 * 60 * 60 * 1000,
    // Hour of day the update grid is anchored to (null disables anchoring).
    updateAnchorHour: 7,
    // Keep refreshing while the module is hidden (e.g. under MMM-Carousel) so
    // the displayed data is warm whenever the module becomes visible.
    backgroundRefresh: true,
    // Optional window without any polling, e.g. { from: "23:00", to: "06:00" }.
    quietHours: null,
    animationSpeed: 1000,
    requestTimeout: 30 * 1000,
    maxItems: 10,
    showAuthor: false,
    showFormat: true,
    showBranch: true,
    showFees: true,
    showValidUntil: true,
    showNotices: false,
    showBookCovers: true,
    hideEmptyAccounts: false,
    logLevel: null, // optional: none | error | warn | info | debug; unset = global logLevel
    dateLocale: "de-DE",
    urgencyThresholdDays: 3,
    // Serve book covers through the mirror instead of letting the browser talk
    // to the library's cover supplier, which would otherwise learn one title
    // per loan from the household's IP address.
    proxyBookCovers: true,
    // Keep simultaneous OPAC logins low: a family with several cards should not
    // look like a burst of parallel login attempts to the library server.
    maxConcurrentAccounts: 2,
    accountStaggerMs: 750,
    // Reuse a recent result instead of logging in again, e.g. after a browser
    // reload or when a second mirror client connects.
    resultCacheTtl: 5 * 60 * 1000,
  },

  start() {
    this.shared = globalThis.MMModuleShared;
    this.transport = this.shared.createTransport({
      moduleName: "MMM-LibraryMonitor",
      identifier: this.identifier,
      instanceId: this.identifier,
      sendSocketNotification: this.sendSocketNotification.bind(this),
    });
    this.notifications = this.transport.notifications;
    this.logger = this.shared.createLogger({
      moduleName: "MMM-LibraryMonitor",
      identifier: this.identifier,
      // Writes through MagicMirror's Log (global logLevel); the module's own
      // logLevel can only narrow it.
      getLevel: () => this.config.logLevel,
      structured: false,
      redact: true,
      redactedKeys: REDACTED_LOG_KEYS,
    });

    this.loaded = false;
    this.error = null;
    this.accountData = null;
    this.lastSuccessfulData = null;

    // The config goes to the backend once; it owns the refresh schedule
    // (node_helper + lib/mmm-shared/backend-session.js) and pushes the accounts.
    this.sendConfigure();

    // Only rendering and the active/paused report stay in the browser.
    this.lifecycle = this.shared.createLifecycle({
      module: this,
      logger: this.logger,
      updateInterval: 0,
      backgroundRefresh: this.config.backgroundRefresh !== false,
      onSessionState: ({ state }) => this.transport.sendRequest("SESSION_STATE", { state }),
    });
    this.lifecycle.start();
  },

  getScripts() {
    return [this.file("lib/mmm-shared/mmm-shared.js")];
  },

  getStyles() {
    return ["MMM-LibraryMonitor.css"];
  },

  getTranslations() {
    return {
      de: "translations/de.json",
      en: "translations/en.json",
    };
  },

  suspend() {
    this.lifecycle.suspend();
  },

  resume() {
    this.lifecycle.resume();
  },

  /**
   * Send the config to the backend - at start, and again when the backend asks
   * for it (INIT_REQUIRED, e.g. after a server restart).
   */
  sendConfigure() {
    this.transport.sendRequest("CONFIGURE", { config: this.config });
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== this.notifications.EVENT) {
      return;
    }

    if (payload?.action === "INIT_REQUIRED") {
      if (payload.identifier === this.identifier || payload.identifier === "*") {
        this.sendConfigure();
        // A restarted backend has lost the paused state too.
        this.lifecycle?.reportSessionState?.("init-required");
      }
      return;
    }

    if (payload?.identifier !== this.identifier) {
      return;
    }

    if (payload.action === "DATA") {
      this.handleAccountsResponse(payload.data);
      return;
    }

    if (
      payload.action === "FETCH_FAILED" ||
      payload.action === "CONFIG_INVALID" ||
      payload.action === "CONFIG_REJECTED"
    ) {
      this.loaded = true;
      this.error =
        payload.action === "CONFIG_REJECTED"
          ? `Config differs from the running instance: ${(payload.data?.mismatchKeys || []).join(", ")}`
          : this.resolveErrorMessage(payload?.error || payload);
      if (this.lastSuccessfulData) {
        this.accountData = this.lastSuccessfulData;
      }
      this.lifecycle.render(this.config.animationSpeed);
    }
  },

  /**
   * The backend always answers with a success envelope, even when an OPAC was
   * unreachable; the outcome lives in each account's `status`. An unavailable
   * account keeps what was shown before, so a short OPAC outage does not wipe
   * yesterday's loans off the mirror.
   * @param {object} data - Payload as delivered by the node_helper
   */
  handleAccountsResponse(data) {
    this.loaded = true;

    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    const unavailable = accounts.filter((account) => this.isAccountUnavailable(account));

    if (accounts.length > 0 && unavailable.length === accounts.length) {
      // Nothing usable came back. The backend backs off and retries on its own;
      // here only the previous state is kept.
      if (this.lastSuccessfulData) {
        this.error = this.resolveErrorMessage(unavailable[0].error);
        this.accountData = this.lastSuccessfulData;
      } else {
        // Nothing to keep; show the per-account errors as they are.
        this.error = null;
        this.accountData = data;
      }
      this.lifecycle.render(this.config.animationSpeed);
      return;
    }

    const merged = this.mergeWithPrevious(data, this.lastSuccessfulData);
    this.error = null;
    this.accountData = merged;
    this.lastSuccessfulData = merged;
    this.lifecycle.markDataReceived();
    this.lifecycle.render(this.config.animationSpeed);
  },

  isAccountUnavailable(account) {
    return account?.status === "unavailable";
  },

  /**
   * Replace every account that refreshed successfully and keep the previous
   * state of every account that did not, flagged with the refresh error.
   * @param {object} data - Fresh payload
   * @param {object|null} previous - Last displayed payload
   * @returns {object} Payload to display
   */
  mergeWithPrevious(data, previous) {
    const previousById = new Map(
      (Array.isArray(previous?.accounts) ? previous.accounts : [])
        .filter((account) => !this.isAccountUnavailable(account))
        .map((account) => [account.id, account]),
    );

    const fresh = Array.isArray(data?.accounts) ? data.accounts : [];
    const accounts = fresh.map((account) => {
      if (!this.isAccountUnavailable(account)) {
        return account;
      }

      const kept = previousById.get(account.id);
      return kept ? { ...kept, staleError: account.error } : account;
    });

    const sum = (key) => accounts.reduce((total, account) => total + (Number(account[key]) || 0), 0);

    return {
      ...data,
      accounts,
      totalAccounts: accounts.length,
      totalItems: sum("totalItems"),
      totalReservations: sum("totalReservations"),
    };
  },

  resolveErrorMessage(payload) {
    if (typeof payload === "string") {
      return payload;
    }
    if (payload?.message) {
      return String(payload.message);
    }
    return String(payload || "");
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-library-monitor";
    // Announce refreshed loan data without pulling focus away.
    wrapper.setAttribute("aria-live", "polite");

    // Only fall back to a bare error screen when there is nothing worth showing.
    // A failed refresh on top of good data keeps the data and flags it as stale.
    if (this.error && !this.accountData) {
      wrapper.classList.add("mmm-library-monitor--error");
      wrapper.textContent = this.error;
      return wrapper;
    }

    if (!this.loaded) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = this.translate("LOADING");
      return wrapper;
    }

    if (!this.accountData) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = this.translate("NO_DATA");
      return wrapper;
    }

    const accounts = Array.isArray(this.accountData.accounts) ? this.accountData.accounts : [];
    if (accounts.length === 0) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = this.translate("NO_DATA");
      return wrapper;
    }

    const visibleAccounts = this.config.hideEmptyAccounts
      ? accounts.filter(
          (account) =>
            account.error ||
            account.staleError ||
            (Array.isArray(account.items) && account.items.length > 0) ||
            (Array.isArray(account.reservations) && account.reservations.length > 0),
        )
      : accounts;

    if (this.error) {
      wrapper.appendChild(this.createStaleNotice(this.error));
    }

    const summary = document.createElement("div");
    summary.className = "mmm-library-monitor__summary small light";
    summary.textContent = this.buildOverallSummaryText(visibleAccounts, accounts);
    wrapper.appendChild(summary);

    const accountSections = visibleAccounts.map((account, index) => this.createAccountSection(account, index));
    // An account error must stay visible even when nothing is on loan anywhere,
    // otherwise a failed login reads as "no items".
    const hasAnythingToShow = accounts.some(
      (account) =>
        account.error ||
        account.staleError ||
        (Array.isArray(account.items) && account.items.length > 0) ||
        (Array.isArray(account.reservations) && account.reservations.length > 0),
    );

    if (!hasAnythingToShow) {
      const empty = document.createElement("div");
      empty.className = "mmm-library-monitor__empty dimmed light small";
      empty.textContent = this.translate("NO_ITEMS");
      wrapper.appendChild(empty);
      return wrapper;
    }

    accountSections.forEach((section) => {
      wrapper.appendChild(section);
    });

    return wrapper;
  },

  createAccountSection(account, index) {
    const section = document.createElement("section");
    section.className = "mmm-library-monitor__account";

    if (index > 0) {
      section.classList.add("mmm-library-monitor__account--separated");
    }

    const headerRow = document.createElement("div");
    headerRow.className = "mmm-library-monitor__account-row";

    const label = document.createElement("div");
    label.className = "mmm-library-monitor__account-header bright";
    label.textContent =
      account.label ||
      this.translate("ACCOUNT_LABEL_FALLBACK", {
        count: index + 1,
      });
    headerRow.appendChild(label);

    const summary = document.createElement("div");
    summary.className = account.error
      ? "mmm-library-monitor__account-error small"
      : "mmm-library-monitor__account-summary light";
    summary.textContent = account.error
      ? this.resolveErrorMessage(account.error)
      : this.buildAccountSummaryText(account);
    headerRow.appendChild(summary);
    section.appendChild(headerRow);

    if (account.error) {
      return section;
    }

    if (account.staleError) {
      section.appendChild(this.createStaleNotice(this.resolveErrorMessage(account.staleError)));
    }

    if (this.config.showNotices && account.warning) {
      const notice = document.createElement("div");
      notice.className = "mmm-library-monitor__warning small";
      notice.textContent = account.warning;
      section.appendChild(notice);
    }

    const loans = Array.isArray(account.items) ? account.items : [];
    const reservations = Array.isArray(account.reservations) ? account.reservations : [];

    if (loans.length === 0 && reservations.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mmm-library-monitor__empty dimmed light small";
      empty.textContent = this.translate("NO_ITEMS");
      section.appendChild(empty);
      return section;
    }

    if (loans.length > 0) {
      section.appendChild(this.createItemsTable(loans, "loan"));
    }

    if (reservations.length > 0) {
      section.appendChild(this.createSubsectionLabel(this.translate("RESERVATIONS_SECTION")));
      section.appendChild(this.createItemsTable(reservations, "reservation"));
    }

    // The backend sends at most maxItems of each and counts the rest.
    for (const count of [account.moreItems, account.moreReservations]) {
      if (Number(count) > 0) {
        const more = document.createElement("div");
        more.className = "mmm-library-monitor__more dimmed small";
        more.textContent = this.translate("MORE_ITEMS", { count });
        section.appendChild(more);
      }
    }

    return section;
  },

  createStaleNotice(error) {
    const notice = document.createElement("div");
    notice.className = "mmm-library-monitor__stale small";
    notice.setAttribute("role", "status");
    notice.textContent = this.translate("STALE_DATA", { error });
    return notice;
  },

  /**
   * Urgency means "a deadline is running out". A loan has one, and so does a
   * reservation that is ready for pickup. A pending reservation does not: its
   * date is the day it was *placed*, which always lies in the past and would
   * otherwise mark every reservation as urgent.
   * @param {object} item - Loan or reservation
   * @param {string} itemType - "loan" or "reservation"
   * @returns {string|null} "overdue", "soon", or null
   */
  resolveUrgency(item, itemType) {
    const hasDeadline = itemType === "loan" || (itemType === "reservation" && item.status === "readyForPickup");

    if (!hasDeadline || !Number.isFinite(item.daysRemaining)) {
      return null;
    }

    if (item.isOverdue) {
      return "overdue";
    }

    return item.daysRemaining <= this.config.urgencyThresholdDays ? "soon" : null;
  },

  createSubsectionLabel(text) {
    const label = document.createElement("div");
    label.className = "mmm-library-monitor__subsection-label dimmed small";
    label.textContent = text;
    return label;
  },

  createItemsTable(items, itemType) {
    const table = document.createElement("table");
    table.className = "small mmm-library-monitor__table";

    const caption = document.createElement("caption");
    caption.className = "mmm-library-monitor__sr-only";
    caption.textContent = this.translate(
      itemType === "reservation" ? "TABLE_CAPTION_RESERVATIONS" : "TABLE_CAPTION_LOANS",
    );
    table.appendChild(caption);

    const tbody = document.createElement("tbody");

    items.forEach((item) => {
      const row = document.createElement("tr");
      row.className = "mmm-library-monitor__row";

      const urgency = this.resolveUrgency(item, itemType);
      if (urgency) {
        row.classList.add(`mmm-library-monitor__row--${urgency}`);
      }

      // A <th scope="row"> gives the row an accessible name, so a screen reader
      // announces the due date together with the title it belongs to.
      const titleCell = document.createElement("th");
      titleCell.setAttribute("scope", "row");
      titleCell.className = "mmm-library-monitor__title";
      titleCell.appendChild(this.createTitleBlock(item));

      const dueCell = document.createElement("td");
      dueCell.className = "mmm-library-monitor__due bright";
      dueCell.textContent = this.formatItemDate(item);

      if (urgency) {
        // Colour alone must not carry the status.
        const status = document.createElement("span");
        status.className = "mmm-library-monitor__sr-only";
        status.textContent = ` (${this.translate(urgency === "overdue" ? "STATUS_OVERDUE" : "STATUS_DUE_SOON")})`;
        dueCell.appendChild(status);
      }

      row.appendChild(titleCell);
      row.appendChild(dueCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
  },

  createCoverElement(item) {
    const cover = document.createElement("img");
    let showingPlaceholder = false;

    const applyPlaceholder = () => {
      if (showingPlaceholder) {
        return;
      }

      showingPlaceholder = true;
      cover.classList.add("mmm-library-monitor__cover--placeholder");
      cover.src = PLACEHOLDER_COVER_URL;
      cover.alt = "";
    };

    cover.className = "mmm-library-monitor__cover";
    // The title is rendered directly beside the cover, so the image adds
    // nothing for a screen reader.
    cover.alt = "";
    cover.setAttribute("aria-hidden", "true");
    cover.loading = "lazy";

    cover.addEventListener("error", applyPlaceholder);
    cover.addEventListener("load", () => {
      if (showingPlaceholder) {
        return;
      }

      if (cover.naturalWidth <= 5 || cover.naturalHeight <= 5) {
        applyPlaceholder();
      }
    });

    if (this.isSafeCoverUrl(item.coverImageUrl)) {
      cover.src = item.coverImageUrl;
    } else {
      applyPlaceholder();
    }

    return cover;
  },

  /**
   * Covers are either proxied through the mirror (a root-relative path) or
   * loaded over http(s). Anything else - javascript:, data:, protocol-relative
   * URLs - is refused rather than handed to the browser.
   * @param {string} url - Cover URL as delivered by the backend
   * @returns {boolean} True when the URL is safe to assign to img.src
   */
  isSafeCoverUrl(url) {
    if (typeof url !== "string" || url === "") {
      return false;
    }

    if (url.startsWith("/")) {
      return !url.startsWith("//");
    }

    return /^https?:\/\//i.test(url);
  },

  createTitleBlock(item) {
    const block = document.createElement("div");
    block.className = "mmm-library-monitor__title-block";

    const content = document.createElement("div");
    content.className = "mmm-library-monitor__title-content";

    if (this.config.showBookCovers) {
      content.appendChild(this.createCoverElement(item));
    }

    const text = document.createElement("div");
    text.className = "mmm-library-monitor__title-copy";

    const title = document.createElement("div");
    title.className = "mmm-library-monitor__title-text bright";
    title.textContent = item.title;
    text.appendChild(title);

    if (item.status && item.status !== "loan") {
      const badge = document.createElement("div");
      badge.className = "mmm-library-monitor__status light";
      badge.textContent = this.formatReservationStatus(item);
      text.appendChild(badge);
    }

    const metaParts = [];
    if (this.config.showAuthor && item.author) {
      metaParts.push(item.author);
    }
    if (this.config.showFormat && item.format) {
      metaParts.push(item.format);
    }
    if (this.config.showBranch && item.branch) {
      metaParts.push(item.branch);
    }

    if (metaParts.length > 0) {
      const meta = document.createElement("div");
      meta.className = "mmm-library-monitor__meta dimmed";
      meta.textContent = metaParts.join(" • ");
      text.appendChild(meta);
    }

    content.appendChild(text);
    block.appendChild(content);

    return block;
  },

  buildOverallSummaryText(accounts, allAccounts = accounts) {
    const parts = [];
    if (this.config.hideEmptyAccounts && allAccounts.length > accounts.length) {
      parts.push(
        this.translate("VISIBLE_ACCOUNT_COUNT", {
          visibleCount: accounts.length,
          totalCount: allAccounts.length,
        }),
      );
    } else if (accounts.length > 1) {
      parts.push(this.translate("ACCOUNT_COUNT", { count: accounts.length }));
    }

    parts.push(this.translate("ITEM_COUNT", { count: this.accountData.totalItems || 0 }));

    if (this.accountData.totalReservations) {
      parts.push(
        this.translate("RESERVATION_COUNT", {
          count: this.accountData.totalReservations,
        }),
      );
    }

    const errorCount = accounts.filter((account) => account.error || account.staleError).length;
    if (errorCount > 0) {
      parts.push(this.translate("ACCOUNT_ERRORS", { count: errorCount }));
    }

    return parts.join(" | ");
  },

  buildAccountSummaryText(account) {
    const parts = [];
    const count = account.totalItems || 0;
    parts.push(this.translate("ITEM_COUNT", { count }));

    if (account.totalReservations) {
      parts.push(
        this.translate("RESERVATION_COUNT", {
          count: account.totalReservations,
        }),
      );
    }

    if (this.config.showFees && account.pendingFees) {
      parts.push(this.translate("FEES", { fees: account.pendingFees }));
    }

    if (this.config.showValidUntil && account.validUntil) {
      parts.push(
        this.translate("VALID_UNTIL", {
          date: account.validUntil,
        }),
      );
    }

    return parts.join(" | ");
  },

  formatReservationStatus(item) {
    if (item.status === "readyForPickup") {
      return this.translate("READY_FOR_PICKUP");
    }

    return this.translate("RESERVED");
  },

  formatItemDate(item) {
    if (item.type === "reservation") {
      return this.formatReservationDate(item);
    }

    return this.formatDueDate(item);
  },

  formatReservationDate(item) {
    if (item.status === "readyForPickup") {
      if (!item.pickupDeadline) {
        return this.translate("READY_FOR_PICKUP");
      }

      return this.translate("READY_FOR_PICKUP_UNTIL", {
        date: this.formatDate(item.pickupDeadline),
      });
    }

    if (!item.reservationDate) {
      return this.translate("RESERVED");
    }

    return this.translate("RESERVED_ON", {
      date: this.formatDate(item.reservationDate),
    });
  },

  formatDate(isoDate) {
    if (!isoDate) {
      return this.translate("UNKNOWN_DATE");
    }

    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) {
      return this.translate("UNKNOWN_DATE");
    }

    try {
      return new Intl.DateTimeFormat(this.config.dateLocale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(parsed);
    } catch {
      // A bad dateLocale must not take the whole mirror render down.
      return parsed.toISOString().slice(0, 10);
    }
  },

  formatDueDate(item) {
    if (!item.dueDate) {
      return this.translate("UNKNOWN_DATE");
    }

    const formattedDate = this.formatDate(item.dueDate);

    if (item.isOverdue) {
      return this.translate("OVERDUE_ON", { date: formattedDate });
    }

    if (item.daysRemaining === 0) {
      return this.translate("DUE_TODAY", { date: formattedDate });
    }

    return formattedDate;
  },
});
