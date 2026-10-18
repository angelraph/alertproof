# Renders film/film.html to film/out/alertproof-demo.mp4 with the voice, a soft music bed,
# captions burned in, and writes alertproof-demo.srt and transcript.txt.
#   python film/render.py stills 3 15 30      (check a few frames)
#   python film/render.py                      (the whole film)
import json, os, sys, subprocess, math, wave, struct, random
import imageio_ffmpeg
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
FF = imageio_ffmpeg.get_ffmpeg_exe()
URL = 'http://localhost:5173/film/film.html'
FPS = 30
TL = json.load(open(os.path.join(OUT, 'timeline.json'), encoding='utf8'))
TOTAL = TL['total']
SR = 24000


def decode(mp3):
    raw = subprocess.run([FF, '-v', 'quiet', '-i', mp3, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True).stdout
    return [v / 32768 for v in struct.unpack('<%dh' % (len(raw) // 2), raw)]


def music(n):
    # A warm, quiet pad on a I-vi-IV-V progression with a soft pulse; sits well under a voice.
    chords = [[220.0, 277.18, 329.63], [185.0, 220.0, 277.18], [146.83, 185.0, 220.0], [164.81, 207.65, 246.94]]
    bar = 4.0
    out = [0.0] * n
    rnd = random.Random(7)
    for i in range(n):
        t = i / SR
        c = chords[int(t / bar) % 4]
        x = sum(math.sin(2 * math.pi * f * t) + 0.35 * math.sin(2 * math.pi * f * 2 * t + 0.4) for f in c) / 6
        swell = 0.6 + 0.4 * math.sin(math.pi * ((t % bar) / bar))
        beat = (t % 0.5)
        pulse = math.exp(-beat * 18) * math.sin(2 * math.pi * 55 * t) * 0.9
        out[i] = 0.05 * x * swell + 0.035 * pulse
    # fade in and out
    for i in range(min(n, SR * 2)):
        out[i] *= i / (SR * 2)
        out[n - 1 - i] *= i / (SR * 2)
    return out


def audio():
    n = int(TOTAL * SR) + SR
    mix = music(n)
    voice = [0.0] * n
    for s in TL['scenes']:
        for p in s['parts']:
            v = decode(os.path.join(OUT, p['audio']))
            o = int(p['start'] * SR)
            for i, x in enumerate(v):
                if o + i < n:
                    voice[o + i] += x
    # duck the music under the voice
    env, a = 0.0, 0.0
    for i in range(n):
        lvl = abs(voice[i])
        env = max(lvl, env * 0.9995)
        a = 0.25 if env > 0.02 else min(1.0, a + 0.00005) if a < 1 else 1.0
        mix[i] = max(-1, min(1, voice[i] * 1.05 + mix[i] * a))
    path = os.path.join(OUT, 'mix.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(x * 32000)) for x in mix))
    return path


def lay(part):
    # The script's own words (with punctuation), timed by the voice's word boundaries.
    norm = lambda x: ''.join(ch for ch in x.lower() if ch.isalnum())
    toks = [{'w': w, 't': None, 'd': 0.0} for w in part['text'].split()]
    j = 0
    for wd in part['words']:
        n = norm(wd['w'])
        for k in range(j, min(len(toks), j + 3)):
            m = norm(toks[k]['w'])
            if m and (m.startswith(n) or n.startswith(m)):
                toks[k]['t'], toks[k]['d'] = wd['t'], wd['d']; j = k + 1; break
    nxt = part['start'] + part['dur']
    for k in range(len(toks) - 1, -1, -1):
        if toks[k]['t'] is None: toks[k]['t'] = nxt
        nxt = toks[k]['t']
    lines, cur = [], []
    for tk in toks:
        cur.append(tk)
        if tk['w'][-1:] in '.?!' or len(cur) >= 10 or (tk['w'].endswith(',') and len(cur) >= 6):
            lines.append(cur); cur = []
    if cur: lines.append(cur)
    return lines


def srt():
    def ts(x):
        h, r = divmod(x, 3600); m, sec = divmod(r, 60)
        return ('%02d:%02d:%06.3f' % (h, m, sec)).replace('.', ',')
    out, n, txt = [], 1, []
    for sc in TL['scenes']:
        for p in sc['parts']:
            lines = lay(p)
            for i, ln in enumerate(lines):
                end = lines[i + 1][0]['t'] if i + 1 < len(lines) else p['start'] + p['dur'] + 0.2
                out.append(f"{n}\n{ts(ln[0]['t'])} --> {ts(end)}\n{' '.join(w['w'] for w in ln)}\n")
                n += 1
            txt.append(('[App voice, Pidgin] ' if p['v'] == 'app' else '') + p['text'])
    open(os.path.join(OUT, 'alertproof-demo.srt'), 'w', encoding='utf8').write('\n'.join(out))
    open(os.path.join(OUT, 'transcript.txt'), 'w', encoding='utf8').write('\n\n'.join(txt) + '\n')


def frames(times=None):
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.goto(URL)
        pg.evaluate('window.ready')
        pg.wait_for_timeout(500)
        if times:
            for t in times:
                pg.evaluate(f'render({t})')
                pg.screenshot(path=os.path.join(OUT, f'still-{t}.jpg'), type='jpeg', quality=85)
            b.close(); return
        total = int(TOTAL * FPS)
        cmd = [FF, '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
               '-i', os.path.join(OUT, 'mix.wav'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
               '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', os.path.join(OUT, 'alertproof-demo.mp4')]
        ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for i in range(total):
            pg.evaluate(f'render({i / FPS})')
            ff.stdin.write(pg.screenshot(type='jpeg', quality=92))
            if i % (FPS * 10) == 0: print(f'{i / FPS:5.0f}s / {TOTAL:.0f}s', flush=True)
        ff.stdin.close(); ff.wait(); b.close()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'stills':
        frames([float(x) for x in sys.argv[2:]])
    else:
        srt(); print('captions written')
        audio(); print('audio mixed')
        frames(); print('video written')
