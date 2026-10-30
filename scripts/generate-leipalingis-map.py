#!/usr/bin/env python3
"""Build the Leipalingis map from the real OpenStreetMap snapshot.

Input : src/game/maps/leipalingis-osm.json (real roads, woods, lakes, fields,
        buildings and places of the Leipalingis area).
Output: src/game/maps/leipalingis-map.json (same format the game reads).

What it does to the real data:
  * repairs the road network: snaps road ends onto nearby roads and drops
    isolated fragments, so roads connect;
  * adds Seirijai as a second large town on route 180, by its lake, in the
    north-middle (Seirijai really lies north of Leipalingis on route 180; the
    distance is compressed to fit the map);
  * adds a river running west-east between the two large towns, crossed by the
    roads that meet it (bridges) and by a few muddy fords on farm tracks;
  * adds rolling hills (valleys along the river and lakes) as a height map;
  * adds hedgerows / tree lines and crop strips around villages, and thins the
    scattered farmsteads to a believable density;
  * marks west and east main deployment areas.
Not mirrored: fairness is checked by measuring travel times (see
src/test/leipalingis-raas.test.ts). Deterministic: same output every run.
"""
import json, math, os, collections

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', 'src', 'game', 'maps', 'leipalingis-osm.json')
OUT = os.path.join(HERE, '..', 'src', 'game', 'maps', 'leipalingis-map.json')
S = 2.0                      # source units -> gameplay cells
W, H = 440, 320
PLAYABLE = [14, 10, 426, 310]
MAINS = {'west': [34, 119], 'east': [392, 149]}   # chosen by a travel-time balance search (see docs)

def h(*v):
    x = math.sin(sum(a * b for a, b in zip(v, (12.9898, 78.233, 37.719, 4.581, 9.17)))) * 43758.5453
    return x - math.floor(x)
def noise(x, y, seed=0):
    ix, iy = math.floor(x), math.floor(y); fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = h(ix, iy, seed), h(ix + 1, iy, seed), h(ix, iy + 1, seed), h(ix + 1, iy + 1, seed)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
def fbm(x, y, seed=0, oct=4):
    s, amp, f = 0, .5, 1
    for o in range(oct): s += noise(x * f, y * f, seed + o * 17) * amp; amp *= .5; f *= 2.03
    return s
def seg_point_dist(p, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
    q = [a[0] + vx * t, a[1] + vy * t]
    return math.hypot(q[0] - p[0], q[1] - p[1]), q
def ellipse_q(x, y, cx, cy, rx, ry): return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
def inside_poly(x, y, ring):
    hit = False
    for i in range(len(ring)):
        a, b = ring[i], ring[i - 1]
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]: hit = not hit
    return hit

src = json.load(open(SRC, encoding='utf-8'))
C = lambda p: [p[0] * S, p[1] * S]
roads = [{'name': r.get('name') or '', 'ref': r.get('ref') or '', 'class': r['class'], 'paved': r.get('paved', r['class'] != 'track'),
          'points': [C(p) for p in r['points']]} for r in src['roads'] if len(r['points']) >= 2]
areas = [{'kind': a['kind'], 'points': [C(p) for p in a['points']], 'holes': [[C(p) for p in ring] for ring in a.get('holes', [])]} for a in src['areas']]
buildings = [[b[0] * S, b[1] * S, b[2]] for b in src['buildings']]
# Several places share a name (e.g. two Radvilonys); keep the point with the most buildings around it.
places, _best = {}, {}
for p in src['places']:
    x, y = p['point']
    n = sum(1 for b in src['buildings'] if (b[0] - x) ** 2 + (b[1] - y) ** 2 <= 9)
    if n > _best.get(p['name'], -1): _best[p['name']] = n; places[p['name']] = C(p['point'])

