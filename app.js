/* ---------------------------
  Settings & Configuration
----------------------------*/
let settings = {
    ttsEnabled: true,
    ttsQuestion: true,
    ttsAnswer: true,
    soundEnabled: true
};

/* ---------------------------
  智能主题管理
----------------------------*/
const THEME_KEY = 'fc_theme';
const THEME_MODE_KEY = 'fc_theme_mode'; // auto, manual

let isDarkTheme = false;
let themeMode = 'auto'; // auto, manual

// 根据时间段判断主题
function getTimeBasedTheme() {
    const hour = new Date().getHours();
    // 晚上18点到早上6点使用夜间模式
    return (hour >= 18 || hour < 6) ? 'dark' : 'light';
}

// 检测系统主题偏好
function detectSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// 应用主题
function applyTheme(dark, recordUserChoice = false) {
    isDarkTheme = dark;
    const body = document.body;
    
    if (dark) {
        body.classList.add('dark-theme');
    } else {
        body.classList.remove('dark-theme');
    }
    
    // 更新主题按钮
    updateThemeButton();
    
    // 保存主题状态
    if (recordUserChoice) {
        localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
        themeMode = 'manual';
        localStorage.setItem(THEME_MODE_KEY, 'manual');
    }
}

// 更新主题按钮显示
function updateThemeButton() {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    
    if (themeMode === 'auto') {
        button.textContent = '🌓 自动';
    } else {
        button.textContent = isDarkTheme ? '🌙 暗色' : '☀️ 亮色';
    }
}

// 智能主题初始化
function initSmartTheme() {
    // 读取用户设置
    const savedTheme = localStorage.getItem(THEME_KEY);
    const savedMode = localStorage.getItem(THEME_MODE_KEY);
    
    themeMode = savedMode || 'auto';
    
    if (themeMode === 'manual' && savedTheme) {
        // 手动模式，使用用户保存的主题
        applyTheme(savedTheme === 'dark', false);
    } else {
        // 自动模式 - 使用时间判断
        const timeBasedTheme = getTimeBasedTheme();
        applyTheme(timeBasedTheme === 'dark', false);
    }
}

// 主题切换函数 - 三状态循环
function toggleTheme() {
    if (themeMode === 'auto') {
        // 自动 → 手动亮色
        themeMode = 'manual';
        applyTheme(false, true);
    } else if (themeMode === 'manual') {
        if (!isDarkTheme) {
            // 手动亮色 → 手动暗色
            applyTheme(true, true);
        } else {
            // 手动暗色 → 自动
            themeMode = 'auto';
            const timeBasedTheme = getTimeBasedTheme();
            applyTheme(timeBasedTheme === 'dark', false);
            localStorage.setItem(THEME_MODE_KEY, 'auto');
        }
    }
    updateThemeButton();
}

/* ---------------------------
  Storage & Groups
----------------------------*/
const GROUPS_KEY = 'fc_groups_v2';
const DEFAULT_GROUP = '默认题库';
let groups = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null') || [DEFAULT_GROUP];
let currentGroup = groups[0] || DEFAULT_GROUP;
let cards = [];
let initialQueue = [];
let reviewQueue = [];
let current = null;
let totalQueue = 0;
let currentIndex = 0;
let studyStage = ''; // '' | '筛选新题' | '复习不会'
let timerHandle = null;
let countdown = -1;
let warnSoundPlayed = false; // 警告音播放状态

// 防止重复答题的标志
let isAnswering = false;

function saveGroups() { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); }
function getGroupKey(name) { return 'fc_group_' + name; }

function loadGroupData(name) {
    const raw = localStorage.getItem(getGroupKey(name));
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
}

function saveGroupData(name, data) { localStorage.setItem(getGroupKey(name), JSON.stringify(data)); }

/* init groups */
function renderGroupSelect() {
    const sel = document.getElementById('groupSelect');
    sel.innerHTML = '';
    groups.forEach(g => {
        const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o);
    });
    sel.value = currentGroup;
}

function addGroup() {
    const n = prompt('新组名:');
    if (!n) return;
    if (groups.includes(n)) return alert('组已存在');
    groups.push(n);
    saveGroups();
    currentGroup = n;
    renderGroupSelect();
    loadGroup();
}

