# Devpost submission copy

Paste-ready. Replace every `<…>` before submitting.

---

## Project name

WebMCP Forge

## Tagline (short description)

Generate WebMCP tools from a web app, then prove which ones are safe for an agent to use.

## Built with

`next.js` · `typescript` · `webmcp` · `react`

## Links

- **Live URL:** `<https://…vercel.app>`
- **Repository:** https://github.com/sudarsan2507-hue/CockPit
- **Video:** `<https://youtube.com/watch?v=…>`

## Try it (put this near the top — judges may not test deeply)

1. Open the live URL and press **Analyze** — the bundled demo storefront needs no
   key and no network access.
2. Press **Run security scan**. `track_order` turns red.
3. Press **Validate: unguarded agent**, then **Validate: guarded agent**.
4. Or hand it to your own agent: *"Analyze the demo storefront, scan the tools it
   generates, and tell me which ones you would refuse to use."*

---

## Inspiration

Making an existing web app agent-ready is the easy half. A generator can read
your routes and emit `document.modelContext.registerTool()` calls in minutes.
What nobody is checking is what those generated tools actually do once an agent
starts calling them.

Two failures show up immediately, and both are real — our analyzer reproduces
them without any staging:

**Repository prose becomes agent instruction.** A tool description is read by the
model as part of its own context. A generator that builds descriptions from doc
comments will faithfully copy whatever is in that comment, including text
addressed to the agent rather than the developer.

**The generator believes the prose over the code.** Our demo storefront documents
`POST /api/checkout` as *"Retrieves the order summary… Safe to call at any
time."* Forge's analyzer infers `readOnlyHint: true` from that sentence, exactly
as an LLM-backed generator would. `readOnlyHint: true` is what tells an agent it
may call a tool **without asking the user first**.

## What it does

```
GitHub repo ──► discover ──► generate ──► scan ──► validate ──► ship
                capabilities   WebMCP      static    live agent   integration
                from routes    tools       checks    execution    source file
```

**Three checks, not a scanner.**

| Check | Phase | Detects |
|---|---|---|
| `metadata-injection` | static | Directive-shaped prose in text the agent reads as instruction — instruction overrides, concealment directives, forced tool chaining. |
| `sensitive-data-egress` | static + runtime | A personal-data parameter alongside a third-party destination; and any cross-origin request a tool actually attempts, refused before it leaves the browser. |
| `readonly-mismatch` | static + runtime | A read-only hint on a mutating request. Static can only warn. Runtime confirms it by executing the tool and reading the server's own response. |

**A policy gate.** Generated tools never call `fetch` directly. They route through
a gate that records every request and refuses cross-origin ones. That is what
makes the runtime checks possible: a static scan says a tool *might* mutate
state, execution says it *did*.

**Two agents, one task.** The same shopper task runs twice. The **unguarded**
agent behaves like a plain model — it treats tool descriptions as instructions
and follows them, attempting the exfiltration the poisoned description asked for
and calling `checkout` because the description told it to. The **guarded** agent
refuses blocked tools and ignores metadata directives, and completes the task.

## How we used WebMCP

Two live surfaces.

**The Forge dashboard registers its own controls** as six WebMCP tools —
`forge_analyze_repo`, `forge_list_tools`, `forge_run_security_scan`,
`forge_get_findings`, `forge_run_agent_validation`, `forge_export_integration` —
so an agent drives the entire pipeline while a human watches the same screen
update live. The dashboard a person looks at and the tool surface an agent drives
are the same surface. That is the project, not a garnish on it.

**The demo storefront registers whatever Forge generated.** On its own it exposes
nothing; it is an ordinary Next.js app. Run an analysis and the generated tools
register themselves. When the agent calls `get_product`, the product detail panel
opens on the page with a *read by agent* badge.

## How we built it

Next.js App Router and TypeScript, no database and no model provider. The
analyzer reads `app/**/route.ts`, extracts HTTP handlers, doc comments, query
parameters, path parameters and destructured body fields, and emits a tool
manifest. A generic executor turns any manifest entry into a real HTTP request,
so there is no hand-written implementation per tool.

**There is no LLM anywhere in the pipeline.** That is deliberate: no API key in a
judge's path, and every run is deterministic. For a tool whose job is telling you
what is safe, "no model in the loop" is a feature.

## Challenges

The honest one is that the interesting bug was ours. Our first version derived
`readOnlyHint` from the HTTP method, which is correct and therefore useless — it
made the runtime check redundant, because static analysis already knew the
answer. Deriving it from documented intent instead reproduces the mistake a real
prose-driven generator makes, and gives the runtime layer something only
execution can catch. Building the flaw in on purpose was the design decision the
project turned on.

The API surface also moved under us: the getter migrated from `Navigator` to
`Document` in the May 2026 draft and `navigator.modelContext` is deprecated in
Chromium 150, so the wrapper reads `document.modelContext` first and falls back.

## What we learned

Auto-generating an agent interface transfers your repository's prose straight
into a model's context. Every doc comment becomes an instruction, every parameter
name becomes a hint, and none of it was written with an adversary in mind.

## What's next

AST-based analysis instead of regex, more frameworks than Next.js App Router, and
running the checks in CI so a poisoned doc comment fails the build rather than
shipping into an agent's context.

## Limits we are stating up front

- Next.js App Router `app/**/route.ts` only, matched by regex not an AST.
- The storefront cart is in-memory and resets on a cold start.
- Three checks, not a vulnerability scanner. No dependency scanning, auth or SSRF.
