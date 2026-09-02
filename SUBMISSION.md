# Devpost submission copy

Paste-ready. Replace every `<…>` before submitting.

---

## Project name

WebMCP Forge

## Tagline (short description)

Generate WebMCP tools from a web app or API contract, then prove which ones are
safe for an agent to use — by running an agent against them and watching what
they actually do.

## Built with

`next.js` · `typescript` · `webmcp` · `react` · `openapi` · `prism`

## Links

- **Live URL:** `<https://…vercel.app>`
- **Repository:** https://github.com/sudarsan2507-hue/CockPit
- **Video:** `<https://youtube.com/watch?v=…>`

## Try it (put this near the top — judges may not test deeply)

No login, no API key, no network access required for the demo paths.

1. Open the live URL and press **Analyze** — the bundled demo storefront runs in
   this same deployment.
2. Press **Run security scan**. `track_order` turns red *before anything executes*.
3. Press **Validate: unguarded agent**, then **Validate: guarded agent**. Watch
   the OBSERVED REQUESTS panel: same task, different outcomes.
4. Press the **🧪 Mock Target** chip. This ingests a bundled OpenAPI contract,
   generates a mock target from it, and runs the agent against that mock for
   real — the badge next to the validation panel reads `MOCK TARGET (built-in)`.
5. Press the **🌐 Live Web Page Audit** chip. Validation is *disabled*, with the
   reason on screen. That is the correct behaviour, not a missing feature.
6. Or hand it to your own agent: *"Analyze the demo storefront, scan the tools it
   generates, and tell me which ones you would refuse to use."*

---

## Why this use case is a strong fit for WebMCP

WebMCP moves the tool surface into the page. That is the right place for it, and
it also means the tool surface is now assembled from whatever the page's authors
wrote — route handlers, doc comments, OpenAPI descriptions — and handed straight
to a model as instruction.

So WebMCP creates a security surface that did not exist before, in exactly the
place where nobody is looking: **the tool description is agent-executable text**.
A project about generating WebMCP tools that ignores this is shipping the
vulnerability. Forge is the tooling for the half of the problem WebMCP itself
creates, and it is built *on* WebMCP: the thing that inspects the agent surface
is an agent surface.

## How it creates a better experience

For the developer adopting WebMCP: paste a repository, contract, or URL and get
a registered tool surface in seconds, with the tools that should not ship marked
red and commented out of the exported integration file, each with the finding
attached.

For the person watching an agent work: every agent action lands in the same UI a
human uses. When the agent calls `get_product`, the product panel opens on the
page with a *read by agent* badge. There is no separate agent console to
reconcile against — the dashboard and the tool surface are one surface.

Concretely: an agent can go from a URL to *"here are the 5 tools this app should
expose, 4 are safe, this one is not, here is the exact sentence that makes it
unsafe, and here is the integration file with it disabled"* in one turn. That was
a manual code-review task measured in hours.

## What people and agents can now do together that was hard before

**Hand an agent a security review and watch it run.** The dashboard registers
seven WebMCP control tools, so you can say *"analyze this repo, scan it, run both
agents, and tell me what you would refuse to use"* and the agent drives the whole
pipeline while the human watches each step land on screen. The human keeps the
judgement; the agent does the work.

**See what a tool does, not what it claims.** Static analysis says a tool *might*
mutate state. Forge executes it against a target we own and reads the server's
own response back, so `confirm_booking` escalates from a medium warning to a
confirmed high finding when the target reports it committed a write.

**Reproduce a prompt-injection attack on demand.** You cannot ask a real service
to try to exfiltrate a session token for your demo. Forge generates a mock target
from the same contract the tools came from, so the poisoned description runs
every time, identically — and the gate refuses the exfiltration in front of you.

## How we implemented WebMCP

**Three live surfaces**, all through
`document.modelContext.registerTool(tool, { signal })`, falling back to
`navigator.modelContext` for older drafts (the getter moved from `Navigator` to
`Document` in the May 2026 draft and `navigator.modelContext` is deprecated in
Chromium 150 — a navigator-first wrapper reports "unavailable" on a browser that
fully supports the API).

