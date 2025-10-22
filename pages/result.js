import { useEffect, useState } from 'react'

export default function Result(){
  const [data, setData] = useState(null)

  useEffect(()=>{
    const raw = sessionStorage.getItem('lastAnalysis')
    if (raw) setData(JSON.parse(raw))
  },[])

  if (!data) return (
    <div className="card">
      <h2>No recent analysis</h2>
      <div className="small">Run an analysis from the homepage to see details here.</div>
    </div>
  )

  const { fileName, result } = data
  const vulns = result.vulnerabilities || []

  return (
    <div>
      <h1>Analysis report — {fileName}</h1>
      <div className="dashboard-grid">
        <div>
          <div className="card panel">
            <h3>Summary</h3>
            <div className="small">Total issues: <strong>{vulns.length}</strong></div>
            <div style={{display:'flex',gap:12,marginTop:12}}>
              <div className="panel" style={{flex:1}}>
                <div className="small">Critical</div>
                <div style={{fontSize:24,color:'#ff7b7b'}}>{vulns.filter(v=>v.severity==='critical').length}</div>
              </div>
              <div className="panel" style={{flex:1}}>
                <div className="small">High</div>
                <div style={{fontSize:24,color:'#ffb4a2'}}>{vulns.filter(v=>v.severity==='high').length}</div>
              </div>
              <div className="panel" style={{flex:1}}>
                <div className="small">Medium</div>
                <div style={{fontSize:24,color:'#ffd08a'}}>{vulns.filter(v=>v.severity==='medium').length}</div>
              </div>
            </div>
          </div>

          <div className="card" style={{marginTop:12}}>
            <h3>Findings</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Description</th>
                  <th>Line</th>
                </tr>
              </thead>
              <tbody>
                {vulns.map((v,i)=> (
                  <tr key={i}>
                    <td>{i+1}</td>
                    <td>{v.type}</td>
                    <td className={`severity-${v.severity}`}>{v.severity}</td>
                    <td style={{maxWidth:600}}>{v.description}</td>
                    <td>{v.line || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card panel">
            <h4>Selected finding</h4>
            <div className="small">Click a finding to view more detail (not implemented yet).</div>
          </div>
        </div>
      </div>
    </div>
  )
}