function renameGroup() {
    const old = currentGroup;
    const n = prompt('新组名:', old);
    if (!n) return;
    if (groups.includes(n)) return alert('组已存在');
    const data = loadGroupData(old);
    saveGroupData(n, data);
    localStorage.removeItem(getGroupKey(old));
    groups = groups.map(x => x === old ? n : x);
    saveGroups();
    currentGroup = n;
    renderGroupSelect();
    loadGroup();
}

function deleteGroup() {
    if (!confirm('确认删除当前组并清除数据？')) return;
    localStorage.removeItem(getGroupKey(currentGroup));
    groups = groups.filter(g => g !== currentGroup);
    if (!groups.length) groups = [DEFAULT_GROUP];
    saveGroups();
    currentGroup = groups[0];
    renderGroupSelect();
    loadGroup();
}

function switchGroup() {
    currentGroup = document.getElementById('groupSelect').value;
    loadGroup();
}

/* group data */
function loadGroup() {
    cards = loadGroupData(currentGroup) || [];
    cards.forEach(c => ensureCardFields(c));
    renderCardTable();
    updateStatus();
}

/* ---------------------------
  Parsing / Import preview
----------------------------*/

/* normalize fields */
function ensureCardFields(c) {
    c.q = c.q || '';
    c.a = c.a || '';
    c.correct = Number(c.correct || 0);
    c.unsure = Number(c.unsure || 0);
    c.incorrect = Number(c.incorrect || 0);
    c.mastered = !!c.mastered;
}

/* 智能识别各种格式的题目与答案 - 增强版 */
function parseQuestionsSmart(text) {
    const lines = text.split(/\r?\n/);
    const cards = [];
    let q = "", a = "";
    let inQuestion = false;
    let inAnswer = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // 跳过空行
        if (!line) {
            if (q && a) {
                cards.push({ q: q.trim(), a: a.trim(), correct: 0, unsure: 0, incorrect: 0, mastered: false });
                q = "";
                a = "";
            }
            inQuestion = false;
            inAnswer = false;
            continue;
        }

        // 检测题目开始的各种模式
        const isQuestionStart = 
            /^[Qq]\s*[:：]\s*/.test(line) || // Q: 或 q:
            /^(\d+[\.\、\．]?\s*)/.test(line) || // 数字开头
            /^[（(]\s*\d+\s*[）)]/.test(line) || // (1) 或 (1)
            /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(line) || // 圆圈数字
            /.*[？?]$/.test(line); // 以问号结尾

        // 检测答案开始的各种模式
        const isAnswerStart = 
            /^[Aa]\s*[:：]\s*/.test(line) || // A: 或 a:
            /^答\s*[:：]?\s*/.test(line); // 答： 或 答

        if (isQuestionStart && !isAnswerStart) {
            // 如果已经有题目和答案，先保存
            if (q && a) {
                cards.push({ q: q.trim(), a: a.trim(), correct: 0, unsure: 0, incorrect: 0, mastered: false });
            }
            
            // 开始新题目
            q = line.replace(/^[Qq]\s*[:：]\s*/, '')
                   .replace(/^(\d+[\.\、\．]?\s*)/, '')
                   .replace(/^[（(]\s*\d+\s*[）)]\s*/, '')
                   .trim();
            a = "";
            inQuestion = true;
            inAnswer = false;
        } 
        else if (isAnswerStart) {
            // 答案开始
            a = line.replace(/^[Aa]\s*[:：]\s*/, '')
                   .replace(/^答\s*[:：]?\s*/, '')
                   .trim();
            inQuestion = false;
            inAnswer = true;
        }
        else if (inQuestion) {
            // 在题目中，继续添加题目内容
            q += (q ? "\n" : "") + line;
        }
        else if (inAnswer || a) {
            // 在答案中，继续添加答案内容
            a += (a ? "\n" : "") + line;
        }
        else if (q && !a) {
            // 如果有题目但没有答案标记，假设这一行是答案
            a = line;
            inAnswer = true;
        }
        else {
            // 无法识别的情况，尝试作为新题目开始
            if (q && a) {
                cards.push({ q: q.trim(), a: a.trim(), correct: 0, unsure: 0, incorrect: 0, mastered: false });
            }
            q = line;
            a = "";
            inQuestion = true;
            inAnswer = false;
        }
    }

    // 处理最后一组
    if (q && a) {
        cards.push({ q: q.trim(), a: a.trim(), correct: 0, unsure: 0, incorrect: 0, mastered: false });
    }

    return cards;
}

/* 原有的智能解析函数（保留兼容性） */
function parseQA(text) {
    return parseQuestionsSmart(text);
}

