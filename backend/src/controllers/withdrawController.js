const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { sendUsdtWithdrawal } = require("../services/withdrawPaymentService");
const {
    getPaymentNetwork,
    listPaymentNetworks,
    getNetworkMinWithdraw,
    getNetworkWithdrawFeePercent,
    isValidEvmAddress,
} = require("../utils/paymentNetworks");

const WITHDRAW_FEE_PERCENT = 8;
const MIN_WITHDRAW_USDT = 1;
const AUTO_WITHDRAW_MAX_USDT = Number(process.env.AUTO_WITHDRAW_MAX_USDT || 20);


const WITHDRAW_DAY_NAMES = {
    0: "domingo",
    1: "lunes",
    2: "martes",
    3: "miércoles",
    4: "jueves",
    5: "viernes",
    6: "sábado",
};

const WITHDRAW_SCHEDULE_BY_LEVEL = [
    { min: 1, max: 2, days: [1, 4], label: "lunes y jueves" },
    { min: 3, max: 4, days: [2, 5], label: "martes y viernes" },
    { min: 5, max: Infinity, days: [3, 6], label: "miércoles y sábado" },
];

function getLimaWeekday(date = new Date()) {
    const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Lima",
        weekday: "short",
    }).format(date);

    const map = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };

    return map[weekday] ?? date.getDay();
}

function getWithdrawScheduleForVipLevel(vipLevel) {
    const level = Number(vipLevel || 0);

    return WITHDRAW_SCHEDULE_BY_LEVEL.find(
        (item) => level >= item.min && level <= item.max
    ) || null;
}

function getNextWithdrawDayLabel(allowedDays, todayDow) {
    if (!Array.isArray(allowedDays) || allowedDays.length === 0) return "";

    const sortedDays = [...allowedDays].sort((a, b) => a - b);
    const nextDow = sortedDays.find((day) => day > todayDow) ?? sortedDays[0];

    return WITHDRAW_DAY_NAMES[nextDow] || "";
}

function buildWithdrawDayPolicy(vipLevel, date = new Date()) {
    const level = Number(vipLevel || 0);
    const todayDow = getLimaWeekday(date);
    const schedule = getWithdrawScheduleForVipLevel(level);

    if (!schedule) {
        return {
            allowedToday: false,
            activeVipLevel: level,
            todayDow,
            todayName: WITHDRAW_DAY_NAMES[todayDow],
            allowedDays: [],
            allowedDaysLabel: "",
            nextWithdrawDay: "",
            message: "Necesitas un nivel NiceHash activo para solicitar retiros.",
        };
    }

    const allowedToday = schedule.days.includes(todayDow);
    const nextWithdrawDay = allowedToday
        ? WITHDRAW_DAY_NAMES[todayDow]
        : getNextWithdrawDayLabel(schedule.days, todayDow);

    return {
        allowedToday,
        activeVipLevel: level,
        todayDow,
        todayName: WITHDRAW_DAY_NAMES[todayDow],
        allowedDays: schedule.days,
        allowedDaysLabel: schedule.label,
        nextWithdrawDay,
        message: allowedToday
            ? `Tu nivel NiceHash-${level} permite retiros los ${schedule.label}.`
            : `Tu nivel NiceHash-${level} solo permite retiros los ${schedule.label}. Próximo día disponible: ${nextWithdrawDay}.`,
    };
}

const WITHDRAW_INVITE_POLICY = {
    requiredActiveInvites: 5,
    reductionPercent: 75,
    recoveredLimitByVipLevel: {
        1: 110,
        2: 80,
        default: 60,
    },
};

function isValidWithdrawalAddress(address, network) {
    // BEP20 y POLYGON usan direcciones EVM 0x...
    return isValidEvmAddress(address);
}

function toNumber(value) {
    return Number(value || 0);
}

