// 前端全链路模拟测试：用最小 DOM stub 真实执行 app.js
// 目的：复现「点击开始游戏无反应」问题并验证修复
// 运行：node test/frontend-sim.test.js
// 说明：不使用 try/catch，异常通过 process 事件与断言计数体现

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log("  ✓ " + msg);
  } else {
    failed += 1;
    console.error("  ✗ " + msg);
  }
}

// ===== 最小 DOM stub =====
function makeElement(id) {
  return {
    id: id,
    children: [],
    style: {},
    dataset: {},
    disabled: false,
    _hidden: true,
    _listeners: {},
    _innerHTML: "",
    _textContent: "",
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    get hidden() { return this.classList.contains("hidden"); },
    addEventListener(type, fn) {
      if (!this._listeners[type]) { this._listeners[type] = []; }
      this._listeners[type].push(fn);
    },
    click() {
      const list = this._listeners.click || [];
      list.forEach((fn) => fn({ currentTarget: this, target: this, preventDefault() {} }));
    },
    getAttribute(name) { return this.dataset[name] !== undefined ? this.dataset[name] : this._attrs[name]; },
    _attrs: {},
    setAttribute(name, val) { this._attrs[name] = val; },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    get offsetWidth() { return 100; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = v;
      // 模拟 innerHTML 重建后子元素消失
      this.children = [];
    },
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = v; },
    get className() { return Array.from(this.classList._set).join(" "); },
    set className(v) { this.classList._set = new Set(v.split(/\s+/).filter(Boolean)); }
  };
}

// 构建页面所有元素（与 index.html 的 id 对齐）
const ELEMENT_IDS = [
  "page-home", "page-select", "page-game", "page-result", "page-prize",
  "seg-count", "seg-victory", "seg-round",
  "btn-to-select", "btn-start", "btn-roll", "btn-undo", "btn-to-prize", "btn-restart",
  "select-tip", "card-grid", "players", "board", "log", "dice",
  "round-title", "turn-banner", "result-reason", "result-list",
  "points-value", "prize-grid", "mcp-badge",
  "modal-mask", "modal-title", "modal-body", "modal-actions"
];

const elements = {};
ELEMENT_IDS.forEach((id) => { elements[id] = makeElement(id); });

// seg 按钮模拟（带 data-* 属性与 active 类）
function makeSegButton(container, attr, value, label) {
  const btn = makeElement("seg-" + attr + "-" + value);
  btn._attrs[attr] = String(value);
  btn._textContent = label;
  btn.classList.add("seg-btn");
  btn.parentElement = container;
  return btn;
}

// document stub
  documentStub = {
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(sel) {
      // 支持测试需要的两个选择器
      if (sel === ".btn-back") {
        const backs = ["page-select", "page-game", "page-prize"].map((p) => {
          const b = makeElement("back-" + p);
          b._attrs["data-back"] = "home";
          return b;
        });
        return backs;
      }
      if (sel === ".char-card") {
        // 模拟真实浏览器：每次 renderSelect 重建 DOM 后都是全新元素（无旧监听器）
        charCards = CHARACTERS_DATA.slice(0, 6).map((c) => {
          const el = makeElement("char-" + c.id + "-" + Math.random());
          el._attrs["data-char"] = String(c.id);
          el.classList.add("char-card");
          return el;
        });
        return charCards;
      }
      if (sel === ".btn-redeem") { return []; }
      if (sel === ".quiz-option") { return []; }
      if (sel === ".seg-btn") { return allSegButtons; }
      return [];
    },
    addEventListener(type, fn) {
      if (type === "DOMContentLoaded") { domReadyHandlers.push(fn); }
    },
    createElement(tag) { return makeElement("created-" + tag + "-" + Math.random()); }
  };

// 选卡卡片模拟
let charCards = [];
const allSegButtons = [];
// 记录 renderSelect 动态生成的卡片（通过 innerHTML 解析太复杂，改为从 app.js 的数据源构建）
let CHARACTERS_DATA = [];

// fetch stub：指向真实后端（服务需已启动）
const BASE = "http://127.0.0.1:3100";
function fetchStub(url, opts) {
  // 与浏览器行为一致：相对路径基于页面源
  const full = url.indexOf("http") === 0 ? url : BASE + url;
  return fetch(full, opts);
}

