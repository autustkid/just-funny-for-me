'use strict';

let renamedCount = 0;

function getSettings() {
    const $ = id => document.getElementById(id);
    return {
        prefix:             $('prefix').value || 'by_utf8xbot',
        namingStyle:        $('namingStyle').value,
        underscorePad:      parseInt($('underscorePad').value) || 15,
        renameVars:         $('renameVars').checked,
        renameFuncs:        $('renameFuncs').checked,
        renameParams:       $('renameParams').checked,
        renameClasses:      $('renameClasses').checked,
        renameProps:        $('renameProps').checked,
        stringEncoding:     $('stringEncoding').checked,
        numberEncoding:     $('numberEncoding').checked,
        addDeadCode:        $('addDeadCode').checked,
        shuffleOrder:       $('shuffleOrder').checked,
        addDebugProtection: $('addDebugProtection').checked,
        addConsoleDisable:  $('addConsoleDisable').checked,
        selfDefending:      $('selfDefending').checked,
        wrapIIFE:           $('wrapIIFE').checked,
        minifyOutput:       $('minifyOutput').checked,
    };
}

async function startObfuscation() {
    const $ = id => document.getElementById(id);
    const code = $('inputCode').value;
    if (!code.trim()) { setStatus('No input code!', 'error'); return; }

    resetNameGenerator();
    renamedCount = 0;

    const extracted = extractProtected(code);
    const analysis  = analyzeCode(extracted.code);

    const answer = await showModal(analysis.external);
    if (!answer) return;

    const settings       = getSettings();
    const protectedNames = new Set(RESERVED);

    if (!answer.isFullCode) {
        for (const ext of analysis.external) protectedNames.add(ext);
    }
    for (const v of answer.extraProtected) protectedNames.add(v);

    const isLarge = code.length > 30000;
    if (isLarge) {
        $('loadingOverlay').classList.add('active');
        $('loadingText').textContent = 'Processing ' + code.length + ' chars...';
    }
    setProgress(10);

    setTimeout(() => {
        const startTime = performance.now();
        try {
            const result  = processCode(code, settings, protectedNames);
            const endTime = performance.now();

            setProgress(100);
            $('outputCode').value         = result;
            $('outputLines').textContent  = result.split('\n').length + ' lines';
            $('statOutputSize').textContent = result.length;
            $('statRatio').textContent    = (result.length / Math.max(code.length, 1)).toFixed(2);
            $('statTime').textContent     = Math.round(endTime - startTime);
            $('statRenamed').textContent  = renamedCount;
            setStatus('✓ Done!', 'success');
        } catch (err) {
            setStatus('Error: ' + err.message, 'error');
            console.error('[Obfuscator]', err);
        }
        $('loadingOverlay').classList.remove('active');
        setTimeout(() => setProgress(0), 1000);
    }, isLarge ? 60 : 10);
}

