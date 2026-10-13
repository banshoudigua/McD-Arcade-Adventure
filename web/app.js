// 麦麦奇幻乐园 · 前端主逻辑
// 关键设计：History API 管理路由（前进后退可恢复对局状态）
// 代码规范：不用 try/catch，错误走 console 调试信息 +降级展示

// ===== 全局状态 =====
var state = {
  page: "home",
  playerCount: 3,
  victoryType: "fame",
  totalRounds: 10,
  selectedChars: [],
  game: null,
  busy: false
};

// ===== 角色卡数据（与后端 characters.js 保持一致的精简版）=====
// 营养数值来自麦当劳 MCP list-nutrition-foods 真实返回
var CHARACTERS = [
  { id: 1, name: "巨无霸", emoji: "🍔", tier: "T1", roleType: "力量", force: 92, strategy: 62, fame: 85, command: 88, skillName: "双层巨无", skillDesc: "骰出 5 或 6，欢乐值额外 +1", kcal: 513, protein: 27 },
  { id: 2, name: "麦辣鸡腿堡", emoji: "🌶️", tier: "T1", roleType: "爆发", force: 90, strategy: 58, fame: 68, command: 72, skillName: "辣劲上头", skillDesc: "战斗 +2，本回合欢乐 -1", kcal: 485, protein: 24 },
  { id: 3, name: "板烧鸡腿麦满分", emoji: "🍳", tier: "T1", roleType: "均衡", force: 80, strategy: 76, fame: 80, command: 78, skillName: "稳稳开工", skillDesc: "移动可多走 1 步", kcal: 246, protein: 15 },
  { id: 4, name: "麦香鱼", emoji: "🐟", tier: "T1", roleType: "技巧", force: 72, strategy: 88, fame: 78, command: 70, skillName: "海鲜洞察", skillDesc: "海鲜类事件可重抽 1 次", kcal: 325, protein: 16 },
  { id: 5, name: "双层吉士汉堡", emoji: "🧀", tier: "T2", roleType: "防护", force: 68, strategy: 74, fame: 82, command: 90, skillName: "双层芝士盾", skillDesc: "抵消一次负面事件", kcal: 429, protein: 27 },
  { id: 6, name: "可乐大杯", emoji: "🥤", tier: "T1", roleType: "辅助", force: 45, strategy: 86, fame: 90, command: 66, skillName: "气泡加满", skillDesc: "全员欢乐 +1 并移动 1 步", kcal: 224, protein: 0 },
  { id: 7, name: "雪碧中杯", emoji: "💫", tier: "T2", roleType: "机动", force: 48, strategy: 82, fame: 76, command: 60, skillName: "闪亮气泡", skillDesc: "本次移动额外 +2 步", kcal: 105, protein: 0 },
  { id: 8, name: "奥利奥麦旋风", emoji: "🌀", tier: "T1", roleType: "范围", force: 58, strategy: 84, fame: 96, command: 64, skillName: "旋风双味", skillDesc: "甜品类事件可抽 2 张卡", kcal: 266, protein: 5 },
  { id: 9, name: "朱古力新地", emoji: "🍫", tier: "T2", roleType: "治愈", force: 50, strategy: 78, fame: 84, command: 68, skillName: "甜心治愈", skillDesc: "恢复 1 点欢乐护盾", kcal: 282, protein: 5 },
  { id: 10, name: "大薯条", emoji: "🍟", tier: "T1", roleType: "输出", force: 78, strategy: 62, fame: 72, command: 64, skillName: "脆皮打击", skillDesc: "战斗 +2", kcal: 379, protein: 6 },
  { id: 11, name: "麦乐鸡5块", emoji: "🍗", tier: "T2", roleType: "续航", force: 72, strategy: 70, fame: 74, command: 76, skillName: "鸡块补血", skillDesc: "每圈结束回复 1 护盾", kcal: 213, protein: 12 },
  { id: 12, name: "大杯鲜萃咖啡", emoji: "☕", tier: "T2", roleType: "智谋", force: 40, strategy: 95, fame: 62, command: 70, skillName: "提神洞察", skillDesc: "事件难度 -1", kcal: 13, protein: 1 }
];

// ===== 角色技能（真实生效，不再是纸面文案）=====
// hook = 触发时机：
//   roll    掷骰时（可改步数 / 掷骰收益）
//   battle  挑战判定时（可加力量）
//   loop    完成一圈时
//   draw    抽到卡时（可额外抽）
//   guard   遇到负面事件时（抵消一次，每局限一次）
//   event   负面事件未抵消时的补偿
//   turn    轮到自己行动时
var CHAR_SKILLS = [
  { id: 1, name: "双层巨无", hook: "roll", text: "骰出 5 或 6，欢乐值额外 +1",
    run: function (g, p, ctx) { if (ctx.dice >= 5) { p.fame += 1; return true; } return false; } },
  { id: 2, name: "辣劲上头", hook: "battle", text: "挑战判定 +2 力量",
    run: function (g, p, ctx) { ctx.power += 2; return true; } },
  { id: 3, name: "稳稳开工", hook: "roll", text: "本次移动多走 1 步",
    run: function (g, p, ctx) { ctx.steps += 1; return true; } },
  { id: 4, name: "海鲜洞察", hook: "science", text: "营养科普答错也 +1 护盾",
    run: function (g, p, ctx) { p.shield += 1; return true; } },
  { id: 5, name: "双层芝士盾", hook: "guard", text: "抵消一次负面事件",
    run: function (g, p, ctx) { if (p.guardUsed) { return false; } p.guardUsed = 1; return true; } },
  { id: 6, name: "气泡加满", hook: "loop", text: "每完成一圈额外 +2 欢乐",
    run: function (g, p, ctx) { p.fame += 2; return true; } },
  { id: 7, name: "闪亮气泡", hook: "roll", text: "本次移动额外 +2 步",
    run: function (g, p, ctx) { ctx.steps += 2; return true; } },
  { id: 8, name: "旋风双味", hook: "draw", text: "抽卡时额外再抽 1 张",
    run: function (g, p, ctx) { return true; } },
  { id: 9, name: "甜心治愈", hook: "turn", text: "轮到自己时 +1 护盾",
    run: function (g, p, ctx) { p.shield += 1; return true; } },
  { id: 10, name: "脆皮打击", hook: "battle", text: "挑战判定 +2 力量",
    run: function (g, p, ctx) { ctx.power += 2; return true; } },
  { id: 11, name: "鸡块补血", hook: "loop", text: "每完成一圈 +1 护盾",
    run: function (g, p, ctx) { p.shield += 1; return true; } },
  { id: 12, name: "提神洞察", hook: "event", text: "遇到负面事件时 +1 护盾",
    run: function (g, p, ctx) { p.shield += 1; return true; } }
];

// 触发角色技能，返回技能名（未触发返回空串）
function runSkill(hook, player, ctx) {
  var skill = null;
  for (var i = 0; i < CHAR_SKILLS.length; i += 1) {
    if (CHAR_SKILLS[i].id === player.characterId && CHAR_SKILLS[i].hook === hook) {
      skill = CHAR_SKILLS[i];
      break;
    }
  }
  if (!skill) {
    return "";
  }
  var fired = skill.run(state.game, player, ctx || {});
  return fired ? skill.name : "";
}

// ===== 环形地图参数（必须与 tools/generate_mcd_map.py 绘制公式完全一致）=====
// 地图画布 1536x936；格子沿椭圆轨道顺时针排列（1 在底部中央，15 在顶部）
var MAP_W = 1536, MAP_H = 936;
var MAP_CX = 765, MAP_CY = 540, MAP_RX = 565, MAP_RY = 300;

// 计算第 i 格（position 0-29）在地图容器中的百分比坐标
function ringCellPos(i) {
  var ang = (90 - i * (360 / 30)) * Math.PI / 180;
  return {
    left: (MAP_CX + MAP_RX * Math.cos(ang)) / MAP_W * 100,
    top: (MAP_CY + MAP_RY * Math.sin(ang)) / MAP_H * 100
  };
}

// ===== 30 格棋盘（与后端 engine.js 保持一致）=====
var BOARD = [
  { pos: 0, type: "start", icon: "🏁" }, { pos: 1, type: "rest", icon: "🌳" },
  { pos: 2, type: "cardSlot", icon: "🎁" }, { pos: 3, type: "shop", icon: "🏪" },
  { pos: 4, type: "battle", icon: "⚔️" }, { pos: 5, type: "event", icon: "🎪" },
  { pos: 6, type: "rest", icon: "🌴" }, { pos: 7, type: "shop", icon: "🏭" },
  { pos: 8, type: "battle", icon: "⚔️" }, { pos: 9, type: "cardSlot", icon: "🎁" },
  { pos: 10, type: "event", icon: "🎭" }, { pos: 11, type: "science", icon: "🥗" },
  { pos: 12, type: "shop", icon: "🍰" }, { pos: 13, type: "battle", icon: "🔥" },
  { pos: 14, type: "event", icon: "🎪" }, { pos: 15, type: "rest", icon: "🌳" },
  { pos: 16, type: "cardSlot", icon: "🎁" }, { pos: 17, type: "shop", icon: "🥤" },
  { pos: 18, type: "battle", icon: "🎯" }, { pos: 19, type: "event", icon: "🎬" },
  { pos: 20, type: "science", icon: "🥦" }, { pos: 21, type: "shop", icon: "🍦" },
  { pos: 22, type: "battle", icon: "⚔️" }, { pos: 23, type: "cardSlot", icon: "🎁" },
  { pos: 24, type: "event", icon: "🎉" }, { pos: 25, type: "rest", icon: "🌿" },
  { pos: 26, type: "shop", icon: "🛍️" }, { pos: 27, type: "battle", icon: "👑" },
  { pos: 28, type: "cardSlot", icon: "💎" }, { pos: 29, type: "event", icon: "🎇" }
];

var CELL_NAMES = {
  start: "金色拱门", rest: "休息区", cardSlot: "卡牌驿站",
  shop: "欢乐商店", battle: "欢乐挑战", event: "活动舞台", science: "营养科普站"
};

var VICTORY_LABEL = {
  fame: "欢乐值最高", collection: "卡牌收藏最多",
  reach: "率先抵达终点", shield: "欢乐护盾最多"
};

// ===== 事件卡 =====
// 初始为内置兜底卡组，游戏开始时由后端 /api/events 拉取麦当劳真实活动覆盖
var EVENTS = [
  { id: 1, title: "限时新品上架", type: "联动", desc: "全体欢乐值 +1", effect: { target: "all", changes: { fame: 1 } } },
  { id: 2, title: "麦麦省发券", type: "福利", desc: "欢乐值 +2，下次移动 +1", effect: { target: "current", changes: { fame: 2 } } },
  { id: 3, title: "联名活动开启", type: "联动", desc: "获得一张 T1 角色卡", effect: { target: "current", changes: {}, drawTier: "T1" } },
  { id: 4, title: "甜品站排队", type: "趣味", desc: "欢乐值 -1，护盾 +1", effect: { target: "current", changes: { fame: -1, shield: 1 } } },
  { id: 5, title: "儿童乐园开放日", type: "乐园", desc: "全体欢乐值 +1", effect: { target: "all", changes: { fame: 1 } } },
  { id: 6, title: "门店活动日", type: "门店", desc: "欢乐值 +2", effect: { target: "current", changes: { fame: 2 } } },
  { id: 7, title: "汉堡出炉", type: "料理", desc: "全体欢乐值 +1", effect: { target: "all", changes: { fame: 1 } } },
  { id: 8, title: "汽水续杯", type: "饮料", desc: "欢乐值 +1", effect: { target: "current", changes: { fame: 1 } } },
  { id: 9, title: "金色拱门巡游", type: "地图", desc: "全体欢乐值 +1", effect: { target: "all", changes: { fame: 1 } } },
  { id: 10, title: "甜品柜补货", type: "料理", desc: "欢乐值 +1", effect: { target: "current", changes: { fame: 1 } } },
  { id: 11, title: "营养小课堂", type: "科普", desc: "护盾 +2", effect: { target: "current", changes: { shield: 2 } } },
  { id: 12, title: "欢乐加倍日", type: "道具", desc: "全体欢乐值 +2", effect: { target: "all", changes: { fame: 2 } } }
];

