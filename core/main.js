// Global study state
let currentDeck = null, currentCard = null, currentDeckType = 'mcq', autoAdvanceTimer = null, timerInterval = null, timerSeconds = 0, startTs = 0, currentSessionCombo = 0;
let chapterContext = null, chapterShuffleUnlocked = false;

// ---------- Load all modules ----------
async function loadModules() {
    const modules = ['study', 'library', 'stats', 'store'];
    for (const mod of modules) {
        try {
            const res = await fetch(`modules/${mod}.html`);
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Inject styles
            doc.querySelectorAll('style').forEach(s => {
                document.head.appendChild(s.cloneNode(true));
            });
            
            // Inject HTML
            const sectionEl = doc.querySelector('.section');
            if (sectionEl) {
                document.getElementById('modules-container').appendChild(sectionEl.cloneNode(true));
            }
            
            // Execute scripts
            doc.querySelectorAll('script').forEach(s => {
                const newScript = document.createElement('script');
                newScript.textContent = s.textContent;
                document.body.appendChild(newScript);
            });
        } catch (e) {
            console.error(`Error loading module ${mod}:`, e);
        }
    }
}

// ---------- Stats & Achievements ----------
async function initStats() {
    let stats = await getData('stats', 'main');
    if (!stats) {
        stats = { totalAnswered: 0, totalCorrect: 0, streakDays: 0, lastStudyDay: '', xp: 0, xpFreezes: 0, dailyXp: {}, doubleXpExpiry: 0, hintTokens: 0, unlockedThemes: ['default'], dailyActivity: {}, retentionLogs: [], achievements: {}, dailyChallenge: null };
        await setData('stats', 'main', stats);
    }
    if (stats.xpFreezes === undefined) stats.xpFreezes = 0;
    if (!stats.dailyXp) stats.dailyXp = {};
    if (!stats.unlockedThemes) stats.unlockedThemes = ['default'];
    if (!stats.dailyActivity) stats.dailyActivity = {};
    if (!stats.retentionLogs) stats.retentionLogs = [];
    if (!stats.achievements) stats.achievements = {};
    if (!stats.dailyChallenge) stats.dailyChallenge = null;
    return stats;
}

function generateDailyChallenge() {
    const chs = [
        { desc: 'Answer 20 cards today', goal: 20, type: 'cards' },
        { desc: 'Get 10 correct answers', goal: 10, type: 'correct' },
        { desc: 'Achieve a 5-card combo', goal: 5, type: 'combo' },
        { desc: 'Study 3 different decks', goal: 3, type: 'decks' },
        { desc: 'Answer 5 flashcards correctly', goal: 5, type: 'flashcard' }
    ];
    return chs[Math.floor(Math.random() * chs.length)];
}

async function updateDailyChallenge(stats, isCorrect, deckType) {
    if (!stats.dailyChallenge) { stats.dailyChallenge = generateDailyChallenge(); stats.dailyChallenge.progress = 0; stats.dailyChallenge.completed = false; }
    const ch = stats.dailyChallenge;
    if (ch.completed) return stats;
    let progress = ch.progress || 0;
    if (ch.type === 'cards') progress++;
    else if (ch.type === 'correct' && isCorrect) progress++;
    else if (ch.type === 'combo' && currentSessionCombo >= ch.goal) progress = ch.goal;
    else if (ch.type === 'decks') progress = Math.min(progress + 1, ch.goal);
    else if (ch.type === 'flashcard' && deckType === 'flashcard' && isCorrect) progress++;
    ch.progress = Math.min(progress, ch.goal);
    if (ch.progress >= ch.goal && !ch.completed) { ch.completed = true; stats.xp += 30; toast('✅ Daily Challenge Complete! +30 XP'); triggerConfetti(); SoundManager.playAchievement(); }
    stats.dailyChallenge = ch;
    return stats;
}

window.updateHeaderPills = function (stats) {
    const acc = stats.totalAnswered ? Math.round(stats.totalCorrect / stats.totalAnswered * 100 * 10) / 10 : 0;
    document.getElementById('h-xp').textContent = stats.xp;
    document.getElementById('h-acc').textContent = acc + '%';
    document.getElementById('h-str').textContent = stats.streakDays;
    const level = Math.floor(stats.xp / 100) + 1;
    const xpIn = stats.xp % 100;
    document.getElementById('lv-num').textContent = level;
    document.getElementById('lv-label').textContent = 'Level ' + level;
    document.getElementById('lv-xp-txt').textContent = xpIn + ' / 100 XP';
    document.getElementById('lv-bar').style.width = xpIn + '%';
    const streakEl = document.getElementById('h-str');
    if (streakEl) {
        streakEl.className = '';
        if (stats.streakDays >= 10) streakEl.classList.add('streak-gold');
        else if (stats.streakDays >= 5) streakEl.classList.add('streak-silver');
        else if (stats.streakDays > 0) streakEl.classList.add('streak-bronze');
    }
    const comboIndicator = document.getElementById('combo-indicator');
    if (comboIndicator) comboIndicator.innerHTML = currentSessionCombo >= 3 ? `<span class="combo-badge">🔥 x${currentSessionCombo} Combo</span>` : '';
};

