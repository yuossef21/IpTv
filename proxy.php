<?php
// proxy.php - The Ultimate CORS Breaker
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if (!isset($_GET['url'])) {
    http_response_code(400);
    die("Error: No URL provided");
}

$url = $_GET['url'];

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
// نتنكر على هيئة مشغل حقيقي لكي لا يحظرنا السيرفر
curl_setopt($ch, CURLOPT_USERAGENT, 'VLC/3.0.16 LibVLC/3.0.16'); 

// تمرير جميع الترويسات الأصلية (مثل نوع الفيديو أو الصورة)
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($curl, $header) {
    $len = strlen($header);
    $headerParts = explode(':', $header, 2);
    if (count($headerParts) < 2) return $len;
    $name = strtolower(trim($headerParts[0]));
    if (in_array($name, ['content-type', 'content-length'])) {
        header(trim($headerParts[0]) . ': ' . trim($headerParts[1]));
    }
    return $len;
});

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);
echo $response;
?>