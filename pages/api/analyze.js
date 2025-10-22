import formidable from 'formidable'
import fs from 'fs'
import OpenAI from 'openai'

export const config = {
  api: {
    bodyParser: false,
  },
}

function parseForm(req) {
  const form = new formidable.IncomingForm()
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
      resolve({ fields, files })
    })
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed')
  try {
    // Ensure OPENAI_API_KEY is present and valid-looking
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('```')) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing or appears malformed. Make sure you set a plain API key in .env.local without code fences.' })
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    })

    const { files } = await parseForm(req)
    const file = files.file
    if (!file) return res.status(400).json({ error: 'No file uploaded' })
    const content = fs.readFileSync(file.filepath, 'utf8')

  // Build a stronger prompt for the LLM to analyze Solidity and return a rich JSON report
  const system = `You are an expert security auditor specialized in Solidity smart contracts. Your job is to analyze contract source code and produce a machine-readable JSON report describing all potential vulnerabilities, their severity, exact location, impacted functions/contracts, proof-of-concept (concise), remediation steps, and references.`

  const user = `INSTRUCTIONS:\n- Analyze the Solidity source code delimited below.\n- Return ONLY valid JSON, with a top-level object containing keys: metadata, vulnerabilities.\n- metadata should include: file_name (string), total_issues (integer).\n- vulnerabilities should be an array of objects; each object MUST contain the following fields:\n  - id: unique short id (string)\n  - type: short vulnerability name (string)\n  - severity: one of [low, medium, high, critical]\n  - description: short summary (string)\n  - detail: longer explanation (string)\n  - line: integer or null\n  - contract: contract name or null\n  - function: function name or null\n  - proof_of_concept: short code snippet or explanation (string or null)\n  - recommendation: actionable remediation steps (string)\n  - references: array of URLs or strings (may be empty)\n\nReturn a compact JSON object only (no markdown, no commentary). If any field is unknown, use null or an empty array/string as appropriate.\n\nEXAMPLE OUTPUT:\n{\n  "metadata": { "file_name": "MyContract.sol", "total_issues": 2 },\n  "vulnerabilities": [\n    { "id": "V001", "type": "Reentrancy", "severity": "critical", "description": "Reentrancy in withdraw()", "detail": "Detailed explanation...", "line": 123, "contract": "Vault", "function": "withdraw", "proof_of_concept": "call{value: ...}", "recommendation": "Use checks-effects-interactions...", "references": ["https://..."] }\n  ]\n}\n\nSTART_CONTRACT\n${content}\nEND_CONTRACT\n\nRespond only with the JSON object described above.`

    let text = ''
    try {
      try {
        const resp = await openai.chat.completions.create({
          model: 'qwen/qwen3-coder-480b-a35b-instruct',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.0,
          max_tokens: 2000,
          top_p: 0.95,
        })
        text = resp.choices?.[0]?.message?.content || ''
      } catch (innerErr) {
        console.warn('chat.completions failed, attempting Responses API fallback', innerErr?.message || innerErr)
        if (openai.responses && typeof openai.responses.create === 'function'){
          try{
            const resp2 = await openai.responses.create({
              model: 'qwen/qwen3-coder-480b-a35b-instruct',
              input: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ],
              temperature: 0.0,
              max_output_tokens: 2000,
            })
            text = resp2.output_text || resp2.output?.[0]?.content?.find(c=>c.type==='output_text')?.text || ''
          }catch(innerErr2){
            console.error('Responses API fallback also failed', innerErr2?.message || innerErr2)
            throw innerErr2
          }
        } else {
          console.error('Responses API not available on OpenAI client')
          throw innerErr
        }
      }
    } catch (err) {
      console.error('LLM chat.completions failed', err?.message || err)
      // If the LLM endpoint is unavailable (404/502), produce a conservative local fallback result
      const metadata = { file_name: file.originalFilename || 'contract.sol', total_issues: 0 }
      return res.status(200).json({ metadata, vulnerabilities: [], fallback: true, rawError: err?.message || String(err) })
    }

    // Try to parse JSON from response into the defined schema with a repair pass
    try {
      const parsed = safeParseJsonWithRepair(text)
      if (Array.isArray(parsed)) {
        const vulnerabilities = parsed
        const metadata = { file_name: file.originalFilename || 'contract.sol', total_issues: vulnerabilities.length }
        return res.status(200).json({ metadata, vulnerabilities })
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.vulnerabilities)) {
        return res.status(500).json({ error: 'LLM returned JSON but did not match expected schema', raw: parsed })
      }
      return res.status(200).json({ metadata: parsed.metadata || {}, vulnerabilities: parsed.vulnerabilities })
    } catch (err) {
      return res.status(500).json({ error: 'Failed to parse LLM response as JSON', raw: text })
    }
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}

function extractJson(text) {
  // Attempt naive extraction: find first '{' or '[' and last matching '}' or ']'
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)
  const s2 = text.indexOf('{')
  const e2 = text.lastIndexOf('}')
  if (s2 !== -1 && e2 !== -1) return text.slice(s2, e2 + 1)
  return text
}

function safeParseJsonWithRepair(text){
  // 1) try direct parse
  try{ return JSON.parse(text) }catch(e){}
  // 2) extract braces/brackets
  try{ const c = extractJson(text); return JSON.parse(c) }catch(e){}
  // 3) simple repairs: remove markdown fences and trailing commas
  try{
    let s = text.replace(/```json|```/g,'')
    s = s.replace(/,\s*([}\]])/g,'$1')
    return JSON.parse(s)
  }catch(e){}
  // 4) last resort: look for first { and last } and parse substring
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s!==-1 && e!==-1){
    try{ return JSON.parse(text.slice(s,e+1)) }catch(e){}
  }
  throw new Error('Failed to parse JSON')
}
