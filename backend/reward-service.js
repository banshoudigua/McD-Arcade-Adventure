// 奖励服务：结算后「选择奖励」所用的真实商品全部来自麦当劳 MCP
// 三类来源：
//   1. mall-points-products  麦麦商城可兑换商品（实物周边/餐品券/派对等，50 件）
//   2. available-coupons     麦麦省可领取优惠券（真实餐品券）
//   3. query-nearby-stores + query-meals  指定城市门店在售餐品（受营业时间影响）
//
// 设计原则：
//   - 每一类独立拉取，任意一类失败自动降级到快照或置空，不影响其他类返回
//   - 只做只读查询，绝不调用下单/兑换类工具（server.js 另有黑名单硬拦截）
//   - 统一归一化字段，前端无需关心来源差异

const fs = require("fs");
const path = require("path");
const { callTool } = require("./mcp-client");

const DATA_DIR = path.join(__dirname, "..", "data");
const PRIVATE_SNAPSHOT = path.join(DATA_DIR, "mcd-snapshot.json");
const PUBLIC_SNAPSHOT = path.join(DATA_DIR, "mcd-snapshot.public.json");

// ===== 快照兜底 =====
function readSnapshot(callback) {
  const target = fs.existsSync(PRIVATE_SNAPSHOT) ? PRIVATE_SNAPSHOT : PUBLIC_SNAPSHOT;
  fs.readFile(target, "utf8", (err, content) => {
    if (err) {
      callback(new Error("快照不可用"), null);
      return;
    }
    const parseTask = Promise.resolve().then(() => JSON.parse(content));
    parseTask.then((snap) => callback(null, snap), () => callback(new Error("快照解析失败"), null));
  });
}

// ===== 归一化：麦麦商城商品 =====
// 关键区分：官方把商城商品分成两类，兑换方式完全不同（实测 mall-product-detail 得到）
//   shopId=2「积分兑换品」（到店专用餐品券 / 玩具 / 鞋袜，共 24 件）
//     → price=0、point=200~800，可用 mall-create-order 真实下单，直接扣玩家积分
//   shopId=5「活动预约品」（生日派对 / 主题派对 / 读书会 / 品鉴会，共 26 件）
//     → price=45~198 元，属付费活动，需 party-order-create 并选定门店/日期/场次
// 之前把两类混在一起展示且禁用了下单工具，等于把真实兑奖链路砍掉了，这里必须区分。
function normalizeMall(list) {
  const items = [];
  for (let i = 0; i < (list || []).length; i += 1) {
    const raw = list[i];
    const shopId = Number(raw.shopId);
    // 点数：真实积分价；活动类无积分价，point 会被官方置 0
    const pointNum = Number(raw.point || 0);
    const isPointRedeem = shopId === 2 && pointNum > 0;

    items.push({
      key: "mall-" + raw.spuId,
      kind: "mall",
      name: raw.spuName,
      catName: raw.catName || "其他",
      // 兑换类型：point=积分可兑，event=活动预约
      redeemType: isPointRedeem ? "point" : "event",
      shopId: shopId,
      point: pointNum > 0 ? String(pointNum) : "",
      price: raw.price === undefined || raw.price === null ? "" : String(raw.price),
      image: raw.spuImage || "",
      desc: raw.selling || "",
      spuId: raw.spuId,
      validTo: raw.downTime || "",
      validFrom: raw.upTime || ""
    });
  }
  return items;
}

// ===== 归一化：优惠券（从 rawText 解析）=====
function parseCoupons(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return [];
  }
  const items = [];
  const blocks = rawText.split("- 优惠券标题");
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    // 标题：冒号后到行尾（原文本用 \ 续行）
    const titleMatch = block.match(/^[：:]\s*([^\\\n]+)/);
    const statusMatch = block.match(/状态[：:]\s*([^\\\n]+)/);
    const imgMatch = block.match(/src="([^"]+)"/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (!title) {
      continue;
    }
    items.push({
      key: "coupon-" + i,
      kind: "coupon",
      name: title,
      catName: "优惠券",
      price: "",
      point: "",
      image: imgMatch ? imgMatch[1] : "",
      desc: "麦麦省可领取优惠券" + (statusMatch ? "（" + statusMatch[1].trim() + "）" : ""),
      couponId: i,
      status: statusMatch ? statusMatch[1].trim() : "",
      validTo: ""
    });
  }
  return items;
}

// ===== 归一化：门店餐品 =====
// query-meals 返回结构随门店而变，这里做宽松适配：取能识别的字段，其余留空
function normalizeMeals(payload) {
  const raw = payload && payload.data ? payload.data : payload;
  const items = [];
  const list = Array.isArray(raw) ? raw : (raw && raw.mealList ? raw.mealList : []);
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    const name = m.mealName || m.name || m.productName || "";
    if (!name) {
      continue;
    }
    items.push({
      key: "meal-" + i,
      kind: "meal",
      name: name,
      catName: m.categoryName || m.catName || "在售餐品",
      price: m.price === undefined || m.price === null ? "" : String(m.price),
      point: "",
      image: m.image || m.img || m.picture || "",
      desc: m.description || m.desc || "门店当前在售餐品",
      spuId: m.mealCode || m.spuId || m.code || "",
      validTo: ""
    });
  }
  return items;
}

