<?php
declare(strict_types=1);

// ── MOE Repository — All SQL isolated here ────────────────────────────────────
// No SQL exists outside this file. All queries use positional PDO bindings —
// the legacy class.moe_service.php interpolated $start_date/$end_date directly
// into the SQL string; that's not part of the "business logic" being carried
// over, just an unsafe implementation detail, so it's bound here instead.
//
// Business logic (filters, joins, date cutoffs) is otherwise a direct port of
// MOEService::_getIDLDataForMOE() / _getCPDDataOfBusAndTrucksForMOE() /
// _getCPDDataOfOtherTypesForMOE() from the legacy service.

final class MoeRepository
{
    // ── IDL ───────────────────────────────────────────────────────────────────
    // Legacy: ONLINE requests with status Issued/Returned (3,4), issued after
    // 2023-06-31, UNION'd with the same for a fixed set of distributor branches
    // (19,6,7,5) regardless of request_type.

    public static function getIDLDataForMOE(string $startDate, string $endDate): array
    {
        return MoeDB::all(
            "SELECT r.request_id, r.payment_method, r.issued_date,
                    u.first_name, u.last_name,
                    em.emirate, usr.mobile_no, r.total_amount,
                    s.status, r.reject_reason, u.emirates_id,
                    n.nationality, r.idl_no, r.idl_booklet_no, r.order_ref_no, r.paid_date
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON r.auto_id = u.request_auto_id
             JOIN mn_emirates em        ON u.emirate = em.emirate_id
             JOIN mn_users usr          ON u.user_id = usr.user_id
             JOIN mn_idl_status s       ON r.request_status = s.status_id
             JOIN mn_nationalities n    ON u.nationality = n.nationality_id
             WHERE r.request_type IN ('ONLINE') AND r.request_status IN (4,3)
               AND STR_TO_DATE(r.paid_date,'%Y-%m-%d') > STR_TO_DATE('2023-06-31','%Y-%m-%d')
               AND CAST(r.issued_date AS DATE) BETWEEN ? AND ?
             UNION ALL
             SELECT r.request_id, r.payment_method, r.issued_date,
                    u.first_name, u.last_name,
                    em.emirate, usr.mobile_no, r.total_amount,
                    s.status, r.reject_reason, u.emirates_id,
                    n.nationality, r.idl_no, r.idl_booklet_no, r.order_ref_no, r.paid_date
             FROM mn_idl_requests r
             JOIN mn_idl_request_user u ON r.auto_id = u.request_auto_id
             JOIN mn_emirates em        ON u.emirate = em.emirate_id
             JOIN mn_users usr          ON u.user_id = usr.user_id
             JOIN mn_idl_status s       ON r.request_status = s.status_id
             JOIN mn_nationalities n    ON u.nationality = n.nationality_id
             JOIN mn_idl_distributor_branch_users dbu ON dbu.belonging_user_id = r.requested_by
             JOIN mn_idl_distributor_branches db       ON dbu.branch_id = db.branch_auto_id
             JOIN mn_idl_distributors d                ON d.distributor_id = db.distributor_id
             WHERE db.branch_auto_id IN (19,6,7,5) AND r.request_status IN (4,3)
               AND STR_TO_DATE(r.paid_date,'%Y-%m-%d') > STR_TO_DATE('2023-06-31','%Y-%m-%d')
               AND CAST(r.issued_date AS DATE) BETWEEN ? AND ?",
            [$startDate, $endDate, $startDate, $endDate],
        );
    }

    // ── CPD ───────────────────────────────────────────────────────────────────
    // Legacy: issued carnets (CALL_CENTER/ONLINE) with a non-empty carnet number,
    // issued after 2023-06-31, split by body_type into Bus/Truck vs everything else.

    public static function getCPDDataForMOE(string $startDate, string $endDate, bool $busAndTrucks): array
    {
        $bodyTypeClause = $busAndTrucks
            ? "body_type IN ('Bus','Truck')"
            : "body_type NOT IN ('Bus','Truck')";

        return MoeDB::all(
            "SELECT r.request_id,
                    r.booking_fee, r.extra_fees,
                    r.vat_amount, r.method_of_payment,
                    DATE(ic.issued_datetime) AS issued_datetime, c.carnet_no,
                    n.nationality, u.emirates_id,
                    CONCAT(u.first_name,' ',u.last_name) AS full_name,
                    r.mulkiya_no, r.registration_no, r.vehicle_make,
                    r.vehicle_model, r.body_type, r.manuf_year,
                    r.color, r.chassis_no, r.engine_no,
                    r.no_of_seats, r.no_of_cylinders, st.status AS cpd_status
             FROM mn_cpd_requests r
             JOIN mn_cpd_request_user u ON r.auto_id = u.request_auto_id
             JOIN mn_users usr          ON u.user_id = usr.user_id
             JOIN mn_nationalities n    ON u.nationality_id = n.nationality_id
             JOIN mn_cpd_statuses st    ON r.request_status = st.carnet_status_id
             JOIN mn_cpd_issued_carnets ic ON r.auto_id = ic.request_id
             JOIN mn_cpd_carnets c         ON ic.carnet_id = c.carnet_id
             WHERE {$bodyTypeClause} AND r.request_type IN ('CALL_CENTER','ONLINE') AND c.carnet_no <> ''
               AND STR_TO_DATE(ic.issued_datetime,'%Y-%m-%d') > STR_TO_DATE('2023-06-31','%Y-%m-%d')
               AND ic.issued_datetime BETWEEN ? AND ?
             ORDER BY r.auto_id DESC",
            [$startDate, $endDate],
        );
    }
}
