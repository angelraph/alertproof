// Alertproof site: shared nav and footer, scroll reveal, the hero phone, the spot-the-fake game.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const page = document.body.dataset.page || '';

const LINKS = [['product.html', 'Product', 'product'], ['how-it-works.html', 'How it works', 'how'], ['pricing.html', 'Pricing', 'pricing'], ['security.html', 'Security', 'security'], ['faq.html', 'FAQ', 'faq']];
const LOGO = `<a class="logo wordmark" href="./" aria-label="Alertproof home"><img src="assets/icon.svg" alt="" width="34" height="34"><span>Alert<b>proof</b></span></a>`;

// ---------- nav + footer ----------
const header = $('#site-nav');
if (header) {
  header.className = 'nav';
  header.innerHTML = `<div class="container">${LOGO}
    <nav class="nav-links" aria-label="Main">${LINKS.map(([h, t, k]) => `<a href="${h}"${k === page ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="nav-cta"><a class="btn btn-ghost hide-sm" href="app.html">Open app</a><a class="btn btn-primary" href="app.html?demo">Try demo</a></div>
    <button class="burger" aria-label="Menu" aria-expanded="false"><span></span></button></div>
    <div class="sheet">${LINKS.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}<a href="about.html">About</a><a class="btn btn-ghost" href="app.html">Open app</a></div>`;
  const burger = $('.burger', header);
  burger.onclick = () => { const o = header.classList.toggle('open'); burger.setAttribute('aria-expanded', o); };
  $$('.sheet a', header).forEach(a => a.onclick = () => header.classList.remove('open'));
  const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

const footer = $('#site-foot');
if (footer) {
  footer.className = 'foot';
  footer.innerHTML = `<div class="container"><div class="foot-grid">
    <div>${LOGO}<p class="tagline">Real alerts. Real checks. No fake. Check every bank alert against your own balance before you release the goods.</p></div>
    <div><h4>Product</h4><ul><li><a href="product.html">Features</a></li><li><a href="how-it-works.html">How it works</a></li><li><a href="pricing.html">Pricing</a></li><li><a href="app.html?demo">Live demo</a></li></ul></div>
    <div><h4>Trust</h4><ul><li><a href="security.html">Security &amp; privacy</a></li><li><a href="how-it-works.html#eval">Test results</a></li><li><a href="https://github.com/angelraph/alertproof">Source code</a></li></ul></div>
    <div><h4>Company</h4><ul><li><a href="about.html">About</a></li><li><a href="faq.html">FAQ</a></li><li><a href="about.html#contact">Contact</a></li></ul></div>
  </div><div class="legal"><span>© ${new Date().getFullYear()} Alertproof. Open source under the MIT licence.</span><span>Alertproof is not a bank and never holds money. Bank names are used only to describe alert formats it reads.</span></div></div>`;
}

// ---------- scroll reveal ----------
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 }) : null;
$$('.rv').forEach(el => io ? io.observe(el) : el.classList.add('in'));

// ---------- hero phone ----------
const feed = $('#feed');
if (feed) {
  const S = [
    { from: 'GTBank', text: 'Acct: 0******821\nAmt: NGN15,000.00 CR\nDesc: TRF FROM CHIDI OKAFOR\nAvail Bal: NGN92,160.50', v: 'paid', head: 'PAID', sub: '₦77,160.50 + ₦15,000 = ₦92,160.50. Money don land.' },
    { from: 'GTBank', text: 'Acct: 0******821\nAmt: NGN25,000.00 CR\nDesc: TRF FROM IBRAHIM MUSA\nAvail Bal: NGN264,870.20', v: 'stop', head: 'NO RELEASE', sub: 'Should be ₦117,160.50. This one says ₦264,870.20.' },
    { from: 'Customer screenshot', text: 'OPay · Transfer Successful\n₦8,000.00 to NGOZI EZE PROVISIONS', v: 'wait', head: 'WAIT FOR ALERT', sub: 'Screenshot no be money. Your alert must say CR ₦8,000 · Bal ₦100,160.50.' },
    { from: 'GTBank', text: 'Acct: 0******821\nAmt: NGN23,000.00 CR\nDesc: TRF FROM EMEKA NWOSU\nAvail Bal: NGN77,210.50', v: 'stop', head: 'NO RELEASE', sub: 'Dem don use this alert before. It landed at 10:41 this morning.' },
  ];
  const typing = $('#typing');
  let i = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = () => {
    const s = S[i++ % S.length];
    feed.innerHTML = `<div class="sms"><div class="from"><span>${s.from}</span><span>now</span></div>${s.text}</div>`;
    typing.style.visibility = 'visible';
    setTimeout(() => {
      typing.style.visibility = 'hidden';
      feed.insertAdjacentHTML('beforeend', `<div class="verdict-pop ${s.v}"><b>${s.head}</b><small>${s.sub}</small></div>`);
    }, reduced ? 0 : 1500);
  };
  step();
  setInterval(step, 4800);
}

// ---------- spot the fake ----------
const game = $('#game');
if (game) {
  const R = [
    { ctx: 'Your last alert said your balance was <b>₦45,300.00</b>. A customer pays ₦12,000.', q: 'Which alert is real?',
      a: { from: 'GTBank', t: 'Acct: 0******821\nAmt: NGN12,000.00 CR\nDesc: TRF FROM BISI ADE\nAvail Bal: NGN57,300.00' },
      b: { from: 'GTBank', t: 'Acct: 0******821\nAmt: NGN12,000.00 CR\nDesc: TRF FROM BISI ADE\nAvail Bal: NGN112,000.00' },
      real: 'a', why: 'The fraudster can copy every word, but has to guess your balance.', math: '₦45,300.00 + ₦12,000.00 = ₦57,300.00. Alert B says ₦112,000.00.' },
    { ctx: 'Your account ends in <b>4821</b>. Balance <b>₦30,000.00</b>. A customer pays ₦7,500.', q: 'Which alert is real?',
      a: { from: 'Access', t: 'Credit\nAmt:NGN7,500.00\nAcc:019**532\nDesc:TRF FROM TOBI\nAvail Bal:NGN37,500.00' },
      b: { from: 'Access', t: 'Credit\nAmt:NGN7,500.00\nAcc:012**821\nDesc:TRF FROM TOBI\nAvail Bal:NGN37,500.00' },
      real: 'b', why: 'Same amount, same balance, but A was paid into somebody else’s account.', math: 'Alert A: account ends 532. Yours ends 821.' },
    { ctx: 'This morning at 10:41 Emeka paid you ₦23,000 and your balance became <b>₦77,210.50</b>. Since then a ₦50 levy left it at <b>₦77,160.50</b>. Now a customer “pays” ₦23,000.', q: 'Which alert is real?',
      a: { from: 'GTBank', t: 'Acct: 0******821\nAmt: NGN23,000.00 CR\nDesc: TRF FROM EMEKA NWOSU\nAvail Bal: NGN77,210.50\nDate: 2026-10-17 10:41:00' },
      b: { from: 'GTBank', t: 'Acct: 0******821\nAmt: NGN23,000.00 CR\nDesc: TRF FROM KUNLE BADMUS\nAvail Bal: NGN100,160.50\nDate: 2026-10-17 12:05:11' },
      real: 'b', why: 'A is a real alert, but an old one, forwarded again. The oldest trick in the market.', math: '₦77,160.50 + ₦23,000.00 = ₦100,160.50 ✓. Alert A is the 10:41 alert, sent again.' },
    { ctx: 'Balance <b>₦8,450.75</b>. A customer pays ₦3,500. Look closely.', q: 'Which alert is real?',
      a: { from: 'UBA', t: 'Txn: Credit\nAc:1XX..XX821\nAmt:NGN 3,500.00\nDes:TRF FROM AMAKA\nBal:NGN 11,950.00 CR' },
      b: { from: 'UBA', t: 'Txn: Credit\nAc:1XX..XX821\nAmt:NGN 3,500.00\nDes:TRF FROM AMAKA\nBal:NGN 11,950.75 CR' },
      real: 'b', why: 'Seventy-five kobo. Nobody checks kobo at the counter. Arithmetic does.', math: '₦8,450.75 + ₦3,500.00 = ₦11,950.75. Alert A dropped the kobo.' },
    { ctx: 'Balance <b>₦61,200.00</b>. A customer says “I don send am, ₦20,000” and shows you their phone. Your phone also buzzes.', q: 'Which one proves the money is yours?',
      a: { from: 'Customer’s phone', t: 'OPay\nTransfer Successful\n₦20,000.00\nTo: NGOZI EZE PROVISIONS' },
      b: { from: 'Your phone · Moniepoint', t: 'Credit: NGN20,000 from SADE OJO to 82****4821. Bal: NGN81,200. Ref:250117' },
      real: 'b', why: 'A screenshot is not money: anyone can edit one, or show a transfer that later fails. Only your own alert counts, and only if it continues your balance.', math: '₦61,200 + ₦20,000 = ₦81,200 ✓' },
  ];
  let r = 0, wins = 0;
  const dots = $('#g-score'), body = $('#g-body');
  dots.innerHTML = R.map(() => '<i></i>').join('');
  const render = () => {
    const x = R[r];
    body.innerHTML = `<p class="kicker">Round ${r + 1} of ${R.length}</p><div class="ctx">${x.ctx}</div><h3 class="h-md" style="font-size:22px">${x.q}</h3>
      <div class="opts">${['a', 'b'].map(k => `<button class="opt" data-k="${k}"><span class="lbl">${k.toUpperCase()} · ${x[k].from}</span><pre>${x[k].t}</pre></button>`).join('')}</div>
      <div class="reveal-box" id="g-reveal"></div>`;
    $$('.opt', body).forEach(b => b.onclick = () => pick(b.dataset.k));
  };
  const pick = k => {
    const x = R[r], ok = k === x.real;
    if (ok) wins++;
    dots.children[r].className = ok ? 'win' : 'lose';
    $$('.opt', body).forEach(b => { b.disabled = true; b.classList.add(b.dataset.k === x.real ? 'right' : (b.dataset.k === k ? 'wrong' : 'x')); });
    const box = $('#g-reveal');
    box.className = `reveal-box show ${ok ? 'good' : 'bad'}`;
    box.innerHTML = `<b>${ok ? 'Correct.' : 'Oops, the goods don waka.'}</b> ${x.why}<div class="math">${x.math}</div>
      <div class="btns" style="margin-top:14px"><button class="btn btn-primary" id="g-next">${r + 1 < R.length ? 'Next round <span class="arr">→</span>' : 'See your score'}</button></div>`;
    $('#g-next').onclick = () => { r++; r < R.length ? render() : finish(); };
  };
  const finish = () => {
    body.innerHTML = `<div class="center" style="padding:16px 0"><p class="kicker">Your score</p><div class="h-xl" style="margin:8px 0">${wins}/${R.length}</div>
      <p class="lede">${wins === R.length ? 'Sharp eyes! Now imagine doing that at 6pm, with five customers waiting and an alert landing every minute.' : 'Even careful traders get caught when the shop is busy.'} Alertproof checked all ${R.length} with arithmetic. It doesn’t get tired, and it never guesses.</p>
      <div class="btns"><a class="btn btn-primary" href="app.html?demo">Try it on real-format alerts <span class="arr">→</span></a><button class="btn btn-ghost" id="g-again">Play again</button></div></div>`;
    $('#g-again').onclick = () => { r = 0; wins = 0; dots.innerHTML = R.map(() => '<i></i>').join(''); render(); };
  };
  render();
}

// ---------- sticky product tabs (scrollspy) ----------
const tabs = $$('.ptabs a');
if (tabs.length && io) {
  const spy = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) tabs.forEach(t => t.classList.toggle('on', t.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  tabs.forEach(t => { const s = $(t.getAttribute('href')); if (s) spy.observe(s); });
}

// ---------- FAQ search ----------
const fs = $('#faq-search');
if (fs) fs.oninput = () => {
  const q = fs.value.trim().toLowerCase();
  $$('.faq details').forEach(d => { const hit = !q || d.textContent.toLowerCase().includes(q); d.hidden = !hit; if (q && hit) d.open = true; });
  $$('.faq h3').forEach(h => { let n = h.nextElementSibling, any = false; while (n && n.tagName === 'DETAILS') { any ||= !n.hidden; n = n.nextElementSibling; } h.hidden = !any; });
};
