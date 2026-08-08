// MemoriVault LLM service — Qwen Cloud (OpenAI-compatible API)
// Qwen-Max: complex reasoning & explanations
// Qwen-Turbo: lightweight memory maintenance (condense / evaluate)

import { AnalysisResult, Strategy } from './types.js';
import { STRATEGY_NAMES } from './constants.js';

const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const QWEN_MAX_MODEL = process.env.QWEN_MAX_MODEL || 'qwen-max';
const QWEN_TURBO_MODEL = process.env.QWEN_TURBO_MODEL || 'qwen-turbo';
const TIMEOUT_MS = 30_000;
const MAINTENANCE_TIMEOUT_MS = 20_000;

const QWEN_EMBED_MODEL = process.env.QWEN_EMBED_MODEL || 'text-embedding-v2';
const QWEN_EMBED_DIMS = 1536; // text-embedding-v2 output dimension

interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface QwenResponse {
  choices: Array<{ message: { content: string } }>;
  error?: { message: string };
}

interface QwenEmbedResponse {
  data: Array<{ index: number; embedding: number[] }>;
  error?: { message: string };
}

export { QWEN_EMBED_DIMS };

export class LLMService {
  private apiKey: string | null = null;
  private enabled = false;
  // Sliding-window rate limiter: timestamps of recent Qwen-Max calls.
  // Entries older than rateLimitWindowMs are dropped before each check,
  // so a burst at a window boundary can never exceed maxCallsPerWindow.
  private callTimestamps: number[] = [];
  private readonly rateLimitWindowMs = 60_000;
  private readonly maxCallsPerWindow = 30;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
      this.enabled = true;
      console.log(`🤖 LLM Service (Qwen Cloud): ${QWEN_MAX_MODEL} / ${QWEN_TURBO_MODEL}`);
    } else {
      console.warn('⚠️  No QWEN_API_KEY — using template-based explanations');
    }
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const cutoff = now - this.rateLimitWindowMs;
    // Drop calls that have aged out of the sliding window
    this.callTimestamps = this.callTimestamps.filter((t) => t > cutoff);
    return this.callTimestamps.length < this.maxCallsPerWindow;
  }

  private async callQwen(
    model: string,
    messages: QwenMessage[],
    maxTokens: number,
    timeoutMs: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Qwen API ${resp.status}: ${body.slice(0, 200)}`);
      }

      const data = (await resp.json()) as QwenResponse;
      if (data.error) throw new Error(data.error.message);
      return data.choices[0]?.message?.content?.trim() || '';
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Primary reasoning path (Qwen-Max) ──────────────────────────────────────

  async generateExplanation(analysis: AnalysisResult, memoryContext?: string): Promise<string> {
    if (!this.enabled || !this.checkRateLimit()) {
      return this.generateTemplateExplanation(analysis);
    }

    try {
      const systemParts = [
        'You are MemoriVault, an autonomous AI treasury agent managing B2B invoice yield optimization.',
        'Explain decisions in 2-3 clear sentences a small business owner can understand.',
        'Focus on the "why". Be direct. No jargon without explanation.',
      ];

      if (memoryContext) {
        systemParts.push('', 'MEMORY CONTEXT (use to inform your explanation):', memoryContext);
      }

      // Reserve slot before the await so concurrent callers can't both slip through.
      // Capture the exact timestamp value — NOT the array index — so the rollback
      // on failure is safe under concurrent callers. Splicing by index is unsafe:
      // if caller A fails first and splices index 5, caller B's entry shifts from
      // index 6 to 5, and B's subsequent splice(6) removes an unrelated entry,
      // silently erasing a successful call from the sliding window.
      const myTs = Date.now();
      this.callTimestamps.push(myTs);
      try {
        const content = await this.callQwen(
          QWEN_MAX_MODEL,
          [
            { role: 'system', content: systemParts.join('\n') },
            { role: 'user', content: this.buildPrompt(analysis) },
          ],
          300,
          TIMEOUT_MS,
        );
        return content || this.generateTemplateExplanation(analysis);
      } catch (error) {
        // Roll back only this call's slot. Use lastIndexOf so that if two calls
        // happen within the same millisecond (identical timestamps) we remove
        // the most-recently-added one — our own — rather than an earlier entry.
        const idx = this.callTimestamps.lastIndexOf(myTs);
        if (idx !== -1) this.callTimestamps.splice(idx, 1);
        console.error('Qwen explanation error, falling back to template:', error instanceof Error ? error.message : error);
        return this.generateTemplateExplanation(analysis);
      }
    } catch (error) {
      console.error('Qwen explanation setup error:', error instanceof Error ? error.message : error);
      return this.generateTemplateExplanation(analysis);
    }
  }

  private buildPrompt(analysis: AnalysisResult): string {
    return `Explain this treasury decision:
- Invoice #${analysis.tokenId} | Days until due: ${analysis.daysUntilDue}
- Risk Score: ${analysis.riskScore}/100 | Payment Probability: ${analysis.paymentProbability}%
- Strategy: ${STRATEGY_NAMES[analysis.currentStrategy]} → ${STRATEGY_NAMES[analysis.recommendedStrategy]}
- Confidence: ${analysis.confidence}% | Action: ${analysis.shouldAct ? 'EXECUTE CHANGE' : 'HOLD CURRENT'}

Strategy APY reference: Hold=0%, Conservative=3.5%, Aggressive=7%
Explain why we are ${analysis.shouldAct ? 'changing to' : 'keeping'} ${STRATEGY_NAMES[analysis.recommendedStrategy]}.`;
  }

  // ── Memory maintenance path (Qwen-Turbo — cheaper & faster) ────────────────

  async condenseMemories(episodeContents: string[]): Promise<string | null> {
    if (!this.enabled || episodeContents.length === 0) return null;

    try {
      const content = await this.callQwen(
        QWEN_TURBO_MODEL,
        [
          {
            role: 'system',
            content:
              'You are a financial memory distiller. Analyze treasury agent decision logs and extract exactly one actionable "rule of thumb". Output one sentence starting with "When", "Always", or "Avoid". Be specific.',
          },
          {
            role: 'user',
            content: `Distill these ${episodeContents.length} logs into one rule:\n\n${episodeContents.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
          },
        ],
        100,
        MAINTENANCE_TIMEOUT_MS,
      );

      return content || null;
    } catch (error) {
      console.error('Memory condensation error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async evaluateMemoryRelevance(memoryContent: string): Promise<number> {
    if (!this.enabled) return 0.5;

    try {
      const content = await this.callQwen(
        QWEN_TURBO_MODEL,
        [
          {
            role: 'system',
            content:
              'Rate how relevant this treasury memory is for future AI decisions. Reply with only a number 0-10 (0=obsolete, 10=highly relevant).',
          },
          { role: 'user', content: `Rate (0-10): "${memoryContent}"` },
        ],
        5,
        10_000,
      );

      const score = parseFloat(content);
      return isNaN(score) ? 0.5 : Math.min(10, Math.max(0, score)) / 10;
    } catch {
      return 0.5;
    }
  }

  // ── Template fallback (no API key or rate-limited) ─────────────────────────

  private generateTemplateExplanation(analysis: AnalysisResult): string {
    const strategy = STRATEGY_NAMES[analysis.recommendedStrategy];
    const current = STRATEGY_NAMES[analysis.currentStrategy];

    if (!analysis.shouldAct) {
      return (
        `Maintaining ${current} strategy. Conditions remain optimal with ${analysis.confidence}% confidence ` +
        `(${analysis.daysUntilDue}d until due, ${analysis.paymentProbability}% payment probability).`
      );
    }

    if (analysis.recommendedStrategy === Strategy.Aggressive) {
      return (
        `Upgrading to Aggressive (7% APY). Strong fundamentals: ${analysis.riskScore}/100 risk, ` +
        `${analysis.paymentProbability}% payment probability, ${analysis.daysUntilDue}d yield window.`
      );
    }
    if (analysis.recommendedStrategy === Strategy.Conservative) {
      return (
        `Moving to Conservative (3.5% APY). Moderate conditions favour stable yield over capital risk. ` +
        `${analysis.confidence}% confidence.`
      );
    }
    return (
      `Switching to Hold. Risk metrics (${analysis.riskScore}/100, ${analysis.paymentProbability}% payment) ` +
      `suggest protecting capital until conditions improve.`
    );
  }

  // ── Embedding path (text-embedding-v2 — for pgvector semantic search) ───────

  /**
   * Convert text to a 1536-dimensional vector using Qwen's embedding API.
   * Returns null when the API key is absent or the call fails — callers must
   * fall back to TF-IDF search in that case.
   */
  async embedText(text: string): Promise<number[] | null> {
    if (!this.enabled) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const resp = await fetch(`${QWEN_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: QWEN_EMBED_MODEL, input: text }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Qwen embed API ${resp.status}: ${body.slice(0, 120)}`);
      }

      const data = (await resp.json()) as QwenEmbedResponse;
      if (data.error) throw new Error(data.error.message);
      return data.data[0]?.embedding ?? null;
    } catch (err) {
      console.warn('[LLM] embedText failed, TF-IDF fallback active:', (err as Error).message.split('\n')[0].slice(0, 80));
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
