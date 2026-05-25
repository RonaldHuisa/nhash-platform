async function createReferralCommissions(
    client,
    sourceUserId,
    sourceType,
    sourceId,
    baseAmountUsdt
) {
    const percentages = {
        1: 5,
        2: 2,
        3: 1,
    };

    let currentUserId = sourceUserId;

    for (let level = 1; level <= 3; level++) {
        const sponsorResult = await client.query(
            `
            SELECT referred_by_id
            FROM users
            WHERE id = $1
            `,
            [currentUserId]
        );

        if (sponsorResult.rows.length === 0) break;

        const sponsorId = sponsorResult.rows[0].referred_by_id;

        if (!sponsorId) break;

        const percent = percentages[level];

        const commissionResult = await client.query(
            `
            INSERT INTO referral_commissions
            (
                receiver_user_id,
                source_user_id,
                level,
                source_type,
                source_id,
                base_amount_usdt,
                percent,
                amount_usdt
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                ($6::numeric * $7::numeric / 100)
            )
            ON CONFLICT (receiver_user_id, source_type, source_id, level)
            DO NOTHING
            RETURNING id, amount_usdt
            `,
            [
                sponsorId,
                sourceUserId,
                level,
                sourceType,
                sourceId,
                baseAmountUsdt,
                percent,
            ]
        );

        if (commissionResult.rows.length > 0) {
            const commission = commissionResult.rows[0];

            await client.query(
                `
                UPDATE users
                SET withdrawable_usdt = withdrawable_usdt + $1
                WHERE id = $2
                `,
                [commission.amount_usdt, sponsorId]
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
                    sponsorId,
                    "earnings",
                    "credit",
                    "referral_commission",
                    `Comisión de referido nivel ${level}`,
                    commission.amount_usdt,
                    `Comisión generada por ${sourceType === "deposit" ? "recarga/inversión" : "compra VIP"} de un referido de nivel ${level}.`,
                    "referral_commission",
                    commission.id,
                    JSON.stringify({
                        level,
                        sourceUserId,
                        sourceType,
                        sourceId,
                        percent,
                        baseAmountUsdt,
                    }),
                    "completed",
                ]
            );
        }

        currentUserId = sponsorId;
    }
}

module.exports = {
    createReferralCommissions,
};