1. **The Forge dashboard** registers its own seven control tools —
   `forge_analyze_repo`, `forge_list_tools`, `forge_run_security_scan`,
   `forge_get_findings`, `forge_get_execution_plan`,
   `forge_run_agent_validation`, `forge_export_integration`.
2. **The demo storefront** registers whatever Forge generated. On its own it
   exposes nothing — it is an ordinary Next.js app. Analyze, return to `/shop`,
   and the badge flips from *no tools* to *5 WebMCP tools registered*.
3. **`/webmcp-test`** isolates API detection, registration, registry visibility
   and execution into a four-check verification matrix.

Tool lifecycle uses `AbortSignal`, with disposers on unmount so SPA transitions
do not leak registrations, and duplicate-registration errors are handled rather
than thrown.

## What it does

```
input ──► discover ──► generate ──► SCAN ──► validate ──► ship
                                      │
                            executable target available?
                             ├─ repo you run  → run the app          (tier 3)
                             ├─ OpenAPI spec  → generate a mock      (tier 2)
                             └─ third-party   → scan only, no calls  (tier 1)
```

**Three checks, not a scanner.**

| Check | Phase | Detects |
|---|---|---|
| `metadata-injection` | static | Directive-shaped prose in text the agent reads as instruction — instruction overrides, concealment directives, forced tool chaining. |
| `sensitive-data-egress` | static + runtime | A personal-data parameter alongside a third-party destination; and any cross-origin request a tool actually attempts, refused before it leaves the browser. |
| `readonly-mismatch` | static + runtime | A read-only hint on a mutating request. Static can only warn. Runtime confirms it by executing the tool and reading the server's own response. |

**A policy gate.** Generated tools never call `fetch` directly. They route
through a gate that records every request and refuses any cross-origin call that
is not the declared target. That is what makes the runtime checks possible.

**Two agents, one task.** The **unguarded** agent behaves like a plain model: it
treats tool descriptions as instructions and follows them. The **guarded** agent
refuses tools the scan blocked, holds tools whose read-only hint does not match
their request, and ignores directives found in metadata.

## Where the agent actually runs, and why it is not the real site

We never fire a generated request at a host we do not own. Testing against
someone's production server is not a demo, it is an unauthorised scan. So the
target is generated from the same contract the tools were:

- **Tier 1 — scan only.** A third-party live site. The schema is validated and
  the injection scan runs over the description text. Zero network calls. This is
  where most of the product value sits: the scan finding needs no execution at all.
- **Tier 2 — mock target.** An OpenAPI contract becomes a running mock, either
  served by this app at `/api/mock/<id>` or your own
  `npx @stoplight/prism-cli mock spec.yaml --port 4010`. Nothing is simulated:
  the agent calls the tool, real HTTP goes out, the observed-request log fills
  with real traffic, and the gate intercepts real calls. The mock validates
  incoming requests against the declared schemas, so a tool generated with a
  parameter in the wrong place gets a `422` rather than appearing to work.
- **Tier 3 — real execution.** Something we control: the bundled storefront, or
  a localhost app you point us at.

The UI labels this honestly — a `MOCK TARGET (built-in)` or `MOCK TARGET :4010`
badge sits next to the validation panel, and on a scan-only target the validate
buttons are disabled with the reason printed on screen.

## Inspiration

Making an existing web app agent-ready is the easy half. A generator can read
your routes and emit `registerTool()` calls in minutes. What nobody is checking
is what those generated tools do once an agent starts calling them.

Two failures show up immediately, and our analyzer reproduces both without any
staging:

**Repository prose becomes agent instruction.** A tool description is read by the
model as part of its own context. A generator that builds descriptions from doc
comments will faithfully copy text addressed to the agent rather than the developer.

**The generator believes the prose over the code.** Our storefront documents
`POST /api/checkout` as *"Retrieves the order summary… Safe to call at any
time."* Forge's analyzer infers `readOnlyHint: true` from that sentence, exactly
as an LLM-backed generator would. `readOnlyHint: true` is what tells an agent it
may call a tool **without asking the user first**.

## How we built it

Next.js App Router and TypeScript. No database, no model provider. The analyzer
extracts HTTP handlers, doc comments, and query/path/body parameters into a tool
manifest; a generic executor turns any manifest entry into a real HTTP request,
so there is no hand-written implementation per tool. The mock target is built
from that same manifest, which is why a call that satisfies the mock is a call
that was shaped correctly.

