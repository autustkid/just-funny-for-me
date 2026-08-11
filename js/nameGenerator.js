'use strict';

let globalCounter = 0;
const usedNames = new Set();

function resetNameGenerator() {
    globalCounter = 0;
    usedNames.clear();
}

function generateUniqueName(originalName, settings) {
    let name;
    let tries = 0;
    do {
        globalCounter++;
        name = buildName(originalName, settings, globalCounter);
        tries++;
        if (tries > 1000) {
            name = settings.prefix + '__' + globalCounter + '_' + Date.now();
            break;
        }
    } while (usedNames.has(name) || RESERVED.has(name));
    usedNames.add(name);
    return name;
}

function buildName(original, settings, counter) {
    const prefix     = settings.prefix;
    const pad        = settings.underscorePad;
    const us         = '_'.repeat(pad);
    const style      = settings.namingStyle;

    function abbreviate(n) {
        const parts = n
            .replace(/([A-Z])/g, ' $1')
            .replace(/[_\-]/g, ' ')
            .trim()
            .split(/\s+/);
        let a = '';
        for (const p of parts) if (p.length > 0) a += p[0].toUpperCase();
        if (a.length < 2) a = n.substring(0, Math.min(4, n.length)).toUpperCase();
        return a + counter;
    }

    switch (style) {
        case 'random_num':
            return prefix + '_' + counter + '' + Math.floor(Math.random() * 9000 + 1000);

        case 'underscores':
            return us + abbreviate(original) + us;

        case 'hex':
            return prefix + '_0x' +
                counter.toString(16).padStart(4, '0') +
                Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');

        case 'mixed': {
            const styles = ['random_num', 'underscores', 'hex'];
            return buildName(original, { ...settings, namingStyle: styles[counter % 3] }, counter);
        }

        case 'unicode': {
            const runes = 'ᚠᚢᚦᚨᚱᚲᚺᚾᛁᛃᛇᛈᛉᛊᛋᛏᛒᛖᛗᛚᛜᛞᛟ';
            let r = '_0x';
            for (let i = 0; i < 4; i++)
                r += runes[Math.floor(Math.random() * runes.length)];
            return r + counter;
        }

        default:
            return prefix + '_' + counter;
    }
}
