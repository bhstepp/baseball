# rk_glb.py - post-process the exported glb: prune and key-reduce animation channels, repack the binary buffer.
# Channels that never leave the node's rest value are dropped (three.js restores unbound properties to rest).
# Remaining channels are reduced with Douglas-Peucker in time under tight tolerances (rotation 0.1 deg,
# translation 0.002 ft, scale 0.002, morph weights 0.004); forced key times (the swing contact) are always kept.
import json
import math
import struct
import hashlib
import numpy as np

COMP = {5120: (np.int8, 1), 5121: (np.uint8, 1), 5122: (np.int16, 2), 5123: (np.uint16, 2), 5125: (np.uint32, 4), 5126: (np.float32, 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67
    off = 12
    js, bin_ = None, b''
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf8'))
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    return js, bin_


def accessor_array(js, bin_, i):
    a = js['accessors'][i]
    dt, sz = COMP[a['componentType']]
    nc = NCOMP[a['type']]
    n = a['count']
    if 'bufferView' in a:
        bv = js['bufferViews'][a['bufferView']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0)
        if stride and stride != sz * nc:
            raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (n - 1) + sz * nc, offset=start)
            arr = np.stack([np.frombuffer(raw[k * stride:k * stride + sz * nc].tobytes(), dtype=dt) for k in range(n)])
        else:
            arr = np.frombuffer(bin_, dtype=dt, count=n * nc, offset=start).reshape(n, nc).copy()
    else:
        arr = np.zeros((n, nc), dtype=dt)
    if 'sparse' in a:
        sp = a['sparse']
        ib = js['bufferViews'][sp['indices']['bufferView']]
        idt, _ = COMP[sp['indices']['componentType']]
        idx = np.frombuffer(bin_, dtype=idt, count=sp['count'], offset=ib.get('byteOffset', 0) + sp['indices'].get('byteOffset', 0))
        vb = js['bufferViews'][sp['values']['bufferView']]
        vals = np.frombuffer(bin_, dtype=dt, count=sp['count'] * nc, offset=vb.get('byteOffset', 0) + sp['values'].get('byteOffset', 0)).reshape(-1, nc)
        arr = arr.copy()
        arr[idx] = vals
    return arr


# ------------------------------------------------------------------------------------------- key reduction
def _interp(path, t0, v0, t1, v1, t):
    u = (t - t0) / (t1 - t0)
    if path == 'rotation':
        d = float(np.dot(v0, v1))
        b = v1 if d >= 0 else -v1
        d = abs(d)
        if d > 0.9995:
            q = v0 + (b - v0) * u
        else:
            th = math.acos(min(1.0, d))
            q = (math.sin((1 - u) * th) * v0 + math.sin(u * th) * b) / math.sin(th)
        return q / np.linalg.norm(q)
    return v0 + (v1 - v0) * u


def _err(path, a, b):
    if path == 'rotation':
        d = abs(float(np.dot(a, b)))
        return 2 * math.acos(min(1.0, d))
    return float(np.max(np.abs(a - b)))


def reduce_keys(path, T, V, tol, forced=()):
    n = len(T)
    if n <= 2:
        return np.arange(n)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    for ft in forced:
        k = int(np.argmin(np.abs(T - ft)))
        if abs(T[k] - ft) < 1e-4:
            keep[k] = True
    stack = []
    ks = np.nonzero(keep)[0]
    for a, b in zip(ks[:-1], ks[1:]):
        stack.append((a, b))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            e = _err(path, _interp(path, T[a], V[a], T[b], V[b], T[i]), V[i])
            if e > worst:
                worst, wi = e, i
        if worst > tol:
            keep[wi] = True
            stack.append((a, wi))
            stack.append((wi, b))
    return np.nonzero(keep)[0]


TOL = {'rotation': math.radians(0.1), 'translation': 0.002, 'scale': 0.002, 'weights': 0.004}


def optimize(js, bin_, forced_times=None, verbose=True):
    forced_times = forced_times or {}
    nodes = js['nodes']
    new_anims = []
    stats = dict(ch_in=0, ch_out=0, keys_in=0, keys_out=0)
    for anim in js.get('animations', []):
        chans, samps = [], []
        forced = forced_times.get(anim['name'], ())
        # duration anchor: keep the clip's full time span on at least one channel
        tmax = 0.0
        for ch in anim['channels']:
            s = anim['samplers'][ch['sampler']]
            tmax = max(tmax, float(accessor_array(js, bin_, s['input'])[-1, 0]))
        anchored = False
        for ch in anim['channels']:
            s = anim['samplers'][ch['sampler']]
            T = accessor_array(js, bin_, s['input'])[:, 0].astype(np.float64)
            Vv = accessor_array(js, bin_, s['output']).astype(np.float64)
            path = ch['target']['path']
            node = nodes[ch['target']['node']]
            stats['ch_in'] += 1
            stats['keys_in'] += len(T)
            if path == 'weights':
                nw = Vv.size // len(T)
                Vv = Vv.reshape(len(T), nw)
                rest = np.zeros(nw)
            else:
                rest = np.array(node.get(path, {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1]}[path]), float)
            tol = TOL[path]
            if path == 'rotation':
                # make the sign continuous and compare to rest up to sign
                for k in range(1, len(Vv)):
                    if np.dot(Vv[k], Vv[k - 1]) < 0:
                        Vv[k] = -Vv[k]
                at_rest = all(_err(path, v, rest) < tol * 0.5 for v in Vv)
            else:
                at_rest = bool(np.max(np.abs(Vv - rest)) < tol * 0.5)
            if at_rest and not (not anchored and path == 'rotation' and node.get('name') == 'hips'):
                continue
            idx = reduce_keys(path, T, Vv, tol, forced)
            if path == 'rotation' and node.get('name') == 'hips' and not anchored:
                idx = np.union1d(idx, [0, len(T) - 1])
                anchored = True
            chans.append((ch, T[idx], Vv[idx], s.get('interpolation', 'LINEAR')))
            stats['ch_out'] += 1
            stats['keys_out'] += len(idx)
        new_anims.append((anim['name'], chans, tmax))
    return new_anims, stats


