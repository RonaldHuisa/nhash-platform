const crypto = require("crypto");
const { ethers } = require("ethers");
const pool = require("../config/db");
const { refreshMiningAccountForUser } = require("./miningService");
const { createReferralCommissions } = require("./referralCommissionService");
const {
  getPaymentNetwork,
  getNetworkTokenContract,
  getNetworkTokenDecimals,
} = require("../utils/paymentNetworks");

function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

function parseMaybeHexNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return fallback;
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function getAlchemySigningKeys(networkCode) {
  const commonKeys = [
    process.env.ALCHEMY_WEBHOOK_SIGNING_KEY,
    process.env.ALCHEMY_SIGNING_KEY,
    process.env.ALCHEMY_WEBHOOK_SECRET,
  ];

  if (networkCode === "BEP20-USDT") {
    return uniqueNonEmpty([
      process.env.ALCHEMY_BSC_WEBHOOK_SIGNING_KEY,
      process.env.ALCHEMY_BEP20_WEBHOOK_SIGNING_KEY,
      ...commonKeys,
    ]);
  }

  if (networkCode === "POLYGON-USDT") {
    return uniqueNonEmpty([
      process.env.ALCHEMY_POLYGON_WEBHOOK_SIGNING_KEY,
      ...commonKeys,
    ]);
  }

  return uniqueNonEmpty([
    process.env.ALCHEMY_BSC_WEBHOOK_SIGNING_KEY,
    process.env.ALCHEMY_BEP20_WEBHOOK_SIGNING_KEY,
    process.env.ALCHEMY_POLYGON_WEBHOOK_SIGNING_KEY,
    ...commonKeys,
  ]);
}

function verifyAlchemySignature(req, { networkCode } = {}) {
  const signingKeys = getAlchemySigningKeys(networkCode);

  // DEV / pruebas: si todavía no configuraste signing key, no bloqueamos.
  // Producción recomendada: configurar ALCHEMY_BSC_WEBHOOK_SIGNING_KEY y ALCHEMY_POLYGON_WEBHOOK_SIGNING_KEY.
  if (signingKeys.length === 0) return { ok: true, skipped: true };

  const signature = String(
    req.headers["x-alchemy-signature"] || req.headers["X-Alchemy-Signature"] || ""
  ).trim();

  if (!signature) {
    return { ok: false, reason: "Falta header x-alchemy-signature" };
  }

  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(signature, "hex");
  } catch {
    return { ok: false, reason: "Firma Alchemy con formato inválido" };
  }

  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  for (const signingKey of signingKeys) {
    const expected = crypto
      .createHmac("sha256", signingKey)
      .update(rawBody, "utf8")
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return { ok: true, skipped: false };
    }
  }

  return {
    ok: false,
    reason: `Firma Alchemy inválida${networkCode ? ` para ${networkCode}` : ""}`,
  };
}

function getNetworkFromAlchemyEvent(activity, eventNetwork, expectedNetworkCode = null) {
  const bsc = getPaymentNetwork("BEP20-USDT", { deposit: true });
  const polygon = getPaymentNetwork("POLYGON-USDT", { deposit: true });

  if (expectedNetworkCode === "BEP20-USDT") return bsc;
  if (expectedNetworkCode === "POLYGON-USDT") return polygon;

  const contract = normalizeAddress(activity?.rawContract?.address || activity?.address);
  const eventNetworkText = String(eventNetwork || "").toUpperCase();

  const bscContract = normalizeAddress(getNetworkTokenContract(bsc));
  const polygonContract = normalizeAddress(getNetworkTokenContract(polygon));

  if (contract && contract === bscContract) return bsc;
  if (contract && contract === polygonContract) return polygon;

  if (eventNetworkText.includes("BNB") || eventNetworkText.includes("BSC")) return bsc;
  if (eventNetworkText.includes("MATIC") || eventNetworkText.includes("POLYGON")) return polygon;

  return null;
}

function getActivityLogIndex(activity) {
  return parseMaybeHexNumber(
    activity?.log?.logIndex ??
      activity?.log?.log_index ??
      activity?.logIndex ??
      activity?.log_index ??
      activity?.transactionIndex ??
      0,
    0
  );
}

function getActivityBlockNumber(activity) {
  return parseMaybeHexNumber(activity?.blockNum ?? activity?.block_number ?? activity?.blockNumber, 0);
}

function getActivityRawAmount(activity, decimals) {
  const raw = activity?.rawContract?.rawValue ?? activity?.rawValue ?? activity?.valueRaw;

  if (raw !== undefined && raw !== null && raw !== "") {
    const text = String(raw).trim();
    if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text).toString();
    if (/^[0-9]+$/.test(text)) return text;
  }

  if (activity?.value !== undefined && activity?.value !== null && activity?.value !== "") {
    return ethers.parseUnits(String(activity.value), decimals).toString();
  }

  return "0";
}