async function checkAchievements(stats, isCorrect, answerTimeSec, isNight, totalDecks) {
    const ACHIEVEMENTS = {
        perfect5: { name: 'Perfect 5', desc: '5 correct in a row', icon: '🎯' },
        perfect10: { name: 'Perfect 10', desc: '10 correct in a row', icon: '🔥' },
        speed_demon: { name: 'Speed Demon', desc: 'Answer under 2s', icon: '⚡' },
        night_owl: { name: 'Night Owl', desc: 'Study after 10 PM', icon: '🦉' },
        collector: { name: 'Collector', desc: 'Create 5 decks', icon: '📚' },
        centurion: { name: 'Centurion', desc: '100 cards answered', icon: '💯' },
        xp_master: { name: 'XP Master', desc: 'Earn 1000 XP', icon: '🌟' },
        streak7: { name: 'Week Warrior', desc: '7-day streak', icon: '📅' }
    };
    let newAch = false;
    if (!stats.achievements) stats.achievements = {};
    if (isCorrect && !stats.achievements.perfect5 && stats.totalCorrect >= 5) { stats.achievements.perfect5 = true; newAch = true; }
    if (isCorrect && !stats.achievements.perfect10 && stats.totalCorrect >= 10) { stats.achievements.perfect10 = true; newAch = true; }
    if (!stats.achievements.speed_demon && answerTimeSec <= 2) { stats.achievements.speed_demon = true; newAch = true; }
    if (!stats.achievements.night_owl && isNight) { stats.achievements.night_owl = true; newAch = true; }
    if (!stats.achievements.centurion && stats.totalAnswered >= 100) { stats.achievements.centurion = true; newAch = true; }
    if (!stats.achievements.xp_master && stats.xp >= 1000) { stats.achievements.xp_master = true; newAch = true; }
    if (!stats.achievements.streak7 && stats.streakDays >= 7) { stats.achievements.streak7 = true; newAch = true; }
    if (totalDecks >= 5 && !stats.achievements.collector) { stats.achievements.collector = true; newAch = true; }
    if (newAch) { SoundManager.playAchievement(); triggerConfetti(); toast('🏆 New Achievement Unlocked!'); }
    return stats;
}

async function triggerAdvancedDopamineReward(isCorrect, durationSeconds, anchorsAnchorNode) {
    let stats = await initStats();
    stats.totalAnswered++;
    if (isCorrect) { stats.totalCorrect++; currentSessionCombo++; if (currentSessionCombo >= 3) SoundManager.playCombo(); }
    else currentSessionCombo = 0;
    let baseXP = isCorrect ? 10 : -2;
    if (isCorrect && durationSeconds <= 3) baseXP = 15;
    if (currentSessionCombo >= 3) baseXP = Math.round(baseXP * 1.5);
    let actualXpGain = baseXP;
    if (baseXP > 0 && stats.doubleXpExpiry && stats.doubleXpExpiry > Date.now()) actualXpGain = baseXP * 2;
    stats.xp = Math.max(0, stats.xp + actualXpGain);
    const today = new Date().toISOString().slice(0, 10);
    if (!stats.dailyXp) stats.dailyXp = {};
    if (!stats.dailyXp[today]) stats.dailyXp[today] = { xp: 0, goalReached: false };
    if (actualXpGain > 0) { stats.dailyXp[today].xp += actualXpGain; if (stats.dailyXp[today].xp >= 50 && !stats.dailyXp[today].goalReached) { stats.dailyXp[today].goalReached = true; stats.xp += 25; setTimeout(() => { triggerConfetti(); toast("🎉 Daily XP Goal Reached! +25 Bonus XP!"); }, 300); } }
    if (!stats.dailyActivity) stats.dailyActivity = {};
    stats.dailyActivity[today] = (stats.dailyActivity[today] || 0) + 1;
    if (!stats.retentionLogs) stats.retentionLogs = [];
    stats.retentionLogs.push({ date: today, correct: isCorrect }); if (stats.retentionLogs.length > 300) stats.retentionLogs.shift();
    if (stats.lastStudyDay && stats.lastStudyDay !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (stats.lastStudyDay === yesterday) { stats.streakDays = stats.streakDays + 1; }
        else {
            const lastDate = new Date(stats.lastStudyDay + 'T00:00:00');
            const todayDate = new Date(today + 'T00:00:00');
            const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
            const neededFreezes = diffDays - 1;
            if (neededFreezes > 0 && stats.xpFreezes && stats.xpFreezes >= neededFreezes) { stats.xpFreezes -= neededFreezes; stats.streakDays = stats.streakDays + 1; setTimeout(() => toast(`❄️ Used ${neededFreezes} Streak Freeze(s) to save your streak!`), 500); }
            else { stats.streakDays = 1; }
        }
        stats.lastStudyDay = today;
    } else if (!stats.lastStudyDay) { stats.streakDays = 1; stats.lastStudyDay = today; }
    const isNight = new Date().getHours() >= 22;
    const chapterCount = Object.keys(await getAllChapters()).length;
    stats = await checkAchievements(stats, isCorrect, durationSeconds, isNight, chapterCount);
    stats = await updateDailyChallenge(stats, isCorrect, currentDeckType);
    await setData('stats', 'main', stats);
    if (anchorsAnchorNode) {
        const visualPop = document.createElement('div'); visualPop.className = 'xp-pop-node';
        visualPop.innerHTML = actualXpGain >= 0 ? `+${actualXpGain} XP ${currentSessionCombo >= 3 ? '🔥 Combo x1.5' : ''}` : `${actualXpGain} XP`;
        anchorsAnchorNode.style.position = 'relative'; anchorsAnchorNode.appendChild(visualPop);
        setTimeout(() => visualPop.remove(), 850);
    }
    window.updateHeaderPills(stats);
    const currentCardBox = document.querySelector('.question-card');
    if (currentCardBox) { if (currentSessionCombo >= 3) currentCardBox.classList.add('combo-glow-active'); else currentCardBox.classList.remove('combo-glow-active'); }
    return stats;
}

