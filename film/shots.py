# Real screenshots of the live app for the DEV post: phone-sized, from alertproof.tech.
#   python film/shots.py
import os
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'shots')
os.makedirs(OUT, exist_ok=True)
SITE = 'https://alertproof.tech'

with sync_playwright() as pw:
    b = pw.chromium.launch()
    phone = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark', is_mobile=True, has_touch=True)
    pg = phone.new_page()
    pg.goto(SITE + '/app.html?demo')
    pg.wait_for_timeout(3500)

    def shoot(key, name):
        pg.click(f'[data-demo="{key}"]')
        pg.wait_for_function("!document.querySelector('#result').innerHTML.includes('working') && document.querySelector('#result .stamp, #result .verdict')")
        pg.wait_for_timeout(600)
        pg.evaluate("document.querySelector('#result').scrollIntoView({block:'start'}); window.scrollBy(0, -70)")
        pg.wait_for_timeout(300)
        pg.locator('#result article').screenshot(path=os.path.join(OUT, name))
        print('saved', name)

    shoot('real', 'paid.png')
    shoot('fake', 'no-release.png')
    shoot('fakeshot', 'fake-screenshot.png')
    shoot('shot', 'screenshot-checks-out.png')
    pg.click('[data-tab="today"]'); pg.wait_for_timeout(800); pg.evaluate('window.scrollTo(0,0)')
    pg.screenshot(path=os.path.join(OUT, 'today.png')); print('saved today.png')

    desk = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, color_scheme='dark')
    dp = desk.new_page()
    dp.goto(SITE + '/')
    dp.wait_for_timeout(5200)
    dp.screenshot(path=os.path.join(OUT, 'landing.png')); print('saved landing.png')
    b.close()
