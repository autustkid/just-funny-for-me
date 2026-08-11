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

/** Генерирует Base64-лог для отправки мне */
function generateObfuscationLog(settings, stats) {
    const logObj = {
        v: "2.3",                          // версия лога
        t: Date.now(),
        input: stats.inputSize,
        output: stats.outputSize,
        ratio: parseFloat(stats.ratio),
        time: stats.timeMs,
        renamed: stats.renamedCount,
        deadCode: stats.deadCodeInjected || 0,
        shuffled: stats.functionsShuffled || 0,
        protected: stats.protectedCount || 0,
        settings: {
            naming: settings.namingStyle,
            vars: settings.renameVars,
            funcs: settings.renameFuncs,
            params: settings.renameParams,
            classes: settings.renameClasses,
            props: settings.renameProps,
            strings: settings.stringEncoding,
            numbers: settings.numberEncoding,
            deadcode: settings.addDeadCode,
            shuffle: settings.shuffleOrder,
            antidebug: settings.addDebugProtection,
            noconsole: settings.addConsoleDisable,
            selfdefend: settings.selfDefending,
            iife: settings.wrapIIFE,
            minify: settings.minifyOutput
        },
        warnings: stats.warnings || [],
        topRenamed: stats.topRenamed || []
    };

    const jsonStr = JSON.stringify(logObj);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    return base64;
}

async function startObfuscation() {
    const $ = id => document.getElementById(id);
    const code = $('inputCode').value;
    if (!code.trim()) { setStatus('No input code!', 'error'); return; }

    resetNameGenerator();
    renamedCount = 0;
    window.lastDeadCodeCount = 0;
    window.lastShuffledCount = 0;
    window.obfuscationWarnings = [];
    window.topRenamedNames = [];

    const extracted = extractProtected(code);
    const analysis  = analyzeCode(extracted.code);

    const answer = await showModal(analysis.external);
    if (!answer) return;

    const settings = getSettings();
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
            const result = processCode(code, settings, protectedNames);

            const endTime = performance.now();
            const timeMs = Math.round(endTime - startTime);

            const stats = {
                inputSize: code.length,
                outputSize: result.length,
                ratio: (result.length / Math.max(code.length, 1)).toFixed(3),
                timeMs: timeMs,
                renamedCount: renamedCount,
                deadCodeInjected: window.lastDeadCodeCount || 0,
                functionsShuffled: window.lastShuffledCount || 0,
                protectedCount: protectedNames.size,
                warnings: window.obfuscationWarnings || [],
                topRenamed: window.topRenamedNames || []
            };

            $('outputCode').value = result;
            $('outputLines').textContent = result.split('\n').length + ' lines';
            $('statOutputSize').textContent = result.length;
            $('statRatio').textContent = stats.ratio;
            $('statTime').textContent = timeMs;
            $('statRenamed').textContent = renamedCount;

            setStatus('✓ Done!', 'success');

            const encodedLog = generateObfuscationLog(settings, stats);

            console.log('%c[Obfuscator Debug Log] Скопируй строку ниже полностью и отправь мне:', 
                       'color:#0ff; font-weight:bold; font-size:15px');
            console.log('LOG_BASE64:' + encodedLog);

        } catch (err) {
            setStatus('Error: ' + err.message, 'error');
            console.error('[Obfuscator Error]', err);
        }

        $('loadingOverlay').classList.remove('active');
        setTimeout(() => setProgress(0), 1000);
    }, isLarge ? 80 : 10);
}

// ==================== CORE PROCESSING ====================

