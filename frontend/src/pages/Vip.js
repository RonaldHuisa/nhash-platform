import React, { useCallback, useEffect, useState } from "react";
import { FiArrowDownCircle, FiCpu, FiRefreshCw, FiTrendingUp } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { getMiningStatus } from "../services/authService";
import { useI18n } from "../i18n/I18nContext";

function formatUsdt(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRange(plan) {
  const min = formatUsdt(plan.minAmount);
  const max = plan.maxAmount === null || plan.maxAmount === undefined ? "+" : formatUsdt(plan.maxAmount);
  return `${min} - ${max}`;
}

export default function Vip() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getMiningStatus();
      setData(result);
    } catch (error) {
      setMessage(error.message || t("Error al cargar niveles de minería."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const currentPlan = data?.mining?.plan;
  const invested = Number(data?.balances?.investmentWalletUsdt ?? data?.mining?.investedAmount ?? 0);

  return (
    <div className="page mining-plans-page">
      <header className="mining-header">
        <div className="mining-brand">
          <div className="mining-logo"><FiCpu /></div>
          <div>
            <strong>{t("Personaje")}</strong>
            <span>{t("Nivel automático de minería")}</span>
          </div>
        </div>
        <button className="mining-small-btn" type="button" onClick={loadPlans}><FiRefreshCw /></button>
      </header>

      <section className="mining-invest-card">
        <div className="mining-invest-row">
          <span>{t("Nivel")}</span>
          <strong data-no-translate="true">{currentPlan?.name || t("Sin nivel")}</strong>
        </div>
        <div className="mining-invest-row">
          <span>{t("Monto del depósito")}</span>
          <strong className="gold-text" data-no-translate="true">$ {formatUsdt(invested)}</strong>
        </div>
        <button type="button" className="mining-primary-btn" onClick={() => navigate("/recharge")}>
          <FiArrowDownCircle />
          {t("Depósito")}
        </button>
      </section>

      <div className="mining-wallet-tabs">
        <button className="active" type="button">{t("Cartera de inversión")}</button>
        <button type="button" onClick={() => navigate("/reinvest")}>{t("Re-invertir")}</button>
      </div>

      {message && <div className="mining-toast">{message}</div>}

      <section className="mining-plan-table-card">
        {loading && <div className="mining-empty">{t("Cargando niveles...")}</div>}
        {!loading && (data?.plans || []).map((plan) => (
          <article className={`mining-plan-row ${currentPlan?.id === plan.id ? "active" : ""}`} key={plan.id}>
            <div className="mining-plan-line">
              <span>{t("Nivel")}</span>
              <strong data-no-translate="true">{plan.name}</strong>
            </div>
            <div className="mining-plan-line">
              <span>{t("Monto del depósito")}</span>
              <strong className="mining-plan-range-value" data-no-translate="true">{formatRange(plan)}</strong>
            </div>
            <div className="mining-plan-line">
              <span>{t("Ingresos mineros")}</span>
              <strong className="mining-plan-income-value" data-no-translate="true"><FiTrendingUp /> {formatUsdt(plan.dailyPercent)}%</strong>
            </div>
            <div className="mining-plan-line">
              <span>{t("Ventana de minería")}</span>
              <strong className="gold-text" data-no-translate="true">{plan.windowDays}{t("días")}</strong>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
