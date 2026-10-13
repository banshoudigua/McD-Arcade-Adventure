# MCP 接入说明

本文档说明麦麦奇幻乐园如何接入麦当劳中国官方 MCP Server（https://mcp.mcd.cn）。

---

## 一、接入配置

### 1.1 服务信息

| 项目 | 值 |
| --- | --- |
| 服务名称 | 麦当劳 MCP 服务（mcd-mcp） |
| 服务地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权方式 | 请求头 `Authorization: Bearer YOUR_MCP_TOKEN` |
| 速率限制 | 600 次/分钟（超限返回 429） |
| 错误码 | 401 Token无效/过期；429 触发限流 |
| 官方文档 | https://github.com/M-China/mcd-mcp-server |
| 开放平台 | https://open.mcd.cn/mcp |

### 1.2 申请 MCP Token

1. 访问 https://open.mcd.cn/mcp ，点击右上角「登录」
2. 跳转登录页，使用**手机号验证登录**
3. 登录成功后返回首页，「登录」按钮变为「控制台」
4. 点击「控制台」→ 点击激活按钮 → 同意服务协议
5. MCP Token 申请成功，一键复制

### 1.3 MCP Client 配置示例

若直接在 MCP Client（如 WorkBuddy / Cursor / Cherry Studio）中接入，配置如下：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

本项目采用**自建 Node 后端代理**的方式接入，原因见第四节。

---

## 二、本项目实际调用的工具

线上实测可用工具共 **35 个**，本项目实际调用其中 **11 个只读查询类工具**。

### 2.1 工具调用清单

| 工具名称 | 入参 | 用途 |
| --- | --- | --- |
| `list-nutrition-foods` | 无 | 获取 160 条餐品营养数据 → **卡牌属性来源** |
| `campaign-calendar` | `specifiedDate` | 查询营销活动日历 → 事件卡池 |
| `now-time-info` | 无 | 获取当前时间 → 限时机判定与连通检测 |
| `available-coupons` | 无 | 查询可领取优惠券 → 参与奖 |
| `query-my-account` | 无 | 查询麦享会积分 → 奖品屋积分展示 |
| `mall-points-products` | `catRuleIds` | 查询麦麦商城商品 → 奖品屋真实奖品 |
| `query-lottery-info` | 无 | 查询积分抽奖活动信息 |
| `query-my-prizes` | `pageNum, pageSize` | 查询积分抽奖奖品记录 |
| `query-nearby-stores` | `city, keyword, searchType, beType` | 查询附近门店 → 乐园地图锚点 |
| `query-meals` | `storeCode, orderType` 等 | 查询门店在售餐品 |
| `query-promotions` | `storeCode, orderType` 等 | 查询促销活动 |

### 2.2 实测返回样例

**`list-nutrition-foods`**（卡牌属性数据源）：

```
[160]{productName,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:
  巨无霸,null,2198,513,27,26,42,961,—
  可乐大杯,null,936,224,0,0,55,0,—
  奥利奥麦旋风,null,1115,266,5,9,40,116,185
  大薯条,null,1587,379,6,16,50,216,23
```

**`now-time-info`**：

```json
{
  "success": true,
  "code": 200,
  "data": {
    "timestamp": 1791543013478,
    "datetime": "2026-10-09T18:50:13.478"
  }
}
```

**`query-my-account`**（奖品屋积分）：

```json
{
  "success": true,
  "data": {
    "availablePoint": "549.8",
    "accumulativePoint": "8950.1",
    "currency": "麦享会积分"
  }
}
```

---

## 三、卡牌属性推导规则

卡牌的四维属性并非人工编造，而是从上述真实营养数据换算而来。以巨无霸为例：

```js
{
  name: "巨无霸",
  // 以下为 MCP 接口返回的真实营养数据
  nutrition: { kcal: 513, protein: 27, fat: 26, carb: 42, sodium: 961 },
  mcpSource: "list-nutrition-foods / 巨无霸",
  // 以下为换算得到的游戏属性
  force: 92,      // 由热量与脂肪推导：能量越高力量越强
  strategy: 62,   // 由蛋白质推导：高蛋白更"巧劲"
  fame: 85,       // 由碳水推导：碳水带来快乐感
  command: 88     // 由钠含量与营养均衡度推导
}
```

完整的换算结果与溯源信息见 `game/characters.js`，每张卡片的 `mcpSource` 字段均标明其真实数据来源。前端卡面底部直接展示 `kcal` 与蛋白质含量，玩家可与麦当劳官方数据核对。

---

## 四、为什么采用后端代理而非直连

本项目**不**在浏览器端直连 MCP，原因如下：

| 问题 | 后端代理方案 |
| --- | --- |
| Token 暴露 | Token 仅存在于服务端 `.env`，浏览器无法获取 |
| CORS 限制 | 浏览器直连 `mcp.mcd.cn` 会被跨域策略拦截 |
| 频率控制 | 服务端统一节流至 60 次/分钟，避免触发 429 |
| 安全管控 | 高风险工具在服务端硬拦截，无法被前端绕过 |
| 离线兜底 | 快照文件保证断网时游戏仍可运行 |

