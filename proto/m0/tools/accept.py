# M0 验收：起服务 → 打开验证台 → 逐项截图 + 读 GPU 帧时间。  python proto/m0/tools/accept.py <输出目录>
import sys, os, json, subprocess, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'proto', 'm0', 'shots')
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8731'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.goto('http://localhost:8731/proto/m0/')
        pg.wait_for_function('window.__m0 && window.__m0.tris > 0', timeout=30000)
        shots = [('sniper', 'idle', 'front'), ('sniper', 'attack', 'front'), ('sword', 'attack', 'front'),
                 ('sword', 'run', 'front'), ('sniper', 'hit', 'front'), ('sword', 'death', 'front'), ('sniper', 'attack', 'top')]
        for w, s, v in shots:
            pg.evaluate(f"__m0.setWeapon('{w}'); __m0.setState('{s}'); __m0.setView('{v}')")
            pg.wait_for_timeout(1500 if s != 'death' else 2500)
            pg.screenshot(path=os.path.join(out, f'{w}_{s}_{v}.png'))
        pg.evaluate("__m0.setWeapon('sniper'); __m0.setState('idle'); __m0.setView('front')")
        pg.wait_for_timeout(3000)
        r = pg.evaluate("({gpuMs: __m0.gpuMs, fps: __m0.fps, tris: __m0.tris, gl: (()=>{const g=document.querySelector('canvas').getContext('webgl2');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'})()})")
        r['errors'] = errs
        print(json.dumps(r, ensure_ascii=False, indent=1))
        b.close()
finally:
    srv.terminate()
