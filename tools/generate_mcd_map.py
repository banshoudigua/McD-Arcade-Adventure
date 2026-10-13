# -*- coding: utf-8 -*-
# 麦麦奇幻乐园 · 环形桌游地图生成器
# 流程：AI 生成主题底图（装饰层）+ 本脚本程序化绘制 30 格棋盘（精确层）
# 为什么要程序化画格子：AI 生图的格子编号不可控，程序绘制才能保证
# 30 格位置/编号 100% 准确，且与前端环形棋盘的坐标公式完全一致
# 用法：python tools/generate_mcd_map.py

import math
import os
import glob
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "web", "assets", "map.jpg")

# 画布尺寸（与前端棋盘容器 3:2 比例一致）
W, H = 1536, 1024

# 椭圆轨道参数（格子中心）——前端 JS 使用相同比例，保证走格对位
# 椭圆参数由道路像素检测得出（检测脚本见 AI更新历史 2026-10-09 续六）
CX, CY = 765.0, 540.0
RX, RY = 565.0, 300.0
CELL = 78          # 格子边长
N = 30             # 格子总数

# 中文字体（Windows 自带微软雅黑）
def load_font(size, bold=True):
    candidates = [
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

FONT_NUM = load_font(30)
FONT_TAG = load_font(17)
FONT_TAG_SMALL = load_font(14)
FONT_TITLE = load_font(40)
FONT_SUB = load_font(19)
FONT_PANEL_H = load_font(24)
FONT_PANEL_B = load_font(16)
FONT_PANEL_S = load_font(14)

# 棋盘格类型（顺序与 game/engine.js 的 BOARD 完全一致）
TYPES = [
    "start", "rest", "cardSlot", "shop", "battle", "event",
    "rest", "shop", "battle", "cardSlot", "event", "science",
    "shop", "battle", "event", "rest", "cardSlot", "shop",
    "battle", "event", "science", "shop", "battle", "cardSlot",
    "event", "rest", "shop", "battle", "cardSlot", "event",
]

# 类型 → 格子底色（麦当劳配色，无紫色）
COLORS = {
    "start": (230, 46, 30),      # 快乐红
    "event": (226, 87, 76),      # 活动红
    "battle": (232, 131, 58),    # 炸鸡橙
    "shop": (139, 90, 43),       # 麦香棕
    "cardSlot": (46, 158, 107),  # 卡牌青绿
    "rest": (124, 181, 24),      # 草地绿
    "science": (31, 122, 77),    # 科普深绿
}

# 特殊格标签（pos → 文案），仅挑代表性格子，避免拥挤
TAGS = {
    0: "起点 · 金色拱门",
    2: "新手驿站 · 抽卡",
    5: "活动广场 · 真实活动卡",
    11: "营养科普站 · 答题",
    14: "联名广场 · 限时活动",
    28: "核心驿站 · 抽 T1 卡",
    29: "终幕舞台 · 冲刺终点",
}

# 格子中心坐标（与前端 JS 公式一致：angle = 90° - i*12°，屏幕 y 向下）
def cell_center(i):
    ang = math.radians(90 - i * (360.0 / N))
    return (CX + RX * math.cos(ang), CY + RY * math.sin(ang))

def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def text_center(draw, cx, cy, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=font, fill=fill)

def main():
    # 1. 找最新的 AI 底图
    gen_dir = os.path.join(BASE, "generated-images")
    pngs = sorted(glob.glob(os.path.join(gen_dir, "*.png")), key=os.path.getmtime)
    if not pngs:
        raise SystemExit("generated-images 下没有底图，请先用生图工具生成")
    src = pngs[-1]
    print("底图:", os.path.basename(src)[:40])

    img = Image.open(src).convert("RGB").resize((W, H), Image.LANCZOS)
    draw = ImageDraw.Draw(img, "RGBA")

    # 2. 道路提亮：沿椭圆画一条浅色环带，让格子区域更清晰
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    band_draw = ImageDraw.Draw(band)
    ring_outer = [(CX + (RX + 62) * math.cos(math.radians(a)),
                   CY + (RY + 62) * math.sin(math.radians(a))) for a in range(0, 360, 4)]
    ring_inner = [(CX + (RX - 62) * math.cos(math.radians(a)),
                   CY + (RY - 62) * math.sin(math.radians(a))) for a in range(0, 360, 4)]
    band_draw.polygon(ring_outer + ring_inner[::-1], fill=(255, 246, 224, 150))
    img = Image.alpha_composite(img.convert("RGBA"), band.filter(ImageFilter.GaussianBlur(2)))
    draw = ImageDraw.Draw(img, "RGBA")

    # 3. 绘制 30 个格子 + 编号
    centers = []
    for i in range(N):
        x, y = cell_center(i)
        centers.append((x, y))
        t = TYPES[i]
        color = COLORS[t]
        half = CELL / 2
        box = (x - half, y - half, x + half, y + half)
        # 白描边圆角块（参考图样式）
        rounded(draw, box, 18, color + (255,), outline=(255, 255, 255, 255), width=4)
        # 编号：地图显示 1-30（引擎 position 0-29）
        num_color = (74, 44, 23, 255) if t == "rest" else (255, 255, 255, 255)
        text_center(draw, x, y, str(i + 1), FONT_NUM, num_color)

    # 4. 特殊格大标签（放在格子外侧，沿法线方向外推）
    for pos, label in TAGS.items():
        x, y = centers[pos]
        # 外法线方向
        nx, ny = (x - CX), (y - CY)
        norm = math.hypot(nx, ny) or 1.0
        tx, ty = x + nx / norm * 46, y + ny / norm * 46
        bbox = draw.textbbox((0, 0), label, font=FONT_TAG)
        tw = bbox[2] - bbox[0]
        pad = 10
        # 标签是否超出画布：超出则改为放在格子内侧
        lx, ly = tx, ty
        if lx - tw / 2 - pad < 8 or lx + tw / 2 + pad > W - 8 or ly - 18 < 8 or ly + 18 > H - 8:
            lx, ly = x - nx / norm * 46, y - ny / norm * 46
        box = (lx - tw / 2 - pad, ly - 17, lx + tw / 2 + pad, ly + 17)
        rounded(draw, box, 12, (255, 252, 242, 245), outline=(139, 90, 43, 255), width=2)
        # 左侧类型色块
        tcolor = COLORS[TYPES[pos]]
        rounded(draw, (box[0] + 5, ly - 9, box[0] + 19, ly + 9), 5, tcolor + (255,))
        draw.text((box[0] + 27, ly - (bbox[3] - bbox[1]) / 2 - bbox[1]), label,
                  font=FONT_TAG, fill=(74, 44, 23, 255))

    # 5. 中央玩法面板（深绿圆角大矩形，参考图样式）
    px1, py1, px2, py2 = CX - 330, CY - 162, CX + 330, CY + 162
    rounded(draw, (px1, py1, px2, py2), 30, (31, 92, 61, 252), outline=(255, 199, 44, 255), width=5)

    text_center(draw, CX, py1 + 40, "麦麦奇幻乐园", FONT_TITLE, (255, 199, 44, 255))
    text_center(draw, CX, py1 + 78, "MCP 真实数据 · 30 格环形地图 · 掷骰前进", FONT_PANEL_B, (255, 255, 255, 230))

    # 六个特色格说明卡（两列三行，紧凑版）
    cards = [
        ("1 金色拱门", "起点·经过欢乐+1", COLORS["start"]),
        ("红格 活动舞台", "抽真实活动卡", COLORS["event"]),
        ("绿格 科普站", "营养答题赢欢乐", COLORS["science"]),
        ("青格 卡牌驿站", "获得餐品伙伴卡", COLORS["cardSlot"]),
        ("橙格 欢乐挑战", "判定赢欢乐护盾", COLORS["battle"]),
        ("棕格 欢乐商店", "欢乐值购物", COLORS["shop"]),
    ]
    cw, ch = 296, 62
    gapx, gapy = 16, 10
    start_x = CX - cw - gapx / 2
    start_y = py1 + 102
    for idx, (title, desc, color) in enumerate(cards):
        col, row = idx % 2, idx // 2
        cx0 = start_x + col * (cw + gapx)
        cy0 = start_y + row * (ch + gapy)
        rounded(draw, (cx0, cy0, cx0 + cw, cy0 + ch), 12, (255, 252, 242, 240))
        # 左侧色条
        rounded(draw, (cx0 + 8, cy0 + 9, cx0 + 21, cy0 + ch - 9), 5, color + (255,))
        draw.text((cx0 + 30, cy0 + 9), title, font=FONT_TAG, fill=(74, 44, 23, 255))
        draw.text((cx0 + 30, cy0 + 33), desc, font=FONT_PANEL_S, fill=(110, 85, 60, 255))

    text_center(draw, CX, py2 - 24, "绕一圈全体 +3 欢乐值", FONT_PANEL_B, (255, 199, 44, 230))

    # 6. 左上角木质标题牌
    lx1, ly1, lx2, ly2 = 28, 24, 356, 118
    rounded(draw, (lx1 + 5, ly1 + 7, lx2 + 5, ly2 + 7), 20, (60, 38, 20, 120))
    rounded(draw, (lx1, ly1, lx2, ly2), 20, (139, 90, 43, 255), outline=(255, 199, 44, 255), width=4)
    text_center(draw, (lx1 + lx2) / 2, (ly1 + ly2) / 2 - 12, "麦麦奇幻乐园", FONT_PANEL_H, (255, 199, 44, 255))
    text_center(draw, (lx1 + lx2) / 2, (ly1 + ly2) / 2 + 26, "餐品伙伴 · 欢乐闯关", FONT_PANEL_S, (255, 246, 224, 235))

    # 7. 输出（JPEG 压缩）
    img = img.convert("RGB")
    img.save(OUT, "JPEG", quality=86, optimize=True, progressive=True)
    print("已生成:", OUT)
    print("尺寸:", img.size, "大小:", os.path.getsize(OUT) // 1024, "KB")

if __name__ == "__main__":
    main()