/* preview import: parse, show modal, allow edit & select */
function previewImport() {
    const txt = document.getElementById('importText').value;
    let parsed = [];
    
    if (txt.trim()) {
        parsed = parseQA(txt);
        if (!parsed.length) {
            alert('未识别到任何题目，请检查格式。您可以在预览窗口中手动添加题目。');
        }
    }
    
    // render preview table
    const tbl = document.getElementById('previewTable');
    tbl.innerHTML = '<tr><th>导入?</th><th>问题</th><th>答案</th><th>操作</th></tr>';
    
    // 如果有解析结果，添加到表格
    parsed.forEach((item, idx) => {
        addRowToPreviewTable(tbl, item.q, item.a, true, idx);
    });
    
    // 如果没有解析到任何题目，添加一个空行供用户填写
    if (parsed.length === 0) {
        addRowToPreviewTable(tbl, "", "", true, 'new_0');
    }
    
    // store parsed temporarily
    window.__previewParsed = parsed;
    document.getElementById('previewModal').style.display = 'flex';
}

/* 添加行到预览表格 */
function addRowToPreviewTable(table, question, answer, checked, id) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', id);
    tr.innerHTML = `
        <td style="width:60px;text-align:center">
            <input type="checkbox" data-id="${id}" ${checked ? 'checked' : ''}>
        </td>
        <td>
            <input data-type="q" data-id="${id}" style="width:100%" value="${escapeHtml(question)}">
        </td>
        <td>
            <input data-type="a" data-id="${id}" style="width:100%" value="${escapeHtml(answer)}">
        </td>
        <td style="width:100px;text-align:center">
            <button class="preview-action-btn" onclick="removePreviewRow('${id}')">删除</button>
        </td>`;
    table.appendChild(tr);
}

/* 添加新行到预览表格 */
function addNewRowToPreview() {
    const tbl = document.getElementById('previewTable');
    const newId = 'new_' + Date.now();
    addRowToPreviewTable(tbl, "", "", true, newId);
}

/* 删除预览表格中的行 */
function removePreviewRow(id) {
    const row = document.querySelector(`#previewTable tr[data-id="${id}"]`);
    if (row) {
        row.remove();
    }
}

/* 按问题排序预览表格 */
function sortPreviewTable() {
    const tbl = document.getElementById('previewTable');
    const rows = Array.from(tbl.querySelectorAll('tr:not(:first-child)'));
    
    rows.sort((a, b) => {
        const aQ = a.querySelector('input[data-type="q"]').value.toLowerCase();
        const bQ = b.querySelector('input[data-type="q"]').value.toLowerCase();
        return aQ.localeCompare(bQ);
    });
    
    // 清空表格（保留标题行）
    while (tbl.rows.length > 1) {
        tbl.deleteRow(1);
    }
    
    // 重新添加排序后的行
    rows.forEach(row => tbl.appendChild(row));
}

/* confirm import from preview: read inputs, push selected into cards */
function confirmImport() {
    const tbl = document.getElementById('previewTable');
    const rows = tbl.querySelectorAll('tr:not(:first-child)');
    const toAdd = [];
    
    rows.forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
            const qInput = row.querySelector('input[data-type="q"]');
            const aInput = row.querySelector('input[data-type="a"]');
            const q = qInput ? qInput.value.trim() : '';
            const a = aInput ? aInput.value.trim() : '';
            
            if (q && a) {
                toAdd.push({ q, a, correct: 0, unsure: 0, incorrect: 0, mastered: false });
            }
        }
    });
    
    if (!toAdd.length) { 
        alert('没有勾选任何要导入的卡片，或者勾选的卡片问题/答案为空'); 
        return; 
    }
    
    // append to current group
    cards = cards.concat(toAdd);
    cards.forEach(ensureCardFields);
    saveGroupData(currentGroup, cards);
    renderCardTable(); 
    updateStatus();
    closePreview();
    alert('已导入 ' + toAdd.length + ' 张卡片 到组 ' + currentGroup);
}

function closePreview() { 
    document.getElementById('previewModal').style.display = 'none'; 
    window.__previewParsed = null; 
}

