-- ═══════════════════════════════════════════════════════════════════════════
-- ATC Portal v3 — Migration Script
-- Run once on atc_prod after backing up the database
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mn_idl_requests — convert to InnoDB and add indexes ──────────────────
ALTER TABLE mn_idl_requests ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

ALTER TABLE mn_idl_requests
  ADD INDEX IF NOT EXISTS `idx_is_active`         (`is_active`),
  ADD INDEX IF NOT EXISTS `idx_req_status`         (`request_status`),
  ADD INDEX IF NOT EXISTS `idx_req_type`           (`request_type`),
  ADD INDEX IF NOT EXISTS `idx_belonging`          (`belonging_user_id`),
  ADD INDEX IF NOT EXISTS `idx_paid_status`        (`paid_status`),
  ADD INDEX IF NOT EXISTS `idx_request_id`         (`request_id`),
  ADD INDEX IF NOT EXISTS `idx_idl_no`             (`idl_no`),
  ADD INDEX IF NOT EXISTS `idx_active_status`      (`is_active`, `request_status`),
  ADD INDEX IF NOT EXISTS `idx_active_status_type` (`is_active`, `request_status`, `request_type`);

-- ── mn_idl_request_user — convert to InnoDB and add indexes ──────────────
ALTER TABLE mn_idl_request_user ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

ALTER TABLE mn_idl_request_user
  ADD INDEX IF NOT EXISTS `idx_iru_req_id`   (`request_auto_id`),
  ADD INDEX IF NOT EXISTS `idx_iru_emirates` (`emirates_id`),
  ADD INDEX IF NOT EXISTS `idx_iru_license`  (`license_no`);

-- ── Other tables ──────────────────────────────────────────────────────────
ALTER TABLE mn_users      ENGINE=InnoDB;
ALTER TABLE mn_event_logs ENGINE=InnoDB;

ALTER TABLE mn_event_logs
  ADD INDEX IF NOT EXISTS `idx_module_action` (`log_module`, `log_action`);

