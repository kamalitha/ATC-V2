<?php
declare(strict_types=1);

// ── MOI Service — Business Logic ──────────────────────────────────────────────
// PHP 8.1 rewrite of the original class.moi_service.php.
// No dependencies on v3 portal classes. All DB access goes via MoiRepository.

final class MoiService
{
    // Arabic translations for static lookup arrays
    private const EMIRATE_AR = [
        '1' => 'دبي', '2' => 'أبوظبي', '3' => 'الشارقة',
        '4' => 'رأس الخيمة', '5' => 'عجمان', '6' => 'الفجيرة', '7' => 'أم القيوين',
    ];

    private const STATUS_IDL_AR = [
        '1' => 'لا تدفع',    '2' => 'تحت التجهيز', '3' => 'مرفوض',
        '4' => 'وافق',        '5' => 'أرسل',         '6' => 'فقدت المسروقة', '7' => 'ألغيت',
    ];

    private const STATUS_CPD_AR = [
        '1' => 'معالجة', '2' => 'تم تأكيد', '3' => 'نشر', '4' => 'عاد', '5' => 'التالفة',
    ];

    private const LICENSE_TYPE_AR = [
        '1' => 'دراجة نارية',
        '2' => 'سيارة خفيفة',
        '3' => 'سيارات البضائع أكثر من 3500 كجم (شاحنة صغيرة) مع مقطورة',
        '4' => 'حافلة (أكثر من 8 ركاب) بمقطورة خفيفة',
        '5' => 'سيارة خفيفة / سيارة بضائع / حافلة بمقطورة ثقيلة',
        '6' => 'خفيفة',
    ];

    // ── IDL Methods ───────────────────────────────────────────────────────────

