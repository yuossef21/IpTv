let api = null;
let currentType = '';
let currentStreamUrl = '';
let vjsPlayer = null;
let hlsInstance = null;

let allCurrentStreams = [];
let globalStreamsCache = { live: null, movies: null, series: null };
let searchTimeout = null;

let displayedCount = 0;
const CHUNK_SIZE = 40;
let scrollObserver = null;

// صورة مدمجة بالكود بالكامل لتجنب أخطاء الشبكة
const FALLBACK_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22200%22%20height%3D%22300%22%20style%3D%22background%3A%230b0c10%22%3E%3Ctext%20fill%3D%22%233d4465%22%20y%3D%2250%25%22%20x%3D%2250%25%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2216px%22%20font-weight%3D%22bold%22%3ENO%20IMAGE%3C%2Ftext%3E%3C%2Fsvg%3E";

const dom = {
    loginScreen: document.getElementById('login-screen'),
    dashScreen: document.getElementById('dashboard-screen'),
    playerScreen: document.getElementById('player-screen'),
    seriesModal: document.getElementById('series-modal'),
    searchInput: document.getElementById('search-input'),
    displayUser: document.getElementById('display-user'),
    loginForm: document.getElementById('login-form'),
    mainDash: document.getElementById('main-dash'),
    contentView: document.getElementById('content-view'),
    categoriesList: document.getElementById('categories-list'),
    streamsList: document.getElementById('streams-list'),
    contentTitle: document.getElementById('content-title'),
    playerTitle: document.getElementById('player-title'),
    engineSelect: document.getElementById('engine-select')
};

// --- الإقلاع والمصادقة ---
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('iptv_session')) {
        api = new XtreamAPI();
        showScreen(dom.dashScreen);
        dom.displayUser.textContent = `مرحباً، ${api.session.username}`;
    }
});

dom.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = document.getElementById('server-url').value.trim();
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);

    const btn = document.getElementById('login-btn');
    btn.textContent = 'جاري التحقق...';
    try {
        const tempApi = new XtreamAPI();
        const data = await tempApi.authenticate(url, user, pass);
        if (data.user_info && data.user_info.auth === 1) {
            localStorage.setItem('iptv_session', JSON.stringify({ url, username: user, password: pass }));
            api = new XtreamAPI();
            dom.displayUser.textContent = `مرحباً، ${user}`;
            showScreen(dom.dashScreen);
        } else throw new Error('بيانات الدخول غير صحيحة');
    } catch (error) {
        document.getElementById('login-error').textContent = 'خطأ بالاتصال. تأكد من الرابط أو الشبكة.';
    } finally {
        btn.textContent = 'اتصال بالسيرفر';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('iptv_session');
    api = null;
    globalStreamsCache = { live: null, movies: null, series: null };
    showScreen(dom.loginScreen);
});

// --- الأقسام ---
document.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', async () => {
        currentType = card.getAttribute('data-type');
        dom.contentTitle.textContent = card.querySelector('h3').textContent;
        dom.mainDash.style.display = 'none';
        dom.contentView.style.display = 'flex';
        dom.searchInput.value = '';

        dom.categoriesList.innerHTML = '<div class="category-item">جاري التحميل...</div>';
        dom.streamsList.innerHTML = '';

        try {
            const categories = await api.getCategories(currentType);
            renderCategories(categories);
        } catch (error) {
            dom.categoriesList.innerHTML = '<div class="category-item" style="color:red;">خطأ بالتحميل</div>';
        }
    });
});

document.getElementById('back-to-dash-btn').addEventListener('click', () => {
    dom.contentView.style.display = 'none';
    dom.mainDash.style.display = 'grid';
});

function renderCategories(categories) {
    dom.categoriesList.innerHTML = '';
    const innerDiv = document.createElement('div');
    dom.categoriesList.appendChild(innerDiv);

    if (!categories || !categories.length) return innerDiv.innerHTML = '<div class="category-item">لا توجد أقسام</div>';

    categories.forEach((cat, index) => {
        const div = document.createElement('div');
        div.className = 'category-item';
        div.textContent = cat.category_name;
        div.onclick = () => {
            document.querySelectorAll('.category-item').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            dom.searchInput.value = '';
            loadStreams(cat.category_id);
        };
        innerDiv.appendChild(div);
        if (index === 0) div.click();
    });
}

// --- نظام العرض اللانهائي والبحث ---
async function loadStreams(categoryId) {
    dom.streamsList.innerHTML = '<h3 style="grid-column: 1/-1; text-align:center;">جاري التحميل...</h3>';
    try {
        allCurrentStreams = await api.getStreams(currentType, categoryId) || [];
        renderStreamsList(allCurrentStreams, true);
    } catch (error) {
        dom.streamsList.innerHTML = '<h3 style="color:red; grid-column: 1/-1; text-align:center;">خطأ بالتحميل</h3>';
    }
}

