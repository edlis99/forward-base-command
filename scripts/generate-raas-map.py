#!/usr/bin/env python3
"""Generate the stylised, mirror-symmetric Leipalingis map.

Output: src/game/maps/leipalingis-map.json, in the same schema the game already
reads (roads / areas / buildings / places, grid 220 x 160 source units, which
the game projects onto its 440 x 320 cell grid).

Design (see docs/leipalingis-map.md):
  * North vs south, mirrored across the east-west centre line (y = 160 cells),
    so both sides get the same routes, cover, distances and objectives.
  * Real place names from the Leipalingis area, kept in roughly their real
    directions; positions, roads and woods are designed for play.
  * Every road ends on another road, closes on itself, or leaves the map edge.
  * A scenery border outside the playable rectangle keeps the board edge away
    from the fighting.
Deterministic: running it twice gives byte-identical output.
"""
import json, math, os

W, H = 440, 320                 # gameplay cells
MID = H / 2
PLAYABLE = [14, 10, 426, 310]   # cells: x0, y0, x1, y1 (outside = scenery)
BOUNDS = [23.71, 54.025, 24.02, 54.16]  # west, south, east, north (kept for the HUD's coordinate mapping)

def h(*v):
    x = math.sin(sum(a * b for a, b in zip(v, (12.9898, 78.233, 37.719, 4.581)))) * 43758.5453
    return x - math.floor(x)

def mirror_pt(p): return [p[0], H - p[1]]
def mirror_poly(pts): return [mirror_pt(p) for p in pts]

def symmetric(north_half):
    """North half of a road ending exactly on the centre line -> full mirrored road."""
    assert abs(north_half[-1][1] - MID) < 1e-9, north_half[-1]
    return north_half + [mirror_pt(p) for p in reversed(north_half[:-1])]

