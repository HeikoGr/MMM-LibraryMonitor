const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createCoverProxy } = require("../lib/cover-proxy");

/** Minimal express stand-in: captures the one GET route the proxy registers. */
function fakeExpressApp() {
  const routes = new Map();
  return {
    get(path, handler) {
      routes.set(path, handler);
    },
    async request(url) {
      const [, id] = url.match(/\/cover\/([^/]+)$/) || [];
      const handler = [...routes.values()][0];
      const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        set(name, value) {
          this.headers[name] = value;
        },
        send(body) {
          this.body = body;
        },
        end() {},
      };
      await handler({ params: { id } }, res);
      return res;
    },
  };
}

/** Local cover supplier; `bytesSent` shows whether an oversize body was streamed. */
async function startSupplier() {
  const state = { bytesSent: 0 };
  const server = http.createServer((req, res) => {
    if (req.url === "/big.png") {
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": 5 * 1024 * 1024,
      });
      const chunk = Buffer.alloc(64 * 1024);
      const pump = () => {
        while (state.bytesSent < 5 * 1024 * 1024) {
          state.bytesSent += chunk.length;
          if (!res.write(chunk)) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
      return;
    }
    res.writeHead(200, { "content-type": "image/png", "content-length": 4 });
    res.end(Buffer.from([1, 2, 3, 4]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the cover route serves registered covers and nothing else", async () => {
  const supplier = await startSupplier();
  const app = fakeExpressApp();
  const proxy = createCoverProxy({
    expressApp: app,
    moduleName: "MMM-LibraryMonitor",
  });
  try {
    const unknown = await app.request("/MMM-LibraryMonitor/cover/0123456789abcdef0123456789abcdef");
    assert.equal(unknown.statusCode, 404);

    const path = proxy.register(`${supplier.base}/small.png`);
    const ok = await app.request(path);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers["content-type"], "image/png");
    assert.deepEqual([...ok.body], [1, 2, 3, 4]);
  } finally {
    await supplier.close();
  }
});

test("an announced oversize cover is refused before its body is read", async () => {
  const supplier = await startSupplier();
  const app = fakeExpressApp();
  const proxy = createCoverProxy({ expressApp: app, maxBytes: 1024 });
  try {
    const res = await app.request(proxy.register(`${supplier.base}/big.png`));
    assert.equal(res.statusCode, 502);
    assert.ok(supplier.state.bytesSent < 5 * 1024 * 1024, "the supplier must not have to deliver the whole body");
  } finally {
    await supplier.close();
  }
});

/** Supplier that answers every path with a 4-byte image and counts the requests per path. */
async function startCountingSupplier() {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    res.writeHead(200, { "content-type": "image/png", "content-length": 4 });
    res.end(Buffer.from([1, 2, 3, 4]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the cover cache stays under its total byte limit and drops the oldest cover first", async () => {
  const supplier = await startCountingSupplier();
  const app = fakeExpressApp();
  // Room for two 4-byte covers, not three.
  const proxy = createCoverProxy({ expressApp: app, maxTotalBytes: 10 });
  try {
    const paths = ["/a.png", "/b.png", "/c.png"].map((p) => proxy.register(`${supplier.base}${p}`));
    for (const path of paths) {
      assert.equal((await app.request(path)).statusCode, 200);
    }
    assert.equal(proxy.cachedBytes, 8);

    // b and c are still cached, a was dropped and is fetched again.
    await app.request(paths[1]);
    await app.request(paths[2]);
    assert.equal(supplier.hits.get("/b.png"), 1);
    assert.equal(supplier.hits.get("/c.png"), 1);
    await app.request(paths[0]);
    assert.equal(supplier.hits.get("/a.png"), 2);
    assert.ok(proxy.cachedBytes <= 10);
  } finally {
    await supplier.close();
  }
});

test("refreshing an expired cover replaces its bytes instead of counting them twice", async () => {
  const supplier = await startCountingSupplier();
  const app = fakeExpressApp();
  const proxy = createCoverProxy({ expressApp: app, ttlMs: 1 });
  try {
    const path = proxy.register(`${supplier.base}/a.png`);
    await app.request(path);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.request(path);
    assert.equal(supplier.hits.get("/a.png"), 2);
    assert.equal(proxy.cachedBytes, 4);
    proxy.clear();
    assert.equal(proxy.cachedBytes, 0);
  } finally {
    await supplier.close();
  }
});

test("a failed cover request releases its connection instead of leaving the body unread", async () => {
  let socketClosed = false;
  const server = http.createServer((req, res) => {
    req.socket.once("close", () => (socketClosed = true));
    res.writeHead(404, { "content-type": "text/html" });
    const chunk = Buffer.alloc(64 * 1024, 32);
    const pump = () => {
      while (res.write(chunk)) {
        // keep the body flowing until the client stops reading
      }
      res.once("drain", pump);
    };
    pump();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const app = fakeExpressApp();
  const proxy = createCoverProxy({ expressApp: app });
  try {
    const res = await app.request(proxy.register(`http://127.0.0.1:${server.address().port}/missing.png`));
    assert.equal(res.statusCode, 502);
    // The server sees the close a moment after the response; how long that takes depends on the machine,
    // so wait for the event (up to 5 s) instead of sleeping a fixed time.
    const deadline = Date.now() + 5000;
    while (!socketClosed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(socketClosed, "the unread error body must not keep the connection busy");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("registering a known cover again keeps it from being evicted first", () => {
  const proxy = createCoverProxy({ expressApp: fakeExpressApp(), maxEntries: 3 });
  const url = (n) => `https://covers.example/${n}.jpg`;
  const first = proxy.register(url(1));
  proxy.register(url(2));
  proxy.register(url(3));

  // Cover 1 is still on screen and seen again in the next scrape.
  assert.equal(proxy.register(url(1)), first);
  proxy.register(url(4));

  assert.equal(proxy.size, 3);
  assert.equal(proxy.has(url(1)), true, "a re-registered cover counts as the newest");
  assert.equal(proxy.has(url(2)), false, "the least recently seen cover goes first");
});

test("the cover proxy follows at most one redirect, and only to http(s)", async () => {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    const redirects = { "/one": "/cover.png", "/two": "/one", "/elsewhere": "file:///etc/passwd" };
    if (redirects[req.url]) {
      res.writeHead(302, { location: redirects[req.url] });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "image/png", "content-length": 4 });
    res.end(Buffer.from([1, 2, 3, 4]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = fakeExpressApp();
  const proxy = createCoverProxy({ expressApp: app });
  try {
    const one = await app.request(proxy.register(`${base}/one`));
    assert.equal(one.statusCode, 200, "one redirect, as a cover CDN uses it, still works");
    assert.equal(one.body.length, 4);

    const two = await app.request(proxy.register(`${base}/two`));
    assert.equal(two.statusCode, 502, "a second redirect is not followed");
    assert.equal(hits.get("/cover.png"), 1, "the target behind the second redirect was never requested");

    assert.equal((await app.request(proxy.register(`${base}/elsewhere`))).statusCode, 502);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