/* docx import using mammoth */
function importFromDocx() {
    const fi = document.getElementById('fileDocx'); 
    fi.value = null;
    fi.onchange = (e) => {
        const f = e.target.files[0]; 
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async function (evt) {
            try {
                const arrayBuffer = evt.target.result;
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                const text = result.value;
                document.getElementById('importText').value = text;
                alert('已读取 .docx 内容，点击"预览导入"查看解析结果。');
            } catch (err) { 
                alert('解析 docx 出错: ' + err); 
            }
        };
        reader.readAsArrayBuffer(f);
    };
    fi.click();
}

/* import JSON */
function importFromFile() {
    const fi = document.getElementById('fileJson'); 
    fi.value = null;
    fi.onchange = (e) => {
        const f = e.target.files[0]; 
        if (!f) return;
        const r = new FileReader();
        r.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                if (!Array.isArray(data)) return alert('JSON 必须为数组');
                data.forEach(it => { 
                    ensureCardFields(it); 
                    cards.push(it); 
                });
                saveGroupData(currentGroup, cards); 
                renderCardTable(); 
                updateStatus(); 
                alert('JSON 导入成功');
            } catch (err) { 
                alert('JSON 解析失败: ' + err); 
            }
        };
        r.readAsText(f, 'utf-8');
    };
    fi.click();
}

/* clear group */
function clearGroup() { 
    if (!confirm('清空当前组所有卡片？')) return; 
    cards = []; 
    saveGroupData(currentGroup, cards); 
    renderCardTable(); 
    updateStatus(); 
}

/* escape html helper for inputs */
function escapeHtml(s) { 
    return String(s).replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');
}

/* ---------------------------
   Study & Queues & Logic
----------------------------*/

function updateStatus() {
    const total = cards.length;
    const masteredCount = cards.filter(c => c.mastered).length;
    const remaining = (studyStage === '筛选新题') ? initialQueue.length : (studyStage === '复习不会' ? reviewQueue.length : 0);
    const mode = document.getElementById('modeSelect').value === 'learn' ? '学习' : '复习';
    const ct = (totalQueue && currentIndex) ? `${currentIndex}/${totalQueue}` : `0/0`;
    const warn = Number(document.getElementById('warnSec').value) || 5;
    let timerText = '';
    if (countdown >= 0) {
        if (countdown <= warn) {
            timerText = ` · 倒计时: <span class="timer-warn">${countdown}s</span>`;
        } else {
            timerText = ` · 倒计时: ${countdown}s`;
        }
    }
    document.getElementById('status').innerHTML =
        `总卡片:${total} · 已掌握:${masteredCount} · 队列剩余:${remaining} · 当前:${ct} · 模式:${mode} · 组:${currentGroup}` + timerText;
}

/* start study */
function startStudy() {
    stopStudy(); // reset
    cards = loadGroupData(currentGroup);
    cards.forEach(ensureCardFields);
    const mode = document.getElementById('modeSelect').value;
    if (mode === 'learn') {
        // learning = ALL cards per your request
        initialQueue = cards.slice();
        // shuffle initialQueue for better practice
        shuffleArray(initialQueue);
        reviewQueue = [];
        studyStage = '筛选新题';
        totalQueue = initialQueue.length;
    } else {
        // review mode: collect unsure (correct>0 && incorrect>0) OR incorrect>0
        reviewQueue = cards.filter(c => (c.unsure && c.unsure > 0) || ((c.correct || 0) > 0 && (c.incorrect || 0) > 0) || ((c.incorrect || 0) > 0)).slice();
        if (reviewQueue.length === 0) { 
            alert('当前组暂无不熟/不会题可复习'); 
            return; 
        }
        shuffleArray(reviewQueue);
        initialQueue = [];
        studyStage = '复习不会';
        totalQueue = reviewQueue.length;
    }
    currentIndex = 0;
    isAnswering = false;
    warnSoundPlayed = false;
    nextCard();
}

/* stop study */
function stopStudy() {
    clearTimer();
    initialQueue = []; 
    reviewQueue = []; 
    current = null; 
    studyStage = ''; 
    totalQueue = 0; 
    currentIndex = 0;
    isAnswering = false;
    warnSoundPlayed = false;
    document.getElementById('question').innerText = '请点击"开始学习"';
    document.getElementById('answer').innerText = '';
    disableButtons();
    updateStatus();
}

