# JS Obfuscator

A client-side JavaScript obfuscator that runs entirely in the browser.  
No server, no dependencies, no build step.

🔗 **Live demo:** `https://<your-username>.github.io/<repo-name>/`

---

## Features

- Rename variables, functions, parameters, class names
- Rename custom object properties (skips all browser/JS API names)
- Encode strings (hex escape)
- Encode numbers (`5` → `(2+3)`)
- Dead code injection
- Shuffle top-level functions
- Anti-debug protection
- Disable console
- Self-defending code
- Wrap in IIFE
- Minify output
- Multiple naming styles: random, hex, underscore, unicode runes, mixed