function normalizeAlchemyActivity(activity, eventNetwork, expectedNetworkCode = null) {
  if (!activity || typeof activity !== "object") return null;
  if (activity?.removed === true || activity?.log?.removed === true) return null;

  const category = String(activity.category || "").toLowerCase();
  if (category && !["erc20", "token"].includes(category)) return null;

  const network = getNetworkFromAlchemyEvent(activity, eventNetwork, expectedNetworkCode);
  if (!network) return null;

  const tokenContract = activity?.rawContract?.address || activity?.address;
  const contractLower = normalizeAddress(tokenContract);
  const expectedContractLower = normalizeAddress(getNetworkTokenContract(network));
  if (contractLower && contractLower !== expectedContractLower) return null;

  const toAddress = activity.toAddress || activity.to_address;
  const toAddressLower = normalizeAddress(toAddress);
  if (!toAddressLower) return null;

  const txHash = activity.hash || activity.transaction_hash || activity.txHash;
  if (!txHash) return null;

  const decimalsFromPayload = parseMaybeHexNumber(activity?.rawContract?.decimal, NaN);
  const decimals = Number.isFinite(decimalsFromPayload)
    ? decimalsFromPayload
    : getNetworkTokenDecimals(network);

  const amountRaw = getActivityRawAmount(activity, decimals);
  if (BigInt(amountRaw || "0") <= 0n) return null;

  const amountUsdt = ethers.formatUnits(amountRaw, decimals);

  return {
    network,
    txHash: String(txHash),
    logIndex: getActivityLogIndex(activity),
    blockNumber: getActivityBlockNumber(activity),
    tokenContract: tokenContract || getNetworkTokenContract(network),
    amountRaw,
    amountUsdt,
    fromAddress: activity.fromAddress || activity.from_address || null,
    toAddress,
    toAddressLower,
    blockTimestamp: activity.blockTimestamp || activity.block_timestamp || null,
    source: "alchemy-webhook",
  };
}

function extractAlchemyTransfers(payload, { expectedNetworkCode = null } = {}) {
  const activity = Array.isArray(payload?.event?.activity) ? payload.event.activity : [];
  const eventNetwork = payload?.event?.network || payload?.network || "";

  return activity
    .map((item) => normalizeAlchemyActivity(item, eventNetwork, expectedNetworkCode))
    .filter(Boolean)
    .filter((transfer) => !expectedNetworkCode || transfer.network.code === expectedNetworkCode);
}

async function insertLedgerIfMissing(client, { userId, depositId, network, amountUsdt, transfer }) {
  const exists = await client.query(
    `
    SELECT id
    FROM account_ledger
    WHERE reference_type = 'deposit'
      AND reference_id = $1
      AND type = 'deposit_confirmed'
    LIMIT 1
    `,
    [depositId]
  );

  if (exists.rows.length > 0) return false;

  await client.query(
    `
    INSERT INTO account_ledger
    (
      user_id,
      type,
      title,
      amount_usdt,
      balance_type,
      direction,
      description,
      reference_type,
      reference_id,
      status,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    `,
    [
      userId,
      "deposit_confirmed",
      `Recarga ${network.code}`,
      amountUsdt,
      "investment",
      "credit",
      `Depósito USDT detectado por Alchemy Webhook en ${network.displayName}`,
      "deposit",
      depositId,
      "completed",
      JSON.stringify({
        network: network.code,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        blockNumber: transfer.blockNumber,
        scanner: "alchemy-webhook",
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
      }),
    ]
  );

  return true;
}

