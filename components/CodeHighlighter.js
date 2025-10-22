import { useEffect, useRef, useState } from 'react'
import Prism from 'prismjs'

export default function CodeHighlighter({ code = '', startLine = 1, highlightLine = null, showFull=false, onCopyLine = null, language = 'solidity', showLineCopyButtons = true, copyFull = false, copyPatchedOnly = false, expandedProp, onToggleExpand }){
  const codeRef = useRef(null)
  const scrollRef = useRef(null)
  const [expanded, setExpanded] = useState(showFull)
  const [toast, setToast] = useState(null)
  const [linesHtml, setLinesHtml] = useState([])

  const allLines = (code || '').split(/\r?\n/)
  const total = allLines.length

  // compute displayed window
  let dispStart = Number(startLine) || 1
  if (!expanded){
    if (highlightLine){
      dispStart = Math.max(1, Number(highlightLine) - 8)
    } else {
      dispStart = 1
    }
  } else {
    dispStart = 1
  }

  const dispEnd = expanded ? total : Math.min(total, dispStart + (expanded ? total : 16))
  const displayLines = allLines.slice(dispStart - 1, dispEnd)

  useEffect(()=>{
    // produce per-line highlighted HTML using Prism (or fallback escape)
    const text = displayLines.join('\n')
    let highlighted = ''
    try{
      if (window.Prism && window.Prism.languages && window.Prism.languages[language]){
        highlighted = window.Prism.highlight(text, window.Prism.languages[language], language)
      } else if (window.Prism && window.Prism.highlight){
        highlighted = window.Prism.highlight(text, window.Prism.languages.javascript, language)
      } else {
        highlighted = escapeHtml(text)
      }
    }catch(e){ highlighted = escapeHtml(text) }
    setLinesHtml(highlighted.split('\n'))
  }, [code, dispStart, expanded, language])

  useEffect(()=>{
    // when highlightLine changes, scroll it into view inside the scroll container
    if (!scrollRef.current) return
    if (!highlightLine) return
    const target = Number(highlightLine)
    if (isNaN(target)) return
    // find the child element with data-line
    const el = scrollRef.current.querySelector(`[data-line="${target}"]`)
    if (el){
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // flash background briefly
      el.classList.add('flash-highlight')
      setTimeout(()=> el.classList.remove('flash-highlight'), 900)
    }
  }, [highlightLine, displayLines.join('\n')])

  function copyLine(lineText, ln){
    try{
      navigator.clipboard.writeText(lineText)
      setToast(`Copied line ${ln}`)
      if (onCopyLine) onCopyLine(lineText, ln)
      setTimeout(()=>setToast(null), 1600)
    }catch(e){
      setToast('Copy failed')
      setTimeout(()=>setToast(null), 1600)
    }
  }

  // copy all visible code
  async function copyAll(){
    try{
      // If caller wants to copy only the patched snippet, prefer the provided `code` value
      if (copyPatchedOnly) {
        await navigator.clipboard.writeText(code || '')
        setToast('Copied patched code')
      } else {
        // if caller requests full copy (copyFull) always copy full `code`, otherwise use expanded/showFull logic
        const payload = copyFull ? (code || '') : ((expanded || showFull) ? (code || '') : displayLines.join('\n'))
        await navigator.clipboard.writeText(payload)
        setToast(copyFull || expanded || showFull ? 'Copied full code' : 'Copied visible code')
      }
      setTimeout(()=>setToast(null),1600)
    }catch(e){
      setToast('Copy failed')
      setTimeout(()=>setToast(null),1600)
    }
  }

  function escapeHtml(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  // sync controlled expanded prop if provided
  useEffect(()=>{
    if (typeof expandedProp !== 'undefined') setExpanded(Boolean(expandedProp))
  }, [expandedProp])

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,marginBottom:8}}>
          <div style={{display:'flex',gap:8}}>
          <button className="icon-btn" title={expanded? 'Collapse snippet':'Show full file'} onClick={()=>{ if (onToggleExpand) return onToggleExpand(); setExpanded(x=>!x) }}>
            {expanded ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </button>

          <button className="icon-btn" title="Copy full patched code" onClick={copyAll}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/></svg>
          </button>
        </div>
      </div>

      <div className="code-scroll" ref={scrollRef} style={{position:'relative'}}>
        <div style={{display:'flex'}}>
          <div style={{width:56,padding:'6px 8px',textAlign:'right',borderRight:'1px solid rgba(15,23,42,0.03)'}}>
            {Array.from({length: displayLines.length}).map((_,i)=>{
              const ln = dispStart + i
              // attach data-line to the number column so scrolling can target lines even when copy buttons are hidden
              return <div key={ln} data-line={ln} style={{height:20,lineHeight:'20px',fontSize:12,color:'var(--muted)'}}>{ln}</div>
            })}
          </div>

          <div style={{flex:1}}>
            <div style={{margin:0}}>
              {displayLines.map((lnText,i)=>{
                const ln = dispStart + i
                const isHighlighted = highlightLine && Number(highlightLine) === ln
                const html = linesHtml[i] || escapeHtml(lnText)
                return (
                  <div key={ln} data-line={ln} className={`code-line ${isHighlighted? 'highlight':''}`} dangerouslySetInnerHTML={{ __html: html }} />
                )
              })}
            </div>
          </div>

          {showLineCopyButtons && (
            <div style={{width:64,padding:'6px 8px',borderLeft:'1px solid rgba(15,23,42,0.02)'}}>
              {displayLines.map((ln,i)=>{
                const lineNumber = dispStart + i
                const isHighlighted = highlightLine && Number(highlightLine) === lineNumber
                return (
                  <div key={lineNumber} data-line={lineNumber} style={{height:20,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <button className="icon-btn" title={`Copy line ${lineNumber}`} onClick={()=>copyLine(displayLines[i], lineNumber)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/></svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {toast && (
          <div style={{position:'absolute',right:12,top:8,background:'rgba(0,0,0,0.75)',color:'#fff',padding:'6px 10px',borderRadius:8,fontSize:13}}>{toast}</div>
        )}
      </div>
    </div>
  )
}
