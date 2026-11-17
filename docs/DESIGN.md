# Trackr design notes

References were pulled from Mobbin (iOS and web) and adapted, not copied. Palette: warm paper `#F6F3EC`, deep green `#0B6B4D`, amber accent `#C8821B`. Fraunces for headings, Inter for text. Dark mode follows the system or Settings.

| Part of Trackr | Pattern borrowed | Mobbin reference |
|---|---|---|
| Application status stepper | Horizontal step tracker with a highlighted current step (Revolut Business, Mercury, Grab application status) | search: "application status stepper" |
| Tracker list and job-style rows | LinkedIn job tracker, Handshake jobs with sort and filter chips | LinkedIn job tracker flow `3bc4f28c-6c33-473e-b9ce-70e21727a092` |
| Detail page | Key facts as labelled rows (Wealthsimple details), Glassdoor job detail hierarchy | search: "job detail screen" |
| Add by link or text | Bottom sheet with a paste field (Vipps "add a wish", Linktree add link, Corner paste links) | search: "paste link bottom sheet" |
| Spreadsheet view | Dense table with sticky first column, inline cells (Airtable, Supabase, Retool) | search: "table view with inline editing" |
| Board view | Status columns with cards (ClickUp, Slack Lists, Strut) | search: "kanban board" |
| Onboarding | Short multi-step with a progress indicator and one decision per screen (Notion, Tiimo, Raycast) | search: "onboarding choose preferences" |

Principles: one primary action per screen; every uncertain value is visible and fixable; deadlines always show date, time zone and "in N days"; colour is never the only signal (labels and icons repeat it); touch targets at least 34px; mobile uses a bottom tab bar, desktop a sidebar.
