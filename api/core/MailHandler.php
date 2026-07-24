<?php
declare(strict_types=1);

require_once API_ROOT . '/library/mailjet/vendor/autoload.php';

class MailHandler
{
    private string $apiKey;
    private string $secret;

    public function __construct()
    {
        $this->apiKey = Config::MJ_API_KEY;
        $this->secret = Config::MJ_SECRET;
    }

    /** @param array<string,mixed>|null $varArray */
    public function sendBasicMailViaMailJet(int $templateRef, string $toMail, ?array $varArray = null): bool
    {
        $mj = new \Mailjet\Client($this->apiKey, $this->secret);
        $body = [
            'FromEmail'           => 'info@atcuae.ae',
            'FromName'            => 'ATCUAE',
            'MJ-TemplateID'       => $templateRef,
            'MJ-TemplateLanguage' => true,
            'Recipients'          => [['Email' => $toMail]],
            'Vars'                => $varArray,
        ];

        $response = $mj->post(\Mailjet\Resources::$Email, ['body' => $body]);

        return $response->success();
    }
}
