# 📰 News Briefing Skill

## Purpose
Fetch and summarize the latest news from RSS feeds and deliver a morning briefing to the user.

## Available Tools
- `fetch_rss(url, max_items)` — Fetches articles from any RSS/Atom feed.
- `fetch_url(url)` — Fetches the text content of any webpage.
- `send_whatsapp_message(recipient, message)` — Sends the briefing via WhatsApp.

## Default RSS Feeds
Use these feeds unless the user specifies others:
- **Ynet (Hebrew)**: `https://www.ynet.co.il/Integration/StoryRss2.xml`
- **Walla News (Hebrew)**: `https://rss.walla.co.il/feed/1`
- **BBC World**: `https://feeds.bbci.co.uk/news/world/rss.xml`
- **Tech (The Verge)**: `https://www.theverge.com/rss/index.xml`

## Procedure

### When the user asks for news / a morning briefing:
1. Call `fetch_rss` on the relevant feed(s) with `max_items: 8`.
2. Read the returned `items` list (title, summary, published).
3. Compose a concise, friendly briefing in Hebrew summarizing the **top 5 headlines**.
   - Format: emoji bullet points, one line per story.
   - Include the article title and a 1-sentence summary.
   - End with the source name and timestamp.
4. Respond directly in the chat (no need to call `send_whatsapp_message` unless explicitly asked to forward it).

### When scheduling a daily morning briefing:
- Use `add_reminder` to create a daily reminder at the requested time.
- In the reminder title, specify: "שלח סיכום חדשות בוקר - [רשימת פידים]"
- When the reminder triggers, run the briefing procedure above and send via `send_whatsapp_message` to admin.

### Example output format:
```
📰 *סיכום חדשות בוקר - 15 מאי 2025*

🔴 *כותרת 1* — משפט תמצות קצר של הכתבה.
🟡 *כותרת 2* — משפט תמצות קצר.
🟢 *כותרת 3* — משפט תמצות קצר.
🔵 *כותרת 4* — משפט תמצות קצר.
⚪ *כותרת 5* — משפט תמצות קצר.

📡 מקור: Ynet | עודכן: 08:00
```

## Tips
- If a feed fails, try the next one automatically.
- If the user shares a link to an article they want to read, use `fetch_url` to get the full text and summarize it.
- For custom topics (sports, tech, politics), pick the most relevant feed or ask the user for their preferred feed URL.
