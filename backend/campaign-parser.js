// 活动解析器：把 MCP campaign-calendar 返回的 DSL 文本解析为结构化活动对象
// 用途：驱动前端事件卡，使事件卡内容来自麦当劳真实营销活动而非虚构
// 解析失败时降级返回内置卡组，保证游戏可玩

// 内置兜底活动（真实活动解析失败时使用）
var FALLBACK_CAMPAIGNS = [
  { title: "限时新品上架", intro: "全场新品登场，任选一份餐品带走", img: "" },
  { title: "麦麦省发券", intro: "领取优惠券，欢乐值翻倍机会", img: "" },
  { title: "联名活动开启", intro: "跨界联名好物，收集卡牌赢大奖", img: "" },
  { title: "儿童乐园开放日", intro: "乐园开放，全场欢乐值加成", img: "" },
  { title: "门店活动日", intro: "到店即享专属活动福利", img: "" },
  { title: "汉堡出炉", intro: "新鲜出炉的美味汉堡", img: "" },
  { title: "汽水续杯", intro: "清爽气泡补充无限欢乐", img: "" },
  { title: "甜品柜补货", intro: "甜品新鲜补货，欢迎品尝", img: "" },
  { title: "营养小课堂", intro: "了解餐品营养，健康快乐成长", img: "" },
  { title: "欢乐加倍日", intro: "今日欢乐值双倍计算", img: "" },
  { title: "金色拱门巡游", intro: "金色拱门开启欢乐巡游", img: "" },
  { title: "生日专属礼遇", intro: "生日月专属派对礼遇", img: "" }
];

// 活动对游戏属性的影响规则（按标题关键词匹配）
// 除 fame/shield/drawTier 外，新增位移、夺取、传送、额外掷骰等效果，
// 让真实活动卡也能触发「影响局面」的事件，而不是只会加减分
var EFFECT_RULES = [
  { keys: ["早餐", "咖啡", "早", "元气"], title: "元气早餐时光", fame: 1, shield: 1, move: 1 },
  { keys: ["联名", "合作", "PEACEMINUSONE", "跨界"], title: "联名惊喜派对", fame: 2, drawTier: "T1", rarity: "rare" },
  { keys: ["新品", "上新", "新地", "麦旋风", "新风味"], title: "新品尝鲜奖励", fame: 1, drawTier: "T2" },
  { keys: ["派对", "生日", "庆祝"], title: "派对欢乐时光", fame: 2, shield: 1, targetAll: true },
  { keys: ["券", "优惠", "折", "元起", "免费"], title: "优惠券助力", fame: 2, steal: 1 },
  { keys: ["酱", "辣", "韩式", "炸鸡", "鸡"], title: "美味加料", fame: 1, shield: 1 },
  { keys: ["儿童", "亲子", "小朋友", "乐园"], title: "亲子欢乐日", fame: 2, shield: 2, targetAll: true },
  { keys: ["读书", "学习", "课堂"], title: "知识小课堂", shield: 2, teleport: "science" },
  { keys: ["玩具", "周边", "礼品"], title: "周边大赏", fame: 2, drawTier: "T1", rarity: "rare" },
  { keys: ["咖啡", "拿铁", "美式"], title: "咖啡提神时刻", fame: 1, extraRoll: 1, rarity: "rare" },
  { keys: ["薯条", "小食", "脆"], title: "小食补给站", fame: 1, move: 2 },
  { keys: ["甜品", "冰淇淋", "雪糕", "甜筒"], title: "甜品补给站", fame: 2, convert: { rate: 2 } },
  { keys: ["会员", "积分", "麦享会"], title: "会员专属礼遇", fame: 3, rarity: "epic" },
  { keys: ["店", "门店", "开业", "到店"], title: "到店惊喜礼", fame: 1, teleport: "shop" },
  { keys: ["限时", "秒杀", "抢"], title: "限时冲刺", fame: 1, extraRoll: 1, rarity: "rare" },
  { keys: ["套餐", "超值", "划算"], title: "超值套餐分享", fame: 1, giftOpponent: 1 }
];

/**
 * 解析活动日历原始文本
 * @param {string} rawText campaign-calendar 返回的原始 DSL 文本
 * @param {function} callback 回调函数 (err, campaigns)
 */
