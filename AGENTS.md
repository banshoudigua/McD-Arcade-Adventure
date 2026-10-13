# 麦麦奇幻乐园 · 项目规则文件（AGENTS.md）

> 本文件是本项目的开发规则与上下文说明，供WorkBuddy / Claude Code 等 AI 工具与协作者读取。
> 维护规范：每次修改项目内容后，需在根目录 `AI更新历史.md` 追加变更记录。
> 该文件为**本地开发流水**，已列入 `.gitignore`，不进入公开仓库；
> 公开仓库中的迭代记录统一汇总在 `workbuddy.md`。

---

## 一、项目定位

- 项目名称：麦麦奇幻乐园（`mcd-arcade-adventure`）
- 目标赛事：1024 程序员节创意开发大赛（麦当劳中国 × WorkBuddy）
- 形态：**在线 Web 应用**（纯前端可运行，非微信小程序）
- **交付形态：本仓库本身即一个可安装的 WorkBuddy Skill**，入口为根目录 `SKILL.md`
- 核心玩法：以麦当劳餐品为角色的卡牌桌游 + 虚拟儿童乐园 + 真实门店/奖品兑奖
- 技术底座：参考本地项目 `D:\asp\stbcy\冰橙星星乐 三国篇 - 起源` 的桌游引擎设计

### 1.1 启动方式（Skill 场景）

```bash
node scripts/status.js   # 探测，RUNNING 时输出 SKILL_URL
node scripts/start.js    # 启动（前台常驻，请用后台方式执行）
node scripts/stop.js     # 停止
```

默认地址 `http://127.0.0.1:3100`。**他人安装后无需公网部署**即可游玩；
不配置 `.env` 时自动回退仓库自带的公开脱敏快照。

---

## 二、麦当劳 MCP 接入配置

### 2.1 接入信息

| 项 | 值 |
| --- | --- |
| 服务地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权方式 | 请求头 `Authorization: Bearer <TOKEN>` |
| 速率限制 | 600 次/分钟（建议主动节流至 60 次/分钟） |
| 运行模式 | 无状态（初始化后无需维护 session id） |
| 实测握手 | `serverInfo: mcd-mcp v1.0.0` |

### 2.2 Token 管理（重要）

**当前项目 Token 已写入 `.env` 文件，`.env` 已被 `.gitignore` 忽略，严禁提交 Git 或写入任何公开文档。**

> Token 明文只存在于 `.env`，本文件与其他所有文档均不记录 Token 值（开源安全要求）。

规则：

1. 代码中**一律通过 `process.env.MCD_MCP_TOKEN` 读取**，禁止硬编码 Token 字符串。
2. 所有对外文档（README、MCP_INTEGRATION.md、CONTEST_DECLARATION.md）只写 `YOUR_MCP_TOKEN` 占位符 + 申请指引。
3. 日志输出必须脱敏，禁止打印完整请求头。
4. 前端代码与浏览器端代码中不得出现 Token（浏览器环境无法安全持有服务端密钥）。
5. Token 泄露后需立即到 open.mcd.cn 控制台重新生成。

Token 申请路径：手机号登录 `https://open.mcd.cn/mcp` → 右上角控制台 → 点击激活 → 同意服务协议 → 一键复制。

### 2.3 实测工具清单（35 个，与 README 略有差异）

线上实际可用 35 个工具。README 文档列出 37 个，但以下差异需注意：

**线上实有、README 未列：**
- `query-promotions` 查询促销活动
- `query-survey-coupon` 订单评价优惠券

**README 有、线上暂不可见：**
- 主题活动相关的部分入参结构有差异（如 `query-party-store` 实际入参为 `code/latitude/longitude/spuId`）
- `party-order-create` 实际入参含 `partyTimeInfo` 等结构体字段

按用途分组（本项目拟用等级 ★ 越多越核心）：

| 分组 | 工具 | 等级 |
| --- | --- | --- |
| 门店位置 | `query-nearby-stores`（入参 city/keyword/searchType/beType） | ★★★ |
| 餐品菜单 | `query-meals`（需 storeCode 等上下文入参） | ★★★ |
| 营养数据 | `list-nutrition-foods`（无入参，实测返回 160 条餐品） | ★★★ |
| 活动日历 | `campaign-calendar`（入参 specifiedDate） | ★★★ |
| 促销活动 | `query-promotions` | ★★ |
| 优惠券 | `available-coupons` / `query-my-coupons` / `query-store-coupons` | ★★ |
| 积分奖品 | `query-my-account` / `mall-points-products` / `mall-product-detail` | ★★ |
| 时间 | `now-time-info`（无入参） | ★★ |
| 主题活动 | `query-party-city` / `query-party-store` / `query-party-store-date` / `query-party-store-session` | ★ |
| 抽奖 | `query-lottery-info` / `draw-lottery` / `query-my-prizes` | ★ |
| 点餐下单 | `create-order` / `calculate-price` / `query-order` / `order-list` / `cancel-order` | 危险 |
| 积分兑换 | `mall-create-order` / `mall-order-list` / `mall-order-detail` | 危险 |
| 账号写入 | `auto-bind-coupons` | 危险 |