/* next card logic */
function nextCard() {
    clearTimer();
    isAnswering = false;
    warnSoundPlayed = false;
    
    // decide queue
    if (studyStage === '筛选新题') {
        if (initialQueue.length === 0) {
            if (reviewQueue.length > 0) {
                studyStage = '复习不会';
            } else {
                finishRound(); 
                return;
            }
        }
    }
    let q = null;
    if (studyStage === '筛选新题') {
        if (initialQueue.length === 0) { 
            finishRound(); 
            return; 
        }
        q = initialQueue.shift();
    } else if (studyStage === '复习不会') {
        if (reviewQueue.length === 0) { 
            finishRound(); 
            return; 
        }
        q = reviewQueue.shift();
    } else { 
        finishRound(); 
        return; 
    }
    current = q;
    currentIndex++;
    document.getElementById('question').innerText = current.q;
    document.getElementById('answer').innerText = '';
    disableButtonsBeforeAnswer();
    
    // 显示题目时朗读题目
    if (settings.ttsEnabled && settings.ttsQuestion) {
        speak(current.q);
    }
    
    // start countdown immediately upon question show
    startCountdown();
    updateStatus();
}

/* show answer (user triggers) */
function showAnswer() {
    if (!current || isAnswering) return;
    document.getElementById('answer').innerText = current.a;
    enableButtonsAfterAnswer();
    
    // 显示答案时朗读答案
    if (settings.ttsEnabled && settings.ttsAnswer) {
        speak(current.a);
    }
    
    // 显示答案后停止倒计时
    clearTimer();
    updateStatus();
}

/* answer known */
function answerKnown() {
    if (!current || isAnswering) return;
    isAnswering = true;
    clearTimer();
    current.correct = (current.correct || 0) + 1;
    // if previously had incorrect and now correct -> mark unsure
    if ((current.incorrect || 0) > 0 && (current.correct || 0) > 0 && (!current.unsure || current.unsure === 0)) {
        current.unsure = (current.unsure || 0) + 1;
    }
    // determine mastered: require correct>=2 and no incorrect
    if ((current.correct || 0) >= 2 && (current.incorrect || 0) === 0) {
        current.mastered = true;
    } else {
        current.mastered = false;
    }
    playSound(true);
    saveGroupData(currentGroup, cards);
    renderCardTable(); // 立即更新表格状态
    updateReportIfOpen(); // 更新报告
    
    // 答对立即下一题
    setTimeout(() => nextCard(), 0);
}

/* answer wrong (or timeout auto-wrong) */
function answerWrong(isAuto = false) {
    if (!current || isAnswering) return;
    isAnswering = true;
    clearTimer();
    
    // 播放错误提示音
    playSound(false);
    
    current.incorrect = (current.incorrect || 0) + 1;
    if ((current.incorrect || 0) > 0 && (current.correct || 0) > 0 && (!current.unsure || current.unsure === 0)) {
        current.unsure = (current.unsure || 0) + 1;
    }
    current.mastered = false;
    
    // 只有超时才显示答案并延迟，用户主动选择立即下一题
    if (isAuto) {
        // 超时自动答错：显示答案并延迟
        reviewQueue.push(current);
        document.getElementById('answer').innerText = current.a;
        const delayMs = (Number(document.getElementById('wrongDelaySec').value) || 3) * 1000;
        setTimeout(() => {
            saveGroupData(currentGroup, cards);
            renderCardTable();
            updateReportIfOpen();
            nextCard();
        }, delayMs);
    } else {
        // 用户主动点击"不会"：立即下一题
        reviewQueue.push(current);
        saveGroupData(currentGroup, cards);
        renderCardTable();
        updateReportIfOpen();
        setTimeout(() => nextCard(), 0);
    }
}

/* finish round */
function finishRound() {
    clearTimer();
    alert('本轮已结束');
    current = null;
    isAnswering = false;
    warnSoundPlayed = false;
    document.getElementById('question').innerText = '本轮已结束，点击开始学习开启新轮';
    document.getElementById('answer').innerText = '';
    disableButtons();
    studyStage = '';
    totalQueue = 0; 
    currentIndex = 0;
    saveGroupData(currentGroup, cards);
    updateStatus();
}

/* ---------------------------
  Countdown & timing
----------------------------*/
function startCountdown() {
    clearTimer();
    warnSoundPlayed = false;
    const t = Math.max(5, Number(document.getElementById('timeoutSec').value) || 15);
    const warnSec = Math.max(1, Number(document.getElementById('warnSec').value) || 5);
    countdown = t;
    updateStatus();
    timerHandle = setInterval(() => {
        countdown--;
        
        // 检查是否需要播放警告音
        if (countdown <= warnSec && !warnSoundPlayed) {
            playWarnSound();
            warnSoundPlayed = true;
        }
        
        updateStatus();
        if (countdown <= 0) {
            clearTimer();
            // auto mark wrong
            if (current && !isAnswering) {
                answerWrong(true);
            } else {
                updateStatus();
            }
        }
    }, 1000);
}