function daysSince(dateValue) {
    if (!dateValue) return 0;

    const timestamp = new Date(dateValue).getTime();

    if (!Number.isFinite(timestamp)) return 0;

    return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

async function getActiveDirectInvitesCount(client, userId) {
    const result = await client.query(
        `
        SELECT COUNT(DISTINCT inv.id)::int AS active_direct_invites
        FROM users inv
        WHERE inv.referred_by_id = $1
        AND EXISTS (
            SELECT 1
            FROM vip_purchases vp
            WHERE vp.user_id = inv.id
              AND vp.status = 'active'
              AND vp.expires_at > NOW()
        )
        `,
        [userId]
    );

    return Number(result.rows[0]?.active_direct_invites || 0);
}

async function getWithdrawalPolicyTotals(client, userId) {
    const result = await client.query(
        `
        SELECT
            COALESCE((
                SELECT SUM(vp.price_usdt)
                FROM vip_purchases vp
                WHERE vp.user_id = $1
                  AND vp.status IN ('active', 'completed', 'expired')
                  AND COALESCE(vp.price_usdt, 0) > 0
            ), 0) AS total_vip_invested,
            COALESCE((
                SELECT SUM(w.amount_requested)
                FROM withdrawals w
                WHERE w.user_id = $1
                  AND w.status IN ('pending', 'approved', 'paid')
            ), 0) AS total_requested_before
        `,
        [userId]
    );

    return {
        totalVipInvested: Number(result.rows[0]?.total_vip_invested || 0),
        totalRequestedBefore: Number(result.rows[0]?.total_requested_before || 0),
    };
}

function getRecoveredLimitPercent(vipLevel) {
    const level = Number(vipLevel || 0);

    if (level === 1) return WITHDRAW_INVITE_POLICY.recoveredLimitByVipLevel[1];
    if (level === 2) return WITHDRAW_INVITE_POLICY.recoveredLimitByVipLevel[2];
    if (level >= 3) return WITHDRAW_INVITE_POLICY.recoveredLimitByVipLevel.default;

    return 0;
}

function buildWithdrawInvitePolicy({
    activeVipLevel,
    activeDirectInvites,
    totalVipInvested,
    totalRequestedBefore,
    currentAmountRequested = 0,
}) {
    const vipLevel = Number(activeVipLevel || 0);
    const recoveredLimitPercent = getRecoveredLimitPercent(vipLevel);
    const recoveredLimitAmount =
        Number(totalVipInvested || 0) * (recoveredLimitPercent / 100);

    const totalRequestedBeforeNumber = Number(totalRequestedBefore || 0);
    const totalRequestedIncludingCurrent =
        totalRequestedBeforeNumber + Number(currentAmountRequested || 0);

    const recoveredPercentBefore =
        Number(totalVipInvested || 0) > 0
            ? (totalRequestedBeforeNumber / Number(totalVipInvested || 0)) * 100
            : 0;

    const recoveredPercentIncludingCurrent =
        Number(totalVipInvested || 0) > 0
            ? (totalRequestedIncludingCurrent / Number(totalVipInvested || 0)) * 100
            : 0;

    const isVipEligibleForPolicy = vipLevel >= 1;
    const hasEnoughActiveInvites =
        Number(activeDirectInvites || 0) >= WITHDRAW_INVITE_POLICY.requiredActiveInvites;

    const reachedRecoveredLimit =
        isVipEligibleForPolicy &&
        Number(totalVipInvested || 0) > 0 &&
        totalRequestedIncludingCurrent >= recoveredLimitAmount;

    const applies =
        isVipEligibleForPolicy &&
        reachedRecoveredLimit &&
        !hasEnoughActiveInvites;

    return {
        applies,
        requiredActiveInvites: WITHDRAW_INVITE_POLICY.requiredActiveInvites,
        activeDirectInvites: Number(activeDirectInvites || 0),
        reductionPercent: WITHDRAW_INVITE_POLICY.reductionPercent,
        activeVipLevel: vipLevel,
        recoveredLimitPercent,
        recoveredLimitAmount,
        totalVipInvested: Number(totalVipInvested || 0),
        totalRequestedBefore: totalRequestedBeforeNumber,
        totalRequestedIncludingCurrent,
        recoveredPercentBefore,
        recoveredPercentIncludingCurrent,
        isVipEligibleForPolicy,
        hasEnoughActiveInvites,
        reachedRecoveredLimit,
        message: applies
            ? `Actualmente este retiro tiene una reducción del ${WITHDRAW_INVITE_POLICY.reductionPercent}%. Invita ${WITHDRAW_INVITE_POLICY.requiredActiveInvites} personas activas más y se quitará esta restricción. Podrás retirar el 100% con normalidad.`
            : "",
    };
}

function applyWithdrawInvitePolicy(amountToReceiveBeforePolicy, policy) {
    const baseAmount = Number(amountToReceiveBeforePolicy || 0);

    if (!policy?.applies) {
        return {
            policyReductionAmount: 0,
            amountToReceive: baseAmount,
        };
    }

    const policyReductionAmount =
        baseAmount * (Number(policy.reductionPercent || 0) / 100);

    return {
        policyReductionAmount,
        amountToReceive: baseAmount - policyReductionAmount,
    };
}


async function getCurrentWithdrawPeriod(client) {
    const result = await client.query(`
    WITH lima_time AS (
      SELECT 
        NOW() AS server_now,
        NOW() AT TIME ZONE 'America/Lima' AS now_lima
    ),
    reset_calc AS (
      SELECT
        server_now,
        now_lima,
        (now_lima::date + TIME '09:00') AS today_reset_lima
      FROM lima_time
    ),
    period_calc AS (
      SELECT
        server_now,
        CASE
          WHEN now_lima >= today_reset_lima
          THEN today_reset_lima
          ELSE today_reset_lima - INTERVAL '1 day'
        END AS period_start_lima,
        CASE
          WHEN now_lima >= today_reset_lima
          THEN today_reset_lima + INTERVAL '1 day'
          ELSE today_reset_lima
        END AS period_end_lima
      FROM reset_calc
    )
    SELECT
      period_start_lima AT TIME ZONE 'America/Lima' AS period_start,
      period_end_lima AT TIME ZONE 'America/Lima' AS period_end,
      server_now
    FROM period_calc
  `);

    return result.rows[0];
}




async function getWithdrawInfo(req, res) {
    try {
        const userId = req.user.userId;
        const paymentNetwork = getPaymentNetwork(req.query.network || "BEP20-USDT", {
            withdraw: true,
        });

        const result = await pool.query(
            `
            SELECT 
                u.id, 
                u.withdrawable_usdt, 
                CASE
                    WHEN $2 = 'BEP20-USDT' THEN COALESCE(uwa.withdrawal_address, u.withdrawal_address_bep20)
                    ELSE uwa.withdrawal_address
                END AS withdrawal_address,
                COALESCE((
                    SELECT MAX(vp.level)
                    FROM vip_purchases vp
                    WHERE vp.user_id = u.id
                      AND vp.status = 'active'
                      AND vp.expires_at > NOW()
                ), 0) AS active_vip_level,
                (
                    SELECT MIN(vp.purchased_at)
                    FROM vip_purchases vp
                    WHERE vp.user_id = u.id
                      AND vp.status IN ('active', 'completed', 'expired')
                ) AS first_vip_purchased_at,
                COALESCE(ma.invested_amount, u.balance_usdt, u.recharge_balance_usdt, 0) AS active_investment_usdt
            FROM users u
            LEFT JOIN mining_accounts ma
              ON ma.user_id = u.id
            LEFT JOIN user_withdrawal_addresses uwa
              ON uwa.user_id = u.id
             AND uwa.network = $2
            WHERE u.id = $1
            `,
            [userId, paymentNetwork.code]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Usuario no encontrado.",
            });
        }

        const user = result.rows[0];

        const activeDirectInvites = await getActiveDirectInvitesCount(pool, userId);
        const policyTotals = await getWithdrawalPolicyTotals(pool, userId);

        const withdrawalPolicy = buildWithdrawInvitePolicy({
            activeVipLevel: user.active_vip_level,
            activeDirectInvites,
            totalVipInvested: policyTotals.totalVipInvested,
            totalRequestedBefore: policyTotals.totalRequestedBefore,
            currentAmountRequested: 0,
        });

        const activeInvestmentUsdt = Number(user.active_investment_usdt || 0);
        const hasActiveInvestment = activeInvestmentUsdt >= 5;
        const withdrawDayPolicy = buildWithdrawDayPolicy(user.active_vip_level);
        const canWithdraw = hasActiveInvestment && withdrawDayPolicy.allowedToday;
        const withdrawRequirementMessage = !hasActiveInvestment
            ? "Debes invertir mínimo 5 USDT para habilitar los retiros."
            : withdrawDayPolicy.message;

        return res.json({
            available: user.withdrawable_usdt || "0",
            network: paymentNetwork.code,
            supportedNetworks: listPaymentNetworks().filter((item) => item.withdrawEnabled),
            feePercent: getNetworkWithdrawFeePercent(paymentNetwork),
            minWithdraw: getNetworkMinWithdraw(paymentNetwork),
            withdrawalAddress: user.withdrawal_address,
            addressLocked: Boolean(user.withdrawal_address),
            canWithdraw,
            withdrawalDayAllowed: withdrawDayPolicy.allowedToday,
            withdrawalDayPolicy: withdrawDayPolicy,
            hasActiveVip: hasActiveInvestment,
            hasActiveInvestment,
            activeInvestmentUsdt,
            activeVipLevel: Number(user.active_vip_level || 0),
            withdrawRequirementMessage,
            withdrawalPolicy,
        });
    } catch (error) {
        console.error("GET WITHDRAW INFO ERROR:", error);
        return res.status(500).json({
            message: "Error al obtener información de retiro.",
        });
    }
}


