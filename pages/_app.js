import '../styles/globals.css'
import 'prismjs/themes/prism-tomorrow.css'
import Prism from 'prismjs'
// load solidity language and plugins
import 'prismjs/components/prism-solidity'
import 'prismjs/plugins/line-numbers/prism-line-numbers'
import 'prismjs/plugins/line-highlight/prism-line-highlight'
import 'prismjs/plugins/line-numbers/prism-line-numbers.css'
import 'prismjs/plugins/line-highlight/prism-line-highlight.css'
import { useEffect } from 'react'

export default function MyApp({ Component, pageProps }){
  useEffect(()=>{ if (typeof window !== 'undefined') window.Prism = Prism }, [])
  return (
    <div className="container">
      <Component {...pageProps} Prism={Prism} />
    </div>
  )
}
