// 快照脱敏脚本：生成可开源提交的版本
// 用法：node backend/sanitize-snapshot.js
// 目的：
//   1. 移除个人信息（手机号、accountId）
//   2. **彻底删除 account 字段**（见下方说明）
//   3. 保留其余数据特征以证明真实接入 MCP

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SRC = path.join(DATA_DIR, "mcd-snapshot.json");
const OUT = path.join(DATA_DIR, "mcd-snapshot.public.json");

// ===== 为什么必须整体删除 account =====
// `account` 字段来自 query-my-account，返回的是**开发者本人账号**的资产数据：
// 可用积分、累计积分、冻结积分、已过期积分、账户标识等。
// 这类数据即便把 accountId 打码，积分金额、资产结构依然是**一个真实自然人的账户画像**，
// 公开出去既不道德、也与「真实数据」的初衷背道而驰。
//
// 更关键的是产品逻辑问题：把它叫「演示账号积分」会让人误以为这是游戏内的虚构数值，
// 但它其实是别人的真实账户数据——这在评审中是硬伤。
//
// 正确做法：开源快照里根本不存在「演示积分」这个概念。
// 玩家想看积分，必须绑定自己申请的 MCP Token，走 query-my-account 实时查询。
const DROP_FIELDS = ["account"];

// 手机号脱敏：保留前3 后4
function maskPhone(text) {
  return text.replace(/1[3-9]\d{9}/g, function (m) {
    return m.slice(0, 3) + "****" + m.slice(-4);
  });
}

// 递归处理对象，替换敏感字段值
function sanitize(value) {
  if (typeof value === "string") {
    return maskPhone(value);
  }
  if (Array.isArray(value)) {
    return value.map(function (item) { return sanitize(item); });
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      // 账号标识类字段直接移除
      if (key === "accountId" || key === "userId" || key === "openId" || key === "phone") {
        out[key] = "***REDACTED***";
        continue;
      }
      out[key] = sanitize(value[key]);
    }
    return out;
  }
  return value;
}

const readTask = fs.promises.readFile(SRC, "utf8");
readTask.then(function (raw) {
  const parseTask = Promise.resolve().then(function () { return JSON.parse(raw); });
  parseTask.then(function (data) {
    const clean = sanitize(data);

    // 整体删除开发者本人账户资产数据
    const dropped = [];
    for (var i = 0; i < DROP_FIELDS.length; i += 1) {
      const field = DROP_FIELDS[i];
      if (clean[field]) {
        delete clean[field];
        dropped.push(field);
      }
    }

    clean._meta = Object.assign({}, clean._meta, {
      sanitized: true,
      sanitizedAt: new Date().toISOString(),
      removedFields: DROP_FIELDS,
      note: "开源版本：手机号与账号标识已脱敏；开发者本人账户资产数据（query-my-account）已整体移除——玩家需绑定自己的 MCP Token 才能查看真实积分"
    });
    return fs.promises.writeFile(OUT, JSON.stringify(clean, null, 2), "utf8");
  }).then(function () {
    console.log("✅ 脱敏完成:", OUT);
    console.log("   已移除字段: account（开发者本人账户积分/资产数据）");
    console.log("   手机号已掩码，accountId 等账号标识已替换");
    console.log("   营养数据、活动日历、商城商品等结构完整保留");
  });
}, function (err) {
  console.error("❌ 读取源快照失败:", err.message);
});