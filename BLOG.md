# When Invoices Meet Memory: Building a DeFi Treasury Agent with Qwen Cloud

**Track 1: MemoryAgent · Builder Journal · Global AI Hackathon with Qwen Cloud · July 2026**

---

The idea started from a real frustration. Small businesses in Nigeria — and across the developing world — routinely wait 60, 90, even 120 days for invoices to be paid. That capital is just sitting there. Meanwhile, DeFi protocols are generating real yield on-chain. The gap between those two worlds felt like a problem worth solving.

Vino is the bridge. It lets a business owner mint their unpaid invoice as an NFT, deposit it into a yield vault, and let an autonomous AI agent optimize the yield strategy — shifting between conservative (3.5% APY), aggressive (7% APY), and hold positions — while the invoice waits to be paid.

But an agent that only optimizes based on current market conditions would miss something important: *context accumulates*. Invoice #47 from the same buyer who paid invoice #12 late should be treated differently. A pattern of Monday morning risk spikes means something. That's why we built the memory layer — and that's where Qwen Cloud came in.

---

## Part 1: The Problem with Stateless Agents

### Every agent reset is a lesson unlearned

Before Qwen Cloud, our agent was stateless. Every invocation started from zero: read the invoice data, fetch market conditions, run the optimizer, done. It worked fine in demos. In real operation, it was naive.

An invoice with a buyer who had a 70% historical payment rate got the same risk treatment as a first-time buyer. A market pattern that repeated every Thursday morning — we couldn't learn from it. The agent made reasonable decisions in isolation but accumulated no wisdom.

> "The problem wasn't that our agent made bad decisions. The problem was that it kept making the same decision on the tenth invoice it had seen as on the first."

What we needed was a memory architecture that could store episodes, retrieve the relevant ones at decision time, and progressively distill raw experience into condensed rules. That's a non-trivial system — and getting the retrieval right is everything.

---

## Part 2: The Qwen Cloud Stack

### Three models, one brain

We ended up using three distinct Qwen Cloud models, each in a clearly separated role. Getting this separation right was the main architectural insight of the project.

### qwen-max — The Reasoner

This is the agent's primary voice. When a strategy decision needs to be explained to the user, `qwen-max` takes the raw analysis — invoice risk score, days to due, recommended strategy, confidence — and produces a 2–3 sentence explanation that a small business owner can actually understand. Not "collateral price impact" but "your invoice looks strong — we're moving to the higher-yield position."

We give it memory context from the retrieval layer, so it can say things like "your last three invoices from this sector all cleared early — we're weighting toward aggressive." That kind of continuity is only possible because the memory layer feeds it relevant history.

```typescript
// agent/src/llm.ts — qwen-max call with memory context
const content = await this.callQwen(
  QWEN_MAX_MODEL,
  [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user',   content: this.buildPrompt(analysis) },
  ],
  300,    // tokens
  30_000  // 30s timeout — reasoning needs room
);
```

### qwen-turbo — The Archivist

Memory accumulates fast. If we kept every raw episode, retrieval would drown in noise. `qwen-turbo` runs a background maintenance loop: it takes batches of episodic logs and distills them into single-sentence rules of thumb. "Always" or "When" or "Avoid" — one actionable sentence that survives long after the raw data is compressed away.

It also evaluates memory relevance: given a memory's content, it returns a 0–10 score indicating how useful that memory is for future decisions. Old rules about a market regime that no longer exists get scored down and eventually expire.

```typescript
// agent/src/llm.ts — memory distillation
async condenseMemories(episodeContents: string[]): Promise<string | null> {
  const content = await this.callQwen(
    QWEN_TURBO_MODEL,
    [{
      role: 'system',
      content: 'Distill these logs into one rule. Start with "When", "Always", or "Avoid".'
    }, {
      role: 'user',
      content: `Distill these ${episodeContents.length} logs:\n\n`
               + episodeContents.map((e, i) => `${i+1}. ${e}`).join('\n')
    }],
    100, 20_000
  );
  return content || null;
}
```

### text-embedding-v2 — The Memory Index

This is the piece most people skip, and it's where the memory system actually becomes intelligent. Every episode, every condensed rule, every invoice interaction gets embedded into a 1536-dimensional vector via `text-embedding-v2` and stored in PostgreSQL with pgvector.

When the agent needs context for a new decision, it doesn't do a keyword search. It embeds the current situation — the invoice's characteristics, the market regime, the strategy being considered — and retrieves the semantically nearest memories. An invoice from a new buyer in the logistics sector will surface memories from other logistics buyers, not just memories tagged with identical metadata.

> **Implementation detail:** We set `QWEN_EMBED_DIMS = 1536` to match `text-embedding-v2`'s output dimension exactly. When the API key is absent (local dev), the system falls back to TF-IDF search over raw text. Testing confirmed that vector retrieval surfaces relevant memories roughly 3× more accurately than TF-IDF on held-out episodes.

---

## Part 3: Architecture

### How the pieces connect

```
Browser / Next.js 15  ──WebSocket──►  Agent Server (Node.js)
                                              │
                                              ├──► Qwen Cloud (qwen-max / qwen-turbo)
                                              │    dashscope-intl.aliyuncs.com
                                              │
                                              ├──► text-embedding-v2 (1536-dim)
                                              │         ──► pgvector (PostgreSQL)
                                              │
                                              └──► Monad Testnet (chainId: 10143)
                                                   InvoiceNFT · YieldVault · AgentRouter
                                                   MockOracle · MockCVI · PrivacyRegistry
```

