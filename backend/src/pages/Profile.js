import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiArrowRight,
  FiBarChart2,
  FiCreditCard,
  FiCpu,
  FiHelpCircle,
  FiInfo,
  FiLock,
  FiLogOut,
  FiMessageCircle,
  FiRefreshCw,
  FiSend,
  FiUser,
  FiUsers,
} from "react-icons/fi";
import { getUser, logout, changePassword } from "../services/authService";
import { useI18n } from "../i18n/I18nContext";

const TELEGRAM_SUPPORT_URL = "https://t.me/NiceHashSupport";
const TELEGRAM_CHANNEL_URL = "https://t.me/NiceHashVIP";

export default function Profile() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [user] = useState(() => getUser());
  const [toast, setToast] = useState("");
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [showSupportPanel, setShowSupportPanel] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const showToast = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }, []);

  const openExternal = (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const updatePasswordField = (field, value) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();

    const currentPassword = passwordForm.currentPassword.trim();
    const newPassword = passwordForm.newPassword.trim();
    const confirmPassword = passwordForm.confirmPassword.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast(t("Completa todos los campos."));
      return;
    }

    if (newPassword.length < 6) {
      showToast(t("La nueva contraseña debe tener mínimo 6 caracteres."));
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast(t("Las nuevas contraseñas no coinciden."));
      return;
    }

    try {
      setSavingPassword(true);
      await changePassword({ currentPassword, newPassword });
      showToast(t("Contraseña actualizada correctamente."));
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setShowPasswordPanel(false);
    } catch (error) {
      showToast(error.message || t("No se pudo actualizar la contraseña."));
    } finally {
      setSavingPassword(false);
    }
  };

  const primaryItems = [
    { label: t("Depósito"), icon: <FiCreditCard />, action: () => navigate("/recharge") },
    { label: t("Retirar"), icon: <FiBarChart2 />, action: () => navigate("/withdraw") },
    { label: t("Transferir"), icon: <FiRefreshCw />, action: () => navigate("/reinvest") },
    { label: t("Equipo"), icon: <FiUsers />, action: () => navigate("/promotion") },
  ];

  const secondaryItems = [
    { label: t("Contraseña"), icon: <FiLock />, action: () => setShowPasswordPanel(true) },
    { label: t("Acerca de"), icon: <FiInfo />, action: () => navigate("/about") },
    { label: t("Apoyo"), icon: <FiHelpCircle />, action: () => setShowSupportPanel(true) },
    { label: t("Cerrar sesión"), icon: <FiLogOut />, action: handleLogout },
  ];

  return (
    <div className="page profile-clean-page">
      {toast && (
        <div className="center-simple-toast center-simple-toast-info">
          <span>{toast}</span>
        </div>
      )}

      <section className="profile-clean-hero">
        <div className="profile-clean-topline">
          <strong>NiceHash</strong>
          <span>{t("Mi cuenta")}</span>
        </div>

        <div className="profile-clean-user-row">
          <div className="profile-clean-avatar profile-clean-avatar-brand">
            <FiCpu />
          </div>

          <div className="profile-clean-user-info">
            <strong data-no-translate="true">{user?.email || "Usuario"}</strong>
            <span data-no-translate="true">ID: {user?.referral_code || user?.referralCode || "------"}</span>
          </div>
        </div>
      </section>

      <section className="profile-action-panel profile-action-panel-primary">
        {primaryItems.map((item) => (
          <button key={item.label} type="button" onClick={item.action}>
            <span>{item.icon}</span>
            <b>{item.label}</b>
          </button>
        ))}
      </section>

      <section className="profile-action-panel profile-action-panel-secondary">
        {secondaryItems.map((item) => (
          <button key={item.label} type="button" onClick={item.action}>
            <span>{item.icon}</span>
            <b>{item.label}</b>
          </button>
        ))}
      </section>

      {showPasswordPanel && (
        <div className="profile-modal-backdrop" onClick={() => setShowPasswordPanel(false)}>
          <form className="profile-password-modal" onSubmit={handleChangePassword} onClick={(e) => e.stopPropagation()}>
            <h2>{t("Cambiar contraseña")}</h2>
            <p>{t("Ingresa tu contraseña actual y confirma la nueva contraseña.")}</p>

            <label>
              <span>{t("Contraseña actual")}</span>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => updatePasswordField("currentPassword", e.target.value)}
                autoComplete="current-password"
              />
            </label>

            <label>
              <span>{t("Nueva contraseña")}</span>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => updatePasswordField("newPassword", e.target.value)}
                autoComplete="new-password"
              />
            </label>

            <label>
              <span>{t("Repetir nueva contraseña")}</span>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => updatePasswordField("confirmPassword", e.target.value)}
                autoComplete="new-password"
              />
            </label>

            <div className="profile-password-actions">
              <button type="button" onClick={() => setShowPasswordPanel(false)}>
                {t("Cancelar")}
              </button>
              <button type="submit" disabled={savingPassword}>
                {savingPassword ? t("Guardando...") : t("Guardar")}
              </button>
            </div>
          </form>
        </div>
      )}

      {showSupportPanel && (
        <div className="profile-modal-backdrop" onClick={() => setShowSupportPanel(false)}>
          <div className="profile-support-sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{t("Soporte")}</h2>
            <p>{t("Seleccione un método de contacto")}</p>

            <button type="button" onClick={() => openExternal(TELEGRAM_SUPPORT_URL)}>
              <span className="profile-support-icon"><FiSend /></span>
              <strong>NiceHash</strong>
              <FiArrowRight />
            </button>

            <button type="button" onClick={() => openExternal(TELEGRAM_CHANNEL_URL)}>
              <span className="profile-support-icon"><FiMessageCircle /></span>
              <strong>NiceHash Customer Service</strong>
              <FiArrowRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