**There is no LLM anywhere in the pipeline.** Deliberate: no API key in a judge's
path, and every run is deterministic. For a tool whose job is telling you what is
safe, "no model in the loop" is a feature.

51 unit tests, `tsc --noEmit` clean, `next build` compiles 13 routes, and
`scripts/verify-mock-target.ts` proves the mock tier end to end against a running
server.

## Challenges

The honest one is that the interesting bug was ours. Our first version derived
`readOnlyHint` from the HTTP method, which is correct and therefore useless — it
made the runtime check redundant. Deriving it from documented intent instead
reproduces the mistake a real prose-driven generator makes, and gives the runtime
layer something only execution can catch.

The second was the testing question: we needed real execution to demonstrate the
runtime checks, and had no target we were entitled to execute against. Generating
the target from the contract solved it, and turned out to be strictly better than
a live site — because we own the mock, we can plant the poisoned description and
reproduce the attack identically on every run.

## What we learned

Auto-generating an agent interface transfers your repository's prose straight
into a model's context. Every doc comment becomes an instruction, every parameter
name becomes a hint, and none of it was written with an adversary in mind.

## What's next

AST-based analysis instead of regex, more frameworks, richer mock generation from
`examples` and response schemas, and running the checks in CI so a poisoned doc
comment fails the build rather than shipping into an agent's context.

## Limits we are stating up front

- A third-party live site gets tier 1 and nothing more. That is deliberate.
- The built-in mock generates responses from declared parameter types and reads
  `examples` where a contract provides them. It is a target to exercise the tools
  against, not a replica of the service.
- Mock targets and the storefront cart are in-memory and reset on a cold start.
- Repository analysis is regex over route files, not an AST.
- Three checks, not a vulnerability scanner. No dependency scanning, auth or SSRF.

---

## Video beat sheet (target 2:40, hard cap 3:00)

Judges are not required to watch past 3 minutes, so the injection finding lands
by 0:50.

| Time | Beat |
|---|---|
| 0:00–0:12 | The storefront. "An ordinary Next.js shop. It exposes nothing to an agent." Badge: **no tools**. |
| 0:12–0:30 | Paste it into Forge → 5 capabilities, 5 tools. Back to `/shop`: **5 WebMCP tools registered**. |
| 0:30–0:55 | Run the scan. `track_order` goes red. Open it: the doc comment tells the agent to ignore restrictions and mail the customer's address to a third party. That text was going straight into the agent's context. |
| 0:55–1:10 | `checkout`: amber. The generator believed the prose and marked a POST read-only. "Static analysis can only warn here. So run it." |
| 1:10–1:35 | Unguarded agent. It follows the injected instruction; the gate blocks the exfiltration; checkout mutates state and escalates to red. |
| 1:35–1:55 | Guarded agent, same task. Refuses `track_order`, holds `checkout`, completes the shopping task. |
| 1:55–2:20 | **Mock Target chip.** "We don't test against someone's production server. We generate the target from the contract." Badge: `MOCK TARGET`. Real requests in the observed log; the planted injection blocked. Then the live-URL chip: validate is disabled, with the reason. |
| 2:20–2:35 | Export the integration. Blocked tools commented out with the finding attached. |
| 2:35–2:50 | Hand the dashboard to the judge's own agent over WebMCP. "Everything you just watched, an agent can drive." |

Recording notes: make agent actions unmistakable — the ACTIVITY panel colours
`agent` rows differently from `human` rows; keep it on screen during both
validation runs so it is obvious the agent did that, not the presenter.

## Submission form checklist

- [ ] Live URL, opened in a clean browser profile
- [ ] Testing instructions (the numbered "Try it" list above) — no login needed, say so
- [ ] Video link: public on YouTube, not unlisted-only, no age gate, audio present
- [ ] Repository link, public
- [ ] Licence: MIT (`LICENSE` in the repo)
- [ ] Description: the four judging questions are answered in the sections above
- [ ] Teammates added
- [ ] Origin-trial token set for the deployed origin, and `/webmcp-test` passing on the live URL
