/*
 * The refresh schedule lives in the backend (node_helper + lib/mmm-shared/backend-session.js,
 * MODULE-PLAN C3). These tests drive the real node helper with a stubbed OPAC
 * client, a fake socket and a deterministic clock, and count OPAC fetches.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REQUEST = "MMM-LibraryMonitor_REQUEST";
const IDENTIFIER = "module_0_MMM-LibraryMonitor";

const LIBRARY_CONFIG = {
  api: "open",
  data: {
    baseurl: "https://bibliotheken.example/stadt/de-de",
    urls: { account: "Mein-Konto" },
  },
};

function createHarness(startTime = new Date(2026, 0, 15, 8, 0, 0).getTime()) {
  let currentTime = startTime;
  const scheduled = new Set();
  return {
    now: () => currentTime,
    timers: {
      setTimeout(fn, delay) {
        const entry = { fn, at: currentTime + Math.max(0, Number(delay) || 0) };
        scheduled.add(entry);
        return entry;
      },
      clearTimeout(entry) {
        scheduled.delete(entry);
      },
    },
    async advance(ms) {
      const target = currentTime + ms;
      for (;;) {
        let due = null;
        for (const entry of scheduled) {
          if (entry.at <= target && (due === null || entry.at < due.at)) {
            due = entry;
          }
        }
        if (due === null) {
          break;
        }
        scheduled.delete(due);
        currentTime = due.at;
        due.fn();
        await settle();
      }
      currentTime = target;
      await settle();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

class FakeSocket extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.anyHandlers = [];
  }

  onAny(handler) {
    this.anyHandlers.push(handler);
  }

  emit() {
    return true;
  }

  send(action, data, identifier = IDENTIFIER) {
    for (const handler of this.anyHandlers) {
      handler(REQUEST, { identifier, action, data });
    }
  }
}

function createFakeIo() {
  const namespace = new EventEmitter();
  namespace.sockets = new Map();
  return {
    of: () => namespace,
    connect(id) {
      const socket = new FakeSocket(id);
      namespace.emit("connection", socket);
      return socket;
    },
  };
}

/**
 * Load node_helper.js with "node_helper" and the OPAC client stubbed.
 * `outcome()` decides per fetch whether the OPAC answers.
 */
