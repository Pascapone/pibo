---
type: "Reference"
title: "Codebase-design skill sources record (archived original)"
description: "Line-numbered source record with hashes for the uploaded skill texts, archived with an OKF envelope."
tags: ["beta-4", "codebase-design", "reference"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T15:54:34Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/inputs/pibo-codebase-design-quellen.md"
  origin_sha256: "6ed340fadff5bae2feb90e8ed7f5b9ccafcfa8f853467e8b607c48e3344e680e"
  origin_bytes: 13623
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "inputs/pibo-codebase-design-quellen.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
    - "Retargeted 3x link target '](SKILL.md)' to '](codebase-design-skill.md)' (kebab-case archive name)."
    - "Retargeted 4x link target '](DEEPENING.md)' to '](codebase-design-deepening.md)' (kebab-case archive name)."
    - "Retargeted 1x link target '](DESIGN-IT-TWICE.md)' to '](codebase-design-design-it-twice.md)' (kebab-case archive name)."
---
# Quellen: hochgeladener Skill „codebase-design“

Unveränderte Texte aus der von Pascal hochgeladenen ZIP-Datei. Die linke Zahl bezeichnet die Originalzeile. Die Anwendung auf Pibo und zusätzliche Sicherheitsregeln stehen im Arbeitsplan; sie sind keine Behauptungen des Skills.

Archiv: `mattpocock skills main skills-engineering_codebase-design.zip`
Archiv-SHA-256: `2546132636a11985e836b22fa9e452015ed5cb081f7309a39bc3dac065a417d1`

## S1 – SKILL.md

SHA-256: `2c20617f87ec8af6a434859f381b2f061a69b530444e74eb39e78bb016a6d1e2`

````text
001 | ---
002 | name: codebase-design
003 | description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
004 | ---
005 | 
006 | # Codebase Design
007 | 
008 | Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. Use this language and these principles wherever code is being designed or restructured. The aim is leverage for callers, locality for maintainers, and testability for everyone.
009 | 
010 | ## Glossary
011 | 
012 | Use these terms exactly: don't substitute "component," "service," "API," or "boundary." Consistent language is the whole point.
013 | 
014 | **Module**: anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package, or tier-spanning slice. _Avoid_: unit, component, service.
015 | 
016 | **Interface**: everything a caller must know to use the module correctly: the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics. _Avoid_: API, signature (too narrow, they refer only to the type-level surface).
017 | 
018 | **Implementation**: what's inside a module, its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Reach for "adapter" when the seam is the topic; "implementation" otherwise.
019 | 
020 | **Depth**: leverage at the interface. The amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.
021 | 
022 | **Seam** _(Michael Feathers)_: a place where you can alter behaviour without editing in that place; the *location* at which a module's interface lives. Where to put the seam is its own design decision, distinct from what goes behind it. _Avoid_: boundary (overloaded with DDD's bounded context).
023 | 
024 | **Adapter**: a concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).
025 | 
026 | **Leverage**: what callers get from depth. More capability per unit of interface they learn. One implementation pays back across N call sites and M tests.
027 | 
028 | **Locality**: what maintainers get from depth. Change, bugs, knowledge, and verification concentrate in one place rather than spreading across callers. Fix once, fixed everywhere.
029 | 
030 | ## Deep vs shallow
031 | 
032 | **Deep module** = small interface + lots of implementation:
033 | 
034 | ```
035 | ┌─────────────────────┐
036 | │   Small Interface   │  ← Few methods, simple params
037 | ├─────────────────────┤
038 | │                     │
039 | │  Deep Implementation│  ← Complex logic hidden
040 | │                     │
041 | └─────────────────────┘
042 | ```
043 | 
044 | **Shallow module** = large interface + little implementation (avoid):
045 | 
046 | ```
047 | ┌─────────────────────────────────┐
048 | │       Large Interface           │  ← Many methods, complex params
049 | ├─────────────────────────────────┤
050 | │  Thin Implementation            │  ← Just passes through
051 | └─────────────────────────────────┘
052 | ```
053 | 
054 | When designing an interface, ask:
055 | 
056 | - Can I reduce the number of methods?
057 | - Can I simplify the parameters?
058 | - Can I hide more complexity inside?
059 | 
060 | ## Principles
061 | 
062 | - **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable, swappable parts; they just aren't part of the interface. A module can have **internal seams** (private to its implementation, used by its own tests) as well as the **external seam** at its interface.
063 | - **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
064 | - **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
065 | - **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.
066 | 
067 | ## Designing for testability
068 | 
069 | Good interfaces make testing natural:
070 | 
071 | 1. **Accept dependencies, don't create them.**
072 | 
073 |    ```typescript
074 |    // Testable
075 |    function processOrder(order, paymentGateway) {}
076 | 
077 |    // Hard to test
078 |    function processOrder(order) {
079 |      const gateway = new StripeGateway();
080 |    }
081 |    ```
082 | 
083 | 2. **Return results, don't produce side effects.**
084 | 
085 |    ```typescript
086 |    // Testable
087 |    function calculateDiscount(cart): Discount {}
088 | 
089 |    // Hard to test
090 |    function applyDiscount(cart): void {
091 |      cart.total -= discount;
092 |    }
093 |    ```
094 | 
095 | 3. **Small surface area.** Fewer methods = fewer tests needed. Fewer params = simpler test setup.
096 | 
097 | ## Relationships
098 | 
099 | - A **Module** has exactly one **Interface** (the surface it presents to callers and tests).
100 | - **Depth** is a property of a **Module**, measured against its **Interface**.
101 | - A **Seam** is where a **Module**'s **Interface** lives.
102 | - An **Adapter** sits at a **Seam** and satisfies the **Interface**.
103 | - **Depth** produces **Leverage** for callers and **Locality** for maintainers.
104 | 
105 | ## Rejected framings
106 | 
107 | - **Depth as ratio of implementation-lines to interface-lines** (Ousterhout): rewards padding the implementation. We use depth-as-leverage instead.
108 | - **"Interface" as the TypeScript `interface` keyword or a class's public methods**: too narrow: interface here includes every fact a caller must know.
109 | - **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.
110 | 
111 | ## Going deeper
112 | 
113 | - **Deepening a cluster given its dependencies**, see [DEEPENING.md](codebase-design-deepening.md): dependency categories, seam discipline, and replace-don't-layer testing.
114 | - **Exploring alternative interfaces**, see [DESIGN-IT-TWICE.md](codebase-design-design-it-twice.md): spin up parallel sub-agents to design the interface several radically different ways, then compare on depth, locality, and seam placement.
````

