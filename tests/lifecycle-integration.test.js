const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("../lib/mmm-shared/mmm-shared");

const modulePath = require.resolve("../MMM-LibraryMonitor.js");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Deterministic clock and timer queue, installed as globals so the module's
 * lifecycle picks them up when it is created.
 */
function createHarness(startTime = new Date(2026, 0, 15, 8, 0, 0).getTime()) {
  let currentTime = startTime;
  let sequence = 1;
  const scheduled = new Map();

  return {
    now: () => currentTime,
    setTimeout(fn, delay) {
      const id = sequence;
      sequence += 1;
      scheduled.set(id, {
        fn,
        at: currentTime + Math.max(0, Number(delay) || 0),
      });
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
    advance(ms) {
      const target = currentTime + ms;
      for (;;) {
        let dueId = null;
        let dueEntry = null;
        for (const [id, entry] of scheduled.entries()) {
          if (
            entry.at <= target &&
            (dueEntry === null || entry.at < dueEntry.at)
          ) {
            dueId = id;
            dueEntry = entry;
          }
        }

        if (dueEntry === null) {
          break;
        }

        scheduled.delete(dueId);
        currentTime = dueEntry.at;
        dueEntry.fn();
      }

      currentTime = target;
    },
  };
}

function loadModuleDefinition() {
  let definition = null;

  global.Module = {
    register(_name, moduleDefinition) {
      definition = moduleDefinition;
    },
  };

  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  delete global.Module;

  if (!definition) {
    throw new Error("Failed to load MMM-LibraryMonitor module definition");
  }

  return definition;
}

/**
 * Run `body` with the deterministic clock, a stub logger and the shared library
 * installed as globals.
 */
function withEnvironment(harness, body) {
  const originals = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
    random: Math.random,
    shared: globalThis.MMModuleShared,
    console: { info: console.info, debug: console.debug, warn: console.warn },
  };

  globalThis.setTimeout = harness.setTimeout;
  globalThis.clearTimeout = harness.clearTimeout;
  Date.now = harness.now;
  Math.random = () => 0.5; // neutral jitter
  globalThis.MMModuleShared = shared;
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};

  try {
    return body();
  } finally {
    globalThis.setTimeout = originals.setTimeout;
    globalThis.clearTimeout = originals.clearTimeout;
    Date.now = originals.dateNow;
    Math.random = originals.random;
    globalThis.MMModuleShared = originals.shared;
    console.info = originals.console.info;
    console.debug = originals.console.debug;
    console.warn = originals.console.warn;
  }
}

function createInstance(configOverrides = {}, { startHidden = false } = {}) {
  const definition = loadModuleDefinition();
  const instance = {
    ...definition,
    name: "MMM-LibraryMonitor",
    identifier: "module_0_MMM-LibraryMonitor",
    defaults: { ...definition.defaults },
    config: { ...definition.defaults, ...configOverrides },
    hidden: startHidden,
    data: { hidden: startHidden },
    fetchRequests: [],
    renders: 0,
    translate: (key) => key,
    file: (relative) => relative,
    updateDom() {
      this.renders += 1;
    },
    sendSocketNotification(_notification, payload) {
      if (payload?.action === "FETCH_ACCOUNTS") {
        this.fetchRequests.push({ payload, at: Date.now() });
      }
    },
  };

  return instance;
}

/** Answer the pending request the way the node helper would. */
function answerFetch(instance) {
  instance.socketNotificationReceived(instance.notifications.RESPONSE, {
    identifier: instance.identifier,
    action: "FETCH_ACCOUNTS",
    data: { accounts: [], totalItems: 0 },
  });
}

/** Simulate MMM-Carousel showing the module `visibleMs` out of every `cycleMs`. */
function runCarousel(instance, harness, { cycleMs, visibleMs, durationMs }) {
  const cycles = Math.floor(durationMs / cycleMs);
  let answered = 0;

  const drain = () => {
    while (answered < instance.fetchRequests.length) {
      answered += 1;
      answerFetch(instance);
    }
  };

  drain();
  for (let i = 0; i < cycles; i += 1) {
    harness.advance(visibleMs);
    drain();
    instance.hidden = true;
    instance.data.hidden = true;
    instance.suspend();

    harness.advance(cycleMs - visibleMs);
    drain();
    instance.hidden = false;
    instance.data.hidden = false;
    instance.resume();
    drain();
  }
}

