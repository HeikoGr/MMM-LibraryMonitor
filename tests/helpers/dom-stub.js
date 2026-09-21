/**
 * Minimal DOM good enough for `getDom()`. The module builds its output with
 * createElement/textContent only, so a full DOM implementation would be a
 * dependency for no extra coverage.
 */
class StubElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this._classes = [];
  }

  get className() {
    return this._classes.join(" ");
  }

  set className(value) {
    this._classes = String(value).split(/\s+/).filter(Boolean);
  }

  get classList() {
    const element = this;
    return {
      add(...names) {
        for (const name of names) {
          if (!element._classes.includes(name)) {
            element._classes.push(name);
          }
        }
      },
      contains(name) {
        return element._classes.includes(name);
      },
    };
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [{ nodeType: 3, textContent: String(value) }];
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof StubElement);
  }

  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  dispatch(type) {
    for (const handler of this.listeners.get(type) || []) {
      handler();
    }
  }
}

function createDocument() {
  return {
    createElement(tagName) {
      return new StubElement(tagName);
    },
  };
}

/** Depth-first walk over every element in the tree, root included. */
function walk(root) {
  const out = [root];
  for (const child of root.children) {
    out.push(...walk(child));
  }
  return out;
}

function findAll(root, className) {
  return walk(root).filter((element) => element._classes.includes(className));
}

function find(root, className) {
  return findAll(root, className)[0] || null;
}

function findByTag(root, tagName) {
  const wanted = String(tagName).toUpperCase();
  return walk(root).filter((element) => element.tagName === wanted);
}

/** Install the stub as `global.document` for the duration of `body`. */
function withDocument(body) {
  const original = global.document;
  global.document = createDocument();
  try {
    return body();
  } finally {
    if (original === undefined) {
      delete global.document;
    } else {
      global.document = original;
    }
  }
}

module.exports = {
  StubElement,
  createDocument,
  find,
  findAll,
  findByTag,
  walk,
  withDocument,
};