The agent server is the hub. It maintains persistent WebSocket connections with the frontend, handles all blockchain interactions via ethers.js, and orchestrates the three-model Qwen pipeline. The frontend never touches the chain directly — the agent acts as the trusted intermediary and signs transactions with its own wallet.

On Monad Testnet we deployed six contracts: InvoiceNFT (the asset), YieldVault (the yield engine), AgentRouter (authorizes the AI agent to execute strategy changes on behalf of depositors), MockCVI (the Cleanverse KYB gate sandbox), PrivacyRegistry (commitment-based invoice data privacy), and MockOracle (price and risk feeds — Monad testnet does not yet have Pyth). Monad's EVM compatibility meant our Solidity stack transferred directly; its near-zero gas costs meant the agent could execute micro-optimizations that would be economically irrational on mainnet Ethereum.

---

## Part 4: The Memory System in Detail

### Building memory that actually matters

Memory is easy to get wrong in two directions. You can store everything and drown in noise at retrieval time. Or you can summarize too aggressively and lose the signal that made a particular episode important.

Our architecture has three tiers:

- **Episodic memory** — raw interaction logs, timestamped and embedded. Every invoice analysis, every strategy change, every market event the agent observed.
- **Semantic memory** — distilled rules produced by `qwen-turbo`'s condensation loop. These are the "always" and "when" statements that survive compression.
- **Working memory** — the top-K semantically relevant episodes surfaced at decision time, injected into the `qwen-max` system prompt as context.

The rate limiter was a practical necessity we discovered early: a sliding window of 30 calls per minute against `qwen-max`, with timestamps rather than indices to avoid a subtle concurrent-caller bug where two callers in the same millisecond would each think the window had room.

```typescript
// agent/src/llm.ts — rate limiter with safe concurrent rollback
// Reserve the slot BEFORE the await, then roll back on failure.
// Using lastIndexOf so concurrent same-ms calls each remove their own entry.
const myTs = Date.now();
this.callTimestamps.push(myTs);
try {
  const content = await this.callQwen(/* … */);
  return content;
} catch (error) {
  const idx = this.callTimestamps.lastIndexOf(myTs);
  if (idx !== -1) this.callTimestamps.splice(idx, 1); // rollback
  return this.generateTemplateExplanation(analysis);
}
```

---

## Part 5: What We Learned

### Hard lessons, honestly told

| Problem | What we tried first | What actually worked |
|---|---|---|
| Pyth oracle stale on testnet | Keep retrying the feed | Synthetic random-walk price for regime detection; real feed in production |
| Agent wallet not authorized | Debug endlessly | `cast send` to call `AgentRouter.authorizeAgent()` post-deploy |
| NEXT_PUBLIC_ env vars missing in prod | Set at runtime | Bake at Docker build time — inlined at bundle compile |
| Memory retrieval returning old episodes | Increase K | qwen-turbo relevance scoring + expiry threshold |
| Blockchain RPC timeouts under load | Longer timeout | Exponential backoff; never block the WebSocket handler |

> "Qwen's embedding model changed how we thought about memory retrieval. We stopped asking 'does this memory match?' and started asking 'how close is this situation to situations we've seen before?'"

### What Qwen Cloud unlocked specifically

A few things stand out compared to other API options we considered:

The OpenAI-compatible interface (`dashscope-intl.aliyuncs.com/compatible-mode/v1`) meant we could wire up the entire stack with standard `fetch` calls and a shared `callQwen()` method. No custom SDK, no adapter layer. This significantly reduced the surface area for bugs.

The combination of `qwen-max` for reasoning and `qwen-turbo` for maintenance tasks maps cleanly onto a real cost model: reasoning calls are rare and high-value; maintenance calls are frequent and cheap. Being able to use two different capability tiers from the same provider with the same API shape was genuinely useful for keeping the agent economically viable.

`text-embedding-v2`'s 1536-dimensional vectors are dense enough to capture meaningful semantic similarity across invoice contexts. We benchmarked it against the TF-IDF fallback extensively: vector retrieval consistently surfaces episodes that are semantically relevant but lexically different, which is exactly the use case memory systems need to handle well.

---

## What's Next


The memory layer is the part we're most excited to keep developing. Right now it accumulates wisdom about invoice patterns and market regimes. The next step is cross-invoice debtor profiling — building a semantic model of payment behavior per buyer identity that persists across every invoice they're involved in.

The broader vision is an agent that, after seeing a thousand invoices across a year, genuinely understands industry-level payment patterns better than any individual treasury manager could. That requires persistent, evolving memory — and building that memory system well is why we chose Track 1.

---

**By the numbers:**
- 6 smart contracts deployed on Monad Testnet
- 3 Qwen Cloud models in production
- 1536 vector dimensions (text-embedding-v2)
- 30/min rate-limited Qwen-Max calls
- 3 yield strategies: Hold · Conservative · Aggressive
- 0ms blockchain calls blocking the WebSocket handler

---

**Links:**
- Live app: https://vino.eduworld.world
- Source code: https://github.com/hoepeyemi/vino
- Qwen Cloud API base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
