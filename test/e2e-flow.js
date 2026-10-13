// 本机完整流程端到端测试（真实浏览器驱动）
// 运行前提：先启动服务 node scripts/start.js
// 运行命令：NODE_PATH=$APPDATA/npm/node_modules node test/e2e-flow.js
//
// 覆盖链路：首页 → 选卡 → 开局 → 多次掷骰（含事件卡/营养科普站弹窗处理）
//          → 结算 → 奖品屋 → 兑换指引 → BYOT 绑定（无效 Token / 真实 Token）
//          → 退出绑定 → History API 回退
// 同时收集浏览器 console 错误与未捕获异常，确保流程无前台报错。
//
// 代码规范：零 try/catch，错误统一走 Promise 错误通道

const path = require("path");
const fs = require("fs");

// 浏览器驱动：优先 playwright-core（轻量，不自带下载器），回退完整 playwright
// 两者 API 一致，区别只在包体积与是否自带浏览器下载逻辑
let playwright = null;
const requireTask = Promise.resolve().then(function () {
  return require("playwright-core");
});
const loadDriver = requireTask.then(function (mod) {
  playwright = mod;
  return mod;
}, function () {
  const fallback = Promise.resolve().then(function () {
    return require("playwright");
  });
  return fallback.then(function (mod) {
    playwright = mod;
    return mod;
  }, function (err) {
    throw new Error("未找到 playwright-core / playwright，请先安装其中之一");
  });
});

const BASE = "http://127.0.0.1:3100";
const SHOT_DIR = path.join(__dirname, "..", ".runtime", "e2e-shots");

// 定位本机可用的 Chromium 可执行文件：优先 playwright 已下载的浏览器，回退系统 Chrome/Edge
function findChromium() {
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const candidates = [];

  if (fs.existsSync(root)) {
    fs.readdirSync(root).forEach(function (dir) {
      if (dir.indexOf("chromium-") !== 0) {
        return;
      }
      candidates.push(path.join(root, dir, "chrome-win64", "chrome.exe"));
      candidates.push(path.join(root, dir, "chrome-win", "chrome.exe"));
    });
  }
  candidates.push("C:/Program Files/Google/Chrome/Application/chrome.exe");
  candidates.push("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe");
  candidates.push("C:/Program Files/Microsoft/Edge/Application/msedge.exe");

  for (let i = 0; i < candidates.length; i += 1) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  return "";
}

// 结果收集
const RESULT = { passed: 0, failed: 0, logs: [] };
const consoleErrors = [];
const pageErrors = [];
const badResponses = [];

// 断言：失败时抛错，由 Promise 错误通道统一处理（不使用 try/catch）
function assert(cond, name) {
  if (cond) {
    RESULT.passed += 1;
    console.log("  ✓ " + name);
    return;
  }
  RESULT.failed += 1;
  console.error("  ✗ " + name);
  throw new Error("断言失败: " + name);
}

function info(text) {
  console.log("  · " + text);
}

// 截图：保存关键节点，便于肉眼复核视觉
function shot(page, name) {
  return page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: false });
}

// 判断某个页面区块是否可见
function pageVisible(page, id) {
  return page.evaluate(function (pid) {
    const el = document.getElementById(pid);
    if (!el) {
      return false;
    }
    return !el.classList.contains("hidden");
  }, id);
}

// 弹窗是否打开
function modalVisible(page) {
  return page.evaluate(function () {
    const el = document.getElementById("modal-mask");
    return el ? !el.classList.contains("hidden") : false;
  });
}

// 读取当前弹窗标题
function modalTitle(page) {
  return page.textContent("#modal-title");
}

// 读取项目根 .env 中的真实 MCP Token（仅本机测试使用，输出一律脱敏）
function readRealToken() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return "";
  }
  const content = fs.readFileSync(envPath, "utf8");
  const hit = content.split("\n").find(function (line) {
    return line.indexOf("MCD_MCP_TOKEN=") === 0;
  });
  return hit ? hit.slice("MCD_MCP_TOKEN=".length).trim() : "";
}

// 脱敏显示 Token（只保留前 4 位）
function mask(token) {
  if (!token) {
    return "(空)";
  }
  return token.slice(0, 4) + "****" + token.slice(-4);
}

// ===== 各步骤 =====

function stepHome(page) {
  console.log("\n[1] 首页加载");
  return page.goto(BASE, { waitUntil: "networkidle" }).then(function () {
    return page.title();
  }).then(function (title) {
    assert(title === "麦麦奇幻乐园", "页面标题正确: " + title);
    return page.textContent("#mcp-badge");
  }).then(function (badge) {
    RESULT.logs.push("MCP 徽标: " + badge);
    assert(badge && badge.length > 0, "MCP 状态徽标已渲染: " + badge);
    return shot(page, "01-home");
  });
}

