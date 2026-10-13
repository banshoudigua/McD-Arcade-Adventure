# 角色卡面图自动居中工具
#
# 背景：12 张角色卡由 AI 图生图生成，每张图里角色的构图位置并不在画布正中
#      （例如「麦旋风」的奥利奥装饰挂在右上角，把整体视觉重心带偏）。
#      CSS 层面 .char-img 本身是居中的（实测 12 张偏移 dx 全为 0），
#      所以「看着没居中」只能从图片本身解决。
#
# 做法：
#   1. 取四角像素的中位色作为背景色
#   2. 按「与背景色的差异」做权重投影，统计主体在 X / Y 方向的包围盒
#   3. 以主体包围盒中心为新中心，取边长 = max(主体宽, 主体高) * 留边系数的正方形窗口
#   4. 窗口能落在图内 → 直接裁切
#      窗口越界（主体太靠边、裁不下）→ 改用「扩展画布」：用背景色补边把主体搬到正中，
#      这样既不切主体，也保证真正居中
#
# 用法：
#   python tools/center_character_images.py# 干跑，只打印每张图的偏移与处理方式
#   python tools/center_character_images.py --apply  # 真正写入（覆盖原图，可 git 回滚）
#
# 依赖：Pillow（清华源无此包，需 pip install Pillow）

import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "web", "assets", "characters")

# 主体外留白比例：1.12 = 四周留约 6% 余量，避免裁得太紧显得憋屈
PAD_RATIO = 1.12
# 投影阈值：权重低于该列/行最大值的 6% 视为背景
COL_RATIO = 0.06
# 像素与背景色的平均差异小于该值视为背景
BG_THRESHOLD = 22
# 缩略尺寸：先缩到 120×120 做投影计算，速度快且足够稳定
SAMPLE = 120
# 统一输出边长（正方形，与卡片圆形头像一致）
OUTPUT_SIZE = 300
# 归一化模式下，主体最大边占画布的比例——统一角色在圆里的视觉大小
NORMALIZE_RATIO = 0.92


