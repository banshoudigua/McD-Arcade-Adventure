// 桌游核心引擎：麦麦奇幻乐园
// 设计思路借鉴「冰橙星星乐三国篇 - 起源」的 gameStore.js，但为Web 应用全新实现
// 关键差异：支持 History API 路由跳转、对局状态快照（用于前进后退恢复）

const charData = require("./characters");
// 从模块对象中取出角色卡数组（注意：require 拿到的是模块对象，需解构）
const CHARACTERS = charData.CHARACTERS;

// 30 格欢乐地图循环
const BOARD_SIZE = 30;
// 每绕一圈回到起点的欢乐值奖励
const LOOP_REWARD = 3;

// 设施类型定义
const CELL_TYPES = {
  start: { key: "start", name: "金色拱门", desc: "起点，经过时全体欢乐值 +1" },
  shop: { key: "shop", name: "甜品屋", desc: "可购买卡牌或道具" },
  event: { key: "event", name: "活动舞台", desc: "抽取事件卡并结算" },
  battle: { key: "battle", name: "欢乐挑战", desc: "战斗判定，胜者得欢乐值" },
  rest: { key: "rest", name: "休息区", desc: "恢复护盾，不触发事件" },
  science: { key: "science", name: "营养科普站", desc: "基于真实营养数据答题，答对加欢乐值" },
  cardSlot: { key: "cardSlot", name: "卡牌驿站", desc: "自动抽取一张角色卡" }
};

// 30 格地图布局（与三国篇一致的循环棋盘结构）
const BOARD = [
  { position: 0, type: "start", name: "金色拱门" },
  { position: 1, type: "rest", name: "麦香小径" },
  { position: 2, type: "cardSlot", name: "新手驿站", tier: "T3" },
  { position: 3, type: "shop", name: "甜品小屋" },
  { position: 4, type: "battle", name: "脆皮挑战" },
  { position: 5, type: "event", name: "活动广场" },
  { position: 6, type: "rest", name: "汽水长廊" },
  { position: 7, type: "shop", name: "汉堡工坊" },
  { position: 8, type: "battle", name: "欢乐挑战" },
  { position: 9, type: "cardSlot", name: "进阶驿站", tier: "T2" },
  { position: 10, type: "event", name: "限时舞台" },
  { position: 11, type: "science", name: "营养科普站" },
  { position: 12, type: "shop", name: "小食工场" },
  { position: 13, type: "battle", name: "辣味挑战" },
  { position: 14, type: "event", name: "联名广场" },
  { position: 15, type: "rest", name: "树荫广场" },
  { position: 16, type: "cardSlot", name: "精英驿站", tier: "T2" },
  { position: 17, type: "shop", name: "饮品吧台" },
  { position: 18, type: "battle", name: "技巧挑战" },
  { position: 19, type: "event", name: "欢乐舞台" },
  { position: 20, type: "science", name: "营养科普站二" },
  { position: 21, type: "shop", name: "甜品王国" },
  { position: 22, type: "battle", name: "连环挑战" },
  { position: 23, type: "cardSlot", name: "精英驿站二", tier: "T2" },
  { position: 24, type: "event", name: "周末舞台" },
  { position: 25, type: "rest", name: "小憩花园" },
  { position: 26, type: "shop", name: "欢乐商店" },
  { position: 27, type: "battle", name: "终极挑战" },
  { position: 28, type: "cardSlot", name: "核心驿站", tier: "T1" },
  { position: 29, type: "event", name: "终幕舞台" }
];

// 胜利目标定义
const VICTORY_TYPES = [
  { key: "fame", name: "欢乐值最高", desc: "结算时欢乐值最高者获胜" },
  { key: "collection", name: "卡牌收藏最多", desc: "收集角色卡最多者获胜" },
  { key: "reach", name: "率先抵达终点", desc: "有棋子到达终点线者获胜" },
  { key: "shield", name: "欢乐护盾最多", desc: "累计获得护盾最多者获胜" }
];