window.changeTheme = function (theme) { document.body.className = ''; if (theme === 'cyberpunk') document.body.classList.add('theme-cyberpunk-neon'); localStorage.setItem('recall_user_theme', theme); toast(`Theme changed to ${theme === 'cyberpunk' ? 'CYBERPUNK NEON' : 'DEFAULT'}`); };
(function () { const t = localStorage.getItem('recall_user_theme') || 'default'; if (t === 'cyberpunk') document.body.classList.add('theme-cyberpunk-neon'); })();

window.loadStats = async function() {
    let stats = await initStats();
    window.updateHeaderPills(stats);
    
    const unlocked = stats.unlockedThemes || ['default'];
    const themeSelect = document.getElementById('theme-selector');
    if (themeSelect) {
        const cyberOpt = document.getElementById('opt-theme-cyberpunk');
        if (unlocked.includes('cyberpunk')) { cyberOpt.disabled = false; cyberOpt.textContent = '🕶️ Cyberpunk Neon'; }
        else { cyberOpt.disabled = true; cyberOpt.textContent = '🔒 Cyberpunk (500 XP)'; }
        themeSelect.value = localStorage.getItem('recall_user_theme') || 'default';
    }

    if (typeof renderStatsSection === 'function') await renderStatsSection(stats);
    if (typeof renderStoreSection === 'function') await renderStoreSection(stats);
    if (typeof renderStudyChapters === 'function') await renderStudyChapters();
};

// Sound toggle setup
document.getElementById('sound-toggle-btn').addEventListener('click', () => {
    const muted = SoundManager.mute();
    document.getElementById('sound-toggle-btn').textContent = muted ? '🔇' : '🔊';
});
if (SoundManager.isMuted()) document.getElementById('sound-toggle-btn').textContent = '🔇';

// Tab navigation
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => {
        const name = t.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(tt => tt.classList.remove('active'));
        t.classList.add('active');
        document.querySelectorAll('.section').forEach(s => s.classList.remove('visible'));
        const sectionEl = document.getElementById('sec-' + name);
        if (sectionEl) sectionEl.classList.add('visible');
        loadStats();
    }));
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const sessionView = document.getElementById('study-session');
    if (!sessionView || sessionView.style.display === 'none') return;
    if (event.key === 'Escape') { exitStudy(); return; }
    const contBtn = document.getElementById('manual-continue');
    if (contBtn && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); contBtn.click(); return; }
    if (currentDeckType === 'flashcard' || chapterContext) {
        const flashcardEl = document.getElementById('flashcard-element');
        const isFlipped = flashcardEl ? flashcardEl.classList.contains('flipped') : false;
        if (!isFlipped && (event.key === ' ' || event.code === 'Space' || event.key === 'Enter')) {
            event.preventDefault();
            if (flashcardEl) flipFlashcard();
            return;
        }
        if (isFlipped) {
            if (event.key === '1') { event.preventDefault(); document.querySelector('.flashcard-btn-dont-know')?.click(); }
            else if (event.key === '2') { event.preventDefault(); document.querySelector('.flashcard-btn-know-it')?.click(); }
        }
    } else {
        if (['1', '2', '3', '4'].includes(event.key)) {
            event.preventDefault();
            const optIdx = parseInt(event.key);
            const targetBtn = document.getElementById(`opt-${optIdx}`);
            if (targetBtn && !targetBtn.disabled) targetBtn.click();
        }
    }
    if (event.key === 'Delete') window.deleteCurrentCard();
});

// Load modules and initialize
(async () => {
    await loadModules();
    await loadStats();
})();
