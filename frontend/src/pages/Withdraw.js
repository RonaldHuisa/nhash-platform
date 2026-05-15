import React, { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiClock, FiCopy, FiEye, FiEyeOff, FiInfo } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import {
  createWithdrawRequest,
  getWithdrawInfo,
} from "../services/authService";
import { useI18n } from "../i18n/I18nContext";

const PAYMENT_NETWORKS = [
  {
    code: "BEP20-USDT",
    label: "BEP20-USDT",
    short: "BEP20",
    icon: "/images/networks/bep20-usdt.webp",
  },
  {
    code: "POLYGON-USDT",
    label: "POLYGON-USDT",
    short: "POLYGON",
    icon: "/images/networks/polygon-usdt.webp",
  },
];

function formatAmount(value, decimals = 6) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue.toFixed(decimals) : (0).toFixed(decimals);
}

export default function Withdraw() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const toastTimerRef = useRef(null);

  const [selectedNetwork, setSelectedNetwork] = useState("BEP20-USDT");
  const [available, setAvailable] = useState("0");
  const [feePercent, setFeePercent] = useState(8);
  const [minWithdraw, setMinWithdraw] = useState(1);
  const [withdrawalAddress, setWithdrawalAddress] = useState("");
  const [addressLocked, setAddressLocked] = useState(false);
  const [canWithdraw, setCanWithdraw] = useState(true);
  const [withdrawRequirementMessage, setWithdrawRequirementMessage] = useState("");
  const [withdrawalDayPolicy, setWithdrawalDayPolicy] = useState(null);
  const [withdrawalPolicy, setWithdrawalPolicy] = useState(null);

  const [amount, setAmount] = useState("");
  const [securityPassword, setSecurityPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");

  const activeNetwork = PAYMENT_NETWORKS.find((item) => item.code === selectedNetwork) || PAYMENT_NETWORKS[0];

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

    setToast(message);

    toastTimerRef.current = setTimeout(() => {
      setToast("");
    }, 5000);
  }, []);

  const loadWithdrawInfo = useCallback(async () => {
    try {
      setLoading(true);

      const data = await getWithdrawInfo(selectedNetwork);

      setAvailable(data.available || "0");
      setFeePercent(Number(data.feePercent || 8));
      setMinWithdraw(Number(data.minWithdraw || 1));
      setWithdrawalAddress(data.withdrawalAddress || "");
      setAddressLocked(Boolean(data.addressLocked));
      setCanWithdraw(data.canWithdraw !== false);
      setWithdrawRequirementMessage(data.withdrawRequirementMessage || "");
      setWithdrawalDayPolicy(data.withdrawalDayPolicy || null);
      setWithdrawalPolicy(data.withdrawalPolicy || null);
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(false);
    }
  }, [selectedNetwork, showToast]);

  useEffect(() => {
    loadWithdrawInfo();

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [loadWithdrawInfo]);

  const amountNumber = Number(amount || 0);
  const feeAmount = amountNumber * (feePercent / 100);
  const realArrivalBeforePolicy = amountNumber > 0 ? amountNumber - feeAmount : 0;
  const policyApplies = Boolean(
    withdrawalPolicy?.applies ||
      (
        withdrawalPolicy?.isVipEligibleForPolicy &&
        !withdrawalPolicy?.hasEnoughActiveInvites &&
        Number(withdrawalPolicy?.totalVipInvested || 0) > 0 &&
        Number(withdrawalPolicy?.totalRequestedBefore || 0) + amountNumber >=
          Number(withdrawalPolicy?.recoveredLimitAmount || 0)
      )
  );
  const policyReductionPercent = Number(withdrawalPolicy?.reductionPercent || 0);
  const policyReductionAmount = policyApplies
    ? realArrivalBeforePolicy * (policyReductionPercent / 100)
    : 0;
  const realArrival = Math.max(realArrivalBeforePolicy - policyReductionAmount, 0);

  const handleAll = () => {
    setAmount(Number(available || 0).toString());
  };

  const handleConfirm = async () => {
    if (!canWithdraw) {
      showToast(t(withdrawRequirementMessage || "No puedes retirar en este momento."));
      return;
    }

    try {
      setSending(true);

      const data = await createWithdrawRequest({
        network: selectedNetwork,
        withdrawalAddress,
        amount,
        securityPassword,
      });

      showToast(data.message || t("Solicitud de retiro creada"));

      setAvailable(data.currentWithdrawable || "0");
      setWithdrawalAddress(data.withdrawalAddress || withdrawalAddress);
      setAddressLocked(true);
      setAmount("");
      setSecurityPassword("");
      setWithdrawalPolicy(data.withdrawalPolicy || withdrawalPolicy);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page withdraw-exact-page">
      {toast && (
        <div className="center-simple-toast center-simple-toast-info">
          <span>{toast}</span>
        </div>
      )}

      <div className="withdraw-exact-topbar">
        <button className="withdraw-exact-back" onClick={() => navigate("/home")}>
          <FiArrowLeft />
        </button>
        <h2>{t("Retirar")}</h2>
        <button
          className="withdraw-exact-history"
          type="button"
          onClick={() => navigate("/transactions")}
        >
          <FiClock />
        </button>
      </div>

      <section className="withdraw-exact-balance">
        <p>{t("Disponible(USDT)")}</p>
        <strong data-no-translate="true">{formatAmount(available, 6)}</strong>
      </section>

      {!canWithdraw && (
        <div className="withdraw-exact-note danger">
          <FiInfo />
          <span>{t(withdrawRequirementMessage || "No puedes retirar en este momento.")}</span>
        </div>
      )}

      {canWithdraw && withdrawalDayPolicy?.message && (
        <div className="withdraw-exact-note success">
          <FiInfo />
          <span>{t(withdrawalDayPolicy.message)}</span>
        </div>
      )}

      {canWithdraw && policyApplies && (
        <div className="withdraw-exact-note danger">
          <FiInfo />
          <span>
            {t("Actualmente este retiro tiene una reducción del 75% porque superaste el porcentaje de recuperación permitido sin completar la meta de comunidad.")}
          </span>
        </div>
      )}

      <section className="withdraw-exact-card">
        <h3>{t("Seleccionar red")}</h3>

        <div className="withdraw-exact-networks">
          {PAYMENT_NETWORKS.map((network) => (
            <button
              key={network.code}
              className={`withdraw-exact-network ${selectedNetwork === network.code ? "active" : ""}`}
              type="button"
              onClick={() => {
                setSelectedNetwork(network.code);
                setWithdrawalAddress("");
                setAddressLocked(false);
              }}
            >
              <img src={network.icon} alt={network.label} />
              <span>{network.label}</span>
            </button>
          ))}
        </div>

        <h3>{t("Retirar dirección")}</h3>
        <input
          className="withdraw-exact-input"
          value={withdrawalAddress}
          onChange={(e) => setWithdrawalAddress(e.target.value)}
          placeholder={t("Pegue o ingrese la dirección")}
          disabled={addressLocked || !canWithdraw}
        />

        {addressLocked && (
          <p className="withdraw-exact-help">
            {t("Dirección fijada para esta red. Puedes usar otra dirección en otra red disponible.")}
          </p>
        )}

        <h3>{t("Cantidad a retirar")}</h3>
        <div className="withdraw-exact-amount">
          <input
            className="withdraw-exact-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("Cantidad")}
            type="number"
            min="0"
            step="0.000001"
            disabled={!canWithdraw}
          />
          <button type="button" onClick={handleAll} disabled={!canWithdraw}>
            {t("Todo")}
          </button>
        </div>

        <p className="withdraw-exact-limits">
          {t("Retiro mínimo")}: <b>{Number(minWithdraw || 0).toFixed(2)}USDT</b>{" "}
          {t("Retiro máximo")}: <b>99999999.00USDT</b>
        </p>

        <h3>{t("PIN de seguridad")}</h3>
        <div className="withdraw-exact-password">
          <input
            className="withdraw-exact-input"
            value={securityPassword}
            onChange={(e) => setSecurityPassword(e.target.value)}
            placeholder={t("PIN de seguridad")}
            type={showPassword ? "text" : "password"}
            disabled={!canWithdraw}
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? <FiEyeOff /> : <FiEye />}
          </button>
        </div>

        <div className="withdraw-exact-arrival">
          <span>{t("Usted recibe")}:</span>
          <strong data-no-translate="true">{formatAmount(realArrival, 6)} USDT</strong>
        </div>

        {policyApplies && amountNumber > 0 && (
          <div className="withdraw-exact-policy">
            {t("Reducción por meta de invitados")}: <b>-{formatAmount(policyReductionAmount, 6)} USDT</b>
          </div>
        )}

        <button
          className="withdraw-exact-confirm"
          type="button"
          onClick={handleConfirm}
          disabled={loading || sending || !canWithdraw}
        >
          {!canWithdraw ? t("No disponible") : sending ? t("Procesando...") : t("RETIRAR")}
        </button>

        <div className="withdraw-exact-note-simple">
          <FiInfo />
          <b>{t("Nota")}</b>
        </div>

        <div className="withdraw-exact-instructions">
          <p>
            {t("Puedes retirar usando BEP20-USDT o POLYGON-USDT.")}
          </p>
          <p>
            {t("Ingresa una dirección que pertenezca exactamente a la red seleccionada.")}
          </p>
          <p>1: {t("Retiro mínimo")} {Number(minWithdraw || 0).toFixed(2)} USDT</p>
          <p>2: {t("Verifica que la dirección pertenezca a la red seleccionada antes de confirmar.")}</p>
          {withdrawalDayPolicy?.activeVipName && (
            <p>3: {t("Nivel actual")}: <b>{t(withdrawalDayPolicy.activeVipName)}</b></p>
          )}
          {withdrawalDayPolicy?.allowedDaysLabel && (
            <p>4: {t("Días disponibles para tu nivel")}: <b>{t(withdrawalDayPolicy.allowedDaysLabel)} ({withdrawalDayPolicy.timezone || "UTC"})</b></p>
          )}
        </div>
      </section>
    </div>
  );
}
