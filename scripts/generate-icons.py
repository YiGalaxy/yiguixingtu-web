# -*- coding: utf-8 -*-
"""
生成站点图标（favicon.ico / favicon.svg / apple-touch-icon.png）。

用法（在 yiguixingtu-web 根目录）：

    python scripts/generate-icons.py

产物都写在 public/ 下，跑完刷新页面即可（DevTools 里要强制刷新，图标缓存很顽固）。

【为什么用脚本画，而不是找一张图】
  1. 图标要在 16×16 下认得出。位图缩到 16px 会糊成一团，所以每个尺寸都是
     **按目标尺寸单独栅格化**（先按 8 倍超采样画、再 LANCZOS 缩下来），
     而不是"画一张 512 再缩小"。
  2. 尺寸小的时候要**换一套参数**：16px 下 0.05 倍宽度的细环会退化成灰边，
     所以 ≤32px 用更粗的环、更大的星、去掉星屑 —— 这叫 optical sizing，
     跟字体在大字号下收细是一个道理。
  3. 图形改动可复现：本站的主题色 / 星轨母题哪天想调，改这里几个常量重跑即可，
     不用重新画一遍（.ico 是二进制，光看文件看不出它是怎么来的）。

【图形在说什么】「亿轨星途」= 星轨。一颗金色的四角星 + 一条倾斜的青色轨道环，
  深蓝底取自全站 CSS 变量（--accent #f2c14e / --cyan #59d6e6 / --bg #0e1a36），
  所以图标和页面是同一套配色，不会像"贴上去的第三方 logo"。
"""

from __future__ import annotations

import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ---------------------------------------------------------------- 主题色
BG_FROM = (0x22, 0x37, 0x5F)      # 左上：比 --surface-2 略亮一点，让渐变看得出来
BG_TO = (0x0B, 0x14, 0x28)        # 右下：比 --bg 再深一档，四角不糊成一片
GOLD_HI = (0xFF, 0xEE, 0xAE)      # 星的上半：--accent-strong 提亮
GOLD_LO = (0xEF, 0xB4, 0x3C)      # 星的下半
GOLD_GLOW = (0xFF, 0xD9, 0x6B)    # 星的辉光
CYAN = (0x59, 0xD6, 0xE6)         # 轨道环：--cyan
WHITE = (0xFF, 0xFF, 0xFF)

# ---------------------------------------------------------------- 图形参数
# 所有数值都是"占画布边长的比例"，这样同一套参数能直接喂给 16px 和 512px
RADIUS = 0.235                    # 圆角半径（≈ iOS 图标的圆角观感）
RING_TILT = -24.0                 # 轨道环倾角（度），负号 = 右上翘
STAR_CENTER = (0.500, 0.475)      # 星心（略高于正中，视觉重心更稳）

# 分档参数：≤32px 视觉上要"加粗放大"，否则缩小后环会变灰线、星会变小点
PROFILES = {
    # 16/32px：环更粗、星更大、腰更宽（细腰在 16px 下会糊成一团）、核心白点更弱
    "small": dict(ring_rx=0.400, ring_ry=0.180, ring_w=0.078, star_r=0.335,
                  star_waist=0.120, core_r=0.095, core_peak=150),
    # 48px 以上：细腰、细环、明显的白热核心 —— 这几个尺度在小尺寸下都体现不出来
    "large": dict(ring_rx=0.425, ring_ry=0.185, ring_w=0.046, star_r=0.300,
                  star_waist=0.048, core_r=0.105, core_peak=195),
}

# 星屑：只在 ≥48px 画，小尺寸下它们只是脏点
SPECKS = [
    (0.215, 0.215, 0.0140, 130),
    (0.792, 0.198, 0.0105, 100),
    (0.238, 0.788, 0.0090, 85),
]


def profile_for(size: int) -> dict:
    return PROFILES["small" if size <= 32 else "large"]


def supersample(size: int) -> int:
    """超采样倍数：小图多采几次（一次运行几毫秒，换来干净的边缘）。"""
    if size <= 64:
        return 8
    if size <= 256:
        return 4
    return 2