# ---------------- Seirijai: second large town on route 180 ----------------
SEIRIJAI = [234.0, 54.0]
SRX, SRY = 23.0, 16.0
def push_out(pts, cx, cy, rx, ry, pad=1.15):
    for p in pts:
        q = ellipse_q(p[0], p[1], cx, cy, rx * pad, ry * pad)
        if q < 1:
            k = 1 / math.sqrt(max(q, 1e-6)); p[0], p[1] = cx + (p[0] - cx) * k, cy + (p[1] - cy) * k
buildings = [b for b in buildings if ellipse_q(b[0], b[1], *SEIRIJAI, SRX * 1.1, SRY * 1.1) > 1]
keep_areas = []
for a in areas:
    cx = sum(p[0] for p in a['points']) / len(a['points']); cy = sum(p[1] for p in a['points']) / len(a['points'])
    if ellipse_q(cx, cy, *SEIRIJAI, SRX, SRY) < 1: continue
    push_out(a['points'], *SEIRIJAI, SRX, SRY)
    keep_areas.append(a)
areas = keep_areas
for n in [n for n, p in places.items() if ellipse_q(p[0], p[1], *SEIRIJAI, SRX, SRY) < 1.4]: del places[n]
places['Seirijai'] = SEIRIJAI[:]
# Town streets: a main street across route 180, a ring street and lanes to the outskirts.
cx, cy = SEIRIJAI
def street(name, pts, cls='residential'):
    roads.append({'name': name, 'ref': '', 'class': cls, 'paved': True, 'points': pts})
ring = [[cx + math.cos(a) * 15 * (1 + .08 * math.sin(3 * a)), cy + math.sin(a) * 10 * (1 + .08 * math.cos(2 * a))] for a in [i * math.pi / 12 for i in range(24)]]
street('Seirijų žiedas', ring + [ring[0]])
street('Seirijų gatvė', [[cx - 27, cy + 3], [cx - 15, cy + 1], [cx, cy], [cx + 15, cy - 1], [cx + 27, cy - 3]], 'tertiary')
street('Ežero gatvė', [ring[3], [cx + 8, cy + 4], [cx, cy], [cx - 8, cy - 4], ring[15]])
street('Turgaus gatvė', [ring[21], [cx - 4, cy - 5], [cx, cy], [cx + 4, cy + 5], ring[9]])
for k, ang in enumerate([.6, 2.5, 3.7, 5.6]):
    a = ring[int(ang / (2 * math.pi) * 24) % 24]
    street(f'Seirijų skersgatvis {k + 1}', [a, [a[0] + math.cos(ang) * 7, a[1] + math.sin(ang) * 5]])
PLAZA = [cx, cy, 3.6]

# ---------------- river between the two large towns ----------------
ctrl = [[-4, 120], [40, 113], [87, 106], [128, 114], [172, 120], [212, 113], [256, 119], [300, 111], [344, 117], [390, 109], [444, 115]]
def catmull(pts, n=10):
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for k in range(n):
            t = k / n; t2, t3 = t * t, t * t * t
            out.append([.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)])
    out.append(pts[-1]); return out
river = catmull(ctrl)
river = [[p[0], p[1] + 2.2 * math.sin(p[0] / 7.0) + 1.2 * math.sin(p[0] / 3.1 + 1)] for p in river]
def river_dist(x, y):
    return min(seg_point_dist([x, y], river[i - 1], river[i])[0] for i in range(1, len(river)))

