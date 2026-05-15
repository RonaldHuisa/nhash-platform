import React from "react";
import { NavLink } from "react-router-dom";
import { FiHome, FiUsers, FiCpu, FiUser, FiZap } from "react-icons/fi";
import { useI18n } from "../i18n/I18nContext";

export default function BottomNav() {
  const { t } = useI18n();

  const items = [
    { to: "/home", label: t("Hogar"), icon: <FiHome /> },
    { to: "/vip", label: t("personaje"), icon: <FiZap /> },
    { to: "/tasks", label: t("Minería"), icon: <FiCpu /> },
    { to: "/promotion", label: t("Equipo"), icon: <FiUsers /> },
    { to: "/profile", label: t("A mí"), icon: <FiUser /> },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `bottom-item ${isActive ? "active" : ""}`}
        >
          <span className="bottom-icon">{item.icon}</span>
          <span className="bottom-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