// 从后端拉取麦当劳真实活动，覆盖内置事件卡组
// 带 5 秒超时保护：网络异常时降级为内置卡组，不阻塞开局
function loadRealEvents(callback) {
  var settled = false;
  // 保证回调只执行一次
  function done(ok, reason) {
    if (settled) { return; }
    settled = true;
    if (!ok) {
      console.warn("[events] 沿用内置卡组，原因:", reason);
    }
    callback(null, ok);
  }

  var timer = setTimeout(function () {
    done(false, "请求超时（5s）");
  }, 5000);

  fetch("/api/events")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.success || !data.events || !data.events.length) {
        clearTimeout(timer);
        done(false, "未获取到真实活动");
        return;
      }
      // 覆盖事件卡组：真实活动卡 + 内置特色卡（后端已合并去重）
      EVENTS = data.events.map(function (ev, idx) {
        // 真实活动卡有 gameTitle（规则名），内置特色卡只有 title
        var isReal = ev.source === "campaign-calendar" ||
          (Boolean(ev.gameTitle) && ev.gameTitle !== ev.title);
        return {
          id: idx + 1,
          title: ev.gameTitle || ev.title,
          // 真实活动标题作为副标题展示，增强可信度
          realTitle: isReal ? ev.title : "",
          type: isReal ? (ev.isActive ? "进行中" : (ev.isPast ? "往期" : "预告")) : "",
          desc: ev.intro || ev.desc || "乐园随机事件",
          img: isReal ? (ev.img || "") : "",
          date: ev.date || "",
          kind: ev.kind || "good",
          rarity: ev.rarity || "common",
          isReal: isReal,
          effect: ev.effect
        };
      });
      clearTimeout(timer);
      console.log("[events] 已载入 " + EVENTS.length + " 张事件卡（真实活动 " +
        (data.realCount || 0) + " + 内置 " + (data.builtinCount || 0) + "）");
      done(true, "");
    }, function (err) {
      clearTimeout(timer);
      console.error("[events] 真实活动拉取失败:", err.message);
      done(false, err.message);
    });
}

// ===== DOM 快捷引用 =====
function $(id) {
  return document.getElementById(id);
}

// ===== History API 路由 =====
// 使用 pushState 记录路由，对局状态存 sessionStorage，
// 用户按浏览器前进/后退可恢复上一局面
function navigate(page, replaceMode) {
  state.page = page;
  var url = page === "home" ? "/" : "/" + page;
  // 用 Promise 双通道捕获 History API 异常，不用 try/catch
  var task = Promise.resolve().then(function () {
    if (replaceMode) {
      history.replaceState({ page: page }, "", url);
    } else {
      history.pushState({ page: page }, "", url);
    }
  });
  task.then(function () {
    renderPage(page);
  }, function (err) {
    // 调试信息：定位 History API 失败原因（常见于跨域或 file:// 协议）
    console.error("[router] pushState 失败:", err.message);
    renderPage(page);
  });
}

// 监听浏览器前进/后退
window.addEventListener("popstate", function (e) {
  var page = (e.state && e.state.page) || "home";
  state.page = page;
  // 从对局页返回时，若有存档则恢复
  if (page === "game" && !state.game) {
    restoreGame(function (has) {
      if (!has) {
        state.page = "home";
        renderPage("home");
        return;
      }
      // 存档恢复是异步的，renderPage 执行时 state.game 还是空的，这里补一次重绘
      renderGame();
    });
  }
  renderPage(page);
});

// 页面渲染分发
function renderPage(page) {
  var pages = ["home", "select", "game", "result", "prize"];
  for (var i = 0; i < pages.length; i++) {
    var el = $("page-" + pages[i]);
    if (!el) {
      console.error("[render] 找不到页面节点:", pages[i]);
      continue;
    }
    if (pages[i] === page) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
  window.scrollTo(0, 0);

  // 内容渲染分发：路由只负责「显示哪一页」，具体填充交给各页渲染函数。
  // 不加这段会导致「应用内跳转」或「浏览器前进/后退」进入页面时内容为空
  // （历史上 navigate("game") 后棋盘 0 格就是这个原因）。
  // 这三个渲染函数都是幂等的，重复调用只会重绘，无副作用。
  if (page === "select") {
    renderSelect();
  } else if (page === "game") {
    if (state.game) {
      renderGame();
    }
  } else if (page === "prize") {
    renderPrize();
  }
  // result 页内容由 showResult() 在跳转前填充，此处无需重复渲染
}

// ===== 对局存档（配合 History API 前进后退）=====
var SAVE_KEY = "mcd_arcade_game";

// 保存对局到 sessionStorage（fire-and-forget：调用方无需等待，失败仅记日志）
// 注意：所有调用点均为无参调用，此函数不能声明 callback 参数
function saveGame() {
  var task = Promise.resolve().then(function () {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify(state.game));
  });
  task.then(null, function (err) {
    console.error("[save] 对局存档失败:", err.message);
  });
}

function restoreGame(callback) {
  var readTask = Promise.resolve().then(function () {
    return sessionStorage.getItem(SAVE_KEY);
  });
  readTask.then(function (raw) {
    if (!raw) {
      callback(null, false);
      return;
    }
    var parseTask = Promise.resolve().then(function () {
      return JSON.parse(raw);
    });
    parseTask.then(function (parsed) {
      state.game = parsed;
      callback(null, true);
    }, function (err) {
      console.error("[restore] 存档解析失败:", err.message);
      callback(err, false);
    });
  }, function (err) {
    console.error("[restore] 读取存档失败:", err.message);
    callback(err, false);
  });
}

function clearSave() {
  var task = Promise.resolve().then(function () {
    sessionStorage.removeItem(SAVE_KEY);
  });
  task.then(null, function (err) {
    console.error("[clearSave] 清除存档失败:", err.message);
  });
}

// ===== 对局创建 =====
function startGame() {
  var players = [];
  for (var i = 0; i < state.playerCount; i += 1) {
    var cid = state.selectedChars[i];
    var c = getCharacter(cid);
    if (!c) {
      // 调试信息：定位选卡数据缺失
      console.error("[startGame] 第" + (i + 1) + "位玩家卡牌缺失, charId=" + cid);
      showModal("选卡数据异常", "<p>第 " + (i + 1) + " 位玩家的卡牌数据读取失败</p><p style='margin-top:8px;color:#8B5A2B;font-size:13px'>请返回重新选择卡牌</p>", "返回选卡", function () {
        navigate("select");
      });
      return;
    }
    players.push({
      id: i + 1, name: "玩家" + (i + 1), characterId: c.id,
      characterName: c.name, emoji: c.emoji,
      position: 0, fame: 0, shield: 0, cards: [c.id], loops: 0
    });
  }

  state.game = {
    playerCount: state.playerCount,
    victoryType: state.victoryType,
    totalRounds: state.totalRounds,
    currentPlayerIndex: 0,
    round: 1,
    status: "playing",
    players: players,
    logs: [{ content: "麦麦奇幻乐园开园！目标：" + VICTORY_LABEL[state.victoryType], time: nowText() }],
    lastRoll: 0,
    history: []
  };

  addLog("乐园开园，" + state.playerCount + " 位见习小厨师就位");
  soundPlay("start");
  saveGame();
  navigate("game");
}

function getCharacter(id) {
  for (var i = 0; i < CHARACTERS.length; i += 1) {
    if (CHARACTERS[i].id === id) {
      return CHARACTERS[i];
    }
  }
  return null;
}

function nowText() {
  var d = new Date();
  var pad = function (n) {
    return n < 10 ? "0" + n : "" + n;
  };
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function addLog(content) {
  state.game.logs.push({ content: content, time: nowText() });
  if (state.game.logs.length > 40) {
    state.game.logs.splice(0, state.game.logs.length - 40);
  }
}

// ===== 数值应用 =====
function applyChanges(player, changes) {
  var keys = Object.keys(changes || {});
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    var delta = Number(changes[key] || 0);
    if (!delta) {
      continue;
    }
    var before = Number(player[key] || 0);
    player[key] = Math.max(0, before + delta);
  }
}

// ===== 掷骰子 =====
function doRoll() {
  if (state.busy || !state.game || state.game.status !== "playing") {
    return;
  }
  state.busy = true;

  var g = state.game;
  var player = g.players[g.currentPlayerIndex];

  // 骰子滚动音效
  soundPlay("roll");

  // 记录历史快照，支撑回退
  pushHistory();

  var dice = Math.floor(Math.random() * 6) + 1;
  g.lastRoll = dice;
  showDice(dice);

  // 角色技能介入掷骰：可改写实际步数，也可直接给欢乐值
  var rollCtx = { dice: dice, steps: dice };
  var rollSkill = runSkill("roll", player, rollCtx);

  var rawNext = player.position + rollCtx.steps;
  var next = rawNext % 30;
  var loops = Math.floor(rawNext / 30);
  player.position = next;
  player.loops += loops;

  var rollLog = player.name + " 掷出 " + dice + " 点";
  if (rollCtx.steps !== dice) {
    rollLog += "（技能加成实走 " + rollCtx.steps + " 步）";
  }
  addLog(rollLog + "，移动到第 " + next + " 格");
  if (rollSkill) {
    addLog("✨ " + player.characterName + "【" + rollSkill + "】触发");
  }

  if (loops > 0) {
    var reward = 3 * loops;
    player.fame += reward;
    addLog(player.name + " 完成 " + loops + " 圈，欢乐值 +" + reward);
    var loopSkill = runSkill("loop", player, { loops: loops });
    if (loopSkill) {
      addLog("✨ " + player.characterName + "【" + loopSkill + "】触发");
    }
  }

  saveGame();
  renderGame();

  // 延迟展示结算，让移动动画有感知
  setTimeout(function () {
    resolveCell();
  }, 420);
}

// 显示骰子动画
function showDice(num) {
  var el = $("dice");
  el.textContent = num;
  el.classList.remove("rolling");
  void el.offsetWidth;
  el.classList.add("rolling");
}

// ===== 格子结算 =====
function resolveCell() {
  var g = state.game;
  var player = g.players[g.currentPlayerIndex];
  var cell = BOARD[player.position];
  var name = CELL_NAMES[cell.type];

  if (cell.type === "start") {
    applyChanges(player, { fame: 1 });
    addLog(player.name + " 经过金色拱门，欢乐值 +1");
    afterCell();
    return;
  }

  if (cell.type === "rest") {
    applyChanges(player, { shield: 1 });
    addLog(player.name + " 在" + name + " 休息，护盾 +1");
    afterCell();
    return;
  }

  if (cell.type === "cardSlot") {
    var picked = drawCardFor(player, "T2");
    addLog(player.name + " 获得新卡牌【" + picked.name + "】");
    var extraMsg = "";
    var extraSkill = runSkill("draw", player, { tier: "T2" });
    if (extraSkill) {
      var picked2 = drawCardFor(player, "T2");
      addLog("✨ " + player.characterName + "【" + extraSkill + "】额外获得【" + picked2.name + "】");
      extraMsg = '<div style="font-size:13px;color:#E62E1E;margin-top:6px">✨ ' + extraSkill + "：额外获得 " + picked2.name + "</div>";
    }
    showModal("获得卡牌", "<div style='text-align:center'><div style='font-size:52px'>" + picked.emoji + "</div><div style='font-weight:700;margin-top:6px'>" + picked.name + "</div><div style='font-size:13px;color:#8B5A2B;margin-top:4px'>" + picked.skillDesc + "</div>" + extraMsg + "</div>", "收下卡牌", function () { afterCell(); });
    return;
  }

  if (cell.type === "battle") {
    var c = getCharacter(player.characterId);
    // 角色技能可提升挑战力量
    var battleCtx = { power: c.force + g.lastRoll };
    var battleSkill = runSkill("battle", player, battleCtx);
    var power = battleCtx.power;
    var difficulty = 60 + Math.floor(Math.random() * 40);
    var win = power >= difficulty;
    var skillLine = battleSkill
      ? '<p style="font-size:12px;color:#E62E1E;margin-top:4px">✨ ' + battleSkill + " 力量 +2</p>"
      : "";
    if (win) {
      applyChanges(player, { fame: 2, shield: 1 });
      addLog(player.name + " 挑战胜利（" + power + " vs " + difficulty + "），欢乐 +2");
      showModal("挑战胜利！", "<div style='text-align:center'><div style='font-size:46px'>🏆</div>" +
        '<p style="margin-top:10px">力量 <strong>' + power + "</strong> vs 挑战难度 <strong>" + difficulty + "</strong></p>" +
        skillLine +
        '<p style="color:#E62E1E;font-weight:700">欢乐值 +2，护盾 +1</p></div>', "继续", afterCell);
    } else {
      applyChanges(player, { fame: -1 });
      addLog(player.name + " 挑战失败（" + power + " vs " + difficulty + "），欢乐 -1");
      showModal("挑战失败", "<div style='text-align:center'><div style='font-size:46px'>💫</div>" +
        '<p style="margin-top:10px">力量 <strong>' + power + "</strong> vs 挑战难度 <strong>" + difficulty + "</strong></p>" +
        skillLine +
        '<p style="color:#8B5A2B">欢乐值 -1，再接再厉</p></div>', "继续", afterCell);
    }
    return;
  }

  // 商店：真正可以消费欢乐值（早期版本只是占位提示）
  if (cell.type === "shop") {
    addLog(player.name + " 进入" + name);
    showShop(player);
    return;
  }

  if (cell.type === "event") {
    applyEvent(player, pickRandomEvent());
    return;
  }

  // 科普站：基于 MCP 真实营养数据出题，答对加欢乐值
  if (cell.type === "science") {
    showNutritionQuiz(player);
    return;
  }

  afterCell();
}

