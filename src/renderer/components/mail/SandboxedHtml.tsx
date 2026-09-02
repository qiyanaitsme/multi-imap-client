"use client"

import { useEffect, useRef, useState } from 'react'

interface SandboxedHtmlProps {
  /** Already-sanitized HTML (DOMPurify output). This component adds isolation, not sanitization. */
  html: string
  className?: string
}

/**
 * Renders email HTML inside a sandboxed <iframe> (defense-in-depth).
 *
 * Security model:
 * - `sandbox="allow-scripts"` WITHOUT `allow-same-origin` gives the frame an
 *   opaque origin: even if DOMPurify somehow missed a vector, the frame
 *   cannot touch parent DOM, cookies, or localStorage.
 * - No `allow-popups`: window.open inside the frame is blocked; links are
 *   routed to the parent via postMessage and then to the system browser
 *   through the main-process protocol whitelist (http/https/mailto only).
 * - Email CSS is isolated from app styles (no bleed in either direction).
 * - The inline script in srcDoc is OURS (height reporter / link interceptor);
 *   email scripts are already stripped by DOMPurify upstream.
 */
export default function SandboxedHtml({ html, className }: SandboxedHtmlProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  // Listen for messages from the frame. We verify event.source matches the
  // iframe's contentWindow so other windows cannot spoof height/link events.
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const frame = iframeRef.current
      if (!frame || e.source !== frame.contentWindow) return
      const data = e.data as { type?: string; height?: number; href?: string } | null
      if (!data || typeof data !== 'object') return

      if (data.type === 'mailframe:height' && typeof data.height === 'number' && data.height > 0) {
        // Clamp to sane bounds to avoid layout breakage from hostile content
        setHeight(Math.min(Math.max(Math.round(data.height) + 16, 40), 20000))
        return
      }

      if (data.type === 'mailframe:link' && typeof data.href === 'string' && data.href.length > 0) {
        // Main process enforces the http/https/mailto protocol whitelist.
        window.electronAPI?.openExternal(data.href)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Wrap sanitized body in a minimal document with sane defaults.
  // <base target="_blank"> so relative links don't resolve against the app.
  // CSP: script-src 'unsafe-inline' is required ONLY for our own reporter
  // script below; email scripts were already removed by DOMPurify and any
  // residue runs in the opaque-origin frame with no privileges.
  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: cid:; style-src 'unsafe-inline'; font-src data: https: http:; script-src 'unsafe-inline';" />
<base target="_blank" />
<style>
html,body{margin:0;padding:8px;background:transparent;color:#e4e4e7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere}
a{color:#8b9cff}
img{max-width:100%;height:auto}
table{max-width:100%}
</style>
<script>
(function(){
  'use strict';
  function post(msg){ try { parent.postMessage(msg, '*'); } catch (e) {} }
  function reportHeight(){
    var h = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    post({ type: 'mailframe:height', height: h });
  }
  document.addEventListener('click', function(e){
    var t = e.target;
    while (t && t.nodeName !== 'A') t = t.parentElement;
    if (t && t.href) {
      e.preventDefault();
      post({ type: 'mailframe:link', href: t.href });
    }
  }, true);
  if (document.readyState !== 'loading') reportHeight();
  else document.addEventListener('DOMContentLoaded', reportHeight);
  window.addEventListener('load', reportHeight);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(reportHeight).observe(document.documentElement);
    if (document.body) new ResizeObserver(reportHeight).observe(document.body);
  } else {
    setInterval(reportHeight, 1000);
  }
})();
</script>
</head>
<body>${html}</body>
</html>`

  return (
    <iframe
      ref={iframeRef}
      // allow-scripts ONLY. allow-same-origin is intentionally omitted:
      // the frame gets a unique opaque origin and cannot reach the parent.
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      title="email-content"
      className={className}
      style={{ width: '100%', height, border: 'none', display: 'block' }}
    />
  )
}
