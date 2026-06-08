"""生成 AcFun 文章区助手扩展的图标 PNG"""
import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

# 颜色 - 主题橙
BG = (251, 140, 0)        # FB8C00
BG_DARK = (239, 108, 0)   # EF6C00
WHITE = (255, 255, 255)
SHADOW = (0, 0, 0, 60)


def draw_icon(size: int) -> Image.Image:
    # 放大 4 倍绘制以得到更平滑的边缘
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 圆角矩形背景
    r = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BG)

    # 内部一个略小的深色圆角矩形（边框效果）
    inner_pad = int(s * 0.10)
    d.rounded_rectangle(
        [inner_pad, inner_pad, s - 1 - inner_pad, s - 1 - inner_pad],
        radius=int(r * 0.78),
        fill=BG_DARK
    )

    # 画一个白色的"漏斗/屏蔽"图案：
    # 上方是矩形，下方收缩成三角形
    cx = s // 2

    # 漏斗主体（白色）
    funnel_w = int(s * 0.50)
    funnel_h = int(s * 0.45)
    top = int(s * 0.22)
    bottom = top + funnel_h
    left = cx - funnel_w // 2
    right = cx + funnel_w // 2

    # 漏斗上半部分（梯形）
    trap_h = int(funnel_h * 0.55)
    poly = [
        (left, top),
        (right, top),
        (cx + int(funnel_w * 0.18), top + trap_h),
        (cx - int(funnel_w * 0.18), top + trap_h),
    ]
    d.polygon(poly, fill=WHITE)

    # 漏斗下半部分（三角形管子）
    pipe_top = top + trap_h
    pipe_w_top = int(funnel_w * 0.36)
    pipe_h = int(funnel_h * 0.45)
    poly2 = [
        (cx - pipe_w_top // 2, pipe_top),
        (cx + pipe_w_top // 2, pipe_top),
        (cx + int(funnel_w * 0.10), pipe_top + pipe_h),
        (cx - int(funnel_w * 0.10), pipe_top + pipe_h),
    ]
    d.polygon(poly2, fill=WHITE)

    # 漏斗下方一个圆点（流出的内容）
    drop_r = int(s * 0.06)
    d.ellipse(
        [cx - drop_r, bottom - drop_r, cx + drop_r, bottom + drop_r],
        fill=WHITE
    )

    # 缩小到目标尺寸，使用高质量重采样
    return img.resize((size, size), Image.LANCZOS)


for sz in (16, 32, 48, 128):
    im = draw_icon(sz)
    out = os.path.join(OUT_DIR, f'icon{sz}.png')
    im.save(out)
    print(f'wrote {out}')

print('done')
