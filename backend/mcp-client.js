// MCP 客户端封装：麦当劳中国 MCP Server（Streamable HTTP）
// 职责：统一注入鉴权头、JSON-RPC 封装、限流节流、错误日志
// 注意：Token 只从环境变量读取，禁止硬编码
// 代码规范：全文件不使用 try/catch，错误一律走 callback / Promise 的错误通道

const fs = require("fs");
const path = require("path");

// 读取 .env（手动解析，不引入 dotenv 依赖）
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.log("[env] 未找到 .env 文件，改用系统环境变量");
    return;
  }
  const content = fs.readFileSync(envPath, "utf8");
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      return;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
      console.log("[env] 已加载配置项:", key);
    }
  });
}

loadEnv();

const MCP_URL = process.env.MCD_MCP_URL || "https://mcp.mcd.cn";
const MCP_TOKEN = process.env.MCD_MCP_TOKEN || "";
// 主动节流：官方上限 600 次/分钟，这里保守设为 60 次/分钟
const RATE_LIMIT = Number(process.env.MCD_MCP_RATE_LIMIT || 60);
const MIN_INTERVAL = Math.ceil(60000 / RATE_LIMIT);

// 请求队列：串行执行 + 最小间隔，防止触发 429
let requestQueue = Promise.resolve();
let lastRequestTime = 0;
let requestSeq = 0;

// 鉴权类错误统一打标记：server 层据此返回 401 而不是笼统的 500，
// 前端就能区分「Token 无效」与「服务异常」两种失败
function authError(message) {
  const err = new Error(message);
  err.authFailed = true;
  return err;
}

// JSON 解析并以 callback 返回结果，解析失败不抛异常
// 实现方式：用 Promise 的第二个 then 参数接收错误，避免 try/catch
function parseJson(text, callback) {
  const raw = typeof text === "string" ? text.trim() : "";
  // 快速排除非 JSON 内容（麦当劳部分工具返回自定义 DSL 文本）
  if (!raw || (raw[0] !== "{" && raw[0] !== "[")) {
    callback(new Error("内容非 JSON 格式"), null);
    return;
  }
  const task = Promise.resolve().then(() => JSON.parse(raw));
  task.then(
    (parsed) => callback(null, parsed),
    (err) => callback(new Error(`JSON 解析失败: ${err.message}`), null)
  );
}

// 核心：发起一次 MCP JSON-RPC 调用
// tokenOverride（可选）：BYOT 模式下由前端传入的用户自有 Token，
// 只在本次请求生效；服务端不存储、不记录。日志绝不打印 Token 内容。
function callMcp(method, params, callback, tokenOverride) {
  const run = () => {
    const elapsed = Date.now() - lastRequestTime;
    const wait = Math.max(0, MIN_INTERVAL - elapsed);
    // BYOT：用户 Token 优先；无则回退演示 Token
    const useToken = tokenOverride || MCP_TOKEN;
    const isByot = Boolean(tokenOverride) && tokenOverride !== MCP_TOKEN;

    setTimeout(() => {
      if (!useToken) {
        console.error("[mcp] 缺少 MCP Token（既无 BYOT 头也未配置 .env）");
        // noToken 标记：这不是「服务出错」，而是「当前实例没配凭证」。
        // 上层据此返回 503 而非 500，页面也能区分「离线模式」与「真的挂了」。
        const tokenErr = new Error("MCP Token 未配置");
        tokenErr.noToken = true;
        callback(tokenErr, null);
        return;
      }

      requestSeq += 1;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: requestSeq,
        method,
        params: params || {}
      });

      const startedAt = Date.now();
      const networkTask = fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${useToken}`
        },
        body: payload
      });

      // 用 Promise 双通道处理状态码错误与网络异常
      const statusTask = networkTask.then((res) => {
        // 日志只标记模式，绝不输出 Token 内容
        console.log(`[mcp] ${method} -> HTTP ${res.status} (${Date.now() - startedAt}ms)${isByot ? " [BYOT]" : ""}`);
        if (res.status === 401) {
          console.error("[mcp] 401 鉴权失败：Token 无效或已过期（BYOT 用户请重新获取 Token）");
          return Promise.reject(authError("MCP Token 无效或已过期"));
        }
        if (res.status === 429) {
          console.error("[mcp] 429 触发限流，请降低调用频率");
          return Promise.reject(new Error("MCP 触发限流，请稍后重试"));
        }
        return res.text();
      });

      statusTask.then(
        (text) => {
          if (!text) {
            callback(new Error(`MCP 调用失败: ${method}`), null);
            lastRequestTime = Date.now();
            return;
          }
          parseJson(text, (parseErr, parsed) => {
            lastRequestTime = Date.now();
            if (parseErr) {
              // 官方对无效/过期 Token 返回非 JSON 纯文本（如"当前鉴权码不存在或已失效!"）
              // 必须识别为鉴权错误，而不是当作普通 DSL 内容降级，否则 BYOT 校验形同虚设
              if (text.indexOf("鉴权码") !== -1 || text.indexOf("失效") !== -1 || text.indexOf("未登录") !== -1) {
                callback(authError("MCP Token 无效或已过期"), null);
                return;
              }
              callback(parseErr, null);
              return;
            }
            if (parsed.error) {
              console.error(`[mcp] ${method} 返回错误:`, parsed.error.message || parsed.error);
              callback(new Error(parsed.error.message || "MCP 返回错误"), null);
              return;
            }
            callback(null, parsed.result);
          });
        },
        (netErr) => {
          lastRequestTime = Date.now();
          console.error(`[mcp] ${method} 请求异常:`, netErr.message);
          callback(netErr, null);
        }
      );
    }, wait);
  };

  requestQueue = requestQueue.then(run, run);
  return requestQueue;
}

// 调用具体工具并提取 text 内容
// tokenOverride（可选）：BYOT 用户自有 Token，仅本次调用生效
// 注意：必须把 tokenOverride 透传给 callMcp，否则会静默回落演示 Token
function callTool(toolName, args, callback, tokenOverride) {
  callMcp(
    "tools/call",
    { name: toolName, arguments: args || {} },
    (err, result) => {
      if (err) {
        callback(err, null);
        return;
      }
      const content = (result && result.content) || [];
      const textBlock = content.find((item) => item.type === "text");
      if (!textBlock) {
        callback(null, null);
        return;
      }
      const rawText = textBlock.text || "";

      // 部分工具返回带说明文字的包裹格式，"## Original Response" 之后才是真正 JSON
      const marker = "## Original Response";
      const jsonStart = rawText.indexOf(marker);
      const target = jsonStart === -1 ? rawText : rawText.slice(jsonStart + marker.length).trim();

      parseJson(target, (parseErr, parsed) => {
        if (parseErr) {
          // 属正常情况：营养列表、活动日历等返回的是自定义 DSL 文本
          console.log(`[mcp] ${toolName} 返回非 JSON 内容，按原文保留（长度 ${target.length}）`);
          callback(null, { rawText: target });
          return;
        }
        callback(null, parsed);
      });
    },
    tokenOverride
  );
}

// 列出服务端全部工具
function listTools(callback) {
  callMcp("tools/list", {}, (err, result) => {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, (result && result.tools) || []);
  });
}

module.exports = { callTool, listTools, callMcp, parseJson, MCP_URL, MCP_TOKEN };