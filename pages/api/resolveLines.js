import OpenAI from 'openai'

export default async function handler(req, res){
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed')
  try{
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('```')) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing or appears malformed.' })
    }
    const openai = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1' })

    const body = req.body || {}
    const source = body.source || ''
    const findings = Array.isArray(body.findings) ? body.findings : []

    // build a concise prompt asking for line numbers for each finding (only return JSON)
    const system = `You are a helpful assistant specialized in parsing Solidity source code. Given multiple vulnerability descriptions, return a JSON mapping of vulnerability id -> line number where that issue appears in the provided source.`
    let user = `SOURCE_START\n${source}\nSOURCE_END\n\nINSTRUCTIONS:\nReturn only valid JSON. For each finding in the provided list, return the best-guess line number (1-based) where the vulnerability appears. If you cannot find a match, return null for that id.\n\nFINDINGS:\n`;
    for (const f of findings){
      user += `- id: ${f.id || f.name || ''}\n  description: ${String(f.description || f.detail || f.proof_of_concept || f.summary || '').slice(0,300)}\n`;
    }
    user += `\nReturn a JSON object like { "id1": 123, "id2": null, ... }`;

    // Try chat.completions, then fallback to Responses API if available
    try{
      try{
        const resp = await openai.chat.completions.create({
          model: 'qwen/qwen3-coder-480b-instruct',
          messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
          temperature: 0.0,
          max_tokens: 800,
          top_p: 0.95,
        })
        const text = resp.choices?.[0]?.message?.content || ''
        const s = text.indexOf('{')
        const e = text.lastIndexOf('}')
        const jsonText = (s!==-1 && e!==-1) ? text.slice(s,e+1) : text
        try{ const parsed = JSON.parse(jsonText); return res.status(200).json({ mapping: parsed, raw: text }) }catch(e){ return res.status(200).json({ mapping: {}, raw: text }) }
      }catch(innerErr){
        console.warn('chat.completions failed, attempting Responses API fallback', innerErr?.message || innerErr)
        // try Responses-style API if present on client
        if (openai.responses && typeof openai.responses.create === 'function'){
          try{
            const resp2 = await openai.responses.create({ model: 'qwen/qwen3-coder-480b-instruct', input: [{ role:'system', content: system }, { role:'user', content: user }], temperature: 0.0, max_output_tokens: 800 })
            // try to extract text from resp2
            const text = resp2.output_text || resp2.output?.[0]?.content?.find(c=>c.type==='output_text')?.text || JSON.stringify(resp2)
            const s = text.indexOf('{')
            const e = text.lastIndexOf('}')
            const jsonText = (s!==-1 && e!==-1) ? text.slice(s,e+1) : text
            try{ const parsed = JSON.parse(jsonText); return res.status(200).json({ mapping: parsed, raw: text }) }catch(e){ return res.status(200).json({ mapping: {}, raw: text }) }
          }catch(innerErr2){
            console.error('Responses fallback failed', innerErr2?.message || innerErr2)
            return res.status(200).json({ mapping: {}, error: innerErr2?.message || String(innerErr2) })
          }
        } else {
          console.error('Responses API not available on OpenAI client')
          return res.status(200).json({ mapping: {}, error: innerErr?.message || String(innerErr) })
        }
      }
    }catch(err){
      console.error('resolveLines LLM error', err?.message || err)
      return res.status(200).json({ mapping: {}, error: err?.message || String(err) })
    }
  }catch(err){
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}
