// Raw Groq chat-completions call — plain fetch, no SDK.

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT =
  'You are a senior CI engineer. Diagnose the pipeline failure in 2-4 sentences, ' +
  'then end with a single line starting with "Likely fix:".';

// Pure request builder (kept separate so it can be unit-tested without the API).
export function buildRequest({ apiKey, model, prompt }) {
  return {
    url: GROQ_URL,
    options: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    },
  };
}

// Returns the assistant's text, or throws with a short reason.
export async function chat({ apiKey, model, prompt }) {
  const { url, options } = buildRequest({ apiKey, model, prompt });
  const res = await fetch(url, options);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Groq API ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq API returned no content');
  return text;
}
