// 数据拉取脚本：把麦当劳 MCP 真实数据落成本地快照
// 用法：node backend/pull-mcd-data.js
// 用途：生成 data/mcd-snapshot.json 作为离线兜底 + 参赛真实接入证据

const fs = require("fs");
const path = require("path");
const { callTool } = require("./mcp-client");

const DATA_DIR = path.join(__dirname, "..", "data");
const SNAPSHOT_PATH = path.join(DATA_DIR, "mcd-snapshot.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 依次拉取各项数据，每步完成写入快照（防止中途失败丢全部数据）
function pull() {
  const snapshot = {
    _meta: {
      source: "https://mcp.mcd.cn",
      server: "mcd-mcp",
      pulledAt: new Date().toISOString(),
      note: "本文件为麦当劳 MCP 真实数据快照，用于离线兜底与参赛举证"
    },
    nutrition: null,
    menus: [],
    campaigns: null,
    coupons: null,
    account: null,
    mallProducts: null,
    stores: []
  };

  console.log("=== 开始拉取麦当劳 MCP 数据 ===\n");

  // 1. 营养数据（卡牌属性来源，无入参）
  callTool("list-nutrition-foods", {}, (err, res) => {
    if (err) {
      console.error("[1/6] 营养数据失败:", err.message);
    } else {
      snapshot.nutrition = res;
      console.log("[1/6] 营养数据 OK");
    }
    step2();
  });

  // 2. 活动时间（事件卡池）
  function step2() {
    callTool("campaign-calendar", {}, (err, res) => {
      if (err) {
        console.error("[2/6] 活动日历失败:", err.message);
      } else {
        snapshot.campaigns = res;
        console.log("[2/6] 活动日历 OK");
      }
      step3();
    });
  }

  // 3. 可领取优惠券（参与奖来源）
  function step3() {
    callTool("available-coupons", {}, (err, res) => {
      if (err) {
        console.error("[3/6] 优惠券失败:", err.message);
      } else {
        snapshot.coupons = res;
        console.log("[3/6] 优惠券 OK");
      }
      step4();
    });
  }

  // 4. 我的积分（兑奖参考额度）
  function step4() {
    callTool("query-my-account", {}, (err, res) => {
      if (err) {
        console.error("[4/6] 积分查询失败:", err.message);
      } else {
        snapshot.account = res;
        console.log("[4/6] 积分查询 OK");
      }
      step5();
    });
  }

  // 5. 麦麦商城奖品（奖品屋数据源）
  function step5() {
    callTool("mall-points-products", {}, (err, res) => {
      if (err) {
        console.error("[5/6] 商城商品失败:", err.message);
      } else {
        snapshot.mallProducts = res;
        console.log("[5/6] 商城商品 OK");
      }
      step6();
    });
  }

  // 6. 附近门店（需城市上下文，失败不阻塞整体流程）
  function step6() {
    callTool("query-nearby-stores", { city: "上海", keyword: "人民广场" }, (err, res) => {
      if (err) {
        console.error("[6/6] 门店查询失败（需调整城市参数）:", err.message);
      } else {
        snapshot.stores = res;
        console.log("[6/6] 门店查询 OK");
      }
      save();
    });
  }

  function save() {
    ensureDir();
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8");
    const size = fs.statSync(SNAPSHOT_PATH).size;
    console.log(`\n=== 快照已保存: ${SNAPSHOT_PATH} (${(size / 1024).toFixed(1)} KB) ===`);
  }
}

pull();