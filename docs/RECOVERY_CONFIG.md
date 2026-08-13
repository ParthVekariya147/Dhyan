# પાસવર્ડ રીકવરી — the half that is not code

The flow itself is finished and tested (`npm run test:recovery`). Everything below lives in
the Supabase dashboard, and **none of it can be set from this repository**. Until it is done,
the mail either does not arrive or arrives pointing at the wrong host — and in both cases the
app shows a યુવક the neutral "check your inbox" screen, because §3 forbids it from saying
anything else. That is the trap this file exists to close: *a completely broken recovery flow
looks exactly like a working one from the inside.*

Verify by receiving an actual mail. Nothing short of that is evidence.

---

## What is already decided in code

| Thing | Where | Value |
| --- | --- | --- |
| Path the mail points at | `shared/domain/recovery-routes.js` | `/reset-password` |
| Origin the mail points at | `src/lib/auth.jsx`, `admin/src/lib/adminAuth.jsx` | `VITE_SITE_URL`, else the origin the page is running on |
| Client resend cooldown | `shared/domain/recovery.js` | 60 s |
| Password rule | `shared/domain/constants.js` → `MIN_PASSWORD` | 6 characters, નોંધણી's own rule |

The panel and the app mail the **same** destination. There is no recovery screen under
`/admin/` and there must not be one; see the comment on `resetPassword` in
`admin/src/lib/adminAuth.jsx`.

---

## 1. URL configuration — do this first

**Authentication → URL Configuration**

- **Site URL** — `https://varni-dhyan.netlify.app`
- **Redirect URLs** — every origin that may legitimately receive a recovery link, each with
  the reset path spelled out:

  ```
  https://varni-dhyan.netlify.app/reset-password
  http://localhost:5173/reset-password
  ```

  Add the Netlify preview pattern **only if** reviewers actually test recovery on previews:

  ```
  https://*--varni-dhyan.netlify.app/reset-password
  ```

  A custom domain, when there is one, is an **addition** to this list and not a replacement:
  mails already in inboxes point at whatever host sent them, and dropping that host from the
  list breaks every link a યુવક has not opened yet.

A link whose `redirect_to` is not on this list is not rejected loudly. Supabase silently
falls back to the Site URL, so the યુવક lands on the app root, gets redirected by the router,
and the link is consumed with the password unchanged. This is the single most likely reason
for "the mail arrives but nothing happens".

Do not add a bare wildcard (`https://varni-dhyan.netlify.app/**`). The one path that needs to be
reachable is the one written above.

**Email OTP expiry** (Authentication → Providers → Email) governs how long a recovery link
lives. One hour is the default and is right for this project: the reset page already treats
expiry as a first-class screen with two ways off it.

---

## 2. SMTP — required, not optional

**Project Settings → Authentication → SMTP Settings**

The built-in email service sends **2 emails per hour, project-wide**, and Supabase documents
it as being for development only. With 400 to 500 યુવકો that ceiling is reached by the third
person who forgets a password in the same hour; everyone after them gets a 429, which the app
correctly reports as "ઘણી વાર પ્રયત્ન થયો" — a message about *them* that is in fact about the
project's quota.

So: configure a real provider (Resend, SendGrid, Amazon SES, Postmark) before launch.

- **Sender address** — a mailbox on a domain you control, not a free provider.
- **Sender name** — the same name the app calls itself, so the mail is recognisable in a
  crowded inbox.
- **SPF, DKIM, DMARC** — all three, on the sending domain. Recovery mail that lands in Spam is
  indistinguishable, to the યુવક, from recovery mail that was never sent. The success screen
  names the Spam folder for exactly this reason, but that is a mitigation and not a fix.

After configuring, raise **Authentication → Rate Limits → Rate limit for sending emails** from
its default. It stays at the built-in ceiling until you change it, custom SMTP or not.

---

## 3. The recovery email template

**Authentication → Emails → Reset password**

Subject:

```
તમારો પાસવર્ડ રીસેટ કરો
```

Body:

```html
<h2>તમારો પાસવર્ડ રીસેટ કરો</h2>

<p>
  તમે વરણી ધ્યાન એપ્લિકેશનમાં પાસવર્ડ ફરીથી સેટ કરવાની વિનંતી કરી છે.
  નીચેની લિંક પર ક્લિક કરીને નવો પાસવર્ડ સેટ કરો.
</p>

<p>
  <a href="{{ .ConfirmationURL }}">નવો પાસવર્ડ સેટ કરો</a>
</p>

<p>
  આ લિંક થોડા સમય પછી કામ કરતી નથી, અને એક વાર વપરાયા પછી ફરી વપરાતી નથી.
</p>

<p>
  જો તમે આ વિનંતી કરી ન હોય તો આ ઈમેલ અવગણો. તમારો પાસવર્ડ બદલાશે નહીં.
</p>
```

`{{ .ConfirmationURL }}` is the only variable used, and that is deliberate. It carries the
verification Supabase performs and nothing this project generated. **Do not** add
`{{ .Token }}` or `{{ .TokenHash }}` to the body: a mail that prints a token is a token in
every forwarded copy, every mail-provider log and every screenshot, and this project has no
screen that consumes one.

Nothing else may appear here — no password, no session, no key, and no statement about the
account beyond the fact that somebody asked.

---

## 4. Password-changed notification

**Authentication → Emails → Password changed**, and enable the security notifications for the
project (the templates are inert until that is switched on).

Subject:

```
તમારા એકાઉન્ટનો પાસવર્ડ બદલવામાં આવ્યો છે
```

Body:

```html
<h2>તમારા એકાઉન્ટનો પાસવર્ડ બદલવામાં આવ્યો છે</h2>

<p>
  વરણી ધ્યાન એપ્લિકેશનમાં તમારા એકાઉન્ટનો પાસવર્ડ હમણાં બદલવામાં આવ્યો છે.
</p>

<p>
  જો આ તમે કર્યું હોય તો કંઈ કરવાની જરૂર નથી.
  જો આ તમે કર્યું ન હોય તો તરત સંચાલકને જણાવો.
</p>
```

This is a notification and carries no action. It must never contain the new password, a link
that sets one, or anything that would let a reader of the mail alone take the account.

---

## 5. Rate limits

**Authentication → Rate Limits**

Supabase's own limits are the authoritative ones. The 60-second cooldown in
`shared/domain/recovery.js` exists so a યુવક who taps twice does not spend a request and gets
told why — it is UX, and it is deliberately the *same* 60 seconds as Supabase's default
per-user window for password-reset requests, so the button re-enables at roughly the moment
the server would accept another.

Leave that window at 60 seconds. Lowering it makes the client cooldown lie in the direction
that wastes a request; raising it makes it lie in the direction that strands somebody whose
first mail genuinely did not arrive.

The email-sending limit is the one to actually raise, and §2 says so.

---

## 6. Verify, on the real site, before calling this done

1. `/forgot-password` → submit a **registered** address → the neutral screen appears.
2. The mail arrives. Check the **Spam folder too**, and note which one it landed in.
3. The link opens `https://varni-dhyan.netlify.app/reset-password` — check the address bar. If it
   opens the site root, §1 is wrong.
4. Set a new password → the success screen appears.
5. Log in with **email + new password**.
6. Log out. Log in with **mobile + new password**. Both must work; they are one credential
   (`netlify/functions/login-mobile.js` resolves the number to an email and signs in against
   the same `auth.users` row).
7. The old password is refused.
8. Open the same link a second time → "આ પાસવર્ડ રીસેટ લિંક હવે માન્ય નથી" with two ways off it.
9. Submit an address that is **not** registered → the identical screen as step 1. Any
   difference at all, including timing you can perceive, is an enumeration leak.
10. A સંચાલક resets from the panel's login screen and lands on `/reset-password`, not on the
    dashboard.