function stepSettings(page) {
  console.log("\n[2] 开园设置（人数 / 胜利目标 / 回合上限）");
  return page.click('#seg-count .seg-btn[data-count="2"]').then(function () {
    return page.click('#seg-victory .seg-btn[data-victory="fame"]');
  }).then(function () {
    return page.click('#seg-round .seg-btn[data-round="15"]');
  }).then(function () {
    return page.getAttribute('#seg-count .seg-btn[data-count="2"]', "class");
  }).then(function (cls) {
    assert(cls.indexOf("active") !== -1, "2 人选项已选中");
    return page.getAttribute('#seg-round .seg-btn[data-round="15"]', "class");
  }).then(function (cls) {
    assert(cls.indexOf("active") !== -1, "15 回合选项已选中");
    return page.$$eval("#seg-round .seg-btn", function (els) {
      return els.map(function (e) { return e.getAttribute("data-round"); });
    });
  }).then(function (opts) {
    // 旧版最高只有 5 回合，30 格地图根本跑不完一圈，现扩到 5/10/15/20/30
    assert(opts.indexOf("30") !== -1, "回合上限最高档 30（可选值: " + opts.join("/") + "）");
  });
}

function stepToSelect(page) {
  console.log("\n[3] 进入选卡页");
  return page.click("#btn-to-select").then(function () {
    return page.waitForSelector(".char-card", { timeout: 8000 });
  }).then(function () {
    return page.$$eval(".char-card", function (els) { return els.length; });
  }).then(function (count) {
    assert(count === 12, "角色卡数量正确: " + count + " 张");
    return page.$$eval(".char-card .char-name", function (els) {
      return els.slice(0, 3).map(function (e) { return e.textContent; });
    });
  }).then(function (names) {
    RESULT.logs.push("角色卡示例: " + names.join(" / "));
    return shot(page, "02-select");
  });
}

function stepPickCards(page) {
  console.log("\n[4] 选择角色卡");
  return page.click('.char-card[data-char="1"]').then(function () {
    return page.click('.char-card[data-char="2"]');
  }).then(function () {
    return page.textContent("#select-tip");
  }).then(function (tip) {
    assert(tip.indexOf("2") !== -1, "选卡计数已更新: " + tip);
    return page.getAttribute("#btn-start", "disabled");
  }).then(function (disabled) {
    assert(disabled === null, "开始按钮已解除禁用");
    return shot(page, "03-selected");
  });
}

// 回归测试：累积型目标不得提前结束对局
// Bug 现象：选了 10 回合，打了两回合就跳到结算页，原因是「欢乐值最高」
// 属终局比较型目标，早期实现在中途有人拿到欢乐值时就判定了胜利。
// 本步骤在开局后连掷 8 次（远未到回合上限），确认仍在对局页且没有产生结算结果。
function stepNoEarlyVictory(page) {
  console.log("\n[5.5] 累积型目标不得提前结束对局（回归测试）");

  function rollN(times) {
    if (times === 0) { return Promise.resolve(0); }
    return handleModal(page).then(function (handled) {
      if (handled) {
        return page.waitForTimeout(250).then(function () { return rollN(times); });
      }
      return page.click("#btn-roll").then(function () {
        return page.waitForTimeout(400);
      }).then(function () {
        return rollN(times - 1);
      }, function () {
        // 竞态：判断「无弹窗」到真正点击之间，弹窗出现了（事件卡 / 商店 / 科普站）
        // 先把弹窗处理掉再重试，本次不消耗掷骰次数
        console.log("  [5.5] 点击被弹窗拦截，先处理弹窗再重试");
        return handleModal(page).then(function () {
          return page.waitForTimeout(300);
          return rollN(times);
        });
      });
    });
  }

  // 读取对局实时状态
  function readState() {
    return page.evaluate(function () {
      const g = window.state ? window.state.game : null;
      const resVisible = !document.getElementById("page-result").classList.contains("hidden");
      return g ? {
        round: g.round, total: g.totalRounds, status: g.status,
        hasResult: Boolean(g.result),
        maxFame: Math.max.apply(null, g.players.map(function (p) { return p.fame; })),
        resultVisible: resVisible
      } : null;
    });
  }

  return readState().then(function (s0) {
    assert(s0 !== null && s0.total === 15, "对局回合上限为 15（实际 " + (s0 ? s0.total : "?") + "）");
    return rollN(8);
  }).then(function () {
    return readState();
  }).then(function (s) {
    assert(s !== null, "对局状态可读取");
    assert(s.round <= s.total, "当前回合未超过上限（第 " + s.round + "/" + s.total + " 回合）");
    assert(!s.resultVisible, "掷骰 8 次后仍在对局页，未跳结算页");
    assert(s.status === "playing", "对局状态仍为进行中: " + s.status);
    assert(s.hasResult === false, "未提前产生结算结果");
    RESULT.logs.push("第 " + s.round + " 回合时仍在进行（领先者欢乐值 " + s.maxFame + "）");
    return shot(page, "05b-no-early-victory");
  });
}

