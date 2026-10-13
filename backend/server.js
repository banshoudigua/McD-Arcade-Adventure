// HTTP 服务：静态资源 + MCP 代理接口
// 关键安全设计：Token 只存在于服务端，浏览器端永远拿不到
// 用法：node backend/server.js  默认端口 3100

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { callTool } = require("./mcp-client");
const { parseCampaigns, buildEventDeck } = require("./campaign-parser");
const rewardService = require("./reward-service");
const { parseNutrition, makeQuestion } = require("../game/nutrition");

// 列出本机局域网 IPv4 地址：用于启动时提示「手机连同一 WiFi 即可访问」
// 零依赖，直接读 os.networkInterfaces()
function getLanIps() {
  const ifaces = os.networkInterfaces();
  const out = [];
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((addr) => {
      // 只取 IPv4，且排除 127.0.0.1 与 Docker/WSL 常见的 172.17~172.31 网段
      if (addr.family === "IPv4" && !addr.internal) {
        const parts = addr.address.split(".");
        const isDocker = parts[0] === "172" && Number(parts[1]) >= 17 && Number(parts[1]) <= 31;
        if (!isDocker) {
          out.push(addr.address);
        }
      }
    });
  });
  return out;
}

const PORT = Number(process.env.PORT || 3100);
// 监听地址：默认 0.0.0.0（本机 + 同一 WiFi 下的手机平板 + 云托管容器都能访问）
// 设为 127.0.0.1 则仅本机可见
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.join(__dirname, "..", "web");
const DATA_DIR = path.join(__dirname, "..", "data");

// 快照双轨：私有快照（含实时数据，被 .gitignore 排除）优先，
// 不存在时回退到公开脱敏快照（随仓库分发，保证他人克隆/安装 Skill 后可直接游玩）
const PRIVATE_SNAPSHOT = path.join(DATA_DIR, "mcd-snapshot.json");
const PUBLIC_SNAPSHOT = path.join(DATA_DIR, "mcd-snapshot.public.json");
// 记录本次启动实际使用的快照来源，便于排查「为什么数据是旧的」
let snapshotSource = "none";

function resolveSnapshotPath() {
  const usePrivate = fs.existsSync(PRIVATE_SNAPSHOT);
  snapshotSource = usePrivate ? "private" : "public";
  return usePrivate ? PRIVATE_SNAPSHOT : PUBLIC_SNAPSHOT;
}

// 读取快照文本内容：优先私有，缺则公开；两者都没有才报错
function readSnapshot(callback) {
  const target = resolveSnapshotPath();
  fs.readFile(target, "utf8", (err, content) => {
    if (err) {
      callback(new Error("快照文件不存在（mcd-snapshot.json 与 mcd-snapshot.public.json 均未找到）"), null);
      return;
    }
    callback(null, content);
  });
}

// MIME 类型映射
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

// 安全：防止路径穿越
function safeJoin(base, target) {
  const resolved = path.normalize(path.join(base, target));
  if (resolved.indexOf(base) !== 0) {
    return null;
  }
  return resolved;
}

// 发送 JSON 响应
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

// 读取请求体
function readBody(req, callback) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    // 限制请求体大小，避免内存溢出
    if (raw.length > 1024 * 1024) {
      req.destroy();
    }
  });
  req.on("end", () => callback(null, raw));
  req.on("error", (err) => callback(err, null));
}

// ===== MCP 代理接口（三级策略）=====
// 本项目的安全底线：**任何涉及真实资金/积分的操作，只能用「玩家自己的 Token」执行**，
// 且必须经过玩家显式二次确认。绝不允许用项目自带的 Token 替任何人下单。
//
// 策略分三级：
//   1. ALLOWED_TOOLS  —— 只读公开数据，任何人可调（用项目 Token 或玩家 Token 均可）
//   2. BYOT_ONLY_TOOLS —— 玩家个人数据（订单、券、积分明细），必须玩家自己的 Token
//   3. CONFIRM_TOOLS   —— 真实写入（积分兑换下单），必须玩家 Token + 显式二次确认