def wiggle(pts, amp=1.6, seed=0):
    """Add gentle bends between authored vertices; authored vertices stay exact."""
    out = [pts[0]]
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(d // 9))
        nx, ny = -(b[1] - a[1]) / (d or 1), (b[0] - a[0]) / (d or 1)
        for k in range(1, n):
            t = k / n
            off = math.sin(t * math.pi) * (h(seed, i, k) - .5) * 2 * amp
            out.append([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off])
        out.append(b)
    return out

# ---------------- places (cells) ----------------
NORTH = {
    'Smarliūnai': (95, 64, 'town'), 'Stračiūnai': (340, 60, 'town'),
    'Jovaišiai': (205, 84, 'village'), 'Šadžiūnai': (88, 122, 'village'), 'Guobiniai': (352, 122, 'village'),
    'Mažonys': (258, 120, 'hamlet'),
}
SOUTH_OF = {'Smarliūnai': 'Barčiai', 'Stračiūnai': 'Snaigupė', 'Jovaišiai': 'Didžiasalis',
            'Šadžiūnai': 'Varnėnai', 'Guobiniai': 'Veršiai', 'Mažonys': 'Vilkanastrai'}
PLACES = {'Leipalingis': (220, 160, 'centre')}
for n, (x, y, k) in NORTH.items():
    PLACES[n] = (x, y, k)
    PLACES[SOUTH_OF[n]] = (x, H - y, k)
MAINS = {'north': [220, 26], 'south': [220, H - 26]}
RADIUS = {'centre': (22, 18), 'town': (15, 11), 'village': (12, 9), 'hamlet': (8, 7)}  # cells

def P(name): x, y, _ = PLACES[name]; return [x, y]

# ---------------- roads (cells) ----------------
roads = []
def road(name, ref, cls, pts, bend=1.6, seed=0):
    roads.append({'name': name, 'ref': ref, 'class': cls, 'paved': cls != 'track', 'points': wiggle(pts, bend, seed)})
def mirrored(name_n, name_s, ref_n, ref_s, cls, pts, bend=1.6, seed=0):
    road(name_n, ref_n, cls, pts, bend, seed)
    road(name_s, ref_s, cls, mirror_poly(pts), bend, seed)

# Spine, route 180: north edge -> north main -> Jovaišiai -> Leipalingis -> Didžiasalis -> south main -> south edge.
road('Seirijų kelias', '180', 'primary', symmetric([[220, 0], [220, 14], MAINS['north'], [212, 52], P('Jovaišiai'), [210, 118], [218, 140], [220, 160]]), 1.2, 1)
# Lateral roads 133 (north) and 134 (south), edge to edge through the towns.
mirrored('Šiaurinis kelias', 'Pietinis kelias', '133', '134', 'secondary',
         [[0, 70], P('Smarliūnai'), [150, 72], P('Jovaišiai'), [272, 74], P('Stračiūnai'), [440, 52]], 2, 2)
# Western and eastern north-south roads, crossing the centre line.
road('Vakarų kelias', '2505', 'secondary', symmetric([P('Smarliūnai'), [92, 95], P('Šadžiūnai'), [74, 145], [72, 160]]), 1.6, 3)
road('Rytų kelias', '', 'secondary', symmetric([P('Stračiūnai'), [348, 92], P('Guobiniai'), [366, 145], [368, 160]]), 1.6, 4)
# Second and third exits from each main.
mirrored('Šiaurės vakarų išvažiavimas', 'Pietų vakarų išvažiavimas', '', '', 'tertiary', [MAINS['north'], [170, 36], [125, 48], P('Smarliūnai')], 1.4, 5)
mirrored('Šiaurės rytų išvažiavimas', 'Pietų rytų išvažiavimas', '', '', 'tertiary', [MAINS['north'], [270, 34], [318, 48], P('Stračiūnai')], 1.4, 6)
# Edge exits from the towns, so roads visibly lead somewhere beyond the board.
mirrored('Smarliūnų kelias', 'Barčių kelias', '', '', 'tertiary', [P('Smarliūnai'), [82, 34], [70, 0]], 1.2, 7)
mirrored('Stračiūnų kelias', 'Snaigupės kelias', '', '', 'tertiary', [P('Stračiūnai'), [358, 30], [372, 0]], 1.2, 8)
# Inner roads into Leipalingis from the west and east villages (through the town gates).
road('Vakarinis privažiavimas', '', 'tertiary', symmetric([P('Šadžiūnai'), [130, 130], [165, 146], [190, 160]]), 1.4, 9)
road('Rytinis privažiavimas', '', 'tertiary', symmetric([P('Guobiniai'), [318, 134], [285, 148], [252, 160]]), 1.4, 10)
# Local road Jovaišiai -> Mažonys -> east approach (ends exactly on a vertex of the east approach road).
mirrored('Mažonių kelias', 'Vilkanastrų kelias', '', '', 'tertiary', [P('Jovaišiai'), [232, 98], P('Mažonys'), [272, 136], [285, 148]], 1.0, 11)
# Leipalingis streets: main street between the gates, plus a crescent street north and south.
road('Leipalingio gatvė', '', 'residential', [[190, 160], [205, 160], [220, 160], [236, 160], [252, 160]], 0, 12)
mirrored('Bažnyčios gatvė', 'Mokyklos gatvė', '', '', 'residential', [[196, 160], [204, 149], [220, 145], [236, 149], [246, 160]], 0.4, 13)
mirrored('Šiaurės skersgatvis', 'Pietų skersgatvis', '', '', 'residential', [[209, 160], [208, 151], [214, 146]], 0, 14)
mirrored('Rytų skersgatvis', 'Vakarų skersgatvis', '', '', 'residential', [[231, 160], [232, 151], [226, 146]], 0, 15)
# Ring streets in every town and village (closed loops: no dead ends).
for name, (x, y, kind) in PLACES.items():
    if kind == 'centre': continue
    rx, ry = RADIUS[kind]
    k = .55 if kind != 'hamlet' else .6
    pts = [[x + math.cos(a) * rx * k, y + math.sin(a) * ry * k] for a in [i * math.pi / 5 for i in range(10)]]
    road(f'{name} žiedas', '', 'residential', pts + [pts[0]], 0, 0)
# Covered tracks through the woods (slower, infantry-friendly flanks).
mirrored('Miško kelias', 'Miško kelias', '', '', 'track', [P('Šadžiūnai'), [140, 100], P('Jovaišiai')], 2.2, 16)
mirrored('Girios kelias', 'Girios kelias', '', '', 'track', [P('Stračiūnai'), [305, 92], P('Mažonys')], 2.2, 17)
road('Vakarų miško kelias', '', 'track', symmetric([[130, 130], [142, 146], [150, 160]]), 1.8, 18)
road('Rytų miško kelias', '', 'track', symmetric([[318, 134], [306, 147], [300, 160]]), 1.8, 19)
mirrored('Pagirio kelias', 'Pagirio kelias', '', '', 'track', [[125, 48], [118, 80], [92, 95]], 1.8, 20)
mirrored('Ežero kelias', 'Ežero kelias', '', '', 'track', [[318, 48], [326, 88], [348, 92]], 1.8, 21)

# ---------------- areas (cells) ----------------
areas = []
def blob(cx, cy, r, ry=None, seed=0, n=22):
    ry = ry or r
    return [[cx + math.cos(2 * math.pi * i / n) * r * (.78 + .38 * h(seed, i)),
             cy + math.sin(2 * math.pi * i / n) * ry * (.78 + .38 * h(seed, i, 7))] for i in range(n)]
def wood(cx, cy, r, ry=None, seed=0, kind='forest'):
    pts = blob(cx, cy, r, ry, seed)
    areas.append({'kind': kind, 'points': pts})
    if abs(cy - MID) > 1e-6: areas.append({'kind': kind, 'points': mirror_poly(pts)})
def wood_on_axis(cx, r, ry, seed, kind='forest'):
    half = [[cx + math.cos(math.pi * i / 11) * r * (.8 + .3 * h(seed, i)), MID - math.sin(math.pi * i / 11) * ry * (.8 + .3 * h(seed, i, 3))] for i in range(12)]
    areas.append({'kind': kind, 'points': half + [mirror_pt(p) for p in reversed(half[1:-1])]})

# Medium woods with gaps between them (no single canopy over the fighting).
for cx, cy, r, ry, s in [(128, 96, 20, 13, 1), (300, 98, 20, 13, 2), (165, 30, 16, 9, 3), (285, 22, 15, 8, 4),
                         (40, 100, 14, 18, 5), (400, 96, 14, 18, 6), (250, 60, 10, 7, 7), (60, 30, 12, 8, 8),
                         (175, 118, 8, 6, 9), (305, 130, 7, 5, 10), (395, 40, 12, 9, 11)]:
    wood(cx, cy, r, ry, s)
wood_on_axis(140, 13, 12, 12)
wood_on_axis(300, 13, 12, 13)
wood_on_axis(30, 12, 22, 14)
wood_on_axis(410, 12, 22, 15)
# Scenery border: woods all round, outside the playable rectangle.
for i, x in enumerate(range(0, W + 1, 22)):
    for y in (2, H - 2):
        if abs(x - 220) > 16 and abs(x - 70) > 8 and abs(x - 372) > 8:
            areas.append({'kind': 'forest', 'points': blob(x, y, 12, 8, 100 + i * 2 + (y > MID))})
for i, y in enumerate(range(0, H + 1, 22)):
    for x in (2, W - 2):
        if abs(y - 70) > 8 and abs(y - 52) > 8 and abs(y - (H - 70)) > 8 and abs(y - (H - 52)) > 8:
            areas.append({'kind': 'forest', 'points': blob(x, y, 9, 12, 300 + i * 2 + (x > 200))})
# Lakes and ponds.
for cx, cy, r, ry, s in [(52, 42, 6, 4, 40), (380, 70, 5, 3.5, 41), (150, 120, 3.5, 2.5, 42)]:
    wood(cx, cy, r, ry, s, 'water')
wood_on_axis(395, 8, 6, 43, 'water')

# ---------------- buildings (cells) ----------------
buildings = []
def ellipse_in(x, y, cx, cy, rx, ry): return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
def near_any_road(x, y, d):
    for r in roads:
        p = r['points']
        for i in range(1, len(p)):
            ax, ay = p[i - 1]; bx, by = p[i]
            vx, vy = bx - ax, by - ay; L2 = vx * vx + vy * vy or 1
            t = max(0, min(1, ((x - ax) * vx + (y - ay) * vy) / L2))
            if math.hypot(ax + vx * t - x, ay + vy * t - y) < d: return True
    return False
def frontage(cx, cy, rx, ry, spacing, north_only):
    """Houses lining the streets inside a settlement ellipse, both sides of each street."""
    out = []
    for r in roads:
        if r['class'] == 'track': continue
        p = r['points']
        for i in range(1, len(p)):
            ax, ay = p[i - 1]; bx, by = p[i]
            d = math.hypot(bx - ax, by - ay)
            if d == 0: continue
            ux, uy = (bx - ax) / d, (by - ay) / d
            ang = math.atan2(uy, ux)
            for k in range(int(d / spacing) + 1):
                mx, my = ax + ux * k * spacing, ay + uy * k * spacing
                for side in (-1, 1):
                    x, y = mx - uy * 1.7 * side, my + ux * 1.7 * side
                    if north_only and y > MID - .25: continue
                    if not ellipse_in(x, y, cx, cy, rx, ry): continue
                    out.append([x, y, ang])
    return out
seen = set()
def add_building(b):
    key = (round(b[0]), round(b[1]))
    if key in seen: return
    if near_any_road(b[0], b[1], 1.05): return
    seen.add(key); buildings.append(b)
for name, (x, y, kind) in PLACES.items():
    rx, ry = RADIUS[kind]
    north_only = kind == 'centre' or y < MID
    if not north_only: continue  # south settlements are mirrored below
    for b in frontage(x, y, rx, ry, 1.6 if kind != 'hamlet' else 2.2, kind == 'centre'):
        add_building(b)
    # Infill blocks behind the frontage (yards are added by the game around each house).
    step = 3 if kind in ('centre', 'town') else 4
    for gy in range(int(y - ry), int(y + ry) + 1, step):
        for gx in range(int(x - rx), int(x + rx) + 1, step):
            if kind == 'centre' and gy > MID - .5: continue
            if not ellipse_in(gx + .5, gy + .5, x, y, rx * .85, ry * .85): continue
            if h(gx, gy, 9) < (.35 if kind == 'centre' else .5): add_building([gx + .5, gy + .5, round(h(gx, gy) * 4) * math.pi / 2])
# Scattered farmsteads in the countryside (the game keeps a few of these).
for i in range(260):
    x, y = 18 + h(i, 1) * (W - 36), 14 + h(i, 2) * (MID - 30)
    if any(ellipse_in(x, y, px, py, RADIUS[k][0] * 1.4, RADIUS[k][1] * 1.4) for px, py, k in PLACES.values()): continue
    add_building([x, y, h(i, 3) * math.pi])
north = [b for b in buildings]
buildings = north + [[b[0], H - b[1], -b[2]] for b in north if b[1] < MID - .5]

# ---------------- write (source units = cells / 2) ----------------
S = 2.0
def src(p): return [round(p[0] / S, 3), round(p[1] / S, 3)]
west, south, east, north_b = BOUNDS
out = {
    'source': 'Stylised competitive map of the Leipalingis area. Place names from OpenStreetMap contributors (ODbL); layout designed for play.',
    'downloaded': 'generated',
    'bounds': BOUNDS,
    'grid': [W / S, H / S],
    'playable': [v / S for v in PLAYABLE],
    'mains': {k: src(v) for k, v in MAINS.items()},
    'roads': [{'id': i + 1, 'name': r['name'], 'ref': r['ref'], 'class': r['class'], 'paved': r['paved'], 'points': [src(p) for p in r['points']]} for i, r in enumerate(roads)],
    'areas': [{'kind': a['kind'], 'points': [src(p) for p in a['points']]} for a in areas],
    'buildings': [[round(b[0] / S, 3), round(b[1] / S, 3), round(b[2], 3)] for b in buildings],
    'places': [{'id': i + 1, 'name': n, 'kind': k, 'point': src([x, y]),
                'lat': round(north_b - y / H * (north_b - south), 7), 'lon': round(west + x / W * (east - west), 7)}
               for i, (n, (x, y, k)) in enumerate(PLACES.items())],
}
path = os.path.join(os.path.dirname(__file__), '..', 'src', 'game', 'maps', 'leipalingis-map.json')
with open(path, 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(f"{len(out['roads'])} roads, {len(out['areas'])} areas, {len(out['buildings'])} buildings, {len(out['places'])} places -> {os.path.relpath(path)}")