function renderStreamsList(streamsArray, isNewList = false) {
    if (isNewList) {
        dom.streamsList.innerHTML = '';
        displayedCount = 0;
        if (scrollObserver) scrollObserver.disconnect();
    }

    if (!streamsArray || streamsArray.length === 0) {
        if (isNewList) dom.streamsList.innerHTML = '<h3 style="grid-column: 1/-1; text-align:center;">لا يوجد محتوى</h3>';
        return;
    }

    const chunk = streamsArray.slice(displayedCount, displayedCount + CHUNK_SIZE);

    chunk.forEach(stream => {
        const card = document.createElement('div');
        card.className = 'stream-card';
        const iconUrl = stream.stream_icon || stream.cover || FALLBACK_IMAGE;
        const name = stream.name || stream.title;
        const streamId = stream.stream_id || stream.series_id;

        // إبقاء m3u8 ليتمكن Hls.js من العمل بشكل صحيح
        const ext = currentType === 'live' ? 'm3u8' : (stream.container_extension || 'mp4');

        card.innerHTML = `<img loading="lazy" src="${iconUrl}" onerror="this.src='${FALLBACK_IMAGE}'"><h4>${name}</h4>`;
        card.onclick = () => {
            if (currentType === 'series') openSeriesModal(streamId, name);
            else openPlayer(streamId, name, ext);
        };
        dom.streamsList.appendChild(card);
    });

    displayedCount += chunk.length;

    if (displayedCount < streamsArray.length) {
        const sentinel = document.createElement('div');
        sentinel.className = 'scroll-sentinel';
        sentinel.style.height = '20px';
        sentinel.style.gridColumn = '1/-1';
        dom.streamsList.appendChild(sentinel);

        scrollObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                scrollObserver.unobserve(sentinel);
                sentinel.remove();
                renderStreamsList(streamsArray, false);
            }
        }, { root: dom.streamsList, rootMargin: "200px" });

        scrollObserver.observe(sentinel);
    }
}

dom.searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    clearTimeout(searchTimeout);

    if (term === '') {
        const activeCat = document.querySelector('.category-item.active');
        if (activeCat) activeCat.click();
        return;
    }

    searchTimeout = setTimeout(async () => {
        dom.streamsList.innerHTML = '<h3 style="grid-column: 1/-1; text-align:center;">جاري البحث في السيرفر بالكامل...</h3>';
        try {
            if (!globalStreamsCache[currentType]) globalStreamsCache[currentType] = await api.getAllStreams(currentType);
            const allData = globalStreamsCache[currentType] || [];
            const filtered = allData.filter(stream => {
                const name = (stream.name || stream.title || '').toLowerCase();
                return name.includes(term);
            });
            renderStreamsList(filtered, true);
            document.querySelectorAll('.category-item').forEach(el => el.classList.remove('active'));
        } catch (error) {
            dom.streamsList.innerHTML = '<h3 style="color:red; grid-column: 1/-1; text-align:center;">فشل البحث العام</h3>';
        }
    }, 500);
});

// --- المسلسلات ---
async function openSeriesModal(seriesId, seriesTitle) {
    dom.seriesModal.classList.add('active');
    document.getElementById('series-title-display').textContent = seriesTitle;
    const seasonsContainer = document.getElementById('seasons-container');
    const episodesContainer = document.getElementById('episodes-container');

    seasonsContainer.innerHTML = 'جاري جلب البيانات...';
    episodesContainer.innerHTML = '';

    try {
        const seriesData = await api.getSeriesInfo(seriesId);
        if (!seriesData || !seriesData.episodes) throw new Error('لا توجد حلقات');

        const episodesObj = seriesData.episodes;
        const seasonNumbers = Object.keys(episodesObj);
        seasonsContainer.innerHTML = '';

        seasonNumbers.forEach((seasonNum, index) => {
            const btn = document.createElement('button');
            btn.className = 'season-btn';
            btn.textContent = `موسم ${seasonNum}`;
            btn.onclick = () => {
                document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderEpisodes(episodesObj[seasonNum]);
            };
            seasonsContainer.appendChild(btn);
            if (index === 0) btn.click();
        });

    } catch (error) {
        seasonsContainer.innerHTML = '<span style="color:red">فشل جلب تفاصيل المسلسل</span>';
    }
}

function renderEpisodes(episodesArray) {
    const container = document.getElementById('episodes-container');
    container.innerHTML = '';
    episodesArray.forEach(ep => {
        const card = document.createElement('div');
        card.className = 'episode-card';
        const title = ep.title || `حلقة ${ep.episode_num}`;
        const ext = ep.container_extension || 'mp4';

        card.innerHTML = `<h4>${title}</h4><p style="font-size:0.8rem;color:#888;">${ep.info?.duration || ''}</p>`;
        card.onclick = () => {
            dom.seriesModal.classList.remove('active');
            openPlayer(ep.id, title, ext, 'series');
        };
        container.appendChild(card);
    });
}

