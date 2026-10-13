// 麦麦奇幻乐园 · Skill 停止脚本
// 用法：node scripts/stop.js [--port=3100]
//
// 停止策略（按优先级）：
//   1. 优先读取 .runtime/server.pid 中记录的 pid（start.js 前台常驻时可能没有该文件）
//   2. 无 pid 文件时，按端口反查占用进程（Windows 用 netstat，Unix 用 lsof/ss）
//   3. 杀进程后再次探测端口，确认已释放
//
// 代码规范：零 try/catch，process.kill 的同步异常用 Promise 双通道承接

const fs = require("fs");
const path = require("path");
const http = require("http");
const { exec } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PID_FILE = path.join(ROOT, ".runtime", "server.pid");
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

// 端口存活探测
function probe(port) {
  return new Promise(function (resolve) {
    const req = http.get("http://127.0.0.1:" + port + "/", function (res) {
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

// 延迟工具
function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// 发送信号，返回是否成功
function killPid(pid, signal) {
  return new Promise(function (resolve) {
    const task = Promise.resolve().then(function () {
      process.kill(pid, signal);
      return true;
    });
    task.then(
      function () { resolve(true); },
      function () { resolve(false); }
    );
  });
}

// 读取 pid 记录文件，不存在或损坏时返回 null
function readPidFile() {
  return new Promise(function (resolve) {
    if (!fs.existsSync(PID_FILE)) {
      resolve(null);
      return;
    }
    fs.readFile(PID_FILE, "utf8", function (err, content) {
      if (err || !content) {
        resolve(null);
        return;
      }
      const task = Promise.resolve().then(function () { return JSON.parse(content); });
      task.then(
        function (parsed) { resolve(parsed); },
        function () { resolve(null); }
      );
    });
  });
}

// 执行 shell 命令，任何失败都返回空字符串，不抛异常
function runCommand(cmd) {
  return new Promise(function (resolve) {
    exec(cmd, { windowsHide: true, timeout: 5000 }, function (err, stdout) {
      resolve(err ? "" : String(stdout || ""));
    });
  });
}

// 按端口反查占用进程的 PID 列表
function findPidsByPort(port) {
  if (process.platform === "win32") {
    // 输出形如：TCP  0.0.0.0:3100  0.0.0.0:0  LISTENING  12345
    return runCommand("netstat -ano -p TCP").then(function (out) {
      const pids = [];
      out.split("\n").forEach(function (line) {
        if (line.indexOf(":" + port + " ") === -1 && line.indexOf(":" + port + "\t") === -1) {
          return;
        }
        if (line.indexOf("LISTENING") === -1) {
          return;
        }
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pids.indexOf(pid) === -1) {
          pids.push(pid);
        }
      });
      return pids;
    });
  }

  // Unix / macOS
  return runCommand("lsof -ti:" + port).then(function (out) {
    const pids = out.split("\n").map(function (s) { return s.trim(); }).filter(function (s) {
      return /^\d+$/.test(s);
    });
    if (pids.length) {
      return pids;
    }
    return runCommand("ss -lptn 'sport = :" + port + "'").then(function (ssOut) {
      const found = [];
      const re = /pid=(\d+)/g;
      let m = re.exec(ssOut);
      while (m) {
        if (found.indexOf(m[1]) === -1) {
          found.push(m[1]);
        }
        m = re.exec(ssOut);
      }
      return found;
    });
  });
}

function stopByPid(pid) {
  return killPid(Number(pid), "SIGTERM").then(function (killed) {
    if (!killed) {
      console.log("进程 " + pid + " 不存在或已退出");
      return { stopped: false };
    }
    console.log("已停止麦麦奇幻乐园服务（pid=" + pid + "）");
    return { stopped: true };
  });
}

function main() {
  const args = parseArgs();
  const port = Number(args.port || process.env.PORT || DEFAULT_PORT);

  readPidFile().then(function (record) {
    if (record && record.pid) {
      return stopByPid(record.pid).then(function () {
        fs.unlink(PID_FILE, function () {});
        return null;
      });
    }

    // 没有 pid 记录（例如助手用后台任务方式启动），改为按端口查杀
    return probe(port).then(function (res) {
      if (!res.alive) {
        console.log("端口 " + port + " 上没有运行中的服务");
        return null;
      }
      if (res.body.indexOf("麦麦奇幻乐园") === -1) {
        console.log("端口 " + port + " 上跑的不是麦麦奇幻乐园，已跳过以免误杀");
        return null;
      }
      return findPidsByPort(port).then(function (pids) {
        if (!pids.length) {
          console.log("未能定位占用端口 " + port + " 的进程，请手动停止");
          return null;
        }
        // 逐个发信号，全部完成后复查端口是否释放
        let chain = Promise.resolve();
        pids.forEach(function (pid) {
          chain = chain.then(function () { return killPid(Number(pid), "SIGTERM"); });
        });
        return chain.then(function () {
          return delay(600);
        }).then(function () {
          return probe(port);
        }).then(function (after) {
          if (after.alive) {
            console.log("仍有残留进程占用端口 " + port + "，请手动停止（pid: " + pids.join(", ") + "）");
            return null;
          }
          console.log("已停止麦麦奇幻乐园服务（端口 " + port + "）");
          fs.unlink(PID_FILE, function () {});
          return null;
        });
      });
    });
  }, function (err) {
    console.error("停止失败: " + err.message);
    process.exitCode = 1;
  });
}

main();
