const fetch = require('node-fetch');
(async()=>{
  const res = await fetch('http://localhost:3000/api/fix', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ vulnerability: {type:'Reentrancy', severity:'critical', description:'reentrancy in withdraw', line:12, function:'withdraw'}, snippet: 'function withdraw() { if (balance[msg.sender] > 0) { (bool ok,) = msg.sender.call{value: balance[msg.sender]}(""); balance[msg.sender] = 0; } }' })});
  const text = await res.text();
  console.log('STATUS', res.status);
  console.log(text);
})();