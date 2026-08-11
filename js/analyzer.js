'use strict';

/**
 * Scans the code (with placeholders) and returns:
 *  - declared  : Set of all locally declared identifiers
 *  - external  : Set of identifiers USED but not declared here
 */
function analyzeCode(cleanCode) {
    const declared       = new Set();
    const allIdentifiers = new Set();
    let m;

    // simple declarations
    const r1 = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    while ((m = r1.exec(cleanCode)) !== null) declared.add(m[1]);

    // object destructuring
    const r1b = /\b(?:const|let|var)\s+\{([^}]+)\}/g;
    while ((m = r1b.exec(cleanCode)) !== null) {
        m[1].split(',').forEach(p => {
            p = p.trim();
            if (!p) return;
            const parts = p.split(':');
            const local = (parts.length > 1 ? parts[parts.length - 1] : parts[0])
                .trim().split('=')[0].trim().replace(/^\.\.\./, '');
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(local)) declared.add(local);
        });
    }

    // array destructuring
    const r1c = /\b(?:const|let|var)\s+\[([^\]]+)\]/g;
    while ((m = r1c.exec(cleanCode)) !== null) {
        m[1].split(',').forEach(p => {
            p = p.trim().split('=')[0].trim().replace(/^\.\.\./, '');
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p)) declared.add(p);
        });
    }

    // function declarations
    const r2 = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    while ((m = r2.exec(cleanCode)) !== null) declared.add(m[1]);

    // class declarations
    const r3 = /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((m = r3.exec(cleanCode)) !== null) declared.add(m[1]);

    // function parameters
    const r4 = /function\s*[a-zA-Z_$]*\s*\(([^)]*)\)/g;
    while ((m = r4.exec(cleanCode)) !== null) extractParams(m[1]).forEach(p => declared.add(p));

    const r4b = /\(([^)]*)\)\s*=>/g;
    while ((m = r4b.exec(cleanCode)) !== null) extractParams(m[1]).forEach(p => declared.add(p));

    // single-param arrow: x =>
    const r4c = /(?<![.a-zA-Z_$0-9])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g;
    while ((m = r4c.exec(cleanCode)) !== null) {
        if (m[1] !== 'async') declared.add(m[1]);
    }

    // for loops
    const r5 = /\bfor\s*\(\s*(?:let|var|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((m = r5.exec(cleanCode)) !== null) declared.add(m[1]);

    // catch clauses
    const r5b = /\bcatch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((m = r5b.exec(cleanCode)) !== null) declared.add(m[1]);

    // all identifiers
    const r6 = /(?<![.a-zA-Z_$0-9\x00])([a-zA-Z_$][a-zA-Z0-9_$]*)(?![a-zA-Z_$0-9\x00])/g;
    while ((m = r6.exec(cleanCode)) !== null) allIdentifiers.add(m[1]);

    const external = new Set();
    for (const id of allIdentifiers) {
        if (!declared.has(id) && !RESERVED.has(id)) external.add(id);
    }

    return { declared, allIdentifiers, external };
}

function extractParams(paramStr) {
    return paramStr
        .split(',')
        .map(p => p.split('=')[0].replace('...', '').trim())
        .filter(p => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p));
}

function splitDeclarations(str) {
    const names = [];
    let depth = 0, current = '';
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if ('({['.includes(ch)) depth++;
        else if (')}]'.includes(ch)) depth--;
        else if (ch === ',' && depth === 0) {
            const bare = current.trim().split('=')[0].trim();
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(bare)) names.push(bare);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        const bare = current.trim().split('=')[0].trim();
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(bare)) names.push(bare);
    }
    return names;
}

function isAlreadyIIFE(code) {
    const t = code.trim();
    return /^\(\s*(?:function|\(\s*\)|\([^)]*\))\s*(?:\w+\s*)?\(/.test(t) ||
           /^!\s*function\s*\(/.test(t) ||
           /^\(\s*async\s+(?:function|\()/.test(t);
}
