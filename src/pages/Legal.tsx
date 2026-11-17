import { Link } from 'react-router-dom'

const DRAFT = <div className="banner warn"><div><b>Draft for review</b><span>This text was prepared for launch planning and must be reviewed by a qualified lawyer, and the bracketed details filled in, before real users sign up.</span></div></div>

export function Terms() {
  return (
    <div className="prose stack" style={{ maxWidth: 720 }}>
      <Link to="/">← Back</Link><h1>Terms of Use</h1>{DRAFT}
      <h2>What Trackr is</h2><p>Trackr helps you organise scholarship and admission opportunities you find elsewhere. It reads links, text and screenshots you give it and files the details for you.</p>
      <h2>Check before you rely</h2><p>Details are read automatically and can be wrong or out of date. Always confirm deadlines, eligibility and requirements on the official website of the funder or university. Trackr is not responsible for missed or mistaken applications.</p>
      <h2>No endorsement</h2><p>Trackr does not endorse any scholarship. Scam warnings are hints, not guarantees. Never pay to apply for a scholarship that is meant to be free.</p>
      <h2>Your content</h2><p>You keep ownership of what you add. You give Trackr permission to process it to provide the service. Do not add content you have no right to share.</p>
      <h2>Acceptable use</h2><p>Do not misuse the service, attempt to break it, or use it to harass or defraud others.</p>
      <h2>Changes and contact</h2><p>We may update these terms and will show a notice when we do. Contact: [contact email].</p>
    </div>
  )
}

export function Privacy() {
  return (
    <div className="prose stack" style={{ maxWidth: 720 }}>
      <Link to="/">← Back</Link><h1>Privacy Notice</h1>{DRAFT}
      <p>Controller: [company name and address]. This notice covers the EU/UK GDPR and the Nigeria Data Protection Act 2023 (NDPA).</p>
      <h2>What we process</h2>
      <ul><li>Profile details you enter: name, email, country, study interests, time zone.</li><li>Links, pasted text and screenshots you add, and the scholarship details extracted from them.</li><li>Your tracker data (applications, notes, essays, referees). By default this is stored only on your device.</li><li>Documents in the vault are encrypted on your device with your passphrase before storage.</li></ul>
      <h2>Why (legal basis)</h2><p>To provide the service you asked for (contract), to send reminders you opted into (consent), and to keep the service secure (legitimate interests). You gave consent when you finished sign-up and can withdraw it in Settings.</p>
      <h2>Who receives data</h2><p>Links, text and screenshots you add are sent to our server and to Google's Gemini API only to read them. Pages behind links are fetched by our server. If email reminders are on, your email and deadlines go to our email provider. We do not sell data or use it for advertising.</p>
      <h2>International transfers</h2><p>These providers may process data outside Nigeria and the EU/UK under standard contractual safeguards. [list providers and regions].</p>
      <h2>Retention</h2><p>On-device data stays until you delete it. Cached page text on the server is kept for up to [7] days. Reminder data is deleted when you delete your account.</p>
      <h2>Your rights</h2><p>You can access, correct, export or delete your data, object to or restrict processing, and withdraw consent. In Settings, use "Download backup" and "Delete all my data". For anything else write to [contact email]. You may complain to the Nigeria Data Protection Commission or your local supervisory authority.</p>
      <h2>Children</h2><p>Trackr is for people aged 16 and over, or younger with a parent or guardian's consent.</p>
    </div>
  )
}
