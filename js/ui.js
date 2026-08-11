'use strict';

const $ = id => document.getElementById(id);

// ── Modal ────────────────────────────────────────────────────
let pendingResolve = null;

function showModal(externalVars) {
    return new Promise(resolve => {
        pendingResolve = resolve;
        const section = $('externalVarsSection');
        const varsDiv = $('detectedVars');
        if (externalVars.size > 0) {
            section.classList.add('active');
            varsDiv.innerHTML = '';
            for (const v of externalVars) {
                const span = document.createElement('span');
                span.textContent = v;
                varsDiv.appendChild(span);
            }
        } else {
            section.classList.remove('active');
        }
        $('extraProtectedVars').value = '';
        $('modalOverlay').classList.add('active');
    });
}

$('btnFullCode').addEventListener('click', () => {
    $('modalOverlay').classList.remove('active');
    if (pendingResolve) pendingResolve({ isFullCode: true, extraProtected: [] });
});

$('btnFragment').addEventListener('click', () => {
    $('modalOverlay').classList.remove('active');
    const extra = $('extraProtectedVars').value
        .split(',').map(s => s.trim()).filter(Boolean);
    if (pendingResolve) pendingResolve({ isFullCode: false, extraProtected: extra });
});

$('modalOverlay').addEventListener('click', e => {
    if (e.target === $('modalOverlay')) {
        $('modalOverlay').classList.remove('active');
        if (pendingResolve) pendingResolve(null);
    }
});

// ── Progress & status ────────────────────────────────────────
function setProgress(val) {
    $('progressFill').style.width = val + '%';
}

function setStatus(msg, type = '') {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + type;
    if (type === 'success') {
        setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 4000);
    }
}

// ── Input stats ──────────────────────────────────────────────
function updateInputStats() {
    const v = $('inputCode').value;
    $('inputLines').textContent  = v.split('\n').length + ' lines';
    $('statInputSize').textContent = v.length;
}

// ── Copy / Download / Clear / Sample ────────────────────────
function copyOutput() {
    const o = $('outputCode').value;
    if (!o) { setStatus('Nothing to copy', 'error'); return; }
    navigator.clipboard.writeText(o)
        .then(() => setStatus('✓ Copied!', 'success'))
        .catch(() => {
            $('outputCode').select();
            document.execCommand('copy');
            setStatus('✓ Copied!', 'success');
        });
}

function downloadOutput() {
    const o = $('outputCode').value;
    if (!o) { setStatus('Nothing to download', 'error'); return; }
    const b = new Blob([o], { type: 'application/javascript' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'obfuscated_' + Date.now() + '.js';
    a.click();
    URL.revokeObjectURL(u);
    setStatus('✓ Downloaded!', 'success');
}

function clearAll() {
    $('inputCode').value  = '';
    $('outputCode').value = '';
    $('inputLines').textContent  = '0 lines';
    $('outputLines').textContent = '0 lines';
    ['statInputSize','statOutputSize','statRatio','statTime','statRenamed']
        .forEach(id => $(id).textContent = '0');
    setStatus('Cleared', 'success');
}

function loadSample() {
    $('inputCode').value = `(async () => {
    const socket = {
        self: new WebSocket("wss://example.com"),
        log: console.log,
        error: console.error,
        async connect() {
            return new Promise(resolve => {
                this.self.addEventListener("open", () => resolve(true));
                this.self.addEventListener("error", () => resolve(false));
            });
        }
    };

    const decoder = data => {
        const view = new DataView(data.buffer);
        const type = view.getUint8(0);
        const payload = data.slice(1);
        return [type, payload];
    };

    const ui = {
        home: {
            card: document.querySelector(".home-card"),
            playBtn: document.querySelector(".play-btn"),
            nameInput: document.querySelector(".name-input")
        },
        game: {
            canvas: document.querySelector("canvas"),
            minimap: document.querySelector(".minimap"),
            leaderboard: document.querySelector(".leaderboard")
        }
    };

    const handlers = new Map();

    handlers.set(1, (playerData) => {
        console.log("Player spawned:", playerData);
        ui.home.card.style.display = "none";
    });

    handlers.set(2, (positions) => {
        console.log("Update received, entities:", positions.length);
    });

    handlers.set(3, (scores) => {
        console.log("Leaderboard update");
    });

    const ok = await socket.connect();
    if (!ok) {
        alert("Connection failed");
        return;
    }

    ui.home.card.style.display = "block";

    socket.self.addEventListener("message", buff => {
        const d = decoder(new Uint8Array(buff.data));
        const type = d[0];
        const data = d[1];
        if (!handlers.has(type)) return;
        handlers.get(type)(data);
    });

    socket.self.addEventListener("open", () => {
        socket.log(socket.self.url + " Opened!");
    });

    socket.self.addEventListener("close", close => {
        socket.log("Closed: " + close.code);
    });

    socket.self.addEventListener("error", error => {
        socket.error(error);
    });

    ui.home.playBtn.addEventListener("click", () => {
        const name = ui.home.nameInput.value || "Player";
        const encoded = new TextEncoder().encode(name);
        socket.self.send(encoded);
    });
})();`;
    updateInputStats();
    setStatus('Sample loaded', 'success');
}

// ── Event listeners ──────────────────────────────────────────
$('inputCode').addEventListener('input', updateInputStats);
$('inputCode').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s  = ta.selectionStart;
        const en = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(en);
        ta.selectionStart = ta.selectionEnd = s + 4;
    }
});

$('btnObfuscate').addEventListener('click', startObfuscation);
$('btnCopy').addEventListener('click', copyOutput);
$('btnDownload').addEventListener('click', downloadOutput);
$('btnClear').addEventListener('click', clearAll);
$('btnSample').addEventListener('click', loadSample);

// ── Init ─────────────────────────────────────────────────────
loadSample();