// ===== 欢乐商店：真正消费欢乐值换资源 =====
var SHOP_ITEMS = [
  { key: "card", cost: 3, label: "🍔 抽一张 T2 伙伴卡" },
  { key: "shield", cost: 2, label: "🛡 购买 1 点欢乐护盾" },
  { key: "boost", cost: 2, label: "🥤 打包外带：前进 3 格" }
];

function showShop(player) {
  var html = '<p>当前欢乐值：<strong style="color:#E62E1E">' + player.fame + "</strong></p>";
  html += '<div class="shop-list">';
  for (var i = 0; i < SHOP_ITEMS.length; i += 1) {
    var item = SHOP_ITEMS[i];
    var afford = player.fame >= item.cost;
    html += '<button class="shop-item' + (afford ? "" : " disabled") + '" data-shop="' + item.key + '"' +
      (afford ? "" : " disabled") + ">" + item.label +
      '<span class="shop-cost">' + item.cost + " 欢乐</span></button>";
  }
  html += "</div>";
  html += '<p style="font-size:12px;color:#8B5A2B;margin-top:8px">欢乐值不足时按钮会置灰，也可以空手离开</p>';

  showModal("🏪 欢乐商店", html, "离开商店", function () { afterCell(); });

  // showModal 会重建 body，因此按钮监听必须在渲染之后绑定
  var btns = document.querySelectorAll(".shop-item");
  for (var j = 0; j < btns.length; j += 1) {
    btns[j].addEventListener("click", function (e) {
      buyShopItem(player, e.currentTarget.getAttribute("data-shop"));
    });
  }
}

function buyShopItem(player, key) {
  var cost = 0;
  var logText = "";

  if (key === "card") {
    cost = 3;
    if (player.fame < cost) { return; }
    player.fame -= cost;
    var card = drawCardFor(player, "T2");
    logText = player.name + " 花 " + cost + " 欢乐值购入伙伴卡【" + card.name + "】";
  } else if (key === "shield") {
    cost = 2;
    if (player.fame < cost) { return; }
    player.fame -= cost;
    player.shield += 1;
    logText = player.name + " 花 " + cost + " 欢乐值购入 1 点护盾";
  } else if (key === "boost") {
    cost = 2;
    if (player.fame < cost) { return; }
    player.fame -= cost;
    var raw = player.position + 3;
    player.position = raw % BOARD.length;
    if (raw >= BOARD.length) {
      player.loops += Math.floor(raw / BOARD.length);
    }
    logText = player.name + " 花 " + cost + " 欢乐值打包外带，前进 3 格至第 " + player.position + " 格";
  } else {
    return;
  }

  addLog(logText);
  soundPlay("buy");
  saveGame();
  renderGame();
  // 余额变化后重绘商店，让按钮的可用状态同步
  showShop(player);
}

// ===== 营养科普问答（数据来源：MCP list-nutrition-foods）=====
function showNutritionQuiz(player) {
  var modalHtml = "<div style='text-align:center;padding:16px'><div style='font-size:32px'>🥗</div>" +
    "<p style='margin-top:10px;color:#8B5A2B'>题目加载中...</p></div>";
  showModal("营养小课堂", modalHtml, null, null);

  fetch("/api/nutrition-question?player=" + encodeURIComponent(player.name))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.success || !data.question) {
        console.warn("[quiz] 题目获取失败，跳过科普环节");
        $("modal-title").textContent = "营养小课堂";
        $("modal-body").innerHTML = "<div style='text-align:center;padding:16px'><div style='font-size:32px'>🥗</div><p style='margin-top:10px'>题目暂不可用，继续闯关吧</p></div>";
        $("modal-actions").innerHTML = "";
        var skipBtn = document.createElement("button");
        skipBtn.className = "btn-modal-confirm";
        skipBtn.textContent = "继续";
        skipBtn.addEventListener("click", function () {
          hideModal();
          afterCell();
        });
        $("modal-actions").appendChild(skipBtn);
        return;
      }

      renderQuiz(data, player);
    }, function (err) {
      console.error("[quiz] 请求失败:", err.message);
      $("modal-body").innerHTML = "<p>题目加载失败，继续闯关吧</p>";
    });
}

// 渲染营养题与选项
function renderQuiz(data, player) {
  var html = '<div class="quiz-head">' +
    '<div class="quiz-player">' + data.playerName + " 的营养小课堂</div>" +
    '<div class="quiz-question">' + data.question + "</div>" +
    '<div class="quiz-tip">数据来源：麦当劳官方营养成分表</div></div>';

  html += '<div class="quiz-options" id="quiz-options">';
  for (var i = 0; i < data.options.length; i += 1) {
    html += '<div class="quiz-option" data-idx="' + i + '">' +
      '<span class="opt-name">' + data.options[i].name + "</span>" +
      '<span class="opt-val">' + data.optionValues[i] + data.unit + "</span>" +
      "</div>";
  }
  html += "</div>";

  $("modal-body").innerHTML = html;
  $("modal-actions").innerHTML = "";

  var opts = document.querySelectorAll(".quiz-option");
  for (var j = 0; j < opts.length; j += 1) {
    opts[j].addEventListener("click", function (e) {
      var idx = Number(e.currentTarget.getAttribute("data-idx"));
      handleQuizAnswer(idx, data, player);
    });
  }
}

// 处理答题
function handleQuizAnswer(chosenIdx, data, player) {
  // 锁定所有选项，防止连点
  var opts = document.querySelectorAll(".quiz-option");
  for (var i = 0; i < opts.length; i += 1) {
    opts[i].style.pointerEvents = "none";
    if (i === data.answerIndex) {
      opts[i].classList.add("quiz-right");
    } else if (i === chosenIdx) {
      opts[i].classList.add("quiz-wrong");
    }
  }

  var correct = chosenIdx === data.answerIndex;
  var reward = 0;
  soundPlay(correct ? "quizRight" : "quizWrong");
  if (correct) {
    reward = 2;
    applyChanges(player, { fame: reward });
    addLog(player.name + " 答对营养题【" + data.answerName + "】，欢乐值 +" + reward);
  } else {
    applyChanges(player, { shield: 1 });
    addLog(player.name + " 营养题答错，正确答案是【" + data.answerName + "】，获得护盾 1");
  }
  saveGame();
  renderGame();

  $("modal-title").textContent = correct ? "🎉 答对啦！" : "💡 再想想";
  $("modal-body").innerHTML = "<div style='text-align:center;padding:12px'>" +
    "<div style='font-size:36px'>" + (correct ? "🏆" : "🥕") + "</div>" +
    "<p style='margin-top:10px;font-size:14px'>正确答案：<strong>" + data.answerName + "</strong></p>" +
    "<p style='margin-top:4px;color:#8B5A2B;font-size:13px'>" + data.metric + " " + data.answerValue + data.unit + "</p>" +
    "<p style='margin-top:10px;color:#E62E1E;font-weight:700'>" +
    (correct ? "欢乐值 +" + reward : "获得欢乐护盾 +1") + "</p></div>";

  $("modal-actions").innerHTML = "";
  var nextBtn = document.createElement("button");
  nextBtn.className = "btn-modal-confirm";
  nextBtn.textContent = "继续闯关";
  nextBtn.addEventListener("click", function () {
    hideModal();
    afterCell();
  });
  $("modal-actions").appendChild(nextBtn);
}

// ===== 事件结算 =====
// 效果字段与 game/event-pool.js 保持一致：
// changes / move / teleport / extraRoll / steal / convert / drawTier /
// gamble / swapWithLeader / giftOpponent / skipTurn / double / discardOne

// 从当前位置向前找最近的指定类型格子（传送类事件）
function findNearestCell(fromPos, type) {
  for (var step = 1; step <= BOARD.length; step += 1) {
    var idx = (fromPos + step) % BOARD.length;
    if (BOARD[idx].type === type) {
      return idx;
    }
  }
  return -1;
}

// 找欢乐值最高的对手（夺取 / 换位类事件）
function findLeader(excludeId) {
  var g = state.game;
  var best = null;
  for (var i = 0; i < g.players.length; i += 1) {
    var p = g.players[i];
    if (p.id === excludeId) {
      continue;
    }
    if (!best || p.fame > best.fame) {
      best = p;
    }
  }
  return best;
}

// 按稀有度权重抽取事件卡（史诗更罕见），与 game/event-pool.js 的权重一致
var RARITY_WEIGHT = { common: 6, rare: 3, epic: 1 };

function pickRandomEvent() {
  var total = 0;
  var i;
  for (i = 0; i < EVENTS.length; i += 1) {
    total += RARITY_WEIGHT[EVENTS[i].rarity] || RARITY_WEIGHT.common;
  }
  var ticket = Math.random() * total;
  for (i = 0; i < EVENTS.length; i += 1) {
    ticket -= RARITY_WEIGHT[EVENTS[i].rarity] || RARITY_WEIGHT.common;
    if (ticket <= 0) {
      return EVENTS[i];
    }
  }
  return EVENTS[EVENTS.length - 1];
}

// 抽取一张指定稀有度的卡并加入玩家手牌
function drawCardFor(player, tier) {
  var pool = CHARACTERS.filter(function (c) { return c.tier === tier; });
  if (!pool.length) {
    pool = CHARACTERS;
  }
  var picked = pool[Math.floor(Math.random() * pool.length)];
  player.cards.push(picked.id);
  soundPlay("card");
  return picked;
}