// window / location / history / sessionStorage stub
const storageMap = {};
const windowStub = {
  addEventListener(type, fn) {
    if (type === "popstate") { popstateHandler = fn; }
  },
  scrollTo() {},
  // sound.js 读取音效偏好
  localStorage: {
    getItem(k) { return storageMap[k] !== undefined ? storageMap[k] : null; },
    setItem(k, v) { storageMap[k] = String(v); },
    removeItem(k) { delete storageMap[k]; }
  }
};
let popstateHandler = null;
const locationStub = { pathname: "/" };
const historyStub = {
  _stack: [{ page: "home", url: "/" }],
  pushState(stateObj, title, url) {
    this._stack.push({ state: stateObj, url: url });
    locationStub.pathname = url;
  },
  replaceState(stateObj, title, url) {
    this._stack[this._stack.length - 1] = { state: stateObj, url: url };
    locationStub.pathname = url;
  }
};
const sessionStorageStub = {
  getItem(k) { return storageMap[k] !== undefined ? storageMap[k] : null; },
  setItem(k, v) { storageMap[k] = String(v); },
  removeItem(k) { delete storageMap[k]; }
};

const domReadyHandlers = [];

// ===== 加载 sound.js + app.js 并执行 =====
// 音效模块与前端逻辑在同一全局作用域执行（与浏览器中 <script> 顺序一致），
// 这样 bind() 里的 soundLoadPref / soundBindGesture 才能正常解析
const appPath = path.join(__dirname, "..", "web", "app.js");
const soundPath = path.join(__dirname, "..", "web", "sound.js");
const appCode = fs.readFileSync(appPath, "utf8");
const soundCode = fs.readFileSync(soundPath, "utf8");

// 用 Function 构造器注入 stub 环境执行（相当于浏览器全局作用域）
const runApp = new Function(
  "document", "window", "location", "history", "sessionStorage", "fetch", "console", "setTimeout", "clearTimeout", "Date", "Math", "JSON", "Promise",
  soundCode + "\n" + appCode +
  "\n;return { getState: function(){ return typeof state !== 'undefined' ? state : null; }, getEvents: function(){ return typeof EVENTS !== 'undefined' ? EVENTS : null; } };"
);

let appApi = null;
let loadError = null;

// 拦截未捕获异常
process.on("uncaughtException", (err) => {
  loadError = err;
  console.error("[uncaught]", err.message);
});

// 提取 CHARACTERS 数据用于卡片模拟（从 app.js 源码中解析）
const charMatch = appCode.match(/var CHARACTERS = (\[[\s\S]*?\]);/);
if (charMatch) {
  const parseTask = Promise.resolve().then(() => new Function("return " + charMatch[1])());
  parseTask.then((list) => {
    CHARACTERS_DATA = list;
    run();
  }, (err) => {
    loadError = err;
    run();
  });
} else {
  loadError = new Error("未能从 app.js 解析 CHARACTERS 数据");
  run();
}

function run() {
  console.log("=== [1] 加载 sound.js + app.js（模拟浏览器环境） ===");
  // 用 Promise 双通道捕获顶层执行异常，不使用 try/catch
  const loadTask = Promise.resolve().then(() => {
    return runApp(
      documentStub, windowStub, locationStub, historyStub, sessionStorageStub,
      fetchStub, console, setTimeout, clearTimeout, Date, Math, JSON, Promise
    );
  });
  loadTask.then((api) => {
    appApi = api;
    assert(true, "sound.js + app.js 顶层执行无异常");
    runBind();
  }, (err) => {
    assert(false, "顶层执行抛异常: " + err.message);
    finish();
  });
}

// 触发 DOMContentLoaded 并继续选卡流程
function runBind() {
  console.log("\n=== [2] 触发 DOMContentLoaded（bind 事件绑定） ===");
  const bindTask = Promise.resolve().then(() => {
    for (let i = 0; i < domReadyHandlers.length; i += 1) {
      domReadyHandlers[i]();
    }
  });
  bindTask.then(() => {
    assert(true, "bind() 执行无异常");
    testSelectFlow();
  }, (err) => {
    assert(false, "bind() 执行抛异常: " + err.message);
    finish();
  });
}

