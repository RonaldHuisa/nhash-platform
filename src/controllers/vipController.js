const pool = require("../config/db");



const {
    createReferralCommissions,
} = require("../services/referralCommissionService");


async function getCurrentTaskPeriod(pool) {
    const result = await pool.query(`
        WITH lima_time AS (
            SELECT 
                NOW() AS now_utc,
                NOW() AT TIME ZONE 'America/Lima' AS now_lima
        ),
        current_period AS (
            SELECT
                CASE
                    WHEN now_lima::time >= TIME '09:00'
                    THEN (date_trunc('day', now_lima) + INTERVAL '9 hours') AT TIME ZONE 'America/Lima'
                    ELSE (date_trunc('day', now_lima) - INTERVAL '15 hours') AT TIME ZONE 'America/Lima'
                END AS period_start
            FROM lima_time
        )
        SELECT
            period_start,
            period_start + INTERVAL '1 day' AS period_end,
            NOW() AS server_now
        FROM current_period
    `);

    return result.rows[0];
}

function getAuthUserId(req) {
    return req.user.userId || req.user.id;
}

async function getVipStatus(req, res) {
    try {
        const userId = getAuthUserId(req);

        const userResult = await pool.query(
            `
            SELECT 
                id,
                balance_usdt,
                withdrawable_usdt,
                vip_level,
                vip_expires_at
            FROM users
            WHERE id = $1
            `,
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                message: "Usuario no encontrado.",
            });
        }

        const user = userResult.rows[0];

        // Periodo actual: desde las 9:00 AM Perú hasta las 9:00 AM del día siguiente
        const period = await getCurrentTaskPeriod(pool);

        // Ganancias hechas en el periodo actual
        const todayIncomeResult = await pool.query(
            `
            SELECT 
                COALESCE(SUM(reward_usdt), 0) AS today_income_usdt
            FROM vip_daily_tasks
            WHERE user_id = $1
            AND status = 'completed'
            AND period_start >= $2
            AND period_start < $3
            `,
            [userId, period.period_start, period.period_end]
        );

        const packagesResult = await pool.query(
            `
            SELECT 
                id,
                level,
                name,
                price_usdt,
                daily_income_usdt,
                valid_days,
                is_purchasable,
                COALESCE(task_reward_usdt, daily_income_usdt) AS task_reward_usdt,
                COALESCE(task_cooldown_minutes,
                    CASE level
                        WHEN 1 THEN 360
                        WHEN 2 THEN 360
                        WHEN 3 THEN 300
                        WHEN 4 THEN 240
                        WHEN 5 THEN 180
                        ELSE 1440
                    END
                ) AS task_cooldown_minutes
            FROM vip_packages
            ORDER BY level ASC
            `
        );

        const activePurchasesResult = await pool.query(
            `
            SELECT 
                package_id,
                level,
                expires_at,
                status
            FROM vip_purchases
            WHERE user_id = $1
            AND status = 'active'
            AND expires_at > NOW()
            `,
            [userId]
        );

        const activeMap = new Map();

        activePurchasesResult.rows.forEach((purchase) => {
            activeMap.set(Number(purchase.level), purchase);
        });

        const packages = packagesResult.rows.map((pkg) => {
            const active = activeMap.get(Number(pkg.level));

            return {
                id: pkg.id,
                level: Number(pkg.level),
                name: pkg.name,
                priceUsdt: pkg.price_usdt,
                dailyIncomeUsdt: pkg.daily_income_usdt,
                taskRewardUsdt: pkg.task_reward_usdt,
                taskCooldownMinutes: Number(pkg.task_cooldown_minutes),
                validDays: Number(pkg.valid_days),
                isPurchasable: pkg.is_purchasable,
                isActive: Boolean(active),
                expiresAt: active ? active.expires_at : null,
            };
        });

        return res.json({
            user,
            rechargeBalanceUsdt: user.balance_usdt,
            earningsBalanceUsdt: user.withdrawable_usdt,
            todayIncomeUsdt: todayIncomeResult.rows[0].today_income_usdt,
            vipLevel: Number(user.vip_level || 0),
            vipExpiresAt: user.vip_expires_at,
            currentPeriod: {
                periodStart: period.period_start,
                periodEnd: period.period_end,
                serverNow: period.server_now,
            },
            packages,
        });
    } catch (error) {
        console.error("GET VIP STATUS ERROR:", error);

        return res.status(500).json({
            message: "Error al obtener información VIP.",
            detail: error.message,
        });
    }
}

