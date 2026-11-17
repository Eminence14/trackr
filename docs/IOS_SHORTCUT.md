# Send to Trackr on iPhone (Apple Shortcut)

iOS Safari does not let web apps appear in the share sheet, so use a Shortcut instead. It takes 2 minutes:

1. Open the Shortcuts app, tap +, name it "Send to Trackr".
2. Add the action **Receive** input from **Share Sheet**, types: URLs and Text.
3. Add **Text** with: `https://YOUR-TRACKR-HOST/share?url=` then insert the **Shortcut Input** variable (set to URL encoded using the action **URL Encode** first).
4. Add **Open URLs** and pass that text.
5. Tap the info button and switch on **Show in Share Sheet**.

From WhatsApp, LinkedIn or X, tap Share, scroll to "Send to Trackr". For pasted text instead of links, use `/share?text=` in step 3.
