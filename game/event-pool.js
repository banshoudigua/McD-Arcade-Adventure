// 事件卡池：麦麦奇幻乐园的随机事件系统
// 设计目标：让「事件格」真正影响局面（位移/夺取/传送/再掷一次），而不只是加减欢乐值
//
// 效果字段统一约定（前端 web/app.js 与后端 game/engine.js 必须同步实现）：
//   target      作用对象：current(自己) / all(全体) / leader(欢乐值最高的对手) / randomOpponent
//   changes     数值增减：{ fame: n, shield: n }
//   move        位移格数：正数前进、负数后退
//   teleport    传送目标类型：cardSlot / shop / start / science / battle
//   extraRoll   额外掷骰次数（同一玩家继续行动）
//   steal       从欢乐值最高的对手夺取的点数
//   convert     属性转换：{ from:"shield", to:"fame", rate:2 }（1 护盾换 2 欢乐）
//   drawTier    抽卡稀有度：T1 / T2
//   gamble      赌博式二选一：{ win:{fame:3}, lose:{fame:-2} }
//   skipTurn    跳过下一回合
//   double      数值翻倍：{ key:"fame", min:2 }（min 为当前值为 0 时的保底）
//
// kind：good(增益) / bad(减益) / interact(互动)
// rarity：common(常见) / rare(稀有) / epic(史诗)，决定抽取权重

var RARITY_WEIGHT = { common: 6, rare: 3, epic: 1 };

