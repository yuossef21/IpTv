let api = null;
let currentType = '';
let currentStreamUrl = '';
let vjsPlayer = null;
let hlsInstance = null;
let mpegtsInstance = null;

let allCurrentStreams = [];
let globalStreamsCache = { live: null, movies: null, series: null };
let searchTimeout = null;

let displayedCount = 0;
const CHUNK_SIZE = 40;
let scrollObserver = null;

// نظام إحصائيات الشبكة
const NetworkStats = {
    estimatedBandwidth: 50 * 1024 * 1024, // افتراض 50 Mbps للبداية
    update(bw) { this.estimatedBandwidth = bw; }
};

const FALLBACK_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22200%22%20height%3D%22300%22%20style%3D%22background%3A%230b0c10%22%3E%3Ctext%20fill%3D%22%233d4465%22%20y%3D%2250%25%22%20x%3D%2250%25%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2216px%22%20font-weight%3D%22bold%22%3ENO%20IMAGE%3C%2Ftext%3E%3C%2Fsvg%3E";

// ===== إعدادات HLS المحسّنة لاستغلال سرعة الإنترنت العالية =====
function getHlsConfig(isLive) {
    return {
        // Buffer كبير جداً لمنع أي تقطع
        maxBufferLength: isLive ? 30 : 60,
        maxMaxBufferLength: isLive ? 60 : 300,
        maxBufferSize: 120 * 1024 * 1024,       // 120MB buffer في الذاكرة
        maxBufferHole: 0.3,

        // استغلال كامل للعرض الترددي
        startLevel: -1,                           // ابدأ من أعلى جودة تلقائياً
        abrEwmaDefaultEstimate: 50 * 1024 * 1024, // افتراض 50 Mbps ابتداءً
        abrBandWidthFactor: 0.92,
        abrBandWidthUpFactor: 0.85,

        // استرداد سريع من الأخطاء
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 8,
        levelLoadingRetryDelay: 500,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,

        // أداء
        enableWorker: true,
        lowLatencyMode: isLive,
        backBufferLength: isLive ? 10 : 60,

        // طلب الـ fragments بشكل متوازٍ
        maxFragLookUpTolerance: 0.2,
        progressive: true,
        testBandwidth: true,

        // CORS headers
        xhrSetup: function (xhr, url) {
            xhr.withCredentials = false;
        },
        fetchSetup: function (context, initParams) {
            initParams.credentials = 'omit';
            initParams.mode = 'cors';
            initParams.headers = initParams.headers || {};
            initParams.headers['User-Agent'] = 'Mozilla/5.0';
            return new Request(context.url, initParams);
        }
    };
}

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
    updatePlayerUI();
});

function updatePlayerUI() {
    // عرض معلومات المشغل المختار
    const select = dom.engineSelect;
    if (select) {
        select.addEventListener('change', () => {
            showNotification(`تم تغيير المحرك إلى: ${select.options[select.selectedIndex].text}`);
            triggerPlayer();
        });
    }
}

dom.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = document.getElementById('server-url').value.trim();
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);

    const btn = document.getElementById('login-btn');
    btn.textContent = 'جاري التحقق...';
    document.getElementById('login-error').textContent = '';
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
        const ext = ep.container_extension || 'mkv';

        card.innerHTML = `<h4>${title}</h4><p style="font-size:0.8rem;color:#888;">${ep.info?.duration || ''}</p>`;
        card.onclick = () => {
            dom.seriesModal.classList.remove('active');
            openPlayer(ep.id, title, ext, 'series');
        };
        container.appendChild(card);
    });
}

document.getElementById('close-modal-btn').addEventListener('click', () => dom.seriesModal.classList.remove('active'));

// ===== محرك المشغل الاحترافي المحسّن =====

function openPlayer(streamId, title, extension, forcedType = null) {
    dom.playerTitle.textContent = title;
    const type = forcedType || currentType;
    currentStreamUrl = api.getStreamUrl(type, streamId, extension);

    // حفظ معلومات إضافية للاسترداد
    window._currentPlayerInfo = { streamId, title, extension, type };

    showScreen(dom.playerScreen);
    triggerPlayer();
}