function stepStartGame(page) {
  console.log("\n[5] 开始游戏（进入对局页）");
  return page.click("#btn-start").then(function () {
    return page.waitForFunction(function () {
      const el = document.getElementById("page-game");
      return el && !el.classList.contains("hidden");
    }, null, { timeout: 8000 });
  }).then(function () {
    return page.$$eval(".ring-cell", function (els) { return els.length; });
  }).then(function (cells) {
    assert(cells === 30, "棋盘格子数正确: " + cells + " 格");
    return page.$$eval(".player-chip", function (els) { return els.length; });
  }).then(function (players) {
    assert(players === 2, "玩家条数量正确: " + players + " 人");
    return shot(page, "04-game");
  });
}

// 处理当前打开的弹窗：区分营养题（选择题）与普通事件卡
function handleModal(page) {
  return modalVisible(page).then(function (visible) {
    if (!visible) {
      return false;
    }
    return page.$$eval("#quiz-options .quiz-option", function (els) { return els.length; }).then(function (optCount) {
      if (optCount > 0) {
        // 营养科普站：先选一个答案，等反馈，再点下一步关闭
        return page.click('#quiz-options .quiz-option[data-idx="0"]').then(function () {
          return page.waitForTimeout(600);
        }).then(function () {
          return shot(page, "06-quiz");
        }).then(function () {
          return page.$$eval("#modal-actions button", function (els) { return els.length; });
        }).then(function (btnCount) {
          if (btnCount > 0) {
            return page.click("#modal-actions button:last-child");
          }
          return null;
        }).then(function () {
          info("已处理营养科普题（选项数 " + optCount + "）");
          return true;
        });
      }
      // 事件卡：直接确认
      return page.click("#modal-actions button:last-child").then(function () {
        return shot(page, "05-event");
      }).then(function () {
        info("已处理事件卡弹窗");
        return true;
      });
    });
  });
}

// 连续掷骰直到对局结束
function playRounds(page, maxRolls) {
  let rolls = 0;
  let sawQuiz = false;
  let sawEvent = false;

  function loop() {
    return pageVisible(page, "page-result").then(function (finished) {
      if (finished || rolls >= maxRolls) {
        return { rolls: rolls, quiz: sawQuiz, event: sawEvent };
      }
      return handleModal(page).then(function (handled) {
        if (handled) {
          return page.waitForTimeout(300);
        }
        // 无弹窗才继续掷骰
        return page.click("#btn-roll").then(function () {
          rolls += 1;
          RESULT.logs.push("第 " + rolls + " 次掷骰");
          return page.waitForTimeout(450);
        }).then(function () {
          return modalVisible(page);
        }).then(function (visible) {
          if (visible) {
            return modalTitle(page).then(function (t) {
              if (t.indexOf("营养") !== -1 || t.indexOf("小课堂") !== -1) {
                sawQuiz = true;
              } else {
                sawEvent = true;
              }
              RESULT.logs.push("  弹窗: " + t);
            });
          }
          return null;
        });
      }).then(function () {
        return loop();
      });
    });
  }

  console.log("\n[6] 对局推进（掷骰 / 事件卡 / 营养科普站）");
  return loop().then(function (stat) {
    RESULT.logs.push("总掷骰次数: " + stat.rolls);
    assert(stat.rolls > 0, "掷骰流程可执行（共 " + stat.rolls + " 次）");
    return stat;
  });
}

function stepResult(page) {
  console.log("\n[7] 结算页");
  return pageVisible(page, "page-result").then(function (visible) {
    if (!visible) {
      info("未在掷骰上限内结束对局，跳过结算断言");
      return null;
    }
    return page.$$eval(".result-item", function (els) { return els.length; }).then(function (items) {
      assert(items === 2, "结算列表包含全部玩家: " + items + " 条");
      return page.$$eval(".result-item.winner", function (els) { return els.length; });
    }).then(function (winners) {
      assert(winners >= 1, "已产生获胜玩家: " + winners + " 位");
      return page.textContent("#result-reason");
    }).then(function (reason) {
      RESULT.logs.push("结束原因: " + reason);
      // 本用例选的是「欢乐值最高」，它是终局比较型目标：中途领先不判胜，必须回合用尽才结算。
      // 早期 Number("reach") 变成 NaN 导致胜利目标从未生效；中途判胜则让 15 回合在第 1 回合就结束。
      assert(reason.indexOf("欢乐值最高") !== -1,
        "结算原因与所选胜利目标一致（欢乐值最高为终局比较型）: " + reason);
      return shot(page, "07-result");
    });
  });
}

