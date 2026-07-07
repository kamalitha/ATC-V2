<?php
// ── Quick RTA Service Test ──────────────────────────────────────────────────────
// Place this file anywhere on your server and run it in the browser.
// Change the URL below to match your actual server path.

$wsdl = 'http://localhost/atc_v2/services/rta/server.php?wsdl';

try {
    $client = new SoapClient($wsdl, [
        'trace'      => true,
        'exceptions' => true,
        'cache_wsdl' => WSDL_CACHE_NONE,
    ]);

    echo '<h2>✅ SOAP client connected</h2>';
    echo '<h3>Available methods:</h3><pre>';
    print_r($client->__getFunctions());
    echo '</pre>';

    echo '<h3>GetIDLPaymentBreakup result:</h3><pre>';
    $result = $client->GetIDLPaymentBreakup();
    print_r($result);
    echo '</pre>';

    echo '<h3>GetAllEmirates result:</h3><pre>';
    $result = $client->GetAllEmirates();
    print_r($result);
    echo '</pre>';

    echo '<h3>GetAllNationalities result:</h3><pre>';
    $result = $client->GetAllNationalities();
    print_r($result);
    echo '</pre>';

    // Replace with a real Emirates ID from your database
    echo '<h3>CheckIDLRequestStatus (Emirates ID test):</h3><pre>';
    $result = $client->CheckIDLRequestStatus('7841990123456701');
    print_r($result);
    echo '</pre>';

} catch (SoapFault $e) {
    echo '<h2 style="color:red">❌ SoapFault: ' . $e->getMessage() . '</h2>';
    echo '<pre>Code: ' . $e->faultcode . '</pre>';
} catch (Throwable $e) {
    echo '<h2 style="color:red">❌ Error: ' . $e->getMessage() . '</h2>';
}
