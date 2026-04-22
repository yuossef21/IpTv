class XtreamAPI {
    constructor() {
        this.session = JSON.parse(localStorage.getItem('iptv_session'));
    }

    buildUrl(action, extraParams = '') {
        const targetUrl = `${this.session.url}/player_api.php?username=${this.session.username}&password=${this.session.password}&action=${action}${extraParams}`;
        return `proxy.php?url=${encodeURIComponent(targetUrl)}`;
    }

    // رابط مباشر بدون بروكسي للستريم (أسرع وأكثر استقراراً)
    getStreamUrl(type, streamId, extension = 'm3u8') {
        if (type === 'live') {
            return `${this.session.url}/live/${this.session.username}/${this.session.password}/${streamId}.${extension}`;
        } else if (type === 'series') {
            return `${this.session.url}/series/${this.session.username}/${this.session.password}/${streamId}.${extension}`;
        } else {
            return `${this.session.url}/movie/${this.session.username}/${this.session.password}/${streamId}.${extension}`;
        }
    }

    // رابط بروكسي للستريم (للحالات التي تحتاج CORS bypass)
    getProxiedStreamUrl(type, streamId, extension = 'm3u8') {
        const directUrl = this.getStreamUrl(type, streamId, extension);
        return `proxy.php?url=${encodeURIComponent(directUrl)}`;
    }

    async fetchAPI(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error:", error);
            throw error;
        }
    }

    async authenticate(url, user, pass) {
        const targetUrl = `${url}/player_api.php?username=${user}&password=${pass}`;
        return await this.fetchAPI(`proxy.php?url=${encodeURIComponent(targetUrl)}`);
    }

    async getCategories(type) {
        let action = type === 'live' ? 'get_live_categories' : (type === 'movies' ? 'get_vod_categories' : 'get_series_categories');
        return await this.fetchAPI(this.buildUrl(action));
    }

    async getStreams(type, categoryId) {
        let action = type === 'live' ? 'get_live_streams' : (type === 'movies' ? 'get_vod_streams' : 'get_series');
        return await this.fetchAPI(this.buildUrl(action, `&category_id=${categoryId}`));
    }

    async getAllStreams(type) {
        let action = type === 'live' ? 'get_live_streams' : (type === 'movies' ? 'get_vod_streams' : 'get_series');
        return await this.fetchAPI(this.buildUrl(action));
    }

    async getSeriesInfo(seriesId) {
        return await this.fetchAPI(this.buildUrl('get_series_info', `&series_id=${seriesId}`));
    }
}