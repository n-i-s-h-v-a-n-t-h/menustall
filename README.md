# ☕ ChaiMenu — QR menu & live stock for your tea stall

Customers scan the QR code on their table and see your live menu: prices, photos, what's fresh and what's sold out. You run everything from your phone: one tap marks an item sold out, and every open menu updates within about 2 seconds.

- **No ordering or payment.** Customers make a "My Picks" list and show it at the counter.
- **Costs ₹0.** It uses the free tiers of Supabase (database) and Netlify/Vercel/Cloudflare/GitHub Pages (hosting).
- **No app store and no installs.** Customers just scan. You can add the dashboard to your home screen like an app.

---

## What's in the folder

| Path | What it is |
|---|---|
| `index.html` | The customer menu (what the QR code opens) |
| `admin/` | Your dashboard: `login.html`, `index.html`, `print.html`, plus the app icon files |
| `css/`, `js/` | Styles and code (no build step, nothing to install) |
| `js/config.js` | **The only file you edit**: your Supabase address and key |
| `supabase/schema.sql` | Creates the whole database in one go |

---

## Setup (about 15 minutes, one time)

### 1. Create a free Supabase project
1. Go to **https://supabase.com** and click **Start your project**. Sign in with GitHub or your email.
2. Click **New project**. Pick any name (for example `chai-stall`), make up a **database password** and save it somewhere, and pick the region closest to you (for example *Mumbai*). Choose the **Free** plan.
3. Wait about 2 minutes while Supabase prints "Setting up project…".

### 2. Create the database
1. In the left sidebar, click **SQL Editor** (the `>_` icon), then **New query**.
2. Open `supabase/schema.sql` from this folder in any text editor, select everything, copy it, and paste it into the big box.
3. Click **Run** (bottom right). You should see **"Success. No rows returned"**.

This one step creates all the tables, security rules, live updates, the photo storage bucket, and a sample menu with about 20 South Indian tea stall items. It's safe to run again later.

### 3. Owner account — nothing to do here
The **first account created on the dashboard becomes the shop owner automatically.** You'll do this in step 6. You don't need to copy any IDs or run any SQL.

Tip: to skip the confirmation email, go to **Authentication → Sign In / Providers → Email** in Supabase and turn **Confirm email** off. (If you leave it on, see *Confirmation email* under Troubleshooting.)

### 4. Connect the app to your database
1. In Supabase, go to **Project Settings (gear icon) → API** (in newer dashboards: **Project Settings → Data API** for the URL and **API Keys** for the key).
2. Copy the **Project URL** and the **anon / public** key.
3. Open `js/config.js` and paste them in:
   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi…';
   ```
   The anon key is safe to publish, because the security rules from step 2 decide what anyone can do. **Never** paste the `service_role` key.

### 5. Put it online (free)
**Netlify Drop (easiest):** go to **https://app.netlify.com/drop** and drag this whole folder onto the page. A minute later you get a web address like `https://chai-stall-123.netlify.app`. You can rename it under *Site settings → Change site name*.

Other free options:
- **Vercel:** *Add New → Project*, import the folder or repo, and keep the default settings.
- **Cloudflare Pages:** *Workers & Pages → Create → Pages → Upload assets*.
- **GitHub Pages:** push the folder to a repo, then turn it on under *Settings → Pages* (deploy from branch, root folder).

### 6. Set up your shop and print the QR cards
1. Open your site and tap **Owner login** at the bottom of the menu (or go to `/admin/`). The first time, you'll see **Create the owner account**. Enter your email and a password, and you'll land in the dashboard.
2. The **Get your shop ready** checklist on Overview has a button for each step. Start with **Settings**. Set your shop name, hours and logo, and set the **QR base URL** to your live address (for example `https://chai-stall-123.netlify.app`). Click **Save changes**.
3. Go to **Tables & QR**, enter how many tables you have, and tap **Generate**.
4. Tap **Print cards** to print directly on A4 (4 or 6 per page, with cut marks), or download **All as A4 PDF** or **ZIP** to print at a shop. Use the **Test** link to check that a card opens the right table.
5. Cut the cards out, laminate them, and stick one on each table. Scan one with your own phone to check it works.

