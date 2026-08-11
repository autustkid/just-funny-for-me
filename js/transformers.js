'use strict';

// ── Number encoding ──────────────────────────────────────────
function encodeNumbers(code) {
    const { code: clean, store } = extractProtected(code);
    const encoded = clean.replace(
        /(?<![a-zA-Z_$0-9.xXbBoO\x00\x01\x02])(\d+)(?![a-zA-Z_$0-9.xXbBoO\x00\x01\x02])/g,
        (m, numStr, offset) => {
            if (clean[offset - 1] === '\x00' || clean[offset + m.length] === '\x00') return m;
            const num = parseInt(numStr, 10);
            if (isNaN(num) || num > 100000 || num < 2) return m;
            const prefix2 = clean.substring(Math.max(0, offset - 2), offset);
            if (/0[xXbBoO]$/.test(prefix2)) return m;
            const a = Math.floor(Math.random() * (num - 1)) + 1;
            return `(${a}+${num - a})`;
        }
    );
    return restoreProtected(encoded, store, false);
}

// ── Dead code injection ──────────────────────────────────────
const DEAD_TEMPLATES = [
    v => `var ${v}=(function(a,b){return a?b:a})(!![],![]);`,
    v => `var ${v}=typeof undefined!=='undefined'?null:0;`,
    v => `if(Math.random()>2){void 0;}`,
    v => `var ${v}=Object['create']?Object['create'](null):{};`,
    v => `try{var ${v}=void 0;}catch(_){}`,
    v => `var ${v}=Date['now']()%2===0?void 0:null;`,
    v => `(function(x){return x;})(false);`,
    v => `var ${v}=(1===2)?'dead':'code';if(${v}==='dead'){void 0;}`,
];

function injectDeadCode(code, settings) {
    const lines  = code.split('\n');
    const result = [];

    for (let i = 0; i < lines.length; i++) {
        result.push(lines[i]);
        const trimmed = lines[i].trim();

        if (trimmed !== '}' && trimmed !== '};' && trimmed !== '});') continue;
        if (Math.random() > 0.4) continue;
        
        const next = (lines[i + 1] || '').trim();

        // else, catch, finally
        if (/^else\b/.test(next)) continue;
        if (/^catch\b/.test(next)) continue;
        if (/^finally\b/.test(next)) continue;

        const isSafeSpot =
            next === '' ||
            next === '}' ||
            next === '};' ||
            next === '});' ||
            i === lines.length - 1 ||
            /^(?:\/\/|\/\*)/.test(next);

        let depth = 0;
        for (let j = 0; j <= i; j++) {
            for (const ch of lines[j]) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
        }

        if (depth !== 0) continue;
        if (!isSafeSpot) continue;

        const deadVar = generateUniqueName('_dead', settings);
        const tpl = DEAD_TEMPLATES[Math.floor(Math.random() * DEAD_TEMPLATES.length)];
        result.push(tpl(deadVar));
    }

    return result.join('\n');
}

// ── Shuffle top-level functions ──────────────────────────────
function shuffleTopLevelFunctions(code) {
    const segments = [];
    const lines    = code.split('\n');
    let current    = [];
    let inFunc     = false;
    let depth      = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!inFunc && /^(?:async\s+)?function\s+[a-zA-Z_$]/.test(trimmed)) {
            if (current.length > 0) {
                segments.push({ type: 'other', text: current.join('\n') });
                current = [];
            }
            inFunc = true;
            depth  = 0;
        }
        current.push(line);
        if (inFunc) {
            for (const ch of line) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            if (depth === 0 && current.length > 1) {
                segments.push({ type: 'func', text: current.join('\n') });
                current = [];
                inFunc  = false;
            }
        }
    }
    if (current.length > 0) {
        segments.push({ type: inFunc ? 'func' : 'other', text: current.join('\n') });
    }

    const funcTexts  = [];
    const funcIndices = [];
    segments.forEach((s, i) => {
        if (s.type === 'func') { funcIndices.push(i); funcTexts.push(s.text); }
    });

    // Fisher-Yates shuffle
    for (let i = funcTexts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [funcTexts[i], funcTexts[j]] = [funcTexts[j], funcTexts[i]];
    }

    let fi = 0;
    return segments.map(s => s.type === 'func' ? funcTexts[fi++] : s.text).join('\n');
}

// ── Minifier ────────────────────────────────────────────────
function minifyCode(code) {
    const { code: clean, store } = extractProtected(code);
    let r = clean;
    r = r.replace(/^\s*\n/gm, '');
    r = r.replace(/[ \t]+/g, ' ');
    r = r.replace(/\n[ \t]*/g, '\n');
    r = r.replace(/\n+/g, '\n');
    r = r.replace(/[ \t]*([{};,\[\]])/g, '$1');
    r = r.replace(/([{};,\[\]])[ \t]*/g, '$1');

    const KW = [
        'return','typeof','instanceof','void','delete','throw',
        'new','in','of','await','yield','case','const','let','var',
        'function','class','extends','async','export','import','from','default',
    ];
    for (const kw of KW) {
        r = r.replace(new RegExp(`([^a-zA-Z_$0-9])${kw}([a-zA-Z_$0-9])`, 'g'), `$1${kw} $2`);
        r = r.replace(new RegExp(`([a-zA-Z_$0-9])${kw}([^a-zA-Z_$0-9])`, 'g'), `$1 ${kw}$2`);
    }

    r = r.split('\n').map(l => l.trim()).filter(Boolean).join('');
    r = r.replace(/  +/g, ' ');
    return restoreProtected(r, store, false).trim();
}