### 2.4 安全红线（必须落实在代码层，不能只写文档）

1. **`create-order`、`mall-create-order`、`auto-bind-coupons`、`cancel-order` 默认关闭。** 涉及真实扣款、真实扣积分、账号写入，必须由用户在对话/界面中显式二次确认，程序不得自动执行。
2. `create-order` 支持 `withOrder` 参数（是否直接创建订单），**本项目必须强制置为 false**，仅做试算。
3. Token 不得入库、不得进 Git、不得写日志、不得出现在前端代码。
4. 本项目为非商业性质作品，与麦当劳中国无隶属关系，不使用官方 Logo 作为主视觉，商标仅作描述性指代。

---

## 三、技术栈与架构

### 3.1 形态约束（用户明确要求）

- **必须是可在线访问的 Web 应用**，不做微信小程序。
- 采用浏览器 History API 管理路由与对局状态回退（`pushState` / `replaceState` / `popstate`）。
- 单页应用，纯前端可完整运行；MCP 调用统一走后端代理，避免 Token 暴露在浏览器。

### 3.2 分层架构

```
浏览器前端（在线应用）
  ├── History API 路由与对局状态回退
  ├── 卡牌对局界面（卡组 / 棋盘 / 事件弹窗 / 奖品屋）
  └── 请求封装（无 Token）
        ↓
后端服务（Node / PHP）
  ├── MCP 代理层（持有 Token，向 mcp.mcd.cn 转发）
  ├── 快照缓存（data/mcd-snapshot.json 兜底 + 降级）
  └── 兑奖确认网关（二次确认校验）
```

**关键设计：MCP 预拉取 + 快照注入双轨**

- 开发期用 MCP 拉真实数据生成 `data/mcd-snapshot.json`，保证离线可玩与数据兜底
- 运行时由后端代理直连 MCP，保证数据鲜活
- 快照缓存解决限流（600 次/分钟）与首屏速度问题

### 3.3 可复用的参考实现

来自 `D:\asp\stbcy\冰橙星星乐 三国篇 - 起源`（仅借鉴设计思路，代码独立重写）：

| 参考文件 | 可借鉴内容 |
| --- | --- |
| `miniprogram/utils/gameStore.js` | 状态机设计：createGame / rollDice / drawEvent / 回合推进 / 胜利判定 |
| `miniprogram/utils/gameData.sanguo.js` | 数据模型：characters（4 维属性+技能+台词）/ events（effect_rules 结构化结算）/ cities（price/toll/defense） |
| `miniprogram/themes/registry.js` | 主题注册表模式 |
| `tools/generate-theme-map-html.js` | 棋盘地图生成思路 |

**注意**：原项目是微信小程序形态且数据为三国题材，本项目需完全重写为 Web + 麦当劳题材，不得直接复制三国人物/城池数据。

---

## 四、代码规范（用户强制要求）

1. **禁止使用 try/catch**，统一改为 callback 形式（`fn(err, data)` 风格）。
2. **前端样式禁止使用紫色或紫蓝色**。本项目主色为麦当劳金 `#FFC72C` + 快乐红 `#E62E1E`。
3. HTML 若使用 Vue，必须加 `v-cloak` 防止未渲染提前显示。
4. 除 XSS 防护外，**严禁对 HTML 符号做实体转义**。
5. 生成的代码须尽量增加中文注释。
6. **数据能不使用映射就不使用映射**，避免无谓的 map/字典转换开销。
7. 遇到问题无法定位时，在 console 面板输出调试信息，明确标记问题出现在哪一步。
8. **完成后必须复查代码**，确认方法签名、参数、返回值正确。
9. 包管理优先使用国内镜像：npm 用淘宝源 `https://registry.npmmirror.com`，pip 用清华源。
10. 本机 PHP 运行器路径：`D:\soft\PHP83\php.exe`。

### 4.1 视觉规范

