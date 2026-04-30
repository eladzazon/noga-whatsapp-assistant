/**
 * Home Assistant Recognition Logic
 * Maps natural language Hebrew strings to entity IDs and service calls.
 */

/**
 * Identify action, location and entity from text based on mappings
 * @param {string} text - Natural language message
 * @param {Array} mappings - List of HA mappings from DB
 * @returns {Object|null} - { entity_id, action } or null
 */
export function findActionAndEntity(text, mappings) {
    if (!text || !mappings || !Array.isArray(mappings)) return null;

    const lowerText = text.toLowerCase();

    // 1. Identify locations mentioned in the text
    const mentionedLocations = mappings
        .map(m => m.location)
        .filter((loc, index, self) => loc && self.indexOf(loc) === index && lowerText.includes(loc.toLowerCase()));

    // 2. Identify action (turn on/off/toggle)
    const isOff = /(כבה|תכבה|סגור|כבי|להכבות|לכבות|תיכבה)/.test(lowerText);
    const isOn = /(דל|תדליק|פתח|דליקי|להדליק|תדליקי|פתיחה)/.test(lowerText);
    const action = isOff ? 'turn_off' : (isOn ? 'turn_on' : 'toggle');

    // 3. Filter candidates based on nickname match
    let candidates = mappings.filter(m => lowerText.includes(m.nickname.toLowerCase()));

    if (candidates.length === 0) return null;

    // 4. If locations were mentioned, prioritize candidates in those locations
    if (mentionedLocations.length > 0) {
        const locationMatches = candidates.filter(c => c.location && mentionedLocations.includes(c.location));
        if (locationMatches.length > 0) {
            candidates = locationMatches;
        }
    }

    // 5. Shortest nickname match usually wins if there are multiple (more specific)
    // Or longest if we want the most specific phrase. Strategy: longest nickname match.
    candidates.sort((a, b) => b.nickname.length - a.nickname.length);

    return {
        entity_id: candidates[0].entity_id,
        action: action
    };
}
