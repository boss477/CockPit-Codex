# WebMCP Forge — build plan

> Give us a web app. We generate its WebMCP tools, then prove which ones are safe
> for an agent to use.

**Deadline:** Thu 3 Sep 2026, 1:00 PM PDT (= Fri 4 Sep, 01:30 IST)
**Updated:** Tue 1 Sep, 00:55 IST — **~72 hours left**

---

## The one-sentence pitch

An ordinary web app has no agent interface. Forge reads its route handlers,
generates WebMCP tools, and then refuses to trust them: it scans the generated
tool surface, runs an agent against it, and reports which tools actually did what
they claimed.

The demo turns on a real failure mode. A generator that builds tool descriptions
from repository prose will faithfully copy a poisoned doc comment into an agent's
context, and will mark a `POST /api/checkout` as `readOnlyHint: true` because the
prose above it says "Retrieves the order summary." Both mistakes are reproduced
by the real analyzer in this repo, and both are caught downstream.

## How it maps to the judging criteria

| Criterion | What carries it |
|---|---|
| WebMCP Leverage | Two live WebMCP surfaces. The Forge dashboard registers 6 control tools so a judge's agent drives the pipeline; the storefront registers whatever the Forge generated. |
| Execution | End to end and working: repo in → tools out → scan → agent run → downloadable integration file. |
| Potential Impact | Auto-generating an agent interface is the easy half. Nobody is checking what the generated tools do. |
| Creativity & Ambition | The security/verification layer, and the fact that the human dashboard and the agent's tool surface are the same surface. |

---

## Status — the product is built

The whole pipeline runs. `npm test` 15/15, `tsc --noEmit` clean, `next build`
compiles 10 routes, and `npx tsx scripts/verify-full-flow.ts` passes end to end
against the dev server:

```
5 capabilities discovered, 5 tools generated
STATIC SCAN  4 verified, 1 blocked, 2 high, 1 medium
             track_order  BLOCKED  metadata-injection + sensitive-data-egress
             checkout     MEDIUM   declared read-only, mapped to POST
GUARDED      search ✓ detail ✓ cart ✓ · refused track_order · held checkout
UNGUARDED    ✕ blocked exfiltration to analytics-partner.example
             ✓ followed the injected instruction and called checkout
             -> checkout escalates to HIGH on observed mutation
```

Everything in `src/` is done: analyzer, GitHub ingestion, three security checks,
policy gate, executor, both agents, codegen, dashboard, storefront, the Forge's
six control tools, WebMCP diagnostics, and the `/webmcp-test` smoke page.

**Nothing product-shaped is blocking submission. What is left is proving it in a
real browser, deploying it, and filming it.**

---

## Left to do

### Blocking — the submission fails without these

1. ~~**Validate against a real `document.modelContext`.**~~ **DONE — 1 Sep, 00:46 IST.**
   `/webmcp-test` on localhost in a real browser: all four checks green. API
   detected, `registerTool` accepted, tool visible in the registry, tool executed
   and returned its payload. The inspector reported `document.modelContext:
   DETECTED` and `navigator.modelContext: ABSENT`, which confirms the
   document-first ordering in `src/lib/webmcp.ts` — a navigator-first wrapper
   would have reported "unavailable" on a browser that fully supports the API.
   The real API agreed with the wrapper on every point; no fixes were needed.
2. **Confirm the generated tools register.** The smoke test proved a hand-written
   `hello_webmcp`. It did not prove the 6 Forge control tools or the 5 generated
   storefront tools. Dashboard Diagnostics should list 6; `/shop` should flip from
   `no WebMCP tools` to `5 WebMCP tools registered` after an Analyze. Two minutes,
   same browser, no deploy needed.
3. **Deploy to Vercel.** No live URL exists. Required for submission.
4. **Origin trial token.** WebMCP is behind a Chrome 149–156 origin trial, gated
   per-origin by a token you register and paste in as a `<meta>` tag. `localhost`
   is exempt; your Vercel domain is not. If judges' browsers will not expose the
   API on the deploy without it, the live-URL test fails and takes the WebMCP
   Leverage score with it. **Verify this the moment the deploy is up.**