async function buyVipPackage(req, res) {
    const userId = getAuthUserId(req);
    const { level } = req.body;

    if (level === undefined || level === null || level === "") {
        return res.status(400).json({
            message: "Selecciona un paquete VIP.",
        });
    }

    const numericLevel = Number(level);

    if (!Number.isInteger(numericLevel) || numericLevel < 0) {
        return res.status(400).json({
            message: "Nivel VIP inválido.",
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const packageResult = await client.query(
            `
            SELECT 
                id,
                level,
                name,
                price_usdt,
                daily_income_usdt,
                valid_days,
                is_purchasable,
                COALESCE(task_reward_usdt, daily_income_usdt) AS task_reward_usdt,
                COALESCE(task_cooldown_minutes,
                    CASE level
                        WHEN 1 THEN 360
                        WHEN 2 THEN 360
                        WHEN 3 THEN 300
                        WHEN 4 THEN 240
                        WHEN 5 THEN 180
                        ELSE 1440
                    END
                ) AS task_cooldown_minutes
            FROM vip_packages
            WHERE level = $1
            `,
            [numericLevel]
        );

        if (packageResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                message: "Paquete VIP no encontrado.",
            });
        }

        const vipPackage = packageResult.rows[0];

        if (!vipPackage.is_purchasable) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "Este paquete VIP todavía no está disponible para compra.",
            });
        }

        const userResult = await client.query(
            `
            SELECT 
                id,
                balance_usdt
            FROM users
            WHERE id = $1
            FOR UPDATE
            `,
            [userId]
        );

        if (userResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                message: "Usuario no encontrado.",
            });
        }

        const user = userResult.rows[0];
        const balance = Number(user.balance_usdt || 0);
        const price = Number(vipPackage.price_usdt);

        if (balance < price) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "Saldo insuficiente. Por favor recarga primero.",
            });
        }

        const activeSamePackage = await client.query(
            `
            SELECT id
            FROM vip_purchases
            WHERE user_id = $1
            AND level = $2
            AND status = 'active'
            AND expires_at > NOW()
            LIMIT 1
            `,
            [userId, vipPackage.level]
        );

        if (activeSamePackage.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Ya tienes activo este paquete VIP.",
            });
        }

        const purchaseResult = await client.query(
            `
            INSERT INTO vip_purchases
            (
                user_id,
                package_id,
                level,
                price_usdt,
                daily_income_usdt,
                purchased_at,
                expires_at,
                status
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                NOW(),
                NOW() + ($6::int * INTERVAL '1 day'),
                'active'
            )
            RETURNING *
            `,
            [
                userId,
                vipPackage.id,
                vipPackage.level,
                vipPackage.price_usdt,
                vipPackage.daily_income_usdt,
                vipPackage.valid_days,
            ]
        );

        const purchase = purchaseResult.rows[0];

        await client.query(
            `
            UPDATE users
            SET 
                balance_usdt = balance_usdt - $1,
                vip_level = GREATEST(COALESCE(vip_level, 0), $2),
                vip_expires_at = CASE
                    WHEN vip_expires_at IS NULL OR vip_expires_at < $3
                    THEN $3
                    ELSE vip_expires_at
                END
            WHERE id = $4
            `,
            [
                vipPackage.price_usdt,
                vipPackage.level,
                purchase.expires_at,
                userId,
            ]
        );

        await client.query(
            `
                INSERT INTO account_ledger
                (
                    user_id,
                    balance_type,
                    direction,
                    type,
                    title,
                    amount_usdt,
                    description,
                    reference_type,
                    reference_id,
                    metadata,
                    status
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
                ON CONFLICT DO NOTHING
                `,
            [
                userId,
                "recharge",
                "debit",
                "vip_purchase",
                `Compra de ${vipPackage.name}`,
                vipPackage.price_usdt,
                `Compra del paquete ${vipPackage.name} por ${vipPackage.price_usdt} USDT.`,
                "vip_purchase",
                purchase.id,
                JSON.stringify({
                    vipLevel: vipPackage.level,
                    packageId: vipPackage.id,
                    validDays: vipPackage.valid_days,
                    expiresAt: purchase.expires_at,
                }),
                "completed",
            ]
        );

        await createReferralCommissions(
            client,
            userId,
            "vip_purchase",
            purchase.id,
            vipPackage.price_usdt
        );

        await client.query("COMMIT");

        return res.status(201).json({
            message: "Compra VIP realizada correctamente.",
            purchase,
        });
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("BUY VIP PACKAGE ERROR:", error);

        return res.status(500).json({
            message: "Error al comprar VIP.",
            detail: error.message,
        });
    } finally {
        client.release();
    }
}




module.exports = {
    getVipStatus,
    buyVipPackage,
};