// 深拷贝对局状态（用于 History API 快照）
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// 归一化棋盘位置：棋盘下标为 0-29，因此直接取模即可
// 注意：30 的倍数必须归到 0（旧实现会返回 30 导致数组越界）
function normalizePosition(position) {
  const value = Number(position || 0);
  if (value <= 0) {
    return 0;
  }
  return value % BOARD_SIZE;
}

// 计算绕圈次数
function countLoops(player) {
  return Math.floor((player.position || 0) / BOARD_SIZE);
}

// 创建新对局
function createGame(options, callback) {
  const playerCount = Math.max(2, Math.min(Number(options.playerCount || 4), 6));
  const victoryType = options.victoryType || "fame";
  const totalRounds = Number(options.totalRounds || 3);

  const players = [];
  for (let i = 0; i < playerCount; i += 1) {
    const charId = Number((options.characterIds || [])[i]) || (i % CHARACTERS.length) + 1;
    const character = CHARACTERS.find((item) => item.id === charId) || CHARACTERS[i];
    players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      characterId: character.id,
      characterName: character.name,
      emoji: character.emoji,
      position: 0,
      fame: 0,
      shield: 0,
      cards: [character.id],
      loops: 0
    });
  }

  const game = {
    version: 1,
    id: `game-${Date.now()}`,
    createdAt: new Date().toISOString(),
    playerCount,
    victoryType,
    totalRounds,
    currentPlayerIndex: 0,
    round: 1,
    status: "playing",
    players,
    logs: [],
    lastRoll: 0,
    pendingCell: null,
    // 事件触发的临时行动权：额外掷骰（同一玩家继续）/ 跳过下一回合
    extraRollFor: 0,
    skipNextFor: 0,
    // History API 使用的历史栈（最多保留 30 步，防止内存膨胀）
    history: []
  };

  addLog(game, null, "start", `麦麦奇幻乐园开园！${playerCount} 位见习小厨师就位，目标：${getVictoryName(victoryType)}`);
  callback(null, game);
}

// 写入日志
function addLog(game, playerId, logType, content, data) {
  const logs = game.logs || [];
  logs.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    playerId: playerId || null,
    logType,
    content,
    data: data || null,
    createdAt: new Date().toISOString()
  });
  // 只保留最近 60 条，避免快照过大
  if (logs.length > 60) {
    logs.splice(0, logs.length - 60);
  }
}

// 获取胜利目标名称
function getVictoryName(typeKey) {
  const found = VICTORY_TYPES.find((item) => item.key === typeKey);
  return found ? found.name : "欢乐值最高";
}

// 应用数值变化（数值不低于 0）
function applyStatChanges(player, changes) {
  const result = [];
  const keys = Object.keys(changes || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const delta = Number(changes[key] || 0);
    if (delta === 0) {
      continue;
    }
    const before = Number(player[key] || 0);
    player[key] = Math.max(0, before + delta);
    const realDelta = player[key] - before;
    if (realDelta !== 0) {
      result.push({ key, delta: realDelta });
    }
  }
  return result;
}

// 推进玩家位置（计算绕圈与奖励）
function applyMove(player, steps, game) {
  const before = normalizePosition(player.position);
  const rawNext = player.position + steps;
  const next = normalizePosition(rawNext);
  const loops = Math.floor(rawNext / BOARD_SIZE);

  player.position = next;
  player.loops += loops;

  const results = { from: before, to: next, loops };

  // 绕圈奖励
  if (loops > 0) {
    const reward = LOOP_REWARD * loops;
    player.fame += reward;
    results.loopReward = reward;
    addLog(game, player.id, "loop", `${player.name} 完成 ${loops} 圈，获得欢乐值 +${reward}`);
  }
  return results;
}

