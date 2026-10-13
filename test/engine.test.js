// 引擎自动化测试：验证桌游状态机的核心逻辑
// 运行：node test/engine.test.js
// 说明：不使用 try/catch，断言失败通过 process.exitCode 与日志体现

const engine = require("../game/engine");
const chars = require("../game/characters");
const nutrition = require("../game/nutrition");
const campaignParser = require("../backend/campaign-parser");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

// 断言辅助
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log("  ✓ " + msg);
  } else {
    failed += 1;
    console.error("  ✗ " + msg);
  }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, msg + "（实际: " + actual + "，期望: " + expected + "）");
}

// ========== 1. 角色卡数据完整性 ==========
console.log("\n[1] 角色卡数据完整性");
assertEqual(chars.CHARACTERS.length, 12, "角色卡共 12 张");
assertEqual(chars.CATEGORIES.length, 5, "分类共 5 个");

var missingSource = chars.CHARACTERS.filter(function (c) { return !c.mcpSource; });
assertEqual(missingSource.length, 0, "所有卡牌均有 MCP 溯源标记");

var missingNutri = chars.CHARACTERS.filter(function (c) { return !c.nutrition || !c.nutrition.kcal; });
assertEqual(missingNutri.length, 0, "所有卡牌均有真实营养数据");

var invalidAttr = chars.CHARACTERS.filter(function (c) {
  return c.force < 0 || c.force > 100 || c.strategy < 0 || c.strategy > 100 ||
         c.fame < 0 || c.fame > 100 || c.command < 0 || c.command > 100;
});
assertEqual(invalidAttr.length, 0, "所有属性值均在 0-100 合理区间");

// ========== 2. 引擎常量 ==========
console.log("\n[2] 引擎常量与配置");
assertEqual(engine.BOARD_SIZE, 30, "棋盘为 30 格");
assertEqual(engine.BOARD.length, 30, "棋盘定义完整");
assertEqual(engine.VICTORY_TYPES.length, 4, "胜利目标共 4 种");
assert(engine.LOOP_REWARD > 0, "绕圈奖励为正数");

// 验证棋盘格位无重复
var positions = {};
var dupCount = 0;
engine.BOARD.forEach(function (c) {
  if (positions[c.position]) { dupCount += 1; }
  positions[c.position] = true;
});
assertEqual(dupCount, 0, "棋盘格位无重复");

// ========== 3. 对局创建 ==========
console.log("\n[3] 对局创建与初始化");
engine.createGame({ playerCount: 3, victoryType: "fame", totalRounds: 3, characterIds: [1, 6, 8] },
  function (err, game) {
    if (err) {
      assert(false, "创建对局：" + err.message);
      return finish();
    }
    assertEqual(game.players.length, 3, "创建 3 位玩家");
    assertEqual(game.status, "playing", "初始状态为进行中");
    assertEqual(game.currentPlayerIndex, 0, "当前玩家为 1 号");
    assertEqual(game.round, 1, "初始回合为 1");
    assert(game.players.every(function (p) { return p.position === 0; }), "所有玩家起始位置为 0");
    assert(game.players.every(function (p) { return p.cards.length === 1; }), "每人初始 1 张卡");

    // 人数边界
    engine.createGame({ playerCount: 99, characterIds: [] }, function (err2, g2) {
      assertEqual(g2.players.length, 6, "人数上限被限制为 6");
      engine.createGame({ playerCount: 1, characterIds: [] }, function (err3, g3) {
        assertEqual(g3.players.length, 2, "人数下限被限制为 2");
        testRoll(game);
      });
    });
  });

