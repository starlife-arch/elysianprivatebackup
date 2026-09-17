# DateVault — Complete Setup Guide v3

---

## WHAT YOU NEED TO SET UP

| Service | Purpose | Cost |
|---|---|---|
| Firebase | Database + Auth | Free tier |
| Cloudinary | Photo storage | Free tier |
| Brevo | Approval emails | Free (300/day) |
| Telegram Bot | Admin notifications | Free |
| Pesapal | M-Pesa payments | % per transaction |
| Paystack | Card payments (optional) | % per transaction |
| Netlify | Hosting + serverless functions | Free tier |

---

## STEP 1 — Firebase Setup

1. Go to https://console.firebase.google.com → **Add project** → name it `datevault`
2. **Authentication** → Get started → **Email/Password** → Enable
3. **Firestore Database** → Create database → Production mode → choose region → Enable
4. **Project Settings** (gear) → **Your apps** → click **</>** → name `datevault-web` → Register
5. Copy the `firebaseConfig` values into `js/firebase.js`

**Create your admin user:**
1. Firebase Console → Authentication → **Add user** → enter your email + password
2. Copy the UID shown
3. Firestore → Data → **Start collection** → ID: `users`
4. Add document with ID = your UID, fields:

| Field | Type | Value |
|---|---|---|
| uid | string | your UID |
| email | string | your email |
| role | string | `admin` |
| status | string | `active_member` |
| banned | boolean | `false` |
| memberId | string | `MBR-ADMIN1` |
| photos | array | *(empty)* |

**Deploy Firestore rules:**
- Firebase Console → Firestore → Rules tab → paste contents of `firestore.rules` → Publish

---

## STEP 2 — Cloudinary Setup

1. https://cloudinary.com → Sign up free
2. Dashboard: copy your **Cloud Name** (top left)
3. Settings → Upload → **Upload presets** → Add upload preset:
   - Signing Mode: **Unsigned**
   - Name: `datevault_uploads`
   - Folder: `datevault`
   - Save
4. Edit `js/firebase.js`:
```js
const CLOUDINARY_CLOUD  = "your_cloud_name";
const CLOUDINARY_PRESET = "datevault_uploads";
```

---

## STEP 3 — Brevo Email Setup

1. https://app.brevo.com → Sign up (free: 300 emails/day)
2. Go to **Settings** → **API Keys** → **Generate a new API key**
3. Copy the key — you'll add it to Netlify environment variables later
4. Go to **Senders & IP** → add your sending domain or use the default
5. Set a sender email you own (e.g. `noreply@yourdomain.com`)

---

## STEP 4 — Telegram Bot Setup