// 1) 只读公开数据：营养表、活动日历、门店、菜单、商城商品等
// 注意 query-my-account 不在此列——它返回调用者个人积分，必须玩家自己的 Token
const ALLOWED_TOOLS = [
  "list-nutrition-foods",
  "campaign-calendar",
  "available-coupons",
  "mall-points-products",
  "query-lottery-info",
  "query-my-prizes",
  "now-time-info",
  "query-nearby-stores",
  "query-meals",
  "query-promotions"
];

// 2) 玩家个人数据：只读，但必须 BYOT——用项目 Token 调用会拿到开发者账号数据，不合适
// query-my-account 也移入本组：它返回的是调用者本人的积分，不该用项目 Token 代查
const BYOT_ONLY_TOOLS = [
  "query-my-account",
  "mall-order-list",
  "mall-order-detail",
  "query-order",
  "query-my-coupons",
  "query-store-coupons"
];

// 3) 真实写入：必须玩家 Token + 请求体带 confirm:true（对应界面上的勾选确认）
const CONFIRM_TOOLS = [
  "mall-create-order"
];

// 4) 永久禁止：代点餐、代领券、抽奖、取消订单——这些与「游戏兑奖」无关且风险过高
const BLOCKED_TOOLS = [
  "create-order",
  "cancel-order",
  "auto-bind-coupons",
  "party-order-create",
  "draw-lottery"
];

function handleMcpProxy(req, res, toolName, body) {
  // BYOT 模式：用户在「我的账号」中绑定的自有 Token 经请求头传入，
  // 仅本次请求生效，服务端不存储、不落库、日志不打印 Token 内容
  const byotToken = req.headers["x-mcd-token"] || "";
  // 基础防御：Token 长度异常（过长/含空白）视为非法，回退演示模式
  const isByot = byotToken.length > 0 && byotToken.length <= 200 && byotToken.trim() === byotToken;
  console.log(`[api] MCP 工具调用: ${toolName}${isByot ? " [BYOT]" : " [项目Token]"}`);

  if (BLOCKED_TOOLS.indexOf(toolName) !== -1) {
    sendJson(res, 403, {
      success: false,
      message: "该工具涉及代点餐/代领券/抽奖/取消订单，与游戏兑奖无关，已永久禁用"
    });
    return;
  }

  // 玩家个人数据：必须自带 Token，否则拒绝（避免拿开发者账号冒充玩家）
  if (BYOT_ONLY_TOOLS.indexOf(toolName) !== -1 && !isByot) {
    sendJson(res, 401, {
      success: false,
      message: "该工具返回的是你的个人数据，请先在奖品屋绑定你自己的 MCP Token",
      needByot: true
    });
    return;
  }

  // 真实写入：必须自带 Token + 界面显式确认
  if (CONFIRM_TOOLS.indexOf(toolName) !== -1) {
    if (!isByot) {
      sendJson(res, 401, {
        success: false,
        message: "兑换必须使用你自己的账号，工具已拒绝用项目 Token 下单",
        needByot: true
      });
      return;
    }
    if (!body || body.confirm !== true) {
      sendJson(res, 400, {
        success: false,
        message: "真实积分兑换需要你在界面上二次确认",
        needConfirm: true
      });
      return;
    }
    console.log("[api] ⚠️ 玩家已二次确认，执行真实积分兑换:", toolName);
  }

  if (ALLOWED_TOOLS.indexOf(toolName) === -1
    && BYOT_ONLY_TOOLS.indexOf(toolName) === -1
    && CONFIRM_TOOLS.indexOf(toolName) === -1) {
    sendJson(res, 400, { success: false, message: "工具不在白名单内" });
    return;
  }

  callTool(toolName, body, (err, result) => {
    if (err) {
      // 三类失败语义化区分，便于前端给出准确提示：
      //   401 authFailed —— BYOT 的 Token 无效/过期
      //   503 noToken    —— 当前实例没配 MCP Token（云端部署的常见状态），属「离线模式」不是故障
      //   500其他        —— 后端/上游异常
      let statusCode = 500;
      let message = err.message;
      if (err.authFailed) {
        statusCode = 401;
      } else if (err.noToken) {
        statusCode = 503;
        message = "本实例未配置 MCP Token，当前为离线模式（使用内置公开数据快照）";
      }
      if (statusCode !== 500) {
        console.warn(`[api] ${toolName} ${statusCode}: ${message}`);
      } else {
        console.error(`[api] ${toolName} 调用失败(${statusCode}): ${err.message}`);
      }
      sendJson(res, statusCode, { success: false, message: message, usedByot: isByot, offline: Boolean(err.noToken) });
      return;
    }
    sendJson(res, 200, { success: true, tool: toolName, usedByot: isByot, data: result });
  }, isByot ? byotToken : undefined);
}