function applyEvent(player, ev) {
  var g = state.game;
  var effect = ev.effect || {};
  var lines = [];
  var isNegative = false;

  // 1) 基础数值增减
  var ch = effect.changes || {};
  if (effect.target === "all") {
    for (var a = 0; a < g.players.length; a += 1) {
      applyChanges(g.players[a], ch);
    }
    var allParts = [];
    if (ch.fame) { allParts.push("欢乐值 " + signText(ch.fame)); }
    if (ch.shield) { allParts.push("护盾 " + signText(ch.shield)); }
    lines.push("全体 " + (allParts.join("，") || "无变化"));
    if (ch.fame < 0 || ch.shield < 0) { isNegative = true; }
  } else {
    if (ch.fame) {
      applyChanges(player, { fame: ch.fame });
      lines.push("欢乐值 " + signText(ch.fame));
      if (ch.fame < 0) { isNegative = true; }
    }
    if (ch.shield) {
      applyChanges(player, { shield: ch.shield });
      lines.push("护盾 " + signText(ch.shield));
      if (ch.shield < 0) { isNegative = true; }
    }
  }

  // 2) 数值翻倍
  if (effect.double && effect.double.key) {
    var dk = effect.double.key;
    var minV = Number(effect.double.min || 2);
    player[dk] = Math.max(minV, Number(player[dk] || 0) * 2);
    lines.push((dk === "fame" ? "欢乐值" : "护盾") + "翻倍至 " + player[dk]);
  }

  // 3) 位移
  if (effect.move) {
    var raw = player.position + Number(effect.move);
    // 后退不能小于 0，避免出现负位置
    var next = raw < 0 ? 0 : raw % BOARD.length;
    player.position = next;
    if (raw >= BOARD.length) {
      player.loops += Math.floor(raw / BOARD.length);
    }
    lines.push(effect.move > 0 ? "前进 " + effect.move + " 格 → 第 " + next + " 格" : "后退 " + Math.abs(effect.move) + " 格 → 第 " + next + " 格");
    if (effect.move < 0) { isNegative = true; }
  }

  // 4) 传送
  if (effect.teleport) {
    var dest = findNearestCell(player.position, effect.teleport);
    if (dest !== -1 && dest !== player.position) {
      player.position = dest;
      var tpName = { cardSlot: "卡牌驿站", shop: "商店", start: "起点", science: "营养科普站", battle: "挑战格" };
      lines.push("传送到" + (tpName[effect.teleport] || effect.teleport) + "（第 " + dest + " 格）");
      if (effect.teleport === "cardSlot") {
        var tpCard = drawCardFor(player, "T2");
        lines.push("顺手获得【" + tpCard.name + "】");
      }
    }
  }

  // 5) 夺取
  if (effect.steal) {
    var leader = findLeader(player.id);
    if (leader && leader.fame > 0) {
      var amount = Math.min(Number(effect.steal), leader.fame);
      leader.fame -= amount;
      player.fame += amount;
      lines.push("从 " + leader.name + " 夺取 " + amount + " 点欢乐");
    } else {
      lines.push("无人可夺取，掠夺落空");
    }
  }

  // 6) 属性转换
  if (effect.convert) {
    var rate = Number(effect.convert.rate || 2);
    if (player.shield > 0) {
      player.shield -= 1;
      player.fame += rate;
      lines.push("1 护盾 → " + rate + " 欢乐");
    } else {
      lines.push("没有护盾可兑换");
    }
  }

  // 7) 与领先者换位
  if (effect.swapWithLeader) {
    var l2 = findLeader(player.id);
    if (l2) {
      var tmp = l2.position;
      l2.position = player.position;
      player.position = tmp;
      lines.push("与 " + l2.name + " 交换位置（第 " + player.position + " 格）");
    }
  }

  // 8) 送礼给对手
  if (effect.giftOpponent) {
    var others = g.players.filter(function (p) { return p.id !== player.id; });
    if (others.length) {
      var lucky = others[Math.floor(Math.random() * others.length)];
      lucky.fame += Number(effect.giftOpponent);
      lines.push("送给 " + lucky.name + " " + effect.giftOpponent + " 点欢乐");
    }
  }

  // 9) 赌博
  if (effect.gamble) {
    var win = Math.random() < 0.5;
    applyChanges(player, win ? (effect.gamble.win || {}) : (effect.gamble.lose || {}));
    lines.push(win ? "转盘停在 🎉 幸运区" : "转盘停在 💧 安慰区");
    if (!win) { isNegative = true; }
  }

  // 10) 额外掷骰 / 跳过回合
  if (effect.extraRoll) {
    g.extraRollFor = player.id;
    lines.push("获得额外掷骰机会");
  }
  if (effect.skipTurn) {
    g.skipNextFor = player.id;
    lines.push("下一回合将被跳过");
    isNegative = true;
  }

  // 11) 抽卡（含技能加成）
  if (effect.drawTier) {
    var card = drawCardFor(player, effect.drawTier);
    lines.push("获得【" + card.name + "】");
    var extra = runSkill("draw", player, { tier: effect.drawTier });
    if (extra) {
      var card2 = drawCardFor(player, effect.drawTier);
      lines.push("技能触发再获【" + card2.name + "】");
    }
  }

  // 12) 弃一张旧卡
  if (effect.discardOne && player.cards.length > 1) {
    player.cards.splice(1, 1);
    lines.push("弃掉 1 张旧卡");
  }

  // 13) 角色技能：负面事件抵消 / 减益补偿
  if (isNegative) {
    var guard = runSkill("guard", player, {});
    if (guard) {
      applyChanges(player, { fame: Math.abs(Number(ch.fame || 0)) });
      lines.push("🛡 " + guard + " 抵消了负面效果");
    } else {
      var comfort = runSkill("event", player, {});
      if (comfort) {
        lines.push(comfort);
      }
    }
  }

  var detail = lines.length ? lines.join("，") : "无事发生";

  // 事件音效：按增益 / 减益 / 中性区分
  if (ev.kind === "bad") {
    soundPlay("bad");
  } else if (ev.kind === "good") {
    soundPlay("good");
  } else {
    soundPlay("event");
  }

  addLog("【" + ev.title + "】" + player.name + "：" + detail);
  saveGame();
  renderGame();

  // 真实活动图与原标题（增强可信度）
  var imgHtml = ev.img ? '<img class="event-img" src="' + ev.img + '" alt="' + (ev.realTitle || ev.title) + '" onerror="this.style.display=\'none\'">' : "";
  var realTitleHtml = ev.realTitle
    ? '<div class="event-real-title">🎫 ' + ev.realTitle + "</div>"
    : "";
  var dateHtml = ev.date ? '<div class="event-date">' + ev.date + "</div>" : "";
  var kindLabel = { good: "增益", bad: "减益", interact: "互动" };
  var kindHtml = ev.kind
    ? '<span class="event-kind ' + ev.kind + '">' + (kindLabel[ev.kind] || ev.kind) + "</span>"
    : "";

  showModal("🎪 " + ev.title, '<div style="text-align:center">' + imgHtml + "</div>" +
    realTitleHtml + dateHtml +
    '<div style="font-size:13px;color:#8B5A2B">' + kindHtml + (ev.type ? ev.type + "活动" : "") + "</div>" +
    '<p style="margin-top:10px;font-size:15px;font-weight:600;color:#E62E1E">' + detail + "</p>" +
    (ev.desc ? '<p style="margin-top:6px;font-size:12px;color:#8B5A2B">' + ev.desc + "</p>" : ""),
    "确定", afterCell);
}

function signText(n) {
  if (!n) {
    return "";
  }
  return n > 0 ? "+" + n : String(n);
}

// ===== 回合推进 =====
function afterCell() {
  var g = state.game;
  // 胜利判定
  var result = checkVictory();
  if (result) {
    g.status = "finished";
    g.result = result;
    addLog("对局结束，" + result.reason);
    clearSave();
    setTimeout(function () { showResult(result); }, 200);
    return;
  }

  // 额外掷骰：同一玩家继续行动，不推进回合
  if (g.extraRollFor) {
    var exIdx = -1;
    for (var i = 0; i < g.players.length; i += 1) {
      if (g.players[i].id === g.extraRollFor) {
        exIdx = i;
        break;
      }
    }
    g.extraRollFor = 0;
    if (exIdx !== -1) {
      g.currentPlayerIndex = exIdx;
      addLog("🎲 " + g.players[exIdx].name + " 获得额外掷骰机会");
      state.busy = false;
      saveGame();
      renderGame();
      return;
    }
  }

  if (advanceTurn() === "finish") {
    return;
  }

  // 被事件标记跳过的玩家，本回合直接让位
  if (g.skipNextFor && g.players[g.currentPlayerIndex].id === g.skipNextFor) {
    addLog("⏭ " + g.players[g.currentPlayerIndex].name + " 本回合被事件跳过");
    g.skipNextFor = 0;
    if (advanceTurn() === "finish") {
      return;
    }
  }

  // 轮到新玩家：触发「回合开始」类技能
  var now = g.players[g.currentPlayerIndex];
  var turnSkill = runSkill("turn", now, {});
  if (turnSkill) {
    addLog("✨ " + now.characterName + "【" + turnSkill + "】触发，护盾 +1");
  }

  state.busy = false;
  saveGame();
  renderGame();
}

// 推进一位玩家；返回 "finish" 表示回合用尽已触发结算
function advanceTurn() {
  var g = state.game;
  g.currentPlayerIndex += 1;
  if (g.currentPlayerIndex >= g.playerCount) {
    g.currentPlayerIndex = 0;
    g.round += 1;
    if (g.round > g.totalRounds) {
      var finalResult = checkVictory(true);
      g.status = "finished";
      g.result = finalResult || { reason: "回合用尽，本局平局", winners: [] };
      addLog("对局结束，回合用尽");
      clearSave();
      setTimeout(function () { showResult(g.result); }, 200);
      return "finish";
    }
    addLog("第 " + g.round + " 回合开始");
  }
  return "ok";
}

function checkVictory(force) {
  var g = state.game;
  var players = g.players;

  // ===== 重要：累积型目标只在回合用尽时结算 =====
  // 「欢乐值最高 / 卡牌最多 / 护盾最多」是**终局比较型**目标，中途某人领先不算赢。
  // 早期版本这几个分支没有判断 force，导致第一个回合有人拿到 +2 欢乐值
  // 就直接判定胜利、10 回合的对局在第 1 回合就结束。
  if (g.victoryType === "fame") {
    if (!force) { return null; }
    var maxFame = 0;
    players.forEach(function (p) { if (p.fame > maxFame) { maxFame = p.fame; } });
    var w = players.filter(function (p) { return p.fame === maxFame; });
    return { reason: "欢乐值最高（" + maxFame + "）", winners: w };
  }

  if (g.victoryType === "collection") {
    if (!force) { return null; }
    var maxCards = 0;
    players.forEach(function (p) { if (p.cards.length > maxCards) { maxCards = p.cards.length; } });
    var w2 = players.filter(function (p) { return p.cards.length === maxCards; });
    return { reason: "卡牌收藏最多（" + maxCards + " 张）", winners: w2 };
  }

  if (g.victoryType === "reach") {
    // 「率先抵达终点」是**即时达成型**目标：中途有人跑完一圈即可立即获胜
    var maxLoop = 0;
    players.forEach(function (p) { if (p.loops > maxLoop) { maxLoop = p.loops; } });
    if (maxLoop > 0) {
      var w3 = players.filter(function (p) { return p.loops === maxLoop; });
      return { reason: "率先抵达终点（" + maxLoop + " 圈）", winners: w3 };
    }
    if (!force) { return null; }

    // 回合用尽仍无人跑完一圈：改按「累计行进里程」决出胜负。
    var boardLen = BOARD.length;
    var farthest = -1;
    players.forEach(function (p) {
      var dist = p.loops * boardLen + p.position;
      if (dist > farthest) { farthest = dist; }
    });
    var w5 = players.filter(function (p) {
      return p.loops * boardLen + p.position === farthest;
    });
    return { reason: "行进最远（累计 " + farthest + " 格）", winners: w5 };
  }

  // 护盾最多：同样属于终局比较型
  if (!force) { return null; }
  var maxShield = 0;
  players.forEach(function (p) { if (p.shield > maxShield) { maxShield = p.shield; } });
  var w4 = players.filter(function (p) { return p.shield === maxShield; });
  return { reason: "欢乐护盾最多（" + maxShield + "）", winners: w4 };
}

// ===== 历史回退 =====
function pushHistory() {
  var g = state.game;
  g.history.push({
    currentPlayerIndex: g.currentPlayerIndex,
    round: g.round,
    lastRoll: g.lastRoll,
    players: JSON.parse(JSON.stringify(g.players))
  });
  if (g.history.length > 30) {
    g.history.splice(0, g.history.length - 30);
  }
}

function undo() {
  var g = state.game;
  if (!g.history || !g.history.length) {
    showModal("提示", "<p>还没有可以回退的操作</p>", "知道了", null);
    return;
  }
  var snap = g.history.pop();
  g.currentPlayerIndex = snap.currentPlayerIndex;
  g.round = snap.round;
  g.lastRoll = snap.lastRoll;
  g.players = snap.players;
  state.busy = false;
  addLog("已回退上一步操作");
  saveGame();
  renderGame();
}

// ===== 渲染 =====
function renderGame() {
  var g = state.game;
  if (!g) {
    console.warn("[renderGame] 无对局数据");
    return;
  }

  var player = g.players[g.currentPlayerIndex];
  $("round-title").textContent = "第 " + g.round + " / " + g.totalRounds + " 回合";
  $("turn-banner").textContent = "当前：🎯 " + player.name + "（" + player.characterName + "）";
  $("btn-roll").disabled = g.status !== "playing";

  // 同屏轮流玩的关键：把当前玩家名字直接写在掷骰按钮上。
  // 几个孩子围着一台手机时，不用抬头找「轮到谁了」，看按钮就知道。
  $("btn-roll").textContent = player.emoji + " " + player.name + " 掷骰子";

  // 顶部预告下一位，让「交手机」这个动作有明确提示
  var nextIdx = g.currentPlayerIndex + 1;
  var nextPlayer = null;
  if (nextIdx >= g.playerCount && g.round < g.totalRounds) {
    nextPlayer = g.players[0];
  } else if (nextIdx < g.playerCount) {
    nextPlayer = g.players[nextIdx];
  }
  $("next-turn-tip").textContent = nextPlayer
    ? "下一位：" + nextPlayer.emoji + " " + nextPlayer.name
    : "本回合最后一个行动者";

  // 玩家条
  var html = "";
  for (var i = 0; i < g.players.length; i += 1) {
    var p = g.players[i];
    html += '<div class="player-chip' + (i === g.currentPlayerIndex ? " current" : "") + '">' +
      '<div class="p-emoji">' + p.emoji + "</div>" +
      '<div class="p-name">' + p.name + "</div>" +
      '<div class="p-fame">欢乐 ' + p.fame + "</div>" +
      '<div class="p-pos">第 ' + p.position + " 格</div>" +
      "</div>";
  }
  $("players").innerHTML = html;

  // 环形棋盘：格子按椭圆轨道叠在地图上，坐标与地图绘制公式一致
  var boardHtml = "";
  for (var j = 0; j < BOARD.length; j += 1) {
    var cell = BOARD[j];
    var p = ringCellPos(j);
    var marks = "";
    for (var m = 0; m < g.players.length; m += 1) {
      if (g.players[m].position === j) {
        marks += g.players[m].emoji;
      }
    }
    // 当前玩家所在格高亮
    var isCurrent = g.players[g.currentPlayerIndex].position === j;
    boardHtml += '<div class="ring-cell cell-type-' + cell.type +
      (marks ? " has-player" : "") + (isCurrent ? " current-cell" : "") +
      '" style="left:' + p.left.toFixed(2) + "%;top:" + p.top.toFixed(2) + '%">' +
      '<span class="cell-num">' + (j + 1) + "</span>" +
      (marks ? '<span class="cell-player-marks">' + marks + "</span>" : "") +
      "</div>";
  }
  $("board").innerHTML = boardHtml;

  // 日志
  var logHtml = "";
  for (var k = g.logs.length - 1; k >= 0; k -= 1) {
    logHtml += '<div class="log-line"><span class="log-time">' + g.logs[k].time + "</span>" + g.logs[k].content + "</div>";
  }
  $("log").innerHTML = logHtml;
}

