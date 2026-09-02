// Static file server for the Next.js static export in `out/`.
// `next start` cannot serve an `output: "export"` build, so production runs this
// dependency-free server instead. Mirrors the export layout: `trailingSlash: true`
// means every route is a directory containing `index.html`.
import { createServer } from "node:http"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("./out", import.meta.url)))
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? "0.0.0.0"

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
}

/** Resolve a URL pathname to a readable file inside `out/`, or null. */
async function resolveFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "")
  const target = resolve(join(root, safe))
  if (target !== root && !target.startsWith(root + sep)) return null

  const candidates = extname(target)
    ? [target]
    : [join(target, "index.html"), `${target}.html`]

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return { path: candidate, size: info.size }
    } catch {}
  }
  return null
}

function send(res, status, file) {
  const type = MIME[extname(file.path).toLowerCase()] ?? "application/octet-stream"
  const immutable = file.path.includes(`${sep}_next${sep}static${sep}`)
  res.writeHead(status, {
    "content-type": type,
    "content-length": file.size,
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  })
  createReadStream(file.path).pipe(res)
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end("Method Not Allowed")
      return
    }
    const pathname = new URL(req.url, "http://localhost").pathname
    const file = await resolveFile(pathname)
    if (file) {
      send(res, 200, file)
      return
    }
    const notFound = await resolveFile("/404.html")
    if (notFound) {
      send(res, 404, notFound)
      return
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found")
  } catch (error) {
    console.error(error)
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Internal Server Error")
  }
})

server.listen(port, host, () => {
  console.log(`landing: serving ${root} on http://${host}:${port}`)
})
