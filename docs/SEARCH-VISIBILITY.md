# Search visibility: what is in place and what to do next

Written 5 November 2026 after checking the live site at `https://smbaacademy.in`.

## What the site already does (checked on the live site)

- The homepage can be indexed: no `noindex` tag, no `X-Robots-Tag` header, status 200.
- `http://` redirects to `https://` (308) and sends `Strict-Transport-Security`.
- One `<h1>`, headings that never skip a level, and a `<title>` and meta description on every public page.
- `<link rel="canonical">`, Open Graph and Twitter tags, and a 1200 x 630 share image (`/og.png`).
- JSON-LD: the academy (`SportsActivityLocation`), the head coach (`Person`) and the `WebSite`.
- `/robots.txt` allows the public site and blocks the private areas (`/coach`, `/player`, `/login`, `/register`, `/progress`). Those pages also carry `noindex`.
- `/sitemap.xml` lists the homepage.
- Core Web Vitals on the live homepage, lab test with a slow-4G phone profile (5 Nov 2026): LCP about 2.5 s, CLS 0, total blocking time about 50 ms. On desktop, LCP about 0.4 s. These are lab numbers, not what real visitors see; check the Core Web Vitals report in Search Console after a few weeks.
- Private pages are marked `noindex`, so they stay out of search results.

Nothing in the code stops Google from listing the site. When a site like this does not appear, the cause is almost always outside the code.

## First, find out which problem you have

Search Google for `site:smbaacademy.in`.

- **No results:** Google has not indexed the site yet. Do steps 1 to 3 below.
- **The homepage appears:** it is indexed, and the issue is ranking. Steps 4 and 5 matter most.

## 1. Add the site to Google Search Console (you need to do this; it needs your Google account)

1. Go to <https://search.google.com/search-console> and add a **Domain** property for `smbaacademy.in`.
2. Verify it with the DNS `TXT` record Google gives you, at wherever the domain's DNS is managed. This also covers `www`.
   - Alternative: choose a **URL prefix** property for `https://smbaacademy.in/` and the "HTML tag" method. Copy only the `content` value, set `GOOGLE_SITE_VERIFICATION` in Vercel (Project, Settings, Environment Variables, Production), and redeploy. The site adds the tag.
3. In **Sitemaps**, submit `https://smbaacademy.in/sitemap.xml`.
4. In **URL inspection**, paste `https://smbaacademy.in/` and choose **Request indexing**.
5. Repeat the same setup in Bing Webmaster Tools; it can import the Search Console property.

## 2. `www` now redirects to the main address

`vercel.json` redirects `www.smbaacademy.in` to `https://smbaacademy.in` (308). Before this, both addresses served the same page. Google already treated the main one as the real one because of the canonical tag, but a redirect removes the doubt.

## 3. Google Business Profile (the biggest lever for a local academy)

Searches like "badminton coaching Mahadevapura" are answered mostly from the map pack, which comes from Google Business Profile, not from the website.

- Claim or create the profile for Sathiya Moorthy Badminton Academy at <https://business.google.com>.
- Use the same name, address and phone number everywhere (the site shows +91 70109 28404). Search engines trust matching details.
- Set a category that describes the business (for example a badminton club or a sports school, whichever Google offers), your opening hours, a short description, and the website link.
- Add real photos of the courts, sessions and the coach.
- Ask happy parents and players for reviews, by sharing the profile's review link. Never buy reviews and never write them yourselves.

## 4. Links from other sites (a backlink plan that works for a local academy)

Aim for relevant, honest links from real places. A handful of good ones beat hundreds of poor ones.

1. **Your own accounts first:** put the website link in the bio of both Instagram accounts, on any Facebook page, WhatsApp Business profile and YouTube channel.
2. **The venue:** ask Just Play to link to the academy from its website or page.
3. **Directories that matter in India:** Google Maps (via the profile), Justdial, Sulekha and UrbanPro. Keep the name, address and phone identical.
4. **Local community:** schools, apartment societies and resident groups in and around Mahadevapura. A short "training partner" or "free trial for residents" note with a link is a natural fit.
5. **Badminton community:** tournament organisers, state and district associations, and players' pages. When a player of the academy wins something, ask the organiser or a local news site to mention the academy with a link.
6. **Content people want to link to:** use the public announcements for real news, such as batch openings, tournament entries and results, with a clear title.
7. **Avoid:** paid link packages, link swaps with unrelated sites, and spammy directory submissions. They can harm the site.

## 5. Facts to give us so the schema can be completed

The structured data does not yet include a street address, postal code, opening hours or a price range, because those are not in the project and should not be guessed. Send them and they can be added so Google can show them correctly.

## What to expect

New pages usually appear within days to a few weeks after Search Console submission. Ranking for local searches builds over weeks to months, helped most by the Business Profile, reviews and good links. Nobody can promise a position.
