const fs = require('fs')
const http = require('http')
const FormData = require('form-data')

const fd = new FormData()
fd.append('file', fs.createReadStream('examples/Simple.sol'))

const opts = {
  method: 'post',
  host: 'localhost',
  port: 3000,
  path: '/api/analyze',
  headers: fd.getHeaders(),
}

const req = http.request(opts, (res) => {
  let b = ''
  res.on('data', (d) => (b += d))
  res.on('end', () => {
    console.log('STATUS', res.statusCode)
    try {
      console.log(JSON.stringify(JSON.parse(b), null, 2))
    } catch (e) {
      console.log('RAW RESPONSE:\n', b)
    }
  })
})

fd.pipe(req)
req.on('error', (e) => console.error(e))