1. Open Telegram → search for **@BotFather**
2. Send `/newbot` → follow prompts → copy the **bot token** (looks like `123456:ABC-DEF...`)
3. Start a chat with your new bot (search for its username)
4. Get your chat ID: visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   After sending your bot a message, you'll see `"chat":{"id":123456789}` — that number is your chat ID
5. For a group: add the bot to the group, get the group chat ID the same way (it'll be negative)

---

## STEP 5 — Pesapal Setup

1. Go to https://www.pesapal.com → **Register as Merchant**
2. After approval, go to **Developer Portal** → get your **Consumer Key** and **Consumer Secret**
3. For testing: use https://cybqa.pesapal.com (sandbox credentials separate from live)

---

## STEP 6 — Paystack Setup (optional, add later)

1. https://dashboard.paystack.com → Sign up
2. Settings → API Keys → copy **Public Key** (starts `pk_live_...`) and **Secret Key** (`sk_live_...`)
3. Public key goes in `js/firebase.js`, secret key goes in Netlify environment variables

---

## STEP 7 — Deploy to Netlify

The app is configured for Netlify Functions with `netlify.toml`. Deploy the repo to Netlify, then add these environment variables in **Site configuration → Environment variables**:

```text
BREVO_API_KEY
FROM_EMAIL
FROM_NAME
APP_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
PESAPAL_CONSUMER_KEY
PESAPAL_CONSUMER_SECRET
PESAPAL_SANDBOX
PAYSTACK_SECRET_KEY
FIREBASE_SERVICE_ACCOUNT
```

**APP_URL**: your Netlify URL, e.g. `https://elysiandate.netlify.app`

**FIREBASE_SERVICE_ACCOUNT** is a JSON string:
- Firebase Console → Project Settings → **Service Accounts** → Generate new private key
- Download the JSON file → open it → copy the entire contents as one line
- Paste as the value in Netlify

**PESAPAL_SANDBOX**: `true` for testing, `false` for live

---

## STEP 8 — Pesapal Callback/IPN

No separate IPN file is needed. The single Netlify function handles initiate, callback, status checks, and IPN under:

```text
https://your-site.netlify.app/api/pesapal
```

The code registers the IPN URL automatically as:

```text
https://your-site.netlify.app/api/pesapal?action=ipn
```

---


## ENVIRONMENT VARIABLES REFERENCE

| Variable | Where to get it | Example |
|---|---|---|
| `BREVO_API_KEY` | Brevo → Settings → API Keys | `xkeysib-abc123...` |
| `FROM_EMAIL` | Your verified sender email | `noreply@datevault.com` |
| `FROM_NAME` | Display name for emails | `DateVault` |
| `APP_URL` | Your Netlify URL | `https://elysiandate.netlify.app` |
| `TELEGRAM_BOT_TOKEN` | BotFather | `123456789:ABC-def...` |
| `TELEGRAM_CHAT_ID` | From getUpdates | `987654321` |
| `PESAPAL_CONSUMER_KEY` | Pesapal dev portal | `...` |
| `PESAPAL_CONSUMER_SECRET` | Pesapal dev portal | `...` |
| `PESAPAL_SANDBOX` | `true` or `false` | `false` |
| `PAYSTACK_SECRET_KEY` | Paystack dashboard | `sk_live_...` |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON | `{"type":"service_account"...}` |

---

## FRONTEND VARIABLES (in js/firebase.js)

| Variable | Where |
|---|---|
| Firebase `apiKey`, `authDomain`, etc. | Firebase Console → Project Settings → Web app |
| `CLOUDINARY_CLOUD` | Cloudinary dashboard top-left |
| `CLOUDINARY_PRESET` | Cloudinary → Settings → Upload presets |
| `PAYSTACK_PUBLIC_KEY` | Paystack dashboard → API Keys |

---

## TESTING THE FLOW

1. Open your site → Apply for Membership → create test account
2. Fill in verification form (upload test photos)
3. Go to `/admin.html` → sign in as admin → Pending Review
4. Click **Approve** → invite code generated + emailed
5. Check Telegram → you should get a notification
6. Sign into test account → redirected to invite page
7. Check email for invite code → enter it
8. Complete payment (use Pesapal sandbox)
9. Access the members area!

---

## ADMIN FEATURES REFERENCE

| Feature | Location |
|---|---|
| Approve/reject members | Admin → Pending Review |
| View ID photos, selfies, all info | Admin → Pending Review (expanded card) |
| See invite codes | Visible on every user card |
| Grant access (custom days) | Admin → Any user → Grant Access |
| Ban/unban users | Admin → Any user card |
| Send private message to user | Admin → Message Users |
| Post announcements | Admin → Announcements |
| Reply to support tickets | Admin → Support Tickets |
| Schedule video calls | Admin → Video Calls |
| View all reports + messages | Admin → Reports |

---

## USER FEATURES REFERENCE

| Feature | Location |
|---|---|
| Block a user | Chat → three dots menu → Block |
| Report a user | Chat → three dots menu → Report (includes message snapshot) |
| Unmatch | Chat → three dots menu → Unmatch |
| Add/remove photos | Profile → Edit Profile → Photos |
| Select interests | Profile → Edit Profile → Interests |
| Set zodiac sign | Profile → Edit Profile → Zodiac |
| Contact support | Chat → Support tab → Contact Support |
| View announcements | Chat → Updates tab |
| View invite code | Check email after approval |


## PrintPay and wallet deployment

Set `PRINTPAY_API_KEY` in Netlify environment variables. Configure the PrintPay dashboard webhook to `https://elysiandate.site/api/printpay-callback`. Deploy `firestore.indexes.json` with `firebase deploy --only firestore:indexes` before enabling wallet withdrawal queues; it includes the withdrawal, wallet transaction, payment, and audit indexes required by the member and admin consoles.

Netlify must also have `FIREBASE_SERVICE_ACCOUNT` set to the JSON service-account credential used by the authenticated wallet function. Verify both `FIREBASE_SERVICE_ACCOUNT` and `PRINTPAY_API_KEY` before deploying payment or wallet changes.