async function processAlchemyWebhookPayload(payload, { expectedNetworkCode = null } = {}) {
  const transfers = extractAlchemyTransfers(payload, { expectedNetworkCode });
  const client = await pool.connect();

  const summary = {
    eventId: payload?.id || null,
    webhookId: payload?.webhookId || null,
    expectedNetworkCode,
    receivedTransfers: transfers.length,
    matchedWallets: 0,
    addedDeposits: 0,
    creditedAmountUsdt: 0,
    ignored: 0,
    details: [],
  };

  try {
    await client.query("BEGIN");

    for (const transfer of transfers) {
      const walletResult = await client.query(
        `
        SELECT id, user_id, network, address, created_at, last_scanned_block
        FROM wallets
        WHERE LOWER(address) = LOWER($1)
          AND network = $2
        ORDER BY id ASC
        LIMIT 1
        `,
        [transfer.toAddress, transfer.network.code]
      );

      if (walletResult.rows.length === 0) {
        summary.ignored += 1;
        summary.details.push({
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          reason: "wallet_not_found",
          toAddress: transfer.toAddress,
          network: transfer.network.code,
        });
        continue;
      }

      summary.matchedWallets += 1;
      const wallet = walletResult.rows[0];

      const insertedDeposit = await client.query(
        `
        INSERT INTO deposits
        (
          user_id,
          wallet_id,
          network,
          token_contract,
          tx_hash,
          log_index,
          block_number,
          amount_raw,
          amount_usdt,
          status,
          sweep_status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed','pending')
        ON CONFLICT (tx_hash, log_index) DO NOTHING
        RETURNING id, amount_usdt
        `,
        [
          wallet.user_id,
          wallet.id,
          transfer.network.code,
          transfer.tokenContract,
          transfer.txHash,
          transfer.logIndex,
          transfer.blockNumber,
          transfer.amountRaw,
          transfer.amountUsdt,
        ]
      );

      if (insertedDeposit.rows.length === 0) {
        summary.ignored += 1;
        summary.details.push({
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          reason: "already_processed",
          userId: wallet.user_id,
          walletId: wallet.id,
        });
        continue;
      }

      const depositId = insertedDeposit.rows[0].id;
      const amountUsdt = insertedDeposit.rows[0].amount_usdt;

      await insertLedgerIfMissing(client, {
        userId: wallet.user_id,
        depositId,
        network: transfer.network,
        amountUsdt,
        transfer,
      });

      await client.query(
        `
        UPDATE users
        SET
          balance_usdt = COALESCE(balance_usdt, 0) + $1,
          recharge_balance_usdt = COALESCE(recharge_balance_usdt, 0) + $1
        WHERE id = $2
        `,
        [amountUsdt, wallet.user_id]
      );

      await client.query(
        `
        UPDATE deposit_scan_requests
        SET
          status = 'completed',
          added_deposits = COALESCE(added_deposits, 0) + 1,
          detected_transfers = GREATEST(COALESCE(detected_transfers, 0), 1),
          completed_at = CURRENT_TIMESTAMP,
          last_checked_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
        WHERE user_id = $1
          AND wallet_id = $2
          AND network = $3
          AND status = 'pending'
        `,
        [
          wallet.user_id,
          wallet.id,
          transfer.network.code,
          JSON.stringify({
            completedBy: "alchemy-webhook",
            txHash: transfer.txHash,
            logIndex: transfer.logIndex,
            completedAt: new Date().toISOString(),
          }),
        ]
      );

      await refreshMiningAccountForUser(client, wallet.user_id);

      await createReferralCommissions(
        client,
        wallet.user_id,
        "deposit",
        depositId,
        amountUsdt
      );

      summary.addedDeposits += 1;
      summary.creditedAmountUsdt += Number(amountUsdt || 0);
      summary.details.push({
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        userId: wallet.user_id,
        walletId: wallet.id,
        network: transfer.network.code,
        amountUsdt: String(amountUsdt),
        status: "credited",
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  summary.creditedAmountUsdt = Number(summary.creditedAmountUsdt.toFixed(8));
  return summary;
}

async function syncAlchemyWebhookAddresses({ networkCode } = {}) {
  const authToken = process.env.ALCHEMY_NOTIFY_AUTH_TOKEN || process.env.ALCHEMY_AUTH_TOKEN;

  if (!authToken) {
    throw new Error("Falta ALCHEMY_NOTIFY_AUTH_TOKEN en variables de entorno.");
  }

  const networks = [];
  if (!networkCode || networkCode === "BEP20-USDT") {
    networks.push({
      code: "BEP20-USDT",
      webhookId: process.env.ALCHEMY_BSC_WEBHOOK_ID || process.env.ALCHEMY_BEP20_WEBHOOK_ID,
    });
  }
  if (!networkCode || networkCode === "POLYGON-USDT") {
    networks.push({
      code: "POLYGON-USDT",
      webhookId: process.env.ALCHEMY_POLYGON_WEBHOOK_ID,
    });
  }

  const results = [];

  for (const item of networks) {
    if (!item.webhookId) {
      results.push({ network: item.code, skipped: true, reason: "missing_webhook_id" });
      continue;
    }

    const walletResult = await pool.query(
      `
      SELECT DISTINCT LOWER(address) AS address
      FROM wallets
      WHERE network = $1
        AND address IS NOT NULL
        AND address <> ''
      ORDER BY LOWER(address) ASC
      `,
      [item.code]
    );

    const addresses = walletResult.rows.map((row) => row.address).filter(Boolean);
    let added = 0;

    for (let index = 0; index < addresses.length; index += 1000) {
      const chunk = addresses.slice(index, index + 1000);
      if (chunk.length === 0) continue;

      const response = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Alchemy-Token": authToken,
        },
        body: JSON.stringify({
          webhook_id: item.webhookId,
          addresses_to_add: chunk,
          addresses_to_remove: [],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Alchemy update-webhook-addresses ${item.code} HTTP ${response.status}: ${text}`);
      }

      added += chunk.length;
    }

    results.push({ network: item.code, webhookId: item.webhookId, added });
  }

  return { status: "ok", results };
}

module.exports = {
  verifyAlchemySignature,
  processAlchemyWebhookPayload,
  syncAlchemyWebhookAddresses,
};
