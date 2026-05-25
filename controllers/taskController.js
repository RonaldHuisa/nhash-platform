const pool = require("../config/db");

function getAuthUserId(req) {
    return req.user.userId || req.user.id;
}

const DEFAULT_TASK_CONFIG = {
    1: { rewardUsdt: "0.25", cooldownMinutes: 360 },
    2: { rewardUsdt: "0.50", cooldownMinutes: 360 },
    3: { rewardUsdt: "1.00", cooldownMinutes: 300 },
    4: { rewardUsdt: "2.00", cooldownMinutes: 240 },
    5: { rewardUsdt: "5.00", cooldownMinutes: 180 },
};

function getDefaultTaskConfig(level) {
    return DEFAULT_TASK_CONFIG[Number(level)] || {
        rewardUsdt: "0.00",
        cooldownMinutes: 1440,
    };
}

function normalizeTask(row) {
    const fallback = getDefaultTaskConfig(row.vip_level);
    const cooldownMinutes = Number(row.task_cooldown_minutes || fallback.cooldownMinutes);
    const rewardUsdt = row.task_reward_usdt || fallback.rewardUsdt;
    const nextAvailableAt = row.next_available_at || null;
    const serverNow = row.server_now || null;
    const status = row.task_status;

    return {
        id: row.vip_purchase_id,
        vipPurchaseId: row.vip_purchase_id,
        vipLevel: Number(row.vip_level),
        title: row.package_name || `TIGGO Nivel ${row.vip_level}`,
        packageName: row.package_name || `TIGGO Nivel ${row.vip_level}`,
        rewardUsdt,
        taskRewardUsdt: rewardUsdt,
        cooldownMinutes,
        cooldownLabel: buildCooldownLabel(cooldownMinutes),
        expiresAt: row.expires_at,
        lastCompletedAt: row.last_completed_at,
        nextAvailableAt,
        serverNow,
        status,
        isAvailable: status === "available",
    };
}

function buildCooldownLabel(minutes) {
    const value = Number(minutes || 0);

    if (value <= 0) return "Disponible";

    if (value % 60 === 0) {
        const hours = value / 60;
        return `${hours} ${hours === 1 ? "hora" : "horas"}`;
    }

    return `${value} minutos`;
}