5. **Video.** Under 3 minutes, public on YouTube, with audio.
6. **Devpost submission.** Not started. Copy is written in `SUBMISSION.md`.

### Should do

7. README needs the live URL and screenshots.
8. Point Forge at 2–3 real public Next.js repos and fix whatever breaks. A judge
   will paste something odd; the error path has never been exercised.
9. Re-run `/webmcp-test` in ChatGPT's in-app browser. Chrome passing does not
   prove the environment judges will actually use.
10. `package-lock.json` churns between machines — your npm writes `"peer": true`
    annotations Fawaz's does not. Align npm versions before this becomes a
    conflict at 1 AM on Sep 3.

### Known limits — state them, don't fix them

- Next.js App Router `app/**/route.ts` only, matched by regex not AST. Pages
  Router, Express, FastAPI, Django yield nothing.
- Storefront cart is in-memory and resets on a cold start.
- Three checks, not a scanner. No dependency scanning, auth, or SSRF.
- No LLM anywhere. Deliberate: no API key in the judge's path, deterministic
  runs. Say it out loud in the video — "no model in the loop" is a feature for a
  security tool.

---

## Runway — ~72 hours

### Tonight (highest risk, do it first)

- [x] `/webmcp-test` in WebMCP-enabled Chrome. Four green, 00:46 IST.
- [ ] Dashboard lists 6 Forge tools; `/shop` lists 5 after an Analyze.
- [ ] Same pages in ChatGPT's in-app browser.
- [ ] Deploy to Vercel. Re-test `/webmcp-test` **on the https URL**.
- [ ] Resolve the origin trial token question.

### Tue 1 Sep

- [ ] Make the agent's actions unmistakable on screen. A judge watching a
      2-minute video must see *the agent did that, not the human*.
- [ ] Storefront before/after (`no tools` → `5 tools registered`) as the hero moment.
- [ ] Point Forge at real public repos; fail gracefully on the ones it cannot read.
- [ ] README: live URL, screenshots, the limits above.
- [ ] Draft the video script and time it. It must fit 2:30 spoken.

### Wed 2 Sep

- [ ] **Record the video.** Not Sep 3. Submissions die here.
- [ ] Upload to YouTube, public, no age gate.
- [ ] Fill in the Devpost entry completely, save a draft.

### Thu 3 Sep, morning IST

- [ ] Final smoke test on the live URL in a clean browser profile.
- [ ] Submit by 21:00 IST — a 4.5 hour buffer before the 01:30 cutoff.
- [ ] Do not touch main after submitting.

---

## The 2:30 video, beat by beat

| Time | Beat |
|---|---|
| 0:00–0:15 | The storefront. "An ordinary Next.js shop. It exposes nothing to an agent." Badge: **no tools**. |
| 0:15–0:35 | Paste the repo into Forge. 5 capabilities discovered, 5 tools generated. |
| 0:35–1:00 | Run the scan. `track_order` goes red. Open it: the doc comment tells the agent to ignore restrictions and mail the customer's address to a third party. That text was going straight into the agent's context. |
| 1:00–1:15 | Point at `checkout`: amber. The generator believed the prose and marked a POST as read-only. "Static analysis can only warn here. So run it." |
| 1:15–1:45 | Unguarded agent. It follows the injected instruction — the gate blocks the exfiltration, and checkout mutates state, escalating to red. |
| 1:45–2:05 | Guarded agent. Same task. Refuses `track_order`, holds `checkout`, completes the shopping task. |
| 2:05–2:20 | Export the integration. Blocked tools commented out with the finding attached. |
| 2:20–2:30 | Hand the dashboard to the judge's own agent over WebMCP. "Everything you just watched, an agent can drive." |

## Cut list — do not build these

Python/other frameworks · private repos · AST-based analysis · more vulnerability
classes · autonomous code rewriting · deployment automation · dependency scanning ·
auth · multi-agent architecture · a database · Firecrawl.

## Commands

```
npm install
npm run dev                          # http://localhost:3000
npm test                             # 15 tests
npx tsx scripts/verify-full-flow.ts  # end-to-end, needs the dev server
npm run build                        # run before every push
```
