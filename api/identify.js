const EACH_API_URL = 'https://api.eachlabs.ai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4.1-mini';

const PROMPT = `You are a plant identification assistant. Look at the image and respond with ONLY a single JSON object, no markdown, no extra text, matching exactly this schema:

{
  "status": "ok" | "low_confidence" | "not_a_plant" | "error",
  "common_name": string,
  "scientific_name": string,
  "confidence": number between 0 and 1,
  "toxic_to_pets": boolean,
  "water": string,
  "light": string,
  "soil": string,
  "tip": string
}

Rules:
- If the image does not contain a plant, set status to "not_a_plant" and leave the other fields as empty string / false / 0.
- If you cannot confidently identify the species (true confidence below 0.6), set status to "low_confidence".
- Otherwise set status to "ok".
- confidence must reflect your genuine certainty, do not default to a high value.
- water/light/soil: short practical care instructions, each under 12 words.
- tip: one short practical tip (e.g. the most common way this plant dies), under 20 words.`;

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }
  return null;
}

function normalize(obj) {
  const validStatuses = ['ok', 'low_confidence', 'not_a_plant', 'error'];
  return {
    status: validStatuses.includes(obj.status) ? obj.status : 'error',
    common_name: obj.common_name || '',
    scientific_name: obj.scientific_name || '',
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    toxic_to_pets: !!obj.toxic_to_pets,
    water: obj.water || '',
    light: obj.light || '',
    soil: obj.soil || '',
    tip: obj.tip || '',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.EACH_API_KEY;
  if (!apiKey) {
    res.status(500).json({ status: 'error', message: 'Server misconfigured: missing EACH_API_KEY' });
    return;
  }

  const { image, mimeType } = req.body || {};
  if (!image || typeof image !== 'string') {
    res.status(400).json({ status: 'error', message: 'Missing "image" (base64 string) in request body' });
    return;
  }

  const model = process.env.MODEL || DEFAULT_MODEL;
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${image}`;

  try {
    const upstream = await fetch(EACH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('EachLabs upstream error', upstream.status, errText);
      res.status(200).json({ status: 'error', message: 'Upstream API error' });
      return;
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error('EachLabs empty content', JSON.stringify(data));
      res.status(200).json({ status: 'error', message: 'Empty response from model' });
      return;
    }

    const parsed = extractJson(content);
    if (!parsed) {
      console.error('Failed to parse model output', content);
      res.status(200).json({ status: 'error', message: 'Could not parse model response' });
      return;
    }

    res.status(200).json(normalize(parsed));
  } catch (err) {
    console.error('Proxy internal error', err);
    res.status(200).json({ status: 'error', message: 'Internal proxy error' });
  }
};
