import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FiEye, FiEyeOff, FiHome, FiMail, FiLock, FiCpu } from "react-icons/fi";
import { loginUser, saveSession } from "../services/authService";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");


  useEffect(() => {
    const expiredByQuery = new URLSearchParams(location.search).get("session") === "expired";
    const expiredByStorage = sessionStorage.getItem("nicehash_session_expired") === "1";

    if (expiredByQuery || expiredByStorage) {
      setError("Tu sesión expiró. Inicia sesión nuevamente.");
      sessionStorage.removeItem("nicehash_session_expired");
    }
  }, [location.search]);

  const isValidEmail = (value) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Ingresa tu correo electrónico.");
      return;
    }

    if (!isValidEmail(email)) {
      setError("Ingresa un correo electrónico válido.");
      return;
    }

    if (!password.trim()) {
      setError("Ingresa tu contraseña.");
      return;
    }

    setLoading(true);

    try {
      const data = await loginUser({
        email,
        password,
      });

      saveSession(data);
      navigate("/home");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <button className="auth-home-btn" type="button" onClick={() => navigate("/home")}>
        <FiHome />
      </button>

      <div className="auth-logo-block nicehash-auth-brand">
        <div className="auth-logo auth-logo-chip">
          <FiCpu />
        </div>
        <h1>Accede a NiceHash</h1>
        <p>Gestiona tu potencia de hash, recargas y recompensas desde un panel seguro.</p>
      </div>

      <div className="auth-card">
        <form onSubmit={handleLogin} className="auth-form">
          <label className="auth-field-label">Correo electrónico</label>
          <div className="auth-input-wrap">
            <FiMail />
            <input
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tucorreo@ejemplo.com"
              autoComplete="email"
            />
          </div>

          <label className="auth-field-label">Contraseña</label>
          <div className="password-field auth-input-wrap">
            <FiLock />
            <input
              className="auth-input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />

            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Acceder al panel"}
          </button>
        </form>

        <p className="auth-footer-link">
          ¿Aún no eres miembro? <Link to="/register">Crear cuenta</Link>
        </p>
      </div>
    </div>
  );
}
