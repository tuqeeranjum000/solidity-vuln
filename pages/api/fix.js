import OpenAI from 'openai'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed')
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('```')) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing or appears malformed.' })
    }

    const openai = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1' })

  const body = req.body || {}
  // Expect: { vulnerability: {...}, snippet: '...', snippet_start: number }
  const vuln = body.vulnerability || {}
  const snippet = body.snippet || ''
  const snippet_start = body.snippet_start || null

  const system = `You are an expert Solidity security engineer and auditor. 
When given a vulnerability description and the surrounding Solidity code, produce a clear, actionable fix, including exact line numbers and affected function names.`;

  const user = `INSTRUCTIONS:
- You will receive a JSON object with 'vulnerability' and 'snippet'.
- Return ONLY valid JSON (no markdown or extra text).
- The JSON object must have a top-level key 'fix' with the following structure:

{
  "summary": "Short one-line explanation of the fix",
  "steps": ["Step-by-step actions to remediate the vulnerability"],
  "patched_code": "Full Solidity code snippet with minimal changes applied, preserving context",
  "diff": "Unified diff string showing changes (optional, can be empty)",
  "references": ["Helpful URLs or reference strings"],
  "line_numbers": [int, int, ...],   // Exact line numbers where fix applies
  "function": "Name of the function where fix is applied"
}

- Always include exact line numbers where changes are made.
- Always include the function name where the vulnerability is fixed.
- Keep the patched code minimal but include surrounding lines for context.
- If multiple fixes are required for the snippet, combine them in one patched_code, but list all affected line numbers.
- Do NOT invent any other keys or text.

Here is the vulnerability object (JSON):
${JSON.stringify(vuln)}

Here is the code snippet to patch (delimited):
START_SNIPPET
${snippet}
END_SNIPPET

Return the JSON object only.`;

    let text = ''
    try {
      try {
        const resp = await openai.chat.completions.create({
          model: 'qwen/qwen3-coder-480b-instruct',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature: 0.0,
          max_tokens: 1500,
          top_p: 0.95,
        })
        text = resp.choices?.[0]?.message?.content || ''
      } catch (innerErr) {
        console.warn('chat.completions failed, attempting Responses API fallback', innerErr?.message || innerErr)
        // If the Responses API is available on the client, try it
        if (openai.responses && typeof openai.responses.create === 'function'){
          try{
            const resp2 = await openai.responses.create({
              model: 'qwen/qwen3-coder-480b-instruct',
              input: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ],
              temperature: 0.7,
              top_p: 0.8,
              max_output_tokens: 5500,
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
      // If the LLM endpoint is unavailable (404/502), produce a conservative local fallback fix
      const fallback = generateLocalFix(vuln, snippet, err)
      return res.status(200).json({ fix: fallback, fallback: true, rawError: err?.message || String(err) })
    }

    // naive JSON extraction similar to analyze.js
    function extractJson(text) {
      const s = text.indexOf('{')
      const e = text.lastIndexOf('}')
      if (s !== -1 && e !== -1) return text.slice(s, e+1)
      return text
    }

    try {
      const parsed = safeParseJsonWithRepair(text)

      // normalize fix object
      let fixObj = (parsed && typeof parsed === 'object' && parsed.fix) ? parsed.fix : parsed

      // helper to strip strings/comments to validate braces
      function stripStringsAndComments(s){
        if (!s) return ''
        // remove line comments
        s = s.replace(/\/\/.*$/gm, '')
        // remove block comments
        s = s.replace(/\/\*[\s\S]*?\*\//g, '')
        // remove quoted strings
        s = s.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '')
        return s
      }

      function isBalanced(code){
        if (!code) return false
        const s = stripStringsAndComments(code)
        const stack = []
        const pairs = { '}':'{', ']':'[', ')':'(' }
        for (let ch of s){
          if (ch === '{' || ch === '[' || ch === '(') stack.push(ch)
          else if (ch === '}' || ch === ']' || ch === ')'){
            if (stack.length === 0) return false
            const top = stack.pop()
            if (top !== pairs[ch]) return false
          }
        }
        return stack.length === 0
      }

      function tryRepairPatchedCode(src){
        if (!src || typeof src !== 'string') return null
        let s = src.trim()
        // remove code fences
        s = s.replace(/```(?:solidity|sol)?\s*/g, '').replace(/```/g, '')
        // trim leading/trailing non-code noise lines
        s = s.replace(/^\s*\n+/, '').replace(/\n\s*$/, '')
        return s
      }

      function computeUnifiedDiff(orig, patched){
        try{
          const a = (orig||'').split(/\r?\n/)
          const b = (patched||'').split(/\r?\n/)
          let firstDiff = -1
          let lastDiffA = -1
          let lastDiffB = -1
          const n = Math.max(a.length, b.length)
          for (let i=0;i<n;i++){
            const la = a[i] || ''
            const lb = b[i] || ''
            if (la !== lb){
              if (firstDiff === -1) firstDiff = i
              lastDiffA = i
              lastDiffB = i
            }
          }
          if (firstDiff === -1) return ''
          const ctx = 2
          const startA = Math.max(0, firstDiff - ctx)
          const endA = Math.min(a.length - 1, lastDiffA + ctx)
          const startB = Math.max(0, firstDiff - ctx)
          const endB = Math.min(b.length - 1, lastDiffB + ctx)
          const header = `@@ -${startA+1},${endA-startA+1} +${startB+1},${endB-startB+1} @@\n`
          let body = ''
          for (let i = startA; i <= endA; i++){
            const aa = a[i] || ''
            const bb = b[i] || ''
            if (aa !== bb){
              if (aa) body += `-${aa}\n`
              if (bb) body += `+${bb}\n`
            } else {
              body += ` ${aa}\n`
            }
          }
          return header + body
        }catch(e){ return '' }
      }

  // ensure we have a patched_code string
  const patchedRaw = fixObj && (fixObj.patched_code || fixObj.patchedCode || fixObj.patched) ? (fixObj.patched_code || fixObj.patchedCode || fixObj.patched) : null
      let patched = patchedRaw
      if (patched && typeof patched === 'string') patched = tryRepairPatchedCode(patched)

      // validate; if invalid, fall back to local generator
      if (!patched || typeof patched !== 'string' || !isBalanced(patched)){
        // final attempt: try to extract a {...} or function block
        const maybe = tryRepairPatchedCode(patchedRaw)
        if (maybe && isBalanced(maybe)){
          patched = maybe
          if (fixObj) fixObj.patched_code = patched
        } else {
          const fallback = generateLocalFix(vuln, snippet, new Error('Invalid patched_code from LLM'))
          return res.status(200).json({ fix: fallback, fallback: true, raw: text })
        }
      } else {
        if (fixObj) fixObj.patched_code = patched
      }

      // compute diff if missing
      try{
        if (fixObj && !fixObj.diff) fixObj.diff = computeUnifiedDiff(snippet, fixObj.patched_code)
      }catch(e){}

      // Build a stable response shape: always return { fix: { ... } }
      const responseObj = { fix: {} }
      if (parsed && typeof parsed === 'object'){
        if (parsed.fix && typeof parsed.fix === 'object') responseObj.fix = parsed.fix
        else {
          // parsed may itself be the fix object
          const candidate = parsed
          responseObj.fix = candidate
        }
      } else if (fixObj && typeof fixObj === 'object'){
        responseObj.fix = fixObj
      }

      // ensure patched_code is set on the returned fix
      if (patched && typeof patched === 'string') responseObj.fix.patched_code = patched

      // attach any LLM-provided line_numbers and expose a primary_line for the UI
      const ln = responseObj.fix.line_numbers || responseObj.fix.lineNumbers || responseObj.fix.lines
      if (Array.isArray(ln) && ln.length > 0){
        responseObj.fix.line_numbers = ln
        responseObj.fix.primary_line = Number(ln[0])
      }

      // attach snippet_start so frontend can align the patched code
      if (snippet_start) responseObj.fix.snippet_start = snippet_start
      return res.status(200).json(responseObj)
    } catch (err) {
      console.error('Failed to parse LLM text', text)
      return res.status(500).json({ error: 'Failed to parse LLM response as JSON', raw: text })
    }
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}

function safeParseJsonWithRepair(text){
  try{ return JSON.parse(text) }catch(e){}
  // strip fenced code blocks and try again
  try{ const s = text.replace(/```json|```/g,'').replace(/,\s*([}\]])/g,'$1'); return JSON.parse(s) }catch(e){}
  // extract first {...}
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s!==-1 && e!==-1){ try{ return JSON.parse(text.slice(s,e+1)) }catch(e){} }
  throw new Error('Failed to parse JSON')
}

