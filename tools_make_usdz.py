"""GLB -> ARKit用USDZ(宇宙人)。unlit相当(emissiveのみ)、浮遊・ゆらゆら・まばたき・星の演出を時間サンプルで入れる。"""
import struct, json, math, sys, os, shutil
import numpy as np
from PIL import Image, ImageDraw
from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, Vt, UsdUtils

SRC, OUT = sys.argv[1], sys.argv[2]
WORK = '/home/claude/work/tools/usd_build'
shutil.rmtree(WORK, ignore_errors=True); os.makedirs(WORK)

WIDTH_M, FLOAT_M = 0.44, 0.24      # 仕様: 初期幅44cm、床から24cm浮く
FPS, LOOP_S = 24, 6                # 6秒ループ

# ---------- GLB 読み込み ----------
d = open(SRC, 'rb').read()
cl, _ = struct.unpack('<II', d[12:20]); J = json.loads(d[20:20+cl]); BIN = d[20+cl+8:]
CT = {5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset',0)+a.get('byteOffset',0); n = NC[a['type']]
    dt = np.dtype(CT[a['componentType']]); stride = bv.get('byteStride') or dt.itemsize*n
    if stride == dt.itemsize*n:
        return np.frombuffer(BIN, dt, a['count']*n, off).reshape(a['count'], n).copy()
    return np.stack([np.frombuffer(BIN, dt, n, off+k*stride) for k in range(a['count'])])
def image_bytes(i):
    bv = J['bufferViews'][J['images'][i]['bufferView']]; o = bv.get('byteOffset',0)
    return BIN[o:o+bv['byteLength']]

parts = []
for m in J['meshes']:
    p = m['primitives'][0]; at = p['attributes']
    P = acc(at['POSITION']).astype(np.float64); N = acc(at['NORMAL']).astype(np.float64); UV = acc(at['TEXCOORD_0']).astype(np.float64)
    idx = acc(p['indices']).reshape(-1) if 'indices' in p else np.arange(len(P))
    tex_i = J['textures'][J['materials'][p['material']]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    parts.append(dict(name=m.get('name','m'), P=P, N=N, UV=UV, idx=idx, tex=tex_i))
vol = lambda q: np.prod(q['P'].max(0)-q['P'].min(0))
parts.sort(key=vol, reverse=True)
body, eyes = parts[0], parts[1:]

allP = np.concatenate([q['P'] for q in parts])
lo, hi = allP.min(0), allP.max(0)
s = WIDTH_M/(hi[0]-lo[0])
off = np.array([-(lo[0]+hi[0])/2, -lo[1], -(lo[2]+hi[2])/2])
T = lambda P: (P+off)*s

# ---------- テクスチャ ----------
for q in parts:
    open(f"{WORK}/tex{q['tex']}.png",'wb').write(image_bytes(q['tex']))

def make_lid(path):   # 目つぶりの絵(PDF「目つぶり」に合わせた弧+まつげ)
    S = 4; W, H = 256*S, 192*S
    im = Image.new('RGBA', (W,H), (0,0,0,0)); g = ImageDraw.Draw(im)
    col = (31,168,120,255); cx, cy, r = 128*S, 62*S, 74*S
    def stroke(pts, w):
        for a,b in zip(pts[:-1], pts[1:]): g.line([a,b], fill=col, width=w)
        for p in pts: g.ellipse([p[0]-w/2,p[1]-w/2,p[0]+w/2,p[1]+w/2], fill=col)
    arc = [(cx+math.cos(a)*r, cy+math.sin(a)*r) for a in np.linspace(0.04*math.pi, 0.96*math.pi, 60)]
    stroke(arc, 22*S)
    for deg in (48,90,132):
        a = math.radians(deg)
        stroke([(cx+math.cos(a)*(r+22*S), cy+math.sin(a)*(r+22*S)), (cx+math.cos(a)*(r+48*S), cy+math.sin(a)*(r+48*S))], 14*S)
    im.resize((256,192), Image.LANCZOS).save(path)
make_lid(f"{WORK}/lid.png")

# ---------- USD ----------
stage = Usd.Stage.CreateNew(f"{WORK}/alien.usda")
UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y); UsdGeom.SetStageMetersPerUnit(stage, 1.0)
stage.SetTimeCodesPerSecond(FPS); stage.SetFramesPerSecond(FPS)
stage.SetStartTimeCode(0); stage.SetEndTimeCode(FPS*LOOP_S)
root = UsdGeom.Xform.Define(stage, '/Alien'); stage.SetDefaultPrim(root.GetPrim())
Usd.ModelAPI(root.GetPrim()).SetKind('component')
tr = root.AddTranslateOp(); ry = root.AddRotateYOp()
for f in range(0, FPS*LOOP_S+1):
    t = f/FPS
    tr.Set(Gf.Vec3d(0, FLOAT_M + 0.03*math.sin(2*math.pi*t/3.0)*s*0+0.03*math.sin(2*math.pi*t/3.0), 0), f)  # 3秒周期でふわふわ
    ry.Set(12*math.sin(2*math.pi*t/6.0), f)                                                              # 6秒周期でゆらゆら

mats = {}
def tex_material(name, tex_file, alpha=False):
    m = UsdShade.Material.Define(stage, f'/Alien/Materials/{name}')
    sh = UsdShade.Shader.Define(stage, f'/Alien/Materials/{name}/PBR'); sh.CreateIdAttr('UsdPreviewSurface')
    sh.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(0,0,0))
    sh.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(1.0); sh.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(0.0)
    st = UsdShade.Shader.Define(stage, f'/Alien/Materials/{name}/st'); st.CreateIdAttr('UsdPrimvarReader_float2')
    st.CreateInput('varname', Sdf.ValueTypeNames.Token).Set('st'); st.CreateOutput('result', Sdf.ValueTypeNames.Float2)
    tx = UsdShade.Shader.Define(stage, f'/Alien/Materials/{name}/tex'); tx.CreateIdAttr('UsdUVTexture')
    tx.CreateInput('file', Sdf.ValueTypeNames.Asset).Set(Sdf.AssetPath(tex_file))
    tx.CreateInput('st', Sdf.ValueTypeNames.Float2).ConnectToSource(st.ConnectableAPI(), 'result')
    tx.CreateInput('sourceColorSpace', Sdf.ValueTypeNames.Token).Set('sRGB')
    tx.CreateInput('wrapS', Sdf.ValueTypeNames.Token).Set('clamp'); tx.CreateInput('wrapT', Sdf.ValueTypeNames.Token).Set('clamp')
    tx.CreateOutput('rgb', Sdf.ValueTypeNames.Float3); tx.CreateOutput('a', Sdf.ValueTypeNames.Float)
    sh.CreateInput('emissiveColor', Sdf.ValueTypeNames.Color3f).ConnectToSource(tx.ConnectableAPI(), 'rgb')
    if alpha:
        sh.CreateInput('opacity', Sdf.ValueTypeNames.Float).ConnectToSource(tx.ConnectableAPI(), 'a')
        sh.CreateInput('opacityThreshold', Sdf.ValueTypeNames.Float).Set(0.5)
    sh.CreateOutput('surface', Sdf.ValueTypeNames.Token)
    m.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), 'surface'); return m