document.getElementById('close-modal-btn').addEventListener('click', () => dom.seriesModal.classList.remove('active'));

// --- محرك المشغل الاحترافي المضاد للانهيار ---
function openPlayer(streamId, title, extension, forcedType = null) {
    dom.playerTitle.textContent = title;
    currentStreamUrl = api.getStreamUrl(forcedType || currentType, streamId, extension);
    showScreen(dom.playerScreen);
    triggerPlayer();
}

function triggerPlayer() {
    const engine = dom.engineSelect.value;
    const videoElement = resetPlayerEnvironment();
    const playerContainer = document.getElementById('player-container');

    const isTs = currentStreamUrl.endsWith('.ts');
    const isM3u8 = currentStreamUrl.endsWith('.m3u8');
    // معرفة ما إذا كان المحتوى VOD (فيلم أو مسلسل)
    const isVOD = currentStreamUrl.includes('/movie/') || currentStreamUrl.includes('/series/');

    if (engine !== "videojs") {
        playerContainer.ondblclick = () => {
            if (!document.fullscreenElement) playerContainer.requestFullscreen().catch(e => e);
            else document.exitFullscreen();
        };
    }

    if (engine === "videojs") {
        const mimeType = isM3u8 ? 'application/x-mpegURL' :
            (currentStreamUrl.includes('.mkv') ? 'video/x-matroska' :
                (isTs ? 'video/mp2t' : 'video/mp4'));

        vjsPlayer = videojs(videoElement, {
            controls: true, autoplay: false, preload: 'auto',
            html5: { vhs: { overrideNative: true, limitRenditionByPlayerDimensions: false } }
        });

        vjsPlayer.src({ src: currentStreamUrl, type: mimeType });
        vjsPlayer.ready(function () { safePlay(vjsPlayer); });

        vjsPlayer.on('error', function () {
            console.warn('إعادة ضبط Video.js...');
            setTimeout(() => { if (dom.playerScreen.classList.contains('active')) triggerPlayer(); }, 2000);
        });

    } else {
        videoElement.className = '';

        // إذا كان البث مباشراً ويدعم m3u8، نستخدم Hls.js الاحترافي
        if (!isVOD && Hls.isSupported() && isM3u8) {
            hlsInstance = new Hls({
                maxBufferLength: 10,
                maxMaxBufferLength: 20,
                enableWorker: true,
                lowLatencyMode: true,
                fragLoadingTimeOut: 15000,
                manifestLoadingMaxRetry: 5,
                levelLoadingMaxRetry: 5
            });

            hlsInstance.loadSource(currentStreamUrl);
            hlsInstance.attachMedia(videoElement);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => safePlay(videoElement));

            hlsInstance.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        setTimeout(() => hlsInstance.startLoad(), 1000);
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hlsInstance.recoverMediaError();
                    } else {
                        hlsInstance.destroy(); setTimeout(triggerPlayer, 2000);
                    }
                }
            });
        } else {
            // إذا كان فيلماً أو مسلسلاً (VOD) أو لا يدعم HLS، نستخدم المشغل الخام فوراً (أسرع وأخف)
            videoElement.src = currentStreamUrl;
            safePlay(videoElement);
        }
    }
}

// حاضنة الأخطاء الصامتة لمنع نزيف الـ DOMException
function safePlay(mediaElement) {
    const playPromise = mediaElement.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            if (error.name !== 'AbortError') console.warn("منع المتصفح التشغيل:", error);
        });
    }
}

dom.engineSelect.addEventListener('change', triggerPlayer);

document.getElementById('close-player-btn').addEventListener('click', () => {
    resetPlayerEnvironment();
    showScreen(dom.dashScreen);
    dom.mainDash.style.display = 'none';
    dom.contentView.style.display = 'flex';
    if (document.fullscreenElement) document.exitFullscreen();
});

// القتل الجذري للـ DOM والاتصالات
function resetPlayerEnvironment() {
    const container = document.getElementById('player-container');
    container.ondblclick = null;

    if (vjsPlayer) { try { vjsPlayer.dispose(); } catch (e) { } vjsPlayer = null; }
    if (hlsInstance) { try { hlsInstance.stopLoad(); hlsInstance.detachMedia(); hlsInstance.destroy(); } catch (e) { } hlsInstance = null; }

    container.innerHTML = '<div id="video-wrapper"><video id="main-video" class="video-js vjs-default-skin" controls preload="auto" style="width:100%; height:100%; object-fit:contain;"></video></div>';
    return document.getElementById('main-video');
}

// --- تنقل الواجهات ---
function showScreen(screenEl) {
    Object.values(dom).forEach(el => { if (el && el.classList?.contains('screen')) el.classList.remove('active'); });
    if (screenEl) screenEl.classList.add('active');
}