# ------------------------------------------------------------------------------------------- repack
def rebuild(js, bin_, new_anims):
    out = bytearray()
    new_views, new_accs = [], []

    def align(n=4):
        while len(out) % n:
            out.append(0)

    def add_view(data, target=None):
        align(4)
        off = len(out)
        out.extend(data)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target is not None:
            bv['target'] = target
        new_views.append(bv)
        return len(new_views) - 1

    remap = {}

    def copy_accessor(i, target=None):
        if i in remap:
            return remap[i]
        a = dict(js['accessors'][i])
        dt, sz = COMP[a['componentType']]
        nc = NCOMP[a['type']]
        if 'bufferView' in a:
            bv = js['bufferViews'][a['bufferView']]
            start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            stride = bv.get('byteStride', 0)
            length = a['count'] * sz * nc
            if stride and stride != sz * nc:
                arr = accessor_array(js, bin_, i).astype(dt)
                data = arr.tobytes()
            else:
                data = bin_[start:start + length]
            a['bufferView'] = add_view(data, bv.get('target', target))
            a.pop('byteOffset', None)
        if 'sparse' in a:
            sp = json.loads(json.dumps(a['sparse']))
            for key in ('indices', 'values'):
                part = sp[key]
                bv = js['bufferViews'][part['bufferView']]
                if key == 'indices':
                    _, isz = COMP[part['componentType']]
                    ln = sp['count'] * isz
                else:
                    ln = sp['count'] * sz * nc
                st = bv.get('byteOffset', 0) + part.get('byteOffset', 0)
                part['bufferView'] = add_view(bin_[st:st + ln])
                part.pop('byteOffset', None)
            a['sparse'] = sp
        new_accs.append(a)
        remap[i] = len(new_accs) - 1
        return remap[i]

    # meshes
    for m in js.get('meshes', []):
        for prim in m['primitives']:
            prim['attributes'] = {k: copy_accessor(v, 34962) for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = copy_accessor(prim['indices'], 34963)
            if 'targets' in prim:
                prim['targets'] = [{k: copy_accessor(v, None) for k, v in t.items()} for t in prim['targets']]
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = copy_accessor(sk['inverseBindMatrices'])
    # animations: one shared view, deduplicated time arrays
    anim_bytes = bytearray()
    anim_accs = []
    time_cache = {}

    def anim_acc(arr, typ, is_time=False):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        raw = arr.tobytes()
        if is_time:
            h = hashlib.sha1(raw).hexdigest()
            if h in time_cache:
                return time_cache[h]
        while len(anim_bytes) % 4:
            anim_bytes.append(0)
        off = len(anim_bytes)
        anim_bytes.extend(raw)
        acc = {'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ, 'byteOffset': off}
        if is_time:
            acc['min'] = [float(arr.min())]
            acc['max'] = [float(arr.max())]
        anim_accs.append(acc)
        k = ('A', len(anim_accs) - 1)
        if is_time:
            time_cache[h] = k
        return k
    anims_json = []
    for name, chans, tmax in new_anims:
        samplers, channels = [], []
        for ch, T, Vv, interp in chans:
            path = ch['target']['path']
            ti = anim_acc(T.reshape(-1, 1), 'SCALAR', True)
            if path == 'weights':
                vi = anim_acc(Vv.reshape(-1, 1), 'SCALAR')
            else:
                vi = anim_acc(Vv, {3: 'VEC3', 4: 'VEC4'}[Vv.shape[1]])
            samplers.append({'input': ti, 'output': vi, 'interpolation': interp})
            channels.append({'sampler': len(samplers) - 1, 'target': ch['target']})
        anims_json.append({'name': name, 'channels': channels, 'samplers': samplers})
    view = add_view(bytes(anim_bytes)) if anim_bytes else None
    base = len(new_accs)
    for acc in anim_accs:
        acc['bufferView'] = view
        new_accs.append(acc)
    for a in anims_json:
        for s in a['samplers']:
            s['input'] = base + s['input'][1]
            s['output'] = base + s['output'][1]
    js['accessors'] = new_accs
    js['bufferViews'] = new_views
    js['animations'] = anims_json
    align(4)
    js['buffers'] = [{'byteLength': len(out)}]
    return js, bytes(out)


def write_glb(path, js, bin_):
    j = json.dumps(js, separators=(',', ':')).encode('utf8')
    while len(j) % 4:
        j += b' '
    b = bytes(bin_)
    while len(b) % 4:
        b += b'\0'
    total = 12 + 8 + len(j) + 8 + len(b)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A))
        f.write(j)
        f.write(struct.pack('<II', len(b), 0x004E4942))
        f.write(b)


def optimize_file(src, dst, forced_times=None, verbose=True):
    js, bin_ = read_glb(src)
    anims, stats = optimize(js, bin_, forced_times, verbose)
    js, newbin = rebuild(js, bin_, anims)
    write_glb(dst, js, newbin)
    if verbose:
        print('glb optimize: channels %d -> %d, keys %d -> %d' % (stats['ch_in'], stats['ch_out'], stats['keys_in'], stats['keys_out']))
    return stats
