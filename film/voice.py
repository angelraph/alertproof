# Speaks every line of film/script.json with Microsoft's neural voices (Nigerian English),
# records word timings for the captions, and writes film/out/timeline.json.
#   python film/voice.py
import asyncio, json, subprocess, os
import edge_tts, imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
script = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf8'))


def duration(path):
    r = subprocess.run([FF, '-i', path], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if 'Duration:' in line:
            h, m, s = line.split('Duration:')[1].split(',')[0].strip().split(':')
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError('no duration for ' + path)


async def speak(text, voice, path, rate):
    comm = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
    words = []
    with open(path, 'wb') as f:
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                words.append({'t': chunk['offset'] / 1e7, 'd': chunk['duration'] / 1e7, 'w': chunk['text']})
    return words


async def main():
    t = 0.6  # a breath before the first word
    scenes = []
    for sc in script['scenes']:
        start = t
        parts = []
        for i, p in enumerate(sc['parts']):
            voice = script[p['v']]
            path = os.path.join(OUT, f"{sc['id']}-{i}.mp3")
            rate = '+7%' if p['v'] == 'narrator' else '-4%'
            words = await speak(p['t'], voice, path, rate)
            t += p.get('gap', 0)
            d = duration(path)
            parts.append({'v': p['v'], 'text': p['t'], 'audio': os.path.basename(path), 'start': round(t, 3), 'dur': round(d, 3),
                          'words': [{'t': round(t + w['t'], 3), 'd': round(w['d'], 3), 'w': w['w']} for w in words]})
            t += d
        t += sc.get('hold', 0.5)
        scenes.append({'id': sc['id'], 'start': round(start, 3), 'dur': round(t - start, 3), 'parts': parts})
        print(f"{sc['id']:8} {start:6.2f}s  {t - start:5.2f}s")
    total = round(t + 0.4, 3)
    json.dump({'total': total, 'scenes': scenes}, open(os.path.join(OUT, 'timeline.json'), 'w', encoding='utf8'), indent=1)
    print('total', total)

asyncio.run(main())
