#!/usr/bin/env python3
"""Validate a static site's sitemap, rendered metadata and crawlable links."""
import json
import sys
from collections import deque
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
from xml.etree import ElementTree


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.titles, self.h1s, self.canonicals, self.links, self.ids = [], [], [], [], set()
        self.meta, self.schemas = {}, []
        self.active, self.buffer, self.ld = None, [], False
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'meta':
            self.meta.setdefault(attrs.get('name', attrs.get('property')), []).append(attrs.get('content', ''))
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs.get('href'))
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag in ('title', 'h1') or (tag == 'script' and attrs.get('type') == 'application/ld+json'):
            self.active, self.buffer = tag, []
            self.ld = tag == 'script'

    def handle_data(self, data):
        if self.active:
            self.buffer.append(data)

    def handle_endtag(self, tag):
        if tag != self.active:
            return
        value = ''.join(self.buffer).strip()
        if tag == 'title':
            self.titles.append(value)
        elif tag == 'h1':
            self.h1s.append(value)
        elif self.ld:
            self.schemas.append(json.loads(value))
        self.active, self.buffer, self.ld = None, [], False


def main():
    root = Path(sys.argv[1]).resolve()
    origin = sys.argv[2].rstrip('/')
    sitemap = ElementTree.parse(root / 'sitemap.xml')
    urls = [el.text for el in sitemap.iter() if el.tag == '{http://www.sitemaps.org/schemas/sitemap/0.9}loc']
    assert urls and len(set(urls)) == len(urls), 'Empty or duplicate sitemap'
    errors, pages = [], {}
    redirect_file = root / '_redirects'
    redirects = {}
    if redirect_file.is_file():
        for line in redirect_file.read_text().splitlines():
            parts = line.split()
            if len(parts) >= 2 and not parts[0].startswith('#'):
                redirects[parts[0]] = parts[1]

    def key(url):
        return urlsplit(url).path.rstrip('/') or '/'

    def file_for(url):
        path = root / unquote(urlsplit(url).path).lstrip('/')
        assert path.resolve().is_relative_to(root), 'URL escapes export root'
        for candidate in (path, Path(str(path) + '.html'), path / 'index.html'):
            if candidate.is_file():
                return candidate
        return None

    def valid_link(url):
        seen = set()
        while url not in seen:
            seen.add(url)
            if urlsplit(url).netloc != urlsplit(origin).netloc:
                return urlsplit(url).scheme in ('http', 'https')
            if file_for(url) is not None:
                return True
            target = redirects.get(urlsplit(url).path)
            if not target:
                return False
            url = urljoin(origin, target)
        return False

    def check(ok, url, message):
        if not ok:
            errors.append(f'{url}: {message}')

    for url in urls:
        check(urlsplit(url).netloc == urlsplit(origin).netloc and urlsplit(url).scheme == 'https', url, 'wrong sitemap origin')
        file = file_for(url)
        if not file:
            errors.append(f'{url}: missing exported page')
            continue
        page = Page(file.read_text())
        pages[key(url)] = page
        check(len(page.titles) == 1 and bool(page.titles[0]), url, 'expected one nonempty title')
        check(len(page.h1s) == 1 and bool(page.h1s[0]), url, 'expected one nonempty H1')
        check(page.canonicals == [url], url, f'canonical mismatch: {page.canonicals}')
        for name in ('description', 'og:title', 'og:description', 'og:url', 'og:image', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:card'):
            check(len(page.meta.get(name, [])) == 1 and bool(page.meta.get(name, [''])[0]), url, 'missing/duplicate ' + name)
        check(page.meta.get('og:url') == [url], url, 'og:url mismatch')
        check(page.meta.get('og:title') == page.titles == page.meta.get('twitter:title'), url, 'social title mismatch')
        check(page.meta.get('description') == page.meta.get('og:description') == page.meta.get('twitter:description'), url, 'social description mismatch')
        check(not any('noindex' in r for r in page.meta.get('robots', [])), url, 'noindex page in sitemap')
        for image in page.meta.get('og:image', []) + page.meta.get('twitter:image', []):
            check(image.startswith(origin + '/') and file_for(image) is not None, url, 'missing/nonabsolute social image')

    for field in ('titles',):
        values = [getattr(p, field)[0] for p in pages.values() if getattr(p, field)]
        check(len(values) == len(set(values)), origin, 'duplicate page titles')
    descriptions = [p.meta.get('description', [''])[0] for p in pages.values()]
    check(len(descriptions) == len(set(descriptions)), origin, 'duplicate descriptions')
    graph = {}
    for path, page in pages.items():
        graph[path] = set()
        for href in page.links:
            url = urljoin(origin + (path if path != '/' else '/'), href)
            if urlsplit(url).netloc != urlsplit(origin).netloc or urlsplit(url).scheme not in ('http', 'https'):
                continue
            check(valid_link(url), path, 'broken internal link ' + href)
            if key(url) in pages:
                graph[path].add(key(url))
    depth, queue = {'/': 0}, deque(['/'])
    while queue:
        path = queue.popleft()
        for target in graph.get(path, set()) - depth.keys():
            depth[target] = depth[path] + 1
            queue.append(target)
    check(not (pages.keys() - depth.keys()), origin, 'unreachable sitemap pages: ' + ', '.join(pages.keys() - depth.keys()))
    robots = (root / 'robots.txt').read_text()
    check(origin + '/sitemap.xml' in robots, origin, 'robots sitemap mismatch')
    assert not errors, '\n'.join(errors)
    print(f'SEO PASS: {len(pages)} sitemap pages; unique titles/descriptions, H1, canonical, OG/Twitter, images, JSON-LD and internal links; maximum click depth {max(depth.values())}.')


if __name__ == '__main__':
    main()
