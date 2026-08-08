---
title: obsidianquartz
---

# obsidianquartz

Three distinct topics live in this notebook — hospital billing, learning Chinese, and building software with AI. They look unrelated until you see the thread connecting them: **AI is rewriting the rules of work in all three domains at the same time**.

---

## Hospital Billing & Healthcare Finance

Healthcare finance is under compressive pressure from multiple directions: margins shrinking, payer complexity increasing, AI entering clinical billing for the first time.

**What revenue cycle management actually is.** RCM is the end-to-end financial process that turns a patient visit into a payment. It runs from scheduling and insurance verification through charge capture, claims submission, denial management, and final collections. Every step is a potential revenue leak, and most healthcare organizations lose 5–10% of collectible revenue to errors and denials. See [[What Is Revenue Cycle Management (RCM)?]] and [[What is revenue cycle management in healthcare?]] for the full lifecycle.

**AI entering the billing code system.** The AMA is proposing a new billing category — "clinically meaningful algorithmic analyses" (CMAA) — that would let hospitals bill for work done by autonomous AI algorithms. The concern: AI gets a revenue stream for doing clinical work, while nurses, who've done similar work for decades without standalone billing codes, get nothing. This is a structural economic shift, not a minor policy update. See [[New AI billing codes spark concern across nursing]].

