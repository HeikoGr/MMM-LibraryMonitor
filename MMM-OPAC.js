/* global Module */

Module.register("MMM-LibraryMonitor", {
  defaults: {
    libraryConfig: null,
    libraryConfigFile: null,
    accounts: [],
    updateInterval: 15 * 60 * 1000,
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
    dateLocale: "de-DE",
    urgencyThresholdDays: 3,
  },

  start() {
    this.loaded = false;
    this.error = null;
    this.accountData = null;
    this.updateTimer = null;
    this.scheduleUpdate(0);
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

  scheduleUpdate(delay) {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    this.updateTimer = setTimeout(() => {
      this.requestUpdate();
      this.scheduleUpdate(this.config.updateInterval);
    }, delay);
  },

  suspend() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  },

  resume() {
    this.scheduleUpdate(0);
  },

  notificationReceived(notification) {
    if (notification === "DOM_OBJECTS_CREATED" && !this.loaded) {
      this.requestUpdate();
    }
  },

  requestUpdate() {
    this.sendSocketNotification("MMM-LibraryMonitor_FETCH", {
      id: this.identifier,
      config: this.config,
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification === `MMM-LibraryMonitor_DATA#${this.identifier}`) {
      this.loaded = true;
      this.error = null;
      this.accountData = payload;
      this.updateDom(this.config.animationSpeed);
      return;
    }

    if (notification === `MMM-LibraryMonitor_ERROR#${this.identifier}`) {
      this.loaded = true;
      this.error = this.resolveErrorMessage(payload);
      this.updateDom(this.config.animationSpeed);
    }
  },

  resolveErrorMessage(payload) {
    return typeof payload === "string" ? payload : String(payload || "");
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-library-monitor";

    if (this.error) {
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

    const accounts = Array.isArray(this.accountData.accounts)
      ? this.accountData.accounts
      : [];
    if (accounts.length === 0) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = this.translate("NO_DATA");
      return wrapper;
    }

    const visibleAccounts = this.config.hideEmptyAccounts
      ? accounts.filter(
          (account) =>
            account.error ||
            (Array.isArray(account.items) && account.items.length > 0),
        )
      : accounts;

    const summary = document.createElement("div");
    summary.className = "mmm-library-monitor__summary small light";
    summary.textContent = this.buildOverallSummaryText(
      visibleAccounts,
      accounts,
    );
    wrapper.appendChild(summary);

    const accountSections = visibleAccounts.map((account, index) =>
      this.createAccountSection(account, index),
    );
    const hasAnyItems = accounts.some(
      (account) => Array.isArray(account.items) && account.items.length > 0,
    );

    if (!hasAnyItems) {
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

    if (this.config.showNotices && account.warning) {
      const notice = document.createElement("div");
      notice.className = "mmm-library-monitor__warning small";
      notice.textContent = account.warning;
      section.appendChild(notice);
    }

    if (!Array.isArray(account.items) || account.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mmm-library-monitor__empty dimmed light small";
      empty.textContent = this.translate("NO_ITEMS");
      section.appendChild(empty);
      return section;
    }

    section.appendChild(this.createItemsTable(account.items));

    if (account.items.length > this.config.maxItems) {
      const more = document.createElement("div");
      more.className = "mmm-library-monitor__more dimmed small";
      more.textContent = this.translate("MORE_ITEMS", {
        count: account.items.length - this.config.maxItems,
      });
      section.appendChild(more);
    }

    return section;
  },

  createItemsTable(items) {
    const table = document.createElement("table");
    table.className = "small mmm-library-monitor__table";

    const tbody = document.createElement("tbody");

    items.slice(0, this.config.maxItems).forEach((item) => {
      const row = document.createElement("tr");
      row.className = "mmm-library-monitor__row";

      if (item.isOverdue) {
        row.classList.add("mmm-library-monitor__row--overdue");
      } else if (item.daysRemaining <= this.config.urgencyThresholdDays) {
        row.classList.add("mmm-library-monitor__row--soon");
      }

      const titleCell = document.createElement("td");
      titleCell.className = "mmm-library-monitor__title";
      titleCell.appendChild(this.createTitleBlock(item));

      const dueCell = document.createElement("td");
      dueCell.className = "mmm-library-monitor__due bright";
      dueCell.textContent = this.formatDueDate(item);

      row.appendChild(titleCell);
      row.appendChild(dueCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
  },

  createTitleBlock(item) {
    const block = document.createElement("div");
    block.className = "mmm-library-monitor__title-block";

    const content = document.createElement("div");
    content.className = "mmm-library-monitor__title-content";

    if (this.config.showBookCovers && item.coverImageUrl) {
      const cover = document.createElement("img");
      cover.className = "mmm-library-monitor__cover";
      cover.src = item.coverImageUrl;
      cover.alt = item.title;
      cover.loading = "lazy";
      content.appendChild(cover);
    }

    const text = document.createElement("div");
    text.className = "mmm-library-monitor__title-copy";

    const title = document.createElement("div");
    title.className = "mmm-library-monitor__title-text bright";
    title.textContent = item.title;
    text.appendChild(title);

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

    parts.push(
      this.translate("ITEM_COUNT", { count: this.accountData.totalItems || 0 }),
    );

    const errorCount = accounts.filter((account) => account.error).length;
    if (errorCount > 0) {
      parts.push(this.translate("ACCOUNT_ERRORS", { count: errorCount }));
    }

    return parts.join(" | ");
  },

  buildAccountSummaryText(account) {
    const parts = [];
    const count = account.totalItems || 0;
    parts.push(this.translate("ITEM_COUNT", { count }));

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

  formatDueDate(item) {
    if (!item.dueDate) {
      return this.translate("UNKNOWN_DATE");
    }

    const formattedDate = new Intl.DateTimeFormat(this.config.dateLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(item.dueDate));

    if (item.isOverdue) {
      return this.translate("OVERDUE_ON", { date: formattedDate });
    }

    if (item.daysRemaining === 0) {
      return this.translate("DUE_TODAY", { date: formattedDate });
    }

    return formattedDate;
  },
});
