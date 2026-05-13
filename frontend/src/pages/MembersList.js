import React, { useEffect, useState } from "react";
import { FiArrowLeft, FiCpu, FiDatabase, FiUsers } from "react-icons/fi";
import { useNavigate, useParams } from "react-router-dom";
import { getReferralMembers } from "../services/authService";

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function MembersList() {
  const navigate = useNavigate();
  const { level } = useParams();

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMembers() {
      try {
        const data = await getReferralMembers(level);
        setMembers(data.members || []);
      } catch (error) {
        setMembers([]);
      } finally {
        setLoading(false);
      }
    }

    loadMembers();
  }, [level]);

  return (
    <div className="page members-page members-page-v5">
      <div className="recharge-header">
        <button className="icon-btn" onClick={() => navigate(-1)}>
          <FiArrowLeft />
        </button>

        <div>
          <div className="eyebrow">NIVEL {level}</div>
          <h2>Lista de miembros</h2>
        </div>

        <div />
      </div>

      {loading && <div className="panel">Cargando miembros...</div>}

      {!loading &&
        members.map((member) => {
          const investedAmount = Number(member.investedAmount || 0);
          const isActive = Boolean(member.isActive);

          return (
            <div className="member-card member-card-tech" key={member.id}>
              <div className="member-tech-left">
                <div className="member-avatar member-avatar-tech">
                  <FiCpu />
                </div>

                <div className="member-tech-info">
                  <h3>{member.email}</h3>

                  <div className="member-tech-line">
                    <span
                      className={`member-status-chip ${
                        isActive ? "active" : "inactive"
                      }`}
                    >
                      {isActive ? "Activo" : "Inactivo"}
                    </span>

                    <span className="member-dot">•</span>

                    <span className="member-invest-chip">
                      <FiDatabase />
                      {formatMoney(investedAmount)} USDT
                    </span>

                    <span className="member-dot">•</span>

                    <span className="member-date-compact">
                      {new Date(member.registeredAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="member-tech-right">
                <span className="member-direct-compact" title="Subordinados directos">
                  <FiUsers />
                  {member.directSubordinates}
                </span>

                <span className="member-plan-price tech-amount">
                  {formatMoney(investedAmount)} USDT
                </span>
              </div>
            </div>
          );
        })}

      {!loading && members.length === 0 && (
        <div className="empty-history">No más</div>
      )}

      {!loading && members.length > 0 && (
        <div className="empty-history">No más</div>
      )}
    </div>
  );
}