// ── Core processing ──────────────────────────────────────────
function processCode(code, settings, protectedNames) {
    const extracted = extractProtected(code);
    let processed   = extracted.code;
    setProgress(20);

    const renameMap    = new Map();
    const propRenameMap = new Map();

    function shouldRename(name) {
        if (!name || name.length === 0) return false;
        if (protectedNames.has(name))   return false;
        if (RESERVED.has(name))         return false;
        if (/\x00/.test(name))          return false;
        return true;
    }

    function ensureRenamed(name) {
        if (!shouldRename(name))       return name;
        if (renameMap.has(name))       return renameMap.get(name);
        const newName = generateUniqueName(name, settings);
        renameMap.set(name, newName);
        renamedCount++;
        return newName;
    }

    // ── Collect function declarations ──
    if (settings.renameFuncs) {
        let m;
        const r = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
        while ((m = r.exec(processed)) !== null) ensureRenamed(m[1]);
    }

    // ── Collect variable declarations ──
    if (settings.renameVars) {
        let m;

        const r1 = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
        while ((m = r1.exec(processed)) !== null) ensureRenamed(m[1]);

        const r1m = /\b(?:const|let|var)\s+((?:[^;{](?!const |let |var ))+)/g;
        while ((m = r1m.exec(processed)) !== null)
            splitDeclarations(m[1]).forEach(n => ensureRenamed(n));

        const r2 = /\b(?:const|let|var)\s+\{([^}]+)\}/g;
        while ((m = r2.exec(processed)) !== null) {
            m[1].split(',').forEach(p => {
                p = p.trim(); if (!p) return;
                const parts = p.split(':');
                const local = (parts.length > 1 ? parts[parts.length - 1] : parts[0])
                    .trim().split('=')[0].trim().replace(/^\.\.\./, '');
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(local)) ensureRenamed(local);
            });
        }

        const r3 = /\b(?:const|let|var)\s+\[([^\]]+)\]/g;
        while ((m = r3.exec(processed)) !== null) {
            m[1].split(',').forEach(p => {
                p = p.trim().split('=')[0].trim().replace(/^\.\.\./, '');
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p)) ensureRenamed(p);
            });
        }

        const r4 = /\bfor\s*\(\s*(?:let|var|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = r4.exec(processed)) !== null) ensureRenamed(m[1]);

        const r4b = /\bfor\s*\(\s*(?:let|var|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+(?:of|in)\b/g;
        while ((m = r4b.exec(processed)) !== null) ensureRenamed(m[1]);

        const r5 = /\bcatch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = r5.exec(processed)) !== null) ensureRenamed(m[1]);
    }

    // ── Collect class names ──
    if (settings.renameClasses) {
        let m;
        const r = /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = r.exec(processed)) !== null) ensureRenamed(m[1]);
    }

    // ── Collect parameters ──
    if (settings.renameParams) {
        let m;
        const r1 = /function\s*[a-zA-Z_$]*\s*\(([^)]*)\)/g;
        while ((m = r1.exec(processed)) !== null) extractParams(m[1]).forEach(p => ensureRenamed(p));

        const r2 = /\(([^)]*)\)\s*=>/g;
        while ((m = r2.exec(processed)) !== null) extractParams(m[1]).forEach(p => ensureRenamed(p));

        const r3 = /(?<![.a-zA-Z_$0-9])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g;
        while ((m = r3.exec(processed)) !== null) {
            if (m[1] !== 'async') ensureRenamed(m[1]);
        }
    }

    setProgress(40);

    // ── Collect properties to rename ──
    if (settings.renameProps) {
        let m;
        const rProps = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = rProps.exec(processed)) !== null) {
            const propName = m[1];
            if (!KNOWN_API_PROPS.has(propName) && !RESERVED.has(propName) && !propRenameMap.has(propName)) {
                if (renameMap.has(propName)) {
                    propRenameMap.set(propName, renameMap.get(propName));
                } else {
                    const newName = generateUniqueName(propName, settings);
                    propRenameMap.set(propName, newName);
                    renamedCount++;
                }
            }
        }
    }

    setProgress(50);

    // ── Apply identifier renames (placeholder method) ──
    if (renameMap.size > 0) {
        const sorted = [...renameMap.entries()].sort((a, b) => b[0].length - a[0].length);
        let ri = 0;
        const renamePhs = new Map();

        for (const [original, replacement] of sorted) {
            const rph = `\x01R${ri++}\x01`;
            renamePhs.set(rph, replacement);
            const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex   = new RegExp(`(?<![.a-zA-Z_$0-9])${escaped}(?![a-zA-Z_$0-9])`, 'g');
            processed = processed.replace(regex, (match, offset) => {
                const after = processed.substring(offset + match.length);
                if (/^\s*:(?![:])/.test(after)) return match;
                return rph;
            });
        }

        for (const [rph, finalName] of renamePhs) {
            processed = processed.split(rph).join(finalName);
        }
    }

    setProgress(60);

    // ── Apply property renames ──
    if (propRenameMap.size > 0) {
        const sortedProps = [...propRenameMap.entries()].sort((a, b) => b[0].length - a[0].length);
        let pi = 0;
        const propPhs = new Map();

        for (const [original, replacement] of sortedProps) {
            const pph     = `\x02P${pi++}\x02`;
            propPhs.set(pph, replacement);
            const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex   = new RegExp(`\\.${escaped}(?![a-zA-Z_$0-9])`, 'g');
            processed     = processed.replace(regex, '.' + pph);
        }

        for (const [pph, finalName] of propPhs) {
            processed = processed.split(pph).join(finalName);
        }
    }

    setProgress(70);

    // ── Restore strings ──
    processed = restoreProtected(processed, extracted.store, settings.stringEncoding);

    // ── Number encoding ──
    if (settings.numberEncoding) processed = encodeNumbers(processed);

    setProgress(80);

    // ── Dead code ──
    if (settings.addDeadCode) processed = injectDeadCode(processed, settings);

    // ── Shuffle ──
    if (settings.shuffleOrder) processed = shuffleTopLevelFunctions(processed);

    // ── Protection headers ──
    let header = '';
    if (settings.addDebugProtection) {
        header +=
            `(function(){var _f=function(){};` +
            `_f.constructor('debugger')();` +
            `setInterval(function(){var _g=function(){};_g.constructor('debugger')();},100);` +
            `})();\n`;
    }
    if (settings.addConsoleDisable) {
        header +=
            `(function(){var _c=window.console;var _n=function(){};` +
            `['log','warn','info','debug','error','trace','dir','table',` +
            `'count','time','timeEnd','assert','group','groupEnd'].` +
            `forEach(function(m){try{_c[m]=_n;}catch(e){}});})();\n`;
    }

    // ── IIFE ──
    if (settings.wrapIIFE && !isAlreadyIIFE(code)) {
        processed = `(function(){\n${processed}\n})();`;
    }

    // ── Minify ──
    if (settings.minifyOutput) processed = minifyCode(processed);

    // ── Self-defending (after minify) ──
    if (settings.selfDefending) {
        const sd =
            `(function(){var _sd=function _sd(){` +
            `if(/\\n[\\s]+/.test(_sd.toString())){(function f(){f()})();}};` +
            `_sd();})();`;
        header = sd + '\n' + header;
    }

    processed = header + processed;
    if (!settings.minifyOutput) processed = processed.replace(/\n{3,}/g, '\n\n');

    setProgress(95);
    return processed;
}
