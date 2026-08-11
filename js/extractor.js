'use strict';

/**
 * Extracts strings, comments, template literals and regex literals
 * replacing them with safe placeholders so the obfuscator
 * never touches their contents.
 *
 * @param  {string} code  — original source
 * @returns {{ code: string, store: Array }}
 */
function extractProtected(code) {
    const store = [];
    let id = 0;
    let result = '';
    let i = 0;
    const len = code.length;

    function prevSignificant() {
        let j = result.length - 1;
        while (j >= 0 && /[ \t\n\r]/.test(result[j])) j--;
        return j >= 0 ? result[j] : '';
    }

    while (i < len) {

        // ── single-line comment ──
        if (code[i] === '/' && code[i + 1] === '/') {
            let end = code.indexOf('\n', i);
            if (end === -1) end = len;
            const ph = `\x00PH${id}\x00`;
            store.push({ id: id++, value: code.substring(i, end), placeholder: ph, isComment: true });
            result += ph;
            i = end;
            continue;
        }

        // ── multi-line comment ──
        if (code[i] === '/' && code[i + 1] === '*') {
            let end = code.indexOf('*/', i + 2);
            if (end === -1) end = len; else end += 2;
            const ph = `\x00PH${id}\x00`;
            store.push({ id: id++, value: code.substring(i, end), placeholder: ph, isComment: true });
            result += ph;
            i = end;
            continue;
        }

        // ── template literal ──
        if (code[i] === '`') {
            const start = i;
            i++;
            let depth = 0;
            while (i < len) {
                if (code[i] === '\\')                        { i += 2; continue; }
                if (depth === 0 && code[i] === '`')          { i++; break; }
                if (code[i] === '$' && code[i + 1] === '{')  { depth++; i += 2; continue; }
                if (depth > 0 && code[i] === '{')            { depth++; i++;    continue; }
                if (depth > 0 && code[i] === '}')            { depth--; i++;    continue; }
                i++;
            }
            const ph = `\x00PH${id}\x00`;
            store.push({ id: id++, value: code.substring(start, i), placeholder: ph, isTemplate: true });
            result += ph;
            continue;
        }

        // ── string literals ──
        if (code[i] === '"' || code[i] === "'") {
            const quote = code[i];
            const start = i;
            i++;
            while (i < len) {
                if (code[i] === '\\') { i += 2; continue; }
                if (code[i] === quote) { i++; break; }
                if (code[i] === '\n') break;
                i++;
            }
            const ph = `\x00PH${id}\x00`;
            store.push({ id: id++, value: code.substring(start, i), placeholder: ph, isString: true, quote });
            result += ph;
            continue;
        }

        // ── regex literal ──
        if (code[i] === '/' && i + 1 < len && code[i + 1] !== '/' && code[i + 1] !== '*') {
            const prev = prevSignificant();
            const opCtx  = '=({[,;!&|?:~^%+->'.includes(prev) || prev === '' || prev === '\n';
            const tail   = result.slice(-12).replace(/\s+$/, '');
            const kwCtx  = /\b(return|typeof|void|delete|in|instanceof|new|throw|case|of)$/.test(tail);
            if (opCtx || kwCtx) {
                const start = i;
                i++;
                let inCC = false;
                while (i < len && code[i] !== '\n') {
                    if (code[i] === '\\') { i += 2; continue; }
                    if (code[i] === '[')  { inCC = true;  i++; continue; }
                    if (code[i] === ']')  { inCC = false; i++; continue; }
                    if (!inCC && code[i] === '/') { i++; break; }
                    i++;
                }
                while (i < len && /[gimsuy]/.test(code[i])) i++;
                const ph = `\x00PH${id}\x00`;
                store.push({ id: id++, value: code.substring(start, i), placeholder: ph, isRegex: true });
                result += ph;
                continue;
            }
        }

        result += code[i];
        i++;
    }

    return { code: result, store };
}

/**
 * Restores placeholders back to their original (or encoded) values.
 *
 * @param {string}  code          — code with placeholders
 * @param {Array}   store         — store returned by extractProtected
 * @param {boolean} encodeStrings — hex-encode string content
 * @returns {string}
 */
function restoreProtected(code, store, encodeStrings) {
    let result = code;
    for (let idx = store.length - 1; idx >= 0; idx--) {
        const item = store[idx];
        let value = item.value;

        if (item.isComment) {
            value = '';
        } else if (item.isString && encodeStrings) {
            const quote = item.quote;
            const inner = value.slice(1, -1);
            let encoded = '';
            let ci = 0;
            while (ci < inner.length) {
                if (inner[ci] === '\\') {
                    encoded += inner[ci] + (inner[ci + 1] || '');
                    ci += 2;
                    continue;
                }
                const cc = inner.charCodeAt(ci);
                encoded += cc > 127
                    ? '\\u' + cc.toString(16).padStart(4, '0')
                    : '\\x' + cc.toString(16).padStart(2, '0');
                ci++;
            }
            value = quote + encoded + quote;
        }

        result = result.split(item.placeholder).join(value);
    }
    return result;
}