// ===== 选卡与开始游戏流程 =====
function testSelectFlow() {
  console.log("\n=== [3] 点击「进入选卡页面」 ===");
  const beforePath = locationStub.pathname;
  elements["btn-to-select"].click();
  // navigate 使用 Promise，需异步断言
  Promise.resolve().then(() => Promise.resolve()).then(() => {
    assert(locationStub.pathname === "/select", "路由切换到 /select（实际 " + locationStub.pathname + "）");
    assert(elements["page-select"].classList.contains("hidden") === false, "选卡页可见");
    assert(elements["page-home"].classList.contains("hidden") === true, "首页已隐藏");

    console.log("\n=== [4] 模拟选择 3 张卡 ===");
    // 点击 3 张不同的卡；每次点击后 renderSelect 会重建 DOM（querySelectorAll 生成新元素），
    // 因此点击前必须重新获取当前卡片引用，与真实浏览器行为一致
    for (let i = 0; i < 3; i += 1) {
      charCards[i].click();
    }

    return Promise.resolve().then(() => Promise.resolve());
  }).then(() => {
    // 检查已选数量提示
    const tip = elements["select-tip"].textContent;
    assert(tip.indexOf("3 / 3") !== -1, "提示已选 3/3（实际: " + tip + "）");
    assert(elements["btn-start"].disabled === false, "开始按钮已启用");

    console.log("\n=== [5] 点击「开始游戏」（核心用例） ===");
    const clickStartAt = Date.now();
    elements["btn-start"].click();

    // loadRealEvents 有网络请求，等待其完成（最长 7 秒）
    const deadline = Date.now() + 7000;
    function waitGame() {
      if (locationStub.pathname === "/game") {
        const cost = Date.now() - clickStartAt;
        assert(true, "进入对局页 /game（耗时 " + cost + "ms）");
        assert(elements["page-game"].classList.contains("hidden") === false, "对局页可见");
        assert(appApi.getState() && appApi.getState().game !== null, "对局状态已创建");
        assert(appApi.getState().game.players.length === 3, "3 位玩家就位");
        return testRoll();
      }
      if (Date.now() > deadline) {
        assert(false, "点击开始游戏后 7 秒仍未进入对局页 —— 复现「无反应」问题");
        return finish();
      }
      setTimeout(waitGame, 100);
    }
    waitGame();
  });
}

// ===== 掷骰子推进对局 =====
function testRoll() {
  console.log("\n=== [6] 掷骰子推进对局 ===");
  const state0 = appApi.getState().game;
  const beforeRound = state0.round;
  const beforeIndex = state0.currentPlayerIndex;

  elements["btn-roll"].click();

  // 结算链路有 420ms 延迟 + 可能的弹窗，轮询等待
  const deadline = Date.now() + 5000;
  function waitChange() {
    const s = appApi.getState().game;
    const advanced = s.currentPlayerIndex !== beforeIndex || s.round !== beforeRound || (s.logs.length > state0.logs.length);
    if (advanced) {
      assert(true, "掷骰后对局状态推进（日志 " + s.logs.length + " 条）");
      assert(s.lastRoll >= 1 && s.lastRoll <= 6, "骰子点数合法: " + s.lastRoll);
      return testUndo();
    }
    if (Date.now() > deadline) {
      // 可能弹窗等待确认，检查弹窗是否打开
      const modalOpen = elements["modal-mask"].classList.contains("hidden") === false;
      if (modalOpen) {
        assert(true, "掷骰后弹出结算弹窗（等待用户确认，符合预期）");
        return testUndo();
      }
      assert(false, "掷骰后 5 秒对局无任何变化");
      return finish();
    }
    setTimeout(waitChange, 100);
  }
  waitChange();
}

// ===== 回退功能 =====
function testUndo() {
  console.log("\n=== [7] 回退功能（History API 支撑） ===");
  const before = JSON.stringify(appApi.getState().game.players);
  const logCountBefore = appApi.getState().game.logs.length;
  elements["btn-undo"].click();
  Promise.resolve().then(() => Promise.resolve()).then(() => {
    const s = appApi.getState().game;
    const changed = JSON.stringify(s.players) !== before || s.logs.length !== logCountBefore;
    assert(changed, "回退后对局状态发生变化");
    return finish();
  });
}

function finish() {
  console.log("\n" + "=".repeat(44));
  console.log("前端模拟测试：通过 " + passed + " 项，失败 " + failed + " 项");
  console.log(failed === 0 ? "全部通过" : "存在失败项");
  console.log("=".repeat(44));
  process.exitCode = failed === 0 ? 0 : 1;
  // 确保挂起的定时器不阻止退出
  setTimeout(() => process.exit(process.exitCode), 50);
}