-- ── Support Tickets ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `mn_support_tickets` (
  `ticket_id`       int          NOT NULL AUTO_INCREMENT,
  `ticket_no`       varchar(50)  DEFAULT NULL,
  `subject`         varchar(255) NOT NULL,
  `description`     text         NOT NULL,
  `category`        enum('IDL','CPD') NOT NULL DEFAULT 'IDL',
  `ticket_type`     enum('GENERAL_INQUIRY','APPLICATION_INQUIRY','COMPLAINT') NOT NULL DEFAULT 'GENERAL_INQUIRY',
  `priority`        varchar(20)  DEFAULT 'MEDIUM',
  `status`          varchar(20)  DEFAULT 'OPEN',
  `customer_phone`  varchar(50)  DEFAULT NULL,
  `customer_email`  varchar(255) DEFAULT NULL,
  `channel`         varchar(20)  DEFAULT 'Portal',
  `created_by`      int          DEFAULT NULL,
  `assigned_to`     int          DEFAULT NULL,
  `related_request` varchar(100) DEFAULT NULL,
  `created_at`      datetime     DEFAULT NULL,
  `updated_at`      datetime     DEFAULT NULL,
  `resolved_at`     datetime     DEFAULT NULL,
  PRIMARY KEY (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mn_support_ticket_comments` (
  `comment_id`      int          NOT NULL AUTO_INCREMENT,
  `ticket_id`       int          NOT NULL,
  `comment`         text         NOT NULL,
  `attachment_path` varchar(500) DEFAULT NULL,
  `created_by`      int          DEFAULT NULL,
  `created_at`      datetime     DEFAULT NULL,
  PRIMARY KEY (`comment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE mn_support_tickets
  MODIFY COLUMN `category`    enum('IDL','CPD') NOT NULL DEFAULT 'IDL',
  MODIFY COLUMN `ticket_type` enum('GENERAL_INQUIRY','APPLICATION_INQUIRY','COMPLAINT') NOT NULL DEFAULT 'GENERAL_INQUIRY',
  ADD COLUMN IF NOT EXISTS `customer_phone` varchar(50)  DEFAULT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `customer_email` varchar(255) DEFAULT NULL AFTER `customer_phone`,
  ADD COLUMN IF NOT EXISTS `channel`        varchar(20)  DEFAULT 'Portal' AFTER `customer_email`;

ALTER TABLE mn_support_ticket_comments
  ADD COLUMN IF NOT EXISTS `attachment_path` varchar(500) DEFAULT NULL AFTER `comment`;

-- ── CPD Guarantee Tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `mn_cpd_guarantee_groups` (
  `group_id`     int          NOT NULL AUTO_INCREMENT,
  `group_code`   varchar(30)  NOT NULL,
  `group_label`  varchar(100) NOT NULL,
  `fixed_amount` int          DEFAULT NULL,
  `special_note` varchar(500) DEFAULT NULL,
  `sort_order`   int          DEFAULT 0,
  PRIMARY KEY (`group_id`),
  UNIQUE KEY `uq_group_code` (`group_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mn_cpd_guarantee_rates` (
  `rate_id`    int         NOT NULL AUTO_INCREMENT,
  `group_code` varchar(30) NOT NULL,
  `year_band`  tinyint     NOT NULL,
  `saloon`     int         NOT NULL DEFAULT 0,
  `station`    int         NOT NULL DEFAULT 0,
  `luxury`     int         NOT NULL DEFAULT 0,
  PRIMARY KEY (`rate_id`),
  UNIQUE KEY `uq_rate` (`group_code`, `year_band`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mn_cpd_guarantee_countries` (
  `id`             int          NOT NULL AUTO_INCREMENT,
  `nationality_id` int          DEFAULT NULL,
  `country_name`   varchar(100) NOT NULL,
  `group_code`     varchar(30)  NOT NULL,
  `special_note`   varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_group`  (`group_code`),
  KEY `idx_country`(`country_name`),
  KEY `idx_nat_id` (`nationality_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `mn_cpd_guarantee_groups` (`group_code`,`group_label`,`fixed_amount`,`special_note`,`sort_order`) VALUES
  ('FLAT_2000',    'Jordan, Syria, Sudan & Iraq',                2000,  NULL, 1),
  ('FLAT_EU',      'European Countries & Turkey',                10000, 'European countries require cash + personal cheque of AED 100,000', 2),
  ('EGYPT',        'Egypt',                                      NULL,  'Egypt requires cash + personal cheque of AED 50,000', 3),
  ('INDIA_AFRICA', 'India, Iran, Pakistan, Bangladesh & Africa', NULL,  NULL, 4),
  ('DEFAULT',      'Latin America, Israel & Lebanon',            NULL,  NULL, 5);

INSERT IGNORE INTO `mn_cpd_guarantee_rates` (`group_code`,`year_band`,`saloon`,`station`,`luxury`) VALUES
  ('DEFAULT',0,5000,10000,15000),('DEFAULT',1,10000,15000,20000),('DEFAULT',2,15000,20000,25000),
  ('EGYPT',0,10000,15000,30000),('EGYPT',1,15000,20000,40000),('EGYPT',2,20000,25000,70000),
  ('INDIA_AFRICA',0,15000,25000,40000),('INDIA_AFRICA',1,20000,35000,70000),('INDIA_AFRICA',2,35000,45000,100000);

INSERT IGNORE INTO `mn_cpd_guarantee_countries` (`country_name`,`group_code`) VALUES
  ('Jordan','FLAT_2000'),('Syria','FLAT_2000'),('Sudan','FLAT_2000'),('Iraq','FLAT_2000'),
  ('Turkey','FLAT_EU'),('Germany','FLAT_EU'),('France','FLAT_EU'),('Italy','FLAT_EU'),
  ('Spain','FLAT_EU'),('Netherlands','FLAT_EU'),('Belgium','FLAT_EU'),('Austria','FLAT_EU'),
  ('Switzerland','FLAT_EU'),('Sweden','FLAT_EU'),('Norway','FLAT_EU'),('Denmark','FLAT_EU'),
  ('Finland','FLAT_EU'),('Greece','FLAT_EU'),('Portugal','FLAT_EU'),('Poland','FLAT_EU'),
  ('Czech Republic','FLAT_EU'),('Hungary','FLAT_EU'),('Romania','FLAT_EU'),('Bulgaria','FLAT_EU'),
  ('Croatia','FLAT_EU'),('Slovenia','FLAT_EU'),('Slovakia','FLAT_EU'),('Serbia','FLAT_EU'),
  ('Albania','FLAT_EU'),('Bosnia','FLAT_EU'),('Montenegro','FLAT_EU'),('Kosovo','FLAT_EU'),
  ('Macedonia','FLAT_EU'),('United Kingdom','FLAT_EU'),('Ireland','FLAT_EU'),('Luxembourg','FLAT_EU'),
  ('Malta','FLAT_EU'),('Estonia','FLAT_EU'),('Latvia','FLAT_EU'),('Lithuania','FLAT_EU'),
  ('Cyprus','FLAT_EU'),('Iceland','FLAT_EU'),('Liechtenstein','FLAT_EU'),('Monaco','FLAT_EU'),
  ('San Marino','FLAT_EU'),('Egypt','EGYPT'),
  ('India','INDIA_AFRICA'),('Iran','INDIA_AFRICA'),('Pakistan','INDIA_AFRICA'),('Bangladesh','INDIA_AFRICA'),
  ('Nigeria','INDIA_AFRICA'),('Kenya','INDIA_AFRICA'),('Ghana','INDIA_AFRICA'),('Ethiopia','INDIA_AFRICA'),
  ('Tanzania','INDIA_AFRICA'),('Uganda','INDIA_AFRICA'),('South Africa','INDIA_AFRICA'),('Algeria','INDIA_AFRICA'),
  ('Morocco','INDIA_AFRICA'),('Tunisia','INDIA_AFRICA'),('Libya','INDIA_AFRICA'),('Somalia','INDIA_AFRICA'),
  ('Mozambique','INDIA_AFRICA'),('Zimbabwe','INDIA_AFRICA'),('Zambia','INDIA_AFRICA'),('Angola','INDIA_AFRICA'),
  ('Cameroon','INDIA_AFRICA'),('Senegal','INDIA_AFRICA'),('Ivory Coast','INDIA_AFRICA'),('Mali','INDIA_AFRICA'),
  ('Burkina Faso','INDIA_AFRICA'),('Niger','INDIA_AFRICA'),('Chad','INDIA_AFRICA'),('Rwanda','INDIA_AFRICA'),
  ('Burundi','INDIA_AFRICA'),('Congo','INDIA_AFRICA'),('DR Congo','INDIA_AFRICA'),('Malawi','INDIA_AFRICA'),
  ('Namibia','INDIA_AFRICA'),('Botswana','INDIA_AFRICA'),('Lesotho','INDIA_AFRICA'),('Eritrea','INDIA_AFRICA'),
  ('Djibouti','INDIA_AFRICA'),('Comoros','INDIA_AFRICA'),('Madagascar','INDIA_AFRICA'),('Mauritius','INDIA_AFRICA'),
  ('Seychelles','INDIA_AFRICA'),('Cape Verde','INDIA_AFRICA'),
  ('Lebanon','DEFAULT'),('Israel','DEFAULT'),('Brazil','DEFAULT'),('Argentina','DEFAULT'),
  ('Mexico','DEFAULT'),('Colombia','DEFAULT'),('Chile','DEFAULT'),('Peru','DEFAULT'),
  ('Venezuela','DEFAULT'),('Ecuador','DEFAULT'),('Bolivia','DEFAULT'),('Paraguay','DEFAULT'),
  ('Uruguay','DEFAULT'),('Guatemala','DEFAULT'),('Honduras','DEFAULT'),('El Salvador','DEFAULT'),
  ('Nicaragua','DEFAULT'),('Costa Rica','DEFAULT'),('Panama','DEFAULT'),('Cuba','DEFAULT'),
  ('Dominican Republic','DEFAULT'),('Haiti','DEFAULT'),('Jamaica','DEFAULT'),('Trinidad','DEFAULT');

UPDATE mn_cpd_guarantee_countries
  SET special_note = 'India requires cash + personal cheque of AED 100,000'
  WHERE country_name = 'India' AND (special_note IS NULL OR special_note = '');

UPDATE mn_cpd_guarantee_countries gc
  JOIN mn_cpd_countries c ON LOWER(TRIM(c.nationality)) = LOWER(TRIM(gc.country_name))
  SET gc.nationality_id = c.nationality_id
  WHERE gc.nationality_id IS NULL;

-- ── mn_cpd_requests — add missing columns ────────────────────────────────
ALTER TABLE mn_cpd_requests
  ADD COLUMN IF NOT EXISTS `order_ref_no` varchar(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `telr_cart_id` varchar(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `paid_status`  tinyint      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `paid_date`    datetime     DEFAULT NULL;

-- ── CPD Workflow Action: Send for Corrections ─────────────────────────────
INSERT IGNORE INTO mn_workflows_actions (section, action, next_role)
VALUES ('CPD', 'SEND_FOR_CORRECTIONS_CUSTOMER', 'Customer');

-- ── CPD status 8: Sent for Corrections ────────────────────────────────────
INSERT IGNORE INTO mn_cpd_statuses (carnet_status_id, status)
VALUES (8, 'Sent for Corrections');

-- mn_cpd_return_guarantee_details — add image column
ALTER TABLE mn_cpd_return_guarantee_details
  ADD COLUMN IF NOT EXISTS `cheque_image` varchar(500) DEFAULT NULL AFTER `remarks`;

-- ── CPD performance indexes ───────────────────────────────────────────────────

-- Convert to InnoDB for proper locking and index performance
ALTER TABLE mn_cpd_requests ENGINE=InnoDB;
ALTER TABLE mn_cpd_return_guarantee_details ENGINE=InnoDB;
ALTER TABLE mn_cpd_statuses ENGINE=InnoDB;

-- mn_cpd_requests indexes
ALTER TABLE mn_cpd_requests
  ADD INDEX IF NOT EXISTS idx_cpd_status         (request_status),
  ADD INDEX IF NOT EXISTS idx_cpd_user           (belonging_user_id),
  ADD INDEX IF NOT EXISTS idx_cpd_datetime       (requested_datetime),
  ADD INDEX IF NOT EXISTS idx_cpd_status_date    (request_status, requested_datetime),
  ADD INDEX IF NOT EXISTS idx_cpd_request_id     (request_id);

-- mn_cpd_return_guarantee_details — critical for the has_cheque join
ALTER TABLE mn_cpd_return_guarantee_details
  ADD INDEX IF NOT EXISTS idx_cgd_request_id (request_id);

-- CPD Workflow Action: Create Normal Request Walk-In
INSERT IGNORE INTO mn_workflows_actions (section, action, next_role)
VALUES ('CPD', 'CREATE_NORMAL_REQUEST_WALKIN', 'IDL_CPD_Cashier');

-- Index for queue position filtering
ALTER TABLE mn_cpd_requests
  ADD INDEX IF NOT EXISTS idx_cpd_queue_position (current_queue_position);

-- CPD Workflow: after cashier payment, route to CPD_Officer
INSERT IGNORE INTO mn_workflows_actions (section, action, next_role)
VALUES ('CPD', 'ACCEPT_PAYMENT_NORMAL_REQUEST_WALKIN', 'CPD_Officer');

-- CPD Workflow: after carnet issued
INSERT IGNORE INTO mn_workflows_actions (section, action, next_role)
VALUES ('CPD', 'ISSUE_CARNET_NORMAL_REQUEST', 'CPD_Officer');

-- Add received_to_office column to mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
ADD `received_to_office` INT NOT NULL DEFAULT '0' AFTER `confirmed_datetime`;

-- Add delivery and payment option columns to mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
  ADD `delivery_option`  VARCHAR(50)  DEFAULT NULL AFTER `remarks`,
  ADD `payment_option`   VARCHAR(50)  DEFAULT NULL AFTER `delivery_option`,
  ADD `delivery_fee`       DECIMAL(10,2) DEFAULT NULL AFTER `payment_option`;

-- Add bank details columns to mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
  ADD `account_no`    VARCHAR(100) DEFAULT NULL AFTER `bank_name`,
  ADD `iban`          VARCHAR(100) DEFAULT NULL AFTER `account_no`,
  ADD `beneficiary`   VARCHAR(200) DEFAULT NULL AFTER `iban`;

-- Add delivery method, order ref and order status to mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
  ADD `delivery_method` ENUM('ARAMAX','DELIVER_BY_HAND') DEFAULT NULL,
  ADD `order_ref`       VARCHAR(100) DEFAULT NULL,
  ADD `order_status`    INT DEFAULT '0';

-- Add all 4 new columns to mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
  ADD `delivery_method`    ENUM('ARAMAX','DELIVER_BY_HAND') DEFAULT NULL,
  ADD `order_ref`          VARCHAR(100) DEFAULT NULL,
  ADD `order_status`       INT DEFAULT '0',
  ADD `cus_bank_information` TEXT DEFAULT NULL;

-- Final ALTER: correct column definitions for mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
  ADD `return_payment_method` ENUM('BANK_DEPOSIT','COLLECT_CHEQUE') DEFAULT NULL,
  ADD `delivery_method`       ENUM('ARAMAX','DELIVER_BY_HAND')       DEFAULT NULL,
  ADD `order_ref`             VARCHAR(100)                           DEFAULT NULL,
  ADD `order_status`          INT                                    DEFAULT NULL,
  ADD `cus_bank_information`  TEXT                                   DEFAULT NULL;

-- Add delivery_fee column to mn_cpd_carnet_returns
ALTER TABLE `mn_cpd_carnet_returns`
  ADD `delivery_fee` DECIMAL(10,2) DEFAULT NULL;

-- Rename aramex_fee to delivery_fee
ALTER TABLE `mn_cpd_carnet_returns`
  CHANGE `aramex_fee` `delivery_fee` DECIMAL(10,2) DEFAULT NULL;

-- ── mn_cpd_claims — CPD carnet claims with document attachments ───────────
CREATE TABLE IF NOT EXISTS `mn_cpd_claims` (
  `claim_id`       INT          NOT NULL AUTO_INCREMENT,
  `request_id`     INT          NOT NULL,
  `carnet_no`      VARCHAR(50)  NOT NULL,
  `claim_details`  TEXT,
  `added_by`       INT          DEFAULT NULL,
  `added_datetime` DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`claim_id`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_carnet_no`  (`carnet_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── mn_cpd_claim_notes — notes per claim, each with optional PDF attachments ─
CREATE TABLE IF NOT EXISTS `mn_cpd_claim_notes` (
  `note_id`       INT       NOT NULL AUTO_INCREMENT,
  `claim_id`      INT       NOT NULL,
  `note_text`     TEXT,
  `added_by`      INT       DEFAULT NULL,
  `added_datetime` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`),
  KEY `idx_claim_id` (`claim_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── mn_customer_holds — EID-keyed hold records for public-site blocking ──────
CREATE TABLE IF NOT EXISTS `mn_customer_holds` (
  `hold_id`     INT         NOT NULL AUTO_INCREMENT,
  `emirates_id` VARCHAR(20) NOT NULL,
  `hold_reason` TEXT,
  `placed_by`   INT         NOT NULL,
  `placed_at`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lifted_by`   INT         DEFAULT NULL,
  `lifted_at`   DATETIME    DEFAULT NULL,
  `is_active`   TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (`hold_id`),
  KEY `idx_eid`    (`emirates_id`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
