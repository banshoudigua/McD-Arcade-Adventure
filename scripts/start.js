// 麦麦奇幻乐园 · Skill 启动脚本
// 用法（推荐后台常驻方式）：node scripts/start.js
// 可选参数：--port=3200 指定端口；--check 只做健康检查不启动服务
//
// 设计说明：
//   本脚本以「前台阻塞」方式运行服务（内部直接 require backend/server.js），
//   由 WorkBuddy 助手以后台任务方式拉起并长期驻留。
//   不采用 detached 子进程，是为了避免不同宿主/沙箱对脱离进程组的差异处理。
//
// 输出约定（供助手解析）：
//   SKILL_URL=http://127.0.0.1:<port>   —— 服务就绪，可跳转游玩
//   SKILL_ALREADY_RUNNING               —— 已有一个实例在跑，不要重复拉起
//   SKILL_PORT_OCCUPIED                 —— 端口被其他程序占用
//
// 代码规范：零 try/catch，错误统一走 Promise 错误通道

const http = require("http");
const path = require("path");

const DEFAULT_PORT = 3100;
const PROBE_TIMEOUT = 400;

// 解析命令行参数，仅支持 --key=value 与 --flag 两种形式
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(function (item) {
    if (item.indexOf("--") !== 0) {
      return;
    }
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      args[body] = true;
      return;
    }
    args[body.slice(0, eq)] = body.slice(eq + 1);
  });
  return args;
}

// HTTP GET 探测：用于健康检查与端口占用判断，任何异常都视为「不可用」
function probe(url) {
  return new Promise(function (resolve) {
    const req = http.get(url, function (res) {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) {
        body += chunk;
      });
      res.on("end", function () {
        resolve({ alive: true, status: res.statusCode, body: body });
      });
    });
    req.on("error", function () {
      resolve({ alive: false, status: 0, body: "" });
    });
    req.setTimeout(PROBE_TIMEOUT, function () {
      req.destroy();
      resolve({ alive: false, status: 0, body: "" });
    });
  });
}

// 判断端口上跑的是不是本项目服务，依据首页 title
function checkPort(port) {
  return probe("http://127.0.0.1:" + port + "/").then(function (res) {
    if (!res.alive) {
      return { state: "free" };
    }
    if (res.body.indexOf("麦麦奇幻乐园") !== -1) {
      return { state: "ours" };
    }
    return { state: "occupied" };
  });
}

// 打印就绪信息（统一格式，便于助手抓取 SKILL_URL）
function printReady(port, reused) {
  console.log("");
  console.log("===== 麦麦奇幻乐园已就绪 =====");
  console.log("SKILL_URL=http://127.0.0.1:" + port);
  console.log("游戏地址: http://127.0.0.1:" + port);
  console.log("停止服务: node scripts/stop.js --port=" + port);
  if (reused) {
    console.log("（复用已运行的实例）");
  }
}

function main() {
  const args = parseArgs();
  const nodeMajor = Number(process.versions.node.split(".")[0]);

  if (nodeMajor < 18) {
    console.error("需要 Node.js 18 或更高版本，当前为 " + process.versions.node);
    process.exitCode = 1;
    return;
  }

  // 云托管 / 容器平台会注入 PORT，此时端口是平台分配的唯一对外端口，
  // **绝不能顺延**——顺延后平台反向代理找不到服务，会直接部署失败。
  // 本地运行时没有 PORT，才允许自动找空闲端口。
  const platformPort = process.env.PORT ? Number(process.env.PORT) : 0;
  if (platformPort && !args.port) {
    console.log("[cloud] 检测到平台注入 PORT=" + platformPort + "，将绑定该端口（不做端口顺延）");
    process.env.PORT = String(platformPort);
    const cloudServer = require(path.join(__dirname, "..", "backend", "server.js"));
    cloudServer.once("listening", function () {
      printReady(platformPort, false);
    });
    return;
  }

  const requested = Number(args.port || process.env.PORT || DEFAULT_PORT);
  let port = requested;
  let tried = 0;

  // 逐端口探测：空闲则启动；命中本服务则复用；被其他程序占用则顺延
  function next() {
    return checkPort(port).then(function (result) {
      if (result.state === "ours") {
        console.log("SKILL_ALREADY_RUNNING");
        printReady(port, true);
        return null;
      }
      if (result.state === "occupied") {
        console.log("端口 " + port + " 被其他程序占用，尝试下一个");
        port += 1;
        tried += 1;
        if (tried >= 5) {
          console.error("连续 5 个端口均被占用，请手动指定：node scripts/start.js --port=3200");
          process.exitCode = 1;
          return null;
        }
        return next();
      }

      if (args.check) {
        console.log("SKILL_NOT_RUNNING");
        return null;
      }

      // 前台常驻：设置端口后加载服务（server.js 内部会 listen），
      // 等 listen 真正完成再打印就绪信息，保证日志顺序与「可访问」语义一致
      process.env.PORT = String(port);
      const server = require(path.join(__dirname, "..", "backend", "server.js"));
      server.once("listening", function () {
        printReady(port, false);
      });
      return null;
    });
  }

  next();
}

main();