**The profitability divide is widening.** Through the first half of 2026, national hospital operating margins fell 5% year-over-year — but the distribution is extreme. Hospitals with 500+ beds improved 11% while small hospitals declined 6–7%. HCA (the dominant for-profit) ran a 12% operating margin while the largest nonprofits posted losses. Scale advantages in payer negotiation, labor, and administrative infrastructure are compounding. See [[The hospital profitability divide 10 things to know - Becker's Hospital Review  Healthcare News & Analysis]].

**Telehealth is the growth vector.** 272 telehealth companies are now operating in the U.S., covering everything from virtual nursing to telepsychiatry to remote patient monitoring. The pandemic forced adoption; the infrastructure built then is now the foundation for expanding outpatient reach without brick-and-mortar cost. Health systems are racing to build ambulatory/outpatient networks precisely to capture this volume before it goes elsewhere. See [[272 telehealth companies to know]] and [['Hospitals without an outpatient footprint will struggle' Health systems race to build ASC networks]].

**The pattern across all four:** billing complexity → underpayment → lost revenue → financial pressure → cost-cutting → staff pressure → quality risk → worse patient outcomes → higher costs. Fixing the billing system isn't administrative housekeeping — it's clinical quality infrastructure.

---

## Learning Chinese

Chinese is genuinely hard for English speakers (FSI Category IV, ~2,200 hours to professional proficiency), but the research on effective methods is clearer than it's ever been. Three principles dominate:

**Spaced repetition is non-negotiable.** Vocabulary learned without spaced repetition fades within days. SRS schedules each word's review at the exact interval before it would be forgotten, compounding retention over time. Anki is the gold standard for flexible SRS; Migaku adds sentence mining from native content on top. The mistake most learners make: adding new words faster than they can review them, creating a debt that collapses the system. See [[Spaced Repetition Software What It Is and How to Use It to Learn Chinese]].

**Characters require deliberate practice.** Reading Chinese is not just pattern recognition — it's understanding that each character is compositional (radical + phonetic component) and that stroke order encodes visual structure. Learning the 6 core stroke order rules makes most new characters predictable. Apps like Skritter and Calli add stroke-by-stroke feedback that paper practice alone can't give. See [[Chinese Writing Practice How to Master Chinese Characters in 2026]].

**Comprehensible input is the engine.** Grammar study gets you started; immersion in Chinese content at your level (graded readers, Chinese-subtitled dramas, podcasts) is what builds fluency. The best apps in 2026 — HelloChinese for structure, Migaku for immersion, iTalki for speaking — each serve a different phase of this pipeline. See [[Best Ways to Learn Chinese in 2026 - Apps Plans Tips]].

**The AI angle:** AI tutors (Claude, ChatGPT) are genuinely useful for grammar correction and vocabulary in context, but unreliable for pronunciation feedback. The highest value AI tool in Chinese learning is the AI-powered popup dictionary that makes native content accessible before you're "ready" for it.

---

## Building SaaS & Apps with AI

The cost of building software has collapsed. A solo developer in 2026 with a clear product idea and good tool discipline can ship a working SaaS or mobile app in 2–3 weeks. The bottleneck is no longer building — it's knowing what to build and who it's for.

### The Vibe Coding Shift

**What vibe coding actually means.** Describe behavior in natural language, AI generates implementation, you review and guide. The key insight: vibe coding works best on top of a scaffold you understand — a boilerplate, a familiar framework — not from a blank file. Starting with a SaaS boilerplate (auth, billing, teams, email already wired) means your first AI conversation is about your product, not plumbing. See [[Vibe Coding for SaaS Builders What Non-Technical Founders Need to Know in 2026]] and [[How to Build a SaaS Quickly in 2026 - AI Agents Boilerplates and Vibe Coding]].

**Claude Code vs. Cursor.** Cursor is the daily driver: AI tab completion and inline edits inside VS Code. Claude Code is for agentic tasks where you want the AI to execute multi-step work autonomously — reading the codebase, writing code, running tests, and checking its own output. Use both: Cursor for active coding sessions, Claude Code for complex multi-file tasks or automations. See [[Claude Code vs Cursor What to Choose in 2026]].

**10 app categories that are now buildable solo.** AI CRMs, multi-vendor marketplaces, subscription learning platforms, AI content generators, booking systems, social schedulers, job boards, analytics dashboards, and AI customer support — all of these now have clear implementations using Supabase + Stripe + Vercel + a frontier LLM API. See [[10 Complex SaaS Apps You Can Build with Vibe Coding in 2026]].

### Context Engineering

The meta-skill behind good AI agents is no longer prompt engineering — it's **context engineering**: deciding exactly what information goes into the model's context window at each step.

**Why it matters.** Research shows LLM performance degrades as context length grows ("context rot"), key information buried in the middle of long contexts performs worse than information at the edges, and too many tools in context confuses the model. The solution isn't bigger context windows — it's better-curated context. See [[Context Engineering vs Prompt Engineering for AI Agents]], [[Context Engineering A Practical Guide for AI Agents]], and [[Context Engineering The Next Frontier Beyond Prompt Engineering]].

**Four ways context fails:** (1) poisoning — a hallucination gets into context and is repeatedly referenced; (2) distraction — accumulated history crowds out reasoning; (3) confusion — too many tools or irrelevant documents dilute attention; (4) clash — different parts of context contradict each other. Each failure mode has a specific fix.

### Mobile & Infrastructure

**Shipping to the App Store.** EAS (Expo Application Services) handles the painful parts of iOS distribution: code signing, certificates, provisioning profiles. A production build is `eas build --platform ios --profile production`; submission is `eas submit --platform ios --latest`. EAS Workflows add CI/CD on top. See [[Guide How to Publish to App Store with Expo React Native]] and [[Building Fully Native iOS Apps with Expo EAS]].

**Monorepo architecture.** When you have a mobile app and a web app sharing code, Turborepo + pnpm workspaces is the 2026 standard. The critical configuration detail: use `dependenciesMeta.injected: true` in pnpm so React Native's Metro bundler resolves to the consumer's copy of React rather than creating two instances. See [[React Native Monorepo with Turborepo and Expo A Platform Team Guide for 2026]] and [[How to Build a pnpm Monorepo the Right Way]].

**Supabase RLS is the security layer.** Row Level Security policies enforce data access at the database level. The foundational pattern: `organization_id` on every table, membership checked via `auth.uid()`, security definer functions for performance. Always test as a non-privileged user — the Supabase dashboard runs as service role and bypasses RLS. See [[Supabase RLS Best Practices Production Patterns for Secure Multi-Tenant Apps]].

### Monetization

**Subscriptions beat one-time.** The compounding math: 1,000 downloads/month × 8% trial start × 40% trial-to-paid × $6/month = $190/month new MRR that grows as the subscriber base builds. One-time purchases don't compound. See [[How to Make Money From an App in 2026 Real Numbers]].

**Annual plans are the single highest-leverage decision.** Apps with annual plans generate 2.3× more revenue per subscriber and see 8× lower early churn. Display annual as the default, show the per-month equivalent, and offer a trial on annual too. RevenueCat's 2026 benchmark: annual plan subscribers generate most of the revenue in top-quartile apps. See [[The State of Subscription Apps 2026 - RevenueCat]] and [[How to Make More Money as a Mobile App Developer in 2026]].

**The indie hacker path.** Find a problem you personally experienced → validate with 5 conversations → scope the smallest useful MVP → charge from day one → ship to a waitlist → iterate. The mistake: building the wrong thing quickly. The AI coding advantage in 2026 means speed is no longer the bottleneck — judgment and distribution are. See [[Indie Hacker Guide How to Build a Profitable Side Project 2026]] and [[The Indie Hacker Toolkit for 2026 AI Automation and the Rise of the Solo Empire]].

---

## The Connecting Thread

These three topics look separate. They aren't.

**AI is the forcing function in all three.**

In healthcare: AI is automating RCM steps (coding, denial management, eligibility verification), entering the billing code system as a billable entity (CMAA), and powering the telehealth platforms that are replacing in-person visits. The economic disruption is real — hospitals that don't adapt their revenue cycle to AI-augmented workflows will fall further behind.

In Chinese learning: AI is making native-content immersion accessible to beginners via popup dictionaries and AI tutors, compressing the time to reading comprehension. The best Chinese learning apps in 2026 (Migaku, Calli) are essentially context-engineering problems — surfacing the right vocabulary, at the right level, in the right context.

In building software: AI agents + context engineering + managed infrastructure has lowered the cost of shipping from $40,000 (a small dev team) to $150 (API credits and a few weeks). This is why solo founders can now build apps that previously required teams. The same pattern — AI reducing cost and complexity of skilled work — is playing out in billing, language learning, and software in parallel.

**The skill that transfers.** Whether you're building a healthcare billing SaaS, a Chinese learning app, or a subscription tool for indie hackers, the core skill is the same: decide what problem is worth solving, understand the system you're working in deeply enough to design the right solution, and use AI to execute faster than a team could. Context engineering is the underlying discipline — knowing what information to give the AI, at what time, in what format — whether you're building the AI features or using AI to build.
