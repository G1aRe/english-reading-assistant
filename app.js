(function() {
    'use strict';

    const state = {
        articleText: '',
        sentences: [],
        currentSentenceIndex: 0,
        isPlaying: false,
        isPaused: false,
        speechSynthesis: null,
        currentUtterance: null,
        wordCache: {}
    };

    const elements = {
        articleInput: document.getElementById('articleInput'),
        stats: document.getElementById('stats'),
        readAloudBtn: document.getElementById('readAloudBtn'),
        pauseBtn: document.getElementById('pauseBtn'),
        resetBtn: document.getElementById('resetBtn'),
        speedSelect: document.getElementById('speedSelect'),
        progressFill: document.getElementById('progressFill'),
        progressText: document.getElementById('progressText'),
        wordInfoPanel: document.getElementById('wordInfoPanel'),
        wordInfoContent: document.getElementById('wordInfoContent'),
        readingSection: document.getElementById('readingSection'),
        readingContent: document.getElementById('readingContent'),
        closeReadingBtn: document.getElementById('closeReadingBtn'),
        tooltip: document.getElementById('tooltip')
    };

    const FREE_DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

    function init() {
        state.speechSynthesis = window.speechSynthesis;
        bindEvents();
        updateStats();
        checkBrowserCompatibility();
    }

    function bindEvents() {
        elements.articleInput.addEventListener('input', handleArticleInput);
        elements.articleInput.addEventListener('mouseup', handleTextSelection);
        elements.articleInput.addEventListener('dblclick', handleDoubleClick);
        elements.readAloudBtn.addEventListener('click', toggleReadAloud);
        elements.pauseBtn.addEventListener('click', togglePause);
        elements.resetBtn.addEventListener('click', resetAll);
        elements.speedSelect.addEventListener('change', updateSpeed);
        elements.closeReadingBtn.addEventListener('click', closeReadingSection);

        document.addEventListener('keydown', handleKeyboard);
        document.addEventListener('click', handleOutsideClick);
    }

    function checkBrowserCompatibility() {
        if (!('speechSynthesis' in window)) {
            showNotification('您的浏览器不支持语音合成功能，请使用 Chrome、Firefox 或 Edge 浏览器。', 'error');
        }
    }

    function handleArticleInput() {
        state.articleText = elements.articleInput.value;
        updateStats();
        updateButtonStates();
    }

    function updateStats() {
        const text = state.articleText;
        if (!text.trim()) {
            elements.stats.innerHTML = '';
            return;
        }

        const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        const characters = text.length;
        const readingTime = Math.ceil(words / 200);

        elements.stats.innerHTML = `
            <span>${words} 单词</span>
            <span>${characters} 字符</span>
            <span>约 ${readingTime} 分钟</span>
        `;
    }

    function updateButtonStates() {
        const hasContent = state.articleText.trim().length > 0;
        elements.readAloudBtn.disabled = !hasContent;
        elements.resetBtn.disabled = !hasContent || (!state.isPlaying && !state.isPaused);
    }

    function handleTextSelection(event) {
        const selectedText = getSelectedText();
        if (selectedText && isEnglishWord(selectedText)) {
            lookupWord(selectedText.trim());
        }
    }

    function handleDoubleClick(event) {
        const selectedText = getSelectedText();
        if (selectedText && isEnglishWord(selectedText)) {
            lookupWord(selectedText.trim());
        }
    }

    function getSelectedText() {
        const text = window.getSelection().toString();
        return text;
    }

    function isEnglishWord(text) {
        return /^[a-zA-Z]+$/.test(text) && text.length > 0 && text.length < 50;
    }

    async function lookupWord(word) {
        const normalizedWord = word.toLowerCase();

        showWordLoading(word);

        if (state.wordCache[normalizedWord]) {
            displayWordInfo(state.wordCache[normalizedWord]);
            return;
        }

        try {
            const response = await fetch(`${FREE_DICTIONARY_API}/${normalizedWord}`);
            if (!response.ok) {
                throw new Error('Word not found');
            }

            const data = await response.json();
            const wordData = parseDictionaryApiResponse(data, normalizedWord);

            state.wordCache[normalizedWord] = wordData;
            saveCacheToStorage();
            displayWordInfo(wordData);
        } catch (error) {
            displayWordError(word, error.message);
        }
    }

    function parseDictionaryApiResponse(data, word) {
        const entry = data[0];
        const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics[0] ? entry.phonetics[0].text : '');
        let audioUrl = '';

        if (entry.phonetics) {
            for (const p of entry.phonetics) {
                if (p.audio && p.audio.includes('us.mp3')) {
                    audioUrl = p.audio;
                    break;
                }
            }
            if (!audioUrl && entry.phonetics.length > 0) {
                audioUrl = entry.phonetics[0].audio || '';
            }
        }

        return {
            word: word,
            phonetic: phonetic,
            audioUrl: audioUrl,
            source: 'Free Dictionary API'
        };
    }

    function showWordLoading(word) {
        elements.wordInfoContent.innerHTML = `
            <div class="word-display">
                <span class="word-text">${word}</span>
            </div>
            <div class="word-loading">
                <div class="spinner"></div>
                <span>查询中...</span>
            </div>
        `;
    }

    function displayWordInfo(wordData) {
        const hasAudio = wordData.audioUrl && wordData.audioUrl.length > 0;

        elements.wordInfoContent.innerHTML = `
            <div class="word-display">
                <span class="word-text">${wordData.word}</span>
                <span class="phonetic">${wordData.phonetic || '无音标'}</span>
                ${hasAudio ? `
                    <button class="play-btn" onclick="playWordAudio('${wordData.word}', '${wordData.audioUrl}')">
                        🔊
                    </button>
                ` : '<span style="font-size: 13px; color: var(--text-light);">（无发音）</span>'}
            </div>
            <div class="word-source">来源: ${wordData.source}</div>
        `;
    }

    function displayWordError(word, message) {
        elements.wordInfoContent.innerHTML = `
            <div class="word-error">
                <p>无法找到单词 "${word}" 的音标</p>
                <p style="font-size: 12px; margin-top: 4px;">${message}</p>
                <button class="retry-btn" onclick="lookupWord('${word}')">重试</button>
            </div>
        `;
    }

    window.playWordAudio = function(word, audioUrl) {
        if (!audioUrl) {
            speakWordUsingTTS(word);
            return;
        }

        const audio = new Audio(audioUrl);
        const playBtn = document.querySelector('.play-btn');
        const phonetic = document.querySelector('.phonetic');

        if (playBtn) {
            playBtn.classList.add('playing');
            playBtn.textContent = '🔊';
        }
        if (phonetic) {
            phonetic.classList.add('playing');
        }

        audio.play().catch(error => {
            console.log('Audio playback failed, falling back to TTS:', error);
            speakWordUsingTTS(word);
        });

        audio.onended = () => {
            if (playBtn) {
                playBtn.classList.remove('playing');
                playBtn.textContent = '🔊';
            }
            if (phonetic) {
                phonetic.classList.remove('playing');
            }
        };
    };

    function speakWordUsingTTS(word) {
        stopCurrentSpeech();

        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'en-US';
        utterance.rate = parseFloat(elements.speedSelect.value);

        const phonetic = document.querySelector('.phonetic');
        if (phonetic) {
            phonetic.classList.add('playing');
        }

        utterance.onend = () => {
            if (phonetic) {
                phonetic.classList.remove('playing');
            }
        };

        utterance.onerror = () => {
            if (phonetic) {
                phonetic.classList.remove('playing');
            }
        };

        state.speechSynthesis.speak(utterance);
    }

    function toggleReadAloud() {
        if (state.isPlaying) {
            stopReading();
        } else {
            startReading();
        }
    }

    function startReading() {
        const text = state.articleText.trim();
        if (!text) return;

        state.sentences = splitIntoSentences(text);
        state.currentSentenceIndex = 0;
        state.isPlaying = true;
        state.isPaused = false;

        showReadingSection();
        updateButtonStates();
        updateReadAloudButton();

        readNextSentence();
    }

    function splitIntoSentences(text) {
        return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    }

    function showReadingSection() {
        elements.readingSection.classList.add('active');
        elements.readingContent.innerHTML = state.sentences.map((sentence, index) => `
            <div class="reading-sentence" data-index="${index}" onclick="speakSentence(${index})">
                ${escapeHtml(sentence)}
            </div>
        `).join('');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.speakSentence = function(index) {
        if (index >= 0 && index < state.sentences.length) {
            const wasPlaying = state.isPlaying;
            if (wasPlaying) {
                stopReading();
            }
            speakText(state.sentences[index]);
            highlightSentence(index);
        }
    };

    function readNextSentence() {
        if (!state.isPlaying || state.isPaused) return;
        if (state.currentSentenceIndex >= state.sentences.length) {
            completeReading();
            return;
        }

        const sentence = state.sentences[state.currentSentenceIndex];
        speakText(sentence);
        highlightSentence(state.currentSentenceIndex);
        updateProgress();
    }

    function speakText(text) {
        stopCurrentSpeech();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = parseFloat(elements.speedSelect.value);

        utterance.onend = () => {
            if (state.isPlaying && !state.isPaused) {
                state.currentSentenceIndex++;
                setTimeout(readNextSentence, 300);
            }
        };

        utterance.onerror = (event) => {
            if (event.error !== 'interrupted') {
                state.currentSentenceIndex++;
                setTimeout(readNextSentence, 300);
            }
        };

        state.currentUtterance = utterance;
        state.speechSynthesis.speak(utterance);
    }

    function stopCurrentSpeech() {
        if (state.speechSynthesis) {
            state.speechSynthesis.cancel();
        }
    }

    function highlightSentence(index) {
        document.querySelectorAll('.reading-sentence').forEach((el, i) => {
            el.classList.remove('active');
            if (i < index) {
                el.classList.add('completed');
            }
        });

        const currentEl = document.querySelector(`.reading-sentence[data-index="${index}"]`);
        if (currentEl) {
            currentEl.classList.add('active');
            currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function updateProgress() {
        const progress = state.sentences.length > 0
            ? Math.round((state.currentSentenceIndex / state.sentences.length) * 100)
            : 0;

        elements.progressFill.style.width = `${progress}%`;
        elements.progressText.textContent = `${progress}%`;

        if (progress === 100) {
            elements.progressFill.classList.add('complete');
        } else {
            elements.progressFill.classList.remove('complete');
        }
    }

    function togglePause() {
        if (state.isPaused) {
            resumeReading();
        } else {
            pauseReading();
        }
    }

    function pauseReading() {
        state.isPaused = true;
        stopCurrentSpeech();
        updatePauseButton();
        elements.pauseBtn.querySelector('.btn-text').textContent = '继续';
    }

    function resumeReading() {
        state.isPaused = false;
        updatePauseButton();
        elements.pauseBtn.querySelector('.btn-text').textContent = '暂停';
        readNextSentence();
    }

    function stopReading() {
        state.isPlaying = false;
        state.isPaused = false;
        stopCurrentSpeech();
        updateButtonStates();
        updateReadAloudButton();
        elements.pauseBtn.querySelector('.btn-text').textContent = '暂停';
    }

    function completeReading() {
        state.isPlaying = false;
        state.isPaused = false;
        updateProgress();
        updateButtonStates();
        updateReadAloudButton();
        elements.pauseBtn.disabled = true;

        document.querySelectorAll('.reading-sentence').forEach(el => {
            el.classList.remove('active');
            el.classList.add('completed');
        });
    }

    function resetAll() {
        stopReading();
        state.currentSentenceIndex = 0;
        state.sentences = [];
        elements.progressFill.style.width = '0%';
        elements.progressText.textContent = '0%';
        elements.readingSection.classList.remove('active');
        elements.readingContent.innerHTML = '';
        elements.wordInfoContent.innerHTML = `
            <p class="word-info-empty">👆 选中文章中的单词即可查看音标和发音</p>
        `;
        updateButtonStates();
    }

    function updateButtonStates() {
        const hasContent = state.articleText.trim().length > 0;
        elements.readAloudBtn.disabled = !hasContent;
        elements.resetBtn.disabled = !hasContent;
        elements.pauseBtn.disabled = !state.isPlaying;
    }

    function updateReadAloudButton() {
        if (state.isPlaying) {
            elements.readAloudBtn.classList.add('playing');
            elements.readAloudBtn.querySelector('.btn-icon').textContent = '⏹';
            elements.readAloudBtn.querySelector('.btn-text').textContent = '停止';
        } else {
            elements.readAloudBtn.classList.remove('playing');
            elements.readAloudBtn.querySelector('.btn-icon').textContent = '🔊';
            elements.readAloudBtn.querySelector('.btn-text').textContent = '全文朗读';
        }
    }

    function updatePauseButton() {
        if (state.isPaused) {
            elements.pauseBtn.querySelector('.btn-icon').textContent = '▶';
            elements.pauseBtn.querySelector('.btn-text').textContent = '继续';
        } else {
            elements.pauseBtn.querySelector('.btn-icon').textContent = '⏸';
            elements.pauseBtn.querySelector('.btn-text').textContent = '暂停';
        }
    }

    function updateSpeed() {
        // Speed will be applied to next utterance
    }

    function closeReadingSection() {
        if (state.isPlaying) {
            stopReading();
        }
        elements.readingSection.classList.remove('active');
    }

    function handleKeyboard(event) {
        if (event.key === 'Escape') {
            closeReadingSection();
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!elements.readAloudBtn.disabled) {
                toggleReadAloud();
            }
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
            event.preventDefault();
            if (!elements.resetBtn.disabled) {
                resetAll();
            }
        }

        if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
            event.preventDefault();
            if (state.isPlaying && !elements.pauseBtn.disabled) {
                togglePause();
            }
        }
    }

    function handleOutsideClick(event) {
        if (!elements.wordInfoPanel.contains(event.target) &&
            !event.target.closest('.reading-sentence')) {
            // Optional: clear selection
        }
    }

    function saveCacheToStorage() {
        try {
            localStorage.setItem('wordCache', JSON.stringify(state.wordCache));
        } catch (e) {
            console.log('Cache storage not available');
        }
    }

    function loadCacheFromStorage() {
        try {
            const cache = localStorage.getItem('wordCache');
            if (cache) {
                state.wordCache = JSON.parse(cache);
            }
        } catch (e) {
            console.log('Cache loading not available');
        }
    }

    function showNotification(message, type = 'info') {
        console.log(`[${type}] ${message}`);
    }

    loadCacheFromStorage();
    init();
})();