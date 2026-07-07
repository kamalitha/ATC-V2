<?php
declare(strict_types=1);

class Validator
{
    private array $errors = [];
    private array $data;

    private function __construct(array $data)
    {
        $this->data = $data;
    }

    public static function make(array $data): static
    {
        return new static($data);
    }

    // ── Rules ─────────────────────────────────────────────────────────────────

    public function required(string ...$fields): static
    {
        foreach ($fields as $field) {
            $val = $this->data[$field] ?? null;
            if ($val === null || $val === '' || (is_string($val) && trim($val) === '')) {
                $this->errors[$field][] = ucfirst(str_replace('_', ' ', $field)) . ' is required';
            }
        }
        return $this;
    }

    public function email(string $field): static
    {
        $val = $this->data[$field] ?? '';
        if ($val !== '' && !filter_var($val, FILTER_VALIDATE_EMAIL)) {
            $this->errors[$field][] = 'Must be a valid email address';
        }
        return $this;
    }

    public function min(string $field, int $min): static
    {
        $val = $this->data[$field] ?? '';
        if (strlen((string)$val) < $min) {
            $this->errors[$field][] = "Must be at least {$min} characters";
        }
        return $this;
    }

    public function max(string $field, int $max): static
    {
        $val = $this->data[$field] ?? '';
        if (strlen((string)$val) > $max) {
            $this->errors[$field][] = "Must not exceed {$max} characters";
        }
        return $this;
    }

    public function in(string $field, array $allowed): static
    {
        $val = $this->data[$field] ?? null;
        if ($val !== null && $val !== '' && !in_array($val, $allowed, strict: true)) {
            $this->errors[$field][] = 'Invalid value — allowed: ' . implode(', ', $allowed);
        }
        return $this;
    }

    public function numeric(string $field): static
    {
        $val = $this->data[$field] ?? '';
        if ($val !== '' && !is_numeric($val)) {
            $this->errors[$field][] = 'Must be a numeric value';
        }
        return $this;
    }

    public function integer(string $field): static
    {
        $val = $this->data[$field] ?? '';
        if ($val !== '' && !filter_var($val, FILTER_VALIDATE_INT)) {
            $this->errors[$field][] = 'Must be an integer';
        }
        return $this;
    }

    public function date(string $field, string $format = 'Y-m-d'): static
    {
        $val = $this->data[$field] ?? '';
        if ($val !== '') {
            $d = \DateTime::createFromFormat($format, $val);
            if (!$d || $d->format($format) !== $val) {
                $this->errors[$field][] = "Must be a valid date ({$format})";
            }
        }
        return $this;
    }

    public function url(string $field): static
    {
        $val = $this->data[$field] ?? '';
        if ($val !== '' && !filter_var($val, FILTER_VALIDATE_URL)) {
            $this->errors[$field][] = 'Must be a valid URL';
        }
        return $this;
    }

    public function regex(string $field, string $pattern, string $message = 'Invalid format'): static
    {
        $val = $this->data[$field] ?? '';
        if ($val !== '' && !preg_match($pattern, (string)$val)) {
            $this->errors[$field][] = $message;
        }
        return $this;
    }

    /** Custom rule — callback receives ($value) and returns string|null error message */
    public function custom(string $field, callable $fn): static
    {
        $val = $this->data[$field] ?? null;
        $err = $fn($val);
        if ($err !== null) {
            $this->errors[$field][] = $err;
        }
        return $this;
    }

    // ── Results ───────────────────────────────────────────────────────────────

    public function fails(): bool { return !empty($this->errors); }

    public function errors(): array { return $this->errors; }

    /** Abort with 422 if validation fails */
    public function validate(): static
    {
        if ($this->fails()) {
            Response::validationError($this->errors);
        }
        return $this;
    }

    public function get(string $field, mixed $default = null): mixed
    {
        $val = $this->data[$field] ?? $default;
        return is_string($val) ? trim($val) : $val;
    }

    /** Return only the specified keys */
    public function only(string ...$fields): array
    {
        return array_intersect_key($this->data, array_flip($fields));
    }

    /** Return all fields, trimming strings */
    public function all(): array
    {
        return array_map(fn($v) => is_string($v) ? trim($v) : $v, $this->data);
    }

    /** Return int-cast value */
    public function int(string $field, int $default = 0): int
    {
        return (int)($this->data[$field] ?? $default);
    }

    /** Return float-cast value */
    public function float(string $field, float $default = 0.0): float
    {
        return (float)($this->data[$field] ?? $default);
    }

    public function bool(string $field, bool $default = false): bool
    {
        $val = $this->data[$field] ?? null;
        if ($val === null) return $default;
        return filter_var($val, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $default;
    }
}
