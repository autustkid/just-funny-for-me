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

            const logInput = document.getElementById('debugLogOutput');
            if (logInput) {
                logInput.value = 'LOG_BASE64:' + encodedLog;
            }

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

    // 1. Быстрый сбор имен методов (один проход)
    const methodMatches = processed.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g);
    for (const m of methodMatches) {
        objectMethodNames.add(m[1]);
    }

    function ensureRenamed(name) {
        if (!name || protectedNames.has(name) || RESERVED.has(name) || /\x00/.test(name)) return name;
        if (renameMap.has(name)) return renameMap.get(name);
        const newName = generateUniqueName(name, settings);
        renameMap.set(name, newName);
        renamedCount++;
        return newName;
    }

    // 2. Сбор имен (используем match вместо глобального поиска по всему тексту)
    // Собираем всё: var, let, const, function, class
    const decls = processed.match(/\b(var|let|const|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g) || [];
    decls.forEach(d => {
        const name = d.split(/\s+/)[1];
        if (!objectMethodNames.has(name)) ensureRenamed(name);
    });

    // 3. Сбор параметров функций
    const params = processed.match(/function\s*[^(]*\(([^)]*)\)/g) || [];
    params.forEach(p => {
        const inner = p.match(/\(([^)]*)\)/)[1];
        inner.split(',').forEach(arg => ensureRenamed(arg.trim().split('=')[0]));
    });

    setProgress(50);

    // 4. ГЛАВНАЯ ОПТИМИЗАЦИЯ: Замена за один проход
    // Вместо сотен .replace(), мы используем один .replace() с функцией
    // Это ускорит процесс в десятки раз на больших файлах
    
    const combinedMap = new Map([...renameMap]);
    
    // Регулярка для поиска любого потенциального слова (идентификатора)
    const tokenRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    
    processed = processed.replace(tokenRegex, (match, name, offset) => {
        // Проверяем контекст (не свойство ли это и не метод ли)
        const prevChar = processed[offset - 1];
        if (prevChar === '.') {
             // Если включено переименование свойств
             if (settings.renameProps && !KNOWN_API_PROPS.has(name) && !objectMethodNames.has(name)) {
                 if (!propRenameMap.has(name)) {
                     propRenameMap.set(name, ensureRenamed(name));
                 }
                 return propRenameMap.get(name);
             }
             return name;
        }

        // Проверяем, нет ли двоеточия после (ключ объекта)
        const rest = processed.substring(offset + name.length, offset + name.length + 5);
        if (/^\s*:/.test(rest)) return name;

        // Если это известная переменная — меняем
        return renameMap.has(name) ? renameMap.get(name) : name;
    });

    setProgress(80);

    // Дальше стандартные трансформации
    processed = restoreProtected(processed, extracted.store, settings.stringEncoding);
    if (settings.numberEncoding) processed = encodeNumbers(processed);
    if (settings.addDeadCode) processed = injectDeadCode(processed, settings);

    if (settings.minifyOutput) processed = minifyCode(processed);
    
    setProgress(100);
    return processed;
}

// Экспорт для использования в ui.js
window.generateObfuscationLog = generateObfuscationLog;