function showResult(result) {
  var g = state.game;
  // 记录获胜者，奖品屋凭此展示「请选择你的奖励」横幅
  state.winners = (result && result.winners) ? result.winners : [];
  // 胜利小号旋律
  soundPlay(state.winners.length ? "victory" : "event");
  $("result-reason").textContent = result.reason;
  $("btn-to-prize").textContent = state.winners.length ? "🏆 前往奖品屋领奖" : "前往奖品屋";
  var html = "";
  for (var i = 0; i < g.players.length; i += 1) {
    var p = g.players[i];
    var isWinner = result.winners && result.winners.some(function (w) { return w.id === p.id; });
    html += '<div class="result-item' + (isWinner ? " winner" : "") + '">' +
      '<span class="r-emoji">' + p.emoji + "</span>" +
      '<div><div class="r-name">' + p.name + (isWinner ? " 🏆" : "") + "</div>" +
      '<div style="font-size:11px;color:#8B5A2B">' + p.characterName + " · 卡牌 " + p.cards.length + " 张</div></div>" +
      '<div class="r-stat">欢乐 ' + p.fame + "</div></div>";
  }
  $("result-list").innerHTML = html;
  navigate("result");
}

// ===== 选卡页 =====
function renderSelect() {
  var html = "";
  for (var i = 0; i < CHARACTERS.length; i += 1) {
    var c = CHARACTERS[i];
    var selected = state.selectedChars.indexOf(c.id) !== -1;
    html += '<div class="char-card' + (selected ? " selected" : "") + '" data-char="' + c.id + '">' +
      '<span class="tier-badge tier-' + c.tier + '">' + c.tier + "</span>" +
      '<img class="char-img" src="/assets/characters/char-' + c.id + '.jpg" alt="' + c.name + '" loading="lazy">' +
      '<div class="char-name">' + c.name + "</div>" +
      '<div class="char-role">' + (c.faction ? c.faction + " · " : "") + c.roleType + "</div>" +
      attrRow(c) +
      '<div class="char-skill"><strong>' + c.skillName + "</strong><br>" + c.skillDesc + "</div>" +
      '<div class="char-nutri">MCP 真实数据 ' + c.kcal + "kcal · 蛋白 " + c.protein + "g</div>" +
      "</div>";
  }
  $("card-grid").innerHTML = html;

  var cards = document.querySelectorAll(".char-card");
  for (var j = 0; j < cards.length; j += 1) {
    cards[j].addEventListener("click", function (e) {
      var id = Number(e.currentTarget.getAttribute("data-char"));
      toggleChar(id);
    });
  }
  updateSelectTip();
}

function attrRow(c) {
  var items = [
    { key: "force", label: "力量", val: c.force },
    { key: "strategy", label: "策略", val: c.strategy },
    { key: "fame", label: "欢乐", val: c.fame },
    { key: "command", label: "统率", val: c.command }
  ];
  var html = '<div class="attr-row">';
  for (var i = 0; i < items.length; i += 1) {
    var it = items[i];
    // 属性条：名称标签 + 进度条 + 数值（标签此前漏渲染，卡片看不出哪项是哪维属性）
    html += '<div class="attr-item"><div class="attr-label">' + it.label + "</div>" +
      '<div class="attr-bar"><div class="attr-fill ' + it.key + '" style="width:' + it.val + '%"></div></div>' +
      '<div class="attr-val">' + it.val + "</div></div>";
  }
  return html + "</div>";
}

function toggleChar(id) {
  var idx = state.selectedChars.indexOf(id);
  if (idx !== -1) {
    state.selectedChars.splice(idx, 1);
    soundPlay("deselect");
  } else {
    if (state.selectedChars.length >= state.playerCount) {
      showModal("选卡已满", "<p>每人只能选择一张餐品伙伴卡</p>", "知道了", null);
      return;
    }
    state.selectedChars.push(id);
    soundPlay("select");
  }
  renderSelect();
}

function updateSelectTip() {
  var need = state.playerCount;
  var got = state.selectedChars.length;
  var tip = $("select-tip");
  var btn = $("btn-start");

  tip.textContent = "已选 " + got + " / " + need;
  tip.className = got === need ? "tip-ok" : "tip-warn";

  // 选满才允许开始，未选满时给出明确提示而非静默禁用
  if (got === need) {
    btn.disabled = false;
    btn.textContent = "开始游戏";
  } else {
    btn.disabled = true;
    btn.textContent = "还需选 " + (need - got) + " 位";
  }
}

// ===== 我的账号（BYOT 本地只读） =====
// 设计原则：用户 Token 只存本机 sessionStorage，每次请求经 X-MCD-TOKEN 头
// 传给本地后端转发麦当劳官方接口；服务端不落库、日志不记录。
// 下单/兑换类工具始终被服务端硬拦截，真实兑换跳转官方渠道完成。
var BYOT_KEY = "mcd_byot_token";

function getAccountToken() {
  return sessionStorage.getItem(BYOT_KEY) || "";
}

function setAccountToken(token) {
  if (token) {
    sessionStorage.setItem(BYOT_KEY, token);
  } else {
    sessionStorage.removeItem(BYOT_KEY);
  }
}

// MCP 代理请求封装：自动附加 BYOT 头（如已绑定）
function mcpFetch(toolName, args, callback) {
  var headers = { "Content-Type": "application/json" };
  var token = getAccountToken();
  if (token) {
    headers["X-MCD-TOKEN"] = token;
  }
  fetch("/api/mcp/" + toolName, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(args || {})
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      callback(null, data);
    }, function (err) {
      callback(err, null);
    });
}

// 渲染「我的账号」卡片
// 设计原则：**不存在「演示账号」这个概念**。
// 早期版本会从快照里读一份积分显示为「演示账号积分」，但那份数据其实是
// 开发者本人账号的真实资产（已从公开快照中整体移除），既误导又涉及他人账户信息。
// 现在：未绑定就不显示任何积分数字，只有绑定自己的 Token 后才展示真实数值。
function renderAccountCard() {
  var card = $("account-card");
  var token = getAccountToken();

  if (token) {
    card.innerHTML = '<div class="acc-row">' +
      '<div><div class="acc-title">🟢 已绑定我的麦当劳账号</div>' +
      '<div class="acc-sub">Token 仅保存在本机浏览器，退出即清除；兑换将使用你自己的积分真实下单</div></div>' +
      '<button class="btn-acc-out" id="btn-acc-out">退出绑定</button></div>';
    var outBtn = document.getElementById("btn-acc-out");
    outBtn.addEventListener("click", function () {
      setAccountToken("");
      renderAccountCard();
      renderPrize();
      showModal("已退出绑定", "<p>已清除本机保存的 Token</p><p>积分与兑换功能将不可用，重新绑定后可恢复</p>", "知道了", null);
    });
    $("points-label").textContent = "我的麦享会积分（实时）";
    return;
  }

  card.innerHTML = '<div class="acc-row">' +
    '<div><div class="acc-title">🔗 绑定你的麦享会账号</div>' +
    '<div class="acc-sub">本项目不托管任何账号，也不会展示任何人的积分。绑定你自己的 MCP Token 后，才能查看你的真实积分并用真实积分兑换奖励</div></div>' +
    '<button class="btn-acc-bind" id="btn-acc-bind">去绑定</button></div>';
  var bindBtn = document.getElementById("btn-acc-bind");
  bindBtn.addEventListener("click", showBindModal);
  $("points-label").textContent = "你的麦享会积分";
}

// 绑定弹窗：输入 Token → 真实验证 → 保存
// 麦当劳官方 MCP Token 申请页（在新标签页打开，不打断当前游戏）
var MCP_TOKEN_PAGE = "https://open.mcd.cn/mcp";
// 是否已在本次绑定流程中打开过申请页，用于切回时给出提示
var bindTabOpened = false;
// focus 监听只绑一次，避免每次打开绑定弹窗都重复叠加
var bindTipBound = false;

// ===== 绑定弹窗：可直接跳转申请页，无需手动输网址 =====
function showBindModal() {
  showModal("🔗 绑定你的麦享会账号",
    '<div class="bind-flow">' +
    '<a class="bind-open-btn" id="bind-open-btn" href="' + MCP_TOKEN_PAGE +
    '" target="_blank" rel="noopener noreferrer">' +
    "<span class=\"bind-open-ico\">①</span>" +
    "<span><strong>打开 Token 申请页</strong><em>新标签页打开，本页对局进度不中断</em></span>" +
    "</a>" +
    '<div class="bind-step2">② 登录后点右上角「控制台」→「激活」→ 同意服务协议 → 一键复制 Token</div>' +
    '<div class="bind-step3">③ 粘贴到下方输入框</div>' +
    "</div>" +
    '<input type="password" class="token-input" id="token-input" placeholder="在此粘贴你的 MCP Token" maxlength="200">' +
    '<div class="bind-tip" id="bind-back-tip" hidden>👋 检测到你回来了——粘贴 Token 后点「验证并绑定」即可</div>' +
    '<div class="bind-warn">🔒 Token 仅保存在本机浏览器（sessionStorage），关闭页面即失效；服务端不存储、不记录、不参与日志。' +
    "绑定后可用<b>你自己的积分</b>真实兑换奖励；涉及扣分的操作都会再次向你确认。</div>",
    "验证并绑定", function () {
      var token = document.getElementById("token-input").value.trim();
      if (!token) {
        showModal("还没粘贴 Token",
          '<p>请先按上方步骤申请并粘贴 Token。</p>' +
          '<p style="margin-top:8px;font-size:13px;color:#8B5A2B">没申请过？点上方「打开 Token 申请页」，' +
          "手机号登录后即可免费拿到。</p>",
          "去申请", function () { openTokenPage(); }, false);
        return;
      }
      verifyToken(token);
    }, false);

  // 绑定申请页打开按钮
  var openBtn = document.getElementById("bind-open-btn");
  if (openBtn) {
    openBtn.addEventListener("click", function () {
      bindTabOpened = true;
      var tip = document.getElementById("bind-back-tip");
      if (tip) { tip.hidden = false; }
    });
  }

  // 从新标签页切回来时给一句提示（只改文案，不打断任何操作）
  if (!bindTipBound) {
    bindTipBound = true;
    window.addEventListener("focus", function () {
      if (!bindTabOpened || getAccountToken()) { return; }
      var tip = document.getElementById("bind-back-tip");
      if (tip) { tip.hidden = false; }
    });
  }
}

// 在新标签页打开 Token 申请页；当前页面与对局状态完全不动
function openTokenPage() {
  bindTabOpened = true;
  var w = window.open(MCP_TOKEN_PAGE, "_blank", "noopener,noreferrer");
  if (!w) {
    showModal("浏览器拦截了新标签页",
      '<p>请允许本站弹出新窗口，或手动打开下面的链接：</p>' +
      '<p style="margin-top:10px"><a href="' + MCP_TOKEN_PAGE + '" target="_blank" rel="noopener" ' +
      'style="color:#E62E1E;font-weight:700">' + MCP_TOKEN_PAGE + "</a></p>" +
      '<div class="modal-tip">在新标签页申请 Token 后，回到本页粘贴即可；本页对局进度不会丢失</div>',
      "知道了", null);
    return;
  }
  var tip = document.getElementById("bind-back-tip");
  if (tip) { tip.hidden = false; }
  console.log("[bind] 已在新标签页打开 Token 申请页，当前对局不受影响");
}

// 用用户 Token 真实调一次 query-my-account 验证有效性
function verifyToken(token) {
  showModal("验证中...", "<div style='text-align:center;padding:14px'><div style='font-size:32px'>⏳</div><p style='margin-top:8px'>正在连接麦当劳官方接口验证 Token</p></div>", null, null);

  fetch("/api/mcp/query-my-account", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MCD-TOKEN": token },
    body: JSON.stringify({})
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.success) {
        showModal("验证失败", "<p>" + (data.message || "Token 无效") + "</p><p style='margin-top:8px;font-size:13px;color:#8B5A2B'>请确认 Token 已在官方平台激活且未过期</p>", "重新输入", function () { showBindModal(); });
        return;
      }
      var acct = data.data && data.data.data ? data.data.data : null;
      var points = acct && acct.availablePoint ? Math.round(Number(acct.availablePoint)) : "?";
      setAccountToken(token);
      renderAccountCard();
      renderPrize();
      showModal("🎉 绑定成功", "<div style='text-align:center'><div style='font-size:42px'>✅</div>" +
        "<p style='margin-top:10px'>你的麦享会积分：<strong style='color:#E62E1E;font-size:20px'>" + points + "</strong></p>" +
        "<p style='font-size:12px;color:#8B5A2B;margin-top:8px'>已切换为你的真实账号数据</p></div>", "好的", null);
    }, function (err) {
      console.error("[bind] 验证请求失败:", err.message);
      showModal("验证失败", "<p>网络异常，请确认本地服务已启动</p>", "重新输入", function () { showBindModal(); });
    });
}