// 从 rawText 中抽取内嵌的 JSON 结果（门店接口把 JSON 包在说明文本里）
function extractJson(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return null;
  }
  const start = rawText.indexOf('{"success"');
  if (start === -1) {
    return null;
  }
  const end = rawText.lastIndexOf("}");
  if (end <= start) {
    return null;
  }
  const parseTask = Promise.resolve().then(() => JSON.parse(rawText.slice(start, end + 1)));
  return parseTask.then((obj) => obj, () => null);
}

// ===== 主流程 =====
function loadRewards(options, callback) {
  const opts = options || {};
  const city = opts.city || "上海";
  const keyword = opts.keyword || "人民广场";
  const token = opts.token;

  const result = {
    pulledAt: new Date().toISOString(),
    city: city,
    mall: { source: "unavailable", items: [], note: "" },
    coupons: { source: "unavailable", items: [], note: "" },
    meals: { source: "unavailable", items: [], note: "", storeName: "", storeCode: "" },
    degraded: []
  };

  // 1. 麦麦商城商品
  callTool("mall-points-products", {}, (mallErr, mallRes) => {
    if (!mallErr && mallRes && mallRes.data && mallRes.data.length) {
      result.mall = { source: "mcp", items: normalizeMall(mallRes.data), note: "" };
      afterMall();
      return;
    }
    result.degraded.push("mall");
    readSnapshot((snapErr, snap) => {
      const list = snap && snap.mallProducts && snap.mallProducts.data ? snap.mallProducts.data : [];
      result.mall = {
        source: snapErr ? "unavailable" : "snapshot",
        items: normalizeMall(list),
        note: "实时接口不可用，使用本地快照"
      };
      afterMall();
    });
  }, token);

  function afterMall() {
    // 2. 优惠券
    callTool("available-coupons", {}, (cErr, cRes) => {
      const rawText = cRes && cRes.rawText ? cRes.rawText : "";
      const items = parseCoupons(rawText);
      if (!cErr && items.length) {
        result.coupons = { source: "mcp", items: items, note: "" };
        afterCoupons();
        return;
      }
      result.degraded.push("coupons");
      readSnapshot((snapErr, snap) => {
        const snapRaw = snap && snap.coupons && snap.coupons.rawText ? snap.coupons.rawText : "";
        result.coupons = {
          source: snapErr ? "unavailable" : "snapshot",
          items: parseCoupons(snapRaw),
          note: "实时接口不可用，使用本地快照"
        };
        afterCoupons();
      });
    }, token);
  }

  function afterCoupons() {
    // 3. 门店餐品（需先查门店再查菜单，受营业时间影响，失败不影响整体）
    callTool("query-nearby-stores", { beType: 1, city: city, keyword: keyword }, (sErr, sRes) => {
      if (sErr) {
        result.meals = { source: "unavailable", items: [], note: "门店查询失败：" + sErr.message, storeName: "", storeCode: "" };
        result.degraded.push("meals");
        callback(null, result);
        return;
      }
      const rawText = sRes && sRes.rawText ? sRes.rawText : "";
      extractJson(rawText).then((obj) => {
        const stores = obj && obj.data ? obj.data : [];
        if (!stores.length) {
          result.meals = { source: "unavailable", items: [], note: "未查询到 " + city + keyword + " 附近门店", storeName: "", storeCode: "" };
          result.degraded.push("meals");
          callback(null, result);
          return;
        }
        const store = stores[0];
        result.meals.storeName = store.storeName || "";
        result.meals.storeCode = store.storeCode || "";

        callTool("query-meals", { beType: 1, orderType: 1, storeCode: store.storeCode }, (mErr, mRes) => {
          if (mErr || !mRes || mRes.success === false) {
            result.meals.note = mRes && mRes.message ? mRes.message : (mErr ? mErr.message : "餐品查询失败");
            result.meals.source = "unavailable";
            result.degraded.push("meals");
            callback(null, result);
            return;
          }
          const items = normalizeMeals(mRes);
          result.meals = {
            source: "mcp",
            items: items,
            note: "",
            storeName: store.storeName || "",
            storeCode: store.storeCode || ""
          };
          callback(null, result);
        }, token);
      }, () => {
        result.meals = { source: "unavailable", items: [], note: "门店结果解析失败", storeName: "", storeCode: "" };
        result.degraded.push("meals");
        callback(null, result);
      });
    }, token);
  }
}

module.exports = { loadRewards, parseCoupons, normalizeMall, normalizeMeals };