// 掷骰子并移动
function rollDice(game, playerIndex, callback) {
  const index = playerIndex === undefined ? game.currentPlayerIndex : playerIndex;
  const player = game.players[index];
  if (!player) {
    callback(new Error("玩家不存在"), null);
    return;
  }

  const dice = Math.floor(Math.random() * 6) + 1;
  game.lastRoll = dice;

  // 记录历史快照（供 History API 回退）
  pushHistory(game);

  const moveResult = applyMove(player, dice, game);
  const cell = BOARD[moveResult.to];
  game.pendingCell = { position: moveResult.to, type: cell.type, name: cell.name };

  addLog(game, player.id, "roll", `${player.name} 掷出 ${dice} 点，移动 ${moveResult.from} → ${moveResult.to}（${cell.name}）`);

  callback(null, { dice, player, moveResult, cell });
}

// 结算当前格子的效果
function resolveCell(game, playerIndex, callback) {
  const index = playerIndex === undefined ? game.currentPlayerIndex : playerIndex;
  const player = game.players[index];
  if (!player || !game.pendingCell) {
    callback(new Error("没有待结算的格子"), null);
    return;
  }

  const cellType = game.pendingCell.type;
  const cellName = game.pendingCell.name;
  let result = { type: cellType, name: cellName, effects: [], message: "" };

  switch (cellType) {
    case "start": {
      const changes = applyStatChanges(player, { fame: 1 });
      result.effects = changes;
      result.message = `经过金色拱门，欢乐值 +1`;
      addLog(game, player.id, "cell", `${player.name} 经过金色拱门，欢乐值 +1`);
      break;
    }
    case "rest": {
      const changes = applyStatChanges(player, { shield: 1 });
      result.effects = changes;
      result.message = `在${cellName}休息，欢乐护盾 +1`;
      addLog(game, player.id, "cell", `${player.name} 在${cellName} 休息，获得护盾 1`);
      break;
    }
    case "cardSlot": {
      const targetTier = cellTier(game, playerIndex);
      const pool = CHARACTERS.filter((item) => item.tier === targetTier);
      const picked = pool[Math.floor(Math.random() * pool.length)] || CHARACTERS[0];
      player.cards.push(picked.id);
      result.message = `获得新卡牌：${picked.name}`;
      result.card = picked;
      addLog(game, player.id, "card", `${player.name} 在${cellName} 获得卡牌【${picked.name}】`);
      break;
    }
    case "battle": {
      // 战斗：玩家力量 + 骰子 vs 难度
      const character = CHARACTERS.find((item) => item.id === player.characterId);
      const power = character.force + game.lastRoll;
      const difficulty = 60 + Math.floor(Math.random() * 40);
      const win = power >= difficulty;
      const changes = win ? applyStatChanges(player, { fame: 2, shield: 1 }) : applyStatChanges(player, { fame: -1 });
      result.battle = { power, difficulty, win };
      result.effects = changes;
      result.message = win
        ? `欢乐挑战胜利（${power} vs ${difficulty}），欢乐值 +2、护盾 +1`
        : `欢乐挑战失败（${power} vs ${difficulty}），欢乐值 -1`;
      addLog(game, player.id, "battle", `${player.name} ${result.message}`);
      break;
    }
    case "shop": {
      result.message = `进入${cellName}，可消耗欢乐值购买卡牌`;
      result.shop = true;
      addLog(game, player.id, "cell", `${player.name} 进入${cellName}`);
      break;
    }
    case "event": {
      result.message = `在${cellName} 抽取事件卡`;
      result.needEvent = true;
      addLog(game, player.id, "cell", `${player.name} 触发${cellName} 事件`);
      break;
    }
    default: {
      result.message = "无事发生";
    }
  }

  callback(null, result);
}

// 取格子的卡池稀有度
function cellTier(game, playerIndex) {
  const cell = BOARD[normalizePosition(game.players[playerIndex].position)];
  return (cell && cell.tier) || "T2";
}

// 从当前位置向前找最近的一个指定类型格子（用于「传送」类事件）
// 找不到返回 -1，调用方需自行判断
function findNearestCell(fromPosition, cellType) {
  const start = normalizePosition(fromPosition);
  for (let step = 1; step <= BOARD_SIZE; step += 1) {
    const idx = (start + step) % BOARD_SIZE;
    if (BOARD[idx] && BOARD[idx].type === cellType) {
      return idx;
    }
  }
  return -1;
}