function generateLocalFix(vuln, snippet, err){
  // produce conservative advice depending on vulnerability type
  const t = (vuln.type || '').toLowerCase()
  if (t.includes('reentr')){
    return {
      summary: 'Apply checks-effects-interactions and reentrancy guard',
      steps: [
        'Do state updates before external calls (checks-effects-interactions).',
        'Use a reentrancy guard (e.g., OpenZeppelin ReentrancyGuard) on withdraw-like functions.',
        'Avoid using low-level call for value transfers; prefer transfer/send or pull payments pattern.'
      ],
      patched_code: `// Example: add nonReentrant and move state update before external call\nfunction withdraw() public nonReentrant {\n  uint amount = balances[msg.sender];\n  require(amount > 0);\n  balances[msg.sender] = 0;\n  (bool ok, ) = msg.sender.call{value: amount}("");\n  require(ok);\n}`,
      diff: '',
      references: ['https://consensys.github.io/smart-contract-best-practices/known_attacks/#re-entrancy']
    }
  }
  if (t.includes('overflow') || t.includes('underflow')){
    return {
      summary: 'Use safe-math or built-in checked arithmetic',
      steps: ['Use Solidity 0.8+ which has built-in checked arithmetic, or use OpenZeppelin SafeMath for older versions.','Add input validation and unit tests for edge cases.'],
      patched_code: '// use unchecked/checked arithmetic or SafeMath depending on compiler version',
      diff: '',
      references: ['https://docs.openzeppelin.com/contracts/4.x/api/utils#SafeMath']
    }
  }
  // fallback generic
  return {
    summary: 'Review and sanitize external calls, add access checks',
    steps: ['Review the function and ensure proper access control','Avoid external calls before state updates','Add unit tests and fuzzing to verify fixes'],
    patched_code: snippet || '',
    diff: '',
    references: []
  }
}

