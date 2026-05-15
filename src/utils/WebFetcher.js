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

        // --- 2. DuckDuckGo HTML search for full results ---
        const results = [];
        try {
            const htmlResponse = await axios.get('https://html.duckduckgo.com/html/', {
                params: { q: query },
                timeout: DEFAULT_TIMEOUT_MS,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html',
                    'Accept-Language': 'en-US,en;q=0.9,he;q=0.8'
                },
                responseType: 'text'
            });

            const html = String(htmlResponse.data);

            // Parse result blocks — DuckDuckGo HTML has .result class elements
            // Each result has: <a class="result__a" href="...">title</a>
            //                  <a class="result__snippet">snippet text</a>
            const resultBlockRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
            const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
            const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i;

            let blockMatch;
            while ((blockMatch = resultBlockRegex.exec(html)) !== null && results.length < maxResults) {
                const block = blockMatch[1];

                const titleMatch = block.match(titleRegex);
                const snippetMatch = block.match(snippetRegex);

                if (titleMatch) {
                    let href = titleMatch[1];
                    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
                    const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
                    if (uddgMatch) {
                        href = decodeURIComponent(uddgMatch[1]);
                    }

                    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
                    const snippet = snippetMatch
                        ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
                        : '';

                    if (title && href.startsWith('http')) {
                        results.push({ title, url: href, snippet });
                    }
                }
            }
        } catch (htmlErr) {
            logger.warn('WebFetcher: DuckDuckGo HTML search failed', { error: htmlErr.message });
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