function processCode(code, settings, protectedNames) {
    const extracted = extractProtected(code);
    let processed = extracted.code;
    setProgress(20);

    const renameMap = new Map();
    const propRenameMap = new Map();
    const objectMethodNames = new Set();

    // Собираем имена методов объектов (чтобы не ломать их)
    {
        let m;
        const r = /(?:^|[,{])\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]\s*function|\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm;
        while ((m = r.exec(processed)) !== null) {
            if (m[1]) objectMethodNames.add(m[1]);
            if (m[2]) objectMethodNames.add(m[2]);
        }
    }

    function shouldRename(name) {
        if (!name || name.length === 0) return false;
        if (protectedNames.has(name)) return false;
        if (RESERVED.has(name)) return false;
        if (/\x00/.test(name)) return false;
        return true;
    }

    function ensureRenamed(name) {
        if (!shouldRename(name)) return name;
        if (renameMap.has(name)) return renameMap.get(name);
        const newName = generateUniqueName(name, settings);
        renameMap.set(name, newName);
        renamedCount++;
        return newName;
    }

    // === Сбор переименований (функции, переменные, параметры, классы) ===
    if (settings.renameFuncs) {
        let m; const r = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
        while ((m = r.exec(processed)) !== null) ensureRenamed(m[1]);
    }

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
                const local = (p.split(':').pop() || p).split('=')[0].trim().replace(/^\.\.\./, '');
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

        const r5 = /\bcatch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = r5.exec(processed)) !== null) ensureRenamed(m[1]);
    }

    if (settings.renameClasses) {
        let m; const r = /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = r.exec(processed)) !== null) ensureRenamed(m[1]);
    }

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

    // Убираем имена методов объектов из переименования
    for (const name of objectMethodNames) {
        if (renameMap.has(name)) {
            renameMap.delete(name);
            renamedCount = Math.max(0, renamedCount - 1);
        }
    }

    setProgress(45);

    // === Сбор свойств для renameProps ===
    if (settings.renameProps) {
        let m;
        const rProps = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((m = rProps.exec(processed)) !== null) {
            const prop = m[1];
            if (!KNOWN_API_PROPS.has(prop) && 
                !RESERVED.has(prop) && 
                !objectMethodNames.has(prop) && 
                !propRenameMap.has(prop)) {
                
                const newName = renameMap.has(prop) ? renameMap.get(prop) : generateUniqueName(prop, settings);
                propRenameMap.set(prop, newName);
                if (!renameMap.has(prop)) renamedCount++;
            }
        }
    }

    setProgress(55);

    // === Применение переименований ===
    if (renameMap.size > 0) {
        const sorted = [...renameMap.entries()].sort((a, b) => b[0].length - a[0].length);
        let ri = 0;
        const phMap = new Map();

        for (const [orig, repl] of sorted) {
            const ph = `\x01R${ri++}\x01`;
            phMap.set(ph, repl);
            const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            processed = processed.replace(
                new RegExp(`(?<![.a-zA-Z_$0-9])${esc}(?![a-zA-Z_$0-9])`, 'g'),
                (match, offset) => {
                    const after = processed.substring(offset + match.length);
                    if (/^\s*:(?!:)/.test(after) || (/^\s*\(/.test(after) && objectMethodNames.has(match))) {
                        return match;
                    }
                    return ph;
                }
            );
        }
        for (const [ph, name] of phMap) processed = processed.split(ph).join(name);
    }

    setProgress(65);

    // === Применение переименования свойств ===
    if (propRenameMap.size > 0) {
        const sorted = [...propRenameMap.entries()].sort((a, b) => b[0].length - a[0].length);
        let pi = 0;
        const phMap = new Map();

        for (const [orig, repl] of sorted) {
            const ph = `\x02P${pi++}\x02`;
            phMap.set(ph, repl);
            const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            processed = processed.replace(new RegExp(`\\.${esc}(?![a-zA-Z_$0-9])`, 'g'), '.' + ph);
        }
        for (const [ph, name] of phMap) processed = processed.split(ph).join(name);
    }

    setProgress(75);

    processed = restoreProtected(processed, extracted.store, settings.stringEncoding);

    if (settings.numberEncoding) processed = encodeNumbers(processed);
    if (settings.addDeadCode) processed = injectDeadCode(processed, settings);
    if (settings.shuffleOrder) processed = shuffleTopLevelFunctions(processed);

    let header = '';
    if (settings.addDebugProtection) {
        header += `(function(){var _f=function(){};_f.constructor('debugger')();setInterval(function(){var _g=function(){};_g.constructor('debugger')();},100);})();\n`;
    }
    if (settings.addConsoleDisable) {
        header += `(function(){var _c=window.console;var _n=function(){};['log','warn','info','debug','error','trace','dir','table','count','time','timeEnd','assert','group','groupEnd'].forEach(function(m){try{_c[m]=_n;}catch(e){}});})();\n`;
    }
    if (settings.selfDefending) {
        header = `(function(){var _sd=function _sd(){if(/\\n[\\s]+/.test(_sd.toString())){(function f(){f()})();}};_sd();})();\n` + header;
    }

    if (settings.wrapIIFE && !isAlreadyIIFE(code)) {
        processed = `(function(){\n${processed}\n})();`;
    }

    if (settings.minifyOutput) processed = minifyCode(processed);

    processed = header + processed;
    if (!settings.minifyOutput) processed = processed.replace(/\n{3,}/g, '\n\n');

    setProgress(95);
    return processed;
}

// Экспорт для использования в ui.js
window.generateObfuscationLog = generateObfuscationLog;