// 找欢乐值最高的对手（用于「夺取」「换位」类事件），平局时取 id 较小者
function findLeader(game, excludeId) {
  const others = game.players.filter((item) => item.id !== excludeId);
  if (!others.length) {
    return null;
  }
  let leader = others[0];
  for (let i = 1; i < others.length; i += 1) {
    if (others[i].fame > leader.fame) {
      leader = others[i];
    }
  }
  return leader;
}

// 应用事件卡效果
// 支持的效果字段见 game/event-pool.js 顶部注释（changes/move/teleport/extraRoll/
// steal/convert/drawTier/gamble/swapWithLeader/giftOpponent/skipTurn/double/discardOne）
function applyEvent(game, playerIndex, event, callback) {
  const player = game.players[playerIndex];
  if (!player) {
    callback(new Error("玩家不存在"), null);
    return;
  }

  pushHistory(game);

  const effect = event.effect || {};
  const changes = {};
  const target = effect.target || "current";

  if (target === "all") {
    game.players.forEach((item) => applyStatChanges(item, effect.changes || {}));
    changes.applied = "all";
  } else {
    applyStatChanges(player, effect.changes || {});
    changes.applied = "current";
  }

  // ===== 数值翻倍（欢乐加倍日）=====
  if (effect.double && effect.double.key) {
    const key = effect.double.key;
    const min = Number(effect.double.min || 2);
    player[key] = Math.max(min, Number(player[key] || 0) * 2);
    changes.doubled = { key, value: player[key] };
  }

  // ===== 位移（前进/后退）=====
  if (effect.move) {
    const from = player.position;
    const raw = player.position + Number(effect.move);
    const next = normalizePosition(raw < 0 ? BOARD_SIZE * 4 + raw : raw);
    player.position = next;
    if (raw >= BOARD_SIZE) {
      player.loops += Math.floor(raw / BOARD_SIZE);
    }
    changes.moved = { from, to: next, delta: Number(effect.move) };
  }

  // ===== 传送到指定类型的格子 =====
  if (effect.teleport) {
    const dest = findNearestCell(player.position, effect.teleport);
    if (dest !== -1 && dest !== player.position) {
      changes.teleported = { from: player.position, to: dest };
      player.position = dest;
      // 传送到卡牌驿站时顺带给一张卡，保证「传送」有实感
      if (effect.teleport === "cardSlot") {
        const pool = CHARACTERS.filter((item) => item.tier === "T2");
        const picked = pool[Math.floor(Math.random() * pool.length)];
        if (picked) {
          player.cards.push(picked.id);
          changes.drawCard = picked;
        }
      }
    }
  }

  // ===== 从欢乐值最高的对手夺取 =====
  if (effect.steal) {
    const leader = findLeader(game, player.id);
    if (leader) {
      const amount = Math.min(Number(effect.steal), leader.fame);
      leader.fame -= amount;
      player.fame += amount;
      changes.stolen = { from: leader.name, amount };
    }
  }

  // ===== 护盾换欢乐 =====
  if (effect.convert) {
    const rate = Number(effect.convert.rate || 2);
    if (player.shield > 0) {
      player.shield -= 1;
      player.fame += rate;
      changes.converted = { shield: -1, fame: rate };
    } else {
      changes.convertFailed = true;
    }
  }

  // ===== 与领先者交换位置 =====
  if (effect.swapWithLeader) {
    const leader = findLeader(game, player.id);
    if (leader) {
      const tmp = leader.position;
      leader.position = player.position;
      player.position = tmp;
      changes.swapped = { with: leader.name };
    }
  }

  // ===== 送礼给一位对手 =====
  if (effect.giftOpponent) {
    const others = game.players.filter((item) => item.id !== player.id);
    if (others.length) {
      const lucky = others[Math.floor(Math.random() * others.length)];
      lucky.fame += Number(effect.giftOpponent);
      changes.gifted = { to: lucky.name, amount: Number(effect.giftOpponent) };
    }
  }

  // ===== 赌博：二选一随机 =====
  if (effect.gamble) {
    const win = Math.random() < 0.5;
    const delta = win ? (effect.gamble.win || {}) : (effect.gamble.lose || {});
    applyStatChanges(player, delta);
    changes.gamble = { win, delta };
  }

  // ===== 额外掷骰（同一玩家继续行动）=====
  if (effect.extraRoll) {
    game.extraRollFor = player.id;
    changes.extraRoll = Number(effect.extraRoll);
  }

  // ===== 跳过下一回合 =====
  if (effect.skipTurn) {
    game.skipNextFor = player.id;
    changes.skipTurn = Number(effect.skipTurn);
  }

  // ===== 抽卡类效果 =====
  if (effect.drawTier) {
    const pool = CHARACTERS.filter((item) => item.tier === effect.drawTier);
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (picked) {
      player.cards.push(picked.id);
      changes.drawCard = picked;
    }
  }

  // ===== 弃一张旧卡（交换市集）=====
  if (effect.discardOne && player.cards.length > 1) {
    // 弃掉最早获得的一张（保留初始角色卡之外的第一张）
    const dropped = player.cards.splice(1, 1)[0];
    changes.discarded = dropped;
  }

  game.pendingCell = null;
  // 兼容事件卡两种字段命名（desc / description）
  const eventDesc = event.desc || event.description || "";
  addLog(game, player.id, "event", `【${event.title}】${player.name}：${eventDesc}`);

  // 事件结算后同样要进行胜利判定（与非事件格子保持一致的链路）
  const victory = checkVictory(game);
  if (victory) {
    game.status = "finished";
    game.result = victory;
    const names = victory.winners.map((item) => item.name).join("、");
    addLog(game, null, "finish", `对局结束，${victory.reason}，获胜者：${names}`);
  }

  callback(null, { changes, event, victory });
}