def sparkle_polygon(cx: float, cy: float, outer: float, waist: float, samples: int = 96):
    """四角星（sparkle）：四个尖在上下左右，尖与尖之间用二次贝塞尔向内凹进去。

    【为什么不是"ρ(θ)=|cos2θ|^p"那条极坐标曲线】试过，出来的是**四瓣花**：
    那条曲线在尖附近掉得太慢（θ 偏 10° 时还有 73% 的外径），四个瓣又短又胖。
    贝塞尔这条才是想要的形状 —— 尖是尖的、腰是细的：
        B(t) = (1-t)²·尖 + 2(1-t)t·控制点 + t²·下一个尖
    控制点落在 45° 方向的 waist 处，waist 越小腰越细（大尺寸用细腰，小尺寸放宽）。

    【为什么还要 samples】贝塞尔本身是曲线，这里采成折线交给 Pillow 画多边形：
    超采样 + LANCZOS 之后看不出棱角，而 96 段 × 4 段的计算量可以忽略。
    """
    pts = []
    waist_r = waist
    for k in range(4):
        a0 = -math.pi / 2 + k * math.pi / 2          # 尖的方向：上 → 右 → 下 → 左
        a1 = a0 + math.pi / 2
        ac = (a0 + a1) / 2                           # 45° 方向 = 腰
        p0 = (cx + outer * math.cos(a0), cy + outer * math.sin(a0))
        p2 = (cx + outer * math.cos(a1), cy + outer * math.sin(a1))
        pc = (cx + waist_r * math.cos(ac), cy + waist_r * math.sin(ac))
        for i in range(samples):
            t = i / samples
            u = 1 - t
            pts.append((
                u * u * p0[0] + 2 * u * t * pc[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * pc[1] + t * t * p2[1],
            ))
    return pts


def diagonal_gradient(size: int, c0, c1) -> Image.Image:
    """左上到右下的线性渐变。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x + y) / (2 * (size - 1))                     # 0（左上）→ 1（右下）
    a0, a1 = np.array(c0, np.float32), np.array(c1, np.float32)
    rgb = a0[None, None, :] * (1 - t[..., None]) + a1[None, None, :] * t[..., None]
    return Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")


def radial_alpha(size: int, cx: float, cy: float, radius: float, peak: int, falloff: float = 1.0):
    """一张只有 alpha 的径向渐隐图（用作辉光/受光面）。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / max(radius, 1e-6)
    a = np.clip(1 - d, 0, 1) ** falloff * peak
    return Image.fromarray(a.astype(np.uint8), "L")


def render(size: int, rounded: bool = True, padding: float = 0.0) -> Image.Image:
    """画一张 size×size 的图标。

    rounded=False 用于 apple-touch-icon：iOS 自己会切圆角，我们给的图应该是**满幅方图**
    （带透明圆角反而会露出白底/黑底）。
    """
    ss = supersample(size)
    S = size * ss
    prof = profile_for(size)
    detail = size >= 48
    pad = padding * S

    # ---- 底：圆角方块 + 对角渐变 ----
    if rounded:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, S - 1, S - 1], radius=int(RADIUS * S), fill=255
        )
    else:
        mask = Image.new("L", (S, S), 255)

    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(diagonal_gradient(S, BG_FROM, BG_TO), (0, 0), mask)

    # ---- 玻璃受光：顶部一层很淡的白，呼应页面上的 .glass 卡片 ----
    if rounded and size >= 180:
        sheen = Image.new("L", (S, S), 0)
        d = ImageDraw.Draw(sheen)
        band = int(0.22 * S)
        for i in range(band):
            d.line([(0, i), (S, i)], fill=int(26 * (1 - i / band) ** 1.6))
        icon.paste(Image.new("RGBA", (S, S), WHITE + (255,)), (0, 0), Image.composite(
            sheen, Image.new("L", (S, S), 0), mask))

    # ---- 星心处的金色辉光 ----
    glow = radial_alpha(S, 0.5 * S, 0.47 * S, 0.42 * S, 42, falloff=1.4)
    icon.paste(Image.new("RGBA", (S, S), GOLD_GLOW + (255,)), (0, 0), Image.composite(
        glow, Image.new("L", (S, S), 0), mask))

    # ---- 轨道环：先整圈（暗），再画"前面"那半圈（亮）→ 有了前后关系 ----
    ring_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring_layer)
    box = [
        0.5 * S - prof["ring_rx"] * S + pad, 0.5 * S - prof["ring_ry"] * S + pad,
        0.5 * S + prof["ring_rx"] * S - pad, 0.5 * S + prof["ring_ry"] * S - pad,
    ]
    w = max(1, int(round(prof["ring_w"] * S)))
    rd.ellipse(box, outline=CYAN + (120,), width=w)
    # 前半圈：PIL 的角度以 3 点钟为 0、顺时针为正，0→180 就是下半圈
    rd.arc(box, start=0, end=180, fill=CYAN + (252,), width=w)
    ring_layer = ring_layer.rotate(RING_TILT, resample=Image.BICUBIC, center=(S / 2, S / 2))
    icon = Image.alpha_composite(icon, Image.composite(
        ring_layer, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

    # ---- 星屑（只在大尺寸画） ----
    if detail:
        sp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sp)
        for rx, ry, rr, alpha in SPECKS:
            r = rr * S
            sd.ellipse([rx * S - r, ry * S - r, rx * S + r, ry * S + r], fill=WHITE + (alpha,))
        icon = Image.alpha_composite(icon, sp)

    # ---- 四角星：辉光 + 渐变本体 + 白热的核心 ----
    cx, cy = STAR_CENTER[0] * S, STAR_CENTER[1] * S
    star = sparkle_polygon(cx, cy, prof["star_r"] * S, prof["star_waist"] * S)

    star_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(star_mask).polygon(star, fill=255)

    halo = star_mask.filter(ImageFilter.GaussianBlur(radius=0.055 * S))
    icon = Image.alpha_composite(icon, Image.composite(
        Image.new("RGBA", (S, S), GOLD_GLOW + (150,)), Image.new("RGBA", (S, S), (0, 0, 0, 0)), halo))

    # 星身用竖向渐变：上亮下深，缩到 16px 时这一点明暗让"尖"仍看得出来
    y = np.mgrid[0:S, 0:S][0].astype(np.float32)
    t = np.clip((y - (cy - prof["star_r"] * S)) / (2 * prof["star_r"] * S), 0, 1)
    grad = np.zeros((S, S, 4), np.uint8)
    for i in range(3):
        grad[..., i] = (GOLD_HI[i] * (1 - t) + GOLD_LO[i] * t).astype(np.uint8)
    grad[..., 3] = 255
    icon = Image.alpha_composite(icon, Image.composite(
        Image.fromarray(grad, "RGBA"), Image.new("RGBA", (S, S), (0, 0, 0, 0)), star_mask))

    core = radial_alpha(S, cx, cy, prof["core_r"] * S, prof["core_peak"], falloff=1.8)
    icon = Image.alpha_composite(icon, Image.composite(
        Image.new("RGBA", (S, S), WHITE + (255,)), Image.new("RGBA", (S, S), (0, 0, 0, 0)), core))

    # ---- 内描边：一圈极淡的白，把图标从背景里"抬"起来 ----
    if rounded and size >= 180:
        edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle(
            [0.022 * S, 0.022 * S, S - 1 - 0.022 * S, S - 1 - 0.022 * S],
            radius=int(RADIUS * S * 0.92), outline=WHITE + (18,), width=max(ss, int(0.008 * S)))
        icon = Image.alpha_composite(icon, edge)

    return icon.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- SVG（同一套几何，矢量版）
def build_svg(canvas: int = 512) -> str:
    """现代浏览器优先用这个（任意缩放都清晰，且比 .ico 小得多）。"""
    S = canvas
    prof = PROFILES["large"]
    w = prof["ring_w"] * S

    # 前半圈：把参数方程采成折线（PIL 那套 start/end 在 SVG 里没有对应写法）
    rx, ry = prof["ring_rx"] * S, prof["ring_ry"] * S
    front = []
    for i in range(49):
        t = math.pi * i / 48                       # 0 → π：下半圈
        front.append((S / 2 + rx * math.cos(t), S / 2 + ry * math.sin(t)))
    front_d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in front)

    star = sparkle_polygon(STAR_CENTER[0] * S, STAR_CENTER[1] * S,
                        prof["star_r"] * S, prof["star_waist"] * S, samples=240)
    star_d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in star) + " Z"

    # 星屑：与位图版共用同一组坐标（SPECKS），两边看起来才是同一个图标
    specks = "".join(
        f'  <circle cx="{sx * S:.0f}" cy="{sy * S:.0f}" r="{sr * S:.0f}"'
        f' fill="#fff" fill-opacity="{sa / 255:.2f}"/>\n'
        for sx, sy, sr, sa in SPECKS
    )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="亿轨星途">
  <!-- 由 scripts/generate-icons.py 生成，不要手改：要调图形请改那个脚本再重跑 -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22375f"/>
      <stop offset="1" stop-color="#0b1428"/>
    </linearGradient>
    <linearGradient id="star" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffeeae"/>
      <stop offset="1" stop-color="#efb43c"/>
    </linearGradient>
    <radialGradient id="warm">
      <stop offset="0" stop-color="#f2c14e" stop-opacity=".22"/>
      <stop offset="1" stop-color="#f2c14e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core">
      <stop offset="0" stop-color="#fff" stop-opacity=".85"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{S}" height="{S}" rx="{RADIUS * S:.0f}" fill="url(#bg)"/>
  <circle cx="{S / 2:.0f}" cy="{0.47 * S:.0f}" r="{0.42 * S:.0f}" fill="url(#warm)"/>
  <g transform="rotate({RING_TILT} {S / 2:.0f} {S / 2:.0f})">
    <ellipse cx="{S / 2:.0f}" cy="{S / 2:.0f}" rx="{rx:.0f}" ry="{ry:.0f}"
             fill="none" stroke="#59d6e6" stroke-opacity=".47" stroke-width="{w:.0f}"/>
    <path d="{front_d}" fill="none" stroke="#59d6e6" stroke-width="{w:.0f}"/>
  </g>
{specks}  <path d="{star_d}" fill="url(#star)"/>
  <circle cx="{STAR_CENTER[0] * S:.0f}" cy="{STAR_CENTER[1] * S:.0f}" r="{0.105 * S:.0f}" fill="url(#core)"/>
  <rect x="{0.022 * S:.0f}" y="{0.022 * S:.0f}" width="{S - 2 * 0.022 * S:.0f}" height="{S - 2 * 0.022 * S:.0f}"
        rx="{RADIUS * S * 0.92:.0f}" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="{0.008 * S:.0f}"/>
</svg>
"""


def write_preview(frames: dict, out_dir: pathlib.Path) -> None:
    """把几档尺寸摆在一张图上，用来肉眼确认"缩到 16px 还认不认得出"。
    只有显式传了目录才写（产物目录 public/ 里不该出现这种自检图）。"""
    out_dir.mkdir(parents=True, exist_ok=True)

    # 左：1:1 实际大小（就是浏览器标签页上的样子）；右：放大看边缘有没有毛刺
    one = Image.new("RGBA", (16 + 32 + 48 + 64 + 3 * 24 + 32, 160), (26, 33, 48, 255))
    x = 16
    for s in (16, 32, 48, 64):
        one.alpha_composite(frames[s], (x, 90 - s // 2))
        x += s + 24
    one.save(out_dir / "icon-preview.png")

    zoom = Image.new("RGBA", (20 + 16 * 8 + 20 + 32 * 4 + 20 + 48 * 3 + 20, 16 * 8 + 40), (26, 33, 48, 255))
    x = 20
    for s, z in ((16, 8), (32, 4), (48, 3)):
        zoom.alpha_composite(frames[s].resize((s * z, s * z), Image.NEAREST), (x, 20))
        x += s * z + 20
    zoom.save(out_dir / "icon-zoom.png")
    print(f"预览图写到 {out_dir}")


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "public"
    out.mkdir(exist_ok=True)

    # 每个尺寸单独栅格化；.ico 里放 16/32/48 三档（Windows/浏览器各自会挑合适的）
    frames = {s: render(s) for s in (16, 32, 48, 64, 128, 180, 512)}

    ico = frames[48].copy()
    ico.save(out / "favicon.ico", format="ICO",
             append_images=[frames[16], frames[32]],
             sizes=[(48, 48), (16, 16), (32, 32)])

    # apple-touch-icon：满幅方图（iOS 自己切圆角），图形缩到 0.92 留出呼吸感
    render(180, rounded=False, padding=0.02).save(out / "apple-touch-icon.png")

    # 【为什么不额外生成 icon-192 / icon-512】那两个是给 site.webmanifest 用的，
    # 而本站没有 manifest（不是 PWA，装不成应用），生成了也没人引用 ——
    # public/ 里多两个"没人引用的图片"只会让下一个人以为是漏配了什么。
    (out / "favicon.svg").write_text(build_svg(), encoding="utf-8")

    for name in ("favicon.ico", "favicon.svg", "apple-touch-icon.png"):
        p = out / name
        print(f"{name:24s} {p.stat().st_size:>8,d} bytes")

    if len(sys.argv) > 1:
        write_preview(frames, pathlib.Path(sys.argv[1]))


if __name__ == "__main__":
    main()
