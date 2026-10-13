// 营养科普模块：把 MCP 真实营养数据转化为儿童友好的知识关卡
// 目的：让游戏具备「边玩边学」的教育价值，同时展示 MCP 数据真实接入深度

// 从 MCP 快照中解析营养数据（list-nutrition-foods 返回的 DSL 格式）
function parseNutrition(rawText, callback) {
  if (!rawText || typeof rawText !== "string") {
    callback(null, []);
    return;
  }

  var foods = [];
  var lines = rawText.split("\n");

  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i].trim();
    // 跳过表头行（形如 "[160]{productName,..."）
    if (!line || line.charAt(0) === "[") {
      continue;
    }

    var parts = [];
    var segs = line.split(",");
    for (var j = 0; j < segs.length; j += 1) {
      parts.push(segs[j].trim());
    }
    // 字段顺序：名称,描述,能量kJ,热量kcal,蛋白质,脂肪,碳水,钠,钙
    if (parts.length < 9) {
      continue;
    }

    var kcal = Number(parts[3]);
    var protein = Number(parts[4]);
    var fat = Number(parts[5]);
    var carb = Number(parts[6]);
    var sodium = Number(parts[7]);
    var calcium = Number(parts[8]);

    if (isNaN(kcal) || isNaN(protein)) {
      continue;
    }

    foods.push({
      name: parts[0],
      kcal: kcal,
      protein: protein,
      fat: fat,
      carb: carb,
      sodium: sodium,
      calcium: calcium
    });
  }

  callback(null, foods);
}

// 生成一道营养知识判断题
// 题型：从 4 份餐品中选出「热量最低 / 蛋白质最高 / 碳水最低」
// 重要约束：4 个候选的指标数值必须互不相同，保证正确答案唯一
function makeQuestion(foodList, playerName, callback) {
  if (!foodList || foodList.length < 5) {
    callback(null, null);
    return;
  }

  // 题型：0=热量最低 1=蛋白质最高 2=碳水最低
  var configs = [
    { key: "kcal", label: "热量", unit: "kcal", desc: "哪一份的「热量」最低？", isMax: false },
    { key: "protein", label: "蛋白质", unit: "g", desc: "哪一份的「蛋白质」含量最高？", isMax: true },
    { key: "carb", label: "碳水", unit: "g", desc: "哪一份的「碳水化合物」最低？", isMax: false }
  ];
  var cfg = configs[Math.floor(Math.random() * configs.length)];

  // 按指标数值分组，同一数值只取一个候选，从根本上避免并列答案
  var groups = {};
  for (var i = 0; i < foodList.length; i += 1) {
    var item = foodList[i];
    var valKey = String(item[cfg.key]);
    if (!groups[valKey]) {
      groups[valKey] = [];
    }
    groups[valKey].push(item);
  }

  var valueKeys = Object.keys(groups);
  if (valueKeys.length < 4) {
    // 该指标可用数值不足 4 个，退回热量题型重试
    cfg = configs[0];
    groups = {};
    for (var j = 0; j < foodList.length; j += 1) {
      var it = foodList[j];
      var vk = String(it[cfg.key]);
      if (!groups[vk]) {
        groups[vk] = [];
      }
      groups[vk].push(it);
    }
    valueKeys = Object.keys(groups);
    if (valueKeys.length < 4) {
      callback(null, null);
      return;
    }
  }

  // 随机取 4 个互不相同的数值，每个数值组内随机取一个餐品
  valueKeys.sort(function () {
    return Math.random() - 0.5;
  });
  var pickedKeys = valueKeys.slice(0, 4);
  var options = [];
  for (var k = 0; k < pickedKeys.length; k += 1) {
    var group = groups[pickedKeys[k]];
    options.push(group[Math.floor(Math.random() * group.length)]);
  }

  // 找出极值项（数值已互不相同，结果必然唯一）
  var bestIdx = 0;
  var bestVal = options[0][cfg.key];
  for (var m = 1; m < options.length; m += 1) {
    var v = options[m][cfg.key];
    if (cfg.isMax ? v > bestVal : v < bestVal) {
      bestVal = v;
      bestIdx = m;
    }
  }

  callback(null, {
    question: cfg.desc,
    playerName: playerName,
    metric: cfg.label,
    unit: cfg.unit,
    metricKey: cfg.key,
    options: options,
    answerIndex: bestIdx,
    answerName: options[bestIdx].name,
    answerValue: bestVal
  });
}

module.exports = { parseNutrition, makeQuestion };