// ===== النظام الذكي لاختيار محرك التشغيل =====
function triggerPlayer() {
    const videoElement = resetPlayerEnvironment();
    const engine = dom.engineSelect.value;
    const url = currentStreamUrl;

    const isLive = url.includes('/live/');
    const isVOD = url.includes('/movie/') || url.includes('/series/');
    const ext = url.split('.').pop().toLowerCase().split('?')[0];
    const isHLS = ext === 'm3u8' || ext === 'm3u';
    const isMKV = ext === 'mkv';
    const isMP4 = ext === 'mp4';
    const isTS = ext === 'ts';

    // ضبط الشاشة الكاملة بالنقر المزدوج
    const playerContainer = document.getElementById('player-container');
    playerContainer.ondblclick = () => {
        if (!document.fullscreenElement) playerContainer.requestFullscreen().catch(e => e);
        else document.exitFullscreen();
    };

    // عرض شاشة التحميل
    showBufferingOverlay(true);

    videoElement.addEventListener('canplay', () => showBufferingOverlay(false), { once: true });
    videoElement.addEventListener('playing', () => showBufferingOverlay(false));
    videoElement.addEventListener('waiting', () => showBufferingOverlay(true));

    if (engine === 'videojs') {
        playWithVideoJS(videoElement, url, isHLS, isMKV, isTS);
    } else if (engine === 'hlsjs') {
        if (isHLS && Hls.isSupported()) {
            playWithHlsJS(videoElement, url, isLive);
        } else if (isHLS && videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            videoElement.src = url;
            safePlay(videoElement);
        } else if (isVOD) {
            // VOD مباشر (mp4/mkv) - المتصفح يتعامل معه مباشرة
            playDirectVideo(videoElement, url);
        } else {
            playWithHlsJS(videoElement, url, isLive);
        }
    } else {
        // محرك المشغل الخام
        playDirectVideo(videoElement, url);
    }
}

// ===== Hls.js المحسّن لاستغلال 50+ Mbps =====
function playWithHlsJS(videoElement, url, isLive) {
    const config = getHlsConfig(isLive);
    hlsInstance = new Hls(config);

    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(videoElement);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log(`✅ HLS جاهز - ${data.levels.length} مستويات جودة`);
        // فرض أعلى مستوى جودة فوراً
        hlsInstance.currentLevel = hlsInstance.levels.length - 1;
        safePlay(videoElement);
    });

    // مراقبة عرض الترددي في الوقت الفعلي
    hlsInstance.on(Hls.Events.FRAG_LOADED, (event, data) => {
        const bw = hlsInstance.bandwidthEstimate;
        if (bw > 0) {
            NetworkStats.update(bw);
            updateBandwidthDisplay(bw);
        }
    });

    // نظام استرداد متعدد الطبقات من الأخطاء
    let errorCount = 0;
    hlsInstance.on(Hls.Events.ERROR, function (event, data) {
        console.warn('HLS خطأ:', data.type, data.details);
        errorCount++;

        if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                console.log('🔄 إعادة تحميل الشبكة...');
                setTimeout(() => {
                    if (hlsInstance) hlsInstance.startLoad();
                }, Math.min(errorCount * 1000, 5000));
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                console.log('🔄 استرداد خطأ الميديا...');
                hlsInstance.recoverMediaError();
            } else {
                console.log('💀 خطأ فادح، إعادة تشغيل كاملة...');
                setTimeout(() => {
                    if (dom.playerScreen.classList.contains('active')) triggerPlayer();
                }, 3000);
            }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            console.log('⚠️ Buffer فارغ، إعادة تحميل...');
            hlsInstance.startLoad();
        }
    });
}

// ===== Video.js للمحتوى التقليدي =====
function playWithVideoJS(videoElement, url, isHLS, isMKV, isTS) {
    const mimeType = isHLS ? 'application/x-mpegURL' :
        (isMKV ? 'video/x-matroska' :
            (isTS ? 'video/mp2t' : 'video/mp4'));

    vjsPlayer = videojs(videoElement, {
        controls: true,
        autoplay: false,
        preload: 'auto',
        html5: {
            vhs: {
                overrideNative: true,
                limitRenditionByPlayerDimensions: false,
                useDevicePixelRatio: true,
                bandwidth: 50000000, // ابدأ من 50 Mbps
                enableLowInitialPlaylist: false,
                smoothQualityChange: true,
            },
            nativeAudioTracks: false,
            nativeVideoTracks: false,
        },
        liveui: url.includes('/live/'),
    });

    vjsPlayer.src({ src: url, type: mimeType });
    vjsPlayer.ready(function () {
        safePlay(vjsPlayer);
    });

    vjsPlayer.on('error', function () {
        const err = vjsPlayer.error();
        console.warn('Video.js خطأ:', err);
        setTimeout(() => {
            if (dom.playerScreen.classList.contains('active')) triggerPlayer();
        }, 3000);
    });
}