// ===== 奖品屋 / 奖励选择 =====
// 奖励商品全部来自麦当劳 MCP 真实接口（/api/rewards 聚合三类）：
//   mall    mall-points-products  麦麦商城可兑换商品
//   coupons available-coupons     麦麦省可领取优惠券
//   meals   query-nearby-stores + query-meals  门店在售餐品
// 后端任一来源失败会自动降级快照或置空，前端只负责展示与选择。
var PRIZE_SORT_RANK = { "生日类派对": 1, "主题类派对": 2, "玩具": 3, "品鉴会": 4, "读书会": 5, "鞋袜": 6, "到店专用": 7 };

var REWARD_DATA = { mall: [], coupons: [], meals: [], meta: null };
var REWARD_TAB = "mall";
var REWARD_PICK = null;
var REWARD_PICK_KEY = "mcd_reward_pick";

// 筛选条件：关键词 / 分类 / 排序
var REWARD_FILTER = { keyword: "", cat: "all", sort: "default" };

var REWARD_SORTS = [
  { key: "default", label: "推荐" },
  { key: "hot", label: "🔥 热门" },
  { key: "priceAsc", label: "价格 ↑" },
  { key: "priceDesc", label: "价格 ↓" },
  { key: "cat", label: "按类别" }
];

// 热门权重说明：MCP 不提供销量/浏览量字段，这里用「亲子友好分类 + 有官方图 + 价格区间」
// 三项可解释的规则估算热度，并在页面上如实标注，避免伪装成官方热销榜
var HOT_NOTE = "热门 = 亲子友好分类优先 + 有官方图 + 价格适中（MCP 无销量字段，此为本地热度估算）";

var REWARD_TABS = [
  { key: "mall", label: "🎁 麦麦商城" },
  { key: "coupons", label: "🎟 优惠券" },
  { key: "meals", label: "🍔 门店餐品" }
];

function renderPrize() {
  renderAccountCard();
  renderWinnerBanner();

  // 积分：只展示玩家自己账号的真实数值。
  // 未绑定时不显示任何数字（绝不回落到快照里的第三方账号数据）
  if (!getAccountToken()) {
    $("points-value").textContent = "—";
    loadRewards();
    return;
  }

  $("points-value").textContent = "读取中...";
  mcpFetch("query-my-account", {}, function (err, data) {
    if (err) {
      console.error("[prize] 积分查询失败:", err.message);
      $("points-value").textContent = "查询失败";
      return;
    }
    var acct = data && data.success && data.data && data.data.data ? data.data.data : null;
    if (acct && acct.availablePoint !== undefined) {
      $("points-value").textContent = String(Math.round(Number(acct.availablePoint)));
    } else {
      console.warn("[prize] query-my-account 返回结构异常:", JSON.stringify(data).slice(0, 120));
      $("points-value").textContent = "未获取";
    }
  });

  loadRewards();
}

// 通过 MCP 拉取真实奖励商品
function loadRewards() {
  $("prize-grid").innerHTML = '<p style="text-align:center;color:#8B5A2B;padding:20px">正在通过 MCP 读取真实商品...</p>';
  $("reward-tabs").innerHTML = "";

  fetch("/api/rewards")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.success || !data.rewards) {
        $("prize-grid").innerHTML = '<p style="text-align:center;color:#8B5A2B;padding:20px">奖励商品读取失败，请稍后重试</p>';
        return;
      }
      var r = data.rewards;
      REWARD_DATA = {
        mall: (r.mall && r.mall.items) || [],
        coupons: (r.coupons && r.coupons.items) || [],
        meals: (r.meals && r.meals.items) || [],
        meta: {
          mallSource: r.mall && r.mall.source,
          couponSource: r.coupons && r.coupons.source,
          mealSource: r.meals && r.meals.source,
          mealNote: r.meals && r.meals.note,
          storeName: r.meals && r.meals.storeName,
          city: r.city,
          usedByot: data.usedByot
        }
      };
      // 默认落在有数据的第一个 Tab
      if (!REWARD_DATA[REWARD_TAB] || !REWARD_DATA[REWARD_TAB].length) {
        REWARD_TAB = REWARD_DATA.mall.length ? "mall" : (REWARD_DATA.coupons.length ? "coupons" : "meals");
      }
      bindRewardSearch();
      renderRewardTabs();
      renderRewardToolbar();
      renderRewardList();
    }, function (err) {
      console.error("[prize] 奖励接口失败:", err.message);
      $("prize-grid").innerHTML = '<p style="text-align:center;color:#8B5A2B;padding:20px">奖励接口请求失败，请确认本地服务已启动</p>';
    });
}