def flat_material(name, rgb):
    m = UsdShade.Material.Define(stage, f'/Alien/Materials/{name}')
    sh = UsdShade.Shader.Define(stage, f'/Alien/Materials/{name}/PBR'); sh.CreateIdAttr('UsdPreviewSurface')
    sh.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(0,0,0))
    sh.CreateInput('emissiveColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgb))
    sh.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(1.0)
    sh.CreateOutput('surface', Sdf.ValueTypeNames.Token)
    m.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), 'surface'); return m

def add_mesh(path, P, N, UV, idx, mat, flipv=True, double=True):
    mesh = UsdGeom.Mesh.Define(stage, path)
    mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(P.astype(np.float32)))
    mesh.CreateFaceVertexCountsAttr(Vt.IntArray([3]*(len(idx)//3)))
    mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(idx.astype(np.int32)))
    mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(N.astype(np.float32))); mesh.SetNormalsInterpolation('vertex')
    uv = UV.copy()
    if flipv: uv[:,1] = 1-uv[:,1]
    pv = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar('st', Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
    pv.Set(Vt.Vec2fArray.FromNumpy(uv.astype(np.float32)))
    mesh.CreateDoubleSidedAttr(double); mesh.CreateOrientationAttr('rightHanded')
    ext = UsdGeom.Mesh(mesh).ComputeExtent(P.astype(np.float32)); mesh.CreateExtentAttr(ext)
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)
    return mesh

tex_mats = {}
for q in parts:
    tex_mats[q['tex']] = tex_material(f"m{q['tex']}", f"./tex{q['tex']}.png")
add_mesh('/Alien/Body', T(body['P']), body['N'], body['UV'], body['idx'], tex_mats[body['tex']])
eye_meshes = []
for i, q in enumerate(eyes):
    eye_meshes.append(add_mesh(f'/Alien/Eye{i}', T(q['P']), q['N'], q['UV'], q['idx'], tex_mats[q['tex']]))

# まぶた(目つぶりの絵を貼った板)
lid_mat = tex_material('lid', './lid.png', alpha=True)
lids = []
for i, q in enumerate(eyes):
    P = T(q['P']); b0, b1 = P.min(0), P.max(0); c = (b0+b1)/2; es = b1-b0
    w = max(es[0], es[1])*1.7; h = w*0.75; z = b1[2]+0.002*s; cy = c[1]-es[1]*0.12
    quad = np.array([[c[0]-w/2,cy-h/2,z],[c[0]+w/2,cy-h/2,z],[c[0]+w/2,cy+h/2,z],[c[0]-w/2,cy+h/2,z]])
    uv = np.array([[0,0],[1,0],[1,1],[0,1]], float)
    lids.append(add_mesh(f'/Alien/Lid{i}', quad, np.tile([0,0,1.0],(4,1)), uv, np.array([0,1,2,0,2,3]), lid_mat, flipv=False))

# まばたき(6秒ループ内の時刻 → 閉じる区間)
BLINKS = [(1.2,0.17),(3.6,0.17),(4.1,0.17)]
def closed_at(t): return any(a <= t < a+d for a,d in BLINKS)
times = sorted({0, FPS*LOOP_S} | {int(round(a*FPS)) for a,d in BLINKS} | {int(round((a+d)*FPS)) for a,d in BLINKS})
for f in times:
    c = closed_at(f/FPS) if f < FPS*LOOP_S else False
    for m in eye_meshes: UsdGeom.Imageable(m).CreateVisibilityAttr().Set('invisible' if c else 'inherited', f)
    for m in lids:       UsdGeom.Imageable(m).CreateVisibilityAttr().Set('inherited' if c else 'invisible', f)

# 五つ星(黄 #ffe869 / 橙 #ffb54a)。立体にして横から見ても消えない。約6秒周期で短く出る。
def hexrgb(h): return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))
star_mats = [flat_material('starY', hexrgb('#ffe869')), flat_material('starO', hexrgb('#ffb54a'))]
def star_geo(R=1.0, r=0.45, depth=0.35):
    ring = []
    for k in range(10):
        a = math.pi/2 + k*math.pi/5; rad = R if k%2==0 else r
        ring.append([math.cos(a)*rad, math.sin(a)*rad, 0])
    P = np.array(ring+[[0,0,depth],[0,0,-depth]]); idx = []
    for k in range(10):
        a, b = k, (k+1)%10
        idx += [a,b,10]; idx += [b,a,11]
    P = P.astype(float); Nn = P/np.maximum(np.linalg.norm(P,axis=1,keepdims=True),1e-6)
    return P, Nn, np.zeros((12,2)), np.array(idx)