// ===== تشغيل مباشر للـ VOD (أسرع وأخف) =====
function playDirectVideo(videoElement, url) {
    videoElement.src = url;
    videoElement.preload = 'auto';

    // استغلال كامل سرعة الإنترنت بالتحميل المسبق
    videoElement.addEventListener('loadedmetadata', () => {
        console.log(`✅ فيديو جاهز: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
    }, { once: true });

    videoElement.addEventListener('error', (e) => {
        console.error('خطأ مشغل مباشر:', e);
        // محاولة عبر البروكسي
        if (!videoElement.src.includes('proxy.php')) {
            console.log('🔄 المحاولة عبر البروكسي...');
            videoElement.src = `proxy.php?url=${encodeURIComponent(url)}`;
            safePlay(videoElement);
        }
    }, { once: true });

    safePlay(videoElement);
}

// ===== مؤشر سرعة البث =====
function updateBandwidthDisplay(bw) {
    const mbps = (bw / 1024 / 1024).toFixed(1);
    let indicator = document.getElementById('bw-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'bw-indicator';
        indicator.style.cssText = `
            position: absolute; top: 10px; left: 10px; z-index: 100;
            background: rgba(0,0,0,0.7); color: #4ade80;
            padding: 4px 10px; border-radius: 4px; font-size: 12px;
            font-family: monospace; pointer-events: none;
        `;
        document.getElementById('player-container').appendChild(indicator);
    }
    indicator.textContent = `⚡ ${mbps} Mbps`;
}

// ===== overlay التحميل =====
function showBufferingOverlay(show) {
    let overlay = document.getElementById('buffering-overlay');
    if (show && !overlay) {
        overlay = document.createElement('div');
        overlay.id = 'buffering-overlay';
        overlay.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 50; pointer-events: none;
        `;
        overlay.innerHTML = `
            <div style="text-align:center">
                <div style="width:50px;height:50px;border:3px solid #3b82f6;border-top-color:transparent;
                    border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px;"></div>
                <div style="color:white;font-size:14px;">جاري التحميل...</div>
            </div>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        `;
        document.getElementById('player-container').appendChild(overlay);
    } else if (!show && overlay) {
        overlay.remove();
    }
}

// ===== إشعارات خفيفة =====
function showNotification(msg) {
    const el = document.createElement('div');
    el.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        background: #1e293b; color: #f8fafc; padding: 12px 20px;
        border-radius: 8px; border-left: 3px solid #3b82f6;
        font-size: 14px; animation: fadeIn 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// حاضنة الأخطاء الصامتة
function safePlay(mediaElement) {
    const target = mediaElement.play ? mediaElement : null;
    if (!target) return;
    const p = target.play();
    if (p !== undefined) {
        p.catch(e => {
            if (e.name !== 'AbortError') console.warn("منع المتصفح التشغيل:", e.name);
        });
    }
}

document.getElementById('close-player-btn').addEventListener('click', () => {
    resetPlayerEnvironment();
    showScreen(dom.dashScreen);
    dom.mainDash.style.display = 'none';
    dom.contentView.style.display = 'flex';
    if (document.fullscreenElement) document.exitFullscreen();
});

// إيقاف كامل وتنظيف الذاكرة
function resetPlayerEnvironment() {
    const container = document.getElementById('player-container');
    if (container) container.ondblclick = null;

    if (vjsPlayer) {
        try { vjsPlayer.pause(); vjsPlayer.dispose(); } catch (e) { }
        vjsPlayer = null;
    }
    if (hlsInstance) {
        try {
            hlsInstance.stopLoad();
            hlsInstance.detachMedia();
            hlsInstance.destroy();
        } catch (e) { }
        hlsInstance = null;
    }
    if (mpegtsInstance) {
        try { mpegtsInstance.destroy(); } catch (e) { }
        mpegtsInstance = null;
    }

    // إعادة بناء العنصر من جديد لضمان تنظيف كامل
    if (container) {
        container.innerHTML = `
            <div id="buffering-overlay" style="display:none"></div>
            <div id="video-wrapper">
                <video id="main-video" class="video-js vjs-default-skin" controls preload="auto"
                    style="width:100%; height:100%; object-fit:contain;"></video>
            </div>
        `;
    }

    return document.getElementById('main-video');
}

// --- تنقل الواجهات ---
function showScreen(screenEl) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    if (screenEl) screenEl.classList.add('active');
}