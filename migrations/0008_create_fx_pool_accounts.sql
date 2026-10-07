INSERT INTO users (name, email, password_hash)
VALUES ('FX Pool', 'fx-pool@system.internal', '!login-disabled')
ON CONFLICT (email) DO NOTHING;

INSERT INTO accounts (user_id, currency)
SELECT u.id, c.currency
FROM users u
CROSS JOIN (VALUES ('NGN'), ('CAD')) AS c(currency)
WHERE u.email = 'fx-pool@system.internal'
ON CONFLICT (user_id, currency) DO NOTHING;