SP, SN, SUV, SI = star_geo()
STAR_N = 7
for i in range(STAR_N):
    ang = math.radians(25 + i*(130/(STAR_N-1)))          # 上側の弧に並べる
    pos = (math.cos(ang)*0.36, WIDTH_M*0.42 + math.sin(ang)*0.30, 0.10)
    size = 0.035 + 0.012*(i%3)
    xf = UsdGeom.Xform.Define(stage, f'/Alien/Star{i}'); top = xf.AddTranslateOp(); sc = xf.AddScaleOp(); sp = xf.AddRotateZOp()
    top.Set(Gf.Vec3d(*pos)); 
    t0 = 1.6 + i*0.13; dur = 1.3
    for f in range(0, FPS*LOOP_S+1):
        t = f/FPS; u = (t-t0)/dur
        k = math.sin(math.pi*u) if 0 <= u <= 1 else 0.0
        sc.Set(Gf.Vec3f(*(size*k+1e-5,)*3), f); sp.Set(((t-t0)*160)%360 if 0<=u<=1 else 0.0, f)
    add_mesh(f'/Alien/Star{i}/Geo', SP, SN, SUV, SI, star_mats[i%2], flipv=False)
stage.GetRootLayer().Save()

if os.path.exists(OUT): os.remove(OUT)
UsdUtils.CreateNewARKitUsdzPackage(Sdf.AssetPath(f"{WORK}/alien.usda"), OUT)
print('wrote', OUT, os.path.getsize(OUT))