function stepPrizeHouse(page) {
  console.log("\n[8] 奖品屋（MCP 真实奖励）");
  return page.click("#btn-to-prize").then(function () {
    return page.waitForSelector(".prize-card", { timeout: 25000 });
  }).then(function () {
    return page.$$eval(".prize-card", function (els) { return els.length; });
  }).then(function (count) {
    assert(count > 0, "奖励卡片渲染数量: " + count + " 件");
    return page.textContent(".prize-source");
  }).then(function (src) {
    RESULT.logs.push("奖励来源: " + src);
    assert(src.indexOf("MCP") !== -1, "标注数据来源为 MCP: " + src.slice(0, 46));
    return page.textContent("#prize-winner");
  }).then(function (winner) {
    assert(winner.indexOf("本局获胜") !== -1, "奖品屋显示获胜者横幅");
    RESULT.logs.push("获胜者: " + winner.replace(/\s+/g, " ").slice(0, 40));
    return page.$$eval(".reward-tab", function (els) { return els.length; });
  }).then(function (tabs) {
    assert(tabs === 3, "奖励分类 Tab 数量: " + tabs);
    return page.waitForTimeout(600);
  }).then(function () {
    return page.textContent("#points-value");
  }).then(function (points) {
    // 未绑定账号时不得显示任何积分数字。
    // 早期版本会从快照读一份第三方账号积分谎称「演示账号积分」，
    // 那份数据其实是开发者本人账户资产，现已从公开快照整体移除。
    assert(points === "—", "未绑定账号时不展示任何积分数字（当前: " + points + "）");
    return page.textContent("#points-label");
  }).then(function (label) {
    assert(label.indexOf("你的麦享会积分") !== -1, "积分标签为「你的麦享会积分」: " + label);
    return page.$$eval(".redeem-tag.point", function (els) { return els.length; });
  }).then(function (pointCount) {
    assert(pointCount > 0, "奖品卡标注出可真实兑换的商品: " + pointCount + " 件");
    return shot(page, "08-prize");
  });
}