# ---------------- road repair ----------------
def snap_ends(roads, reach=4.0):
    grid = collections.defaultdict(list)
    for i, r in enumerate(roads):
        p = r['points']
        for j in range(1, len(p)):
            for t in (0, .5, 1):
                x = p[j - 1][0] + (p[j][0] - p[j - 1][0]) * t; y = p[j - 1][1] + (p[j][1] - p[j - 1][1]) * t
                grid[(int(x // 6), int(y // 6))].append((i, j))
    for i, r in enumerate(roads):
        for end in (0, -1):
            e = r['points'][end]
            if e[0] <= .5 or e[1] <= .5 or e[0] >= W - .5 or e[1] >= H - .5: continue
            best = None
            for gx in range(int(e[0] // 6) - 1, int(e[0] // 6) + 2):
                for gy in range(int(e[1] // 6) - 1, int(e[1] // 6) + 2):
                    for (k, j) in grid.get((gx, gy), []):
                        if k == i: continue
                        d, q = seg_point_dist(e, roads[k]['points'][j - 1], roads[k]['points'][j])
                        if best is None or d < best[0]: best = (d, q)
            if best and .05 < best[0] <= reach:
                if end == 0: r['points'].insert(0, best[1])
                else: r['points'].append(best[1])
snap_ends(roads)
# connectivity: keep the big network and long pieces that run off the map edge
def components(roads):
    parent = list(range(len(roads)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    grid = collections.defaultdict(set)
    for i, r in enumerate(roads):
        p = r['points']
        for j in range(1, len(p)):
            n = max(1, int(math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]) / .5))
            for k in range(n + 1):
                x = p[j - 1][0] + (p[j][0] - p[j - 1][0]) * k / n; y = p[j - 1][1] + (p[j][1] - p[j - 1][1]) * k / n
                grid[(round(x * 2), round(y * 2))].add(i)
    for s in grid.values():
        s = list(s)
        for o in s[1:]: parent[find(o)] = find(s[0])
    return [find(i) for i in range(len(roads))]
def length(r): return sum(math.hypot(r['points'][j][0] - r['points'][j - 1][0], r['points'][j][1] - r['points'][j - 1][1]) for j in range(1, len(r['points'])))
comp = components(roads)
size = collections.Counter()
for i, c in enumerate(comp): size[c] += length(roads[i])
main = size.most_common(1)[0][0]
def at_edge(r): return any(p[0] <= 1 or p[1] <= 1 or p[0] >= W - 1 or p[1] >= H - 1 for p in r['points'])
roads = [r for i, r in enumerate(roads) if comp[i] == main or (size[comp[i]] > 40 and at_edge(r))]
# Connect Seirijai's main street ends onto the network.
def nearest_on_network(p, exclude_prefix):
    best = None
    for r in roads:
        if r['name'].startswith(exclude_prefix): continue
        pts = r['points']
        for j in range(1, len(pts)):
            d, q = seg_point_dist(p, pts[j - 1], pts[j])
            if best is None or d < best[0]: best = (d, q)
    return best
for r in roads:
    if r['name'] == 'Seirijų gatvė':
        for end in (0, -1):
            d, q = nearest_on_network(r['points'][end], 'Seirij')
            if d < 30:
                if end == 0: r['points'].insert(0, q)
                else: r['points'].append(q)

# ---------------- fords where farm tracks meet the river ----------------
fords = []
new_roads = []
for r in roads:
    if r['class'] != 'track': new_roads.append(r); continue
    pts = r['points']; cur = [pts[0]]
    for j in range(1, len(pts)):
        mid = [(pts[j - 1][0] + pts[j][0]) / 2, (pts[j - 1][1] + pts[j][1]) / 2]
        if river_dist(*mid) < 2.0:
            fords.append(mid)
            if len(cur) > 1: new_roads.append({**r, 'points': cur})
            cur = [pts[j]]
        else: cur.append(pts[j])
    if len(cur) > 1: new_roads.append({**r, 'points': cur})
roads = new_roads
# de-duplicate fords (one per crossing)
dedup = []
for f in fords:
    if all(math.hypot(f[0] - g[0], f[1] - g[1]) > 3 for g in dedup): dedup.append(f)
fords = dedup
# drop track pieces orphaned by the cut (not on the network, the map edge or a ford)
comp = components(roads)
size = collections.Counter()
for i, c in enumerate(comp): size[c] += 1
main = size.most_common(1)[0][0]
near_ford = lambda r: any(math.hypot(p[0] - f[0], p[1] - f[1]) < 6 for p in r['points'] for f in fords)
keep_comp = {c for i, c in enumerate(comp) if c == main or at_edge(roads[i]) or near_ford(roads[i])}
roads = [r for i, r in enumerate(roads) if comp[i] in keep_comp]

# ---------------- settlements (real places) ----------------
SETTLEMENTS = {  # name: size
    'Leipalingis': 'centre', 'Seirijai': 'centre',
    'Stračiūnai': 'town', 'Jovaišiai': 'town', 'Varnėnai': 'town', 'Snaigupė': 'town', 'Ricieliai': 'town', 'Smarliūnai': 'town', 'Barčiai': 'town', 'Viktarinas': 'town',
    'Šadžiūnai': 'village', 'Guobiniai': 'village', 'Gailiūnai': 'village', 'Senkonys': 'village', 'Mažonys': 'village', 'Barzdžiūnai': 'village',
    'Didžiasalis': 'hamlet', 'Vilkanastrai': 'hamlet', 'Veršiai': 'hamlet', 'Kaziuliai': 'hamlet',
}
RADIUS = {'centre': (22, 18), 'town': (15, 11), 'village': (12, 9), 'hamlet': (8, 7)}
missing = [n for n in SETTLEMENTS if n not in places]
assert not missing, missing
def in_settlement(x, y, pad=1.0):
    for n, k in SETTLEMENTS.items():
        px, py = places[n]; rx, ry = RADIUS[k]
        if ellipse_q(x, y, px, py, rx * pad, ry * pad) < 1: return n
    return None
# keep woods out of village cores: push edges back, and cut a clearing where a
# village sits inside a wood (real villages here are often forest clearings)
def densify(pts, step=2.0):
    out = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        out += [[a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] for k in range(n)]
    return out
for a in areas:
    if a['kind'] != 'forest': continue
    a['points'] = densify(a['points'])
    for n, k in SETTLEMENTS.items():
        px, py = places[n]; rx, ry = RADIUS[k]
        near = inside_poly(px, py, a['points']) or any(ellipse_q(p[0], p[1], px, py, rx * 1.3, ry * 1.3) < 1 for p in a['points'])
        if near:
            # a guaranteed clearing: gardens and fields, not trees, around the houses
            a['holes'].append([[px + math.cos(t) * rx * .95, py + math.sin(t) * ry * .95] for t in [i * math.pi / 12 for i in range(24)]])
# a second way in for villages reached by a single road
def roads_into(n):
    px, py = places[n]; rx, ry = RADIUS[SETTLEMENTS[n]]
    return [r for r in roads if any(ellipse_q(p[0], p[1], px, py, rx, ry) <= 1 for p in r['points'])]
for n in SETTLEMENTS:
    inside = roads_into(n)
    if len(inside) >= 2: continue
    px, py = places[n]
    best = None
    for r in roads:
        if r in inside or r['class'] == 'track': continue
        for j in range(1, len(r['points'])):
            d, q = seg_point_dist([px, py], r['points'][j - 1], r['points'][j])
            if d > 6 and (best is None or d < best[0]): best = (d, q)
    if best and best[0] < 45:
        roads.append({'name': f'{n} kelias', 'ref': '', 'class': 'unclassified', 'paved': True,
                      'points': [[px, py], [(px + best[1][0]) / 2 + 2, (py + best[1][1]) / 2 - 2], best[1]]})

# ---------------- Seirijai buildings ----------------
def near_road(x, y, d):
    for r in roads:
        p = r['points']
        if min(abs(q[0] - x) for q in p) > 40: continue
        for j in range(1, len(p)):
            if seg_point_dist([x, y], p[j - 1], p[j])[0] < d: return True
    return False
seirijai_b = []
for r in roads:
    if not r['name'].startswith('Seirij') and r['ref'] != '180': continue
    p = r['points']
    for j in range(1, len(p)):
        a, b = p[j - 1], p[j]; d = math.hypot(b[0] - a[0], b[1] - a[1])
        if d == 0: continue
        ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
        for k in range(int(d / 1.5) + 1):
            mx, my = a[0] + ux * k * 1.5, a[1] + uy * k * 1.5
            for side in (-1, 1):
                x, y = mx - uy * 1.8 * side, my + ux * 1.8 * side
                if ellipse_q(x, y, cx, cy, SRX, SRY) > 1 or math.hypot(x - cx, y - cy) < PLAZA[2]: continue
                seirijai_b.append([x, y, math.atan2(uy, ux)])
for gy in range(int(cy - SRY), int(cy + SRY) + 1, 3):
    for gx in range(int(cx - SRX), int(cx + SRX) + 1, 3):
        if ellipse_q(gx, gy, cx, cy, SRX * .9, SRY * .9) < 1 and math.hypot(gx - cx, gy - cy) > PLAZA[2] and h(gx, gy, 3) < .55:
            seirijai_b.append([gx + .5, gy + .5, round(h(gx, gy) * 4) * math.pi / 2])
seen = set(); 
for b in seirijai_b:
    k = (round(b[0]), round(b[1]))
    if k in seen or near_road(b[0], b[1], 1.0): continue
    seen.add(k); buildings.append(b)

# ---------------- thin rural farmsteads (clusters survive together) ----------------
kept = []
for b in buildings:
    if in_settlement(b[0], b[1], 1.3): kept.append(b); continue
    if river_dist(b[0], b[1]) < 3: continue
    if h(int(b[0] // 9), int(b[1] // 9), 77) < .38: kept.append(b)
buildings = kept

# ---------------- hedgerows and crop strips around settlements ----------------
hedges, crops = [], []
def pieces(a, b, seed, gap=3.0, run=(7, 13)):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 4: return
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    t, k = h(seed, 1) * 3, 0
    while t < L:
        e = min(L, t + run[0] + h(seed, k, 2) * (run[1] - run[0]))
        if e - t > 2: hedges.append([[a[0] + ux * t, a[1] + uy * t], [a[0] + ux * e, a[1] + uy * e]])
        t = e + gap + h(seed, k, 3) * 2; k += 1
def blocked(x, y):
    if not (PLAYABLE[0] + 2 < x < PLAYABLE[2] - 2 and PLAYABLE[1] + 2 < y < PLAYABLE[3] - 2): return True
    if in_settlement(x, y, 1.05) or river_dist(x, y) < 3: return True
    return any(a['kind'] in ('forest', 'water') and inside_poly(x, y, a['points']) for a in areas if abs(a['points'][0][0] - x) < 60)
for si, (name, kind) in enumerate(SETTLEMENTS.items()):
    if kind == 'centre': continue
    px, py = places[name]; rx, ry = RADIUS[kind]
    ang = h(si, 4) * math.pi
    ux, uy, nx, ny = math.cos(ang), math.sin(ang), -math.sin(ang), math.cos(ang)
    for side in (-1, 1):
        for j in range(-4, 5):
            start = max(rx, ry) * .9; along = j * (4.5 + h(si, j) * 2)
            depth = start + 9 + h(si, j, side) * 15
            p0 = [px + ux * along + nx * side * start, py + uy * along + ny * side * start]
            p1 = [px + ux * along + nx * side * depth, py + uy * along + ny * side * depth]
            if blocked(*p0) or blocked(*p1): continue
            pieces(p0, p1, si * 100 + j * 7 + side, 2.5, (6, 11))
            if h(si, j, side, 9) < .45:
                w = 4.5 + h(si, j, 5) * 2
                crops.append([p0, p1, [p1[0] + ux * w, p1[1] + uy * w], [p0[0] + ux * w, p0[1] + uy * w]])
for gi in range(0, 18):
    for gj in range(0, 14):
        x = 20 + gi * 23.5 + (h(gi, gj, 11) - .5) * 10; y = 16 + gj * 21 + (h(gi, gj, 12) - .5) * 9
        ang = .5 * math.sin(gi * .9 + gj * .4) + (h(gi, gj, 13) - .5) * .7
        ca, sa = math.cos(ang), math.sin(ang)
        a = [x - ca * 10, y - sa * 10]; b = [x + ca * 10, y + sa * 10]
        if blocked(x, y) or blocked(*a) or blocked(*b): continue
        if h(gi, gj, 14) < .5: pieces(a, b, 500 + gi * 31 + gj)
        if h(gi, gj, 16) < .3: crops.append([[x, y], [x + ca * 9, y + sa * 9], [x + ca * 9 - sa * 7, y + sa * 9 + ca * 7], [x - sa * 7, y + ca * 7]])
for c in crops: areas.insert(0, {'kind': 'tall_grass', 'points': c, 'holes': []})

# ---------------- hills ----------------
HS = 4; HX, HY = W // HS + 1, H // HS + 1
lakes = [a for a in areas if a['kind'] == 'water']
lake_c = [(sum(p[0] for p in a['points']) / len(a['points']), sum(p[1] for p in a['points']) / len(a['points'])) for a in lakes]
def height_at(x, y):
    v = fbm(x * .016, y * .016, 5) * 3.0 - .9
    v += .9 * max(0, fbm(x * .035 + 3, y * .035 + 9, 9) - .5) * 2   # moraine knolls
    v -= 1.6 * math.exp(-(river_dist(x, y) / 12) ** 2)               # river valley
    for (lx, ly) in lake_c:
        d = math.hypot(x - lx, y - ly)
        if d < 30: v -= .9 * math.exp(-(d / 14) ** 2)
    for n, k in SETTLEMENTS.items():                                  # towns sit on gentle ground
        px, py = places[n]; rx, ry = RADIUS[k]
        q = ellipse_q(x, y, px, py, rx * 1.3, ry * 1.3)
        if q < 1: v = v * (.45 + .55 * q) + .5 * (1 - q)
    for m in MAINS.values():
        d = math.hypot(x - m[0], y - m[1])
        if d < 18: v = v * (d / 18) + .4 * (1 - d / 18)
    return max(0, min(3.2, v))
heights = [round(height_at(i * HS, j * HS) * 20) for j in range(HY) for i in range(HX)]

# ---------------- write ----------------
west, south, east, north = src['bounds']
def srcp(p): return [round(p[0] / S, 3), round(p[1] / S, 3)]
out = {
    'source': 'Leipalingis area from OpenStreetMap contributors (ODbL), repaired and adapted for play: roads connected, Seirijai added on route 180 (distance compressed), river, hills, hedgerows and crop strips designed.',
    'downloaded': src.get('downloaded', ''),
    'bounds': src['bounds'], 'grid': [W / S, H / S], 'style': 'designed',
    'playable': [v / S for v in PLAYABLE],
    'mains': {'north': srcp(MAINS['west']), 'south': srcp(MAINS['east'])},  # keys kept for compatibility: north = player (west), south = enemy (east)
    'mainSides': {'player': 'west', 'enemy': 'east'},
    'heights': {'cols': HX, 'rows': HY, 'step': HS / S, 'scale': 20, 'data': heights},
    'streams': [[srcp(p) for p in river]], 'streamWidth': 1.35,
    'fords': [srcp(p) for p in fords],
    'plazas': [srcp(PLAZA[:2]) + [PLAZA[2] / S]],
    'hedges': [[srcp(p) for p in hd] for hd in hedges],
    'roads': [{'id': i + 1, 'name': r['name'], 'ref': r['ref'], 'class': r['class'], 'paved': r['paved'], 'points': [srcp(p) for p in r['points']]} for i, r in enumerate(roads)],
    'areas': [{'kind': a['kind'], 'points': [srcp(p) for p in a['points']], **({'holes': [[srcp(p) for p in ring] for ring in a['holes']]} if a.get('holes') else {})} for a in areas],
    'buildings': [[round(b[0] / S, 3), round(b[1] / S, 3), round(b[2], 3)] for b in buildings],
    'places': [{'id': i + 1, 'name': n, 'point': srcp(p), 'lat': round(north - p[1] / H * (north - south), 7), 'lon': round(west + p[0] / W * (east - west), 7)}
               for i, (n, p) in enumerate(places.items())],
}
with open(OUT, 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(f"{len(out['roads'])} roads, {len(out['areas'])} areas, {len(out['buildings'])} buildings, {len(fords)} fords, {len(out['places'])} places")
