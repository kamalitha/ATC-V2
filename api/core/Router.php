<?php
declare(strict_types=1);

class Router
{
    private array $routes = [];

    private function add(string $method, string $path, array $handler, bool $auth, array $roles, array $modules): void
    {
        $this->routes[] = compact('method', 'path', 'handler', 'auth', 'roles', 'modules');
    }

    public function get(string $p, array $h, bool $auth = false, array $roles = [], array $modules = []): void    { $this->add('GET',    $p, $h, $auth, $roles, $modules); }
    public function post(string $p, array $h, bool $auth = false, array $roles = [], array $modules = []): void   { $this->add('POST',   $p, $h, $auth, $roles, $modules); }
    public function put(string $p, array $h, bool $auth = false, array $roles = [], array $modules = []): void    { $this->add('PUT',    $p, $h, $auth, $roles, $modules); }
    public function delete(string $p, array $h, bool $auth = false, array $roles = [], array $modules = []): void { $this->add('DELETE', $p, $h, $auth, $roles, $modules); }

    public function dispatch(): void
    {
        Auth::init();
        $method = $_SERVER['REQUEST_METHOD'];

        // Strip any subdirectory prefix before /api/
        // e.g. /atc_v2/public/api/auth/login → /api/auth/login
        $uri = strtok($_SERVER['REQUEST_URI'], '?') ?: '/';
        $uri = preg_replace('#^(?:/[^/]+)*/api/#', '/api/', $uri) ?: $uri;

        foreach ($this->routes as $route) {
            [$matched, $params] = $this->matchPath($route['path'], $uri);
            if (!$matched || $route['method'] !== $method) continue;

            if ($route['auth'] && !Auth::check()) Response::unauthorized('Authentication required');

            if (!empty($route['roles']) && !Auth::hasRole($route['roles'])) Response::forbidden('Insufficient permissions');

            if (!empty($route['modules'])) {
                $ok = false;
                foreach ($route['modules'] as $mod) { if (Auth::can($mod)) { $ok = true; break; } }
                if (!$ok) Response::forbidden('Module access denied');
            }

            if (in_array($method, ['POST','PUT','PATCH','DELETE'], true) && Auth::check()) Auth::requireCsrf();

            $body = [];
            if (in_array($method, ['POST','PUT','PATCH'], true)) {
                $ct = $_SERVER['CONTENT_TYPE'] ?? '';
                if (!str_contains($ct, 'multipart/form-data') && !str_contains($ct, 'application/x-www-form-urlencoded')) {
                    $raw  = file_get_contents('php://input');
                    $body = $raw !== '' ? (json_decode($raw, true) ?? []) : [];
                }
            }

            [$class, $action] = $route['handler'];
            (new $class())->$action($params, $body, $_GET);
            return;
        }
        Response::notFound("Route {$method} {$uri} not found");
    }

    private function matchPath(string $pattern, string $uri): array
    {
        $regex = preg_replace('/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/', '(?P<$1>[^/]+)', $pattern);
        if (preg_match('#^' . $regex . '$#', $uri, $m)) {
            return [true, array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY)];
        }
        return [false, []];
    }
}