function clearTimer() { 
    if (timerHandle) clearInterval(timerHandle); 
    timerHandle = null; 
    countdown = -1; 
    updateStatus(); 
}

/* ---------------------------
  Audio: TTS & beeps
----------------------------*/

/* ====== 语音朗读 ====== */
function speak(text) {
    if (!settings.ttsEnabled) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    utterance.volume = Number(document.getElementById('ttsVolume').value || 0.9);
    window.speechSynthesis.cancel(); // 防止重叠
    window.speechSynthesis.speak(utterance);
}

/* simple beep sounds via WebAudio */
const audioCtx = window.AudioContext ? new AudioContext() : null;

function playSound(isCorrect) {
    if (!settings.soundEnabled || !audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); 
    g.connect(audioCtx.destination);
    if (isCorrect) { 
        o.frequency.value = 880; 
    } else { 
        o.frequency.value = 220; 
    }
    g.gain.value = 0.001;
    // ramp up
    g.gain.exponentialRampToValueAtTime(0.1, audioCtx.currentTime + 0.01);
    o.start();
    setTimeout(() => {
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        setTimeout(() => { 
            try { 
                o.stop(); 
            } catch (e) { } 
        }, 60);
    }, 120);
}

/* 警告提示音 */
function playWarnSound() {
    if (!settings.soundEnabled || !audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); 
    g.connect(audioCtx.destination);
    o.frequency.value = 660; // 警告音频率
    g.gain.value = 0.001;
    // ramp up
    g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
    o.start();
    setTimeout(() => {
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        setTimeout(() => { 
            try { 
                o.stop(); 
            } catch (e) { } 
        }, 120);
    }, 200);
}

/* ---------------------------
  Table & Report rendering
----------------------------*/

// 多选管理
let selectedCards = new Set();

function renderCardTable() {
    const tbl = document.getElementById('cardTable');
    tbl.innerHTML = `
        <tr>
            <th style="width:30px"><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)"></th>
            <th style="width:45px">排序</th>
            <th>问题</th>
            <th>答案</th>
            <th>会</th>
            <th>不熟</th>
            <th>不会</th>
            <th>掌握</th>
            <th>操作</th>
        </tr>`;
    
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        ensureCardFields(c);
        const tr = document.createElement('tr');
        tr.className = 'card-row';
        if (selectedCards.has(i)) {
            tr.classList.add('selected');
        }
        
        const qHtml = `<input type="text" value="${escapeHtml(c.q)}" onchange="editQ(${i}, this.value)"/>`;
        const aHtml = `<input type="text" value="${escapeHtml(c.a)}" onchange="editA(${i}, this.value)"/>`;
        const mastered = c.mastered ? '✅' : '❌';
        
        tr.innerHTML = `
            <td><input type="checkbox" onchange="toggleCardSelection(${i}, this.checked)" ${selectedCards.has(i) ? 'checked' : ''}></td>
            <td>
                <button class="sort-btn" onclick="moveCardUp(${i})" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="sort-btn" onclick="moveCardDown(${i})" ${i === cards.length - 1 ? 'disabled' : ''}>↓</button>
            </td>
            <td>${qHtml}</td>
            <td>${aHtml}</td>
            <td>${c.correct || 0}</td>
            <td>${c.unsure || 0}</td>
            <td>${c.incorrect || 0}</td>
            <td>${mastered}</td>
            <td><button class="btn-ghost" onclick="deleteCard(${i})">删除</button></td>`;
        tbl.appendChild(tr);
    }
    updateSelectedCount();
}

// 移动卡片位置
function moveCardUp(index) {
    if (index <= 0) return;
    [cards[index], cards[index - 1]] = [cards[index - 1], cards[index]];
    saveGroupData(currentGroup, cards);
    renderCardTable();
}

function moveCardDown(index) {
    if (index >= cards.length - 1) return;
    [cards[index], cards[index + 1]] = [cards[index + 1], cards[index]];
    saveGroupData(currentGroup, cards);
    renderCardTable();
}

