// ---------- Sound Engine ----------
const SoundManager = (() => {
    let audioCtx = null;
    let muted = localStorage.getItem('recall_sound_muted') === 'true';
    function getCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
    function playTone(freq, type, duration, vol = 0.1) {
        if (muted) return;
        try {
            const ctx = getCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(vol, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); osc.stop(ctx.currentTime + duration);
        } catch (e) { }
    }
    return {
        playCorrect() { playTone(880, 'sine', 0.15); setTimeout(() => playTone(1100, 'sine', 0.15), 100); },
        playIncorrect() { playTone(200, 'square', 0.2, 0.08); },
        playFlip() { playTone(600, 'triangle', 0.08, 0.05); },
        playAchievement() { playTone(523, 'sine', 0.1); setTimeout(() => playTone(659, 'sine', 0.1), 120); setTimeout(() => playTone(784, 'sine', 0.2), 240); },
        playCombo() { playTone(1047, 'triangle', 0.12); },
        mute() { muted = !muted; localStorage.setItem('recall_sound_muted', muted); return muted; },
        isMuted() { return muted; }
    };
})();

// ---------- IndexedDB Core ----------
const DB_NAME = 'RecallEngine';
let db = null;
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('stats')) db.createObjectStore('stats');
            if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters');
        };
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onerror = () => reject(req.error);
    });
}
async function getStore(storeName, mode = 'readonly') {
    if (!db) await openDB();
    return db.transaction(storeName, mode).objectStore(storeName);
}
async function getData(storeName, key) {
    const store = await getStore(storeName);
    return new Promise((res) => { const req = store.get(key); req.onsuccess = () => res(req.result); });
}
async function setData(storeName, key, value) {
    const store = await getStore(storeName, 'readwrite');
    return new Promise((res, rej) => { const req = store.put(value, key); req.onsuccess = res; req.onerror = rej; });
}
async function deleteData(storeName, key) {
    const store = await getStore(storeName, 'readwrite');
    return new Promise((res) => { const req = store.delete(key); req.onsuccess = res; });
}
async function getAllKeys(storeName) {
    const store = await getStore(storeName);
    return new Promise((res) => { const req = store.getAllKeys(); req.onsuccess = () => res(req.result); });
}
async function getAllValues(storeName) {
    const store = await getStore(storeName);
    return new Promise((res) => { const req = store.getAll(); req.onsuccess = () => res(req.result); });
}
async function getStorageUsageMB() {
    let total = 0;
    for (const store of ['stats', 'chapters']) {
        const vals = await getAllValues(store);
        for (const v of vals) total += JSON.stringify(v).length;
    }
    return total / 1048576;
}

// ---------- Utility Functions ----------
function esc(s) { return String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
function toast(msg, dur = 2000) { const t = document.getElementById('toast'); t.textContent = msg; t.style.opacity = '1'; setTimeout(() => t.style.opacity = '0', dur); }
function triggerConfetti() { if (typeof confetti !== 'undefined') confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } }); }

// ---------- Chapter helpers ----------
async function getAllChapters() { const keys = await getAllKeys('chapters'); const chapters = {}; for (const k of keys) chapters[k] = await getData('chapters', k); return chapters; }
async function saveChapter(name, chapterObj) { await setData('chapters', name, chapterObj); }
async function deleteChapter(name) { await deleteData('chapters', name); }

// ---------- SM-2 Scheduler ----------
const LEARNING_STEPS = [5, 20];
const REVIEW_COOLDOWN = 300;
function gradeCard(cardState, button, elapsedSeconds) {
    const now = Date.now() / 1000;
    const MINUTE = 60, DAY = 86400;
    let { type, step, ease, interval } = cardState;
    if (!ease) ease = 250; if (!interval) interval = 0;
    let due = now;
    const stepSec = (i) => LEARNING_STEPS[i] * MINUTE;
    if (type === 'new' || type === 'learning') {
        if (button === 'again') { type = 'learning'; step = 0; interval = stepSec(0); due = now + interval; }
        else if (button === 'hard') { type = 'learning'; interval = stepSec(step); due = now + interval; }
        else if (button === 'good') {
            if (step + 1 >= LEARNING_STEPS.length) { type = 'review'; interval = 1 * DAY; due = now + interval; step = 0; }
            else { type = 'learning'; step += 1; interval = stepSec(step); due = now + interval; }
        } else if (button === 'easy') { type = 'review'; interval = Math.max(4, interval > 0 ? interval * 2 : 4) * DAY; due = now + interval; step = 0; }
    } else {
        if (button === 'again') { type = 'learning'; step = 0; ease = Math.max(130, ease - 20); interval = stepSec(0); due = now + interval; }
        else if (button === 'hard') { ease = Math.max(130, ease - 15); interval = Math.max(1, Math.round(interval * 1.2)); due = now + interval * DAY; }
        else if (button === 'good') { interval = Math.round(interval * (ease / 100)); due = now + interval * DAY; }
        else if (button === 'easy') { ease += 15; interval = Math.round(interval * (ease / 100) * 1.3); due = now + interval * DAY; }
    }
    return { type, step, ease, interval: type === 'review' ? interval : Math.ceil(interval / DAY * 100) / 100, due: Math.round(due), lastReview: Math.round(now) };
}

// ---------- Init DB and register service worker ----------
openDB();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