// 获胜者横幅：结算后进入奖品屋，提示「请选择你的奖励」
function renderWinnerBanner() {
  var el = $("prize-winner");
  if (!el) {
    return;
  }
  var winners = state.game && state.game.result && state.game.result.winners
    ? state.game.result.winners
    : (state.winners || []);

  if (!winners.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  var names = winners.map(function (w) { return w.name; }).join("、");
  var html = '<div class="winner-title">🏆 本局获胜：' + names + "</div>";

  if (REWARD_PICK) {
    html += '<div class="winner-picked">已选奖励：<strong>' + REWARD_PICK.name + "</strong>" +
      '<span class="winner-pick-src">' + rewardKindLabel(REWARD_PICK.kind) + "</span>" +
      '<button class="btn-pick-again" id="btn-pick-again">重新选择</button></div>';
  } else {
    html += '<div class="winner-tip">请在下方挑选一件真实商品作为你的奖励（数据来自麦当劳 MCP）</div>';
  }

  el.classList.remove("hidden");
  el.innerHTML = html;

  var again = $("btn-pick-again");
  if (again) {
    again.addEventListener("click", function () {
      showRewardCertificate(true);
    });
  }
}

function rewardKindLabel(kind) {
  if (kind === "coupon") { return "优惠券"; }
  if (kind === "meal") { return "门店餐品"; }
  return "麦麦商城";
}

// 分类 Tab
function renderRewardTabs() {
  var html = "";
  for (var i = 0; i < REWARD_TABS.length; i += 1) {
    var tab = REWARD_TABS[i];
    var count = (REWARD_DATA[tab.key] || []).length;
    var active = tab.key === REWARD_TAB;
    html += '<button class="reward-tab' + (active ? " active" : "") +
      (count ? "" : " empty") + '" data-tab="' + tab.key + '">' +
      tab.label + '<span class="tab-count">' + count + "</span></button>";
  }
  $("reward-tabs").innerHTML = html;

  var btns = document.querySelectorAll(".reward-tab");
  for (var j = 0; j < btns.length; j += 1) {
    btns[j].addEventListener("click", function (e) {
      REWARD_TAB = e.currentTarget.getAttribute("data-tab");
      // 换分类后原分类筛选可能失效，回到「全部」
      REWARD_FILTER.cat = "all";
      renderRewardTabs();
      renderRewardToolbar();
      renderRewardList();
    });
  }
}

// ===== 搜索 / 排序 / 分类筛选 =====
function renderRewardToolbar() {
  var searchEl = $("reward-search");
  if (searchEl && searchEl.value !== REWARD_FILTER.keyword) {
    searchEl.value = REWARD_FILTER.keyword;
  }
  var clearEl = $("reward-search-clear");
  if (clearEl) {
    if (REWARD_FILTER.keyword) {
      clearEl.classList.remove("hidden");
    } else {
      clearEl.classList.add("hidden");
    }
  }

  // 排序按钮（当前分类无价格数据时，价格排序置灰但仍可点，避免困惑）
  var html = "";
  for (var i = 0; i < REWARD_SORTS.length; i += 1) {
    var s = REWARD_SORTS[i];
    html += '<button class="sort-btn' + (REWARD_SORTS[i].key === REWARD_FILTER.sort ? " active" : "") +
      '" data-sort="' + s.key + '">' + s.label + "</button>";
  }
  $("reward-sorts").innerHTML = html;
  var sortBtns = document.querySelectorAll(".sort-btn");
  for (var j = 0; j < sortBtns.length; j += 1) {
    sortBtns[j].addEventListener("click", function (e) {
      REWARD_FILTER.sort = e.currentTarget.getAttribute("data-sort");
      renderRewardToolbar();
      renderRewardList();
    });
  }

  // 分类 chips：按当前 Tab 的商品动态生成
  var items = (REWARD_DATA[REWARD_TAB] || []).filter(function (it) {
    return REWARD_TAB !== "mall" || isPrizeActive(it);
  });
  var cats = [];
  var counts = {};
  for (var k = 0; k < items.length; k += 1) {
    var c = items[k].catName || "其他";
    if (!counts[c]) {
      counts[c] = 0;
      cats.push(c);
    }
    counts[c] += 1;
  }

  var catHtml = '<button class="cat-chip' + (REWARD_FILTER.cat === "all" ? " active" : "") +
    '" data-cat="all">全部<span class="chip-count">' + items.length + "</span></button>";
  for (var m = 0; m < cats.length; m += 1) {
    catHtml += '<button class="cat-chip' + (REWARD_FILTER.cat === cats[m] ? " active" : "") +
      '" data-cat="' + cats[m] + '">' + cats[m] +
      '<span class="chip-count">' + counts[cats[m]] + "</span></button>";
  }
  $("reward-cats").innerHTML = catHtml;

  var catBtns = document.querySelectorAll(".cat-chip");
  for (var n = 0; n < catBtns.length; n += 1) {
    catBtns[n].addEventListener("click", function (e) {
      REWARD_FILTER.cat = e.currentTarget.getAttribute("data-cat");
      renderRewardToolbar();
      renderRewardList();
    });
  }
}

// 绑定搜索框（只绑一次，避免重复渲染丢失焦点）
var rewardSearchBound = false;
function bindRewardSearch() {
  if (rewardSearchBound) {
    return;
  }
  var el = $("reward-search");
  var clearEl = $("reward-search-clear");
  if (!el) {
    return;
  }
  rewardSearchBound = true;
  el.addEventListener("input", function () {
    REWARD_FILTER.keyword = el.value.trim();
    renderRewardToolbar();
    renderRewardList();
  });
  if (clearEl) {
    clearEl.addEventListener("click", function () {
      REWARD_FILTER.keyword = "";
      el.value = "";
      el.focus();
      renderRewardToolbar();
      renderRewardList();
    });
  }
}

// 价格取数值，取不到返回 null（排序时统一排到末尾）
function priceOf(item) {
  var raw = item.price === undefined || item.price === null ? "" : String(item.price);
  if (!raw) {
    return null;
  }
  var n = Number(raw);
  return isNaN(n) ? null : n;
}

// 价格排序键：奖品屋里有两种「价格」——积分与人民币，跨单位直接比大小没有意义
// 因此按「类型分组 + 组内数值」排序：积分可兑品在前（组 0），付费活动在后（组 1）
function priceSortKey(item) {
  if (item.redeemType === "point") {
    return { group: 0, value: Number(item.point || 0) };
  }
  if (item.redeemType === "event") {
    return { group: 1, value: priceOf(item) === null ? Number.MAX_SAFE_INTEGER : priceOf(item) };
  }
  return { group: 2, value: priceOf(item) === null ? Number.MAX_SAFE_INTEGER : priceOf(item) };
}

// 热门热度估算：分类亲子热度 + 有官方图 + 价格适中
function hotScoreOf(item) {
  var rank = PRIZE_SORT_RANK[item.catName] || 9;
  var score = (10 - rank) * 10;
  if (item.image) {
    score += 5;
  }
  var price = priceOf(item);
  if (price !== null) {
    // 亲子玩具/派对主流价格带 40~150 元最受欢迎
    if (price >= 40 && price <= 150) {
      score += 6;
    } else if (price > 0 && price < 40) {
      score += 3;
    }
  }
  if (item.desc && String(item.desc).length > 20) {
    score += 2;
  }
  // 优惠券：未领取的比已领取的更值得优先展示
  if (item.status) {
    if (String(item.status).indexOf("未领取") !== -1) {
      score += 4;
    } else if (String(item.status).indexOf("已领取") !== -1) {
      score += 1;
    }
  }
  return score;
}

// 关键词匹配：商品名 / 分类 / 简介 / 编码
function matchKeyword(item, keyword) {
  if (!keyword) {
    return true;
  }
  var kw = String(keyword).toLowerCase();
  var fields = [item.name, item.catName, item.desc, item.spuId, item.status];
  for (var i = 0; i < fields.length; i += 1) {
    if (fields[i] && String(fields[i]).toLowerCase().indexOf(kw) !== -1) {
      return true;
    }
  }
  return false;
}

// 过滤掉已下架的奖品
function isPrizeActive(item) {
  var endTime = item.validTo || item.downTime || "";
  if (!endTime) {
    return true;
  }
  var end = new Date(String(endTime).replace(/-/g, "/"));
  if (isNaN(end.getTime())) {
    return true;
  }
  return end.getTime() > Date.now();
}

function renderRewardList() {
  var meta = REWARD_DATA.meta || {};
  var all = (REWARD_DATA[REWARD_TAB] || []).slice();

  // 商城商品过滤掉已下架的
  if (REWARD_TAB === "mall") {
    all = all.filter(isPrizeActive);
  }

  // 1) 分类筛选
  var items = all;
  if (REWARD_FILTER.cat !== "all") {
    items = items.filter(function (it) {
      return (it.catName || "其他") === REWARD_FILTER.cat;
    });
  }

  // 2) 关键词搜索
  if (REWARD_FILTER.keyword) {
    items = items.filter(function (it) {
      return matchKeyword(it, REWARD_FILTER.keyword);
    });
  }

  // 3) 排序
  var sortKey = REWARD_FILTER.sort;
  items = items.slice().sort(function (a, b) {
    if (sortKey === "priceAsc" || sortKey === "priceDesc") {
      var ka = priceSortKey(a);
      var kb = priceSortKey(b);
      // 类型分组固定（积分在前），组内按数值升降
      if (ka.group !== kb.group) {
        return ka.group - kb.group;
      }
      return sortKey === "priceAsc" ? ka.value - kb.value : kb.value - ka.value;
    }
    if (sortKey === "hot") {
      return hotScoreOf(b) - hotScoreOf(a);
    }
    if (sortKey === "cat") {
      var ca = a.catName || "其他";
      var cb = b.catName || "其他";
      if (ca !== cb) {
        return ca.localeCompare(cb, "zh-Hans-CN");
      }
      return String(a.name).localeCompare(String(b.name), "zh-Hans-CN");
    }
    // default 推荐：可真实兑换的积分商品优先，其次亲子友好分类，同类价格从低到高
    var ra = PRIZE_SORT_RANK[a.catName] || 9;
    var rb = PRIZE_SORT_RANK[b.catName] || 9;
    var pa = a.redeemType === "point" ? 0 : 1;
    var pb = b.redeemType === "point" ? 0 : 1;
    if (pa !== pb) {
      return pa - pb;
    }
    if (ra !== rb) {
      return ra - rb;
    }
    var da = priceSortKey(a).value;
    var db = priceSortKey(b).value;
    return da - db;
  });

  var sourceNote = REWARD_TAB === "mall"
    ? "麦麦商城积分商品（MCP mall-points-products" + (meta.mallSource === "mcp" ? " 实时" : " 快照") + "）"
    : (REWARD_TAB === "coupons"
      ? "麦麦省可领取优惠券（MCP available-coupons" + (meta.couponSource === "mcp" ? " 实时" : " 快照") + "）"
      : "门店在售餐品（MCP query-nearby-stores + query-meals" + (meta.storeName ? " · " + meta.storeName : "") + "）");

  var headHtml = '<div class="prize-source">' + sourceNote + "</div>" +
    '<div class="prize-source">筛选出 <strong>' + items.length + "</strong> / 共 " + all.length + " 件" +
    (REWARD_FILTER.keyword ? " · 关键词「" + REWARD_FILTER.keyword + "」" : "") +
    (REWARD_FILTER.cat !== "all" ? " · 分类「" + REWARD_FILTER.cat + "」" : "") +
    (sortKey === "hot" ? " · " + HOT_NOTE : "") +
    (sortKey === "priceAsc" || sortKey === "priceDesc"
      ? " · 价格排序：可扣积分兑换的商品按积分数排序在前，付费活动按金额排序在后"
      : "") + "</div>";

  if (!items.length) {
    var emptyMsg = REWARD_TAB === "meals" && meta.mealNote
      ? "门店餐品暂不可用：" + meta.mealNote
      : (REWARD_FILTER.keyword || REWARD_FILTER.cat !== "all"
        ? "没有符合条件的商品，试试换个关键词或切回「全部」分类"
        : "该分类暂无可选择的商品");
    $("prize-grid").innerHTML = headHtml +
      '<div class="prize-empty">' + emptyMsg + "</div>";
    return;
  }

  var html = headHtml;
  for (var k = 0; k < items.length; k += 1) {
    var item = items[k];
    var imgHtml = '<img class="prize-img" src="' + rewardImageOf(item) + '" alt="' + item.name + '" loading="lazy" onerror="this.src=\'' + PRIZE_ICON_DEFAULT + '\'">';

    // 价格与兑换类型标识：区分「可真实扣积分兑换」与「付费活动」
    var priceHtml;
    var typeBadge;
    if (item.redeemType === "point") {
      priceHtml = '<div class="prize-cost">' + item.point + " 积分</div>";
      typeBadge = '<span class="redeem-tag point">可真实兑换</span>';
    } else if (item.redeemType === "event") {
      priceHtml = '<div class="prize-cost">¥' + (item.price || "-") + "</div>";
      typeBadge = '<span class="redeem-tag event">活动预约</span>';
    } else if (item.price) {
      priceHtml = '<div class="prize-cost">¥' + item.price + "</div>";
      typeBadge = "";
    } else {
      priceHtml = '<div class="prize-cost free">券</div>';
      typeBadge = '<span class="redeem-tag coupon">优惠券</span>';
    }

    // 按钮文案随兑换类型变化，让玩家一眼知道下一步会发生什么
    var btnText = item.redeemType === "point"
      ? "用积分兑换"
      : (item.redeemType === "event" ? "查看预约" : "选为奖励");

    html += '<div class="prize-card' + (REWARD_PICK && REWARD_PICK.key === item.key ? " picked" : "") + '">' +
      typeBadge +
      imgHtml +
      '<div class="prize-name">' + item.name + "</div>" +
      '<div class="prize-meta">' + (item.catName || "其他") + (item.validTo ? " · 至 " + String(item.validTo).slice(0, 10) : "") + "</div>" +
      priceHtml +
      '<button class="btn-redeem" data-reward="' + k + '">' + btnText + "</button></div>";
  }

  $("prize-grid").innerHTML = html;

  var btns = document.querySelectorAll(".btn-redeem");
  for (var j = 0; j < btns.length; j += 1) {
    btns[j].addEventListener("click", function (e) {
      var idx = Number(e.currentTarget.getAttribute("data-reward"));
      confirmReward(items[idx]);
    });
  }
}

// 卡片图：商城/餐品用官方图，优惠券用真实券图，取不到则用分类卡通图标
function rewardImageOf(item) {
  if (item.image) {
    return item.image;
  }
  return prizeIconOf(item.catName);
}

// 奖品分类 → 卡通图标映射（AI 生成的 3x3 图标雪碧图切割，见 tools/ 无关文件 web/assets/prize-icons/）
// 卡片用卡通图标保证视觉统一；详情弹窗保留 MCP 返回的真实商品海报
var PRIZE_ICON_MAP = {
  "生日类派对": "/assets/prize-icons/party-cake.jpg",
  "主题类派对": "/assets/prize-icons/party-hat.jpg",
  "玩具": "/assets/prize-icons/toy-train.jpg",
  "读书会": "/assets/prize-icons/book.jpg",
  "品鉴会": "/assets/prize-icons/burger-set.jpg",
  "鞋袜": "/assets/prize-icons/shoes.jpg",
  "到店专用": "/assets/prize-icons/store.jpg"
};
var PRIZE_ICON_DEFAULT = "/assets/prize-icons/dessert-drink.jpg";

function prizeIconOf(catName) {
  return PRIZE_ICON_MAP[catName] || PRIZE_ICON_DEFAULT;
}

// 选择奖励 → 真实兑奖
// 两类商品走两条路（依据官方 shopId 划分，实测 mall-product-detail 得到）：
//   A. 积分兑换品（shopId=2，24 件）：绑定账号后可**真实下单**，从玩家自己的麦享会积分扣除
//   B. 活动预约品（shopId=5，26 件）：付费活动（¥45~198），需官方渠道选定门店/日期/场次
//   C. 优惠券：麦麦省一键领取
// 任何写操作都必须：玩家自己的 Token + 界面显式勾选确认，绝不用项目 Token 替人下单。
function confirmReward(item) {
  var imgHtml = item.image
    ? '<img class="modal-img" src="' + item.image + '" alt="' + item.name + '" onerror="this.style.display=\'none\'">'
    : "";
  var descHtml = item.desc ? '<div class="modal-desc">' + item.desc + "</div>" : "";
  var rangeHtml = item.validTo
    ? '<div class="modal-range">有效期至：' + String(item.validTo).slice(0, 10) + "</div>"
    : "";
  var idHtml = item.spuId
    ? '<div class="modal-spu">商品编码：' + item.spuId + "（官方渠道可核验）</div>"
    : (item.couponId ? '<div class="modal-spu">券编号：#' + item.couponId + "</div>" : "");

  var head = '<div style="text-align:center">' + imgHtml + "</div>" +
    "<div class='modal-prize-name'>" + item.name + "</div>" +
    '<div class="modal-cat">' + rewardKindLabel(item.kind) + " · " + (item.catName || "其他") + "</div>";

  // ---------- A. 积分可兑商品：真实下单 ----------
  if (item.redeemType === "point") {
    var costHtml = '<div class="modal-price">需 <strong>' + item.point + "</strong> 积分</div>";
    if (!getAccountToken()) {
      showModal("兑换这件奖励", head + descHtml + rangeHtml + costHtml + idHtml +
        '<div class="modal-tip">🔗 请先绑定你的麦享会账号，才能用你自己的积分真实兑换</div>',
        "去绑定账号", function () { showBindModal(); }, false);
      return;
    }
    var confirmHtml =
      '<label class="redeem-check"><input type="checkbox" id="redeem-agree">' +
      '<span>我确认使用 <strong>我的麦享会积分</strong> 兑换本商品，将扣除 <strong>' + item.point + "</strong> 积分</span></label>" +
      '<div class="modal-tip">🔒 下单将调用麦当劳官方积分兑换接口，积分从你自己的账户扣除；本项目不经手任何资金</div>';
    showModal("兑换这件奖励", head + descHtml + rangeHtml + costHtml + idHtml + confirmHtml,
      "确认兑换", function () {
        var agree = $("redeem-agree");
        if (!agree || !agree.checked) {
          showModal("请先勾选确认",
            "<p>真实积分兑换需要你明确勾选确认，避免误操作扣除积分。</p>", "知道了", null);
          return;
        }
        doRealRedeem(item);
      }, false);
    return;
  }

  // ---------- B. 活动预约品：付费活动 ----------
  if (item.redeemType === "event") {
    var priceHtml = '<div class="modal-price">¥<strong>' + (item.price || "见官方") + "</strong> / 份</div>";
    showModal("预约这件活动", head + descHtml + rangeHtml + priceHtml + idHtml +
      '<div class="modal-tip">🎪 派对 / 读书会 / 品鉴会属<b>付费活动</b>（非积分兑换），需在官方渠道选定门店、日期与场次完成预约</div>',
      "查看预约指引", function () { pickRewardOnly(item); }, false);
    return;
  }

  // ---------- C. 优惠券 ----------
  showModal("选择这件奖励", head + descHtml + rangeHtml +
    '<div class="modal-price">券后可用</div>' + idHtml +
    '<div class="modal-tip">🎟 优惠券需在麦麦省一键领取后到店使用</div>',
    "选为我的奖励", function () { pickRewardOnly(item); }, false);
}

// 仅记录选择并生成凭证（不触发真实扣减）
function pickRewardOnly(item) {
  REWARD_PICK = {
    key: item.key,
    kind: item.kind,
    name: item.name,
    catName: item.catName || "",
    price: item.price || "",
    point: item.point || "",
    redeemType: item.redeemType || "",
    spuId: item.spuId || "",
    pickedAt: new Date().toISOString()
  };
  var saveTask = Promise.resolve().then(function () {
    sessionStorage.setItem(REWARD_PICK_KEY, JSON.stringify(REWARD_PICK));
  });
  saveTask.then(null, function (err) {
    console.error("[reward] 奖励凭证保存失败:", err.message);
  });
  soundPlay("reward");
  renderWinnerBanner();
  renderRewardList();
  showRewardCertificate(true);
}

// ===== 真实积分兑换：查 SKU → 展示最终扣减 → 二次确认 → 调官方接口下单 =====
// 调用链（依据官方工具实测入参）：
//   mall-product-detail(spuId) → 拿 skuList[0].skuId 与 spuCategory
//   mall-create-order({skuId, spuCategory, count, confirm:true}) → 真实扣积分下单
// 注意：官方要求「单个商品一个订单」，本项目一次只兑换一件，符合约束。
function doRealRedeem(item) {
  var loadingHtml = '<div style="text-align:center;padding:20px">' +
    '<div style="font-size:34px">⏳</div>' +
    '<p style="margin-top:10px">正在向麦当劳官方查询兑换规格...</p></div>';
  showModal("正在兑换", loadingHtml, "", null);

  // 1) 查商品详情拿 skuId
  mcpFetch("mall-product-detail", { spuId: item.spuId }, function (err, detailRes) {
    if (err || !detailRes || !detailRes.success) {
      var msg = err ? err.message : "商品详情查询失败";
      console.error("[redeem] 查询 SKU 失败:", msg);
      showModal("兑换未完成",
        "<p>查询兑换规格失败：" + msg + "</p>" +
        '<div class="modal-tip">可改为「记录选择」，生成凭证后到麦当劳 App 麦麦商城完成兑换</div>',
        "改为记录选择", function () { pickRewardOnly(item); }, false);
      return;
    }

    var data = detailRes.data && detailRes.data.data ? detailRes.data.data : null;
    var skuList = data && data.skuList ? data.skuList : [];
    if (!skuList.length) {
      console.warn("[redeem] 商品无可兑换 SKU:", JSON.stringify(data).slice(0, 150));
      showModal("该商品暂不支持在线兑换",
        "<p>这件商品当前没有可在线兑换的规格（可能是活动类或已下架）。</p>" +
        '<div class="modal-tip">可改为「记录选择」，生成凭证后到官方渠道完成</div>',
        "改为记录选择", function () { pickRewardOnly(item); }, false);
      return;
    }

    // 取第一个可用 SKU（官方说明：用户选定 SKU 后才能下单）
    var sku = skuList[0];
    var realPoints = Number(sku.points || item.point || 0);
    // spuCategory：1=虚拟商品（餐品券），2=实体物品（需配送地址）
    var spuCategory = String(sku.spuCategory || (item.shopId === 2 ? "1" : "1"));

    // 2) 展示最终扣减明细，再做一次确认（防误触）
    var finalHtml =
      '<div class="cert-box">' +
      '<div class="cert-winner">兑换商品<br><strong>' + item.name + "</strong></div>" +
      '<div class="cert-meta">商品编码 ' + item.spuId + " · SKU " + sku.skuId + "</div>" +
      '<div class="cert-prize">将扣除你的积分<br><strong>' + realPoints + " 积分</strong></div>" +
      "</div>" +
      '<div class="modal-desc">兑换后可在「麦当劳 App / 小程序 → 麦麦商城 → 我的订单」查看该兑换券。</div>' +
      '<label class="redeem-check"><input type="checkbox" id="redeem-final">' +
      '<span>我已核对商品与积分数量，确认立即兑换</span></label>';

    showModal("确认真实兑换", finalHtml, "确认扣除积分", function () {
      var box = $("redeem-final");
      if (!box || !box.checked) {
        showModal("请先勾选确认", "<p>为避免误扣积分，请勾选确认后再提交。</p>", "知道了", null);
        return;
      }
      submitRedeem(item, sku.skuId, spuCategory, realPoints);
    }, true);
  });
}

// 4) 提交真实下单
function submitRedeem(item, skuId, spuCategory, points) {
  var pendingHtml = '<div style="text-align:center;padding:20px">' +
    '<div style="font-size:34px">⏳</div>' +
    "<p style='margin-top:10px'>正在提交兑换，请勿关闭...</p></div>";
  showModal("兑换中", pendingHtml, "", null);

  // confirm:true 是服务端的二次确认闸门——没有它服务端直接拒绝
  mcpFetch("mall-create-order", {
    skuId: skuId,
    spuCategory: spuCategory,
    count: 1,
    confirm: true
  }, function (err, res) {
    if (err || !res || !res.success) {
      var msg = err ? err.message : (res && res.message) || "下单失败";
      console.error("[redeem] 真实兑换失败:", msg);
      showModal("兑换未成功",
        "<p>" + msg + "</p>" +
        '<div class="modal-tip">你的积分未被扣除。可到「麦当劳 App → 麦麦商城」手动完成兑换，或改为仅记录选择。</div>',
        "知道了", null);
      return;
    }
    soundPlay("reward");
    console.log("[redeem] 兑换成功:", JSON.stringify(res).slice(0, 200));
    var orderId = "";
    if (res.data && res.data.data && res.data.data.orderId) {
      orderId = res.data.data.orderId;
    }
    REWARD_PICK = {
      key: item.key,
      kind: item.kind,
      name: item.name,
      catName: item.catName || "",
      point: String(points),
      redeemType: "point",
      spuId: item.spuId || "",
      orderId: orderId,
      redeemedAt: new Date().toISOString(),
      pickedAt: new Date().toISOString()
    };
    var saveTask = Promise.resolve().then(function () {
      sessionStorage.setItem(REWARD_PICK_KEY, JSON.stringify(REWARD_PICK));
    });
    saveTask.then(null, function (saveErr) {
      console.error("[redeem] 凭证保存失败:", saveErr.message);
    });
    renderWinnerBanner();
    renderPrize();

    showModal("🎉 兑换成功",
      '<div style="text-align:center">' +
      '<div style="font-size:46px">🎁</div>' +
      "<div class='modal-prize-name'>" + item.name + "</div>" +
      (orderId ? '<div class="modal-spu">订单号：' + orderId + "</div>" : "") +
      '<div class="modal-price">已扣除 <strong>' + points + "</strong> 积分</div>" +
      "</div>" +
      '<div class="redeem-steps"><p><strong>下一步：</strong></p>' +
      "<p>打开麦当劳 App / 小程序 → 麦麦商城 → 我的订单</p>" +
      "<p>找到这笔兑换记录，到店出示核销</p></div>",
      "好的", null);
  });
}

// 奖励凭证：展示获胜者 + 所选真实商品 + 官方兑换步骤
function showRewardCertificate(allowRepick) {
  if (!REWARD_PICK) {
    return;
  }
  var winners = state.game && state.game.result && state.game.result.winners
    ? state.game.result.winners
    : (state.winners || []);
  var names = winners.length
    ? winners.map(function (w) { return w.name; }).join("、")
    : "本局玩家";

  var body = '<div class="cert-box">' +
    '<div class="cert-winner">🏆 获奖玩家<br><strong>' + names + "</strong></div>" +
    '<div class="cert-prize">奖励商品<br><strong>' + REWARD_PICK.name + "</strong></div>" +
    '<div class="cert-meta">' + rewardKindLabel(REWARD_PICK.kind) + " · " + REWARD_PICK.catName +
      (REWARD_PICK.price ? " · ¥" + REWARD_PICK.price : "") +
      (REWARD_PICK.spuId ? " · 编码 " + REWARD_PICK.spuId : "") + "</div>" +
    "</div>" +
    '<div class="redeem-steps">' +
    "<p><strong>领取步骤：</strong></p>" +
    "<p>1. 打开麦当劳 App / 小程序</p>" +
    "<p>2. 进入「麦麦商城」或「麦麦省」搜索「" + REWARD_PICK.name + "」</p>" +
    "<p>3. 使用麦享会积分完成兑换</p>" +
    "</div>" +
    '<div class="modal-tip">📌 本凭证仅记录游戏结果，真实兑换请在官方渠道完成</div>';

  showModal("🎉 奖励已选定", body, allowRepick ? "继续挑选" : "完成", function () {
    if (!allowRepick) {
      renderRewardList();
    }
  }, false);
}

// ===== 弹窗 =====
function showModal(title, bodyHtml, confirmText, onConfirm, danger) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  var actions = $("modal-actions");
  actions.innerHTML = "";

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-modal-cancel";
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", function () {
    hideModal();
    if (state.game && state.game.status === "playing") {
      state.busy = false;
    }
  });
  actions.appendChild(cancelBtn);

  if (confirmText) {
    var okBtn = document.createElement("button");
    okBtn.className = "btn-modal-confirm" + (danger ? " danger" : "");
    okBtn.textContent = confirmText;
    okBtn.addEventListener("click", function () {
      hideModal();
      if (onConfirm) {
        onConfirm();
      } else if (state.game && state.game.status === "playing") {
        state.busy = false;
      }
    });
    actions.appendChild(okBtn);
  }

  $("modal-mask").classList.remove("hidden");
}