// 多选功能
function toggleCardSelection(index, checked) {
    if (checked) {
        selectedCards.add(index);
    } else {
        selectedCards.delete(index);
    }
    updateSelectedCount();
    renderCardTable(); // 重新渲染以更新样式
}

function toggleSelectAll(checked) {
    if (checked) {
        for (let i = 0; i < cards.length; i++) {
            selectedCards.add(i);
        }
    } else {
        selectedCards.clear();
    }
    updateSelectedCount();
    renderCardTable();
}

function selectAllCards() {
    toggleSelectAll(true);
}

function deselectAllCards() {
    toggleSelectAll(false);
}

function updateSelectedCount() {
    const countElement = document.getElementById('selectedCount');
    if (countElement) {
        countElement.textContent = `已选择 ${selectedCards.size} 个项目`;
    }
    // 更新全选复选框状态
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedCards.size === cards.length && cards.length > 0;
        selectAllCheckbox.indeterminate = selectedCards.size > 0 && selectedCards.size < cards.length;
    }
}

function deleteSelectedCards() {
    if (selectedCards.size === 0) {
        alert('请先选择要删除的卡片');
        return;
    }
    
    if (!confirm(`确定要删除选中的 ${selectedCards.size} 张卡片吗？`)) return;
    
    // 从大到小删除，避免索引变化
    const sortedIndices = Array.from(selectedCards).sort((a, b) => b - a);
    sortedIndices.forEach(index => {
        cards.splice(index, 1);
    });
    
    selectedCards.clear();
    saveGroupData(currentGroup, cards);
    renderCardTable();
    updateStatus();
}

function resetStatsSelected() {
    if (selectedCards.size === 0) {
        alert('请先选择要重置统计的卡片');
        return;
    }
    
    if (!confirm(`确定要重置选中的 ${selectedCards.size} 张卡片的统计信息吗？`)) return;
    
    selectedCards.forEach(index => {
        cards[index].correct = 0;
        cards[index].unsure = 0;
        cards[index].incorrect = 0;
        cards[index].mastered = false;
    });
    
    saveGroupData(currentGroup, cards);
    renderCardTable();
    updateStatus();
}

function editQ(i, v) { 
    cards[i].q = v; 
    saveGroupData(currentGroup, cards); 
    renderCardTable(); 
    updateStatus(); 
}

function editA(i, v) { 
    cards[i].a = v; 
    saveGroupData(currentGroup, cards); 
    renderCardTable(); 
    updateStatus(); 
}

function deleteCard(i) { 
    if (!confirm('删除该题?')) return; 
    cards.splice(i, 1); 
    saveGroupData(currentGroup, cards); 
    renderCardTable(); 
    updateStatus(); 
}

/* report */
function openReport() {
    const box = document.getElementById('reportBox'); 
    const tbl = document.getElementById('reportTable'); 
    const sum = document.getElementById('reportSummary');
    const refreshBtn = document.getElementById('refreshReportBtn');
    
    box.style.display = 'block';
    refreshBtn.style.display = 'inline-block';
    
    refreshReport();
}

function refreshReport() {
    const tbl = document.getElementById('reportTable'); 
    const sum = document.getElementById('reportSummary');
    
    let total = cards.length, correctSum = 0, unsureSum = 0, wrongSum = 0, masteredCount = 0;
    cards.forEach(c => { 
        correctSum += (c.correct || 0); 
        unsureSum += (c.unsure || 0); 
        wrongSum += (c.incorrect || 0); 
        if (c.mastered) masteredCount++; 
    });
    sum.innerText = `总题: ${total} · 会(总计): ${correctSum} · 不熟(总计): ${unsureSum} · 不会(总计): ${wrongSum} · 已掌握题数: ${masteredCount}`;
    tbl.innerHTML = '<tr><th>问题</th><th>会</th><th>不熟</th><th>不会</th><th>掌握</th></tr>';
    cards.forEach(c => {
        const tr = document.createElement('tr'); 
        tr.innerHTML = `<td>${escapeHtml(c.q)}</td><td>${c.correct || 0}</td><td>${c.unsure || 0}</td><td>${c.incorrect || 0}</td><td>${c.mastered ? '✅' : '❌'}</td>`; 
        tbl.appendChild(tr);
    });
}

// 如果报告已打开，则更新报告
function updateReportIfOpen() {
    const box = document.getElementById('reportBox');
    if (box.style.display !== 'none') {
        refreshReport();
    }
}