function parseCampaigns(rawText, callback) {
  if (!rawText || typeof rawText !== "string") {
    callback(null, buildFromFallback());
    return;
  }

  var campaigns = [];
  var lines = rawText.split("\n");
  // 预扫描：建立「行号 → 日期分组」映射，解决标题在分组之后出现导致日期丢失的问题
  var dateByLine = {};
  var pendingDate = "";
  var pendingStatus = "";
  for (var p = 0; p < lines.length; p += 1) {
    var scan = lines[p].trim();
    // 遇到新的日期分组就更新当前分组（状态随分组走，不继承到下一组）
    var scanMatch = scan.match(/####\s*(\d{4}年\d{1,2}月\d{1,2}日)\s*(.*)/);
    if (scanMatch) {
      pendingDate = scanMatch[1];
      // 状态只对紧随其后的活动生效，遇到新分组重新赋值
      pendingStatus = scanMatch[2] || "";
    }
    // 该行之后的活动归属于当前分组
    dateByLine[p] = { date: pendingDate, status: pendingStatus };
  }

  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i].trim();

    // 提取活动标题
    if (line.indexOf("**活动标题**") !== -1) {
      var title = line.replace(/^[-*\s]*\*\*活动标题\*\*[：:]\s*/, "").trim();

      // 向下查找活动内容介绍与图片
      var intro = "";
      var img = "";
      for (var j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
        var next = lines[j];
        // 遇到下一个活动或新的日期分组就停止，避免串到下一个活动的信息
        if (next.indexOf("**活动标题**") !== -1 || next.indexOf("####") === 0) {
          break;
        }
        if (!intro && next.indexOf("活动内容介绍") !== -1) {
          // 内容可能跨多行，取本行冒号后的部分
          var afterColon = next.replace(/^[\s*]*\*\*活动内容介绍\*\*[：:]\s*/, "").trim();
          intro = afterColon;
        } else if (!intro && next.length > 4 && next.indexOf("#") !== 0 && next.indexOf("**") !== 0) {
          intro = next.trim();
        }
        if (!img && next.indexOf("img src=") !== -1) {
          var srcMatch = next.match(/src="([^"]+)"/);
          if (srcMatch) {
            img = srcMatch[1];
          }
        }
      }

      // 根据标题关键词匹配游戏效果
      var matched = null;
      for (var k = 0; k < EFFECT_RULES.length; k += 1) {
        var rule = EFFECT_RULES[k];
        for (var m = 0; m < rule.keys.length; m += 1) {
          if (title.indexOf(rule.keys[m]) !== -1) {
            matched = rule;
            break;
          }
        }
        if (matched) {
          break;
        }
      }

      // 未匹配到规则时给一个通用效果
      var effectRule = matched || { title: "欢乐活动日", fame: 1 };

      var group = dateByLine[i] || { date: "", status: "" };
      campaigns.push({
        title: title,
        intro: intro.slice(0, 60),
        fullIntro: intro,
        img: img,
        date: group.date,
        // 是否进行中：标记为「今日」或状态含进行中，且不能是往期回顾
        isActive: group.status.indexOf("往期") === -1 &&
                  (group.status.indexOf("今日") !== -1 || group.status.indexOf("进行") !== -1 || group.status === ""),
        isPast: group.status.indexOf("往期") !== -1,
        // 游戏内事件名（用规则名覆盖原标题更简洁）
        gameTitle: effectRule.title,
        effect: buildEffect(effectRule),
        kind: "good",
        rarity: effectRule.rarity || "common",
        // 保留原标题，前端弹窗展示「真实活动来源」
        source: "campaign-calendar"
      });
    }
  }

  if (!campaigns.length) {
    callback(null, buildFromFallback());
    return;
  }

  // 排序：进行中 > 未来活动 > 往期回顾
  campaigns.sort(function (a, b) {
    var rankA = a.isActive ? 0 : (a.isPast ? 2 : 1);
    var rankB = b.isActive ? 0 : (b.isPast ? 2 : 1);
    return rankA - rankB;
  });

  callback(null, campaigns.slice(0, 12));
}

// 构造游戏效果对象
// 与 game/event-pool.js 的效果字段约定保持一致，前端与引擎按同一套字段结算
function buildEffect(rule) {
  var effect = { target: "current", changes: {} };
  if (rule.fame) {
    effect.changes.fame = rule.fame;
  }
  if (rule.shield) {
    effect.changes.shield = rule.shield;
  }
  if (rule.drawTier) {
    effect.drawTier = rule.drawTier;
  }
  // 位移：正前进、负后退
  if (rule.move) {
    effect.move = rule.move;
  }
  // 从领先玩家夺取欢乐值
  if (rule.steal) {
    effect.steal = rule.steal;
  }
  // 传送到指定类型的格子
  if (rule.teleport) {
    effect.teleport = rule.teleport;
  }
  // 额外掷骰一次
  if (rule.extraRoll) {
    effect.extraRoll = rule.extraRoll;
  }
  // 护盾换欢乐
  if (rule.convert) {
    effect.convert = { from: "shield", to: "fame", rate: rule.convert.rate || 2 };
  }
  // 送礼给一位对手
  if (rule.giftOpponent) {
    effect.giftOpponent = rule.giftOpponent;
  }
  // 全民活动（派对/亲子等）效果作用于全体
  if (rule.targetAll || rule.fame >= 2) {
    effect.target = "all";
  }
  return effect;
}

// 用兜底数据构造卡组（离线时同样按关键词规则生成效果，保证玩法一致）
function buildFromFallback() {
  var out = [];
  for (var i = 0; i < FALLBACK_CAMPAIGNS.length; i += 1) {
    var f = FALLBACK_CAMPAIGNS[i];
    var matched = null;
    for (var k = 0; k < EFFECT_RULES.length; k += 1) {
      var rule = EFFECT_RULES[k];
      for (var m = 0; m < rule.keys.length; m += 1) {
        if (f.title.indexOf(rule.keys[m]) !== -1) {
          matched = rule;
          break;
        }
      }
      if (matched) {
        break;
      }
    }
    var effectRule = matched || { title: "欢乐活动日", fame: 1 };
    out.push({
      title: f.title,
      gameTitle: effectRule.title,
      intro: f.intro,
      fullIntro: f.intro,
      img: f.img,
      date: "",
      isActive: false,
      isFallback: true,
      kind: "good",
      rarity: effectRule.rarity || "common",
      source: "fallback",
      effect: buildEffect(effectRule)
    });
  }
  return out;
}

// 合并真实活动卡与内置特色卡池，形成最终事件卡组
// 真实活动在前（体现 MCP 数据接入），内置卡补充玩法多样性
function buildEventDeck(realCampaigns) {
  var eventPool = require("../game/event-pool");
  return eventPool.mergeEvents(realCampaigns, eventPool.EVENT_POOL);
}

module.exports = { parseCampaigns, buildEventDeck, FALLBACK_CAMPAIGNS, EFFECT_RULES };
