<?php
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') 
{
    $json = file_get_contents('php://input');
    $data = json_decode($json, true);

    if (empty($data)) 
	{
        $data = $_POST;
    }

    if (!empty($data)) 
	{
        $timestamp = date("Y-m-d H:i:s");
        $logEntry = "[" . $timestamp . "] " . json_encode($data) . PHP_EOL;
        $file = 'chat_bot_log.txt';
        
        if (file_put_contents($file, $logEntry, FILE_APPEND | LOCK_EX)) 
		{
            http_response_code(201);
            echo json_encode(["status" => "success", "message" => "Data recorded."]);
        } 
		else 
		{
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Could not write to file."]);
        }
    } 
	else 
	{
        http_response_code(400);
        echo json_encode(["status" => "error", "message" => "No data provided."]);
    }
} 
else 
{
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method not allowed. Use POST."]);
}