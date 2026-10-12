// The ownership key is public; keep it stable across deployments.
const site = new URL('https://www.yigalaxy.xin')
const key = 'd4912ba7f85d4b24b5f09d69341c28a6'
const keyLocation = new URL(`/${key}.txt`, site).href
const submit = process.argv.includes('--submit')

async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

function decodeXml(value) {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  })[name])
}

async function main() {
  const xml = await getText(new URL('/sitemap.xml', site))
  if (!xml.includes('<urlset')) throw new Error('Expected a sitemap urlset')
  const urls = [...new Set([...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)]
    .map(match => new URL(decodeXml(match[1].trim())).href))]
  if (!urls.length || urls.some(url => new URL(url).origin !== site.origin)) {
    throw new Error('Sitemap must contain URLs on the canonical HTTPS site')
  }
  if ((await getText(keyLocation)).trim() !== key) throw new Error('Ownership key does not match')
  console.log(JSON.stringify({ mode: submit ? 'submit' : 'preview', host: site.host, urls }, null, 2))
  if (!submit) return

  for (let offset = 0; offset < urls.length; offset += 10000) {
    const urlList = urls.slice(offset, offset + 10000)
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: site.host, key, keyLocation, urlList }),
      signal: AbortSignal.timeout(30000),
    })
    const body = (await response.text()).slice(0, 1000)
    console.log(JSON.stringify({ status: response.status, submitted: urlList.length, body }))
    if (![200, 202].includes(response.status)) throw new Error(`IndexNow rejected submission: ${response.status}`)
  }
  console.log('IndexNow received the URLs. This does not confirm indexing or ranking.')
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
