# LEDGER

> "That's rather comical — pretending you don't care about your bank balance."

A black, white, and red expense tracker and wishlist savings app, styled like a fashion magazine editorial. Log your income and expenses, set savings goals for the things you want, and watch the "Acquired" stamp land when you get there.

No build tools, no backend, no dependencies. It's a single HTML file.

## Features

- **Overview** — available balance, monthly income/expense/saved stats, an auto-generated insight (e.g. "at this pace you're 3 months from affording X"), and a top-spending-categories breakdown.
- **The Ledger** — add income or expense entries with category, date, and note. Filter and delete entries.
- **Wishlist** — add goals with an icon and target price. Allocate money toward a goal from your available balance (or withdraw it back). Fully funded goals get a rotated "Acquired" stamp.
- **Data backup** — export all your data as a `.json` file, import it back in, or reset everything.

## Running it locally

No installation needed.

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
open index.html   # macOS
# or just double-click index.html in Finder/Explorer
```

## Hosting it on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, select the branch (usually `main`) and root folder (`/`).
4. Save. GitHub will give you a URL like `https://YOUR_USERNAME.github.io/YOUR_REPO/`.
5. Open it — your app is live.

That's it. No build step, no server, no environment variables.

## How data is saved

Your data is saved in your browser's `localStorage`, scoped to whatever URL you're using (so your GitHub Pages URL and a local file will have *separate* data). It persists across sessions on the same browser and device, but won't sync across browsers or devices on its own.

Use the **Export Backup** button in the footer regularly — it downloads a `.json` file you can keep as a real backup, move between devices with **Import Backup**, or use to migrate your data if you ever rebuild this into something bigger (a real backend, multi-device sync, etc.).

## Project structure

```
.
├── index.html   # the entire app: markup, styles, and logic
└── README.md
```

## License

Do whatever you want with it.