// 推进一位玩家（返回 "finish" 表示回合用尽需结算）
function advanceTurn(game) {
  game.currentPlayerIndex += 1;
  if (game.currentPlayerIndex >= game.playerCount) {
    game.currentPlayerIndex = 0;
    game.round += 1;
    if (game.round > game.totalRounds) {
      return "finish";
    }
    addLog(game, null, "round", `第 ${game.round} 回合开始`);
  }
  return "ok";
}

// 推进到下一位玩家
// 两种事件会改变行动顺序：
//   extraRollFor —— 同一玩家再掷一次（不换人、不计新回合）
//   skipNextFor  —— 被标记玩家的下一个回合直接跳过
function nextTurn(game, callback) {
  pushHistory(game);

  if (game.extraRollFor) {
    const extraIdx = game.players.findIndex((item) => item.id === game.extraRollFor);
    game.extraRollFor = 0;
    if (extraIdx !== -1) {
      game.currentPlayerIndex = extraIdx;
      addLog(game, game.players[extraIdx].id, "extra", `${game.players[extraIdx].name} 获得额外掷骰机会`);
      callback(null, game);
      return;
    }
  }

  if (advanceTurn(game) === "finish") {
    finishGame(game, callback);
    return;
  }

  if (game.skipNextFor && game.players[game.currentPlayerIndex].id === game.skipNextFor) {
    addLog(game, game.skipNextFor, "skip", `${game.players[game.currentPlayerIndex].name} 本回合被事件跳过`);
    game.skipNextFor = 0;
    if (advanceTurn(game) === "finish") {
      finishGame(game, callback);
      return;
    }
  }

  callback(null, game);
}

// 写入历史快照
function pushHistory(game) {
  const snap = {
    currentPlayerIndex: game.currentPlayerIndex,
    round: game.round,
    lastRoll: game.lastRoll,
    pendingCell: game.pendingCell ? clone(game.pendingCell) : null,
    players: clone(game.players)
  };
  game.history.push(snap);
  // 限制历史栈长度，防止内存无限增长
  if (game.history.length > 30) {
    game.history.splice(0, game.history.length - 30);
  }
}

