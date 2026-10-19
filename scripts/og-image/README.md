# Live link preview image

`live.html` is the source of `site/static/og/live.png`, the 1200x630 image that the worker
advertises as `og:image` and `twitter:image` on `/live/` invite links. It carries no room-specific text.

Regenerate it after editing `live.html` with `node scripts/og-image/render.mjs`
(needs Chrome, Edge or Chromium; set `CHROME` to point at another binary).
