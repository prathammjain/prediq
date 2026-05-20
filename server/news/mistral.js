// mistral.js — minimal client for Mistral's chat completions API.
//
// Mistral exposes an OpenAI-compatible REST endpoint, so we use plain fetch
// rather than a heavy SDK. Reads the key from MISTRAL_API_KEY at call time
// (NOT at require-time) so importing this module in a context without the
// env var doesn't crash.
//
// JSON mode: setting response_format = { type: 'json_object' } makes the
// model return strictly-parseable JSON (Mistral guarantees `JSON.parse`
// will succeed). The caller is still responsible for validating the shape.

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'
const DEFAULT_MODEL = 'mistral-small-latest'  // free tier; good enough for drafting
const REQUEST_TIMEOUT_MS = 30_000

class MistralError extends Error {
  constructor(message, { status, body } = {}) {
    super(message)
    this.name = 'MistralError'
    this.status = status
    this.body = body
  }
}

// Send one chat completion. Returns { content, usage } where content is
// the parsed JSON object (when jsonMode=true) or the raw string otherwise.
async function chat({
  system,
  user,
  model = DEFAULT_MODEL,
  jsonMode = true,
  temperature = 0.4,
  maxTokens = 800,
}) {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    throw new MistralError('MISTRAL_API_KEY is not set in environment')
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  }
  if (jsonMode) body.response_format = { type: 'json_object' }

  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } finally {
    clearTimeout(t)
  }

  const text = await res.text()
  if (!res.ok) {
    throw new MistralError(`Mistral API ${res.status}`, { status: res.status, body: text.slice(0, 400) })
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new MistralError('Mistral returned non-JSON response', { body: text.slice(0, 400) })
  }

  const raw = parsed?.choices?.[0]?.message?.content
  if (!raw) throw new MistralError('Mistral response missing message.content', { body: text.slice(0, 400) })

  let content = raw
  if (jsonMode) {
    try {
      content = JSON.parse(raw)
    } catch {
      throw new MistralError('Model emitted invalid JSON despite json_object mode', { body: raw.slice(0, 400) })
    }
  }

  return { content, usage: parsed.usage ?? null, model: parsed.model ?? model }
}

module.exports = { chat, MistralError, DEFAULT_MODEL }