test("a full day under MMM-Carousel costs four scheduled fetches, not one per cycle", () => {
  const harness = createHarness();

  withEnvironment(harness, () => {
    const instance = createInstance();
    instance.start();

    runCarousel(instance, harness, {
      cycleMs: 50 * 1000,
      visibleMs: 10 * 1000,
      durationMs: DAY,
    });

    // Initial fetch plus the four anchored 6 h slots. The old implementation
    // produced one fetch per 50 s cycle: 1728 a day.
    assert.equal(instance.fetchRequests.length, 5);
  });
});

test("the fetch count is independent of the Carousel transition interval", () => {
  const counts = [];

  for (const cycleMs of [50 * 1000, 100 * 1000]) {
    const harness = createHarness();
    withEnvironment(harness, () => {
      const instance = createInstance();
      instance.start();
      runCarousel(instance, harness, {
        cycleMs,
        visibleMs: cycleMs / 5,
        durationMs: DAY,
      });
      counts.push(instance.fetchRequests.length);
    });
  }

  assert.equal(counts[0], counts[1]);
});

test("starting hidden behaves like starting visible (config.js order does not matter)", () => {
  const counts = [];

  for (const startHidden of [false, true]) {
    const harness = createHarness();
    withEnvironment(harness, () => {
      const instance = createInstance({}, { startHidden });
      instance.start();
      runCarousel(instance, harness, {
        cycleMs: 50 * 1000,
        visibleMs: 10 * 1000,
        durationMs: DAY,
      });
      counts.push(instance.fetchRequests.length);
    });
  }

  assert.equal(counts[0], counts[1]);
});

test("a larger updateInterval actually reduces the number of fetches", () => {
  const counts = [];

  for (const updateInterval of [3 * HOUR, 12 * HOUR]) {
    const harness = createHarness();
    withEnvironment(harness, () => {
      const instance = createInstance({
        updateInterval,
        updateAnchorHour: null,
      });
      instance.start();
      runCarousel(instance, harness, {
        cycleMs: 50 * 1000,
        visibleMs: 10 * 1000,
        durationMs: DAY,
      });
      counts.push(instance.fetchRequests.length);
    });
  }

  assert.equal(counts[0], 1 + 8);
  assert.equal(counts[1], 1 + 2);
});

test("quiet hours keep the night free of requests", () => {
  const harness = createHarness(new Date(2026, 0, 15, 20, 0, 0).getTime());

  withEnvironment(harness, () => {
    const instance = createInstance({
      updateInterval: HOUR,
      updateAnchorHour: null,
      quietHours: { from: "23:00", to: "06:00" },
    });
    instance.start();

    runCarousel(instance, harness, {
      cycleMs: 50 * 1000,
      visibleMs: 10 * 1000,
      durationMs: 12 * HOUR,
    });

    const hours = instance.fetchRequests.map(({ at }) =>
      new Date(at).getHours(),
    );
    assert.ok(hours.length > 0);
    assert.equal(
      hours.filter((hour) => hour >= 23 || hour < 6).length,
      0,
      `no requests between 23:00 and 06:00, got ${hours.join(", ")}`,
    );
    assert.ok(
      hours.includes(6),
      "polling resumes right after the quiet window",
    );
  });
});

test("an error keeps the module from hammering the OPAC on every resume", () => {
  const harness = createHarness();

  withEnvironment(harness, () => {
    const instance = createInstance();
    instance.start();

    let answered = 0;
    const failPending = () => {
      while (answered < instance.fetchRequests.length) {
        answered += 1;
        instance.socketNotificationReceived(instance.notifications.ERROR, {
          identifier: instance.identifier,
          action: "FETCH_ACCOUNTS",
          error: { message: "OPAC unreachable" },
        });
      }
    };

    failPending();
    for (let i = 0; i < 72; i += 1) {
      harness.advance(10 * 1000);
      instance.hidden = true;
      instance.data.hidden = true;
      instance.suspend();
      harness.advance(40 * 1000);
      instance.hidden = false;
      instance.data.hidden = false;
      instance.resume();
      failPending();
    }

    // One hour of a broken backend: a handful of backed-off retries, not 72.
    assert.ok(
      instance.fetchRequests.length <= 8,
      `expected few retries, got ${instance.fetchRequests.length}`,
    );
    assert.ok(instance.fetchRequests.length >= 2);
  });
});
