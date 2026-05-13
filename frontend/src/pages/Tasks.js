import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCpu, FiZap, FiTrendingUp, FiRefreshCw, FiRotateCw } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { getMiningStatus, claimMiningReward } from "../services/authService";
import { useI18n } from "../i18n/I18nContext";

function formatUsdt(value, decimals = 2) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCountdown(ms) {
  const safeMs = Math.max(Number(ms || 0), 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((item) => String(item).padStart(2, "0")).join(":");
}

function getProgress(mining, now) {
  if (!mining?.cycleStartedAt || !mining?.cycleEndsAt) return 0;
  const start = new Date(mining.cycleStartedAt).getTime();
  const end = new Date(mining.cycleEndsAt).getTime();
  const total = Math.max(end - start, 1);
  const elapsed = Math.max(now - start, 0);
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function getRemaining(mining, now) {
  if (!mining?.cycleEndsAt) return 0;
  return Math.max(new Date(mining.cycleEndsAt).getTime() - now, 0);
}

export default function Tasks() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const messageTimer = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [activeTab, setActiveTab] = useState("claim");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  const loadMining = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getMiningStatus();
      setData(result);
    } catch (error) {
      setMessage(error.message || t("Error al cargar minería."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMining();
  }, [loadMining]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 3600);
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, [message]);

  const mining = data?.mining;
  const plan = mining?.plan;
  const progress = useMemo(() => getProgress(mining, now), [mining, now]);
  const remainingMs = useMemo(() => getRemaining(mining, now), [mining, now]);
  const isClaimable = mining?.status === "active" && remainingMs <= 0;

  useEffect(() => {
    if (mining?.status === "active" && remainingMs <= 0) {
      const timeout = setTimeout(loadMining, 800);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [remainingMs, mining?.status, loadMining]);

  const handleClaim = async () => {
    if (!isClaimable || claiming) return;
    try {
      setClaiming(true);
      const result = await claimMiningReward();
      setMessage(result.message || t("Recompensa reclamada."));
      setData(result.dashboard || data);
      setActiveTab("history");
    } catch (error) {
      setMessage(error.message || t("Error al reclamar recompensa."));
      await loadMining();
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="page mining-page">
      <header className="mining-header">
        <div className="mining-brand">
          <div className="mining-logo"><FiCpu /></div>
          <div>
            <strong>{t("NiceHash")}</strong>
            <span>{t("Simulación de hash")}</span>
          </div>
        </div>
        <button className="mining-small-btn" type="button" onClick={loadMining}>
          <FiRefreshCw />
        </button>
      </header>


      <section className="mining-main-card">
        {loading ? (
          <div className="mining-loading">{t("Cargando minería...")}</div>
        ) : (
          <>
            <div className="mining-level-row mining-level-row-clean">
              <div className="mining-current-level mining-current-level-only">
                <span>{t("Nivel actual")}</span>
              </div>
              <button className="mining-info-pill" type="button" onClick={() => navigate("/vip")}>
                {t("Información de nivel")}
              </button>
            </div>

            <div className="mining-machine">
              <div className="mining-machine-glow" />
              <div className="mining-machine-title" data-no-translate="true">{plan?.name || "Mining"}</div>
              <div className="mining-core mining-core-elegant">
                <FiCpu />
              </div>
              <div className="mining-machine-plan">
                <span>{t("Módulo activo de minería")}</span>
              </div>
              <div className="mining-rays" />
            </div>

            <div className="mining-metrics-grid">
              <div>
                <span>{t("Tasa de hash")}</span>
                <strong data-no-translate="true">{formatUsdt(mining?.hashRate || 0)} GH/s</strong>
              </div>
              <div>
                <span>{t("Ingresos mineros")}</span>
                <strong className="gold-text" data-no-translate="true">+{formatUsdt(mining?.dailyPercent || 0, 2)}%</strong>
              </div>
              <div>
                <span>{t("A diario")}</span>
                <strong data-no-translate="true">{formatUsdt(mining?.dailyReward || 0)} USDT</strong>
              </div>
              <div>
                <span>{isClaimable ? t("Listo para reclamar") : t("Finaliza en")}</span>
                <strong data-no-translate={!isClaimable}>{isClaimable ? t("Reclamar") : formatCountdown(remainingMs)}</strong>
              </div>
            </div>

            <div className="mining-progress-wrap">
              <div className="mining-progress-top">
                <span>{t("Progreso de hash")}</span>
                <strong data-no-translate="true">{progress.toFixed(2)}%</strong>
              </div>
              <div className="mining-progress-bar">
                <span data-no-translate="true" style={{ width: `${progress}%` }} />
              </div>
              <small className="mining-progress-note">{t("El progreso avanza durante las 24 horas del ciclo de minería.")}</small>
            </div>

            <div className="mining-action-row">
              <button className="mining-primary-btn" type="button" onClick={() => navigate("/recharge")}>
                <FiTrendingUp />
                {t("Aumentar la tasa de hash")}
              </button>
              <button className="mining-secondary-btn" type="button" onClick={() => navigate("/reinvest")}>
                <FiRotateCw />
                {t("Re-invertir")}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="mining-register-section">
        <h2>{t("Registro de minería")}</h2>
        <div className="mining-tabs mining-tabs-two">
          <button className={activeTab === "claim" ? "active" : ""} type="button" onClick={() => setActiveTab("claim")}>{t("Reclamar")}</button>
          <button className={activeTab === "history" ? "active" : ""} type="button" onClick={() => setActiveTab("history")}>{t("Afirmado")}</button>
        </div>

        {message && <div className="mining-toast">{message}</div>}

        {activeTab === "claim" && (
          <div className="mining-claim-card">
            <div>
              <span data-no-translate="true">{plan?.name || t("Sin minería activa")}</span>
              <strong data-no-translate="true">+{formatUsdt(mining?.dailyReward || 0)} USDT</strong>
              <small data-no-translate={!isClaimable}>{isClaimable ? t("Ciclo terminado. Reclama tu bono.") : `${t("Cargando hash")}: ${formatCountdown(remainingMs)}`}</small>
            </div>
            <button type="button" disabled={!isClaimable || claiming} onClick={handleClaim}>
              <FiZap />
              {claiming ? t("Procesando...") : t("Reclamar")}
            </button>
          </div>
        )}

        {activeTab === "history" && (
          <div className="mining-history-list">
            {(data?.claims || []).length === 0 && <div className="mining-empty">{t("Todavía no tienes recompensas reclamadas.")}</div>}
            {(data?.claims || []).map((claim) => (
              <article key={claim.id} className="mining-history-item">
                <div>
                  <strong data-no-translate="true">{claim.planName}</strong>
                  <span data-no-translate="true">{new Date(claim.claimedAt).toLocaleString()}</span>
                </div>
                <b data-no-translate="true">+{formatUsdt(claim.rewardAmount)} USDT</b>
              </article>
            ))}
          </div>
        )}
      </section>

      <button className="mining-invite-banner mining-invite-banner-bottom" type="button" onClick={() => navigate("/rewards")}>
        <div className="mining-invite-banner-icon"><FiTrendingUp /></div>
        <div>
          <strong>{t("Invita para aumentar tu porcentaje de hash")}</strong>
          <span>{t("Suma más bonus hash y mejora tus ingresos mineros.")}</span>
        </div>
      </button>
    </div>
  );
}