function downloadReportCSV() {
    const rows = [['问题', '会', '不熟', '不会', '掌握']];
    cards.forEach(c => rows.push([c.q.replace(/\r?\n/g, '\\n'), c.correct || 0, c.unsure || 0, c.incorrect || 0, c.mastered ? '是' : '否']));
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); 
    const url = URL.createObjectURL(blob); 
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = currentGroup + '_report.csv'; 
    a.click(); 
    URL.revokeObjectURL(url);
}

/* export group JSON */
function exportGroup() { 
    const data = loadGroupData(currentGroup); 
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); 
    const url = URL.createObjectURL(blob); 
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = currentGroup + '.json'; 
    a.click(); 
    URL.revokeObjectURL(url); 
}

/* ---------------------------
  UI helpers & init
----------------------------*/
function disableButtonsBeforeAnswer() { 
    document.getElementById('showBtn').disabled = false; 
    document.getElementById('btnKnown').disabled = true; 
    document.getElementById('btnWrong').disabled = true; 
}

function enableButtonsAfterAnswer() { 
    document.getElementById('showBtn').disabled = true; 
    document.getElementById('btnKnown').disabled = false; 
    document.getElementById('btnWrong').disabled = false; 
}

function disableButtons() { 
    document.getElementById('showBtn').disabled = true; 
    document.getElementById('btnKnown').disabled = true; 
    document.getElementById('btnWrong').disabled = true; 
}

function shuffleArray(a) { 
    for (let i = a.length - 1; i > 0; i--) { 
        const j = Math.floor(Math.random() * (i + 1)); 
        [a[i], a[j]] = [a[j], a[i]]; 
    } 
}

/* 初始化设置控件 */
function initSettings() {
    // 设置初始状态
    document.getElementById("ttsEnabled").checked = settings.ttsEnabled;
    document.getElementById("ttsQuestion").checked = settings.ttsQuestion;
    document.getElementById("ttsAnswer").checked = settings.ttsAnswer;
    document.getElementById("soundEnabled").checked = settings.soundEnabled;

    // 绑定事件
    document.getElementById("ttsEnabled").addEventListener("change", e => settings.ttsEnabled = e.target.checked);
    document.getElementById("ttsQuestion").addEventListener("change", e => settings.ttsQuestion = e.target.checked);
    document.getElementById("ttsAnswer").addEventListener("change", e => settings.ttsAnswer = e.target.checked);
    document.getElementById("soundEnabled").addEventListener("change", e => settings.soundEnabled = e.target.checked);
}

/* initial render */
function updateStatusAndTable() { 
    renderCardTable(); 
    updateStatus(); 
    saveGroupData(currentGroup, cards); 
}

function init() {
    // 初始化智能主题
    initSmartTheme();
    
    // 初始化应用
    renderGroupSelect();
    if (!groups.includes(currentGroup)) { 
        groups.unshift(currentGroup); 
        saveGroups(); 
        renderGroupSelect(); 
    }
    loadGroup();
    disableButtons();
    updateStatus();
    initSettings(); // 初始化设置控件
    
    // 绑定主题切换按钮
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

init();

/* attach functions for inline onclick use */
window.addGroup = addGroup; 
window.renameGroup = renameGroup; 
window.deleteGroup = deleteGroup; 
window.switchGroup = switchGroup;
window.previewImport = previewImport; 
window.confirmImport = confirmImport; 
window.closePreview = closePreview;
window.importFromDocx = importFromDocx; 
window.importFromFile = importFromFile; 
window.exportGroup = exportGroup;
window.startStudy = startStudy; 
window.stopStudy = stopStudy; 
window.showAnswer = showAnswer; 
window.answerKnown = answerKnown; 
window.answerWrong = answerWrong;
window.openReport = openReport; 
window.refreshReport = refreshReport;
window.downloadReportCSV = downloadReportCSV;
window.editQ = editQ; 
window.editA = editA; 
window.deleteCard = deleteCard;
window.addNewRowToPreview = addNewRowToPreview;
window.sortPreviewTable = sortPreviewTable;
window.removePreviewRow = removePreviewRow;
window.toggleSelectAll = toggleSelectAll;
window.selectAllCards = selectAllCards;
window.deselectAllCards = deselectAllCards;
window.deleteSelectedCards = deleteSelectedCards;
window.resetStatsSelected = resetStatsSelected;
window.toggleCardSelection = toggleCardSelection;
window.moveCardUp = moveCardUp;
window.moveCardDown = moveCardDown;