// ===== 内置特色事件卡（麦当劳主题，效果 richer than 单纯加减分）=====
var EVENT_POOL = [
  // ---- 增益类 ----
  {
    id: "e-burger-out",
    title: "汉堡新鲜出炉",
    kind: "good",
    rarity: "common",
    desc: "后厨刚出炉一批汉堡，全场都能闻到香味",
    effect: { target: "all", changes: { fame: 1 } }
  },
  {
    id: "e-buyone-getone",
    title: "麦旋风买一送一",
    kind: "good",
    rarity: "common",
    desc: "甜品站限时买一送一，快来排队！",
    effect: { target: "current", changes: { fame: 2 }, drawTier: "T2" }
  },
  {
    id: "e-double-joy",
    title: "欢乐加倍日",
    kind: "good",
    rarity: "epic",
    desc: "今天是乐园欢乐加倍日，你的欢乐值翻倍！",
    effect: { target: "current", changes: {}, double: { key: "fame", min: 2 } }
  },
  {
    id: "e-soda-refill",
    title: "汽水免费续杯",
    kind: "good",
    rarity: "common",
    desc: "气泡加满，脚步也变轻快了，向前冲！",
    effect: { target: "current", changes: {}, move: 2 }
  },
  {
    id: "e-collab-gift",
    title: "联名周边大派送",
    kind: "good",
    rarity: "rare",
    desc: "限定联名周边到货，抽一张稀有伙伴卡",
    effect: { target: "current", changes: { fame: 1 }, drawTier: "T1" }
  },
  {
    id: "e-golden-parade",
    title: "金色拱门巡游",
    kind: "good",
    rarity: "common",
    desc: "巡游队伍经过，每位小厨师都领到护盾气球",
    effect: { target: "all", changes: { shield: 1 } }
  },
  {
    id: "e-lucky-fries",
    title: "幸运薯条",
    kind: "good",
    rarity: "rare",
    desc: "抽出一根超长薯条！获得额外一次掷骰机会",
    effect: { target: "current", changes: { fame: 1 }, extraRoll: 1 }
  },
  {
    id: "e-free-cone",
    title: "免费甜筒券",
    kind: "good",
    rarity: "common",
    desc: "凭券领甜筒一枚，心情大好加速前进",
    effect: { target: "current", changes: { fame: 1 }, move: 3 }
  },
  {
    id: "e-express",
    title: "麦乐送速达",
    kind: "good",
    rarity: "rare",
    desc: "外卖小哥抄近路，直接把你送到最近的卡牌驿站",
    effect: { target: "current", changes: {}, teleport: "cardSlot" }
  },
  {
    id: "e-birthday",
    title: "生日派对专场",
    kind: "good",
    rarity: "rare",
    desc: "乐园生日会开场，全场欢乐与护盾齐涨",
    effect: { target: "all", changes: { fame: 1, shield: 1 } }
  },
  {
    id: "e-nutrition-class",
    title: "营养小课堂",
    kind: "good",
    rarity: "common",
    desc: "学会看懂营养表，健康知识就是最好的护盾",
    effect: { target: "current", changes: { shield: 2 } }
  },

  // ---- 减益类 ----
  {
    id: "e-dessert-queue",
    title: "甜品站大排长龙",
    kind: "bad",
    rarity: "common",
    desc: "队伍排到门口，等得有点着急，但拿到了号码牌",
    effect: { target: "current", changes: { fame: -1, shield: 1 } }
  },
  {
    id: "e-fries-spill",
    title: "薯条撒了一地",
    kind: "bad",
    rarity: "common",
    desc: "哎呀，薯条撒了，只能退回去重新拿一份",
    effect: { target: "current", changes: { fame: -1 }, move: -2 }
  },
  {
    id: "e-sold-out",
    title: "招牌汉堡售罄",
    kind: "bad",
    rarity: "common",
    desc: "来晚了一步，今天的招牌已经卖完了",
    effect: { target: "current", changes: { fame: -1 } }
  },
  {
    id: "e-rainy-day",
    title: "突然下起大雨",
    kind: "bad",
    rarity: "rare",
    desc: "没带伞，大家都被淋湿了，欢乐值集体下降",
    effect: { target: "all", changes: { fame: -1 } }
  },
  {
    id: "e-ice-melt",
    title: "冰淇淋融化了",
    kind: "bad",
    rarity: "common",
    desc: "甜筒化得太快，护盾也跟着掉了一点",
    effect: { target: "current", changes: { fame: -1, shield: -1 } }
  },
  {
    id: "e-tray-stuck",
    title: "托盘卡住了",
    kind: "bad",
    rarity: "rare",
    desc: "托盘卡在取餐口，本回合动弹不得",
    effect: { target: "current", changes: { fame: -1 }, skipTurn: 1 }
  },

  // ---- 互动类 ----
  {
    id: "e-coupon-steal",
    title: "麦麦省发券",
    kind: "interact",
    rarity: "rare",
    desc: "抢到一张热门券，从领先的伙伴那里借走 1 点欢乐",
    effect: { target: "current", changes: {}, steal: 1 }
  },
  {
    id: "e-share-meal",
    title: "分享套餐",
    kind: "interact",
    rarity: "common",
    desc: "把套餐分给一位伙伴，大家都更开心",
    effect: { target: "current", changes: { fame: 1 }, giftOpponent: 1 }
  },
  {
    id: "e-shield-convert",
    title: "护盾兑换欢乐",
    kind: "interact",
    rarity: "rare",
    desc: "把护盾气球换成了欢乐值，1 点护盾换 2 点欢乐",
    effect: { target: "current", changes: {}, convert: { from: "shield", to: "fame", rate: 2 } }
  },
  {
    id: "e-swap-place",
    title: "排队换位",
    kind: "interact",
    rarity: "epic",
    desc: "和跑在最前面的伙伴交换了位置！",
    effect: { target: "current", changes: {}, swapWithLeader: 1 }
  },
  {
    id: "e-lucky-wheel",
    title: "幸运大转盘",
    kind: "interact",
    rarity: "rare",
    desc: "转盘停下——可能 +3，也可能 -2，敢不敢赌一把？",
    effect: { target: "current", changes: {}, gamble: { win: { fame: 3 }, lose: { fame: -2 } } }
  },
  {
    id: "e-card-exchange",
    title: "卡牌交换市集",
    kind: "interact",
    rarity: "common",
    desc: "用一张旧卡换来了一张新伙伴卡",
    effect: { target: "current", changes: {}, drawTier: "T2", discardOne: 1 }
  },
  {
    id: "e-store-open",
    title: "新店开业典礼",
    kind: "interact",
    rarity: "common",
    desc: "新店开张送好礼，全体获得一次进店机会的加成",
    effect: { target: "all", changes: { fame: 1 }, drawTier: "T2" }
  }
];

