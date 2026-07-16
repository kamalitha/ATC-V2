<?php
declare(strict_types=1);
define('API_ROOT', __DIR__);
require_once API_ROOT . '/config.php';
require_once API_ROOT . '/core/Logger.php';
require_once API_ROOT . '/core/Database.php';
require_once API_ROOT . '/core/Response.php';
require_once API_ROOT . '/core/Auth.php';
require_once API_ROOT . '/core/Validator.php';
require_once API_ROOT . '/core/Router.php';

// ── Global error/exception handlers ──────────────────────────────────────────
set_exception_handler(function (\Throwable $e) {
    Logger::exception($e, 'Uncaught exception');
    Response::serverError('An unexpected error occurred');
});

set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline): bool {
    if (!($errno & error_reporting())) return false;
    Logger::error("{$errstr}", ['errno' => $errno, 'file' => "{$errfile}:{$errline}"]);
    return false; // let PHP also handle it
});
require_once API_ROOT . '/middleware/RateLimit.php';
require_once API_ROOT . '/controllers/AuthController.php';
require_once API_ROOT . '/controllers/UserController.php';
require_once API_ROOT . '/controllers/IDLController.php';
require_once API_ROOT . '/controllers/CPDController.php';
require_once API_ROOT . '/controllers/ReportController.php';
require_once API_ROOT . '/controllers/SupportController.php';

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: ' . Config::frontendUrl());
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>Config::IS_LIVE,'httponly'=>true,'samesite'=>'Strict']);
session_start();

// ── Warm InnoDB buffer pool on cold start ────────────────────────────────
// Runs once after server restart (flag file cleared on boot)
$warmFlag = sys_get_temp_dir() . '/atc_cache_warmed.flag';
if (!file_exists($warmFlag)) {
    try {
        $warmDb = new Database();
        // Pull the most-queried pages into buffer pool
        $warmDb->scalar("SELECT COUNT(*) FROM mn_idl_requests WHERE is_active=1 AND request_status IN (1,2)");
        $warmDb->scalar("SELECT COUNT(*) FROM mn_idl_request_user LIMIT 1");
        file_put_contents($warmFlag, time());
        unset($warmDb);
    } catch (\Throwable $e) { /* silent — warming is best-effort */ }
}
date_default_timezone_set(Config::TIMEZONE);

set_exception_handler(function (\Throwable $e) {
    error_log('[ATC API] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) header('Content-Type: application/json; charset=UTF-8');
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=> Config::IS_LIVE ? 'Server error' : $e->getMessage()]);
    exit;
});