### 代理接口用法

```bash
# 只读查询工具（白名单内）
curl -X POST http://127.0.0.1:3100/api/mcp/now-time-info \
  -H "Content-Type: application/json" -d '{}'

# 本地快照（离线兜底）
curl http://127.0.0.1:3100/api/snapshot
```

---

## 五、安全策略：高风险工具拦截

本项目在 `backend/server.js` 中设置**白名单 + 黑名单双重管控**。

### 5.1 黑名单（服务端硬拦截，返回 403）

| 工具 | 风险 |
| --- | --- |
| `create-order` | 真实创建订单，涉及扣款 |
| `cancel-order` | 取消真实订单 |
| `mall-create-order` | 真实扣除麦享会积分并兑换 |
| `auto-bind-coupons` | 账号写入，自动领券 |
| `party-order-create` | 创建主题活动订单，涉及支付 |
| `draw-lottery` | 真实消耗积分抽奖 |

实测拦截返回：

```json
{
  "success": false,
  "message": "该工具涉及真实扣款/扣积分/账号写入，已被安全策略禁用"
}
```

### 5.2 白名单

仅放行 11 个纯只读查询工具，任何未列入的工具一律拒绝。

### 5.3 兑换流程安全

奖品屋的兑换按钮**不会**直接调用 `mall-create-order`，流程为：

1. 点击兑换 → 弹窗展示奖品名称、所需积分、风险提示
2. 用户点击「确认兑换」完成二次确认
3. 当前演示版本仅生成兑换凭证，不执行真实扣减
4. 正式版本将跳转官方渠道完成兑换

---

## 六、数据快照机制

```bash
node backend/pull-mcd-data.js
```

该脚本依次调用 6 个只读工具，生成 `data/mcd-snapshot.json`（实测约 52 KB），包含：

| 字段 | 内容 | 用途 |
| --- | --- | --- |
| `nutrition` | 160 条餐品营养数据 | 卡牌属性推导 |
| `campaigns` | 当月活动日历 | 事件卡池 |
| `coupons` | 可领取优惠券 | 参与奖 |
| `account` | 麦享会积分 | 奖品屋展示 |
| `mallProducts` | 麦麦商城商品 | 真实奖品 |
| `stores` | 附近门店 | 乐园地图 |

快照中 `_meta` 字段记录了拉取时间与数据来源，可作为真实接入 MCP 的举证材料。

---

## 七、错误处理与调试

`backend/mcp-client.js` 在关键节点输出调试日志，便于定位问题：

```
[env] 已加载配置项: MCD_MCP_TOKEN
[mcp] tools/call -> HTTP 200 (483ms)
[1/6] 营养数据 OK
[mcp] campaign-calendar 返回非 JSON 内容，按原文保留（长度 8853）
```

| 日志 | 含义 |
| --- | --- |
| `HTTP 401` | Token 无效或过期，需重新申请 |
| `HTTP 429` | 触发限流，需降低调用频率 |
| `返回非 JSON 内容` | 该工具返回自定义 DSL 文本，按原文保留 |
| `响应解析失败` | 返回体格式异常，检查服务端版本 |

前端同样提供 `console` 调试输出，涵盖路由异常、存档失败、MCP 连通状态等环节。

---

## 八、调用流程（端到端）

一次完整游玩中，MCP 数据是这样流经系统的：

```
用户点击「进入选卡页面」
      │
      ├─ GET /api/events ──────────────► 后端 → campaign-calendar（当月真实活动）
      │                └ 解析为 36 张事件卡（12 真实 + 24 内置），下发前端
      │
用户掷骰落在「营养科普站」
      │
      ├─ GET /api/nutrition-question ──► 后端 → list-nutrition-foods（160 条营养表）
      │                └ 按指标分组抽题，保证 4 个选项数值互不相同、答案唯一
      │
用户获胜后进入奖品屋
      │
      ├─ GET /api/rewards ─────────────► 后端 → mall-points-products（50 件商品）
      │                                └ available-coupons（7 张券）
      │                                └ query-nearby-stores → query-meals（门店餐品）
      │                └ 三类各自独立拉取、独立降级，实时数据优先、快照兜底
      │
用户查看自己的积分（可选）
      │
      └─ POST /api/mcp/query-my-account ► 后端 → query-my-account
                       └ 用户在奖品屋粘贴自有 Token（BYOT），仅转发不存储
```

**代理接口一览**

| 接口 | 方法 | 透传工具 | 用途 |
| --- | --- | --- | --- |
| `/api/mcp/:tool` | POST | 白名单 11 个只读工具 | 通用 MCP 代理 |
| `/api/events` | GET | `campaign-calendar` | 事件卡组 |
| `/api/nutrition-question` | GET | `list-nutrition-foods` | 营养科普题 |
| `/api/rewards` | GET | `mall-points-products` + `available-coupons` + `query-nearby-stores` + `query-meals` | 真实奖品聚合 |
| `/api/snapshot` | GET | — | 本地快照（离线兜底） |

