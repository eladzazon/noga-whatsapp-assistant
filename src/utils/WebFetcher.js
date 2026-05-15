import axios from 'axios';
import logger from './logger.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_CONTENT_LENGTH = 50000; // ~50KB max to avoid flooding the LLM

/**
 * Fetches the raw text/HTML content of a URL.
 * @param {string} url - The URL to fetch.
 * @param {object} [options]
 * @param {number} [options.maxLength] - Max characters to return (default 50 000).
 * @returns {Promise<{success: boolean, url: string, content?: string, error?: string}>}
 */
export async function fetchUrl(url, { maxLength = MAX_CONTENT_LENGTH } = {}) {
    try {
        logger.info('WebFetcher: fetchUrl', { url });
        const response = await axios.get(url, {
            timeout: DEFAULT_TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NogaBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7'
            },
            maxContentLength: 5 * 1024 * 1024,
            responseType: 'text'
        });

        let content = String(response.data);

        // Strip HTML tags for cleaner LLM consumption
        content = content
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s{3,}/g, '\n\n')
            .trim();

        if (content.length > maxLength) {
            content = content.slice(0, maxLength) + '\n\n[... content truncated ...]';
        }

        return { success: true, url, content, content_length: content.length };
    } catch (err) {
        logger.error('WebFetcher: fetchUrl failed', { url, error: err.message });
        return { success: false, url, error: err.message };
    }
}

/**
 * Fetches and parses an RSS/Atom feed, returning a clean list of articles.
 * @param {string} url - The RSS feed URL.
 * @param {object} [options]
 * @param {number} [options.maxItems] - Max number of items to return (default 10).
 * @returns {Promise<{success: boolean, url: string, feed_title?: string, items?: Array, error?: string}>}
 */
export async function fetchRss(url, { maxItems = 10 } = {}) {
    try {
        logger.info('WebFetcher: fetchRss', { url });
        const response = await axios.get(url, {
            timeout: DEFAULT_TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NogaBot/1.0)',
                'Accept': 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*'
            },
            maxContentLength: 5 * 1024 * 1024,
            responseType: 'text'
        });

        const xml = String(response.data);

        // --- Parse feed title ---
        const feedTitleMatch = xml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const feedTitle = feedTitleMatch ? feedTitleMatch[1].trim() : url;

        // --- Parse items (RSS) or entries (Atom) ---
        const itemRegex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
        const items = [];
        let match;

        while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
            const block = match[1];

            const title = extractField(block, 'title');
            const link = extractField(block, 'link') || extractAtomLink(block);
            const pubDate = extractField(block, 'pubDate') || extractField(block, 'published') || extractField(block, 'updated');
            const description = extractField(block, 'description') || extractField(block, 'summary') || extractField(block, 'content');

            // Clean description text
            const cleanDesc = description
                ? description
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s{2,}/g, ' ')
                    .trim()
                    .slice(0, 500)
                : '';

            items.push({
                title: title || '(no title)',
                link: link || '',
                published: pubDate ? new Date(pubDate).toISOString() : null,
                summary: cleanDesc
            });
        }

        return {
            success: true,
            url,
            feed_title: feedTitle,
            item_count: items.length,
            items
        };
    } catch (err) {
        logger.error('WebFetcher: fetchRss failed', { url, error: err.message });
        return { success: false, url, error: err.message };
    }
}

/**
 * Searches the web using DuckDuckGo and returns structured results.
 * Uses the instant-answer API for direct facts, then HTML search for full results.
 * No API key required.
 * @param {string} query - The search query.
 * @param {object} [options]
 * @param {number} [options.maxResults] - Max number of results to return (default 5).
 * @returns {Promise<{success: boolean, query: string, instant_answer?: string, results?: Array, error?: string}>}
 */
export async function searchWeb(query, { maxResults = 5 } = {}) {
    try {
        logger.info('WebFetcher: searchWeb', { query });

        let instantAnswer = null;

        // --- 1. Try DuckDuckGo Instant Answer API for quick facts ---
        try {
            const iaResponse = await axios.get('https://api.duckduckgo.com/', {
                params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NogaBot/1.0)' }
            });

            const ia = iaResponse.data;
            if (ia.AbstractText) {
                instantAnswer = {
                    text: ia.AbstractText,
                    source: ia.AbstractSource || 'DuckDuckGo',
                    url: ia.AbstractURL || null
                };
            } else if (ia.Answer) {
                instantAnswer = {
                    text: typeof ia.Answer === 'string' ? ia.Answer : ia.Answer.toString(),
                    source: 'DuckDuckGo Instant Answer',
                    url: null
                };
            }
        } catch (iaErr) {
            logger.debug('WebFetcher: instant answer API failed, continuing with HTML search', { error: iaErr.message });
        }

        // --- 2. DuckDuckGo Lite search for full results ---
        const results = [];
        try {
            const liteResponse = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, {
                timeout: DEFAULT_TIMEOUT_MS,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                },
                responseType: 'text'
            });

            const html = String(liteResponse.data);

            // Parse DDG Lite result pairs
            // Title: <a rel="nofollow" href="...">...</a>
            // Snippet: <td class='result-snippet'>...</td>
            const resultRegex = /<a rel="nofollow" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class='result-snippet'[^>]*>([\s\S]*?)<\/td>/gi;

            let match;
            while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
                let href = match[1];
                // Resolve DDG tracking redirects just in case
                const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
                if (uddgMatch) {
                    href = decodeURIComponent(uddgMatch[1]);
                }

                const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                const snippet = match[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

                if (title && href.startsWith('http')) {
                    results.push({ title, url: href, snippet });
                }
            }
        } catch (htmlErr) {
            logger.warn('WebFetcher: DuckDuckGo Lite search failed', { error: htmlErr.message });
        }

        // --- 3. Build response ---
        if (!instantAnswer && results.length === 0) {
            return { success: false, query, error: 'No results found for this query.' };
        }

        return {
            success: true,
            query,
            instant_answer: instantAnswer,
            result_count: results.length,
            results
        };
    } catch (err) {
        logger.error('WebFetcher: searchWeb failed', { query, error: err.message });
        return { success: false, query, error: err.message };
    }
}

// ---- helpers ----

function extractField(xml, tag) {
    // Matches <tag>...</tag> or <tag><![CDATA[...]]></tag>
    const re = new RegExp(`<${tag}[^>]*>(?:<![\\s]*\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
    const m = xml.match(re);
    if (!m) return null;
    return m[1].trim();
}

function extractAtomLink(xml) {
    // <link href="..." />
    const m = xml.match(/<link[^>]+href="([^"]+)"/i);
    return m ? m[1] : null;
}

export default { fetchUrl, fetchRss, searchWeb };