// 按稀有度权重随机抽一张（不使用 Math.random 之外的依赖）
function pickEvent(pool, rng) {
  var list = pool && pool.length ? pool : EVENT_POOL;
  var random = rng || Math.random;

  var total = 0;
  var i;
  for (i = 0; i < list.length; i += 1) {
    total += RARITY_WEIGHT[list[i].rarity] || RARITY_WEIGHT.common;
  }

  var ticket = random() * total;
  for (i = 0; i < list.length; i += 1) {
    ticket -= RARITY_WEIGHT[list[i].rarity] || RARITY_WEIGHT.common;
    if (ticket <= 0) {
      return list[i];
    }
  }
  return list[list.length - 1];
}

// 合并「真实活动卡」与「内置特色卡」，并去重（真实卡优先展示在前）
function mergeEvents(realEvents, builtinPool) {
  var builtin = builtinPool || EVENT_POOL;
  var out = [];
  var seen = {};
  var i;

  for (i = 0; i < (realEvents || []).length; i += 1) {
    var real = realEvents[i];
    if (!real || !real.title) {
      continue;
    }
    seen[real.title] = true;
    out.push(real);
  }

  for (i = 0; i < builtin.length; i += 1) {
    if (seen[builtin[i].title]) {
      continue;
    }
    out.push(builtin[i]);
  }

  return out;
}

// 把事件效果翻译成人话（前端弹窗与后端日志共用同一套语义）
function describeEffect(effect) {
  var parts = [];
  if (!effect) {
    return "";
  }
  var changes = effect.changes || {};
  if (changes.fame) {
    parts.push("欢乐值 " + (changes.fame > 0 ? "+" + changes.fame : changes.fame));
  }
  if (changes.shield) {
    parts.push("护盾 " + (changes.shield > 0 ? "+" + changes.shield : changes.shield));
  }
  if (effect.move) {
    parts.push(effect.move > 0 ? "前进 " + effect.move + " 格" : "后退 " + Math.abs(effect.move) + " 格");
  }
  if (effect.teleport) {
    var tpName = { cardSlot: "卡牌驿站", shop: "商店", start: "起点", science: "营养科普站", battle: "挑战格" };
    parts.push("传送到最近的" + (tpName[effect.teleport] || effect.teleport));
  }
  if (effect.extraRoll) {
    parts.push("额外掷骰 " + effect.extraRoll + " 次");
  }
  if (effect.steal) {
    parts.push("从领先者夺取 " + effect.steal + " 点欢乐");
  }
  if (effect.convert) {
    parts.push("1 点护盾换 " + effect.convert.rate + " 点欢乐");
  }
  if (effect.drawTier) {
    parts.push("抽一张 " + effect.drawTier + " 伙伴卡");
  }
  if (effect.gamble) {
    parts.push("赌博：+3 或 -2 欢乐值");
  }
  if (effect.swapWithLeader) {
    parts.push("与领先者交换位置");
  }
  if (effect.giftOpponent) {
    parts.push("送 " + effect.giftOpponent + " 点欢乐给一位伙伴");
  }
  if (effect.skipTurn) {
    parts.push("跳过下一回合");
  }
  if (effect.discardOne) {
    parts.push("弃 1 张旧卡");
  }
  if (effect.double) {
    var dblName = effect.double.key === "fame" ? "欢乐值" : "护盾";
    parts.push(dblName + "翻倍");
  }
  return parts.join("，");
}

module.exports = {
  EVENT_POOL,
  RARITY_WEIGHT,
  pickEvent,
  mergeEvents,
  describeEffect
};
