// ...existing code...
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import Prism from 'prismjs'
import CodeHighlighter from '../components/CodeHighlighter'

// tiny inline SVG severity icon
function SeverityIcon({ severity='low' }){
  if (severity === 'critical') return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l3 6 6 .5-4.5 3.9L19 21l-7-4-7 4 1.5-8.6L3 8.5 9 8 12 2z" fill="white"/></svg>
  )
  if (severity === 'high') return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2a7 7 0 017 7v5a7 7 0 01-14 0V9a7 7 0 017-7z" fill="white"/></svg>
  )
  if (severity === 'medium') return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="white"/></svg>
  )
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="white"/></svg>
  )
}

export default function Home(){
  const router = useRouter()
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [severityFilter, setSeverityFilter] = useState(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [selectedFinding, setSelectedFinding] = useState(null)
  const [copyStatus, setCopyStatus] = useState('')
  const reportRef = useRef(null)
  const patchedRef = useRef(null)
  const [justCompleted, setJustCompleted] = useState(false)
  const [showFullFile, setShowFullFile] = useState(false)
  const [fixLoading, setFixLoading] = useState(false)

  useEffect(() => {
    if (report) {
      setJustCompleted(true)
      // scroll the report into view and clear the completed flag after a moment
      setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
      const t = setTimeout(() => setJustCompleted(false), 2800)
      return () => clearTimeout(t)
    }
  }, [report])

  // highlight code when modal opens
  useEffect(()=>{
    if (selectedFinding && typeof window !== 'undefined' && window.Prism){
      setTimeout(()=>{ try{ window.Prism.highlightAll() }catch(e){} }, 30)
    }
  }, [selectedFinding])

  // highlight again when fix content arrives
  useEffect(()=>{
    if (selectedFinding && selectedFinding.fix && typeof window !== 'undefined' && window.Prism){
      setTimeout(()=>{ try{ window.Prism.highlightAll() }catch(e){} }, 40)
    }
  }, [selectedFinding?.fix])

  // when a fix arrives, scroll the modal to the patched code section if present
  useEffect(()=>{
    if (!selectedFinding || !selectedFinding.fix) return
    // wait a bit for the patched code element to render
    setTimeout(()=>{
      try{
        patchedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }catch(e){}
    }, 120)
  }, [selectedFinding?.fix])

  function toggleFilter(sev) {
    setSeverityFilter(prev => prev === sev ? null : sev)
  }

  function openFinding(finding){
    // If the finding lacks a line number, try to infer it from the loaded source
    try{
      const f = { ...finding }
      if ((!f.line || f.line === null) && report && report.source){
        const src = report.source || ''
        const lines = src.split(/\r?\n/)
        let needle = ''
        if (f.proof_of_concept) needle = String(f.proof_of_concept).split(/\r?\n/)[0]
        if (!needle && f.detail) needle = String(f.detail).slice(0, 140)
        if (!needle && f.description) needle = String(f.description).slice(0, 140)
        needle = (needle||'').trim()
        if (needle.length > 6){
          for (let i = 0; i < lines.length; i++){
            const hay = lines[i]
            if (!hay) continue
            if (hay.includes(needle) || hay.replace(/\s+/g,' ').includes(needle.replace(/\s+/g,' '))){
              f.line = i + 1
              break
            }
          }
        }
      }
      setSelectedFinding(f)
    }catch(e){
      setSelectedFinding(finding)
    }
    setShowFullFile(false)
  }

  // helper to compute a display line for a finding when LLM omitted it
  function getLineFor(v){
    if (typeof v.line === 'number' && !isNaN(v.line)) return v.line
    try{
      if (!report || !report.source) return '-'
      const src = report.source || ''
      const lines = src.split(/\r?\n/)
      let needle = ''
      if (v.proof_of_concept) needle = String(v.proof_of_concept).split(/\r?\n/)[0]
      if (!needle && v.detail) needle = String(v.detail).slice(0, 140)
      if (!needle && v.description) needle = String(v.description).slice(0, 140)
      needle = (needle||'').trim()
      if (needle.length > 6){
        for (let i = 0; i < lines.length; i++){
          const hay = lines[i]
          if (!hay) continue
          if (hay.includes(needle) || hay.replace(/\s+/g,' ').includes(needle.replace(/\s+/g,' '))){
            return i+1
          }
        }
        // fallback to fuzzy multi-line matching
        const fuzzy = fuzzyMatchPosition(needle, lines)
        if (fuzzy) return fuzzy
      }
    }catch(e){}
    return null
  }

  // get a small snippet (few lines) around the inferred line for compact table display
  function getSnippetFor(v, context=4){
    try{
      const src = report?.source || ''
      if (!src) return v.description || '-'
      const lines = src.split(/\r?\n/)
  const ln = Number(getLineFor(v))
  if (!ln || isNaN(ln)){
        // fallback: use first 4 lines of proof_of_concept or description
        if (v.proof_of_concept) return String(v.proof_of_concept).split(/\r?\n/).slice(0,4).join('\n')
        return (v.description||'').slice(0,140)
      }
      const start = Math.max(1, ln - context)
      const end = Math.min(lines.length, ln + context)
      return lines.slice(start-1, end).join('\n')
    }catch(e){ return v.description || '-' }
  }

  // Levenshtein distance (simple implementation)
  function levenshtein(a, b){
    if (!a.length) return b.length
    if (!b.length) return a.length
    const dp = Array.from({length: a.length + 1}, () => Array(b.length + 1).fill(0))
    for (let i=0;i<=a.length;i++) dp[i][0] = i
    for (let j=0;j<=b.length;j++) dp[0][j] = j
    for (let i=1;i<=a.length;i++){
      for (let j=1;j<=b.length;j++){
        const cost = a[i-1] === b[j-1] ? 0 : 1
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
      }
    }
    return dp[a.length][b.length]
  }

  // Attempt a fuzzy multi-line match: slide a window of up to 3 lines and compute normalized distance
  function fuzzyMatchPosition(needle, lines){
    const n = (needle||'').replace(/\s+/g,' ').trim().toLowerCase()
    if (!n) return null
    const maxWindow = 3
    let best = {score: Infinity, line: null}
    for (let i=0;i<lines.length;i++){
      for (let w=1; w<=maxWindow && i + w <= lines.length; w++){
        const segment = lines.slice(i, i + w).join(' ').replace(/\s+/g,' ').trim().toLowerCase()
        if (!segment) continue
        const d = levenshtein(n, segment)
        const norm = d / Math.max(1, Math.max(n.length, segment.length))
        if (norm < best.score){ best = { score: norm, line: i+1 } }
      }
    }
    // threshold: accept matches under 0.35 normalized distance
    return best.score < 0.35 ? best.line : null
  }

  // Call server endpoint to ask LLM for line numbers for missing findings
  async function resolveLinesWithLLM(sourceText, findings){
    try{
      const body = { source: sourceText, findings: findings.map(f=>({ id: f.id, description: f.description, detail: f.detail, proof_of_concept: f.proof_of_concept })) }
      const res = await fetch('/api/resolveLines', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      if (!res.ok) return null
      const json = await res.json()
      return json
    }catch(e){ return null }
  }
  function closeFinding(){
    setSelectedFinding(null)
  }

  // Find the enclosing Solidity block (function/constructor/contract/modifier/library/interface)
  function extractEnclosingBlock(lines, targetLine){
    // lines: array of strings, targetLine: 1-based
    const total = lines.length
    const t = Math.max(1, Number(targetLine) || 1)

    // find start: search upwards for a declaration keyword
    const declRe = /\b(function|constructor|modifier|contract|library|interface)\b/gi
    let start = null
    for (let i = t - 1; i >= 0; i--){
      const l = lines[i]
      if (declRe.test(l)){
        start = i + 1 // 1-based
        break
      }
    }
    if (!start){
      // fallback to a small window
      start = Math.max(1, t - 8)
    }

    // find end: attempt brace matching from start
    let depth = 0
    let foundOpen = false
    let end = null
    for (let j = start - 1; j < total; j++){
      const line = lines[j]
      for (let ch of line){
        if (ch === '{') { depth++; foundOpen = true }
        else if (ch === '}') { depth-- }
      }
      if (foundOpen && depth <= 0){
        end = j + 1 // 1-based
        break
      }
    }
    if (!end){
      // fallback to small window after target
      end = Math.min(total, t + 8)
    }

    const block = lines.slice(start-1, end).join('\n')
    return { start, end, block }
  }

  // small inline donut SVG component
  function Donut({ count = 0, total = 0, size = 36, stroke = 6, color = '#ef4444' }){
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const pct = total > 0 ? Math.max(0, Math.min(1, count / total)) : 0
    const dash = `${pct * c} ${c}`
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:'block'}}>
        <g transform={`translate(${size/2},${size/2})`}>
          <circle r={r} cx={0} cy={0} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={stroke} />
          <circle r={r} cx={0} cy={0} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash} transform="rotate(-90)" />
          <text x="0" y="4" textAnchor="middle" fontSize="9" fill="#111" fontWeight={700}>{total>0?Math.round(pct*100):0}%</text>
        </g>
      </svg>
    )
  }

  // small severity icons
  const Icon = ({ type, size = 20 }) => {
    if (type === 'total') return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L3 5v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V5l-9-3z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    if (type === 'critical') return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2s4 3 4 7a4 4 0 11-8 0c0-4 4-7 4-7z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 13v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    if (type === 'high') return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94A2 2 0 0022.18 18L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 9v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 17h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    // medium / low -> info
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <path d="M12 8v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.5 11h1v5h-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  async function handleSubmit(e){
    e.preventDefault()
    setError('')
    const fileInput = e.target.elements.file
    if (!fileInput.files.length){
      setError('Please pick a .sol file')
      return
    }
    const file = fileInput.files[0]
    setFileName(file.name)
    if (!file.name.endsWith('.sol')){
      setError('Please upload a .sol file')
      return
    }
    setLoading(true)
    setProgress(6)
    let progTimer = startProgressTimer(setProgress)

    try {
      const form = new FormData()
      form.append('file', file)
      // read the source file locally so we can show code snippets in the UI
      let fileText = ''
      try { fileText = await file.text() } catch (e) { fileText = '' }

      const res = await fetch('/api/analyze', { method: 'POST', body: form })
      const text = await res.text()
      if (!res.ok) {
        // surface raw server error
        setError(`API error: ${text}`)
        clearInterval(progTimer)
        setLoading(false)
        setProgress(0)
        return
      }

      let json
      try {
        json = JSON.parse(text)
      } catch (e) {
        setError('Failed to parse JSON from API. Raw response shown below.')
        setReport({ fileName: file.name, result: { raw: text, vulnerabilities: [] } })
        clearInterval(progTimer)
        setLoading(false)
        setProgress(0)
        return
      }

      // normalize LLM response into { metadata, vulnerabilities }
      function normalizeResult(parsed, filename){
        let vulnerabilities = []
        let metadata = {}
        try{
          if (!parsed) parsed = {}
          if (Array.isArray(parsed)) {
            vulnerabilities = parsed
          } else if (Array.isArray(parsed.vulnerabilities)) {
            vulnerabilities = parsed.vulnerabilities
            metadata = parsed.metadata || {}
          } else if (Array.isArray(parsed.result?.vulnerabilities)) {
            vulnerabilities = parsed.result.vulnerabilities
            metadata = parsed.result.metadata || parsed.metadata || {}
          } else if (parsed.vulnerability && !Array.isArray(parsed.vulnerability)) {
            vulnerabilities = [parsed.vulnerability]
          } else if (parsed.vulnerabilities && typeof parsed.vulnerabilities === 'object') {
            // sometimes it's an object keyed by id
            vulnerabilities = Object.values(parsed.vulnerabilities)
          } else {
            // fallback: try to find top-level array fields
            const keys = Object.keys(parsed)
            for (const k of keys){ if (Array.isArray(parsed[k])) { vulnerabilities = parsed[k]; break } }
          }
        }catch(e){ vulnerabilities = [] }

        metadata = metadata || {}
        metadata.file_name = metadata.file_name || filename || 'contract.sol'
        metadata.total_issues = metadata.total_issues || vulnerabilities.length || 0

        // ensure each vulnerability has expected fields and defaults
        vulnerabilities = (vulnerabilities || []).map((v, idx) => ({
          id: v?.id || v?.name || `V${idx+1}`,
          type: v?.type || v?.title || v?.name || 'Unknown',
          severity: (v?.severity || 'low').toLowerCase(),
          description: v?.description || v?.detail || v?.summary || '',
          detail: v?.detail || v?.explanation || '',
          line: (typeof v?.line === 'number') ? v.line : (v?.line || null),
          contract: v?.contract || null,
          function: v?.function || null,
          proof_of_concept: v?.proof_of_concept || v?.poc || null,
          recommendation: v?.recommendation || v?.remediation || '',
          references: Array.isArray(v?.references) ? v.references : (v?.references ? [v.references] : []),
        }))

        metadata.total_issues = (vulnerabilities || []).length
        return { metadata, vulnerabilities }
      }

      function fillMissingLinesForArray(vulns, sourceText){
        try{
          const src = sourceText || ''
          const lines = src.split(/\r?\n/)
          for (let v of vulns){
            if (!v.line || v.line === null){
              let needle = ''
              if (v.proof_of_concept) needle = String(v.proof_of_concept).split(/\r?\n/)[0]
              if (!needle && v.detail) needle = String(v.detail).slice(0, 120)
              if (!needle && v.description) needle = String(v.description).slice(0, 120)
              needle = (needle||'').trim()
              if (needle.length > 6){
                for (let i=0;i<lines.length;i++){
                  const hay = lines[i]
                  if (!hay) continue
                  if (hay.includes(needle) || hay.replace(/\s+/g,' ').includes(needle.replace(/\s+/g,' '))){
                    v.line = i+1
                    break
                  }
                }
              }
            }
          }
        }catch(e){}
      }

      const normalized = normalizeResult(json, file.name)
      try{ fillMissingLinesForArray(normalized.vulnerabilities || [], fileText) }catch(e){}
      // if some vulnerabilities still lack lines, ask server to try resolving them via LLM
      const missing = (normalized.vulnerabilities||[]).filter(v=>!v.line)
      if (missing.length > 0){
        try{
          const mappingRes = await resolveLinesWithLLM(fileText, missing)
          if (mappingRes && mappingRes.mapping){
            for (const v of normalized.vulnerabilities){
              const resolved = mappingRes.mapping[v.id]
              if (!v.line && resolved) v.line = resolved
            }
          }
        }catch(e){}
      }

      const payload = { fileName: file.name, result: normalized, source: fileText }
      sessionStorage.setItem('lastAnalysis', JSON.stringify(payload))
      setReport(payload)
      // stop progress and show completion
      setProgress(100)
      if (progTimer) clearInterval(progTimer)
      setLoading(false)
      // keep 100% visible a short moment, then hide
      setTimeout(() => setProgress(0), 700)
    } catch (err) {
      setError(err.message)
      setLoading(false)
      clearInterval(progTimer)
      setProgress(0)
    }
  }

  return (
    <div>
      <header style={{textAlign:'center', marginBottom:18}}>
        <div style={{maxWidth:900, margin:'0 auto'}}>
          <div style={{fontSize:28,fontWeight:800,color:'var(--text)'}}>Solidity Vulnerability Analyzer</div>
          <div style={{marginTop:8,color:'var(--muted)',fontSize:15}}>Secure your smart contracts with automated analysis and guided fixes — fast and actionable.</div>
          <div style={{marginTop:14}}>
            <button className="btn" onClick={()=>{ document.getElementById('file-input')?.scrollIntoView({behavior:'smooth', block:'center'}) }}>Upload & Analyze</button>
            <button className="btn-minimal" style={{marginLeft:8}}>Docs</button>
          </div>
          <div className="features">
            <div className="feature">
              <div className="icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="13 2 3 14 12 14 11 22 21 10 13 10 13 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <div className="title">Quick analysis</div>
                <div className="desc">Analyze a single Solidity file and get prioritized results.</div>
              </div>
            </div>
            <div className="feature">
              <div className="icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C9 5 6 6 6 9v3a6 6 0 0012 0V9c0-3-3-4-6-7z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <div className="title">AI-guided fixes</div>
                <div className="desc">Receive suggested patches and step-by-step guidance.</div>
              </div>
            </div>
            <div className="feature">
              <div className="icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <div className="title">Exporter</div>
                <div className="desc">Export findings to JSON or integrate with CI workflows.</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Upload card */}
      <div className="card" style={{marginTop:12, display:'flex', justifyContent:'center'}}>
        <div style={{width:'100%', maxWidth:720}}>
          <form onSubmit={handleSubmit}>
            <label className="upload-drop upload-card-creative" htmlFor="file-input" style={{cursor:'pointer', display:'block'}}>
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3v10" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 9l6-6 6 6" stroke="#06b6d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3" y="13" width="18" height="8" rx="2" stroke="#efefef" strokeWidth="1.2" fill="#f8fafc"/>
              </svg>
              <div className="title">Upload Solidity file</div>
              <div className="subtitle">Drag & drop or click to select a <strong>.sol</strong> file for quick analysis</div>
              <input id="file-input" type="file" name="file" accept=".sol" style={{display:'none'}} onChange={(e)=>{ setSelectedFileName(e.target.files[0]?.name || ''); }} />
              <div className="examples" aria-hidden>
                <div className="chip">contract.sol</div>
                <div className="chip">token.sol</div>
                <div className="chip">multisig.sol</div>
              </div>
              <div className="actions">
                <button className="btn" type="submit" disabled={loading}>{loading ? 'Analyzing...' : 'Upload & Analyze'}</button>
                {selectedFileName ? <div className="small" style={{marginLeft:8,color:'var(--muted)'}}>Selected: <strong>{selectedFileName}</strong></div> : null}
              </div>
            </label>
          </form>

            {error && (
              <div style={{marginTop:12, color:'#b91c1c', padding:10}} className="card panel">
                <strong>Error:</strong>
                <div style={{marginTop:6, fontSize:13, whiteSpace:'pre-wrap'}}>{error}</div>
              </div>
            )}

          {progress>0 && (
            <div style={{marginTop:12}}>
              <div className="progress-outer">
                <div className="progress-track">
                  <div className="progress-fill" style={{width:`${Math.min(100,progress)}%`}} />
                  <div className="progress-label">{Math.min(100,progress)}%</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report section */}
      {report && (
        <div style={{marginTop:20}} ref={reportRef}>
          {justCompleted && (
            <div style={{marginBottom:12, padding:10, borderRadius:8, background:'linear-gradient(90deg,#06b6d4,#7c3aed)'}}>
              <strong>Analysis complete</strong> — results shown below.
            </div>
          )}

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <h2 style={{margin:0}}>Report — {report.fileName}</h2>
              <div className="small">Issues found: <strong>{(report.result.vulnerabilities||[]).length}</strong></div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn" onClick={()=>{sessionStorage.removeItem('lastAnalysis'); setReport(null); setFileName('')}}>Clear</button>
              <button className="btn-minimal" onClick={()=>{
                const data = JSON.stringify(report.result, null, 2)
                const blob = new Blob([data], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = (report.fileName || 'report') + '.json'
                document.body.appendChild(a)
                a.click()
                setTimeout(()=>{
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }, 100)
              }}>Download Report</button>
              <button className="btn-minimal" onClick={()=>{
                const vulns = report.result.vulnerabilities || [];
                const severityCounts = {critical:0,high:0,medium:0,low:0};
                vulns.forEach(v=>{if(v.severity)severityCounts[v.severity]=(severityCounts[v.severity]||0)+1});
                const typeCounts = {};
                vulns.forEach(v=>{if(v.type)typeCounts[v.type]=(typeCounts[v.type]||0)+1});
                let html = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Solidity Vulnerability Report</title><script src='https://cdn.jsdelivr.net/npm/chart.js'></script><style>
                  body{font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#222;margin:0;padding:0;}
                  .container{max-width:900px;margin:32px auto;padding:24px;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,0.07);}
                  h1{font-size:2.2em;margin-bottom:0.2em;}
                  h2{margin-top:2em;}
                  table{width:100%;border-collapse:collapse;margin-top:18px;}
                  th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top;}
                  th{background:#f3f4f6;font-weight:600;}
                  .severity-pill{display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.95em;font-weight:600;color:#fff;margin-right:6px;}
                  .critical{background:#b91c1c;} .high{background:#f97316;} .medium{background:#facc15;color:#222;} .low{background:#60a5fa;}
                  .code-block{background:#f3f4f6;font-family:monospace;font-size:0.98em;padding:10px;border-radius:8px;white-space:pre-wrap;margin:8px 0;}
                  .patch-block{background:#e6ffed;font-family:monospace;font-size:0.98em;padding:10px;border-radius:8px;white-space:pre-wrap;margin:8px 0;}
                  .chart-bar{height:22px;border-radius:8px;display:inline-block;margin-right:8px;}
                  .chart-label{font-size:0.98em;margin-right:12px;}
                  .chart-container{display:flex;gap:32px;flex-wrap:wrap;align-items:center;margin-bottom:18px;}
                  .chart-box{background:#f3f4f6;padding:18px;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,0.04);}
                </style></head><body><div class='container'>
                <h1>Solidity Vulnerability Report</h1>
                <div><strong>File:</strong> ${(report.fileName||'contract.sol')}</div>
                <div><strong>Total Issues:</strong> ${vulns.length}</div>
                <h2>Charts</h2>
                <div class='chart-container'>
                  <div class='chart-box'><canvas id='severityPie' width='220' height='220'></canvas></div>
                  <div class='chart-box'><canvas id='typeBar' width='320' height='220'></canvas></div>
                </div>
                <script>
                  window.onload = function(){
                    new Chart(document.getElementById('severityPie').getContext('2d'), {
                      type: 'pie',
                      data: {
                        labels: ['Critical','High','Medium','Low'],
                        datasets: [{
                          data: [${severityCounts.critical},${severityCounts.high},${severityCounts.medium},${severityCounts.low}],
                          backgroundColor: ['#b91c1c','#f97316','#facc15','#60a5fa']
                        }]
                      },
                      options: {plugins:{legend:{position:'bottom'}}}
                    });
                    new Chart(document.getElementById('typeBar').getContext('2d'), {
                      type: 'bar',
                      data: {
                        labels: ${JSON.stringify(Object.keys(typeCounts))},
                        datasets: [{
                          label: 'Issue Count',
                          data: ${JSON.stringify(Object.values(typeCounts))},
                          backgroundColor: '#6366f1'
                        }]
                      },
                      options: {indexAxis:'y',plugins:{legend:{display:false}}}
                    });
                  }
                </script>
                <h2>Findings</h2>
                <table><thead><tr>
                  <th>#</th><th>Type</th><th>Severity</th><th>Description</th><th>Line</th><th>Contract</th><th>Function</th><th>References</th>
                </tr></thead><tbody>
                ${vulns.map((v,i)=>`
                  <tr>
                    <td>${i+1}</td>
                    <td>${v.type||''}</td>
                    <td><span class='severity-pill ${v.severity}'>${v.severity}</span></td>
                    <td>${v.description||''}</td>
                    <td>${v.line||''}</td>
                    <td>${v.contract||''}</td>
                    <td>${v.function||''}</td>
                    <td>${(v.references||[]).join(', ')}</td>
                  </tr>`).join('')}
                </tbody></table>
                ${vulns.map((v,i)=>`
                  <h3 style='margin-top:2.2em;'>${i+1}. [${v.severity?.toUpperCase()||''}] ${v.type||''}</h3>
                  <div><strong>Description:</strong> ${v.description||''}</div>
                  ${v.detail?`<div><strong>Detail:</strong> ${v.detail}</div>`:''}
                  ${v.recommendation?`<div><strong>Recommendation:</strong> ${v.recommendation}</div>`:''}
                  ${v.proof_of_concept?`<div><strong>Proof of Concept:</strong> ${v.proof_of_concept}</div>`:''}
                  ${v.line?`<div><strong>Line:</strong> ${v.line}</div>`:''}
                  ${v.contract?`<div><strong>Contract:</strong> ${v.contract}</div>`:''}
                  ${v.function?`<div><strong>Function:</strong> ${v.function}</div>`:''}
                  ${v.references&&v.references.length?`<div><strong>References:</strong> ${(v.references||[]).join(', ')}</div>`:''}
                  <div class='code-block'><strong>Vulnerable Code:</strong><br>${(() => {
                    if(report.source && v.line){
                      const lines = report.source.split(/\r?\n/);
                      const ln = Number(v.line);
                      const start = Math.max(1, ln-4);
                      const end = Math.min(lines.length, ln+4);
                      return lines.slice(start-1, end).join('<br>');
                    }
                    return '';
                  })()}</div>
                  ${(() => {
                    const patch = v.patched_code || (v.fix && v.fix.patched_code);
                    return patch
                      ? `<div class='patch-block'><strong>Patched Code:</strong><br>${patch.replace(/\n/g,'<br>')}</div>`
                      : `<div class='patch-block' style='background:#fffbe6;color:#b91c1c;'><strong>Patched Code:</strong><br><em>No patch available</em></div>`;
                  })()}
                `).join('')}
                </div></body></html>`;
                const blob = new Blob([html], {type:'text/html'});
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
                setTimeout(()=>URL.revokeObjectURL(url), 60000);
              }}>View Detailed HTML Report</button>
            </div>
          </div>

          <div style={{marginTop:12}}>
            <div>
              <div className="card panel">
                <h3>Summary</h3>
                <div className="summary-grid">
                  {(() => {
                    const items = []
                    const all = report.result.vulnerabilities || []
                    const total = all.length
                    const counts = {
                      critical: all.filter(v=>v.severity==='critical').length,
                      high: all.filter(v=>v.severity==='high').length,
                      medium: all.filter(v=>v.severity==='medium').length,
                      low: all.filter(v=>v.severity==='low').length,
                    }

                    items.push(
                      <div key="total" className={`summary-card summary-total ${severityFilter===null? 'active':''}`} onClick={()=>toggleFilter(null)} style={{cursor:'pointer'}}>
                        <div className="summary-icon"><Icon type="total" /></div>
                        <div>
                          <div className="summary-title">Total Issues</div>
                          <div className="summary-value">{total}</div>
                        </div>
                        <div style={{marginLeft:'auto'}}><Donut count={total} total={total} size={44} stroke={6} color="#0ea5e9" /></div>
                      </div>
                    )

                    items.push(
                      <div key="critical" className={`summary-card summary-critical ${severityFilter==='critical'? 'active':''}`} onClick={()=>toggleFilter('critical')} style={{cursor:'pointer'}}>
                        <div className="summary-icon" style={{color:'#b91c1c'}}><Icon type="critical" /></div>
                        <div>
                          <div className="summary-title">Critical</div>
                          <div className="summary-value">{counts.critical}</div>
                        </div>
                        <div style={{marginLeft:'auto'}}><Donut count={counts.critical} total={total} size={44} stroke={6} color="#ef4444" /></div>
                      </div>
                    )

                    items.push(
                      <div key="high" className={`summary-card summary-high ${severityFilter==='high'? 'active':''}`} onClick={()=>toggleFilter('high')} style={{cursor:'pointer'}}>
                        <div className="summary-icon" style={{color:'#f97316'}}><Icon type="high" /></div>
                        <div>
                          <div className="summary-title">High</div>
                          <div className="summary-value">{counts.high}</div>
                        </div>
                        <div style={{marginLeft:'auto'}}><Donut count={counts.high} total={total} size={44} stroke={6} color="#f97316" /></div>
                      </div>
                    )

                    items.push(
                      <div key="medium" className={`summary-card summary-medium ${severityFilter==='medium'? 'active':''}`} onClick={()=>toggleFilter('medium')} style={{cursor:'pointer'}}>
                        <div className="summary-icon" style={{color:'#facc15'}}><Icon type="info" /></div>
                        <div>
                          <div className="summary-title">Medium</div>
                          <div className="summary-value">{counts.medium}</div>
                        </div>
                        <div style={{marginLeft:'auto'}}><Donut count={counts.medium} total={total} size={44} stroke={6} color="#facc15" /></div>
                      </div>
                    )

                    items.push(
                      <div key="low" className={`summary-card summary-low ${severityFilter==='low'? 'active':''}`} onClick={()=>toggleFilter('low')} style={{cursor:'pointer'}}>
                        <div className="summary-icon" style={{color:'#60a5fa'}}><Icon type="info" /></div>
                        <div>
                          <div className="summary-title">Low</div>
                          <div className="summary-value">{counts.low}</div>
                        </div>
                        <div style={{marginLeft:'auto'}}><Donut count={counts.low} total={total} size={44} stroke={6} color="#60a5fa" /></div>
                      </div>
                    )

                    return items
                  })()}
                </div>
              </div>

              <div className="card" style={{marginTop:12}}>
                <h3>Findings</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>#</th>
                      <th>Type</th>
                      <th>Severity</th>
                      <th>Description</th>
                      <th>Line</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((report.result.vulnerabilities||[]).filter(v => !severityFilter || v.severity === severityFilter)).map((v,i)=> (
                      <tr key={i}>
                        <td style={{width:56}}>
                          <button className="icon-btn" onClick={()=>openFinding({ ...v, index:i })} aria-label={`View details for finding ${i+1}`}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.2"/></svg>
                          </button>
                        </td>
                        <td>{i+1}</td>
                        <td>{v.type}</td>
                        <td className={`severity-${v.severity}`}>{v.severity}</td>
                        <td style={{maxWidth:360}}>
                          <div style={{fontSize:13,whiteSpace:'pre-wrap',background:'rgba(0,0,0,0.02)',padding:8,borderRadius:6}}>
                            {v.description || '-'}
                          </div>
                        </td>
                          <td>
                            {(() => {
                              const ln = getLineFor(v)
                              if (ln) {
                                return (
                                  <button className="icon-btn" onClick={()=>openFinding({ ...v, index:i })} aria-label={`Open finding at line ${ln}`}>
                                    Line {ln}
                                  </button>
                                )
                              }
                              return '-'
                            })()}
                          </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {report.result && report.result.raw && (
                  <div style={{marginTop:12}} className="card panel">
                    <h4>Raw API response (parse failed)</h4>
                    <pre style={{whiteSpace:'pre-wrap',fontSize:12,background:'rgba(0,0,0,0.02)',padding:12,borderRadius:8}}>{report.result.raw}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {selectedFinding && report && (
        <div className="modal-overlay" onClick={closeFinding} role="dialog" aria-modal="true">
          <div className="modal" onClick={(e)=>e.stopPropagation()} role="dialog" aria-hidden="false">
              <div className="modal-header">
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div className={`modal-badge badge-${selectedFinding.severity || 'low'}`} aria-hidden="true">
                    <SeverityIcon severity={selectedFinding.severity} />
                  </div>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div className="modal-title">{selectedFinding.type}</div>
                      <div className={`severity-pill ${selectedFinding.severity || 'low'}`}>{(selectedFinding.severity||'').toUpperCase()}</div>
                    </div>
                    <div className="modal-subtitle">Line: {selectedFinding.line || getLineFor(selectedFinding) || '-'}</div>
                  </div>
                </div>
                <div>
                  <button className="close-btn" onClick={closeFinding} aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                </div>
              </div>

            <div style={{marginBottom:12}}>
              <strong>Description</strong>
              <div style={{marginTop:6}}>{selectedFinding.description}</div>
            </div>

            {selectedFinding.recommendation && (
              <div style={{marginBottom:12}}>
                <strong>Recommendation</strong>
                <div style={{marginTop:6}}>{selectedFinding.recommendation}</div>
              </div>
            )}

            <div>
              {(() => {
                const lines = (report.source||'').split(/\r?\n/)
                const target = Math.max(1, Number(selectedFinding.line) || 1)
                const { start, end, block } = extractEnclosingBlock(lines, target)
                const snippetText = block
                return (
                  <div>
                    <strong>Vulnerable code block</strong>
                    <div style={{marginTop:8}}>
                      <CodeHighlighter code={snippetText} startLine={start} highlightLine={target} expandedProp={true} showLineCopyButtons={false} showFull={true} />
                    </div>
                  </div>
                )
              })()}
            </div>

            <div style={{marginTop:12}}>
              <div className="modal-footer">
                <div className="note">Click <strong>Get Fix</strong> to request a suggested patch from the assistant.</div>
                <div className="actions">
                  <button className="btn-minimal" aria-label="Get fix for this finding" disabled={fixLoading} onClick={async ()=>{
                    setFixLoading(true)
                    try{
                      const lines = (report.source||'').split(/\r?\n/)
                      const target = Math.max(1, Number(selectedFinding.line) || 1)
                      const { start, end, block } = extractEnclosingBlock(lines, target)
                      const snippetText = block
                      const res = await fetch('/api/fix', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ vulnerability: selectedFinding, snippet: snippetText, snippet_start: start }) })
                      const json = await res.json()
                      const fixObj = json && json.fix ? json.fix : json
                      const primaryLine = fixObj?.primary_line || (Array.isArray(fixObj?.line_numbers) && fixObj.line_numbers[0])
                      setSelectedFinding(prev => ({ ...prev, fix: fixObj, snippet_start: start, line: prev.line || primaryLine }))
                    }catch(e){
                      setSelectedFinding(prev => ({ ...prev, fix: { error: e.message } }))
                    } finally {
                      setFixLoading(false)
                    }
                  }}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 21l4.35-4.35M14.5 9.5l6-6M10.5 4.5l9 9M7 14l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {fixLoading ? <span className="btn-spinner" aria-hidden="true" /> : <span>Get Fix</span>}
                  </button>
                </div>
              </div>
            </div>

                {selectedFinding.fix && (
              <div style={{marginTop:14}}>
                {selectedFinding.fix.error && <div style={{color:'#b91c1c'}}>{selectedFinding.fix.error}</div>}
                {selectedFinding.fix.raw && (
                  <div style={{marginTop:8}} className="card panel">
                    <h4>LLM raw response</h4>
                    <pre style={{whiteSpace:'pre-wrap',fontSize:12,background:'rgba(0,0,0,0.02)',padding:12,borderRadius:8}}>{selectedFinding.fix.raw}</pre>
                  </div>
                )}
                {selectedFinding.fix && selectedFinding.fix.patched_code && (
                  <div>
                    <h4>Fix — {selectedFinding.fix.summary}</h4>
                    <div style={{marginBottom:8}}>
                      <strong>Steps</strong>
                      <ol>
                        {(selectedFinding.fix.steps||[]).map((s,idx)=> <li key={idx}>{s}</li>)}
                      </ol>
                    </div>

                    <div>
                      <strong>Vulnerable vs Patched</strong>
                      <div style={{display:'flex',gap:12,marginTop:8}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,marginBottom:6,color:'var(--muted)'}}>Original vulnerable block</div>
                          <div className="card panel" style={{padding:10}}>
                            <CodeHighlighter code={(() => {
                              const lines = (report.source||'').split(/\r?\n/)
                              const target = Math.max(1, Number(selectedFinding.line) || 1)
                              const { start, end, block } = extractEnclosingBlock(lines, target)
                              return block
                            })()} startLine={selectedFinding.snippet_start || ((()=>{ const lines=(report.source||'').split(/\r?\n/); const target=Math.max(1, Number(selectedFinding.line)||1); return extractEnclosingBlock(lines,target).start })())} highlightLine={Math.max(1, Number(selectedFinding.line)||1)} showLineCopyButtons={false} expandedProp={true} showFull={true} />
                          </div>
                        </div>

                        <div style={{flex:1}}>
                          <div style={{fontSize:13,marginBottom:6,color:'var(--muted)'}}>Patched code (secure fix for that block)</div>
                          <div className="card panel" style={{padding:10}} ref={patchedRef}>
                            <CodeHighlighter code={selectedFinding.fix.patched_code} startLine={selectedFinding.snippet_start || ((()=>{ const lines=(report.source||'').split(/\r?\n/); const target=Math.max(1, Number(selectedFinding.line)||1); return extractEnclosingBlock(lines,target).start })())} highlightLine={Math.max(1, Number(selectedFinding.line)||1)} showLineCopyButtons={false} copyPatchedOnly={true} expandedProp={true} showFull={true} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Simulate a progress bar that moves quickly at first then slows down.
function startProgressTimer(setProgress) {
  let p = 6
  setProgress(p)
  const id = setInterval(() => {
    const step = p < 40 ? Math.random() * 6 + 3 : p < 80 ? Math.random() * 2 + 0.5 : Math.random() * 0.6
    p = Math.min(98, p + step)
    setProgress(Math.floor(p))
  }, 600)
  return id
}
