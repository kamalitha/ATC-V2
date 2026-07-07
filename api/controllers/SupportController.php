<?php
declare(strict_types=1);

class SupportController
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // ── My Tickets (public user) ──────────────────────────────────────────────

    public function myTickets(array $params, array $body, array $query): void
    {
        try {
            $userId = Auth::id();
            $page   = max(1, (int)($query['page'] ?? 1));
            $search = trim($query['search'] ?? '');

            $where  = 'WHERE t.created_by = ?';
            $binds  = [$userId];

            if ($search !== '') {
                $where  .= ' AND (t.ticket_no LIKE ? OR t.subject LIKE ?)';
                $like    = "%{$search}%";
                array_push($binds, $like, $like);
            }

            $result = $this->db->paginate(
                "SELECT t.ticket_id, t.ticket_no, t.subject, t.category, t.ticket_type,
                        t.priority, t.status, t.customer_phone, t.customer_email,
                        t.related_request, t.created_at
                 FROM mn_support_tickets t
                 {$where}
                 ORDER BY t.ticket_id DESC",
                $binds, $page,
            );

            Response::success($result);
        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::myTickets');
            Response::serverError('Failed to load your tickets');
        }
    }

    // ── List ──────────────────────────────────────────────────────────────────

    public function index(array $params, array $body, array $query): void
    {
        try {
            $v        = Validator::make($query);
            $page     = $v->int('page', 1);
            $search   = $v->get('search', '');
            $status   = $v->get('status', '');
            $category = $v->get('category', '');

            $where = 'WHERE 1=1';
            $binds = [];

            if ($search !== '') {
                $where  .= ' AND (t.ticket_no LIKE ? OR t.subject LIKE ? OR t.related_request LIKE ?)';
                $like    = "%{$search}%";
                array_push($binds, $like, $like, $like);
            }
            if ($status !== '') {
                $where  .= ' AND t.status = ?';
                $binds[] = $status;
            }
            if ($category !== '') {
                $where  .= ' AND t.category = ?';
                $binds[] = $category;
            }

            $result = $this->db->paginate(
                "SELECT t.ticket_id, t.ticket_no, t.subject, t.category, t.ticket_type,
                        t.priority, t.status, t.customer_phone, t.customer_email, t.channel,
                        t.related_request, t.created_at, t.resolved_at,
                        u.first_name, u.last_name
                 FROM mn_support_tickets t
                 LEFT JOIN mn_users u ON u.user_id = t.created_by
                 {$where}
                 ORDER BY t.ticket_id DESC",
                $binds, $page,
            );

            Response::success($result);
        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::index');
            Response::serverError('Failed to load support tickets');
        }
    }

    // ── Single ────────────────────────────────────────────────────────────────

    public function show(array $params, array $body, array $query): void
    {
        try {
            $id = (int)$params['id'];

            $ticket = $this->db->queryOne(
                "SELECT t.*, u.first_name, u.last_name, u.email
                 FROM mn_support_tickets t
                 LEFT JOIN mn_users u ON u.user_id = t.created_by
                 WHERE t.ticket_id = ?",
                [$id],
            );

            if (!$ticket) Response::notFound('Ticket not found');

            $ticket['comments'] = $this->db->query(
                "SELECT c.comment_id, c.comment, c.attachment_path, c.created_at,
                        u.first_name, u.last_name
                 FROM mn_support_ticket_comments c
                 LEFT JOIN mn_users u ON u.user_id = c.created_by
                 WHERE c.ticket_id = ?
                 ORDER BY c.created_at ASC",
                [$id],
            );

            Response::success($ticket);
        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::show');
            Response::serverError('Failed to load ticket');
        }
    }

    // ── Create ────────────────────────────────────────────────────────────────

    public function store(array $params, array $body, array $query): void
    {
        try {
            Validator::make($body)
                ->required('subject', 'description', 'ticket_type', 'customer_phone', 'customer_email')
                ->in('ticket_type', ['GENERAL_INQUIRY', 'APPLICATION_INQUIRY', 'COMPLAINT'])
                ->validate();

            $userId = Auth::id();

            // idl_officer → always IDL; public user → they choose category
            if (Auth::roleId() === 2) {
                Validator::make($body)
                    ->required('category')
                    ->in('category', ['IDL', 'CPD'])
                    ->validate();
                $category = $body['category'];
            } else {
                $category = 'IDL';
            }

            $id = $this->db->insert(
                "INSERT INTO mn_support_tickets
                 (ticket_no, subject, description, category, ticket_type, priority, status,
                  customer_phone, customer_email, channel, related_request, created_by, created_at, updated_at)
                 VALUES ('PENDING', ?, ?, ?, ?, ?, 'OPEN', ?, ?, 'Portal', ?, ?, NOW(), NOW())",
                [
                    $body['subject'],
                    $body['description'],
                    $category,
                    $body['ticket_type'],
                    $body['priority']        ?? 'MEDIUM',
                    $body['customer_phone'],
                    $body['customer_email'],
                    $body['channel']         ?? 'Portal',
                    $body['related_request'] ?? null,
                    $userId,
                ],
            );

            $ticketNo = sprintf('TKT-%s/%d', date('Ymd'), $id);
            $this->db->execute(
                'UPDATE mn_support_tickets SET ticket_no=? WHERE ticket_id=?',
                [$ticketNo, $id],
            );

            Logger::info("Support ticket created: {$ticketNo}", ['created_by' => $userId]);
            Response::created(['ticket_id' => $id, 'ticket_no' => $ticketNo], 'Ticket created');
        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::store');
            Response::serverError('Failed to create ticket');
        }
    }

    // ── Update Status ─────────────────────────────────────────────────────────

    public function updateStatus(array $params, array $body, array $query): void
    {
        try {
            $id     = (int)$params['id'];
            $status = strtoupper(trim($body['status'] ?? ''));

            $allowed = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
            if (!in_array($status, $allowed, true)) {
                Response::error('Invalid status. Allowed: ' . implode(', ', $allowed), 422);
            }

            $resolvedAt = in_array($status, ['RESOLVED', 'CLOSED'], true) ? ', resolved_at=NOW()' : '';

            $this->db->execute(
                "UPDATE mn_support_tickets SET status=?, updated_at=NOW(){$resolvedAt} WHERE ticket_id=?",
                [$status, $id],
            );

            Logger::info("Ticket #{$id} status updated to {$status}", ['by' => Auth::id()]);
            Response::success(null, 'Status updated');
        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::updateStatus');
            Response::serverError('Failed to update status');
        }
    }

    // ── Serve Comment Attachment ──────────────────────────────────────────────

    public function serveAttachment(array $params, array $body, array $query): void
    {
        try {
            $commentId = (int)$params['cid'];

            $row = $this->db->queryOne(
                'SELECT attachment_path FROM mn_support_ticket_comments WHERE comment_id=?',
                [$commentId],
            );

            if (!$row || !$row['attachment_path']) Response::notFound('Attachment not found');

            $path = API_ROOT . DIRECTORY_SEPARATOR . $row['attachment_path'];
            if (!file_exists($path)) Response::notFound('File not found on disk');

            $mime = mime_content_type($path);
            $data = base64_encode(file_get_contents($path));

            // Return as base64 data so the frontend can use it directly as a src
            Response::success(['base64' => "data:{$mime};base64,{$data}", 'mime' => $mime]);
        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::serveAttachment');
            Response::serverError('Failed to serve attachment');
        }
    }

    // ── Add Comment ───────────────────────────────────────────────────────────

    public function addComment(array $params, array $body, array $query): void
    {
        try {
            $id      = (int)$params['id'];
            $comment = trim($body['comment'] ?? $_POST['comment'] ?? '');

            if ($comment === '') {
                Response::error('comment is required', 422);
            }

            // ── Optional file attachment ──────────────────────────────────────
            $attachmentPath = null;

            if (!empty($_FILES['attachment']) && $_FILES['attachment']['error'] !== UPLOAD_ERR_NO_FILE) {
                $file = $_FILES['attachment'];

                if ($file['error'] !== UPLOAD_ERR_OK) {
                    Response::error('File upload error code: ' . $file['error'], 422);
                }

                $mime     = mime_content_type($file['tmp_name']);
                $allowed  = ['image/jpeg', 'image/png', 'application/pdf'];
                if (!in_array($mime, $allowed, true)) {
                    Response::error('Only JPG, PNG or PDF files are allowed', 422);
                }

                if ($file['size'] > Config::UPLOAD_MAX_BYTES) {
                    Response::error('File exceeds 2 MB limit', 422);
                }

                $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'application/pdf' => 'pdf'];
                $ext    = $extMap[$mime];

                $dir = API_ROOT . DIRECTORY_SEPARATOR . Config::UPLOADS_DIR
                     . DIRECTORY_SEPARATOR . 'support'
                     . DIRECTORY_SEPARATOR . $id;

                if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
                    Response::serverError('Could not create upload directory');
                }

                // Insert comment first to get the comment_id for the filename
                $commentId = $this->db->insert(
                    "INSERT INTO mn_support_ticket_comments (ticket_id, comment, attachment_path, created_by, created_at)
                     VALUES (?, ?, NULL, ?, NOW())",
                    [$id, $comment, Auth::id()],
                );

                $filename       = "comment_{$commentId}.{$ext}";
                $dest           = $dir . DIRECTORY_SEPARATOR . $filename;
                $attachmentPath = Config::UPLOADS_DIR . "/support/{$id}/{$filename}";

                if (!move_uploaded_file($file['tmp_name'], $dest)) {
                    Logger::error("Failed to save attachment for comment #{$commentId}");
                } else {
                    $this->db->execute(
                        'UPDATE mn_support_ticket_comments SET attachment_path=? WHERE comment_id=?',
                        [$attachmentPath, $commentId],
                    );
                }

            } else {
                // No file — plain insert
                $commentId = $this->db->insert(
                    "INSERT INTO mn_support_ticket_comments (ticket_id, comment, attachment_path, created_by, created_at)
                     VALUES (?, ?, NULL, ?, NOW())",
                    [$id, $comment, Auth::id()],
                );
            }

            $this->db->execute(
                'UPDATE mn_support_tickets SET updated_at=NOW() WHERE ticket_id=?',
                [$id],
            );

            Logger::info("Comment #{$commentId} added to ticket #{$id}", ['by' => Auth::id()]);
            Response::created(['comment_id' => $commentId, 'attachment_path' => $attachmentPath], 'Comment added');

        } catch (\Throwable $e) {
            Logger::exception($e, 'SupportController::addComment');
            Response::serverError('Failed to add comment');
        }
    }
}
