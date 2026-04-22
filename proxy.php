<?php
// proxy.php - Ultimate CORS Breaker + Stream Optimizer
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, HEAD, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Range, Accept, Origin");
header("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges");

// معالجة طلبات OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

if (!isset($_GET['url'])) {
    http_response_code(400);
    die("Error: No URL provided");
}

$url = urldecode($_GET['url']);

// التحقق من صحة الرابط
if (!filter_var($url, FILTER_VALIDATE_URL)) {
    http_response_code(400);
    die("Error: Invalid URL");
}

$ch = curl_init($url);

// إعدادات الأداء المحسّنة
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER  => true,
    CURLOPT_FOLLOWLOCATION  => true,
    CURLOPT_MAXREDIRS       => 5,
    CURLOPT_SSL_VERIFYPEER  => false,
    CURLOPT_SSL_VERIFYHOST  => 0,
    CURLOPT_CONNECTTIMEOUT  => 10,
    CURLOPT_TIMEOUT         => 30,
    CURLOPT_BUFFERSIZE      => 131072, // 128KB buffer لأداء أفضل
    // تمثّل مشغل فيديو حقيقي
    CURLOPT_USERAGENT       => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER      => [
        'Accept: */*',
        'Accept-Language: ar,en;q=0.9',
        'Connection: keep-alive',
        'Sec-Fetch-Dest: video',
        'Sec-Fetch-Mode: no-cors',
    ],
]);

// دعم Range requests (ضروري لـ VOD / seek)
if (isset($_SERVER['HTTP_RANGE'])) {
    curl_setopt($ch, CURLOPT_RANGE, str_replace('bytes=', '', $_SERVER['HTTP_RANGE']));
}

// تمرير الترويسات المهمة
$responseHeaders = [];
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($curl, $header) use (&$responseHeaders) {
    $len = strlen($header);
    $parts = explode(':', $header, 2);
    if (count($parts) < 2) return $len;
    
    $name  = strtolower(trim($parts[0]));
    $value = trim($parts[1]);

    $allowedHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
    ];

    if (in_array($name, $allowedHeaders)) {
        header(trim($parts[0]) . ': ' . $value);
        $responseHeaders[$name] = $value;
    }

    return $len;
});

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Proxy error: ' . $curlError]);
    exit();
}

http_response_code($httpCode ?: 200);

// إصلاح روابط HLS النسبية في ملفات m3u8
$contentType = $responseHeaders['content-type'] ?? '';
if (strpos($contentType, 'mpegurl') !== false || strpos($contentType, 'm3u') !== false) {
    $baseUrl = dirname($url) . '/';
    // استبدال الروابط النسبية بروابط مطلقة عبر البروكسي
    $response = preg_replace_callback(
        '/^((?!#|https?:\/\/).+\.(?:m3u8|ts|aac|mp4|fmp4))$/m',
        function($matches) use ($baseUrl) {
            $absoluteUrl = $baseUrl . $matches[1];
            return 'proxy.php?url=' . urlencode($absoluteUrl);
        },
        $response
    );
}

echo $response;
?>