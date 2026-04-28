"""Same-origin proxy for the upstream SF book + jsCoq IDE.

The chapter pages we use are at coq.vercel.app/ext/sf/<vol>/full/<chapter>.html.
Embedding that as a cross-origin iframe means our React code can't read
the IDE's contents (browser same-origin policy), so grading needed an
awkward "Ctrl+A, Ctrl+C, click Submit" clipboard hop.

This router serves the same content through our origin so the iframe
becomes same-origin with the parent. We then read the editor DOM
directly. Two routes:

  GET /sfproxy/chapter/{vol}/{chapter}.html
      Pulls the upstream HTML and injects a <base href> pointing at the
      upstream chapter directory, so all relative asset URLs (CSS, JS,
      fonts, images) still load from coq.vercel.app — no need to proxy
      every asset.

  GET /wa/{path:path}
      Proxies the wacoq runtime. Upstream's `common/jscoq.js` does
      `import { JsCoq } from '/wa/node_modules/wacoq/jscoq.js'`, which
      resolves against the document's origin (us), not the JS file's
      origin. Without this route those imports 404. Submodules of
      wacoq use relative paths and resolve correctly against our
      proxied URL.

For SharedArrayBuffer to keep working in the iframe (wacoq needs it),
we set COOP=same-origin + COEP=credentialless on the chapter response,
matching the parent. Credentialless lets the iframe load cross-origin
assets without those needing CORP headers — important because upstream
doesn't send CORP.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter()

UPSTREAM = "https://coq.vercel.app"

# Reuse a single async client across requests for connection pooling.
# `follow_redirects=True` because upstream sometimes 301s asset paths.
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=UPSTREAM,
            follow_redirects=True,
            timeout=httpx.Timeout(30.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


# Headers we forward from upstream to the client. Note: NOT
# cache-control — we override that with no-store below so a bad
# response (e.g. during a deploy mid-rollout) can't get pinned in the
# browser's disk cache for an hour.
_FORWARD_RESPONSE_HEADERS = {
    "content-type",
    "content-length",
    "content-encoding",
    "etag",
    "last-modified",
}

# Headers we drop from the client's request before forwarding upstream
# (Host etc. would confuse Vercel; cookies + auth aren't relevant).
_DROP_REQUEST_HEADERS = {
    "host",
    "cookie",
    "authorization",
    "content-length",
    "connection",
    "transfer-encoding",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-real-ip",
}


def _isolation_headers() -> dict[str, str]:
    """Headers required for SharedArrayBuffer in the iframe context.

    `credentialless` lets the iframe load coq.vercel.app's assets
    without each asset needing a CORP header, which upstream doesn't
    send. The parent already uses credentialless too — they have to
    match for the iframe to be cross-origin-isolated.
    """
    return {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cross-Origin-Resource-Policy": "cross-origin",
        # Don't let the browser hold on to stale proxy responses across
        # deploys. The proxy is cheap — an extra request per page load
        # is fine compared to debugging "why does it still look broken
        # after I fixed it 20 minutes ago".
        "Cache-Control": "no-store, must-revalidate",
    }


def _filter_response_headers(upstream_headers: httpx.Headers) -> dict[str, str]:
    """Pick the headers we want to forward, lowercasing keys so the
    caller can `pop("content-encoding", None)` without worrying about
    whatever case the upstream server used (Vercel sends
    `Content-Encoding`, plain dicts are case-sensitive)."""
    out: dict[str, str] = {}
    for k, v in upstream_headers.items():
        kl = k.lower()
        if kl in _FORWARD_RESPONSE_HEADERS:
            out[kl] = v
    out.update(_isolation_headers())
    return out


def _filter_request_headers(req: Request) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in req.headers.items():
        kl = k.lower()
        if kl in _DROP_REQUEST_HEADERS:
            continue
        if kl == "accept-encoding":
            # Only ask for compressions httpx can decode out of the
            # box. The browser's default `gzip, deflate, br, zstd`
            # would otherwise have upstream send brotli, which httpx
            # 0.28 leaves un-decoded — `upstream.text` then returns
            # raw brotli bytes interpreted as latin-1 and our HTML
            # rewrite breaks subtly (no <head> match, fallback
            # prepends <base> to garbage).
            v = "gzip, deflate"
        out[k] = v
    return out


async def _stream_proxy(upstream_path: str, request: Request) -> StreamingResponse:
    """Stream a single upstream resource through our origin.

    Used by /wa/* and /sfproxy/asset/*. We pass through the raw bytes
    (no body rewriting) so large WASM files don't sit in memory and
    so binary content isn't accidentally re-encoded."""
    client = _get_client()
    try:
        req = client.build_request("GET", upstream_path, headers=_filter_request_headers(request))
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        logger.warning("sfproxy: upstream fetch failed for %s: %s", upstream_path, e)
        raise HTTPException(status_code=502, detail=f"Upstream fetch failed: {e}")

    headers = _filter_response_headers(upstream.headers)

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=headers,
        media_type=upstream.headers.get("content-type"),
    )


@router.get("/sfproxy/chapter/{volume_id}/{chapter_name}.html")
async def chapter_html(volume_id: str, chapter_name: str, request: Request):
    """Serve the upstream chapter HTML with <base href> pointing at
    our asset proxy so every relative URL stays at our origin.

    Critical for wacoq: when its JS modules are loaded same-origin,
    `import.meta.url` is at our origin, and the runtime's URL
    construction (workers, .symb.json fetches, etc.) all resolve
    against us — which means they go through `/wa/` and we control
    CORS / Worker-script-origin restrictions."""
    upstream_path = f"/ext/sf/{volume_id}/full/{chapter_name}.html"
    client = _get_client()

    try:
        upstream = await client.get(upstream_path, headers=_filter_request_headers(request))
    except httpx.HTTPError as e:
        logger.warning("sfproxy: upstream fetch failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Upstream fetch failed: {e}")

    if upstream.status_code != 200:
        logger.info("sfproxy: upstream returned %s for %s", upstream.status_code, upstream_path)
        return Response(
            content=upstream.text,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "text/html"),
            headers=_isolation_headers(),
        )

    html = upstream.text
    # Point the base at our asset proxy so common/jscoq.js, CSS, etc.
    # all load through us — this is what makes wacoq's
    # import.meta.url-based URL construction stay same-origin.
    base_url = f"/sfproxy/asset/{volume_id}/"
    base_tag = f'<base href="{base_url}" />'
    if "<head>" in html:
        html = html.replace("<head>", f"<head>\n{base_tag}", 1)
    elif "<HEAD>" in html:
        html = html.replace("<HEAD>", f"<HEAD>\n{base_tag}", 1)
    else:
        html = base_tag + html

    headers = _filter_response_headers(upstream.headers)
    headers.pop("content-length", None)
    headers.pop("content-encoding", None)
    return Response(content=html, media_type="text/html; charset=utf-8", headers=headers)


@router.get("/sfproxy/asset/{volume_id}/{path:path}")
async def chapter_asset(volume_id: str, path: str, request: Request):
    """Proxy any chapter-relative asset (CSS, JS, fonts, images, etc.)
    so every URL resolved via the chapter's <base href> stays at our
    origin. The browser treats wacoq's JS modules as same-origin code,
    which means `new Worker(...)` and CORS-restricted fetches work."""
    return await _stream_proxy(f"/ext/sf/{volume_id}/full/{path}", request)


@router.get("/wa/{path:path}")
async def wacoq_runtime(path: str, request: Request):
    """Proxy /wa/*. wacoq's modules use absolute /wa/... paths that
    resolve against our origin once the chapter doc is same-origin;
    without this, wacoq's package fetches and worker construction
    can't find their resources."""
    return await _stream_proxy(f"/wa/{path}", request)
