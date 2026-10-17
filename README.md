# Alertproof

**A fake alert can copy your bank's words. It can't know your balance.**

Alertproof checks a bank alert before a trader hands over the goods. Gemma, an open-weight model, reads the alert (any bank's SMS, app notification or email, or a customer's "Transfer Successful" screenshot) on the trader's own device. Then plain code decides:

- **Grounding** (`lib/ground.js`): every number Gemma read must be written in the alert. Anything else is thrown away, and Gemma is asked once more, told which values were wrong.
- **The balance chain** (`lib/chain.js`): each genuine alert's balance equals the last balance plus the amount. A fraudster can fake the sender, the wording and the amount, but not the trader's balance.
- **Format fingerprint** (`lib/fingerprint.js`): how the trader's real alerts are written (labels, currency, date shape). This is supporting evidence only.

The verdict is one of three:

| Verdict | When |
|---|---|
| **PAID** | The balance continues the chain exactly, the account matches, and the alert hasn't been seen before. |
| **NO RELEASE** | The balance breaks the chain, the alert is for another account, it's a debit, or it's an old alert sent again. |
| **CAN'T TELL** | There isn't enough to prove it: no starting balance, no balance on the alert, or a likely missed bank charge. |

The model never decides whether money is real.

## Try it

- Live: https://alertproof.tech (demo shop: `/app.html?demo`)
- Locally: `node serve.mjs`, then open http://localhost:5173

For the private, offline setup, install [Ollama](https://ollama.com) and run `ollama pull gemma3:4b`. Alertproof finds it automatically. Without it, Alertproof can use Gemma 4 hosted by Google through `api/read.js` (set `GEMMA_API_KEY`).

## Tests and evaluation

```bash
npm test                         # unit tests for money, grounding, chain, fingerprint
node eval/run.mjs gemma3:4b      # 70 real and fake alerts across 10 formats -> eval/EVAL.md
node eval/record-demo.mjs        # re-record the demo shop's Gemma readings
```

## Files

| File | What it does |
|---|---|
| `app.html`, `app.js` | The counter screen: check, today's book, setup. Speaks the verdict in English or Pidgin. |
| `lib/prompts.js` | The extraction schema and prompts, shared by every path. |
| `lib/model.js`, `api/read.js` | Gemma on this computer (Ollama), or hosted Gemma 4. |
| `lib/store.js` | IndexedDB. Nothing leaves the device. |
| `lib/formats.js` | Alert formats for the eval and demo. |

There are no npm dependencies.

MIT licence.