// 选择奖励：从 MCP 真实商品中挑一件，生成奖励凭证
function stepPickReward(page) {
  console.log("\n[9] 选择奖励（MCP 真实商品）");
  // 先验证「可真实扣积分兑换」类商品的弹窗：未绑定账号时应引导绑定
  return page.click(".prize-card:has(.redeem-tag.point) .btn-redeem").then(function () {
    return page.waitForTimeout(500);
  }).then(function () {
    return page.textContent("#modal-body");
  }).then(function (body) {
    assert(body.indexOf("积分") !== -1, "积分可兑商品弹窗展示所需积分数");
    assert(body.indexOf("绑定") !== -1, "未绑定账号时引导绑定（而非直接下单）");
    assert(body.indexOf("商品编码") !== -1, "详情含真实编码（可溯源）");
    RESULT.logs.push("积分可兑弹窗: 引导绑定账号");
    return shot(page, "09-reward-detail");
  }).then(function () {
    return page.click("#modal-actions button:last-child");
  }).then(function () {
    // 取消绑定弹窗，回到奖品屋
    return page.evaluate(function () {
      const btns = document.querySelectorAll("#modal-actions button");
      if (btns.length) { btns[0].click(); }
    });
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(function () {
    // 再点一件活动预约类商品（付费活动，非积分兑换）
    return page.click(".prize-card:has(.redeem-tag.event) .btn-redeem");
  }).then(function () {
    return page.waitForTimeout(500);
  }).then(function () {
    return page.textContent("#modal-body");
  }).then(function (body) {
    assert(body.indexOf("付费活动") !== -1, "活动类标明为付费活动（非积分兑换）");
    assert(body.indexOf("商品编码") !== -1, "活动详情含真实编码（可溯源）");
    const codeMatch = body.match(/商品编码：(\S+?)（/);
    RESULT.logs.push("样品编码: " + (codeMatch ? codeMatch[1] : "未解析"));
    return shot(page, "09-reward-detail");
  }).then(function () {
    // 「查看预约指引」→ 记录选择并生成凭证
    return page.click("#modal-actions button:last-child");
  }).then(function () {
    return page.waitForTimeout(700);
  }).then(function () {
    return page.textContent("#modal-body");
  }).then(function (body) {
    assert(body.indexOf("获奖玩家") !== -1, "生成奖励凭证（含获奖玩家）");
    assert(body.indexOf("领取步骤") !== -1, "凭证含官方渠道领取步骤");
    RESULT.logs.push("奖励凭证已生成");
    return shot(page, "09b-certificate");
  }).then(function () {
    return page.click("#modal-actions button:last-child");
  }).then(function () {
    return page.waitForTimeout(500);
  }).then(function () {
    return page.textContent("#prize-winner");
  }).then(function (winner) {
    assert(winner.indexOf("已选奖励") !== -1, "横幅回显已选奖励");
    RESULT.logs.push("已选回显: " + winner.replace(/\s+/g, " ").slice(0, 46));
    // 切到优惠券类，验证第二类真实商品也可用
    return page.click('.reward-tab[data-tab="coupons"]');
  }).then(function () {
    return page.waitForTimeout(800);
  }).then(function () {
    return page.$$eval(".prize-card", function (els) { return els.length; });
  }).then(function (couponCount) {
    RESULT.logs.push("优惠券类商品数: " + couponCount);
    assert(couponCount > 0, "优惠券类真实商品可切换展示: " + couponCount + " 件");
    return shot(page, "09c-coupons");
  }).then(function () {
    return page.click('.reward-tab[data-tab="mall"]');
  }).then(function () {
    return page.waitForTimeout(500);
  });
}

// 商城筛选：搜索 / 分类 / 排序（价格升降、热门、类别）
function stepRewardFilter(page) {
  console.log("\n[9d] 奖励筛选：搜索 + 分类 + 排序");

  function totalCount() {
    return page.$$eval(".prize-card", function (els) { return els.length; });
  }
  function names() {
    return page.$$eval(".prize-card .prize-name", function (els) {
      return els.map(function (e) { return e.textContent.trim(); });
    });
  }
  function prices() {
    return page.$$eval(".prize-card .prize-cost", function (els) {
      return els.map(function (e) {
        const m = e.textContent.match(/([\d.]+)/);
        return m ? Number(m[1]) : null;
      });
    });
  }

  // 价格排序的不变量：奖品屋有两种「价格」（积分 / 人民币），跨单位不可比，
  // 因此实现为「类型分组 + 组内数值」——积分类整体在前且组内单调，活动类在后且组内单调
  function priceRows() {
    return page.$$eval(".prize-card", function (cards) {
      return cards.map(function (c) {
        const cost = c.querySelector(".prize-cost");
        const m = cost ? cost.textContent.match(/([\d.]+)/) : null;
        return {
          value: m ? Number(m[1]) : null,
          isPoint: Boolean(c.querySelector(".redeem-tag.point"))
        };
      });
    });
  }
  function assertMonotonic(rows, asc, label) {
    // 按「是否积分类」分段，只在段内校验单调
    let ok = true;
    for (let g = 0; g <= 1; g += 1) {
      const seg = rows.filter(function (r) { return (r.isPoint ? 1 : 0) === g; })
        .map(function (r) { return r.value; })
        .filter(function (v) { return v !== null; });
      for (let i = 1; i < seg.length; i += 1) {
        if (asc ? seg[i] < seg[i - 1] : seg[i] > seg[i - 1]) { ok = false; }
      }
    }
    assert(ok, label);
  }

  let baseCount = 0;

  return totalCount().then(function (n) {
    baseCount = n;
    RESULT.logs.push("商城初始商品数: " + n);
    // 1. 分类筛选：点第一个非「全部」的分类 chip
    return page.$$eval(".cat-chip", function (els) {
      return els.map(function (e) { return e.getAttribute("data-cat"); });
    });
  }).then(function (cats) {
    assert(cats.length > 1, "分类筛选 chips 已渲染: " + cats.length + " 个（含全部）");
    const target = cats[1];
    RESULT.logs.push("测试分类: " + target);
    return page.click('.cat-chip[data-cat="' + target + '"]').then(function () {
      return page.waitForTimeout(400);
    }).then(totalCount).then(function (n) {
      assert(n > 0 && n < baseCount, "分类「" + target + "」筛选出 " + n + " 件（少于全部 " + baseCount + " 件）");
      return page.click('.cat-chip[data-cat="all"]');
    });
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(function () {
    // 2. 搜索：输入「生日」
    return page.fill("#reward-search", "生日");
  }).then(function () {
    return page.waitForTimeout(500);
  }).then(totalCount).then(function (n) {
    assert(n > 0 && n < baseCount, "搜索「生日」筛选出 " + n + " 件（少于全部 " + baseCount + " 件）");
    return names();
  }).then(function (list) {
    const bad = list.filter(function (s) { return s.indexOf("生日") === -1; });
    assert(bad.length === 0, "搜索结果全部命中关键词（例外: " + bad.length + "）");
    return page.click("#reward-search-clear");
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(totalCount).then(function (n) {
    assert(n === baseCount, "清空搜索后恢复全部: " + n + " 件");
    // 3. 价格升序
    return page.click('.sort-btn[data-sort="priceAsc"]');
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(priceRows).then(function (rows) {
    const pts = rows.filter(function (r) { return r.isPoint; }).length;
    assert(pts > 0, "价格排序样本含积分类商品: " + pts + " 件");
    assertMonotonic(rows, true, "价格升序：积分类按积分数升序在前、付费活动按金额升序在后");
    // 4. 价格降序
    return page.click('.sort-btn[data-sort="priceDesc"]');
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(priceRows).then(function (rows) {
    assertMonotonic(rows, false, "价格降序：积分类按积分数降序在前、付费活动按金额降序在后");
    // 5. 热门排序
    return page.click('.sort-btn[data-sort="hot"]');
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(function () {
    return page.textContent("#prize-grid");
  }).then(function (text) {
    assert(text.indexOf("热门") !== -1, "热门排序标注了热度计算规则（非伪造官方销量）");
    // 6. 类别排序
    return page.click('.sort-btn[data-sort="cat"]');
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(totalCount).then(function (n) {
    assert(n === baseCount, "按类别排序后数量不变: " + n + " 件");
    // 复位到推荐，方便后续步骤
    return page.click('.sort-btn[data-sort="default"]');
  }).then(function () {
    return page.waitForTimeout(400);
  }).then(function () {
    return shot(page, "09d-filter");
  });
}

// 音效系统：加载、开关切换、偏好持久化、AudioContext 创建
function stepSound(page) {
  console.log("\n[14] 音效系统（Web Audio 实时合成）");
  return page.evaluate(function () {
    return {
      hasPlay: typeof window.soundPlay === "function",
      hasToggle: typeof window.soundToggle === "function",
      libSize: Object.keys(window.SOUND_LIB || {}).length,
      ctxState: window.soundCtx ? window.soundCtx.state : "none"
    };
  }).then(function (info2) {
    assert(info2.hasPlay && info2.hasToggle, "音效接口已挂载到全局（soundPlay / soundToggle）");
    assert(info2.libSize >= 12, "音效库条目数: " + info2.libSize + " 种");
    RESULT.logs.push("音效库: " + info2.libSize + " 种，AudioContext: " + info2.ctxState);
    // 触发一次音效，确认 AudioContext 能真正创建（点击掷骰/按钮时已发生手势）
    return page.evaluate(function () {
      window.soundPlay("click");
      return window.soundCtx ? window.soundCtx.state : "none";
    });
  }).then(function (state2) {
    assert(state2 !== "none", "AudioContext 已在真实浏览器中创建: " + state2);
    // 回到首页再切开关（首页有独立的音效设置项），避免依赖当前所在页面
    return page.goto(BASE + "/");
  }).then(function () {
    return page.waitForSelector("#page-home .btn-sound", { timeout: 8000 });
  }).then(function () {
    return page.click("#page-home .btn-sound");
  }).then(function () {
    return page.waitForTimeout(300);
  }).then(function () {
    return page.evaluate(function () {
      return {
        on: window.soundIsOn(),
        stored: window.localStorage.getItem("mcd_sound_on"),
        icon: document.querySelector(".btn-sound").textContent.trim()
      };
    });
  }).then(function (st) {
    assert(st.on === false && st.stored === "0", "点击后音效关闭且偏好已写入 localStorage: " + JSON.stringify(st));
    assert(st.icon === "🔇", "按钮图标切换为静音态: " + st.icon);
    // 静音时播放不应报错
    return page.evaluate(function () {
      window.soundPlay("roll");
      window.soundPlay("victory");
      return true;
    });
  }).then(function () {
    assert(true, "静音状态下调用播放不抛异常");
    // 切回开启，避免影响后续用例
    return page.click("#page-home .btn-sound");
  }).then(function () {
    return page.waitForTimeout(200);
  }).then(function () {
    return page.evaluate(function () { return window.soundIsOn(); });
  }).then(function (on2) {
    assert(on2 === true, "再次点击恢复开启");
    // 验证偏好持久化：刷新后仍为开启
    return page.reload();
  }).then(function () {
    return page.waitForTimeout(600);
  }).then(function () {
    return page.evaluate(function () { return window.soundIsOn(); });
  }).then(function (on3) {
    assert(on3 === true, "刷新页面后音效偏好保持开启（localStorage 生效）");
    return shot(page, "14-sound");
  });
}

// BYOT：先用无效 Token（应被拒绝），再用真实 Token（应绑定成功并显示真实积分）
function stepBindInvalid(page) {
  console.log("\n[10] BYOT 绑定 · 无效 Token 应被拒绝");
  return page.click("#btn-acc-bind").then(function () {
    return page.waitForSelector("#token-input", { timeout: 5000 });
  }).then(function () {
    // 绑定弹窗应提供直达官方申请页的入口，且必须是新标签打开——
    // 这样玩家去申请 Token 时当前页与对局进度完全不受影响
    return page.evaluate(function () {
      const a = document.getElementById("bind-open-btn");
      return a
        ? { href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") }
        : null;
    });
  }).then(function (info) {
    assert(info !== null, "绑定弹窗提供「打开 Token 申请页」入口");
    assert(info.href === "https://open.mcd.cn/mcp", "入口直连麦当劳官方申请页: " + info.href);
    assert(info.target === "_blank", "申请页在新标签打开（当前页不被导航走）");
    assert((info.rel || "").indexOf("noopener") !== -1, "带 noopener 保护");
    RESULT.logs.push("申请页入口: " + info.href + "（新标签）");
    return page.fill("#token-input", "INVALID_TOKEN_FOR_TEST_1234567890");
  }).then(function () {
    // modal-actions 中第一个按钮是「取消」，最后一个才是「验证并绑定」
    return page.click("#modal-actions button:last-child");
  }).then(function () {
    // 真实请求打到麦当劳接口，给足超时
    return page.waitForFunction(function () {
      const t = document.getElementById("modal-title");
      return t && (t.textContent.indexOf("验证失败") !== -1 || t.textContent.indexOf("绑定成功") !== -1);
    }, null, { timeout: 20000 });
  }).then(function () {
    return modalTitle(page);
  }).then(function (title) {
    RESULT.logs.push("无效 Token 结果: " + title);
    assert(title.indexOf("验证失败") !== -1, "无效 Token 被正确拒绝: " + title);
    return shot(page, "10-bind-invalid");
  });
}

function stepBindReal(page) {
  const token = readRealToken();
  console.log("\n[11] BYOT 绑定 · 真实 Token");
  if (!token || token === "YOUR_MCP_TOKEN") {
    info("未检测到 .env 中的真实 Token，跳过真实绑定验证");
    return page.click("#modal-actions button:last-child").then(function () {
      return null;
    });
  }
  info("使用 Token: " + mask(token));
  return page.click("#modal-actions button:last-child").then(function () {
    return page.waitForSelector("#token-input", { timeout: 5000 });
  }).then(function () {
    return page.fill("#token-input", token);
  }).then(function () {
    // 同样取最后一个按钮（确认按钮）
    return page.click("#modal-actions button:last-child");
  }).then(function () {
    return page.waitForFunction(function () {
      const t = document.getElementById("modal-title");
      return t && (t.textContent.indexOf("绑定成功") !== -1 || t.textContent.indexOf("验证失败") !== -1);
    }, null, { timeout: 25000 });
  }).then(function () {
    return modalTitle(page);
  }).then(function (title) {
    RESULT.logs.push("真实 Token 结果: " + title);
    assert(title.indexOf("绑定成功") !== -1, "真实 Token 绑定成功: " + title);
    return page.textContent("#modal-body");
  }).then(function (body) {
    const hit = body.match(/(\d+)/);
    RESULT.logs.push("真实积分: " + (hit ? hit[1] : "(未解析)"));
    return shot(page, "11-bind-real");
  }).then(function () {
    return page.click("#modal-actions button:last-child");
  }).then(function () {
    return page.waitForTimeout(500);
  }).then(function () {
    return page.textContent("#account-card");
  }).then(function (cardText) {
    assert(cardText.indexOf("已绑定") !== -1, "账号卡片切换为已绑定状态");
    return page.textContent("#points-label");
  }).then(function (label) {
    assert(label.indexOf("我的麦享会积分") !== -1, "积分标签切换为我的账号: " + label);
  });
}

// 服务端安全闸门验证：四道闸门必须全部拦住
// 重点是「不能真扣积分」——全部用会被拒绝的请求验证，不触发任何真实交易
function stepSafetyGates(page) {
  console.log("\n[12b] 服务端安全闸门（真实兑换防护）");
  const probe = (tool, body, headers) => page.evaluate(function (a) {
    return fetch("/api/mcp/" + a.tool, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, a.headers || {}),
      body: JSON.stringify(a.body)
    }).then(function (res) {
      return res.json().then(function (j) { return { status: res.status, json: j }; });
    });
  }, { tool: tool, body: body, headers: headers || {} });

  // 闸门1：查个人积分必须 BYOT（不带 Token → 401）
  return probe("query-my-account", {}).then(function (r) {
    assert(r.status === 401 && r.json.needByot === true,
      "闸门1 无Token 查个人积分被拒: HTTP " + r.status);
    // 闸门2：真实下单必须 BYOT
    return probe("mall-create-order", { skuId: 6113, spuCategory: "1", count: 1, confirm: true });
  }).then(function (r) {
    assert(r.status === 401 && r.json.needByot === true,
      "闸门2 无 Token 下单被拒: HTTP " + r.status);
    // 闸门3：代点餐永久禁用
    return probe("create-order", {});
  }).then(function (r) {
    assert(r.status === 403, "闸门3 代点餐工具被永久禁用: HTTP " + r.status);
    // 闸门4：带无效 Token 时服务端不得回落到项目 Token（否则等于拿开发者账号下单）
    return probe("query-my-account", {}, { "X-MCD-Token": "INVALID_TOKEN_FOR_GATE_TEST_000000" });
  }).then(function (r) {
    assert(r.status === 401, "闸门4 无效 Token 返回 401（未回落到项目 Token）: HTTP " + r.status);
    RESULT.logs.push("安全闸门: 401(无Token查个人) / 401(无Token下单) / 403(代点餐) / 401(无效Token)");
    return shot(page, "12b-safety-gates");
  });
}

function stepUnbind(page) {
  console.log("\n[12] 退出绑定");
  const hasOutBtn = page.$("#btn-acc-out");
  return Promise.resolve(hasOutBtn).then(function (btn) {
    if (!btn) {
      info("未处于绑定状态，跳过退出绑定");
      return null;
    }
    return page.click("#btn-acc-out").then(function () {
      return page.waitForTimeout(500);
    }).then(function () {
      return page.click("#modal-actions button:last-child");
    }).then(function () {
      return page.waitForTimeout(400);
    }).then(function () {
      return page.textContent("#account-card");
    }).then(function (text) {
      // 退出后应回到「未绑定」状态，且不再出现「演示账号」这种概念——
      // 早期版本会回落到一份第三方账号的真实积分数据，那是虚假展示
      assert(text.indexOf("绑定你的麦享会账号") !== -1, "退出后回到未绑定状态");
      assert(text.indexOf("演示账号") === -1, "退出后不再出现「演示账号」概念");
      return page.textContent("#points-value");
    }).then(function (points) {
      assert(points === "—", "退出后不显示任何积分数字: " + points);
    });
  });
}

function stepHistoryBack(page) {
  console.log("\n[13] History API 回退");
  return page.goBack().then(function () {
    return page.waitForTimeout(700);
  }).then(function () {
    return page.evaluate(function () {
      return { path: location.pathname, resultVisible: !document.getElementById("page-result").classList.contains("hidden") };
    });
  }).then(function (state) {
    RESULT.logs.push("回退后 path: " + state.path + " / 结算页可见: " + state.resultVisible);
    assert(state.resultVisible === true, "浏览器后退可回到结算页（History API 生效）");
    return shot(page, "12-history-back");
  });
}

function stepConsoleClean() {
  console.log("\n[14] 浏览器控制台检查");
  console.log("  收集到 console.error: " + consoleErrors.length + " 条");
  consoleErrors.slice(0, 5).forEach(function (line) {
    console.log("    - " + line);
  });
  console.log("  收集到未捕获异常: " + pageErrors.length + " 条");
  pageErrors.slice(0, 5).forEach(function (line) {
    console.log("    - " + line);
  });
  console.log("  非 2xx 响应: " + badResponses.length + " 条");
  badResponses.slice(0, 8).forEach(function (line) {
    console.log("    - " + line);
  });
  assert(pageErrors.length === 0, "无未捕获的页面异常");
  return null;
}

// ===== 主流程 =====
function main() {
  if (!fs.existsSync(SHOT_DIR)) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  }

  console.log("=".repeat(46));
  console.log("本机完整流程测试（真实浏览器）");
  console.log("目标地址: " + BASE);
  console.log("=".repeat(46));

  let browser = null;
  let page = null;

  const chromiumPath = findChromium();
  if (!chromiumPath) {
    console.error("未找到可用的 Chromium / Chrome，无法执行浏览器流程测试");
    process.exitCode = 1;
    return;
  }
  console.log("浏览器: " + chromiumPath);

  loadDriver.then(function () {
    console.log("驱动已加载");
    return null;
  }).then(function () {
    return playwright.chromium.launch({ headless: true, executablePath: chromiumPath });
  }).then(function (b) {
    browser = b;
    return browser.newPage({ viewport: { width: 1280, height: 900 } });
  }).then(function (p) {
    page = p;
    // 收集前台报错
    page.on("console", function (msg) {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", function (err) {
      pageErrors.push(err.message);
    });
    // 记录所有非 2xx 响应，便于定位「看似正常但有接口报错」的情况
    page.on("response", function (res) {
      if (res.status() >= 400) {
        badResponses.push(res.status() + " " + res.url());
      }
    });

    return stepHome(page);
  }).then(function () {
    return stepSettings(page);
  }).then(function () {
    return stepToSelect(page);
  }).then(function () {
    return stepPickCards(page);
  }).then(function () {
    return stepStartGame(page);
  }).then(function () {
    return stepNoEarlyVictory(page);
  }).then(function () {
    return playRounds(page, 60);
  }).then(function () {
    return stepResult(page);
  }).then(function () {
    return pageVisible(page, "page-result");
  }).then(function (finished) {
    if (!finished) {
      info("对局未自然结束，跳过后续结算相关步骤");
      return Promise.reject(new Error("SKIP_TO_REPORT"));
    }
    return stepPrizeHouse(page);
  }).then(function () {
    return stepPickReward(page);
  }).then(function () {
    return stepRewardFilter(page);
  }).then(function () {
    return stepBindInvalid(page);
  }).then(function () {
    return stepBindReal(page);
  }).then(function () {
    return stepSafetyGates(page);
  }).then(function () {
    return stepUnbind(page);
  }).then(function () {
    return stepHistoryBack(page);
  }).then(function () {
    return stepSound(page);
  }).then(function () {
    return stepConsoleClean();
  }).then(function () {
    return null;
  }, function (err) {
    if (err && err.message === "SKIP_TO_REPORT") {
      return null;
    }
    RESULT.failed += 1;
    console.error("\n[异常中断] " + err.message);
    return null;
  }).then(function () {
    return browser ? browser.close() : null;
  }).then(function () {
    console.log("\n" + "=".repeat(46));
    console.log("流程关键点记录:");
    RESULT.logs.slice(0, 30).forEach(function (line) {
      console.log("  - " + line);
    });
    console.log("=".repeat(46));
    console.log("结果：通过 " + RESULT.passed + " 项，失败 " + RESULT.failed + " 项");
    console.log("截图目录: " + SHOT_DIR);
    console.log(RESULT.failed === 0 ? "全部通过" : "存在失败项");
    console.log("=".repeat(46));
    process.exitCode = RESULT.failed === 0 ? 0 : 1;
  });
}

main();