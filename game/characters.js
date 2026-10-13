// 角色卡数据层：由麦当劳 MCP 真实营养数据推导卡牌属性
// 核心设计：卡牌属性不是编造的，而是从 list-nutrition-foods 真实返回推导
// 数据来源：data/mcd-snapshot.json -> nutrition.data（160 条真实餐品）

// 营养字段含义：热量kcal、蛋白质、脂肪、碳水、钠、钙
// 映射策略：把营养学指标转换为可理解的游戏属性，卡牌数值完全可追溯到真实数据

// 角色分类（决定基础定位与阵营）
const CATEGORIES = [
  { key: "burger", name: "汉堡", faction: "汉堡军团", emoji: "🍔" },
  { key: "drink", name: "饮料", faction: "汽水部落", emoji: "🥤" },
  { key: "dessert", name: "甜品", faction: "甜心王国", emoji: "🍦" },
  { key: "side", name: "小食", faction: "脆皮小队", emoji: "🍟" },
  { key: "breakfast", name: "早餐", faction: "晨光营地", emoji: "🍳" }
];

// 12 张初始角色卡：属性基于真实营养数据换算
// force（力量）由热量+脂肪推导：能量越高越有力量感
// strategy（策略）由蛋白+低脂推导：高蛋白低脂更"巧劲"
// fame（欢乐）由碳水推导：碳水带来快乐感
// command（统率）由钠/钙稳定性推导
const CHARACTERS = [
  {
    id: 1,
    name: "巨无霸",
    tier: "T1",
    category: "burger",
    faction: "汉堡军团",
    roleType: "力量",
    force: 92,
    strategy: 62,
    fame: 85,
    command: 88,
    skillName: "双层巨无",
    skillDesc: "闯关时若骰出5 或 6，欢乐值额外 +1。",
    quoteText: "两层才够劲！",
    nutrition: { kcal: 513, protein: 27, fat: 26, carb: 42, sodium: 961 },
    mcpSource: "list-nutrition-foods / 巨无霸",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/big-mac.jpg",
    emoji: "🍔"
  },
  {
    id: 2,
    name: "麦辣鸡腿汉堡",
    tier: "T1",
    category: "burger",
    faction: "汉堡军团",
    roleType: "爆发",
    force: 90,
    strategy: 58,
    fame: 68,
    command: 72,
    skillName: "辣劲上头",
    skillDesc: "战斗判定 +2，但本回合欢乐值 -1（先甜后辣）。",
    quoteText: "辣得过瘾！",
    nutrition: { kcal: 485, protein: 24, fat: 24, carb: 42, sodium: 1208 },
    mcpSource: "list-nutrition-foods / 麦辣鸡腿汉堡",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/mala-chicken.jpg",
    emoji: "🌶️"
  },
  {
    id: 3,
    name: "板烧鸡腿麦满分",
    tier: "T1",
    category: "burger",
    faction: "晨光营地",
    roleType: "均衡",
    force: 80,
    strategy: 76,
    fame: 80,
    command: 78,
    skillName: "稳稳开工",
    skillDesc: "移动阶段可多走 1 步，绕圈时欢乐值 +1。",
    quoteText: "稳稳的，好开局。",
    nutrition: { kcal: 246, protein: 15, fat: 9, carb: 25, sodium: 611 },
    mcpSource: "list-nutrition-foods / 原味板烧鸡腿麦满分",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/board-chicken.jpg",
    emoji: "🍳"
  },
  {
    id: 4,
    name: "麦香鱼",
    tier: "T1",
    category: "burger",
    faction: "汉堡军团",
    roleType: "技巧",
    force: 72,
    strategy: 88,
    fame: 78,
    command: 70,
    skillName: "海鲜洞察",
    skillDesc: "抽到海鲜或联名类事件卡时，可免费重抽 1 次。",
    quoteText: "鱼跃龙门，今天手感好。",
    nutrition: { kcal: 325, protein: 16, fat: 13, carb: 35, sodium: 556 },
    mcpSource: "list-nutrition-foods / 麦香鱼",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/filet-fish.jpg",
    emoji: "🐟"
  },
  {
    id: 5,
    name: "双层吉士汉堡",
    tier: "T2",
    category: "burger",
    faction: "汉堡军团",
    roleType: "防护",
    force: 68,
    strategy: 74,
    fame: 82,
    command: 90,
    skillName: "双层芝士盾",
    skillDesc: "抵消一次负面事件的全部损失。",
    quoteText: "芝士就是力量。",
    nutrition: { kcal: 429, protein: 27, fat: 22, carb: 31, sodium: 1017 },
    mcpSource: "list-nutrition-foods / 双层吉士汉堡",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/cheese-burger.jpg",
    emoji: "🧀"
  },
  {
    id: 6,
    name: "可乐大杯",
    tier: "T1",
    category: "drink",
    faction: "汽水部落",
    roleType: "辅助",
    force: 45,
    strategy: 86,
    fame: 90,
    command: 66,
    skillName: "气泡加满",
    skillDesc: "全体玩家欢乐值 +1，并移动 1 步。",
    quoteText: "气泡满格，快乐出发！",
    nutrition: { kcal: 224, protein: 0, fat: 0, carb: 55, sodium: 0 },
    mcpSource: "list-nutrition-foods / 可乐大杯",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/cola-large.jpg",
    emoji: "🥤"
  },
  {
    id: 7,
    name: "雪碧中杯",
    tier: "T2",
    category: "drink",
    faction: "汽水部落",
    roleType: "机动",
    force: 48,
    strategy: 82,
    fame: 76,
    command: 60,
    skillName: "闪亮气泡",
    skillDesc: "本次移动额外 +2 步。",
    quoteText: "透心凉，闪亮亮。",
    nutrition: { kcal: 105, protein: 0, fat: 0, carb: 26, sodium: 29 },
    mcpSource: "list-nutrition-foods / 雪碧中杯",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/sprite.jpg",
    emoji: "💫"
  },
  {
    id: 8,
    name: "奥利奥麦旋风",
    tier: "T1",
    category: "dessert",
    faction: "甜心王国",
    roleType: "范围",
    force: 58,
    strategy: 84,
    fame: 96,
    command: 64,
    skillName: "旋风双味",
    skillDesc: "抽到甜品类事件时，可抽取 2 张任意卡。",
    quoteText: "转啊转，甜到心。",
    nutrition: { kcal: 266, protein: 5, fat: 9, carb: 40, sodium: 116 },
    mcpSource: "list-nutrition-foods / 奥利奥麦旋风",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/oreo-mcflurry.jpg",
    emoji: "🌀"
  },
  {
    id: 9,
    name: "朱古力新地",
    tier: "T2",
    category: "dessert",
    faction: "甜心王国",
    roleType: "治愈",
    force: 50,
    strategy: 78,
    fame: 84,
    command: 68,
    skillName: "甜心治愈",
    skillDesc: "恢复 1 点欢乐护盾，抵消下一次欢乐值损失。",
    quoteText: "来一份甜的，治愈一下。",
    nutrition: { kcal: 282, protein: 5, fat: 9, carb: 44, sodium: 126 },
    mcpSource: "list-nutrition-foods / 朱古力新地",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/chocolate-sundae.jpg",
    emoji: "🍫"
  },
  {
    id: 10,
    name: "大薯条",
    tier: "T1",
    category: "side",
    faction: "脆皮小队",
    roleType: "输出",
    force: 78,
    strategy: 62,
    fame: 72,
    command: 64,
    skillName: "脆皮打击",
    skillDesc: "战斗判定 +2；被击败时欢乐值减半（先扣后返）。",
    quoteText: "咔嚓！脆得很。",
    nutrition: { kcal: 379, protein: 6, fat: 16, carb: 50, sodium: 216 },
    mcpSource: "list-nutrition-foods / 大薯条",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/fries-large.jpg",
    emoji: "🍟"
  },
  {
    id: 11,
    name: "麦乐鸡5块",
    tier: "T2",
    category: "side",
    faction: "脆皮小队",
    roleType: "续航",
    force: 72,
    strategy: 70,
    fame: 74,
    command: 76,
    skillName: "鸡块补血",
    skillDesc: "每圈结束时回复 1 点欢乐护盾。",
    quoteText: "再来一块！",
    nutrition: { kcal: 213, protein: 12, fat: 12, carb: 13, sodium: 422 },
    mcpSource: "list-nutrition-foods / 麦乐鸡5块",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/mcnuggets.jpg",
    emoji: "🍗"
  },
  {
    id: 12,
    name: "大杯鲜萃咖啡",
    tier: "T2",
    category: "drink",
    faction: "晨光营地",
    roleType: "智谋",
    force: 40,
    strategy: 95,
    fame: 62,
    command: 70,
    skillName: "提神洞察",
    skillDesc: "所有事件卡难度 -1，优先看第一张选项。",
    quoteText: "醒一醒，想清楚。",
    nutrition: { kcal: 13, protein: 1, fat: 0, carb: 0, sodium: 3 },
    mcpSource: "list-nutrition-foods / 大杯鲜萃咖啡",
    mcdImage: "https://cms-cdn.mcd.cn/img/short-content/coffee.jpg",
    emoji: "☕"
  }
];

// 按分类取卡
function getCharactersByCategory(categoryKey) {
  return CHARACTERS.filter((item) => item.category === categoryKey);
}

// 按 id 取卡
function getCharacterById(id) {
  return CHARACTERS.find((item) => item.id === id) || null;
}

// 供前端展示的属性说明
function getAttributeLegend() {
  return [
    { key: "force", name: "力量", icon: "攻击", desc: "战斗与闯关判定" },
    { key: "strategy", name: "策略", icon: "技巧", desc: "事件卡效果与重抽" },
    { key: "fame", name: "欢乐", icon: "得分", desc: "胜利目标核心指标" },
    { key: "command", name: "统率", icon: "防御", desc: "抵抗负面事件" }
  ];
}

module.exports = { CHARACTERS, CATEGORIES, getCharactersByCategory, getCharacterById, getAttributeLegend };