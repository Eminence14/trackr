# Play Store app (Trusted Web Activity)

The Android app is the same website wrapped with Google's Bubblewrap, so there is one codebase.

1. Deploy Trackr to HTTPS and change `host` and the icon URLs in `twa-manifest.json`.
2. `npm i -g @bubblewrap/cli`, then in this folder run `bubblewrap init --manifest=https://YOUR-HOST/manifest.webmanifest` (or reuse this file) and `bubblewrap build`.
3. Bubblewrap prints the SHA-256 fingerprint of your signing key. Put it in `public/.well-known/assetlinks.json` (template in `docs/assetlinks.example.json`) and redeploy so the address bar disappears.
4. Upload the `.aab` to the Play Console.

The share target in the manifest makes Trackr appear in the Android share sheet. Not done here: the signing key, a Play developer account, store listing and screenshots.