    public function createMOIRequest(array $p): array
    {
        try {
            $emiratesId = preg_replace('/\D/', '', $p['EmiratesID'] ?? '');
            $p['EmiratesID'] = $emiratesId;

            // Block if unpaid request exists
            $unpaid = MoiRepository::getUnpaidIDLByEmiratesId($emiratesId);
            if ($unpaid) {
                return ServiceStatus::error(
                    '406',
                    'System cannot accept another request as an unpaid/unprocessed request exists. (RequestID: ' . $unpaid['request_id'] . ')',
                    'لا يمكن للنظام أن يقبل طلب آخر لهذا المستخدم كما أن هناك طلب غير مدفوع/غير معالج. (معرف الطلب' . $unpaid['request_id'] . ')',
                )->toArray();
            }

            $autoId = MoiRepository::createIDLRequest($p);

            return ServiceStatus::success((string) $autoId, 'IDL-ATC-' . date('Ymd') . '/' . $autoId)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function checkMOIRequestStatus(string $emiratesId, string $transSeq): array
    {
        try {
            $emiratesId = preg_replace('/\D/', '', $emiratesId);

            $row = $transSeq === '' || $transSeq === null
                ? MoiRepository::getAllIDLByEmiratesId($emiratesId)[0] ?? null
                : MoiRepository::getIDLByEmiratesIdAndAutoId($emiratesId, $transSeq);

            if (!$row) {
                $o               = new MOIRequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = $transSeq === ''
                    ? "No Records available for Emirates ID {$emiratesId}"
                    : "No Records available for Emirates ID {$emiratesId} AND Transaction Sequence {$transSeq}";
                $o->ErrorMessage_AR = 'لا توجد سجلات متاحة';
                return $o->toArray();
            }

            return $this->buildIDLView($row)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function getAllMOIRequests(string $emiratesId): array
    {
        try {
            $emiratesId = preg_replace('/\D/', '', $emiratesId);
            $rows = MoiRepository::getAllIDLByEmiratesId($emiratesId);

            if (empty($rows)) {
                $o               = new MOIRequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = "No Records available for Emirates ID {$emiratesId}";
                $o->ErrorMessage_AR = 'لا توجد سجلات متاحة';
                return [(array) $o];
            }

            return array_map(fn($row) => $this->buildIDLView($row)->toArray(), $rows);
        } catch (\PDOException $e) {
            return [ServiceStatus::dbError($e)->toArray()];
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function deleteMOIRequest(string $transSeq, string $emiratesId): array
    {
        try {
            $row = MoiRepository::getIDLByAutoIdForDelete($transSeq);
            if (!$row) {
                return ServiceStatus::error('404', 'Request not found')->toArray();
            }
            if ($row['request_status'] !== '1') {
                return ServiceStatus::error(
                    '403',
                    'This request is already confirmed. Therefore it cannot be deleted.',
                    'تم تأكيد هذا الطلب بالفعل. لذلك لا يمكن حذفه.',
                )->toArray();
            }
            MoiRepository::deleteIDLRequest($transSeq);
            $o                     = ServiceStatus::success($transSeq, $row['request_id']);
            $o->TransactionStatus  = '1';
            return $o->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function updatePaymentStatus(string $transSeq, string $appId, string $payRef): array
    {
        try {
            date_default_timezone_set(MOI_TIMEZONE);
            MoiRepository::updateIDLField($transSeq, 'paid_status',    '1');
            MoiRepository::updateIDLField($transSeq, 'paid_date',      date('Y-m-d H:i:s'));
            MoiRepository::updateIDLField($transSeq, 'request_status', '2');
            MoiRepository::updateIDLField($transSeq, 'order_ref_no',   $payRef);
            return ServiceStatus::success($transSeq, $appId)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function generateIDLPrint(string $autoId): array
    {
        $obj = new IDL();
        try {
            $row = MoiRepository::getIDLByAutoId($autoId);

            if (!$row) {
                $obj->ErrorCode    = '404';
                $obj->ErrorMessage = 'Request not found';
                return $obj->toArray();
            }

            if ($row['request_type'] !== 'MOI') {
                $obj->ErrorCode    = '003';
                $obj->TransactionSequence = $autoId;
                $obj->ErrorMessage = 'This is not a MOI request';
                $obj->ErrorMessage_AR = 'هذا ليس طلب وزارة الداخلية';
                return $obj->toArray();
            }

            $userId    = $row['belonging_user_id'];
            $userPath  = MOI_USER_FILES_PATH . "/{$userId}";
            $photoFile = null;

            foreach (["{$userPath}/passport.jpg", "{$userPath}/passport.png"] as $candidate) {
                if (file_exists($candidate)) { $photoFile = $candidate; break; }
            }

            if (!$photoFile) {
                $obj->ErrorCode    = '001';
                $obj->TransactionSequence = $autoId;
                $obj->ErrorMessage = 'Passport image (JPG or PNG) is not available';
                return $obj->toArray();
            }

            $printHash = $row['print_hash'] ?? '';
            if ($printHash === '') {
                $printHash = md5(time() . $autoId);
                MoiRepository::updateIDLPrintHash($autoId, $printHash);
            }

            // ── Build image ──────────────────────────────────────────────────
            $whiteTemplate = MOI_IMAGES_PATH . '/template_white.jpg';
            $im            = imagecreatefromjpeg($whiteTemplate);

            // Passport photo — resize to 111x155
            $im2 = $this->loadAndResizeImage($photoFile, 111, 155);
            if ($im2) {
                imagecopy($im, $im2, 315, 376, 0, 0, imagesx($im2), imagesy($im2));
                imagedestroy($im2);
            }

            // DL type tick
            $imgTick = imagecreatefrompng(MOI_IMAGES_PATH . '/tick_small.png');
            $tickPos = ['1' => [480, 343], '2' => [480, 383], '3' => [480, 363], '4' => [480, 323], '5' => [480, 403]];
            $dlType  = (string) $row['type_of_dl'];
            if (isset($tickPos[$dlType])) {
                imagecopy($im, $imgTick, $tickPos[$dlType][0], $tickPos[$dlType][1], 0, 0, imagesx($imgTick), imagesy($imgTick));
            }

            // QR code
            $qrPath = MOI_IDL_FILES_PATH . "/{$autoId}/qrcode.png";
            $qrUrl  = MOI_HOST . '/public/display/' . $printHash;
            if (class_exists('QRcode')) {
                if (file_exists($qrPath)) unlink($qrPath);
                \QRcode::png($qrUrl, $qrPath, '', '2', '2');
                $imgQr = imagecreatefrompng($qrPath);
                imagecopy($im, $imgQr, 330, 178, 0, 0, imagesx($imgQr), imagesy($imgQr));
                imagedestroy($imgQr);
            }

            // Save composite
            $templateOut = "{$userPath}/template.jpg";
            imagejpeg($im, $templateOut, 90);
            imagedestroy($im);

            // Write text
            $jpg      = imagecreatefromjpeg($templateOut);
            $black    = imagecolorallocate($jpg, 0, 0, 0);
            $watermark = imagecolorallocate($jpg, 228, 241, 243);
            $font     = MOI_FONTS_PATH . '/arial.ttf';

            imagettftext($jpg, 7, 0, 350, 138, $black,     $font, 'MOI');
            if (!empty($row['issued_date'])) {
                $from = date('d/m/Y', strtotime($row['issued_date']));
                $to   = date('d/m/Y', strtotime('+365 days', strtotime($row['issued_date'])));
                imagettftext($jpg, 7, 0, 305, 166, $black, $font, "FROM {$from} To {$to}");
            }
            imagettftext($jpg, 7, 0, 180, 333, $black, $font, strtoupper($row['last_name']));
            imagettftext($jpg, 7, 0, 180, 360, $black, $font, strtoupper($row['first_name']));
            imagettftext($jpg, 7, 0, 180, 380, $black, $font, strtoupper($row['place_of_birth'] ?? ''));
            imagettftext($jpg, 7, 0, 180, 410, $black, $font, $row['dob'] ?? '');
            imagettftext($jpg, 7, 0, 180, 433, $black, $font, strtoupper($row['city'] ?? ''));
            imagettftext($jpg, 7, 0, 180, 460, $black, $font, strtoupper($row['sex'] ?? 'N/A'));
            imagettftext($jpg, 7, 0, 223, 460, $black, $font, strtoupper($row['nationality'] ?? ''));
            imagettftext($jpg, 7, 0, 180, 485, $black, $font, strtoupper($row['idl_no'] ?? ''));
            imagettftext($jpg, 7, 0, 180, 520, $black, $font, strtoupper($row['license_no'] ?? ''));
            imagettftext($jpg, 45, 45, 170, 540, $watermark, $font, 'DUPLICATE COPY');

            $outputPath = "{$userPath}/idl_print.jpg";
            imagejpeg($jpg, $outputPath, 100);
            imagedestroy($jpg);

            $obj->ErrorCode          = '0';
            $obj->TransactionSequence = $autoId;
            $obj->PrintString        = 'data:image/jpg;base64,' . base64_encode(file_get_contents($outputPath));
            return $obj->toArray();
        } catch (\PDOException $e) {
            $obj->ErrorCode    = '001';
            $obj->ErrorMessage = 'Database error: ' . $e->getMessage();
            return $obj->toArray();
        } catch (\Throwable $e) {
            $obj->ErrorCode    = '002';
            $obj->ErrorMessage = 'Error: ' . $e->getMessage();
            return $obj->toArray();
        }
    }

    // ── CPD Methods ───────────────────────────────────────────────────────────

    public function createCPDRequest(array $p): array
    {
        try {
            $existing = MoiRepository::getActiveCPDByRegistrationNo($p['RegistrationNo']);
            if ($existing) {
                return ServiceStatus::error(
                    '403',
                    'There is a request already processing for this vehicle Registration No ' . $p['RegistrationNo'] . ' (Request ID: ' . $existing['request_id'] . ')',
                    'هناك طلب والذي هو قيد الإجراء / في استخدام هذه السيارة. معرف الطلب' . $existing['request_id'],
                )->toArray();
            }

            $autoId = MoiRepository::createCPDRequest($p);
            return ServiceStatus::success((string) $autoId, 'CPD-ATC-' . date('Ymd') . '/' . $autoId)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function updateCPDRequestPaymentStatus(string $appId, string $bookingFee, string $payRef, string $guaranteeAmount): array
    {
        try {
            $row = MoiRepository::getCPDByApplicationId($appId);
            if (!$row) {
                return ServiceStatus::error('001', 'Request not found')->toArray();
            }
            if ((int) $row['booking_fee_status'] === 1) {
                return ServiceStatus::error('001', 'Booking fee for this request is already paid', 'تم بالفعل دفع رسوم الحجز لهذا الطلب')->toArray();
            }
            if ($row['request_type'] !== 'MOI') {
                return ServiceStatus::error('001', 'This is not a MOI request', 'هذا ليس طلب وزارة الداخلية')->toArray();
            }
            MoiRepository::updateCPDPaymentStatus($row['auto_id'], $bookingFee, $payRef, $guaranteeAmount);
            return ServiceStatus::success((string) $row['auto_id'], $appId)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function getAllCPDRequests(string $emiratesId): array
    {
        try {
            $rows = MoiRepository::getAllCPDByEmiratesId($emiratesId);
            if (empty($rows)) {
                $o               = new CPDRequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = "No Records available for Emirates ID {$emiratesId}";
                $o->ErrorMessage_AR = 'لا توجد سجلات متاحة';
                $o->TransactionStatus = '0';
                return [$o->toArray()];
            }
            return array_map(fn($row) => $this->buildCPDView($row)->toArray(), $rows);
        } catch (\PDOException $e) {
            return [ServiceStatus::dbError($e)->toArray()];
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getSingleCPDRequestDetails(string $requestId): array
    {
        try {
            $row = MoiRepository::getSingleCPDByRequestId($requestId);
            if (!$row) {
                $o               = new CPDRequestStatusBindingView();
                $o->ErrorCode    = '404';
                $o->ErrorMessage = "No Records available for Request ID {$requestId}";
                $o->ErrorMessage_AR = 'لا توجد سجلات متاحة';
                $o->TransactionStatus = '0';
                return $o->toArray();
            }
            return $this->buildCPDView($row)->toArray();
        } catch (\PDOException $e) {
            return ServiceStatus::dbError($e)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function cancelCPDRequest(string $transSeq, string $emiratesId): array
    {
        try {
            $row = MoiRepository::getCPDByAutoIdAndEmiratesId($transSeq, $emiratesId);
            if (!$row) {
                return ServiceStatus::error('404', "No Records available for Emirates ID {$emiratesId} AND Transaction Sequence {$transSeq}")->toArray();
            }
            if ($row['request_type'] !== 'MOI') {
                return ServiceStatus::error('404', 'No Records available')->toArray();
            }
            if (in_array((string) $row['request_status'], ['1','2','3','4'], true)) {
                return ServiceStatus::error('403', 'This request is already confirmed. Therefore it cannot be cancelled.', 'تم تأكيد هذا الطلب بالفعل. لذلك لا يمكن حذفه.')->toArray();
            }
            if ((string) $row['request_status'] === '6') {
                return ServiceStatus::error('406', 'This request is already cancelled', 'تم إلغاء هذا الطلب بالفعل')->toArray();
            }
            MoiRepository::cancelCPDRequest($transSeq);
            return ServiceStatus::success($transSeq)->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function updateCPDGuaranteeDepositSlip(string $appId, string $base64Image): array
    {
        try {
            $row = MoiRepository::getCPDByApplicationId($appId);
            if (!$row || $row['request_type'] !== 'MOI') {
                return ServiceStatus::error('001', 'This is not a MOI request', 'هذا ليس طلب وزارة الداخلية')->toArray();
            }
            MoiRepository::saveGuaranteeDepositSlip($row['auto_id'], $base64Image);
            $o = ServiceStatus::success();
            $o->ApplicationID = $appId;
            return $o->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function updateCPDGuarantee(string $appId, string $payRef = '', string $verDoc = ''): array
    {
        try {
            $row = MoiRepository::getCPDByApplicationId($appId);
            if (!$row || $row['request_type'] !== 'MOI') {
                return ServiceStatus::error('001', 'This is not a MOI request', 'هذا ليس طلب وزارة الداخلية')->toArray();
            }
            if (!in_array((string) $row['request_status'], ['1','2'], true)) {
                return ServiceStatus::error('001', 'Application is already confirmed', 'تم تأكيد التطبيق بالفعل')->toArray();
            }
            $ext = MoiRepository::getExternalGuaranteeDetails($row['auto_id']);
            if ($ext) {
                return ServiceStatus::error('001', 'Guarantee Details are sent already', 'تم إرسال تفاصيل الضمان بالفعل')->toArray();
            }
            MoiRepository::insertExternalGuaranteeDetails($row['auto_id'], $payRef);
            if ($verDoc !== '') {
                MoiRepository::saveGuaranteeVerificationDoc($row['auto_id'], $verDoc);
            }
            $o = ServiceStatus::success();
            $o->ApplicationID = $appId;
            return $o->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    // ── Lookup Methods ────────────────────────────────────────────────────────

    public function getAllEmirates(): array
    {
        try {
            return array_map(function ($row) {
                $o                    = new EmirateItemBindingView();
                $o->Id                = (string) $row['emirate_id'];
                $o->EnglishDescription = $row['emirate'];
                $o->ArabicDescription  = self::EMIRATE_AR[$row['emirate_id']] ?? '';
                return $o->toArray();
            }, MoiRepository::getAllEmirates());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllLicenseTypes(): array
    {
        try {
            return array_map(function ($row) {
                $o                    = new LicenseTypesItemBindingView();
                $o->Id                = (string) $row['type_id'];
                $o->EnglishDescription = $row['dl_type'];
                $o->ArabicDescription  = self::LICENSE_TYPE_AR[$row['type_id']] ?? '';
                return $o->toArray();
            }, MoiRepository::getAllLicenseTypes());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllNationalities(): array
    {
        try {
            // Arabic nationality names stored in DB; fallback to English if not available
            return array_map(function ($row) {
                $o                    = new NationalitiesItemBindingView();
                $o->Id                = (string) $row['nationality_id'];
                $o->EnglishDescription = $row['nationality'];
                $o->ArabicDescription  = $row['nationality_ar'] ?? $row['nationality'];
                return $o->toArray();
            }, MoiRepository::getAllNationalities());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getPaymentBreakup(): array
    {
        $o                  = new PaymentBreakup();
        $o->Currency        = 'AED';
        $o->ForIDPValue     = MOI_IDP_FEE;
        $o->ForDeliveryValue = MOI_DELIVERY_FEE;
        return $o->toArray();
    }

    public function getCPDCountryList(): array
    {
        try {
            return array_map(function ($row) {
                $o             = new CPDCountryItemBindingView();
                $o->CountryID  = (string) $row['nationality_id'];
                $o->CountryName = $row['nationality'];
                return $o->toArray();
            }, MoiRepository::getAllCPDCountries());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllowedVehicleTypesForCPD(): array
    {
        try {
            return array_map(function ($row) {
                $o              = new CPDVehicleTypeItemBindingView();
                $o->VehicleType = $row['vehicle_type'];
                return $o->toArray();
            }, MoiRepository::getAllCPDVehicleTypes());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllowedBodyTypesForCPD(): array
    {
        $types = ['Luxury','Station','Saloon','MotorCycle','Truck','Coupe','Bus','Trailer','-Coupe','-Station','-Saloon','Pickup'];
        return array_map(function ($t) {
            $o       = new CPDBodyTypeItemBindingView();
            $o->Type = $t;
            return $o->toArray();
        }, $types);
    }

    public function getAvailableCitiesForCPD(): array
    {
        $cities = ['1' => 'Dubai','2' => 'Abu Dhabi','3' => 'Sharjah','4' => 'Ras al-Khaimah','5' => 'Ajman','6' => 'Fujairah','7' => 'Umm al-Qaiwain'];
        $result = [];
        foreach ($cities as $id => $name) {
            $o          = new CPDCityItemBindingView();
            $o->City    = $name;
            $o->City_AR = self::EMIRATE_AR[$id] ?? '';
            $result[]   = $o->toArray();
        }
        return $result;
    }

    public function getFeesForCPDRequest(string $countryList, string $vehicleType, string $year, string $extraOwner1 = '', string $extraOwner2 = ''): array
    {
        try {
            $countryIds  = array_filter(array_map('trim', explode(',', $countryList)));
            $vatPct      = MoiRepository::getVATPercentage();
            $feeRow      = MoiRepository::getBookingFeeForCountries($countryIds, $vehicleType, $year);

            $bookingFee  = (float) ($feeRow['booking_fee'] ?? 0);
            $extraFee    = ($extraOwner1 !== '' || $extraOwner2 !== '') ? 50.0 : 0.0;
            $total       = $bookingFee + $extraFee;
            $vatAmount   = round($total * $vatPct / 100, 2);

            // Guarantee: use first country's group rate — simplified; full logic in CPDController
            $guarantee   = 0.0;

            $o                            = new CPDFees();
            $o->BookingFee                = (string) $total;
            $o->BookingFeeVAT             = number_format($vatAmount, 2);
            $o->GuaranteeAmount           = (string) $guarantee;
            $o->GuaranteeFeeBankCharges   = number_format($guarantee * MOI_GUARANTEE_BANK_PCT / 100, 2);
            $o->CourierCharges            = MOI_COURIER_CHARGES;
            return $o->toArray();
        } catch (\Throwable $e) {
            return ServiceStatus::generalError($e)->toArray();
        }
    }

    public function getAllIDLStatuses(): array
    {
        try {
            return array_map(function ($row) {
                $o                    = new IDLStatusBindingView();
                $o->StatusID          = (string) $row['status_id'];
                $o->EnglishDescription = $row['status'];
                $o->ArabicDescription  = self::STATUS_IDL_AR[$row['status_id']] ?? '';
                return $o->toArray();
            }, MoiRepository::getAllIDLStatuses());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getAllCPDStatuses(): array
    {
        try {
            return array_map(function ($row) {
                $o                    = new CPDStatusBindingView();
                $o->StatusID          = (string) $row['carnet_status_id'];
                $o->EnglishDescription = $row['status'];
                $o->ArabicDescription  = self::STATUS_CPD_AR[$row['carnet_status_id']] ?? '';
                return $o->toArray();
            }, MoiRepository::getAllCPDStatuses());
        } catch (\Throwable $e) {
            return [ServiceStatus::generalError($e)->toArray()];
        }
    }

    public function getATCBankingDetails(): array
    {
        $o                    = new BankingDetails();
        $o->AccountNumber     = MOI_BANK_ACCOUNT;
        $o->IBAN              = MOI_BANK_IBAN;
        $o->BeneficiaryName   = MOI_BANK_BENEFICIARY;
        $o->BeneficiaryAddress = MOI_BANK_BENE_ADDR;
        $o->Bank              = MOI_BANK_NAME;
        $o->BankAddress       = MOI_BANK_ADDR;
        $o->SwiftCode         = MOI_BANK_SWIFT;
        return $o->toArray();
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    private function buildIDLView(array $row): MOIRequestStatusBindingView
    {
        $o                     = new MOIRequestStatusBindingView();
        $o->EmiratesID         = $row['emirates_id'] ?? '';
        $o->Id                 = $row['request_id'];
        $o->IDPIssueDate       = $row['issued_date'] ?? '';
        $o->PaymentDone        = ($row['paid_status'] != '' && $row['paid_status'] != '0') ? 'True' : 'False';
        $o->Processed          = ($row['processed_by'] ?? '') !== '' ? 'True' : 'False';
        $o->TransactionSequence = (string) $row['auto_id'];
        $o->LicenseNumber      = $row['license_no'] ?? '';
        $o->Mobile             = $row['mobile_no'] ?? '';
        $o->BirthDate          = $row['dob'] ?? '';
        $o->BirthPlace         = $row['place_of_birth'] ?? '';
        $o->IssuePlace         = $row['place_of_issue'] ?? '';
        $o->ExpiryDate         = $row['expiry_date'] ?? '';
        $o->LicenseTypeId      = $row['type_of_dl'] ?? '';
        $o->FirstIDL           = ($row['first_idl'] ?? '0') === '1' ? 'Y' : 'N';
        $o->FirstName          = $row['first_name'] ?? '';
        $o->LastName           = $row['last_name'] ?? '';
        $o->NationalityId      = (string) ($row['nationality'] ?? '');
        $o->Emirate            = $row['emirate'] ?? '';
        $o->UAEAddress         = $row['address_in_uae'] ?? '';
        $o->POBox              = $row['po_box'] ?? '';
        $o->Email              = $row['email'] ?? '';
        $o->HomeAddress        = $row['home_country_address'] ?? '';
        $o->DeliveryLicense    = ($row['delivery_option'] ?? '') === 'send_to_address' ? 'True' : 'False';
        $o->Channel            = $row['booking_channel'] ?? '';
        $o->LicenseTypes       = $row['type_of_dl'] ?? '';
        $o->TrackingURL        = $this->buildTrackingUrl($row['air_bill_no'] ?? '');
        $o->TransactionStatus  = (string) $row['request_status'];
        $o->ErrorCode          = '';
        $o->ErrorMessage       = '';
        $o->ErrorMessage_AR    = '';

        // Passport photo
        $autoId    = $row['auto_id'];
        $userId    = $row['belonging_user_id'];
        $photoPath = MOI_IDL_FILES_PATH . "/{$autoId}/passport.jpg";
        if (!file_exists($photoPath)) {
            $photoPath = MOI_USER_FILES_PATH . "/{$userId}/passport.jpg";
        }
        $o->PassportPhoto = MoiRepository::loadImageAsBase64($photoPath);

        return $o;
    }

    private function buildCPDView(array $row): CPDRequestStatusBindingView
    {
        $countries = MoiRepository::getCountriesForRequest((string) $row['auto_id']);

        $guarantee_paid = 'FALSE';
        $ext = MoiRepository::getExternalGuaranteeDetails((string) $row['auto_id']);
        if (($row['cheque_no'] ?? '') !== '') {
            $guarantee_paid = 'TRUE';
        } elseif ($ext) {
            $guarantee_paid = ($ext['information_verified'] === '1') ? 'TRUE' : 'PENDING VERIFICATION';
        }

        $o                      = new CPDRequestStatusBindingView();
        $o->EmiratesID          = $row['emirates_id'] ?? '';
        $o->Name                = trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
        $o->Email               = $row['email'] ?? '';
        $o->MobileNo            = $row['mobile_no'] ?? '';
        $o->Nationality         = $row['nationality'] ?? '';
        $o->City                = $row['city'] ?? '';
        $o->DOB                 = $row['dob'] ?? '';
        $o->HomeCountryAddress  = $row['home_country_address'] ?? '';
        $o->UAEAddress          = $row['uae_address'] ?? '';
        $o->CompanyName         = $row['company_name'] ?? '';
        $o->POBox               = $row['po_box'] ?? '';
        $o->PassportNo          = $row['passport_no'] ?? '';
        $o->RequestID           = $row['request_id'] ?? '';
        $o->MulkiyaNo           = $row['mulkiya_no'] ?? '';
        $o->RegistrationNo      = $row['registration_no'] ?? '';
        $o->RegistrationDate    = $row['registration_date'] ?? '';
        $o->VehicleMake         = $row['vehicle_make'] ?? '';
        $o->VehicleModel        = $row['vehicle_model'] ?? '';
        $o->VehicleValue        = (string) ($row['vehicle_value'] ?? '');
        $o->ExtraOwner1Name     = $row['extra_owner1_name'] ?? '';
        $o->ExtraOwner2Name     = $row['extra_owner2_name'] ?? '';
        $o->BodyType            = $row['body_type'] ?? '';
        $o->ManufaturingYear    = (string) ($row['manuf_year'] ?? '');
        $o->Color               = $row['color'] ?? '';
        $o->NetWeight           = (string) ($row['net_weight'] ?? '');
        $o->ChassisNo           = $row['chassis_no'] ?? '';
        $o->EngineNo            = $row['engine_no'] ?? '';
        $o->HorsePower          = (string) ($row['horse_power'] ?? '');
        $o->NoOfCylinders       = (string) ($row['no_of_cylinders'] ?? '');
        $o->Uphostry            = $row['upholstery'] ?? '';
        $o->NoOfSeats           = (string) ($row['no_of_seats'] ?? '');
        $o->Radio               = $row['radio'] ?? '';
        $o->SpareTyre           = $row['spare_tyre'] ?? '';
        $o->AdditionalRemarks   = $row['additional_remarks'] ?? '';
        $o->Others1             = $row['others1'] ?? '';
        $o->Others2             = $row['others2'] ?? '';
        $o->GuranteeAmount      = (string) ($row['guarantee_amount'] ?? '');
        $o->TotalAmount         = (string) ($row['total_amount'] ?? '');
        $o->PaymentDone         = ((string)($row['booking_fee_status'] ?? '0')) === '1' ? 'True' : 'False';
        $o->RequestCategory     = $row['request_category'] ?? '';
        $o->DLFront             = '';
        $o->DLBack              = '';
        $o->GuaranteeDepositSlip = MoiRepository::findGuaranteeDepositSlip((string) $row['auto_id']);
        $o->GuaranteePaid       = $guarantee_paid;
        $o->RequestedDateTime   = $row['requested_datetime'] ?? '';
        $o->Countries           = implode(',', array_column($countries, 'nationality_id'));
        $o->Channel             = $row['booking_channel'] ?? '';
        $o->TrackingURL         = $this->buildTrackingUrl($row['airway_bill_no'] ?? '');
        $o->RequestStatus       = $row['status'] ?? '';
        $o->TransactionSequence = (string) $row['auto_id'];
        $o->TransactionStatus   = '1';
        $o->ErrorCode           = '0';
        $o->ErrorMessage        = '';
        $o->ErrorMessage_AR     = '';

        return $o;
    }

    private function buildTrackingUrl(string $airBillNo): string
    {
        if ($airBillNo === '') return '';
        $clean = preg_replace('/\D/', '', $airBillNo);
        return 'https://www.aramex.com/ae/en/track/results?source=aramex&ShipmentNumber=' . $clean;
    }

    private function loadAndResizeImage(string $path, int $w, int $h): ?\GdImage
    {
        [$origW, $origH] = getimagesize($path);
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $src = match($ext) {
            'png'  => imagecreatefrompng($path),
            'gif'  => imagecreatefromgif($path),
            default => imagecreatefromjpeg($path),
        };
        $dst = imagecreatetruecolor($w, $h);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $w, $h, $origW, $origH);
        imagedestroy($src);
        return $dst;
    }
}
