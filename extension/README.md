# Save to Trackr (browser extension)

Chrome, Edge, Brave (Manifest V3). Click the toolbar button or right-click and choose "Save to Trackr" on a page, a link or selected text. The extension reads the page you are already looking at, signed in as you, so LinkedIn and X posts that Trackr's server cannot open still work. If you select text first, only the selection is sent.

Install: open `chrome://extensions`, switch on Developer mode, choose "Load unpacked" and pick this folder. Then open the extension's Options and enter your Trackr address (default `http://localhost:5173`).

Privacy: it reads the active tab only when you click. The text goes into the address fragment of your own Trackr site, which browsers never send to a server. Trackr then asks Gemini to read that text.