| 项目 | 色值 |
| --- | --- |
| 麦当劳金（主色） | `#FFC72C` |
| 快乐红 | `#E62E1E` |
| 麦香棕 | `#8B5A2B` |
| 奶油白 | `#FFF8E7` |
| 可乐棕（深色底） | `#4A2C17` |
| 乐园草地绿 | `#7CB518` |
| 禁用 | 紫色 / 紫蓝色系全部 |

角色卡：圆角 16px、金色描边、稀有度角标（T1 金 / T2 银 / T3 铜）。

---

## 五、参赛交付物清单

> 官方要求见 https://github.com/M-China/mcd-developer-innovation-challenge
> **文件名一字不可改动**（校验脚本按文件名判定），括号内为官方要求项。

| 序号 | 官方要求 | 对应文件 | 状态 |
| --- | --- | --- | --- |
| 1 | 项目介绍 / 安装方法 / 使用示例 / 目标用户 | `README.md` | 已完成 |
| 2 | 参赛声明（**内容不可改**） | `CONTEST_DECLARATION.md` | 已完成（官方原文，MD5 一致） |
| 3 | MCP Server / Tool / 调用流程 / 业务价值 | `MCP_INTEGRATION.md` | 已完成 |
| 4 | 源代码或可运行内容 | 本仓库 | 已完成 |
| 5 | WorkBuddy 开发对话上下文 | `workbuddy.md` | 已完成 |

| 报名动作 | 说明 |
| --- | --- |
| GitHub 公开仓库 | 需新建 **Public** 仓库（报名条件之一） |
| Issue 报名 | 在官方仓库发 Issue，格式见 README「九、如何报名」 |
| 项目创建时间 | 必须落在 2025-12-25 00:00 ~ 2026-10-25 23:59 |

**赛事关键时间**

| 阶段 | 时间（北京时间） |
| --- | --- |
| 报名及排名 | 2026-10-09 10:30 ~ **2026-10-25 23:59** |
| 定榜 | 2026-10-26 00:00 |
| 收货信息提交截止 | 2026-11-14 |

> **排名按公开 Star 数**，Star > 0 才进榜，排行榜展示前 100。

---

## 六、项目文件约定

| 文件/目录 | 说明 |
| --- | --- |
| `AGENTS.md` | 本规则文件 |
| `AI更新历史.md` | 每次变更必须追加记录（本地文件，已 gitignore，不入公开仓库；
公开仓库的迭代记录见 `workbuddy.md`） |
| `.env` | 真实凭证，已被 .gitignore 忽略 |
| `.env.example` | 凭证模板，仅占位符 |
| `.gitignore` | 防泄露规则 |
| `参赛设计方案.md` | 需求与设计方案 |
| `DEV-CONVERSATION.md` | 开发对话留档 |
| `backend/mcp-client.js` | MCP 客户端（鉴权、节流、错误日志） |
| `backend/pull-mcd-data.js` | 数据拉取脚本 |
| `backend/campaign-parser.js` | 真实活动 DSL 解析器 |
| `backend/sanitize-snapshot.js` | 快照脱敏脚本 |
| `backend/server.js` | HTTP 服务 + MCP 代理 + 安全白名单 |
| `game/engine.js` | 桌游状态机 |
| `game/characters.js` | 12 张角色卡（带 MCP 溯源） |
| `game/nutrition.js` | 营养科普题生成器（保证答案唯一） |
| `web/` | 前端三件套 + AI 生成插画 |
| `test/engine.test.js` | 39 项自动化断言测试 |
| `data/mcd-snapshot.json` | 真实快照（含隐私，不提交） |
| `data/mcd-snapshot.public.json` | 脱敏快照（开源提交用） |

---

## 七、开发环境注意事项

1. **服务端口 3100** 若启动失败报 `EADDRINUSE`，用 PowerShell 排查：
   ```powershell
   Get-NetTCPConnection -LocalPort 3100 -State Listen
   Stop-Process -Id <PID> -Force
   ```
2. **图片处理脚本**必须用 Windows 绝对路径（Git Bash 的 `/tmp` 在 Windows Python 中不存在）：
   ```bash
   T=$(cygpath -w /tmp)   # Git Bash 转换
   ```
3. **Pillow 安装**：清华源无此包，需回退官方源 `pip install Pillow`。
4. **AI 生成图片**必须裁掉底部 6-8% 去除「AI生成 WORKBUDDY」水印。
5. **图片压缩**：PNG 压缩率不足，插画类统一转 JPEG（可节省 87-95%）。