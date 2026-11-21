-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.order_items, pg_temp.orders,
    pg_temp.products, pg_temp.customers CASCADE;

CREATE TEMP TABLE customers (id integer PRIMARY KEY, name text NOT NULL);
CREATE TEMP TABLE orders (
    id integer PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers(id),
    ordered_at timestamp NOT NULL,
    delivery_address text NOT NULL
);
CREATE TEMP TABLE products (
    id integer PRIMARY KEY, name text NOT NULL,
    current_price numeric(10, 2) NOT NULL CHECK (current_price >= 0)
);
CREATE TEMP TABLE order_items (
    id integer PRIMARY KEY,
    order_id integer NOT NULL REFERENCES orders(id),
    product_id integer NOT NULL REFERENCES products(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    purchase_price numeric(10, 2) NOT NULL CHECK (purchase_price >= 0),
    UNIQUE (order_id, product_id)
);
INSERT INTO customers VALUES (1, 'Анна'), (2, 'Борис');
INSERT INTO orders VALUES
    (10, 1, '2026-11-20 12:00', 'ул. Лесная, 1'),
    (11, 1, '2026-11-21 15:00', 'ул. Садовая, 5');
INSERT INTO products VALUES
    (20, 'Блокнот', 120.00), (21, 'Ручка', 50.00), (22, 'Пенал', 300.00);
INSERT INTO order_items VALUES
    (1, 10, 20, 2, 100.00),
    (2, 10, 21, 1, 50.00),
    (3, 11, 20, 1, 120.00);

-- 1:N: у Анны два заказа с разными адресами; у Бориса заказов нет.
SELECT c.name, o.id AS order_id, o.ordered_at, o.delivery_address
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
ORDER BY c.id, o.id;

-- M:N: в заказе 10 два товара; блокнот есть в обоих заказах.
SELECT o.id AS order_id, p.name, x.quantity, x.purchase_price,
       x.quantity * x.purchase_price AS line_total
FROM orders o
JOIN order_items x ON x.order_id = o.id
JOIN products p ON p.id = x.product_id
ORDER BY o.id, p.id;

-- До изменения каталога: заказ 10 = 250.00, заказ 11 = 120.00.
SELECT order_id, sum(quantity * purchase_price) AS total
FROM order_items GROUP BY order_id ORDER BY order_id;

-- Новая цена каталога не меняет уже оформленные покупки.
UPDATE products SET current_price = 150.00 WHERE id = 20;
SELECT p.name, p.current_price, x.order_id, x.purchase_price
FROM products p JOIN order_items x ON x.product_id = p.id
WHERE p.id = 20 ORDER BY x.order_id;

-- После изменения: те же суммы 250.00 и 120.00.
SELECT order_id, sum(quantity * purchase_price) AS total
FROM order_items GROUP BY order_id ORDER BY order_id;