---

## 九、业务价值

麦当劳 MCP 提供了营养表、活动日历、门店菜单、优惠券、商城商品等原子能力，
单看每一条都是「查信息的接口」。本项目验证的是：**把这些原子能力编排成一条小朋友愿意反复玩的闭环**。

| MCP 能力 | 若只做工具查询 | 本项目的编排方式 | 产生的业务价值 |
| --- | --- | --- | --- |
| `list-nutrition-foods`（160 条营养表） | 查某一餐品的热量 | 推导 12 张角色卡四维属性 → 影响骰子步数、战斗力、商店购买力 | 营养信息从「被动查询」变成「可玩的力量值」，孩子为抢巨无霸主动去比热量 |
| `campaign-calendar`（当月活动） | 查本月有什么活动 | 活动按关键词映射为 8 类游戏效果（传送/夺取/翻倍/再掷…），抽到即触发 | 营销活动有了游戏化载体，活动触达从「海报」变成「牌」 |
| `list-nutrition-foods` → 知识题 | 查营养表 | 生成答案唯一的判断题，答对加欢乐值 | 营养科普与游戏机制强绑定，边玩边学 |
| `mall-points-products`（50 件商品） | 查积分商城有什么 | 获胜者挑选真实商品作为奖励，生成含编码的兑换凭证 | 积分商城的商品第一次有了「获得理由」，兑换动机显著增强 |
| `available-coupons`（7 张券） | 查有什么券 | 作为奖励池之一直接可选 | 优惠券从「推送」变成「战利品」 |
| `query-nearby-stores` + `query-meals` | 查附近门店与菜单 | 作为第三类奖励（受营业时间影响，自动降级） | 把线上积分与线下门店连接起来 |

**安全边界的业务考量**

| 场景 | 处理方式 | 原因 |
| --- | --- | --- |
| **拿项目 Token 替人扣分** | 个人数据与写入类工具**必须 BYOT**，用项目 Token 调用一律 401 | 项目 Token 是开发者的账号，绝不能用于任何人的真实交易 |
| **误触扣积分** | 真实兑换需三条件同时满足：玩家 Token + 界面勾选确认 + 请求体 `confirm:true` | 防儿童误操作造成真实损失 |
| 无效 Token 处理 | 返回 401，**不回落到项目 Token** | 回落到项目 Token 等于用开发者账号替人下单，是最危险的漏洞 |
| 代点餐 / 代领券 / 抽奖 / 取消订单 | `create-order`、`cancel-order`、`auto-bind-coupons`、`party-order-create`、`draw-lottery` 永久 403 | 与游戏兑奖无关且风险过高，儿童向作品不应代做 |
| 用户账号 | 仅奖品屋可粘贴自有 Token，存浏览器 sessionStorage，服务端零存储 | 让玩家能看自己真实积分与真实兑换，同时不托管任何凭证 |
| 奖励凭证 | 记录「谁选了哪件商品 + 商品编码 + 官方领取三步」 | 凭证是游戏内凭据，真实兑换走官方接口 |
| Token 泄露风险 | `.env` 被 `.gitignore` 排除，文档只写 `YOUR_MCP_TOKEN` 占位符 | 开源仓库必须可安全公开 |

### 9.1 真实兑奖链路（实测入参，非推测）

官方把商城商品按 `shopId` 分为两类，兑换方式完全不同——这是实测 `tools/list` 与
`mall-product-detail` 得到的结论，不是文档推断：

| shopId | 分类 | 件数 | 价格字段 | 真实兑换方式 |
| --- | --- | --- | --- | --- |
| **2** | 到店专用餐品券 / 玩具 / 鞋袜 | **24** | `point`=200~800，`price`=0 | ✅ `mall-create-order` 真实扣积分下单 |
| **5** | 生日派对 / 主题派对 / 读书会 / 品鉴会 | 26 | `price`=45~198 元 | ❌ 付费活动，需 `party-order-create` 选定门店/日期/场次 |

调用链：

```
mall-points-products (列表，含 spuId / shopId / point / price)
      ↓ 玩家选择「可真实兑换」的商品
mall-product-detail({spuId})  →  取 skuList[0].skuId 与 spuCategory
      ↓ 界面展示「将扣除 XX 积分」+ 玩家勾选确认
mall-create-order({skuId, spuCategory, count:1, confirm:true})  →  官方真实下单
      ↓
mall-order-list / mall-order-detail  →  查询这笔兑换（均为 BYOT 工具）
```

官方约束已遵守：**单个商品一个订单**，本项目一次只兑换一件。

> 一句话总结业务价值：**把「查营养、查活动、查积分、查门店」四类查询型接口，
> 编排成一个有输赢、有奖励、有知识输入的家庭亲子游戏闭环；
> 奖励可以真正兑换——用玩家自己的麦享会积分走官方接口真实下单，
> 同时用四道服务端闸门确保任何真实交易都只能由玩家本人、且经其显式确认后发生。**