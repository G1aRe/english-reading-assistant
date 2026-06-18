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
        wordCache: {},
        preferredVoice: null
    };

    const elements = {
        articleContent: document.getElementById('articleContent'),
        emptyState: document.getElementById('emptyState'),
        pasteBtn: document.getElementById('pasteBtn'),
        clearBtn: document.getElementById('clearBtn'),
        controlPanel: document.getElementById('controlPanel'),
        readAloudBtn: document.getElementById('readAloudBtn'),
        pauseBtn: document.getElementById('pauseBtn'),
        stopBtn: document.getElementById('stopBtn'),
        speedSelect: document.getElementById('speedSelect'),
        progressContainer: document.getElementById('progressContainer'),
        progressFill: document.getElementById('progressFill'),
        progressText: document.getElementById('progressText'),
        wordInfoPanel: document.getElementById('wordInfoPanel'),
        wordInfoContent: document.getElementById('wordInfoContent'),
        hiddenInput: document.getElementById('hiddenInput')
    };

    const FREE_DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';
    const TRANSLATION_API = 'https://api.mymemory.translated.net/get';

    function init() {
        state.speechSynthesis = window.speechSynthesis;
        bindEvents();
        checkBrowserCompatibility();
        loadCacheFromStorage();

        if (state.speechSynthesis.onvoiceschanged !== undefined) {
            state.speechSynthesis.onvoiceschanged = () => {
                state.preferredVoice = getPreferredVoice();
            };
        }
        setTimeout(() => {
            state.preferredVoice = getPreferredVoice();
        }, 100);
    }

    function bindEvents() {
        elements.pasteBtn.addEventListener('click', handlePaste);
        elements.clearBtn.addEventListener('click', handleClear);
        elements.articleContent.addEventListener('input', handleContentInput);
        elements.articleContent.addEventListener('mouseup', handleTextSelection);
        elements.articleContent.addEventListener('touchend', handleTextSelection);
        elements.articleContent.addEventListener('dblclick', handleDoubleClick);
        elements.readAloudBtn.addEventListener('click', toggleReadAloud);
        elements.pauseBtn.addEventListener('click', togglePause);
        elements.stopBtn.addEventListener('click', stopReading);
        elements.speedSelect.addEventListener('change', updateSpeed);
        document.addEventListener('keydown', handleKeyboard);
    }

    function checkBrowserCompatibility() {
        if (!('speechSynthesis' in window)) {
            showNotification('您的浏览器不支持语音合成功能，请使用 Chrome、Firefox 或 Edge 浏览器。', 'error');
        }
    }

    async function handlePaste() {
        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                const text = await navigator.clipboard.readText();
                if (text.trim()) {
                    setArticleContent(text);
                } else {
                    showNotification('剪贴板为空', 'info');
                }
            } catch (err) {
                showNotification('无法访问剪贴板，请直接粘贴到阅读区域', 'error');
            }
        } else {
            elements.hiddenInput.focus();
            elements.hiddenInput.select();

            const successful = document.execCommand('paste');
            const pastedText = elements.hiddenInput.value;
            elements.hiddenInput.value = '';

            if (pastedText.trim()) {
                setArticleContent(pastedText);
            } else {
                showNotification('剪贴板为空，请直接粘贴到阅读区域', 'info');
            }
        }
    }

    function handleClear() {
        stopReading();
        elements.articleContent.textContent = '';
        state.articleText = '';
        showEmptyState();
        elements.controlPanel.style.display = 'none';
        elements.progressContainer.style.display = 'none';
        elements.progressFill.style.width = '0%';
        elements.progressText.textContent = '0%';
        elements.wordInfoContent.innerHTML = '<p class="word-info-empty">👆 在上方选中或双击单词<br>即可查看音标和发音</p>';
    }

    function setArticleContent(text) {
        elements.articleContent.textContent = text;
        state.articleText = text;
        hideEmptyState();
        elements.controlPanel.style.display = 'block';
        updateButtonStates();
    }

    function handleContentInput() {
        state.articleText = elements.articleContent.textContent;

        if (!state.articleText.trim()) {
            showEmptyState();
            elements.controlPanel.style.display = 'none';
        } else {
            hideEmptyState();
            elements.controlPanel.style.display = 'block';
        }
        updateButtonStates();
    }

    function showEmptyState() {
        elements.emptyState.style.display = 'flex';
    }

    function hideEmptyState() {
        elements.emptyState.style.display = 'none';
    }

    function handleTextSelection(event) {
        setTimeout(() => {
            const selectedText = getSelectedText();
            if (selectedText && isEnglishWord(selectedText)) {
                lookupWord(selectedText.trim());
            }
        }, 50);
    }

    function handleDoubleClick(event) {
        setTimeout(() => {
            const selectedText = getSelectedText();
            if (selectedText && isEnglishWord(selectedText)) {
                lookupWord(selectedText.trim());
            }
        }, 50);
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
            const dictResponse = await fetch(`${FREE_DICTIONARY_API}/${normalizedWord}`);

            let phonetic = '';
            let audioUrl = '';
            let englishMeanings = [];
            let chineseMeanings = [];

            if (dictResponse.ok) {
                const dictData = await dictResponse.json();
                const parsed = parseDictionaryApiResponse(dictData, normalizedWord);
                phonetic = parsed.phonetic;
                audioUrl = parsed.audioUrl;
                englishMeanings = parsed.meanings;

                const englishDefinitions = englishMeanings.map(m => m.definition).slice(0, 3);

                const transPromises = englishDefinitions.map(def =>
                    fetch(`${TRANSLATION_API}?q=${encodeURIComponent(def)}&langpair=en|zh-CN`)
                );

                const transResponses = await Promise.all(transPromises);
                for (const res of transResponses) {
                    if (res.ok) {
                        const data = await res.json();
                        if (data.responseStatus === 200 && data.responseData) {
                            chineseMeanings.push(data.responseData.translatedText);
                        }
                    }
                }
            }

            if (chineseMeanings.length === 0) {
                const mainTransResponse = await fetch(`${TRANSLATION_API}?q=${encodeURIComponent(normalizedWord)}&langpair=en|zh-CN`);
                if (mainTransResponse.ok) {
                    const data = await mainTransResponse.json();
                    if (data.responseStatus === 200 && data.responseData) {
                        chineseMeanings.push(data.responseData.translatedText);
                    }
                }
            }

            const wordData = {
                word: normalizedWord,
                phonetic: phonetic,
                audioUrl: audioUrl,
                meanings: englishMeanings,
                chineseMeanings: chineseMeanings,
                source: 'Free Dictionary API'
            };

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

        const meanings = [];
        if (entry.meanings) {
            for (const meaning of entry.meanings) {
                const partOfSpeech = meaning.partOfSpeech || '';
                const definitions = meaning.definitions || [];
                for (const def of definitions.slice(0, 2)) {
                    meanings.push({
                        partOfSpeech: partOfSpeech,
                        definition: def.definition
                    });
                }
            }
        }

        return {
            phonetic: phonetic,
            audioUrl: audioUrl,
            meanings: meanings
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

        let html = `
            <div class="word-display">
                <span class="word-text">${wordData.word}</span>
                ${hasAudio ? `
                    <button class="play-btn" onclick="playWordAudio('${wordData.word}', '${wordData.audioUrl}')">
                        🔊
                    </button>
                ` : `
                    <button class="play-btn" onclick="playWordAudioTTS('${wordData.word}')">
                        🔊
                    </button>
                `}
            </div>
        `;

        if (wordData.chineseMeanings && wordData.chineseMeanings.length > 0) {
            html += `<div class="chinese-meanings">`;
            wordData.chineseMeanings.forEach((meaning, index) => {
                html += `<div class="chinese-meaning-item">
                    <span class="meaning-number">${index + 1}.</span>
                    <span class="meaning-text">${meaning}</span>
                </div>`;
            });
            html += `</div>`;
        }

        if (wordData.meanings && wordData.meanings.length > 0) {
            html += `<div class="meanings-list">`;
            for (const m of wordData.meanings.slice(0, 3)) {
                html += `<div class="meaning-item">
                    <span class="part-of-speech">${m.partOfSpeech}</span>
                    <span class="definition">${m.definition}</span>
                </div>`;
            }
            html += `</div>`;
        }

        html += `<div class="word-source">来源: ${wordData.source}</div>`;

        elements.wordInfoContent.innerHTML = html;
    }

    function displayWordError(word, message) {
        elements.wordInfoContent.innerHTML = `
            <div class="word-error">
                <p>无法找到 "${word}" 的含义</p>
                <p style="font-size: 12px; margin-top: 4px; color: var(--text-light);">请检查拼写是否正确</p>
                <button class="retry-btn" onclick="lookupWord('${word}')">重试</button>
            </div>
        `;
    }

    window.playWordAudio = function(word, audioUrl) {
        if (!audioUrl) {
            playWordAudioTTS(word);
            return;
        }

        const audio = new Audio(audioUrl);
        const playBtn = document.querySelector('.play-btn');

        if (playBtn) {
            playBtn.classList.add('playing');
            playBtn.textContent = '...';
        }

        audio.play().catch(error => {
            console.log('Audio playback failed, falling back to TTS:', error);
            playWordAudioTTS(word);
        });

        audio.onended = () => {
            if (playBtn) {
                playBtn.classList.remove('playing');
                playBtn.textContent = '🔊';
            }
        };
    };

    window.playWordAudioTTS = function(word) {
        stopCurrentSpeech();

        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'en-US';
        utterance.rate = parseFloat(elements.speedSelect.value);

        if (state.preferredVoice) {
            utterance.voice = state.preferredVoice;
        }

        const playBtn = document.querySelector('.play-btn');
        if (playBtn) {
            playBtn.classList.add('playing');
            playBtn.textContent = '...';
        }

        utterance.onend = () => {
            if (playBtn) {
                playBtn.classList.remove('playing');
                playBtn.textContent = '🔊';
            }
        };

        utterance.onerror = () => {
            if (playBtn) {
                playBtn.classList.remove('playing');
                playBtn.textContent = '🔊';
            }
        };

        state.speechSynthesis.speak(utterance);
    };

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

        elements.progressContainer.style.display = 'flex';
        updateButtonStates();
        updateReadAloudButton();

        readNextSentence();
    }

    function splitIntoSentences(text) {
        return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    }

    function readNextSentence() {
        if (!state.isPlaying || state.isPaused) return;
        if (state.currentSentenceIndex >= state.sentences.length) {
            completeReading();
            return;
        }

        const sentence = state.sentences[state.currentSentenceIndex];
        speakText(sentence);
        updateProgress();
    }

    function speakText(text) {
        stopCurrentSpeech();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = parseFloat(elements.speedSelect.value);

        if (state.preferredVoice) {
            utterance.voice = state.preferredVoice;
        }

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

    function getPreferredVoice() {
        const voices = state.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return null;

        const englishVoices = voices.filter(v => v.lang.startsWith('en'));

        const preferredNames = [
            'Google US English',
            'Microsoft Server Speech Text to Speech Voice (en-US, Eva)',
            'Samantha',
            'Daniel',
            'Karen',
            'Tom',
            'Google English (US)',
            'Microsoft English (US)'
        ];

        for (const name of preferredNames) {
            const found = englishVoices.find(v => v.name.includes(name.split(' ')[0]));
            if (found) return found;
        }

        return englishVoices[0] || voices[0];
    }

    function stopCurrentSpeech() {
        if (state.speechSynthesis) {
            state.speechSynthesis.cancel();
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
    }

    function updateButtonStates() {
        const hasContent = state.articleText.trim().length > 0;
        elements.readAloudBtn.disabled = !hasContent;
        elements.stopBtn.disabled = !state.isPlaying;
        elements.pauseBtn.disabled = !state.isPlaying;
        elements.clearBtn.disabled = !hasContent;
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
    }

    function handleKeyboard(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!elements.readAloudBtn.disabled) {
                toggleReadAloud();
            }
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
            setTimeout(() => {
                if (!state.articleText.trim()) {
                    handlePaste();
                }
            }, 100);
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

    init();
})();