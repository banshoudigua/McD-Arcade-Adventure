// 麦麦奇幻乐园 · 服务状态探测脚本
// 职责：告诉调用方「服务在不在、在哪个端口」，供 Skill 决定是直接跳转还是先启动
// 用法：node scripts/status.js [--port=3100]
// 输出约定：运行中时打印 SKILL_URL=http://127.0.0.1:<port>

const http = require("http");

const DEFAULT_PORT = 3100;

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
    req.setTimeout(400, function () {
      req.destroy();
      resolve({ alive: false, status: 0, body: "" });
    });
  });
}

function main() {
  const args = parseArgs();
  const port = Number(args.port || process.env.PORT || DEFAULT_PORT);
  const indexUrl = "http://127.0.0.1:" + port + "/";

  probe(indexUrl).then(function (res) {
    if (!res.alive) {
      console.log("STOPPED");
      console.log("服务未运行，请先执行: node scripts/start.js");
      return null;
    }
    if (res.body.indexOf("麦麦奇幻乐园") === -1) {
      console.log("OCCUPIED");
      console.log("端口 " + port + " 被其他程序占用");
      return null;
    }
    return probe("http://127.0.0.1:" + port + "/api/snapshot").then(function (apiRes) {
      console.log("RUNNING");
      console.log("SKILL_URL=http://127.0.0.1:" + port);
      console.log("快照接口: " + (apiRes.status === 200 ? "正常" : "异常(" + apiRes.status + ")"));
      return null;
    });
  });
}

main();