// History API 专用：回退到上一步
function undoStep(game, callback) {
  if (!game.history || !game.history.length) {
    callback(new Error("没有可回退的历史"), null);
    return;
  }
  const snap = game.history.pop();
  game.currentPlayerIndex = snap.currentPlayerIndex;
  game.round = snap.round;
  game.lastRoll = snap.lastRoll;
  game.pendingCell = snap.pendingCell;
  game.players = snap.players;
  addLog(game, null, "undo", "已回退上一步操作");
  callback(null, game);
}

// 胜利判定
function checkVictory(game, force) {
  // force=true 表示强制结算（如回合用尽），此时不再检查对局状态
  if (!force && game.status !== "playing") {
    return null;
  }
  const type = game.victoryType;
  const players = game.players;

  // ===== 累积型目标只在回合用尽时结算 =====
  // 「欢乐值最高 / 收藏最多 / 护盾最多」是终局比较型目标，中途某人领先不算赢。
  // 早期这几个分支没有先判 force，导致第一个回合有人拿到 +2 欢乐值就判定游戏结束；
  // collection 分支更严重——它无任何前置判断，调用即返回胜者。
  if (type === "fame" || type === "collection" || type === "shield") {
    if (!force) {
      return null;
    }
  }

  if (type === "fame") {
    const max = Math.max.apply(null, players.map((item) => item.fame));
    const winners = players.filter((item) => item.fame === max);
    return winners.length ? { type, winners, reason: `欢乐值最高（${max}）` } : null;
  }

  if (type === "collection") {
    const max = Math.max.apply(null, players.map((item) => item.cards.length));
    const winners = players.filter((item) => item.cards.length === max);
    return winners.length ? { type, winners, reason: `收藏卡牌最多（${max} 张）` } : null;
  }

  if (type === "shield") {
    const max = Math.max.apply(null, players.map((item) => item.shield));
    const winners = players.filter((item) => item.shield === max);
    return winners.length ? { type, winners, reason: `护盾最多（${max}）` } : null;
  }

  if (type === "reach") {
    const finished = players.filter((item) => item.loops > 0);
    if (finished.length) {
      const maxLoop = Math.max.apply(null, finished.map((item) => item.loops));
      const winners = finished.filter((item) => item.loops === maxLoop);
      return { type, winners, reason: `率先抵达终点（${maxLoop} 圈）` };
    }
    if (!force) {
      return null;
    }
    // 回合用尽仍无人跑完一圈：按累计行进里程决出胜负。
    // 棋盘 30 格 + 回合上限 5，靠掷骰跑完一圈几乎不可能，
    // 早期一律判平局会让这个玩法恒定没有胜者。
    const dists = players.map((item) => item.loops * BOARD_SIZE + item.position);
    const farthest = Math.max.apply(null, dists);
    const winners = players.filter((item) => item.loops * BOARD_SIZE + item.position === farthest);
    return winners.length
      ? { type, winners, reason: `行进最远（累计 ${farthest} 格）` }
      : null;
  }

  return null;
}

// 结束对局并结算
function finishGame(game, callback) {
  // 注意顺序：必须先做胜利判定，再改status，
  // 否则 checkVictory 内会因 status 已非 playing 而直接返回 null
  const result = checkVictory(game, true);
  game.status = "finished";
  game.result = result;
  if (result && result.winners && result.winners.length) {
    const names = result.winners.map((item) => item.name).join("、");
    addLog(game, null, "finish", `对局结束，${result.reason}，获胜者：${names}`);
  } else {
    addLog(game, null, "finish", "对局结束，本局平局");
  }
  callback(null, game);
}

module.exports = {
  BOARD_SIZE,
  LOOP_REWARD,
  BOARD,
  CELL_TYPES,
  VICTORY_TYPES,
  CHARACTERS,
  createGame,
  rollDice,
  resolveCell,
  applyEvent,
  nextTurn,
  undoStep,
  checkVictory,
  finishGame,
  addLog,
  getVictoryName,
  normalizePosition,
  findNearestCell,
  findLeader
};