// 提供本地快照（离线兜底）
function handleSnapshot(res) {
  readSnapshot((err, content) => {
    if (err) {
      sendJson(res, 404, { success: false, message: err.message });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(content);
  });
}

// 事件卡组接口：麦当劳真实活动（来自快照/MCP） + 内置特色卡池
// 合并后返回，前端拿到的是带完整 effect 的事件对象
function handleCampaignEvents(res) {
  readSnapshot((err, content) => {
    if (err) {
      sendJson(res, 404, { success: false, message: err.message });
      return;
    }
    const parseTask = Promise.resolve().then(function () { return JSON.parse(content); });
    parseTask.then(function (snap) {
      const raw = snap.campaigns && snap.campaigns.rawText ? snap.campaigns.rawText : "";
      parseCampaigns(raw, function (parseErr, list) {
        if (parseErr) {
          sendJson(res, 500, { success: false, message: parseErr.message });
          return;
        }
        const deck = buildEventDeck(list);
        const realCount = list.length;
        sendJson(res, 200, {
          success: true,
          count: deck.length,
          realCount: realCount,
          builtinCount: deck.length - realCount,
          events: deck
        });
      });
    }, function (jsonErr) {
      sendJson(res, 500, { success: false, message: "快照解析失败: " + jsonErr.message });
    });
  });
}

// ===== 奖励接口：GET /api/rewards?city=上海&keyword=人民广场 =====
// 聚合三类 MCP 真实商品，供结算后「选择奖励」使用
function handleRewards(req, res, params) {
  const city = params.city || "上海";
  const keyword = params.keyword || "人民广场";
  const byotToken = req.headers["x-mcd-token"] || "";
  const token = byotToken.length > 0 && byotToken.length <= 200 && byotToken.trim() === byotToken
    ? byotToken
    : undefined;

  rewardService.loadRewards({ city, keyword, token }, (err, payload) => {
    if (err) {
      sendJson(res, 500, { success: false, message: err.message });
      return;
    }
    sendJson(res, 200, { success: true, usedByot: Boolean(token), rewards: payload });
  });
}

// 营养科普题目接口：GET /api/nutrition-question?player=玩家1
// 基于 MCP 真实营养数据生成知识判断题，实现「边玩边学」
function handleNutritionQuestion(res, playerName) {
  readSnapshot((err, content) => {
    if (err) {
      sendJson(res, 404, { success: false, message: err.message });
      return;
    }
    const parseTask = Promise.resolve().then(function () { return JSON.parse(content); });
    parseTask.then(function (snap) {
      const raw = snap.nutrition && snap.nutrition.data ? snap.nutrition.data : "";
      parseNutrition(raw, function (parseErr, foods) {
        if (parseErr || !foods.length) {
          sendJson(res, 500, { success: false, message: "营养数据解析失败" });
          return;
        }
        makeQuestion(foods, playerName || "玩家", function (qErr, question) {
          if (qErr || !question) {
            sendJson(res, 500, { success: false, message: "题目生成失败" });
            return;
          }
          sendJson(res, 200, {
            success: true,
            // 不下发正确答案索引的语义字段名，避免误用
            question: question.question,
            playerName: question.playerName,
            metric: question.metric,
            unit: question.unit,
            options: question.options,
            answerIndex: question.answerIndex,
            answerName: question.answerName,
            answerValue: question.answerValue,
            // 附加所有选项的数值，便于前端展示对比
            optionValues: question.options.map(function (o) {
              var key = question.metric === "热量" ? "kcal" : (question.metric === "蛋白质" ? "protein" : "carb");
              return o[key];
            })
          });
        });
      });
    }, function (jsonErr) {
      sendJson(res, 500, { success: false, message: "快照解析失败: " + jsonErr.message });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const pathname = url.split("?")[0];
  const query = url.indexOf("?") !== -1 ? url.slice(url.indexOf("?") + 1) : "";
  const params = {};
  if (query) {
    query.split("&").forEach(function (pair) {
      var kv = pair.split("=");
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
    });
  }

  // 活动事件卡接口：GET /api/events
  if (pathname === "/api/events" && req.method === "GET") {
    handleCampaignEvents(res);
    return;
  }

  // 奖励商品接口：GET /api/rewards（MCP 实时，失败降级快照）
  if (pathname === "/api/rewards" && req.method === "GET") {
    handleRewards(req, res, params);
    return;
  }

  // 营养科普题目接口：GET /api/nutrition-question
  if (pathname === "/api/nutrition-question" && req.method === "GET") {
    handleNutritionQuestion(res, params.player);
    return;
  }

  // MCP 代理接口：POST /api/mcp/:toolName
  if (pathname.indexOf("/api/mcp/") === 0 && req.method === "POST") {
    const toolName = pathname.replace("/api/mcp/", "");
    readBody(req, (err, raw) => {
      if (err) {
        sendJson(res, 400, { success: false, message: "请求体读取失败" });
        return;
      }
      let body = {};
      if (raw) {
        const parseTask = Promise.resolve().then(() => JSON.parse(raw));
        parseTask.then(
          (parsed) => handleMcpProxy(req, res, toolName, parsed),
          () => sendJson(res, 400, { success: false, message: "请求体 JSON 格式错误" })
        );
      } else {
        handleMcpProxy(req, res, toolName, {});
      }
    });
    return;
  }

  // 快照接口：GET /api/snapshot
  if (pathname === "/api/snapshot" && req.method === "GET") {
    handleSnapshot(res);
    return;
  }

  // 静态资源
  let filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = safeJoin(ROOT, filePath);
  if (!fullPath) {
    sendJson(res, 403, { success: false, message: "非法路径" });
    return;
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      // History API 前端路由：非根路径一律回退到 index.html
      if (pathname.indexOf("/api/") !== 0) {
        const indexPath = path.join(ROOT, "index.html");
        fs.readFile(indexPath, (idxErr, idxContent) => {
          if (idxErr) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("页面不存在");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(idxContent);
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("接口不存在");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`[启动失败] 端口 ${PORT} 已被占用，请换端口：PORT=3200 node backend/server.js`);
    return;
  }
  console.error(`[启动失败] ${err && err.message ? err.message : err}`);
});

// 启动成功：把本地、局域网、公网三种访问方式一次说清
server.listen(PORT, HOST, () => {
  // 启动即确认一次快照来源，日志里直接体现「当前用的是实时数据还是公开脱敏数据」
  resolveSnapshotPath();

  const lanIps = getLanIps();

  console.log("");
  console.log("════════ 麦麦奇幻乐园已就绪 ════════");
  console.log(`  本机访问: http://127.0.0.1:${PORT}`);

  if (lanIps.length) {
    // 同一个 WiFi 下的手机 / 平板可以直接打开，这是最省事的「给孩子玩」方式
    console.log("");
    console.log("  📱 手机 / 平板访问（需与电脑连同一个 WiFi）：");
    lanIps.forEach((ip) => {
      console.log(`     http://${ip}:${PORT}`);
    });
  } else {
    console.log("  📱 未检测到局域网地址（可能未连接 WiFi）");
  }

  if (HOST === "0.0.0.0") {
    console.log("");
    console.log("  🌐 已监听所有网卡，可用于云托管 / 容器部署：");
    console.log("     设置环境变量 PORT=<平台分配端口> 后启动即可");
  } else {
    console.log("");
    console.log(`  🌐 仅监听 ${HOST}（如需公网访问：HOST=0.0.0.0 node backend/server.js）`);
  }

  console.log("");
  console.log(`  数据快照: ${snapshotSource === "private" ? "私有实时快照" : "公开脱敏快照（离线可玩）"}`);
  console.log(`  MCP 只读工具: ${ALLOWED_TOOLS.length} 个`);
  console.log(`  需 BYOT 的工具: ${BYOT_ONLY_TOOLS.length + CONFIRM_TOOLS.length} 个`);
  console.log(`  永久禁用: ${BLOCKED_TOOLS.join(", ")}`);
  console.log("══════════════════════════════════");
  console.log("");
});

module.exports = server;