function startHelper(harness, outcome = () => "ok") {
  const helperPath = require.resolve("../node_helper.js");
  const fetches = [];
  const opacStub = {
    ACCOUNT_STATUS_OK: "ok",
    ACCOUNT_STATUS_UNAVAILABLE: "unavailable",
    fetchAccountData: async () => {
      fetches.push(harness.now());
      const status = outcome(fetches.length);
      return {
        accounts: [
          {
            id: "account-1",
            status,
            error: status === "ok" ? null : "OPAC unreachable",
            items: [{ title: "A" }, { title: "B" }, { title: "C" }],
            totalItems: 3,
          },
        ],
        totalItems: 0,
      };
    },
  };

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "node_helper") {
      return { create: (definition) => definition };
    }
    if (request === "./lib/opac-client") {
      return opacStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[helperPath];
  let definition;
  try {
    definition = require(helperPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[helperPath];
  }

  const helper = Object.create(definition);
  helper.name = "MMM-LibraryMonitor";
  helper.pushed = [];
  helper.sendSocketNotification = (_notification, payload) => helper.pushed.push(payload);
  helper.io = createFakeIo();
  helper.hubOptions = {
    timers: harness.timers,
    now: harness.now,
    random: () => 0.5,
  };
  helper.start();
  return { helper, fetches };
}

function configure(socket, overrides = {}) {
  socket.send("CONFIGURE", {
    config: {
      libraryConfig: LIBRARY_CONFIG,
      username: "123",
      password: "secret",
      updateInterval: 6 * HOUR,
      updateAnchorHour: 7,
      backgroundRefresh: true,
      maxItems: 10,
      ...overrides,
    },
  });
}

/** MMM-Carousel: the display reports paused/active every cycle. */
async function runCarousel(socket, harness, { cycleMs, visibleMs, durationMs }) {
  for (let elapsed = 0; elapsed < durationMs; elapsed += cycleMs) {
    await harness.advance(visibleMs);
    socket.send("SESSION_STATE", { state: "paused" });
    await harness.advance(cycleMs - visibleMs);
    socket.send("SESSION_STATE", { state: "active" });
  }
}

test("a full day under MMM-Carousel costs four scheduled fetches, not one per cycle", async () => {
  const harness = createHarness();
  const { helper, fetches } = startHelper(harness);
  const socket = helper.io.connect("s1");
  configure(socket);
  await settle();

  await runCarousel(socket, harness, {
    cycleMs: 50 * 1000,
    visibleMs: 10 * 1000,
    durationMs: DAY,
  });

  // Initial fetch plus the four anchored 6 h slots.
  assert.equal(fetches.length, 5);
  helper.stop();
});

test("the fetch count is independent of the Carousel transition interval", async () => {
  const counts = [];
  for (const cycleMs of [50 * 1000, 100 * 1000]) {
    const harness = createHarness();
    const { helper, fetches } = startHelper(harness);
    const socket = helper.io.connect("s1");
    configure(socket);
    await settle();
    await runCarousel(socket, harness, {
      cycleMs,
      visibleMs: cycleMs / 5,
      durationMs: DAY,
    });
    counts.push(fetches.length);
    helper.stop();
  }
  assert.equal(counts[0], counts[1]);
});

test("a larger updateInterval actually reduces the number of fetches", async () => {
  const counts = [];
  for (const updateInterval of [3 * HOUR, 12 * HOUR]) {
    const harness = createHarness();
    const { helper, fetches } = startHelper(harness);
    const socket = helper.io.connect("s1");
    configure(socket, { updateInterval, updateAnchorHour: null });
    await settle();
    await harness.advance(DAY);
    counts.push(fetches.length);
    helper.stop();
  }
  assert.equal(counts[0], 1 + 8);
  assert.equal(counts[1], 1 + 2);
});

test("quiet hours keep the night free of requests", async () => {
  const harness = createHarness(new Date(2026, 0, 15, 20, 0, 0).getTime());
  const { helper, fetches } = startHelper(harness);
  const socket = helper.io.connect("s1");
  configure(socket, {
    updateInterval: HOUR,
    updateAnchorHour: null,
    quietHours: { from: "23:00", to: "06:00" },
  });
  await settle();
  await harness.advance(12 * HOUR);

  const hours = fetches.map((at) => new Date(at).getHours());
  assert.equal(
    hours.filter((hour) => hour >= 23 || hour < 6).length,
    0,
    `no requests between 23:00 and 06:00, got ${hours.join(", ")}`,
  );
  assert.ok(hours.includes(6), "polling resumes right after the quiet window");
  helper.stop();
});

test("a failed first refresh is retried within minutes, not at the next 6 h slot", async () => {
  const harness = createHarness();
  // e.g. the network is not up yet right after a reboot
  const { helper, fetches } = startHelper(harness, (n) => (n === 1 ? "unavailable" : "ok"));
  const socket = helper.io.connect("s1");
  configure(socket);
  await settle();
  assert.equal(fetches.length, 1);

  await harness.advance(5 * MINUTE);
  assert.equal(fetches.length, 2, "retried after the backoff");
  helper.stop();
});

test("a dead OPAC is retried with growing backoff, not hammered", async () => {
  const harness = createHarness();
  const { helper, fetches } = startHelper(harness, () => "unavailable");
  const socket = helper.io.connect("s1");
  configure(socket);
  await settle();

  await harness.advance(HOUR);
  // 1, 2, 4, 8, 16 min backoff: a handful of attempts in the first hour.
  assert.ok(fetches.length >= 3 && fetches.length <= 7, `got ${fetches.length}`);
  helper.stop();
});

test("the display sends its config once and never asks for data itself", async () => {
  const definitionPath = require.resolve("../MMM-LibraryMonitor.js");
  let definition;
  global.Module = { register: (_name, d) => (definition = d) };
  delete require.cache[definitionPath];
  require(definitionPath);
  delete global.Module;

  const shared = require("../lib/mmm-shared/mmm-shared");
  const originalShared = globalThis.MMModuleShared;
  globalThis.MMModuleShared = shared;
  const sent = [];
  const instance = {
    ...definition,
    name: "MMM-LibraryMonitor",
    identifier: IDENTIFIER,
    config: { ...definition.defaults },
    hidden: false,
    data: {},
    translate: (key) => key,
    updateDom() {},
    sendSocketNotification: (_notification, payload) => sent.push(payload.action),
  };
  try {
    instance.start();
    instance.suspend();
    instance.resume();
  } finally {
    globalThis.MMModuleShared = originalShared;
  }

  assert.deepEqual(sent, ["CONFIGURE", "SESSION_STATE", "SESSION_STATE", "SESSION_STATE"]);
  instance.lifecycle.stop();
});

test("the backend sends at most maxItems loans and counts the rest", async () => {
  const harness = createHarness();
  const { helper } = startHelper(harness);
  const socket = helper.io.connect("s1");
  configure(socket, { maxItems: 2 });
  await settle();

  const data = helper.pushed.find((payload) => payload.action === "DATA").data;
  assert.deepEqual(
    data.accounts[0].items.map((item) => item.title),
    ["A", "B"],
  );
  assert.equal(data.accounts[0].moreItems, 1);
  assert.equal(data.accounts[0].totalItems, 3, "totals stay the real numbers");
  helper.stop();
});

test("each instance logs at its own logLevel", async (t) => {
  const lines = [];
  const originalInfo = console.info;
  console.info = (line) => lines.push(String(line));
  t.after(() => {
    console.info = originalInfo;
  });

  const harness = createHarness();
  const { helper } = startHelper(harness);
  const socket = helper.io.connect("s1");
  const quiet = IDENTIFIER;
  const verbose = "module_9_MMM-LibraryMonitor";
  configure(socket, { logLevel: "warn" });
  socket.send(
    "CONFIGURE",
    { config: { libraryConfig: LIBRARY_CONFIG, username: "456", password: "secret", logLevel: "info" } },
    verbose,
  );
  await settle();

  const finished = (identifier) =>
    lines.filter((line) => line.includes("update finished") && line.includes(identifier));
  assert.equal(finished(verbose).length, 1, "the info instance logs its update");
  assert.equal(finished(quiet).length, 0, "the warn instance stays quiet, although configured first");
  helper.stop();
});