// ========== 4. 掷骰与移动 ==========
function testRoll(game) {
  console.log("\n[4] 掷骰与移动逻辑");
  var startPos = game.players[0].position;

  engine.rollDice(game, 0, function (err, res) {
    if (err) {
      assert(false, "掷骰：" + err.message);
      return finish();
    }
    assert(res.dice >= 1 && res.dice <= 6, "骰子点数在 1-6 之间（本次 " + res.dice + "）");
    assertEqual(res.player.position, (startPos + res.dice) % 30, "位置按骰子点数推进");

    // 测试 5 连跑后的状态完整性
    var step = 0;
    function run() {
      if (step++ > 50) {
        return finish();
      }
      var idx = game.currentPlayerIndex;
      engine.rollDice(game, idx, function (e) {
        if (e) {
          assert(false, "连续掷骰中断：" + e.message);
          return finish();
        }
        engine.resolveCell(game, idx, function (e2, r) {
          if (e2) {
            assert(false, "格子结算错误：" + e2.message);
            return finish();
          }
          if (r.needEvent) {
            engine.applyEvent(game, idx,
              { id: 1, title: "测试事件", desc: "+1欢乐", effect: { target: "current", changes: { fame: 1 } } },
              function (e3, r3) {
                if (e3) {
                  assert(false, "事件结算错误：" + e3.message);
                  return finish();
                }
                if (r3 && r3.victory) {
                  return checkVictoryResult(game, "事件链路");
                }
                engine.nextTurn(game, function () { run(); });
              });
            return;
          }
          engine.nextTurn(game, function () {
            if (game.status !== "playing") {
              return checkVictoryResult(game, "常规链路");
            }
            run();
          });
        });
      });
    }
    run();
  });
}

// ========== 5. 胜利判定 ==========
function checkVictoryResult(game, chain) {
  console.log("\n[5] 胜利判定（" + chain + "）");
  assert(game.result, chain + "：对局结束时生成了结算结果");
  assert(game.result.winners && game.result.winners.length > 0, chain + "：结算结果包含获胜者");
  assert(game.result.reason && game.result.reason.length > 0, chain + "：结算原因非空");

  // 交给 5.1 收尾并继续历史回退用例，避免 testHistory 被重复执行
  testMidGameNoVictory();
}

// ========== 5.1 累积型目标中途不得判胜（回归测试）============
// Bug 回顾：早期 checkVictory 的 fame/collection/shield 分支没有判断 force，
// 导致第一个回合有人拿到 +2 欢乐值就判定游戏结束——选 10 回合的对局
// 第 1 回合就跳到结算页。「中途领先」不等于「获胜」。
function testMidGameNoVictory() {
  console.log("\n[5.1] 累积型目标中途不得判胜（回归测试）");
  var types = ["fame", "collection", "shield"];
  var pending = types.length;
  var failed = false;

  types.forEach(function (type) {
    engine.createGame({ playerCount: 3, victoryType: type, totalRounds: 10, characterIds: [1, 6, 8] },
      function (err, game) {
        if (err) { assert(false, "建局失败：" + err.message); return done(); }
        // 人为制造「某人明显领先」的局面，模拟对局中期
        game.players[0].fame = 20;
        game.players[0].shield = 5;
        game.players[0].cards.push(1, 6, 8, 11);
        game.round = 3;

        var mid = engine.checkVictory(game, false);
        assert(mid === null, type + "：第 3 回合中途领先不判胜（实际 " +
          (mid ? mid.reason : "null") + "）");

        // 只有回合用尽（force=true）才结算
        var forced = engine.checkVictory(game, true);
        assert(forced !== null, type + "：回合用尽正常结算");
        if (forced) {
          assert(forced.winners.length === 1 && forced.winners[0].id === 1,
            type + "：胜者是领先者（期望玩家1，实际 " +
            (forced.winners[0] ? forced.winners[0].id : "无") + "）");
        }

        // reach 是即时达成型，中途跑完一圈应立即判胜
        engine.createGame({ playerCount: 2, victoryType: "reach", totalRounds: 10, characterIds: [1, 6] },
          function (e2, g2) {
            if (e2) { assert(false, "建局失败：" + e2.message); return done(); }
            assert(engine.checkVictory(g2, false) === null, "reach：无人跑完一圈时不判胜");
            g2.players[0].loops = 1;
            var reached = engine.checkVictory(g2, false);
            assert(reached !== null, "reach：有人跑完一圈立即判胜");
            done();
          });
      });
  });

  function done() {
    pending -= 1;
    if (pending === 0 && !failed) { testHistory(); }
  }
}

