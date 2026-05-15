import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiChevronRight,
  FiCopy,
  FiHash,
  FiLink,
  FiUsers,
} from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { getPromotionDashboard } from "../services/authService";
import { useI18n } from "../i18n/I18nContext";

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function numberValue(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getReferralCode(data) {
  if (data?.referralCode) return String(data.referralCode);
  if (data?.user?.referral_code) return String(data.user.referral_code);
  if (data?.user?.referralCode) return String(data.user.referralCode);

  const link = String(data?.referralLink || "");
  const match = link.match(/[?&]ref=([^&]+)/i) || link.match(/[?&]invite_code=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

export default function Promotion() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [data, setData] = useState(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 2400);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const dashboardResult = await getPromotionDashboard();
      setData(dashboardResult || {});
    } catch (error) {
      showToast(error.message || t("No se pudo cargar el equipo."));
      setData({});
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();

    const handleFocus = () => loadData();
    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [loadData]);

  const referralCode = useMemo(() => getReferralCode(data), [data]);

  const referralLink = useMemo(() => {
    if (data?.referralLink) return data.referralLink;
    return `${window.location.origin}/register?ref=${referralCode || ""}`;
  }, [data?.referralLink, referralCode]);

  const copyText = async (value, successMessage) => {
    if (!value) {
      showToast(t("No hay información para copiar."));
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage);
    } catch (error) {
      showToast(t("No se pudo copiar."));
    }
  };

  const levels = data?.levels || [];

  const totalMembers = numberValue(data?.totalMembers);
  const totalIncome = numberValue(data?.totalIncome);
  const totalTeamRecharge = numberValue(data?.totalTeamRecharge);
  const totalTeamWithdrawals = numberValue(
    data?.totalTeamWithdrawals || data?.teamWithdrawals || data?.withdrawalsTotal || 0
  );

  return (
    <div className="page promotion-page team-simple-page">
      {toast && (
        <div className="success-toast">
          <strong>{toast}</strong>
        </div>
      )}

      <section className="team-simple-copy-card">
        <div className="team-simple-copy-title">
          <FiLink />
          <div>
            <h2>{t("Invita y gana")}</h2>
            <p>{t("Comparte tu código o enlace de invitación")}</p>
          </div>
        </div>

        <div className="team-simple-copy-grid">
          <div className="team-simple-copy-box">
            <span>{t("Código de invitación")}</span>
            <div className="team-simple-copy-row">
              <strong data-no-translate="true">
                <FiHash />
                {referralCode || "-"}
              </strong>
              <button
                type="button"
                onClick={() => copyText(referralCode, t("Código copiado."))}
              >
                <FiCopy />
                {t("Copiar")}
              </button>
            </div>
          </div>

          <div className="team-simple-copy-box">
            <span>{t("Enlace de invitación")}</span>
            <div className="team-simple-copy-row link-row">
              <strong data-no-translate="true">
                <FiLink />
                <em>{referralLink || "-"}</em>
              </strong>
              <button
                type="button"
                className="copy-link-main"
                onClick={() => copyText(referralLink, t("Enlace copiado."))}
              >
                <FiCopy />
                {t("Copiar enlace")}
              </button>
            </div>
          </div>
        </div>
      </section>


      <section className="team-simple-stats-card">
        <div className="team-simple-stat">
          <span>{t("Tamaño del equipo")}</span>
          <strong data-no-translate="true">{totalMembers}</strong>
        </div>

        <div className="team-simple-stat">
          <span>{t("Comisiones de referencia")}</span>
          <strong data-no-translate="true">${money(totalIncome)}</strong>
        </div>

        <div className="team-simple-stat">
          <span>{t("Depósitos del equipo")}</span>
          <strong data-no-translate="true">${money(totalTeamRecharge)}</strong>
        </div>

        <div className="team-simple-stat">
          <span>{t("Retiros de equipos")}</span>
          <strong data-no-translate="true">${money(totalTeamWithdrawals)}</strong>
        </div>
      </section>

      <section className="team-simple-levels">
        {levels.map((level) => {
          const total = numberValue(level.totalMembers);
          const active = numberValue(level.activeMembers);

          return (
            <button
              type="button"
              className="team-simple-level-card"
              key={level.level}
              onClick={() => navigate(`/members/${level.level}`)}
            >
              <strong>{`LEV ${level.level}`}</strong>

              <div>
                <span>{t("Válido/Contar")}</span>
                <b data-no-translate="true">{active}/{total}</b>
              </div>

              <em>
                {t("Detalles")}
                <FiChevronRight />
              </em>
            </button>
          );
        })}

        {!loading && levels.length === 0 && (
          <div className="team-simple-empty">
            <FiUsers />
            <span>{t("Aún no tienes equipo registrado.")}</span>
          </div>
        )}
      </section>
    </div>
  );
}