### 7. Add the dashboard to your phone's home screen
- **Android (Chrome):** open `/admin/`, tap **⋮ → Add to Home screen / Install app**.
- **iPhone (Safari):** open `/admin/`, tap **Share → Add to Home Screen**.

It opens full-screen on the **Stock** tab, ready for the counter.

---

## Daily use
- **Morning:** go to Overview and tap **Start the day**. Everything is marked in stock, the announcement is cleared, and the shop shows as Open.
- **Something runs out:** go to Stock and tap its switch. Tapped by mistake? Tap **Undo** within 5 seconds.
- **Counted items (samosas, puffs):** turn on *Track quantity* for the item. Use − and + on the Stock tab, or tap the number to type it. The item sells out automatically at 0.
- **Announcements:** type something like "Hot bajji at 5 PM 🔥" in Overview → Quick actions.
- **Night:** tap **Close shop**. Customers see "Closed · opens 6 AM".

---

## Troubleshooting

**"Project paused" / the menu shows "Couldn't load the menu"**
Free Supabase projects pause after about 7 days with no activity. Open https://supabase.com/dashboard, click your project, and click **Restore project**. It takes a minute and no data is lost. Normal daily use (customers scanning) keeps it awake.

**The menu page is blank or says "Menu coming soon" with no items**
`schema.sql` didn't fully run in this Supabase project. Run the whole file again (step 2). It's safe to repeat. Make sure you copied every line (open the file on GitHub and click **Raw**, then copy all).

**Login page says "The database isn't set up yet"**
Same fix: run all of `supabase/schema.sql` in the SQL Editor, then reload the login page.

**Confirmation email**
New Supabase projects ask new accounts to confirm their email. Click the link in the email. Even if the page it opens doesn't load, your email is now confirmed, so go back to `/admin/` and log in. To make the link open your site, go to **Authentication → URL Configuration** and set **Site URL** to your live address. To skip confirmation entirely, turn off **Confirm email** (step 3).

**"This account isn't the shop owner"**
Someone else's account became the owner first. In Supabase, go to **Authentication → Users**, click *your* user and copy its **User UID**. Then run this in the SQL Editor:
`insert into public.admins (user_id) values ('YOUR-UID');`

**Photos won't upload**
- Make sure `schema.sql` ran completely. In Supabase, check **Storage**: a bucket called `menu-images` should exist and be marked *Public*. If it doesn't, run `schema.sql` again.
- Use JPEG, PNG or WebP photos. The app shrinks them to under 200 KB automatically.
- If you still get "permission denied", see the previous item. Only admins can upload.

**QR codes open "localhost" or don't work on customers' phones**
Set **Settings → QR base URL** to your live address (for example `https://chai-stall-123.netlify.app`), save, and print the cards again. The Tables & QR tab shows a warning while the address is a local one.

**Live updates don't arrive (customers must refresh to see sold-out items)**
In Supabase, go to **Database → Publications → supabase_realtime** and make sure `menu_items`, `categories`, `shop_settings` and `stock_events` are switched on. (`schema.sql` does this, so running it again also fixes it.) Some office or hotel Wi-Fi networks block live connections. Try on mobile data.

**Forgot your password**
On the login page, tap **Forgot password?**. In Supabase, also add your live address under **Authentication → URL Configuration → Site URL / Redirect URLs** (for example `https://chai-stall-123.netlify.app/admin/login.html`) so the email link opens your site.

**I changed `config.js` but the dashboard still uses the old one**
Close the dashboard app completely and open it again. It always checks for the newest config first.

---

## Security notes
- The browser only ever gets the **anon** key. Row Level Security in `schema.sql` means anonymous visitors can only **read** the visible menu, active tables and shop details, and can only **add** anonymous scan/view counts, which they cannot read back.
- Every other change, and all statistics, need a logged-in user listed in `admins`.
- No personal data about customers is stored. Scans record only a table number and a time.

## Costs
Supabase Free (500 MB database, 1 GB file storage, 2 million realtime messages a month) and static hosting free tiers are far more than one tea stall needs. **Monthly cost: ₹0.**
