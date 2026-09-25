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
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(socketClosed, "the unread error body must not keep the connection busy");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