async function markAutoWithdrawalPaid(withdrawalId, userId, payment, withdrawal, client = pool) {
    await client.query(
        `
        UPDATE withdrawals
        SET
            status = 'paid',
            tx_hash = $1,
            approved_at = CURRENT_TIMESTAMP,
            paid_at = CURRENT_TIMESTAMP,
            admin_note = $2
        WHERE id = $3
        `,
        [
            payment.txHash,
            `Retiro automático pagado para monto menor o igual a ${AUTO_WITHDRAW_MAX_USDT} USDT.`,
            withdrawalId,
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
        `,
        [
            userId,
            "withdrawable",
            "debit",
            "withdrawal_paid",
            "Retiro automático pagado",
            -Number(withdrawal.amount_to_receive || 0),
            `Retiro automático pagado correctamente por ${withdrawal.amount_to_receive} USDT.`,
            "withdrawal",
            withdrawalId,
            JSON.stringify({
                withdrawal_id: withdrawalId,
                tx_hash: payment.txHash,
                network: withdrawal.network,
                withdrawal_address: withdrawal.withdrawal_address,
                amount_requested: withdrawal.amount_requested,
                amount_to_receive: withdrawal.amount_to_receive,
                auto_paid: true,
                auto_limit_usdt: AUTO_WITHDRAW_MAX_USDT,
            }),
            "completed",
        ]
    );
}

async function markAutoWithdrawalFailed(withdrawalId, errorMessage, client = pool) {
    await client.query(
        `
        UPDATE withdrawals
        SET
            status = 'pending',
            admin_note = $1
        WHERE id = $2
        `,
        [
            `Pago automático falló y quedó pendiente para aprobación manual: ${String(errorMessage || "").slice(0, 400)}`,
            withdrawalId,
        ]
    );
}

async function createWithdrawRequest(req, res) {
    const userId = req.user.userId;
    const { withdrawalAddress, amount, securityPassword, network } = req.body;
    const paymentNetwork = getPaymentNetwork(network || "BEP20-USDT", {
        withdraw: true,
    });
    const withdrawFeePercent = getNetworkWithdrawFeePercent(paymentNetwork);
    const minWithdrawUsdt = getNetworkMinWithdraw(paymentNetwork);

    const client = await pool.connect();

    try {
        if (!withdrawalAddress || !amount || !securityPassword) {
            return res.status(400).json({
                message: "Dirección, monto y contraseña de seguridad son obligatorios.",
            });
        }

        if (!isValidWithdrawalAddress(withdrawalAddress, paymentNetwork)) {
            return res.status(400).json({
                message: `La dirección de retiro para ${paymentNetwork.code} no es válida.`,
            });
        }

        const amountNumber = toNumber(amount);

        if (amountNumber < minWithdrawUsdt) {
            return res.status(400).json({
                message: `El monto mínimo de retiro para ${paymentNetwork.code} es ${minWithdrawUsdt} USDT.`,
            });
        }

        await client.query("BEGIN");

        const period = await getCurrentWithdrawPeriod(client);

        const existingWithdrawalResult = await client.query(
            `
            SELECT id, status, created_at
            FROM withdrawals
            WHERE user_id = $1
                AND created_at >= $2
                AND created_at < $3
                AND status IN ('pending', 'approved', 'paid', 'processing_auto')
            LIMIT 1
            `,
            [userId, period.period_start, period.period_end]
        );

        if (existingWithdrawalResult.rows.length > 0) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "Solo puedes realizar un retiro por reinicio diario.",
                nextResetAt: period.period_end,
            });
        }



        const userResult = await client.query(
            `
            SELECT 
                u.id, 
                u.password_hash AS password,
                u.withdrawable_usdt, 
                CASE
                    WHEN $2 = 'BEP20-USDT' THEN COALESCE(uwa.withdrawal_address, u.withdrawal_address_bep20)
                    ELSE uwa.withdrawal_address
                END AS withdrawal_address,
                COALESCE((
                    SELECT MAX(vp.level)
                    FROM vip_purchases vp
                    WHERE vp.user_id = u.id
                      AND vp.status = 'active'
                      AND vp.expires_at > NOW()
                ), 0) AS active_vip_level,
                (
                    SELECT MIN(vp.purchased_at)
                    FROM vip_purchases vp
                    WHERE vp.user_id = u.id
                      AND vp.status IN ('active', 'completed', 'expired')
                ) AS first_vip_purchased_at,
                COALESCE(ma.invested_amount, u.balance_usdt, u.recharge_balance_usdt, 0) AS active_investment_usdt
            FROM users u
            LEFT JOIN mining_accounts ma
              ON ma.user_id = u.id
            LEFT JOIN user_withdrawal_addresses uwa
              ON uwa.user_id = u.id
             AND uwa.network = $2
            WHERE u.id = $1
            FOR UPDATE OF u
            `,
            [userId, paymentNetwork.code]
        );

        if (userResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                message: "Usuario no encontrado.",
            });
        }

        const user = userResult.rows[0];

        if (Number(user.active_investment_usdt || 0) < 5) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "Debes invertir mínimo 5 USDT para habilitar los retiros.",
            });
        }

        const withdrawDayPolicy = buildWithdrawDayPolicy(user.active_vip_level);

        if (!withdrawDayPolicy.allowedToday) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: withdrawDayPolicy.message,
                withdrawalDayAllowed: false,
                withdrawalDayPolicy: withdrawDayPolicy,
            });
        }

        const passwordOk = await bcrypt.compare(securityPassword, user.password);

        if (!passwordOk) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "Contraseña de seguridad incorrecta.",
            });
        }

        const available = toNumber(user.withdrawable_usdt);

        if (amountNumber > available) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "Saldo disponible insuficiente.",
            });
        }

        const activeDirectInvites = await getActiveDirectInvitesCount(client, userId);
        const policyTotals = await getWithdrawalPolicyTotals(client, userId);

        const withdrawalPolicy = buildWithdrawInvitePolicy({
            activeVipLevel: user.active_vip_level,
            activeDirectInvites,
            totalVipInvested: policyTotals.totalVipInvested,
            totalRequestedBefore: policyTotals.totalRequestedBefore,
            currentAmountRequested: amountNumber,
        });

        const savedAddress = user.withdrawal_address;

        if (
            savedAddress &&
            savedAddress.toLowerCase() !== withdrawalAddress.toLowerCase()
        ) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "La dirección de retiro ya fue fijada y no puede cambiarse.",
            });
        }

        const feeAmount = amountNumber * (withdrawFeePercent / 100);
        const amountToReceiveBeforePolicy = amountNumber - feeAmount;
        const policyResult = applyWithdrawInvitePolicy(
            amountToReceiveBeforePolicy,
            withdrawalPolicy
        );
        const policyReductionAmount = policyResult.policyReductionAmount;
        const amountToReceive = policyResult.amountToReceive;

        if (!savedAddress) {
            await client.query(
                `
                INSERT INTO user_withdrawal_addresses
                (
                    user_id,
                    network,
                    withdrawal_address
                )
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id, network)
                DO UPDATE SET withdrawal_address = EXCLUDED.withdrawal_address,
                              updated_at = CURRENT_TIMESTAMP
                `,
                [userId, paymentNetwork.code, withdrawalAddress]
            );

            if (paymentNetwork.code === "BEP20-USDT") {
                await client.query(
                    `
                    UPDATE users
                    SET withdrawal_address_bep20 = $1
                    WHERE id = $2
                    `,
                    [withdrawalAddress, userId]
                );
            }
        }

        const shouldAutoPay = amountNumber <= AUTO_WITHDRAW_MAX_USDT;
        const initialWithdrawalStatus = shouldAutoPay ? "processing_auto" : "pending";

        const withdrawalResult = await client.query(
            `
                INSERT INTO withdrawals
                (
                    user_id,
                    network,
                    withdrawal_address,
                    amount_requested,
                    fee_percent,
                    fee_amount,
                    amount_to_receive,
                    status
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                RETURNING *
                `,
            [
                userId,
                paymentNetwork.code,
                withdrawalAddress,
                amountNumber,
                withdrawFeePercent,
                feeAmount,
                amountToReceive,
                initialWithdrawalStatus,
            ]
        );

        await client.query(
            `
            UPDATE users
            SET withdrawable_usdt = COALESCE(withdrawable_usdt, 0) - $1
            WHERE id = $2
            `,
            [amountNumber, userId]
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
            `,
            [
                userId,
                "withdrawable",
                "debit",
                "withdrawal_request",
                "Deducción por retiro",
                -amountNumber,
                `Solicitud de retiro creada por ${amountNumber} USDT.`,
                "withdrawal",
                withdrawalResult.rows[0].id,
                JSON.stringify({
                    withdrawal_id: withdrawalResult.rows[0].id,
                    withdrawal_address: withdrawalAddress,
                    network: paymentNetwork.code,
                    amount_requested: amountNumber,
                    fee_percent: withdrawFeePercent,
                    fee_amount: feeAmount,
                    policy_reduction_percent: withdrawalPolicy.applies
                        ? withdrawalPolicy.reductionPercent
                        : 0,
                    policy_reduction_amount: policyReductionAmount,
                    active_direct_invites: withdrawalPolicy.activeDirectInvites,
                    required_active_invites: withdrawalPolicy.requiredActiveInvites,
                    active_vip_level: withdrawalPolicy.activeVipLevel,
                    total_vip_invested: withdrawalPolicy.totalVipInvested,
                    total_requested_before: withdrawalPolicy.totalRequestedBefore,
                    total_requested_including_current: withdrawalPolicy.totalRequestedIncludingCurrent,
                    recovered_limit_percent: withdrawalPolicy.recoveredLimitPercent,
                    recovered_limit_amount: withdrawalPolicy.recoveredLimitAmount,
                    recovered_percent_including_current: withdrawalPolicy.recoveredPercentIncludingCurrent,
                    amount_to_receive_before_policy: amountToReceiveBeforePolicy,
                    amount_to_receive: amountToReceive,
                    auto_withdraw: shouldAutoPay,
                    auto_limit_usdt: AUTO_WITHDRAW_MAX_USDT,
                }),
                shouldAutoPay ? "processing" : "pending",
            ]
        );

        const newBalanceResult = await client.query(
            `
      SELECT 
        u.withdrawable_usdt, 
        CASE
                    WHEN $2 = 'BEP20-USDT' THEN COALESCE(uwa.withdrawal_address, u.withdrawal_address_bep20)
                    ELSE uwa.withdrawal_address
                END AS withdrawal_address
      FROM users u
      LEFT JOIN user_withdrawal_addresses uwa
        ON uwa.user_id = u.id
       AND uwa.network = $2
      WHERE u.id = $1
      `,
            [userId, paymentNetwork.code]
        );

        await client.query("COMMIT");

        const createdWithdrawal = withdrawalResult.rows[0];

        if (!shouldAutoPay) {
            return res.status(201).json({
                message: `Solicitud de retiro creada correctamente. Los retiros mayores a ${AUTO_WITHDRAW_MAX_USDT} USDT quedan pendientes de aprobación.`,
                withdrawal: createdWithdrawal,
                currentWithdrawable: newBalanceResult.rows[0].withdrawable_usdt,
                withdrawalAddress: newBalanceResult.rows[0].withdrawal_address,
                network: paymentNetwork.code,
                approvalRequired: true,
                autoPaid: false,
                autoWithdrawMaxUsdt: AUTO_WITHDRAW_MAX_USDT,
                withdrawalPolicy: {
                    ...withdrawalPolicy,
                    policyReductionAmount,
                    amountToReceiveBeforePolicy,
                    amountToReceive,
                },
            });
        }

        try {
            const payment = await sendUsdtWithdrawal(
                withdrawalAddress,
                amountToReceive,
                paymentNetwork.code
            );

            await markAutoWithdrawalPaid(createdWithdrawal.id, userId, payment, createdWithdrawal);

            return res.status(201).json({
                message: "Retiro automático pagado correctamente.",
                withdrawal: {
                    ...createdWithdrawal,
                    status: "paid",
                    tx_hash: payment.txHash,
                },
                currentWithdrawable: newBalanceResult.rows[0].withdrawable_usdt,
                withdrawalAddress: newBalanceResult.rows[0].withdrawal_address,
                network: paymentNetwork.code,
                txHash: payment.txHash,
                approvalRequired: false,
                autoPaid: true,
                autoWithdrawMaxUsdt: AUTO_WITHDRAW_MAX_USDT,
                withdrawalPolicy: {
                    ...withdrawalPolicy,
                    policyReductionAmount,
                    amountToReceiveBeforePolicy,
                    amountToReceive,
                },
            });
        } catch (paymentError) {
            console.error("AUTO WITHDRAW PAYMENT ERROR:", paymentError);

            await markAutoWithdrawalFailed(createdWithdrawal.id, paymentError.message);

            return res.status(201).json({
                message: "Solicitud creada. El pago automático no pudo completarse y quedó pendiente para aprobación manual.",
                detail: paymentError.message,
                withdrawal: {
                    ...createdWithdrawal,
                    status: "pending",
                },
                currentWithdrawable: newBalanceResult.rows[0].withdrawable_usdt,
                withdrawalAddress: newBalanceResult.rows[0].withdrawal_address,
                network: paymentNetwork.code,
                approvalRequired: true,
                autoPaid: false,
                autoFailed: true,
                autoWithdrawMaxUsdt: AUTO_WITHDRAW_MAX_USDT,
                withdrawalPolicy: {
                    ...withdrawalPolicy,
                    policyReductionAmount,
                    amountToReceiveBeforePolicy,
                    amountToReceive,
                },
            });
        }
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("CREATE WITHDRAW ERROR:", error);

        return res.status(500).json({
            message: "Error al crear solicitud de retiro.",
        });
    } finally {
        client.release();
    }
}

async function getMyTransactions(req, res) {
    try {
        const userId = req.user.userId;

        const result = await pool.query(
            `
            SELECT 
            id,
            type,
            title,
            amount_usdt,
            balance_type,
            direction,
            metadata,
            status,
            created_at
            FROM account_ledger
            WHERE user_id = $1
             AND type NOT IN ('withdrawal_paid', 'vip_purchase')
            ORDER BY created_at DESC
            LIMIT 100;
                    `,
            [userId]
        );

        return res.json({
            transactions: result.rows,
        });
    } catch (error) {
        console.error("GET TRANSACTIONS ERROR:", error);

        return res.status(500).json({
            message: "Error al obtener historial.",
        });
    }
}

module.exports = {
    getWithdrawInfo,
    createWithdrawRequest,
    getMyTransactions,
};