function hideModal() {
  $("modal-mask").classList.add("hidden");
}

// ===== MCP 连通检测 =====
function checkMcp() {
  fetch("/api/mcp/now-time-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  })
    .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
    .then(function (r) {
      var badge = $("mcp-badge");
      var data = r.data;
      if (data.success) {
        badge.innerHTML = "✅ MCP 已连接 · 数据来自麦当劳官方接口";
        badge.style.borderColor = "#7CB518";
        return;
      }
      // 503 = 当前实例没配 Token（云端部署常见）。这是「离线模式」而不是故障，
      // 照实说明数据来自内置公开快照，别让访客误以为项目坏了。
      if (r.ok === false && (data.offline || data.message.indexOf("未配置") !== -1)) {
        badge.innerHTML = "📦 离线模式 · 使用内置公开数据快照（游戏功能完整）";
        badge.style.borderColor = "#FFC72C";
        return;
      }
      badge.textContent = "⚠️ MCP 连接异常：" + (data.message || "未知错误");
      badge.style.borderColor = "#E62E1E";
    }, function (err) {
      // 调试信息：区分是后端未启动还是网络异常
      console.error("[mcp] 连通检测失败:", err.message);
      $("mcp-badge").textContent = "⚠️ 后端服务未启动，请运行 node backend/server.js";
    });
}

// ===== 事件绑定 =====
function bindSeg(id, attr, key) {
  var container = $(id);
  container.addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) { return; }
    var items = container.querySelectorAll(".seg-btn");
    for (var i = 0; i < items.length; i += 1) {
      items[i].classList.remove("active");
    }
    btn.classList.add("active");
    soundPlay("click");

    // 纯数值选项（玩家人数 data-count、回合数 data-round）转成数字；
    // 字符串选项（胜利目标 data-victory）必须保持原样。
    // 早期这里统一做了 Number() 转换，导致 Number("reach") === NaN，
    // 胜利目标永远写不进 state，所有对局都按兜底的「护盾最多」结算。
    var rawValue = btn.getAttribute(attr);
    var isNumericOption = attr === "data-count" || attr === "data-round";
    var nextValue = isNumericOption ? Number(rawValue) : rawValue;

    // 人数变化时，若已选卡数超过新人数，需要裁剪并提示
    if (key === "playerCount" && state.selectedChars.length > nextValue) {
      state.selectedChars = state.selectedChars.slice(0, nextValue);
      if (state.page === "select") {
        renderSelect();
        showModal("人数已调整", "<p>玩家人数改为 " + nextValue + " 人，已选卡牌超出数量的部分已移除</p>", "知道了", null);
      }
    }
    state[key] = nextValue;
  });
}

function bind() {
  bindSeg("seg-count", "data-count", "playerCount");
  bindSeg("seg-victory", "data-victory", "victoryType");
  bindSeg("seg-round", "data-round", "totalRounds");

  $("btn-to-select").addEventListener("click", function () {
    state.selectedChars = [];
    renderSelect();
    navigate("select");
  });

  $("btn-start").addEventListener("click", function () {
    // 双重保险：即使按钮状态异常，也不会静默无响应
    if (state.selectedChars.length !== state.playerCount) {
      showModal("还未选够卡牌",
        "<p>当前需要 <strong>" + state.playerCount + "</strong> 张卡，已选 <strong>" +
        state.selectedChars.length + "</strong> 张</p>" +
        "<p style='margin-top:8px;color:#8B5A2B;font-size:13px'>请为每位玩家各选择一张餐品伙伴</p>",
        "去选卡", function () { renderSelect(); });
      return;
    }
    // 防止重复点击
    if (state.starting) { return; }
    state.starting = true;

    // 开局前拉取麦当劳真实活动（加超时保护，避免网络异常卡住开局）
    loadRealEvents(function () {
      state.starting = false;
      startGame();
    });
  });
  $("btn-roll").addEventListener("click", doRoll);
  $("btn-undo").addEventListener("click", undo);
  $("btn-to-prize").addEventListener("click", function () { navigate("prize"); });
  $("btn-restart").addEventListener("click", function () {
    state.game = null;
    state.selectedChars = [];
    navigate("home");
  });

  var backs = document.querySelectorAll(".btn-back");
  for (var i = 0; i < backs.length; i += 1) {
    backs[i].addEventListener("click", function (e) {
      var target = e.currentTarget.getAttribute("data-back");
      soundPlay("click");
      navigate(target);
    });
  }

  // ===== 音效开关（首页 + 三个页面顶栏各一个）=====
  soundLoadPref();
  soundBindGesture();
  soundSyncButtons();
  var soundBtns = document.querySelectorAll(".btn-sound");
  for (var s = 0; s < soundBtns.length; s += 1) {
    soundBtns[s].addEventListener("click", function () {
      var on = soundToggle();
      soundSyncButtons();
      console.log("[sound] 音效已" + (on ? "开启" : "关闭"));
    });
  }

  // 初始化路由：从 URL 判断初始页面
  var path = location.pathname.replace("/", "");
  var initial = ["home", "select", "game", "result", "prize"].indexOf(path) !== -1 ? path : "home";
  navigate(initial, true);

  // 若从对局页进入且无存档，退回首页
  if (initial === "game" && !state.game) {
    restoreGame(function (has) {
      if (has) {
        renderGame();
      } else {
        state.page = "home";
        renderPage("home");
        history.replaceState({ page: "home" }, "", "/");
      }
    });
  }

  if (initial === "prize") {
    renderPrize();
  }

  checkMcp();
}

// 页面加载完成初始化
document.addEventListener("DOMContentLoaded", bind);