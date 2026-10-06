import glob, os, json

def uvarint(b, o):
    n = s = 0
    while True:
        c = b[o]; o += 1
        n |= (c & 0x7f) << s
        if not c & 0x80:
            return n, o
        s += 7

def snappy(src):
    ulen, o = uvarint(src, 0)
    out = bytearray()
    while o < len(src) and len(out) < ulen:
        t = src[o]; o += 1
        typ = t & 3
        if typ == 0:
            ln = t >> 2
            if ln < 60:
                ln += 1
            else:
                nb = ln - 59
                ln = int.from_bytes(src[o:o + nb], 'little') + 1; o += nb
            out += src[o:o + ln]; o += ln
        elif typ == 1:
            ln = ((t >> 2) & 7) + 4
            off = ((t >> 5) << 8) | src[o]; o += 1
            for _ in range(ln): out.append(out[-off])
        elif typ == 2:
            ln = (t >> 2) + 1
            off = int.from_bytes(src[o:o + 2], 'little'); o += 2
            for _ in range(ln): out.append(out[-off])
        else:
            ln = (t >> 2) + 1
            off = int.from_bytes(src[o:o + 4], 'little'); o += 4
            for _ in range(ln): out.append(out[-off])
    return bytes(out)

def block(d, off, size):
    raw = d[off:off + size]
    ctype = d[off + size]
    return snappy(raw) if ctype == 1 else raw

def entries(d, off, size):
    b = block(d, off, size)
    n = int.from_bytes(b[-4:], 'little')
    p = len(b) - 4 - 4 * n
    o = 0
    while o < p:
        sh, o = uvarint(b, o)
        ns, o = uvarint(b, o)
        vl, o = uvarint(b, o)
        key = b[o:o + ns]; o += ns
        val = b[o:o + vl]; o += vl
        yield key, val

def read_table(path):
    d = open(path, 'rb').read()
    foot = d[-48:]
    mo, p = uvarint(foot, 0); ms, p = uvarint(foot, p)
    io_, p = uvarint(foot, p); isz, p = uvarint(foot, p)
    out = []
    for k, v in entries(d, io_, isz):
        ho, q = uvarint(v, 0); hs, q = uvarint(v, q)
        out += list(entries(d, ho, hs))
    return out

D = r'C:\Users\walker\AppData\Local\Google\Chrome\User Data\Default\Local Storage\leveldb'
best = {}
for f in sorted(glob.glob(os.path.join(D, '*.ldb'))):
    try:
        es = read_table(f)
    except Exception as e:
        print(f'{os.path.basename(f):16} ERR {type(e).__name__}: {e}')
        continue
    hits = [(k, v) for k, v in es if b'review' in k]
    print(f'{os.path.basename(f):16} entries={len(es):5} review={len(hits)}')
    for k, v in hits:
        for cut in (0, 1, 2):
            for enc in ('utf-16-le', 'utf-8'):
                try:
                    txt = v[cut:].decode(enc)
                except Exception:
                    continue
                j = txt.find('{')
                if j < 0:
                    continue
                try:
                    obj, _ = json.JSONDecoder().raw_decode(txt[j:])
                except Exception:
                    print(f'      cut={cut} {enc}: JSON fail, head={txt[j:j+60]!r}')
                    continue
                if isinstance(obj, dict) and len(obj) > len(best):
                    best = obj
                    print(f'      cut={cut} {enc}: fields={len(obj)}')

if not best:
    print('NONE')
    raise SystemExit
fb = {k: v for k, v in best.items() if k.endswith('-fb') and v.strip()}
print(f'\n字段 {len(best)} | 文字意见 {len(fb)}\n')
for k, v in sorted(fb.items()):
    print(f'--- {k}\n{v}\n')
