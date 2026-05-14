-- NiceHash - ajuste de planes, comisiones y mínimo de inversión
-- Ejecutar una sola vez en producción después de desplegar backend/frontend.

BEGIN;

-- 1) Planes de minería: mínimo 3 USDT y porcentajes nuevos.
INSERT INTO public.mining_plans (level, name, min_amount, max_amount, daily_percent, duration_hours, window_days, is_active, created_at, updated_at)
VALUES
  (1, 'NiceHash-1', 3.00,     100.00,   8.000000,  24, 120, true, NOW(), NOW()),
  (2, 'NiceHash-2', 100.00,   300.00,   8.500000,  24, 120, true, NOW(), NOW()),
  (3, 'NiceHash-3', 300.00,   800.00,   9.000000,  24, 120, true, NOW(), NOW()),
  (4, 'NiceHash-4', 800.00,   1500.00,  10.000000, 24, 120, true, NOW(), NOW()),
  (5, 'NiceHash-5', 1500.00,  4000.00,  11.000000, 24, 120, true, NOW(), NOW()),
  (6, 'NiceHash-6', 4000.00,  8000.00,  12.000000, 24, 120, true, NOW(), NOW()),
  (7, 'NiceHash-7', 8000.00,  15000.00, 13.000000, 24, 120, true, NOW(), NOW()),
  (8, 'NiceHash-8', 15000.00, NULL,     14.000000, 24, 120, true, NOW(), NOW())
ON CONFLICT (level) DO UPDATE SET
  name = EXCLUDED.name,
  min_amount = EXCLUDED.min_amount,
  max_amount = EXCLUDED.max_amount,
  daily_percent = EXCLUDED.daily_percent,
  duration_hours = EXCLUDED.duration_hours,
  window_days = EXCLUDED.window_days,
  is_active = true,
  updated_at = NOW();

-- 2) VIP packages de compatibilidad. Se alinean al mínimo de cada nivel.
-- Si tu frontend ya usa mining_plans, esto igual mantiene tareas/compatibilidad sin datos viejos.
UPDATE public.vip_packages SET
  name = CASE level
    WHEN 1 THEN 'NiceHash-1' WHEN 2 THEN 'NiceHash-2' WHEN 3 THEN 'NiceHash-3' WHEN 4 THEN 'NiceHash-4'
    WHEN 5 THEN 'NiceHash-5' WHEN 6 THEN 'NiceHash-6' WHEN 7 THEN 'NiceHash-7' WHEN 8 THEN 'NiceHash-8' ELSE name END,
  price_usdt = CASE level
    WHEN 1 THEN 3.00 WHEN 2 THEN 100.00 WHEN 3 THEN 300.00 WHEN 4 THEN 800.00
    WHEN 5 THEN 1500.00 WHEN 6 THEN 4000.00 WHEN 7 THEN 8000.00 WHEN 8 THEN 15000.00 ELSE price_usdt END,
  daily_income_usdt = CASE level
    WHEN 1 THEN 0.24 WHEN 2 THEN 8.50 WHEN 3 THEN 27.00 WHEN 4 THEN 80.00
    WHEN 5 THEN 165.00 WHEN 6 THEN 480.00 WHEN 7 THEN 1040.00 WHEN 8 THEN 2100.00 ELSE daily_income_usdt END,
  task_reward_usdt = CASE level
    WHEN 1 THEN 0.24 WHEN 2 THEN 8.50 WHEN 3 THEN 27.00 WHEN 4 THEN 80.00
    WHEN 5 THEN 165.00 WHEN 6 THEN 480.00 WHEN 7 THEN 1040.00 WHEN 8 THEN 2100.00 ELSE task_reward_usdt END,
  valid_days = 120,
  is_purchasable = true
WHERE level BETWEEN 1 AND 8;

-- Si la tabla estaba vacía, inserta paquetes base.
INSERT INTO public.vip_packages (level, name, price_usdt, daily_income_usdt, task_reward_usdt, task_cooldown_minutes, valid_days, is_purchasable, created_at)
VALUES
  (1, 'NiceHash-1', 3.00,     0.24,    0.24,    1440, 120, true, NOW()),
  (2, 'NiceHash-2', 100.00,   8.50,    8.50,    1440, 120, true, NOW()),
  (3, 'NiceHash-3', 300.00,   27.00,   27.00,   1440, 120, true, NOW()),
  (4, 'NiceHash-4', 800.00,   80.00,   80.00,   1440, 120, true, NOW()),
  (5, 'NiceHash-5', 1500.00,  165.00,  165.00,  1440, 120, true, NOW()),
  (6, 'NiceHash-6', 4000.00,  480.00,  480.00,  1440, 120, true, NOW()),
  (7, 'NiceHash-7', 8000.00,  1040.00, 1040.00, 1440, 120, true, NOW()),
  (8, 'NiceHash-8', 15000.00, 2100.00, 2100.00, 1440, 120, true, NOW())
ON CONFLICT (level) DO NOTHING;

COMMIT;