$r = new Router();
// Auth
$r->post('/api/auth/login',          [AuthController::class,'login']);
$r->post('/api/auth/logout',         [AuthController::class,'logout']);
$r->get('/api/auth/me',              [AuthController::class,'me']);
$r->put('/api/auth/profile',         [AuthController::class,'updateProfile'],   auth:true);
$r->put('/api/auth/change-password', [AuthController::class,'changeOwnPassword'],auth:true);
// Users
$r->get('/api/users',                [UserController::class,'index'],        auth:true);
$r->post('/api/users',               [UserController::class,'store'],        auth:true);
$r->get('/api/users/{id}',           [UserController::class,'show'],         auth:true);
$r->put('/api/users/{id}',           [UserController::class,'update'],       auth:true);
$r->put('/api/users/{id}/status',    [UserController::class,'toggleStatus'], auth:true);
$r->put('/api/users/{id}/password',  [UserController::class,'changePassword'],auth:true);
$r->get('/api/roles',                [UserController::class,'roles'],        auth:true);
// IDL
$r->get('/api/idl/sales-report',                    [IDLController::class,'salesReport'],    auth:true);
$r->get('/api/idl/aramex-report',                   [IDLController::class,'aramexReport'],   auth:true);
$r->get('/api/idl/empost-report',                   [IDLController::class,'empostReport'],   auth:true);
$r->get('/api/idl/moe-report',                      [IDLController::class,'moeReport'],      auth:true);
$r->get('/api/idl/search-by-eid',           [IDLController::class,'searchByEid'],   auth:true);
$r->get('/api/cpd/search-by-eid',           [CPDController::class,'searchByEid'],   auth:true);
$r->get('/api/cpd/search-by-ref',           [CPDController::class,'searchByRef'],   auth:true);
$r->get('/api/cpd/claims/search',           [CPDController::class,'searchClaims'],  auth:true);
$r->post('/api/cpd/claims',                 [CPDController::class,'addClaim'],       auth:true);
$r->get('/api/cpd/requests/{id}/claims',                    [CPDController::class,'getClaims'],           auth:true);
$r->get('/api/cpd/claims/{id}/documents/{filename}',                        [CPDController::class,'serveClaimDocument'],     auth:true);
$r->get('/api/cpd/claims/{id}/notes',                                       [CPDController::class,'getClaimNotes'],          auth:true);
$r->post('/api/cpd/claims/{id}/notes',                                      [CPDController::class,'addClaimNote'],           auth:true);
$r->get('/api/cpd/claims/{claim_id}/notes/{note_id}/documents/{filename}',  [CPDController::class,'serveClaimNoteDocument'], auth:true);
$r->get('/api/cpd/holds/list',        [CPDController::class,'listHolds'],          auth:true);
$r->get('/api/cpd/holds',             [CPDController::class,'searchCustomerHold'], auth:true);
$r->post('/api/cpd/holds',            [CPDController::class,'placeHold'],          auth:true);
$r->put('/api/cpd/holds/{id}/lift',   [CPDController::class,'liftHold'],           auth:true);
$r->get('/api/idl/my-requests',             [IDLController::class,'myRequests'],    auth:true);
$r->get('/api/cpd/my-requests',             [CPDController::class,'myRequests'],    auth:true);
$r->get('/api/idl/config',                  [IDLController::class,'idlConfig'],     auth:true);
$r->get('/api/idl/stats',                   [IDLController::class,'stats'],         auth:true);
$r->get('/api/idl/chart-data',              [IDLController::class,'chartData'],     auth:true);
$r->get('/api/idl/requests',                [IDLController::class,'index'],         auth:true);
$r->post('/api/idl/requests',               [IDLController::class,'store'],         auth:true);
$r->get('/api/idl/requests/{id}',           [IDLController::class,'show'],          auth:true);
$r->put('/api/idl/requests/{id}',           [IDLController::class,'update'],        auth:true);
$r->get('/api/idl/requests/{id}/documents',               [IDLController::class,'getDocuments'],   auth:true);
$r->get('/api/idl/requests/{id}/documents/{filename}',    [IDLController::class,'serveDocument'],  auth:true);
$r->post('/api/idl/requests/{id}/documents',              [IDLController::class,'uploadDocuments'],auth:true);
$r->post('/api/idl/requests/{id}/receipt',  [IDLController::class,'createReceipt'],  auth:true);
$r->get('/api/idl/requests/{id}/receipt',   [IDLController::class,'getReceipt'],     auth:true);
$r->post('/api/idl/requests/{id}/telr-init',[IDLController::class,'telrInit'],       auth:true);
$r->post('/api/idl/telr-verify',            [IDLController::class,'telrVerify'],     auth:true);
$r->post('/api/idl/requests/{id}/approve',  [IDLController::class,'approve'],        auth:true);
$r->post('/api/idl/requests/{id}/reject',   [IDLController::class,'reject'],        auth:true);
$r->post('/api/idl/requests/{id}/issue',    [IDLController::class,'issue'],         auth:true);
$r->post('/api/idl/requests/{id}/dispatch', [IDLController::class,'markDispatched'],auth:true);
$r->post('/api/idl/requests/{id}/cancel',   [IDLController::class,'cancel'],        auth:true);
$r->post('/api/idl/requests/{id}/cancel-own',[IDLController::class,'cancelOwn'],    auth:true);
$r->post('/api/idl/requests/{id}/void',     [IDLController::class,'voidRequest'],   auth:true);
$r->get('/api/idl/requests/{id}/print',     [IDLController::class,'printIdl'],      auth:true);
$r->get('/api/idl/nationalities',           [IDLController::class,'nationalities'], auth:true);
$r->get('/api/idl/dl-types',                [IDLController::class,'dlTypes'],       auth:true);
$r->get('/api/idl/emirates',                [IDLController::class,'emiratesLookup'],auth:true);
$r->get('/api/idl/statuses',                [IDLController::class,'statusLookup'],  auth:true);
$r->get('/api/idl/booklets',                [IDLController::class,'booklets'],      auth:true);
// CPD
$r->get('/api/cpd/stats',                       [CPDController::class,'stats'],       auth:true);
$r->get('/api/cpd/requests',                    [CPDController::class,'index'],       auth:true);
$r->post('/api/cpd/requests',                   [CPDController::class,'store'],       auth:true);
$r->post('/api/cpd/renew-requests',             [CPDController::class,'renew'],       auth:true);
$r->post('/api/cpd/public-store',               [CPDController::class,'publicStore'],   auth:true);
$r->post('/api/cpd/requests/{id}/telr-init',    [CPDController::class,'telrInit'],      auth:true);
$r->post('/api/cpd/requests/{id}/documents',    [CPDController::class,'uploadDocuments'], auth:true);
$r->get('/api/cpd/requests/{id}/documents',     [CPDController::class,'getDocuments'],    auth:true);
$r->get('/api/cpd/requests/{id}/comments',      [CPDController::class,'getComments'],     auth:true);
$r->put('/api/cpd/requests/{id}/public-update', [CPDController::class,'publicUpdate'],    auth:true);
$r->post('/api/cpd/requests/{id}/print-awb',    [CPDController::class,'printAwb'],    auth:true);
$r->post('/api/cpd/requests/{id}/return-cheque',[CPDController::class,'returnCheque'],    auth:true);
$r->get('/api/cpd/requests/{id}/return-cheque', [CPDController::class,'getReturnCheque'], auth:true);
$r->put('/api/cpd/requests/{id}/return-cheque', [CPDController::class,'updateReturnCheque'], auth:true);
$r->get('/api/cpd/requests/{id}',               [CPDController::class,'show'],        auth:true);
$r->put('/api/cpd/requests/{id}',               [CPDController::class,'update'],      auth:true);
$r->post('/api/cpd/requests/{id}/approve',      [CPDController::class,'approve'],     auth:true);
$r->post('/api/cpd/requests/{id}/reject',       [CPDController::class,'reject'],      auth:true);
$r->post('/api/cpd/requests/{id}/pay',          [CPDController::class,'pay'],         auth:true);
$r->post('/api/cpd/requests/{id}/issue-carnet', [CPDController::class,'issueCarnet'], auth:true);
$r->post('/api/cpd/requests/{id}/cancel',       [CPDController::class,'cancel'],      auth:true);
$r->post('/api/cpd/requests/{id}/cancel-request',[CPDController::class,'cancelRequest'],    auth:true);
$r->get('/api/cpd/requests/{id}/cancel-request', [CPDController::class,'getCancelRequest'], auth:true);
$r->get('/api/cpd/cancellations',               [CPDController::class,'indexCancellations'], auth:true);
$r->get('/api/cpd/return-requests',             [CPDController::class,'indexReturnRequests'],  auth:true);
$r->post('/api/cpd/return-requests/{id}/approve',[CPDController::class,'approveReturnRequest'], auth:true);
$r->post('/api/cpd/requests/{id}/return-carnet',        [CPDController::class,'returnCarnet'],       auth:true);
$r->post('/api/cpd/requests/{id}/officer-return',       [CPDController::class,'officerReturn'],      auth:true);
$r->get('/api/cpd/requests/{id}/return-carnet',  [CPDController::class,'getReturnCarnet'],           auth:true);
$r->post('/api/cpd/return/{id}/telr-init',       [CPDController::class,'telrInitReturn'],            auth:true);
$r->get('/api/cpd/return/telr-module',           [CPDController::class,'telrModuleCheck'],         auth:false);
$r->post('/api/cpd/requests/{id}/return',       [CPDController::class,'markCarnetReturned'], auth:true);
$r->get('/api/cpd/carnets',                     [CPDController::class,'carnets'],     auth:true);
$r->get('/api/cpd/countries',                   [CPDController::class,'countries'],      auth:true);
$r->get('/api/cpd/guarantee-rules',             [CPDController::class,'guaranteeRules'], auth:true);
$r->get('/api/cpd/vehicle-types',               [CPDController::class,'vehicleTypes'],auth:true);
$r->get('/api/cpd/locations',                   [CPDController::class,'locations'],   auth:true);
$r->get('/api/cpd/carnet-types',                [CPDController::class,'carnetTypes'],      auth:true);
$r->post('/api/cpd/stock-requests',             [CPDController::class,'storeStockRequest'], auth:true);
$r->get('/api/cpd/stock-requests',              [CPDController::class,'indexStockRequests'], auth:true);
$r->get('/api/cpd/stock-requests/{id}',         [CPDController::class,'showStockRequest'],   auth:true);
$r->post('/api/cpd/stock-requests/{id}/approve',[CPDController::class,'approveStockRequest'],auth:true);
$r->post('/api/cpd/stock-requests/{id}/reject', [CPDController::class,'rejectStockRequest'], auth:true);
$r->get('/api/cpd/statuses',                    [CPDController::class,'statuses'],    auth:true);
// Reports
$r->get('/api/reports/idl',      [ReportController::class,'idlReport'],   auth:true);
$r->get('/api/reports/cpd',      [ReportController::class,'cpdReport'],   auth:true);
$r->get('/api/reports/activity', [ReportController::class,'activityLog'], auth:true);

// Support Tickets
$r->get('/api/support/my-tickets',            [SupportController::class,'myTickets'],     auth:true);
$r->get('/api/support/tickets',               [SupportController::class,'index'],        auth:true);
$r->post('/api/support/tickets',              [SupportController::class,'store'],        auth:true);
$r->get('/api/support/tickets/{id}',          [SupportController::class,'show'],         auth:true);
$r->post('/api/support/tickets/{id}/status',  [SupportController::class,'updateStatus'], auth:true);
$r->get('/api/support/tickets/{id}/comments/{cid}/attachment', [SupportController::class,'serveAttachment'], auth:true);
$r->post('/api/support/tickets/{id}/comment', [SupportController::class,'addComment'],   auth:true);

$r->dispatch();
