class XtreamAPI {
    constructor() {
        this.session = JSON.parse(localStorage.getItem('iptv_session'));
    }

    // بناء الرابط الأصلي ثم تمريره للبروكسي
    buildUrl(action, extraParams = '') {
        const targetUrl = `${this.session.url}/player_api.php?username=${this.session.username}&password=${this.session.password}&action=${action}${extraParams}`;
        return `proxy.php?url=${encodeURIComponent(targetUrl)}`;
    }

    getStreamUrl(type, streamId, extension = 'm3u8') {
        const streamType = type === 'live' ? 'live' : 'movie';
        const basePath = type === 'live' ? 'live' : (type === 'series' ? 'series' : 'movie');

        // إرجاع الرابط المباشر. المتصفح وإضافة CORS سيتكفلان بالباقي
        return `${this.session.url}/${basePath}/${this.session.username}/${this.session.password}/${streamId}.${extension}`;
    }

    async fetchAPI(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('فشل الاستجابة من الخادم');
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