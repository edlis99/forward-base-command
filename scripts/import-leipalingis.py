"""Import a bounded OSM snapshot. Requires Python 3; no third-party packages.
Usage: python scripts/import-leipalingis.py /path/to/download-cache
OSM API requests are cached; derived data is committed, never fetched in game.
"""
import concurrent.futures, datetime, json, math, pathlib, sys, urllib.request, xml.etree.ElementTree as ET
BOUNDS = [23.71, 54.025, 24.02, 54.16]
cache = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/fbc-osm-cache')
cache.mkdir(parents=True, exist_ok=True)
def download(tile):
    x,y = tile
    w,s,e,n = BOUNDS
    bbox = [w+(e-w)*x/4, s+(n-s)*y/3, w+(e-w)*(x+1)/4, s+(n-s)*(y+1)/3]
    path = cache/f'{x}-{y}.osm'
    if not path.exists():
        url = 'https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(f'{p:.6f}' for p in bbox)
        req = urllib.request.Request(url, headers={'User-Agent':'ForwardBaseCommandMap/1.0'})
        path.write_bytes(urllib.request.urlopen(req, timeout=50).read())
    print(path.name, path.stat().st_size, flush=True)
    return path
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    paths = list(pool.map(download, [(x,y) for y in range(3) for x in range(4)]))
nodes,ways,relations = {},{},{}
def tags(el):return {t.attrib['k']:t.attrib['v'] for t in el.findall('tag')}
for path in paths:
    root=ET.parse(path).getroot()
    for el in root.findall('node'): nodes[el.attrib['id']] = el
    for el in root.findall('way'): ways[el.attrib['id']] = el
    for el in root.findall('relation'): relations[el.attrib['id']] = el
print('Snapshot:',len(nodes),'nodes,',len(ways),'ways,',len(relations),'relations',flush=True)
def project(el):
    w,s,e,n=BOUNDS
    return [round((float(el.attrib['lon'])-w)/(e-w)*220,3),round((n-float(el.attrib['lat']))/(n-s)*160,3)]
def points(way): return [project(nodes[nd.attrib['ref']]) for nd in way.findall('nd') if nd.attrib['ref'] in nodes]
def dist(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy or 1)))
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
def simplify(ps,tol=.13):
    if len(ps)<3:return ps
    ds=[dist(p,ps[0],ps[-1]) for p in ps[1:-1]];d=max(ds)
    if d<=tol:return [ps[0],ps[-1]]
    i=ds.index(d)+1;return simplify(ps[:i+1],tol)[:-1]+simplify(ps[i:],tol)
def intersects(ps):
    return ps and min(p[0] for p in ps)<220 and max(p[0] for p in ps)>0 and min(p[1] for p in ps)<160 and max(p[1] for p in ps)>0
def area(ps):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ps,ps[1:]+ps[:1])))/2
def kind(t):
    if t.get('natural')=='water' or t.get('landuse')=='basin':return 'water'
    if t.get('landuse')=='forest' or t.get('natural')=='wood':return 'forest'
    if t.get('landuse') in ['farmland','meadow','grass']:return 'field'
    return None
roads=[];areas=[];buildings=[];places=[]
for id,w in ways.items():
    t=tags(w);ps=points(w)
    if not intersects(ps):continue
    h=t.get('highway')
    if h in ['primary','primary_link','secondary','secondary_link','tertiary','unclassified','residential','track']:
        length=sum(math.dist(a,b) for a,b in zip(ps,ps[1:]))
        if h=='track' and length<5:continue
        paved=t.get('surface') in ['asphalt','paved','concrete','paving_stones'] or (h!='track' and t.get('surface') not in ['gravel','unpaved','ground','sand','compacted','dirt'])
        roads.append({'id':int(id),'name':t.get('name',t.get('ref','Farm track' if h=='track' else 'Local road')),'ref':t.get('ref',''),'class':h,'paved':paved,'points':simplify(ps)})
    k=kind(t)
    if k and len(ps)>3 and ps[0]==ps[-1] and area(ps)>.5:areas.append({'kind':k,'points':simplify(ps,.2)})
    if 'building' in t and len(ps)>3:
        # Building footprints are too small at campaign scale. Retain centres
        # and orientation; the game places a representative farm/building there.
        centre=[sum(p[i] for p in ps[:-1])/(len(ps)-1) for i in (0,1)]
        edge=max(zip(ps,ps[1:]),key=lambda ab:math.dist(*ab))
        buildings.append([round(centre[0],2),round(centre[1],2),round(math.atan2(edge[1][1]-edge[0][1],edge[1][0]-edge[0][0]),3)])
# Assemble both outer and inner rings; holes preserve clearings in large forests.
def join_rings(chains):
    rings=[]
    while chains:
        chain=chains.pop();joining=True
        while joining and chain and chain[0]!=chain[-1]:
            joining=False
            for i,other in enumerate(chains):
                if not other:continue
                if chain[-1]==other[0]:chain+=other[1:]
                elif chain[-1]==other[-1]:chain+=other[-2::-1]
                elif chain[0]==other[-1]:chain=other[:-1]+chain
                elif chain[0]==other[0]:chain=other[:0:-1]+chain
                else:continue
                chains.pop(i);joining=True;break
        if len(chain)>3 and chain[0]==chain[-1] and all(i in nodes for i in chain):
            rings.append(simplify([project(nodes[i]) for i in chain],.2))
    return rings
for rel in relations.values():
    t=tags(rel);k=kind(t)
    if not k or t.get('type')!='multipolygon':continue
    rings={role:join_rings([[nd.attrib['ref'] for nd in ways[m.attrib['ref']].findall('nd')]
        for m in rel.findall('member') if m.attrib.get('type')=='way' and
        m.attrib.get('role','outer')==role and m.attrib['ref'] in ways]) for role in ['outer','inner']}
    for ps in rings['outer']:
        if intersects(ps) and area(ps)>.5:
            areas.append({'kind':k,'points':ps,'holes':rings['inner']})
for id,el in nodes.items():
    t=tags(el)
    if t.get('place') in ['town','village']:
        places.append({'id':int(id),'name':t.get('name',''),'point':project(el),'lat':float(el.attrib['lat']),'lon':float(el.attrib['lon'])})
data={'source':'© OpenStreetMap contributors, ODbL 1.0','downloaded':datetime.date.today().isoformat(),'bounds':BOUNDS,'grid':[220,160],'roads':roads,'areas':areas,'buildings':buildings,'places':places}
out=pathlib.Path(__file__).resolve().parents[1]/'src/game/maps/leipalingis-osm.json'
out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
print('Saved',out.stat().st_size,'bytes;',len(roads),'roads;',len(areas),'areas;',len(buildings),'buildings')
for p in places:
    if p['name'] in ['Leipalingis','Jovaišiai','Didžiasalis','Veršiai','Stračiūnai']:print(p)