// ========== 6. 历史回退 ==========
function testHistory() {
  console.log("\n[6] 历史回退（History API 支撑）");
  engine.createGame({ playerCount: 3, victoryType: "fame", totalRounds: 5, characterIds: [1, 6, 8] },
    function (err, game) {
      if (err) {
        assert(false, "创建对局：" + err.message);
        return finish();
      }
      engine.rollDice(game, 0, function () {
        var posAfter = game.players[0].position;
        assert(game.history.length > 0, "掷骰后生成历史快照");

        engine.undoStep(game, function (e) {
          assert(!e, "回退操作成功");
          assertEqual(game.players[0].position, 0, "回退后位置恢复为 0（掷骰后为 " + posAfter + "）");
        });

        // 历史栈上限验证
        engine.createGame({ playerCount: 2, characterIds: [1, 6] }, function (e2, g2) {
          var n = 0;
          function loop() {
            if (n++ > 60) {
              assert(g2.history.length <= 30, "历史栈长度被限制在 30 以内（实际 " + g2.history.length + "）");
              // 继续验证营养科普与活动解析
              return testNutrition();
            }
            engine.rollDice(g2, 0, function () {
              engine.nextTurn(g2, function () { loop(); });
            });
          }
          loop();
        });
      });
    });
}

// ========== 7. 营养科普模块 ==========
function testNutrition() {
  console.log("\n[7] 营养科普模块");
  var snapPath = path.join(__dirname, "..", "data", "mcd-snapshot.json");
  if (!fs.existsSync(snapPath)) {
    console.log("  - 跳过（快照文件不存在）");
    return finish();
  }
  var snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  var raw = snap.nutrition ? snap.nutrition.data : "";

  nutrition.parseNutrition(raw, function (err, foods) {
    if (err || !foods) {
      assert(false, "解析营养数据失败");
      return finish();
    }
    assert(foods.length >= 100, "解析出真实营养数据 " + foods.length + " 条");

    var sample = foods[0];
    assert(typeof sample.name === "string" && sample.name.length > 0, "首条数据含餐品名称");
    assert(typeof sample.kcal === "number", "首条数据含热量数值");

    // 批量验证题目：答案必须唯一且正确
    var total = 0;
    var bad = 0;
    for (var i = 0; i < 200; i += 1) {
      nutrition.makeQuestion(foods, "测试", function (e2, q) {
        if (!q) { return; }
        total += 1;
        var vals = q.options.map(function (o) { return o[q.metricKey]; });
        // 四个选项数值必须互不相同（否则答案不唯一）
        if (new Set(vals).size !== 4) { bad += 1; return; }
        // 答案项必须是极值
        var isMax = q.metric === "蛋白质";
        var target = q.options[q.answerIndex][q.metricKey];
        var expect = isMax ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
        if (target !== expect) { bad += 1; }
      });
    }

    assert(total >= 200, "批量生成题目 " + total + " 道");
    assertEqual(bad, 0, "全部题目答案唯一且正确（无并列值问题）");

    testCampaign();
  });
}

// ========== 8. 活动解析器 ==========
function testCampaign() {
  console.log("\n[8] 真实活动解析器");
  var snapPath = path.join(__dirname, "..", "data", "mcd-snapshot.json");
  var snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  var raw = snap.campaigns ? snap.campaigns.rawText : "";

  campaignParser.parseCampaigns(raw, function (err, list) {
    if (err || !list || !list.length) {
      assert(false, "解析活动日历失败");
      return finish();
    }
    assert(list.length >= 10, "解析出真实活动 " + list.length + " 条");
    assert(list.every(function (c) { return !!c.title; }), "每条活动均有真实标题");
    assert(list.every(function (c) { return !!c.effect; }), "每条活动均有游戏效果配置");

    var activeCount = list.filter(function (c) { return c.isActive; }).length;
    var pastCount = list.filter(function (c) { return c.isPast; }).length;
    assert(activeCount > 0, "识别出 " + activeCount + " 条进行中活动");
    assertEqual(pastCount, 0, "往期回顾活动已排除");

    // 进行中的活动应排在最前
    assert(list[0].isActive, "进行中活动排在首位");

    // 降级测试：空输入时使用兜底卡组
    campaignParser.parseCampaigns("", function (e2, fallback) {
      assert(fallback && fallback.length > 0, "空输入时降级为内置卡组");
      finish();
    });
  });
}

// ========== 汇总 ==========
function finish() {
  console.log("\n" + "=".repeat(40));
  console.log("测试结果：通过 " + passed + " 项，失败 " + failed + " 项");
  console.log(failed === 0 ? "全部通过" : "存在失败项");
  console.log("=".repeat(40));
  process.exitCode = failed === 0 ? 0 : 1;
}