def sample_bg_color(im):
    """取四角像素的中位色作为背景色（与原图背景一致，扩展画布时看不出接缝）"""
    w, h = im.size
    corners = [im.getpixel((0, 0)), im.getpixel((w - 1, 0)),
               im.getpixel((0, h - 1)), im.getpixel((w - 1, h - 1))]
    return tuple(int(sorted(c[i] for c in corners)[len(corners) // 2]) for i in range(3))


def detect_bbox(im, bg):
    """返回主体包围盒 (x0, y0, x1, y1)，坐标已换算回原图尺寸"""
    w, h = im.size
    px = im.convert("RGB").resize((SAMPLE, SAMPLE), Image.LANCZOS)

    col_w = [0.0] * SAMPLE
    row_w = [0.0] * SAMPLE
    for y in range(SAMPLE):
        for x in range(SAMPLE):
            r, g, b = px.getpixel((x, y))
            dist = (abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) / 3.0
            weight = max(0.0, dist - BG_THRESHOLD)
            col_w[x] += weight
            row_w[y] += weight

    max_col = max(col_w)
    max_row = max(row_w)
    xs = [x for x in range(SAMPLE) if col_w[x] > max_col * COL_RATIO]
    ys = [y for y in range(SAMPLE) if row_w[y] > max_row * COL_RATIO]

    sx = w / float(SAMPLE)
    sy = h / float(SAMPLE)
    return xs[0] * sx, ys[0] * sy, xs[-1] * sx, ys[-1] * sy


def plan_recenter(im, bbox):
    """算出重新居中的方案

    返回 dict：
      mode  "crop"  存在一个能落在图内的正方形窗口，直接裁切即可居中
            "pad"   主体本身大到任何正方形窗口都放不下（接近满幅），
                    这时补边扩展画布，保证主体完整且严格居中
      box   crop 模式下的裁切框 (left, top, right, bottom)
      pads  pad 模式下的补边 (left, top, right, bottom)

    关键：先从「带留白的理想窗口」逐步收缩到「刚好容纳主体」，
         取第一个放得下的尺寸——这样既能真正居中，又尽量保留留白。
         （早期版本用补边扩展画布，但补边并不改变主体相对中心的位置，会留下残余偏心。）
    """
    w, h = im.size
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0

    size_min = max(bw, bh)
    size = max(bw, bh) * PAD_RATIO

    def fits(s):
        left = cx - s / 2.0
        top = cy - s / 2.0
        return left >= 0 and top >= 0 and left + s <= w and top + s <= h

    # 从理想尺寸往下收缩，找到第一个能完整放进画布的尺寸
    while size > size_min and not fits(size):
        size -= 1

    if fits(size):
        left = cx - size / 2.0
        top = cy - size / 2.0
        return {
            "mode": "crop",
            "box": (int(round(left)), int(round(top)),
                    int(round(left + size)), int(round(top + size))),
            "pads": None
        }

    # 极端情况：主体接近满幅，裁不下。补边扩展画布，让主体在新画布严格居中
    need = size_min * PAD_RATIO
    new_w = int(round(max(w, 2 * need, 2 * cx, 2 * (w - cx))))
    new_h = int(round(max(h, 2 * need, 2 * cy, 2 * (h - cy))))
    pad_l = int(round(new_w / 2.0 - cx))
    pad_t = int(round(new_h / 2.0 - cy))
    return {"mode": "pad", "box": None,
            "pads": (pad_l, pad_t, new_w - w - pad_l, new_h - h - pad_t)}


def apply_crop(im, plan):
    """按方案输出新的正方形图片"""
    if plan["mode"] == "crop":
        return im.convert("RGB").crop(plan["box"])

    pad_l, pad_t, pad_r, pad_b = plan["pads"]
    w, h = im.size
    new_w, new_h = w + pad_l + pad_r, h + pad_t + pad_b
    canvas = Image.new("RGB", (new_w, new_h), sample_bg_color(im))
    canvas.paste(im.convert("RGB"), (pad_l, pad_t))
    return canvas


def apply_normalize(im, bbox):
    """把主体放大/缩小到统一尺寸后居中，输出统一边长的正方形图

    解决「角色在圆头像里大小不一」的问题：12 张原图里主体作画尺寸差异很大，
    直接裁切居中后，巨无霸几乎填满圆、麦香鱼却小一档，并排看参差不齐。
    这里按「主体最大边 = 画布的 NORMALIZE_RATIO」统一缩放，
    再把主体中心对齐画布中心，超出部分用背景色补齐。
    """
    w, h = im.size
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0

    # 缩放系数：让主体最大边正好等于目标尺寸
    scale = (OUTPUT_SIZE * NORMALIZE_RATIO) / max(bw, bh)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))

    src = im.convert("RGB").resize((new_w, new_h), Image.LANCZOS)
    # 缩放后的主体中心
    scx, scy = cx * scale, cy * scale

    # 让缩放后的整张图可见所需的画布尺寸（主体居中于 OUTPUT_SIZE 窗口）
    off_x = int(round(OUTPUT_SIZE / 2.0 - scx))
    off_y = int(round(OUTPUT_SIZE / 2.0 - scy))
    pad_l = max(0, -off_x)
    pad_t = max(0, -off_y)
    canvas_w = new_w + pad_l + max(0, off_x)
    canvas_h = new_h + pad_t + max(0, off_y)

    canvas = Image.new("RGB", (canvas_w, canvas_h), sample_bg_color(im))
    canvas.paste(src, (pad_l, pad_t))

    # 裁出以主体为中心的 OUTPUT_SIZE × OUTPUT_SIZE 窗口
    center_x = pad_l + scx
    center_y = pad_t + scy
    left = int(round(center_x - OUTPUT_SIZE / 2.0))
    top = int(round(center_y - OUTPUT_SIZE / 2.0))
    left = max(0, min(left, canvas_w - OUTPUT_SIZE))
    top = max(0, min(top, canvas_h - OUTPUT_SIZE))
    return canvas.crop((left, top, left + OUTPUT_SIZE, top + OUTPUT_SIZE))


def main():
    apply = "--apply" in sys.argv
    # 默认开启归一化（统一角色视觉大小）；加 --crop-only 则只做居中裁切
    normalize = "--crop-only" not in sys.argv
    if not os.path.isdir(SRC_DIR):
        print("找不到目录:", SRC_DIR)
        return 1

    files = [f for f in sorted(os.listdir(SRC_DIR))
             if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    if not files:
        print("目录下没有图片")
        return 1

    print("模式:", "写入" if apply else "干跑（加 --apply 才会真正修改文件）")
    print("处理:", "居中 + 尺寸归一化（统一 %dpx，主体占 %.0f%%）"
          % (OUTPUT_SIZE, NORMALIZE_RATIO * 100) if normalize else "仅居中裁切")
    print("%-14s %8s %8s  %8s %s" % ("文件", "水平偏移", "垂直偏移", "缩放系数", "详情"))
    changed = 0

    for name in files:
        full = os.path.join(SRC_DIR, name)
        im = Image.open(full)
        w, h = im.size
        bbox = detect_bbox(im, sample_bg_color(im))
        cx, cy = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0
        dx, dy = cx - w / 2.0, cy - h / 2.0

        plan = plan_recenter(im, bbox)
        need = abs(dx) > 1 or abs(dy) > 1
        if need:
            changed += 1

        scale = (OUTPUT_SIZE * NORMALIZE_RATIO) / max(bbox[2] - bbox[0], bbox[3] - bbox[1])
        detail = str(plan["box"]) if plan["mode"] == "crop" else ("补边 " + str(plan["pads"]))
        print("%-14s %+8.1f %+8.1f  %8.3f %s" % (
            name, dx, dy, scale, detail))

        if need and apply:
            if normalize:
                apply_normalize(im, bbox).save(full, quality=92)
            else:
                apply_crop(im, plan).save(full, quality=92)
            print("       已重排并覆盖:", name)

    print("\n共 %d 张，其中 %d 张需要重新居中。" % (len(files), changed))
    if not apply and changed:
        print("确认无误后执行: python tools/center_character_images.py --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())