async function getTasksDashboard(req, res) {
    const userId = getAuthUserId(req);

    const client = await pool.connect();

    try {
        const userResult = await client.query(
            `
            SELECT 
                id,
                email,
                COALESCE(balance_usdt, 0) AS balance_usdt,
                COALESCE(withdrawable_usdt, 0) AS withdrawable_usdt
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

        const tasksResult = await client.query(
            `
            SELECT
                vp.id AS vip_purchase_id,
                vp.level AS vip_level,
                vp.expires_at,
                p.name AS package_name,
                COALESCE(p.task_reward_usdt, vp.daily_income_usdt, 0) AS task_reward_usdt,
                COALESCE(p.task_cooldown_minutes,
                    CASE vp.level
                        WHEN 1 THEN 360
                        WHEN 2 THEN 360
                        WHEN 3 THEN 300
                        WHEN 4 THEN 240
                        WHEN 5 THEN 180
                        ELSE 1440
                    END
                ) AS task_cooldown_minutes,
                last_task.completed_at AS last_completed_at,
                last_task.period_end AS next_available_at,
                NOW() AS server_now,
                CASE
                    WHEN last_task.id IS NULL THEN 'available'
                    WHEN last_task.period_end <= NOW() THEN 'available'
                    ELSE 'cooldown'
                END AS task_status
            FROM vip_purchases vp
            JOIN vip_packages p ON p.id = vp.package_id
            LEFT JOIN LATERAL (
                SELECT
                    id,
                    completed_at,
                    period_end
                FROM vip_daily_tasks
                WHERE vip_purchase_id = vp.id
                  AND user_id = vp.user_id
                  AND status = 'completed'
                ORDER BY completed_at DESC NULLS LAST, id DESC
                LIMIT 1
            ) last_task ON TRUE
            WHERE vp.user_id = $1
              AND vp.status = 'active'
              AND vp.expires_at > NOW()
            ORDER BY vp.level ASC, vp.id ASC
            `,
            [userId]
        );

        const tasks = tasksResult.rows.map(normalizeTask);

        const totalTasks = tasks.length;
        const availableTasks = tasks.filter((task) => task.status === "available").length;
        const cooldownTasks = tasks.filter((task) => task.status === "cooldown").length;

        const nearestNextAvailableAt = tasks
            .filter((task) => task.status === "cooldown" && task.nextAvailableAt)
            .map((task) => new Date(task.nextAvailableAt).getTime())
            .sort((a, b) => a - b)[0];

        return res.json({
            user: userResult.rows[0],
            withdrawableBalanceUsdt: userResult.rows[0].withdrawable_usdt,
            serverNow: new Date().toISOString(),
            nextResetAt: nearestNextAvailableAt ? new Date(nearestNextAvailableAt).toISOString() : null,
            totalTasks,
            completedTasks: cooldownTasks,
            availableTasks,
            pendingTasks: availableTasks,
            cooldownTasks,
            tasks,
        });
    } catch (error) {
        console.error("GET TASKS DASHBOARD ERROR:", error);

        return res.status(500).json({
            message: "Error al cargar tareas.",
            detail: error.message,
        });
    } finally {
        client.release();
    }
}

async function completeVipTask(req, res) {
    const userId = getAuthUserId(req);
    const { vipPurchaseId } = req.params;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const vipResult = await client.query(
            `
            SELECT 
                vp.id,
                vp.user_id,
                vp.level,
                vp.expires_at,
                vp.status,
                p.name AS package_name,
                COALESCE(p.task_reward_usdt, vp.daily_income_usdt, 0) AS task_reward_usdt,
                COALESCE(p.task_cooldown_minutes,
                    CASE vp.level
                        WHEN 1 THEN 360
                        WHEN 2 THEN 360
                        WHEN 3 THEN 300
                        WHEN 4 THEN 240
                        WHEN 5 THEN 180
                        ELSE 1440
                    END
                ) AS task_cooldown_minutes
            FROM vip_purchases vp
            JOIN vip_packages p ON p.id = vp.package_id
            WHERE vp.id = $1
              AND vp.user_id = $2
            FOR UPDATE OF vp
            `,
            [vipPurchaseId, userId]
        );

        if (vipResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "TIGGO AI no encontrado.",
            });
        }

        const vip = vipResult.rows[0];

        if (vip.status !== "active" || new Date(vip.expires_at) <= new Date()) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "Este TIGGO AI no está activo.",
            });
        }

        const lastTaskResult = await client.query(
            `
            SELECT
                id,
                completed_at,
                period_end
            FROM vip_daily_tasks
            WHERE user_id = $1
              AND vip_purchase_id = $2
              AND status = 'completed'
            ORDER BY completed_at DESC NULLS LAST, id DESC
            LIMIT 1
            `,
            [userId, vip.id]
        );

        const lastTask = lastTaskResult.rows[0];

        if (lastTask && new Date(lastTask.period_end) > new Date()) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "Esta misión todavía está en espera. Podrás completarla cuando termine el contador.",
                nextAvailableAt: lastTask.period_end,
            });
        }

        const taskResult = await client.query(
            `
            INSERT INTO vip_daily_tasks
            (
                user_id,
                vip_purchase_id,
                vip_level,
                period_start,
                period_end,
                reward_usdt,
                status,
                completed_at
            )
            VALUES (
                $1,
                $2,
                $3,
                NOW(),
                NOW() + ($5::int * INTERVAL '1 minute'),
                $4,
                'completed',
                NOW()
            )
            RETURNING id, reward_usdt, period_start, period_end, completed_at
            `,
            [
                userId,
                vip.id,
                vip.level,
                vip.task_reward_usdt,
                vip.task_cooldown_minutes,
            ]
        );

        const task = taskResult.rows[0];

        await client.query(
            `
            UPDATE users
            SET withdrawable_usdt = COALESCE(withdrawable_usdt, 0) + $1
            WHERE id = $2
            `,
            [task.reward_usdt, userId]
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::json, $11)
            ON CONFLICT DO NOTHING
            `,
            [
                userId,
                "earnings",
                "credit",
                "task_income",
                `Ganancia de misión ${vip.package_name}`,
                task.reward_usdt,
                `Ganancia por completar misión de ${vip.package_name}. Próxima misión disponible luego de ${vip.task_cooldown_minutes} minutos.`,
                "vip_daily_task",
                task.id,
                JSON.stringify({
                    vipPurchaseId: vip.id,
                    vipLevel: vip.level,
                    packageName: vip.package_name,
                    taskCooldownMinutes: vip.task_cooldown_minutes,
                    nextAvailableAt: task.period_end,
                }),
                "completed",
            ]
        );

        await client.query("COMMIT");

        return res.json({
            message: `Misión completada. Ganaste ${Number(task.reward_usdt).toFixed(2)} USDT.`,
            rewardUsdt: task.reward_usdt,
            completedAt: task.completed_at,
            nextAvailableAt: task.period_end,
            cooldownMinutes: Number(vip.task_cooldown_minutes),
        });
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("COMPLETE VIP TASK ERROR:", error);

        return res.status(500).json({
            message: "Error al completar misión.",
            detail: error.message,
        });
    } finally {
        client.release();
    }
}

module.exports = {
    getTasksDashboard,
    completeVipTask,
};