## S2 – DEEPENING.md

SHA-256: `f3dd099ce99289bd213914d8ee3e2429b78309c3957ca4583f7659551b1d53c1`

````text
001 | # Deepening
002 | 
003 | How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in [SKILL.md](codebase-design-skill.md): **module**, **interface**, **seam**, **adapter**.
004 | 
005 | ## Dependency categories
006 | 
007 | When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is tested across its seam.
008 | 
009 | ### 1. In-process
010 | 
011 | Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface directly. No adapter needed.
012 | 
013 | ### 2. Local-substitutable
014 | 
015 | Dependencies that have local test stand-ins (PGLite for Postgres, in-memory filesystem). Deepenable if the stand-in exists. The deepened module is tested with the stand-in running in the test suite. The seam is internal; no port at the module's external interface.
016 | 
017 | ### 3. Remote but owned (Ports & Adapters)
018 | 
019 | Your own services across a network boundary (microservices, internal APIs). Define a **port** (interface) at the seam. The deep module owns the logic; the transport is injected as an **adapter**. Tests use an in-memory adapter. Production uses an HTTP/gRPC/queue adapter.
020 | 
021 | Recommendation shape: *"Define a port at the seam, implement an HTTP adapter for production and an in-memory adapter for testing, so the logic sits in one deep module even though it's deployed across a network."*
022 | 
023 | ### 4. True external (Mock)
024 | 
025 | Third-party services (Stripe, Twilio, etc.) you don't control. The deepened module takes the external dependency as an injected port; tests provide a mock adapter.
026 | 
027 | ## Seam discipline
028 | 
029 | - **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified (typically production + test). A single-adapter seam is just indirection.
030 | - **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams through the interface just because tests use them.
031 | 
032 | ## Testing strategy: replace, don't layer
033 | 
034 | - Old unit tests on shallow modules become waste once tests at the deepened module's interface exist; delete them.
035 | - Write new tests at the deepened module's interface. The **interface is the test surface**.
036 | - Tests assert on observable outcomes through the interface, not internal state.
037 | - Tests should survive internal refactors, since they describe behaviour, not implementation. If a test has to change when the implementation changes, it's testing past the interface.
````

## S3 – DESIGN-IT-TWICE.md

SHA-256: `8e740bf98446dbd4dfdc132ac4346d9a7eedaf93de6a495889171cf7f99f16bd`

````text
001 | # Design It Twice
002 | 
003 | When the user wants to explore alternative interfaces for a chosen deepening candidate, use this parallel sub-agent pattern. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best.
004 | 
005 | Uses the vocabulary in [SKILL.md](codebase-design-skill.md): **module**, **interface**, **seam**, **adapter**, **leverage**.
006 | 
007 | ## Process
008 | 
009 | ### 1. Frame the problem space
010 | 
011 | Before spawning sub-agents, write a user-facing explanation of the problem space for the chosen candidate:
012 | 
013 | - The constraints any new interface would need to satisfy
014 | - The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](codebase-design-deepening.md))
015 | - A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete
016 | 
017 | Show this to the user, then immediately proceed to Step 2. The user reads and thinks while the sub-agents work in parallel.
018 | 
019 | ### 2. Spawn sub-agents
020 | 
021 | Spawn 3+ sub-agents in parallel. Each must produce a **radically different** interface for the deepened module.
022 | 
023 | Prompt each sub-agent with a separate technical brief (file paths, coupling details, dependency category from [DEEPENING.md](codebase-design-deepening.md), what sits behind the seam). The brief is independent of the user-facing problem-space explanation in Step 1. Give each agent a different design constraint:
024 | 
025 | - Agent 1: "Minimize the interface: aim for 1–3 entry points max. Maximise leverage per entry point."
026 | - Agent 2: "Maximise flexibility: support many use cases and extension."
027 | - Agent 3: "Optimise for the most common caller: make the default case trivial."
028 | - Agent 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."
029 | 
030 | Include both [SKILL.md](codebase-design-skill.md) vocabulary and CONTEXT.md vocabulary in the brief so each sub-agent names things consistently with the architecture language and the project's domain language.
031 | 
032 | Each sub-agent outputs:
033 | 
034 | 1. Interface (types, methods, params, plus invariants, ordering, error modes)
035 | 2. Usage example showing how callers use it
036 | 3. What the implementation hides behind the seam
037 | 4. Dependency strategy and adapters (see [DEEPENING.md](codebase-design-deepening.md))
038 | 5. Trade-offs: where leverage is high, where it's thin
039 | 
040 | ### 3. Present and compare
041 | 
042 | Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.
043 | 
044 | After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.
````
