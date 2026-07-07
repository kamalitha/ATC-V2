<?php
declare(strict_types=1);

class UserController
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function index(array $params, array $body, array $query): void
    {
        $v      = Validator::make($query);
        $page   = $v->int('page', 1);
        $search = $v->get('search', '');
        $role   = $v->get('role', '');

        $where = 'WHERE 1=1';
        $binds = [];

        if ($search !== '') {
            $where  .= ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR username LIKE ?)';
            $like    = "%{$search}%";
            $binds   = [$like, $like, $like, $like];
        }
        if ($role !== '') {
            $where .= ' AND user_type = ?';
            $binds[] = $role;
        }

        $result = $this->db->paginate(
            "SELECT user_id, first_name, last_name, email, username,
                    user_type, is_active, date_created, last_logged_in
             FROM mn_users {$where} ORDER BY user_id DESC",
            $binds, $page,
        );

        // Annotate with role names
        foreach ($result['data'] as &$u) {
            $u['role_name'] = Auth::roleNameFor((int)$u['user_type']);
        }

        Response::success($result);
    }

    public function store(array $params, array $body, array $query): void
    {
        Validator::make($body)
            ->required('first_name', 'email', 'username', 'password', 'user_type')
            ->email('email')
            ->min('password', 8)
            ->validate();

        $exists = (int)$this->db->scalar(
            'SELECT COUNT(*) FROM mn_users WHERE email=? OR username=?',
            [$body['email'], $body['username']],
        );
        if ($exists > 0) Response::error('Email or username already in use', 409);

        $id = $this->db->insert(
            'INSERT INTO mn_users
             (first_name, last_name, email, username, password, user_type, address, mobile_no, date_created, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 1)',
            [
                $body['first_name'],
                $body['last_name']   ?? '',
                $body['email'],
                $body['username'],
                Auth::hashPassword($body['password']),
                $body['user_type'],
                $body['address']     ?? '',
                $body['mobile_no']   ?? '',
            ],
        );

        Response::created(['user_id' => $id], 'User created');
    }

    public function show(array $params, array $body, array $query): void
    {
        $user = $this->db->queryOne(
            'SELECT user_id, first_name, last_name, email, username,
                    user_type, is_active, date_created, last_logged_in, address, mobile_no
             FROM mn_users WHERE user_id=?',
            [$params['id']],
        );
        if ($user === null) Response::notFound('User not found');

        $user['role_name'] = Auth::roleNameFor((int)$user['user_type']);
        Response::success($user);
    }

    public function update(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('first_name', 'email')->email('email')->validate();

        $exists = (int)$this->db->scalar(
            'SELECT COUNT(*) FROM mn_users WHERE email=? AND user_id != ?',
            [$body['email'], $params['id']],
        );
        if ($exists > 0) Response::error('Email already used by another account', 409);

        $this->db->execute(
            'UPDATE mn_users SET first_name=?, last_name=?, email=?,
             address=?, mobile_no=?, user_type=? WHERE user_id=?',
            [
                $body['first_name'],
                $body['last_name']  ?? '',
                $body['email'],
                $body['address']    ?? '',
                $body['mobile_no']  ?? '',
                $body['user_type'],
                $params['id'],
            ],
        );
        Response::success(null, 'User updated');
    }

    public function toggleStatus(array $params, array $body, array $query): void
    {
        $current = $this->db->scalar('SELECT is_active FROM mn_users WHERE user_id=?', [$params['id']]);
        if ($current === null) Response::notFound('User not found');

        // Prevent self-deactivation
        if ((int)$params['id'] === Auth::id()) {
            Response::error('You cannot deactivate your own account', 400);
        }

        $new = (int)$current === 1 ? 0 : 1;
        $this->db->execute('UPDATE mn_users SET is_active=? WHERE user_id=?', [$new, $params['id']]);
        Response::success(['is_active' => $new], $new ? 'User activated' : 'User deactivated');
    }

    public function changePassword(array $params, array $body, array $query): void
    {
        Validator::make($body)->required('password')->min('password', 8)->validate();

        $this->db->execute(
            'UPDATE mn_users SET password=? WHERE user_id=?',
            [Auth::hashPassword($body['password']), $params['id']],
        );
        Response::success(null, 'Password changed');
    }

    public function roles(array $params, array $body, array $query): void
    {
        $roles = array_map(
            fn($name, $id) => ['id' => $id, 'name' => $name, 'label' => ucwords(str_replace('_', ' ', $name))],
            array_keys(Auth::ROLE_MAP),
            Auth::ROLE_MAP,
        );
        usort($roles, fn($a, $b) => $a['id'] <=> $b['id']);
        Response::success($roles);
    }
}
